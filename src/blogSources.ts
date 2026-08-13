import { DEVLOG_CONFIG } from "./config";

/**
 * devlog/guide 장르의 집필 소재.
 * 공개 저장소에서 이미 공개된 정보만 담는다.
 */
export interface RepoSource {
  /** owner/repo */
  fullName: string;
  /** 저장소 설명 */
  description: string;
  /** 주 언어 */
  language: string;
  /** README 발췌 (자격 증명 스캔 통과분만) */
  readme: string;
  /** 최근 커밋 (자격 증명 스캔 통과분만) */
  commits: RepoCommit[];
}

export interface RepoCommit {
  /** 커밋 메시지 첫 줄 */
  message: string;
  /** 작성일 (ISO) */
  date: string;
  /** 변경된 파일 경로 (차단 패턴 제외 후) */
  files: string[];
}

/** GitHub API 공통 헤더를 만든다. GIT_TOKEN이 없으면 비인증으로 호출한다. */
function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "coder-domi-bot",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = process.env.GIT_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

/**
 * 텍스트에 자격 증명 패턴이 포함되어 있는지 검사합니다.
 * @param {string} text - 검사할 텍스트
 * @returns {boolean} 하나라도 걸리면 true
 */
export function containsSecret(text: string): boolean {
  return DEVLOG_CONFIG.secretPatterns.some((pattern) => pattern.test(text));
}

/**
 * 텍스트에서 이메일 주소를 마스킹합니다.
 * 커밋 메시지에 섞여 들어오는 개인 이메일이 프롬프트로 나가지 않게 합니다.
 * @param {string} text - 원본 텍스트
 * @returns {string} 마스킹된 텍스트
 */
export function redactEmails(text: string): string {
  return text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[이메일 제거됨]");
}

/**
 * 자격 증명 성격의 파일 경로인지 판별합니다.
 * @param {string} path - 파일 경로
 * @returns {boolean} 차단 대상이면 true
 */
function isBlockedPath(path: string): boolean {
  return DEVLOG_CONFIG.blockedPathPatterns.some((pattern) => pattern.test(path));
}

/** GitHub API를 호출하고 JSON을 반환합니다. 실패 시 null. */
async function fetchGitHub(url: string, signal?: AbortSignal): Promise<any | null> {
  try {
    const response = await fetch(url, { headers: buildHeaders(), signal });
    if (!response.ok) {
      console.warn(`⚠️ [GitHub API] ${url} 호출 실패: ${response.status} ${response.statusText}`);
      return null;
    }
    return await response.json();
  } catch (error: any) {
    if (signal?.aborted) throw error;
    console.warn(`⚠️ [GitHub API] ${url} 요청 오류: ${error.message}`);
    return null;
  }
}

/**
 * 저장소가 공개 상태인지 확인합니다.
 * 화이트리스트에 있더라도 이 검사를 통과하지 못하면 수집하지 않습니다.
 * @param {string} fullName - owner/repo
 * @param {AbortSignal} [signal] - 취소 시그널
 * @returns {Promise<any | null>} 공개 저장소면 메타데이터, 아니면 null
 */
async function verifyPublicRepo(fullName: string, signal?: AbortSignal): Promise<any | null> {
  const meta = await fetchGitHub(`https://api.github.com/repos/${fullName}`, signal);
  if (!meta) return null;

  if (meta.private === true) {
    console.warn(`🔒 [소재 수집] ${fullName}은(는) 비공개 저장소이므로 수집을 건너뜁니다.`);
    return null;
  }
  if (meta.private !== false) {
    // private 필드를 확인하지 못한 응답은 안전 측에서 배제한다.
    console.warn(`🔒 [소재 수집] ${fullName}의 공개 여부를 확인하지 못해 수집을 건너뜁니다.`);
    return null;
  }
  return meta;
}

/**
 * 저장소 README를 가져옵니다. 자격 증명 패턴이 있으면 폐기합니다.
 * @param {string} fullName - owner/repo
 * @param {AbortSignal} [signal] - 취소 시그널
 * @returns {Promise<string>} README 발췌 (없거나 폐기 시 빈 문자열)
 */
async function fetchReadme(fullName: string, signal?: AbortSignal): Promise<string> {
  const data = await fetchGitHub(`https://api.github.com/repos/${fullName}/readme`, signal);
  if (!data?.content) return "";

  let decoded = "";
  try {
    decoded = Buffer.from(data.content, "base64").toString("utf-8");
  } catch {
    return "";
  }

  if (containsSecret(decoded)) {
    console.warn(`🔒 [소재 수집] ${fullName} README에서 자격 증명 패턴이 감지되어 폐기합니다.`);
    return "";
  }

  return redactEmails(decoded).slice(0, DEVLOG_CONFIG.readmeCharLimit);
}

/**
 * 저장소의 최근 커밋을 가져옵니다.
 * 자격 증명 패턴이 걸린 커밋은 통째로 버리고, 차단 경로는 파일 목록에서 제거합니다.
 * @param {string} fullName - owner/repo
 * @param {AbortSignal} [signal] - 취소 시그널
 * @returns {Promise<RepoCommit[]>} 안전 필터를 통과한 커밋 목록
 */
async function fetchRecentCommits(fullName: string, signal?: AbortSignal): Promise<RepoCommit[]> {
  const list = await fetchGitHub(
    `https://api.github.com/repos/${fullName}/commits?per_page=${DEVLOG_CONFIG.commitsPerRepo}`,
    signal,
  );
  if (!Array.isArray(list)) return [];

  const results: RepoCommit[] = [];

  for (const entry of list) {
    const rawMessage: string = entry?.commit?.message || "";
    const message = redactEmails(rawMessage.split("\n")[0].trim());
    if (!message) continue;

    if (containsSecret(rawMessage)) {
      console.warn(`🔒 [소재 수집] ${fullName} 커밋에서 자격 증명 패턴이 감지되어 폐기합니다.`);
      continue;
    }

    // 커밋 상세를 받아 변경 파일 경로만 추린다. (diff 본문은 사용하지 않는다)
    const detail = await fetchGitHub(
      `https://api.github.com/repos/${fullName}/commits/${entry.sha}`,
      signal,
    );
    const files: string[] = Array.isArray(detail?.files)
      ? detail.files
          .map((f: any) => String(f.filename || ""))
          .filter((path: string) => path && !isBlockedPath(path))
          .slice(0, 15)
      : [];

    results.push({
      message,
      date: entry?.commit?.author?.date || "",
      files,
    });
  }

  return results;
}

/**
 * 지정한 공개 저장소 하나의 집필 소재를 수집합니다.
 * @param {string} fullName - owner/repo
 * @param {AbortSignal} [signal] - 취소 시그널
 * @returns {Promise<RepoSource | null>} 소재. 비공개이거나 수집 실패 시 null
 */
export async function collectRepoSource(
  fullName: string,
  signal?: AbortSignal,
): Promise<RepoSource | null> {
  if (!DEVLOG_CONFIG.allowedRepos.includes(fullName)) {
    console.warn(`🔒 [소재 수집] ${fullName}은(는) 화이트리스트에 없어 수집하지 않습니다.`);
    return null;
  }

  const meta = await verifyPublicRepo(fullName, signal);
  if (!meta) return null;

  const [readme, commits] = await Promise.all([
    fetchReadme(fullName, signal),
    fetchRecentCommits(fullName, signal),
  ]);

  if (!readme && commits.length === 0) {
    console.warn(`⚠️ [소재 수집] ${fullName}에서 사용할 소재를 찾지 못했습니다.`);
    return null;
  }

  return {
    fullName,
    description: redactEmails(String(meta.description || "")),
    language: String(meta.language || ""),
    readme,
    commits,
  };
}

/**
 * 화이트리스트를 순회하며 소재를 수집합니다.
 * 최근에 다룬 저장소를 뒤로 밀어 같은 저장소가 연달아 나오지 않게 합니다.
 * @param {string[]} recentlyUsedRepos - 최근 글에서 사용한 저장소 목록 (최신순)
 * @param {AbortSignal} [signal] - 취소 시그널
 * @returns {Promise<RepoSource | null>} 첫 번째로 수집에 성공한 소재
 */
export async function collectDevlogSource(
  recentlyUsedRepos: string[] = [],
  signal?: AbortSignal,
): Promise<RepoSource | null> {
  const candidates = [...DEVLOG_CONFIG.allowedRepos].sort((a, b) => {
    const aIdx = recentlyUsedRepos.indexOf(a);
    const bIdx = recentlyUsedRepos.indexOf(b);
    // 최근에 쓰지 않은 저장소를 앞으로 (indexOf가 -1이면 미사용)
    const aRank = aIdx === -1 ? -1 : recentlyUsedRepos.length - aIdx;
    const bRank = bIdx === -1 ? -1 : recentlyUsedRepos.length - bIdx;
    return aRank - bRank;
  });

  for (const fullName of candidates) {
    if (signal?.aborted) throw new Error("포스팅 생성이 중단되었습니다.");
    const source = await collectRepoSource(fullName, signal);
    if (source) {
      console.log(
        `📦 [소재 수집] ${fullName} 수집 완료 (커밋 ${source.commits.length}개, README ${source.readme.length}자)`,
      );
      return source;
    }
  }

  console.warn("⚠️ [소재 수집] 화이트리스트에서 사용 가능한 공개 저장소를 찾지 못했습니다.");
  return null;
}

/**
 * 수집한 소재를 프롬프트에 넣을 텍스트 블록으로 만듭니다.
 * @param {RepoSource} source - 저장소 소재
 * @returns {string} 프롬프트 삽입용 블록
 */
export function formatSourceBlock(source: RepoSource): string {
  const commitLines = source.commits
    .map((c) => {
      const files = c.files.length > 0 ? ` [변경: ${c.files.join(", ")}]` : "";
      return `- ${c.message}${files}`;
    })
    .join("\n");

  const parts = [
    `[저장소] ${source.fullName}`,
    source.description ? `[설명] ${source.description}` : "",
    source.language ? `[주 언어] ${source.language}` : "",
    source.readme ? `\n[README 발췌]\n${source.readme}` : "",
    commitLines ? `\n[최근 커밋]\n${commitLines}` : "",
  ];

  return parts.filter(Boolean).join("\n");
}
