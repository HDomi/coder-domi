export const AI_CONFIG = {
  // 블로그 주제 중복 검사용 임베딩 모델
  BLOG_EMBED_MODEL: "gemini-embedding-001",

  // GitHub 배포 트리거 설정
  GITHUB_OWNER: "HDomi",
  GITHUB_REPO: "hdomi.github.io",
};

/**
 * devlog/guide 장르가 소재로 삼는 GitHub 저장소 설정.
 *
 * [보안 원칙]
 * - 저장소 자동 탐색을 하지 않는다. 아래 화이트리스트에 적힌 것만 수집한다.
 * - 화이트리스트에 있어도 GitHub API 응답의 private 필드를 매번 재확인하고,
 *   private이면 수집을 건너뛴다. (레포가 나중에 비공개로 전환되는 경우 대비)
 * - 수집 대상은 이미 공개된 정보(README·커밋 메시지·변경 파일 경로)로 한정한다.
 *   파일 본문과 diff는 가져오지 않는다.
 */
export const DEVLOG_CONFIG = {
  /** 소재로 사용할 공개 저장소 화이트리스트 (owner/repo) */
  allowedRepos: [
    "HDomi/frame-pick",
    "HDomi/coder-domi",
    "HDomi/domi-indexed-sqlite",
    "HDomi/d-korea-law",
    "HDomi/domi-chat-portfolio",
    "HDomi/h_useful_tools",
  ],

  /** 저장소당 참고할 최근 커밋 개수 */
  commitsPerRepo: 12,

  /** README에서 잘라 쓸 최대 글자 수 */
  readmeCharLimit: 2500,

  /**
   * 수집에서 제외할 파일 경로 패턴.
   * 공개 저장소라도 자격 증명 성격의 경로는 소재에서 배제한다.
   */
  blockedPathPatterns: [
    /(^|\/)\.env($|\.)/i,
    /(^|\/)\.npmrc$/i,
    /(^|\/)\.netrc$/i,
    /(^|\/)id_rsa/i,
    /(^|\/)service-account/i,
    /(^|\/)firebase-key/i,
    /key.*\.json$/i,
    /secret/i,
    /credential/i,
    /token/i,
    /password/i,
    /\.(pem|p12|pfx|keystore|jks|key|crt)$/i,
  ],

  /**
   * 자격 증명 노출 스캔 패턴.
   * 수집한 텍스트에서 하나라도 걸리면 해당 커밋(또는 README)을 통째로 폐기한다.
   */
  secretPatterns: [
    /AIza[0-9A-Za-z_-]{30,}/,
    /gh[pousr]_[A-Za-z0-9]{30,}/,
    /github_pat_[A-Za-z0-9_]{20,}/,
    /sk-[A-Za-z0-9_-]{20,}/,
    /xox[baprs]-[A-Za-z0-9-]{10,}/,
    /-----BEGIN[A-Z ]*PRIVATE KEY-----/,
    /discord(app)?\.com\/api\/webhooks\//i,
    /AKIA[0-9A-Z]{16}/,
    /\bBearer\s+[A-Za-z0-9._-]{20,}/,
    /"(api[_-]?key|access[_-]?token|client[_-]?secret)"\s*:\s*"[^"]{8,}"/i,
  ],
};

/**
 * 요일별 장르 배정 프리셋. 0=일요일 ~ 6=토요일.
 * null은 휴재(자동 포스팅 없음)를 뜻한다.
 *
 * approval: 애드센스 심사 통과가 목표인 기간용. 정보성·경험 기반 글 비중을 높인다.
 * balanced: 승인 이후 복귀용. 에세이 정체성을 유지하면서 기술 글을 섞는다.
 */
export const GENRE_SCHEDULE_PRESETS: Record<string, (BlogGenre | null)[]> = {
  approval: [null, "guide", "devlog", "guide", "devlog", "essay", null],
  balanced: [null, "guide", "devlog", "essay", "devlog", "essay", null],
};

export type BlogGenre = "essay" | "devlog" | "guide";

/**
 * 현재 사용할 프리셋 이름.
 * 애드센스 승인이 나면 "balanced"로 바꾸면 된다. 다른 코드는 손대지 않아도 된다.
 */
export const ACTIVE_GENRE_PRESET: keyof typeof GENRE_SCHEDULE_PRESETS = "approval";

/**
 * KST 기준 요일에 배정된 장르를 반환합니다.
 * @param {Date} [now] - 기준 시각 (테스트용)
 * @returns {BlogGenre | null} 배정 장르. 휴재일이면 null
 */
export function resolveGenreForToday(now: Date = new Date()): BlogGenre | null {
  const weekdayShort = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "short",
  }).format(now);

  const index = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayShort);
  if (index === -1) return "essay";

  const schedule = GENRE_SCHEDULE_PRESETS[ACTIVE_GENRE_PRESET];
  return schedule[index] ?? null;
}
