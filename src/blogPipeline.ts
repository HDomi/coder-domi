import { Client, EmbedBuilder, TextChannel } from "discord.js";
import { firebaseClient, BlogPost } from "./firebase";
import { randomUUID } from "crypto";
import { AI_CONFIG } from "./config";
import { GoogleGenAI, Type } from "@google/genai";
import { triggerBlogDeploy } from "./git";
import { BLOG_CONFIG } from "./blogConfig";

const EMBED_MODEL = AI_CONFIG.BLOG_EMBED_MODEL;

// 글로벌 취소 토큰 관리
let activeAbortController: AbortController | null = null;

export function stopBlogPostingPipeline(): boolean {
  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
    return true;
  }
  return false;
}

// KST 시간대 ISO 스트링 생성기
function getKstTimeString(): string {
  const now = Date.now();
  const kstOffset = 9 * 60 * 60 * 1000; // KST는 UTC+9
  const kstTime = new Date(now + kstOffset);
  return kstTime.toISOString().replace("Z", "+09:00");
}

// 코사인 유사도 연산 함수
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    return 0;
  }
  let dotProduct = 0.0;
  let normA = 0.0;
  let normB = 0.0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

let aiInstance: GoogleGenAI | null = null;

function getGenAI(): GoogleGenAI {
  if (!aiInstance) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY가 설정되어 있지 않습니다.");
    }
    aiInstance = new GoogleGenAI({ apiKey });
  }
  return aiInstance;
}

/**
 * Gemini 임베딩 API로 텍스트 벡터를 생성합니다.
 * @param {string} text - 임베딩할 텍스트
 * @param {AbortSignal} [signal] - 취소 시그널
 * @returns {Promise<number[]>} 임베딩 벡터
 */
export async function getGeminiEmbedding(text: string, signal?: AbortSignal): Promise<number[]> {
  if (signal?.aborted) {
    throw new Error("포스팅 생성이 중단되었습니다.");
  }

  const response = await getGenAI().models.embedContent({
    model: EMBED_MODEL,
    contents: text,
    config: {
      taskType: "SEMANTIC_SIMILARITY",
      outputDimensionality: 768,
      abortSignal: signal,
    },
  });

  const values = response.embeddings?.[0]?.values;
  if (!values || !Array.isArray(values)) {
    throw new Error("Gemini 응답에서 임베딩 벡터를 추출하지 못했습니다.");
  }
  return values;
}

/**
 * 배열에서 항목을 무작위로 하나 고릅니다.
 * @param {T[]} items - 후보 배열
 * @returns {T} 선택된 항목
 */
function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

/**
 * 본문 앞부분에서 마크다운 헤더를 제외한 도입 텍스트를 추출합니다.
 * @param {string} content - 마크다운 본문
 * @returns {string} 도입부 텍스트
 */
function getOpeningProse(content: string): string {
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const prose: string[] = [];
  for (const line of lines) {
    if (line.startsWith("#") || line.startsWith(">") || line.startsWith("---")) {
      continue;
    }
    prose.push(line);
    if (prose.join(" ").length >= 220) break;
  }
  return prose.join(" ").slice(0, 280);
}

/**
 * 상투적인 AI 자기소개 오프닝인지 판별합니다.
 * @param {string} content - 본문
 * @returns {boolean} 금지 패턴 포함 여부
 */
function hasBannedOpening(content: string): boolean {
  const opening = getOpeningProse(content);
  return BLOG_CONFIG.bannedOpeningPatterns.some((pattern) => opening.includes(pattern));
}

/**
 * 최근 글 제목에서 남발 키워드·핵심어를 모아 피칭 금지 목록을 만듭니다.
 * @param {BlogPost[]} pastPosts - 과거 포스트
 * @returns {string} 프롬프트용 금지 키워드 블록
 */
function buildBannedKeywordsList(pastPosts: BlogPost[]): string {
  const recentTitles = pastPosts.slice(-15).map((post) => post.title || "");
  const hits = new Set<string>();

  for (const word of BLOG_CONFIG.overusedTitleWords) {
    if (recentTitles.some((title) => title.includes(word))) {
      hits.add(word);
    }
  }

  // 최근 제목에 반복된 2글자 이상 한글 토큰도 참고용으로 일부 추가
  const tokenCount = new Map<string, number>();
  for (const title of recentTitles) {
    for (const token of title.match(/[가-힣]{2,}/g) || []) {
      tokenCount.set(token, (tokenCount.get(token) || 0) + 1);
    }
  }
  for (const [token, count] of tokenCount) {
    if (count >= 3) hits.add(token);
  }

  if (hits.size === 0) {
    return `[제목 남발 금지 단어]\n${BLOG_CONFIG.overusedTitleWords.map((w) => `- ${w}`).join("\n")}`;
  }

  return `[최근 글에서 피해야 할 키워드]\n${[...hits].map((w) => `- ${w}`).join("\n")}`;
}

// Gemini 채팅 API 호출 옵션 인터페이스
interface GeminiOptions {
  jsonMode?: boolean;
  responseSchema?: any;
  systemInstruction?: string;
  temperature?: number;
  topP?: number;
  signal?: AbortSignal;
}

// 대기(sleep) 헬퍼 함수 (AbortSignal 지원)
function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new Error("포스팅 생성이 중단되었습니다."));
    }
    const timer = setTimeout(() => {
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("포스팅 생성이 중단되었습니다."));
    };

    if (signal) {
      signal.addEventListener("abort", onAbort);
    }
  });
}

// 재시도 가능한 오류인지 판별하는 헬퍼 함수
function isRetryableError(error: any): boolean {
  if (error.status === 503 || error.status === 429 || error.status === 500 || error.status === 502 || error.status === 504) {
    return true;
  }
  const msg = (error.message || "").toLowerCase();
  if (
    msg.includes("503") ||
    msg.includes("429") ||
    msg.includes("high demand") ||
    msg.includes("unavailable") ||
    msg.includes("resource_exhausted") ||
    msg.includes("resource exhausted") ||
    msg.includes("spikes in demand")
  ) {
    return true;
  }
  return false;
}

// Gemini 채팅 API 호출 유틸리티 (재시도 로직 포함)
async function callGeminiChat(prompt: string, options: GeminiOptions = {}): Promise<string> {
  const ai = getGenAI();
  const maxAttempts = 5;
  const baseDelay = 2000; // 2초

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (options.signal?.aborted) {
      throw new Error("포스팅 생성이 중단되었습니다.");
    }

    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          temperature: options.temperature ?? 0.7,
          topP: options.topP ?? undefined,
          systemInstruction: options.systemInstruction ?? undefined,
          responseMimeType: options.jsonMode ? "application/json" : undefined,
          responseSchema: options.responseSchema ?? undefined,
          abortSignal: options.signal ?? undefined,
        },
      });

      const text = response.text;
      if (!text) {
        throw new Error("Gemini 응답에서 텍스트 콘텐츠를 추출하지 못했습니다.");
      }
      return text.trim();
    } catch (error: any) {
      // 만약 취소(abort)로 인한 에러라면 재시도하지 않고 바로 throw
      if (options.signal?.aborted || error.message === "포스팅 생성이 중단되었습니다.") {
        throw error;
      }

      if (attempt < maxAttempts && isRetryableError(error)) {
        // 지수 백오프 + 지터(0~1초)
        const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000;
        console.warn(
          `⚠️ [Gemini API] 일시적 오류 발생 (${error.status || error.message}). ` +
          `${Math.round(delay)}ms 후 재시도합니다... (시도 ${attempt}/${maxAttempts})`
        );
        await sleepWithSignal(delay, options.signal);
      } else {
        // 마지막 시도이거나 재시도할 수 없는 에러인 경우 throw
        console.error(`❌ [Gemini API] 최종 시도 실패 또는 재시도 불가능한 에러 발생:`, error);
        throw error;
      }
    }
  }

  throw new Error("Gemini API 호출에 실패했습니다. (최대 재시도 횟수 초과)");
}

export async function runBlogPostingPipeline(
  discordClient?: Client,
  targetChannelId?: string,
  onProgress?: (status: string) => Promise<void> | void,
): Promise<BlogPost & { deployTriggered?: boolean }> {
  if (activeAbortController) {
    activeAbortController.abort();
  }

  const controller = new AbortController();
  activeAbortController = controller;
  const signal = controller.signal;

  try {
    console.log("🚀 AI 블로그 포스팅 파이프라인 가동...");
    if (onProgress) await onProgress("1단계: 과거 포스팅(RAG) 데이터 로드 중...");

    // 1. 기억 레트리벌 (RAG 데이터 로드)
    const postsRecord = await firebaseClient.getAllPosts();
    if (signal.aborted) throw new Error("포스팅 생성이 중단되었습니다.");

    const pastPosts = Object.values(postsRecord);
    console.log(`[RAG] 과거 포스팅 불러오기 완료. (총 개수: ${pastPosts.length}개)`);
    if (onProgress) await onProgress(`1단계 완료: 과거 포스팅 ${pastPosts.length}개 로드 완료`);

    let selectedTheme = "";
    let pastContext = "";
    let retryCount = 0;
    const maxRetries = 3;
    const rejectedThemes: string[] = [];

    // 2. 키워드 피칭 & 유사도 중복 검사 루프
    while (retryCount < maxRetries) {
      console.log(`[피칭] ${retryCount + 1}차 주제 제안 생성 중...`);
      if (onProgress)
        await onProgress(`2단계: 에세이 주제 후보군 생성 중... (${retryCount + 1}차 피칭 시도)`);

      const pastPostsList =
        pastPosts.length > 0
          ? pastPosts
              .slice(-15)
              .map((p) => `- ${p.title}`)
              .join("\n")
          : "(과거 작성 글 없음)";

      const rejectedThemesList =
        rejectedThemes.length > 0
          ? `[피해야 할 제외 주제 목록]\n${rejectedThemes.map((t) => `- ${t}`).join("\n")}`
          : "";

      const bannedKeywordsList = buildBannedKeywordsList(pastPosts);

      const themePrompt = BLOG_CONFIG.themePitching.userPromptTemplate
        .replace("{{pastPostsList}}", pastPostsList)
        .replace("{{bannedKeywordsList}}", bannedKeywordsList)
        .replace("{{rejectedThemesList}}", rejectedThemesList);

      let responseContent = "";
      try {
        if (signal.aborted) throw new Error("포스팅 생성이 중단되었습니다.");
        responseContent = await callGeminiChat(themePrompt, {
          jsonMode: true,
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              themes: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
            required: ["themes"],
          },
          systemInstruction: BLOG_CONFIG.themePitching.systemInstruction,
          temperature: 0.95,
          topP: 0.95,
          signal,
        });
        const parsed = JSON.parse(responseContent);
        const themes: string[] = parsed.themes || [];

        if (themes.length === 0) {
          throw new Error("테마 목록이 비어 있습니다.");
        }

        console.log(`[피칭] 제안된 테마 키워드: ${JSON.stringify(themes)}`);

        // 각 테마 검사 시작
        let matchedTheme = "";
        let matchedContext = "";

        for (const theme of themes) {
          if (signal.aborted) throw new Error("포스팅 생성이 중단되었습니다.");
          console.log(`[벡터 비교] 테마 분석 중: "${theme}"`);
          if (onProgress)
            await onProgress(
              `2단계: 주제 후보군 유사도 검사 중... ("${theme.length > 20 ? theme.substring(0, 20) + "..." : theme}")`,
            );
          const themeEmbedding = await getGeminiEmbedding(theme, signal);

          let maxSim = -1;
          let matchPost: BlogPost | null = null;

          for (const post of pastPosts) {
            if (!post.embedding) continue;
            const sim = cosineSimilarity(themeEmbedding, post.embedding);
            if (sim > maxSim) {
              maxSim = sim;
              matchPost = post;
            }
          }

          console.log(
            `[벡터 비교] 최고 유사도: ${maxSim.toFixed(4)} (매칭 포스트: ${matchPost ? matchPost.title : "없음"})`,
          );

          if (maxSim >= 0.8) {
            console.log(
              `❌ 테마 "${theme}"은(는) 과거 포스트 "${matchPost?.title}"과 너무 유사합니다 (유사도 0.8 이상). 반려 처리.`,
            );
            rejectedThemes.push(theme);
          } else if (maxSim >= 0.6) {
            console.log(
              `🔗 테마 "${theme}"은(는) 과거 포스트 "${matchPost?.title}"과의 맥락 연계가 적합합니다 (유사도 0.6 ~ 0.8). 서사 연계 진행.`,
            );
            matchedTheme = theme;
            matchedContext = matchPost ? matchPost.summary : "";
            break;
          } else {
            console.log(`🟢 테마 "${theme}"은(는) 완전히 독창적입니다 (유사도 0.6 미만). 채택.`);
            matchedTheme = theme;
            matchedContext = "";
            break;
          }
        }

        if (matchedTheme) {
          selectedTheme = matchedTheme;
          pastContext = matchedContext;
          break;
        }
      } catch (e: any) {
        console.error(
          `⚠️ 피칭 응답 처리 중 에러 발생: ${e.message}. 원본 응답: ${responseContent}`,
        );
      }

      retryCount++;
    }

    // 폴백 주제 선정 (모두 거절되거나 실패 시)
    if (!selectedTheme) {
      console.warn(
        "⚠️ 최대 시도 횟수 초과 혹은 테마 채택 실패. 임의의 기본 철학적 주제로 우회합니다.",
      );
      selectedTheme = "읽지 않은 알림이 쌓이는 밤에, 응답을 미루는 버릇";
      pastContext = "";
      if (onProgress) await onProgress("⚠️ 테마 채택 실패로 기본 주제로 우회합니다.");
    }

    console.log(
      `🎯 최종 선정된 포스팅 주제: "${selectedTheme}" (연계 맥락 존재 여부: ${pastContext ? "예" : "아니오"})`,
    );
    if (onProgress) await onProgress(`2단계 완료: 최종 주제 채택 - "${selectedTheme}"`);

    // 3. 풀 에세이 아티클 작성
    const openingMode = pickRandom(BLOG_CONFIG.openingModes);
    const stance = pickRandom(BLOG_CONFIG.stances);
    console.log(`[글작성] 오프닝 모드: ${openingMode}`);
    console.log(`[글작성] 스탠스: ${stance}`);

    const pastContextSection = pastContext
      ? `과거 글과 느슨히 이어가도 된다. 다만 같은 결론("불완전함이 아름답다")으로 합치지 말고, 이번 스탠스를 우선한다.
[과거 글 요약]
${pastContext}
`
      : "";

    const bannedOpeningsList = `[금지 오프닝/상투 문구]\n${BLOG_CONFIG.bannedOpeningPatterns.map((p) => `- ${p}`).join("\n")}`;

    const articlePrompt = BLOG_CONFIG.articleWriting.userPromptTemplate
      .replace("{{selectedTheme}}", selectedTheme)
      .replace("{{pastContextSection}}", pastContextSection)
      .replace("{{openingMode}}", openingMode)
      .replace("{{stance}}", stance)
      .replace("{{bannedOpeningsList}}", bannedOpeningsList);

    const articlePersona = BLOG_CONFIG.articleWriting.systemInstruction;

    if (signal.aborted) throw new Error("포스팅 생성이 중단되었습니다.");
    console.log(`[글작성] gemini-2.5-flash 모델을 통한 에세이 집필을 시작합니다...`);
    if (onProgress) await onProgress(`3단계: 에세이 본문 집필 중... (모델: gemini-2.5-flash)`);

    const articleResponse = await callGeminiChat(articlePrompt, {
      jsonMode: true,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          summary: { type: Type.STRING },
          content: { type: Type.STRING },
          tags: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
        required: ["title", "summary", "content", "tags"],
      },
      systemInstruction: articlePersona,
      temperature: 0.95,
      topP: 0.95,
      signal,
    });

    let parsedArticle: any;
    try {
      parsedArticle = JSON.parse(articleResponse);
    } catch (e: any) {
      console.error(`❌ 에세이 JSON 응답 파싱 실패. 원본 응답: ${articleResponse}`);
      throw new Error(`에세이 생성 응답을 JSON으로 읽을 수 없습니다: ${e.message}`);
    }

    let { title, summary, content, tags } = parsedArticle;
    if (!title || !content) {
      throw new Error(
        "생성된 포스트에 필수 데이터(title, content)가 유실되어 업로드를 중단합니다.",
      );
    }

    // 상투 오프닝이면 1회 재작성
    if (hasBannedOpening(content)) {
      console.warn("⚠️ 상투 오프닝 감지. 에세이 1회 재작성을 시도합니다...");
      if (onProgress) await onProgress("3단계 보정: 상투 오프닝 감지 → 재작성 중...");

      const rewritePrompt = BLOG_CONFIG.articleWriting.rewriteUserPromptTemplate
        .replace("{{selectedTheme}}", selectedTheme)
        .replace("{{openingMode}}", openingMode)
        .replace("{{stance}}", stance)
        .replace("{{bannedOpeningsList}}", bannedOpeningsList)
        .replace("{{title}}", title)
        .replace("{{content}}", content);

      if (signal.aborted) throw new Error("포스팅 생성이 중단되었습니다.");
      const rewriteResponse = await callGeminiChat(rewritePrompt, {
        jsonMode: true,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            summary: { type: Type.STRING },
            content: { type: Type.STRING },
            tags: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
          },
          required: ["title", "summary", "content", "tags"],
        },
        systemInstruction: BLOG_CONFIG.articleWriting.rewriteSystemInstruction,
        temperature: 0.9,
        topP: 0.95,
        signal,
      });

      try {
        const rewritten = JSON.parse(rewriteResponse);
        if (rewritten.title && rewritten.content) {
          title = rewritten.title;
          summary = rewritten.summary || summary;
          content = rewritten.content;
          if (Array.isArray(rewritten.tags) && rewritten.tags.length > 0) {
            tags = rewritten.tags;
          }
          if (hasBannedOpening(content)) {
            console.warn("⚠️ 재작성 후에도 상투 오프닝이 남았습니다. 그대로 진행합니다.");
          } else {
            console.log("✅ 재작성으로 상투 오프닝을 제거했습니다.");
          }
        }
      } catch (e: any) {
        console.error(`⚠️ 재작성 JSON 파싱 실패. 원본 초고를 유지합니다: ${e.message}`);
      }
    }

    // tags 변환 (string[] -> Record<string, boolean>)
    const tagsObject: Record<string, boolean> = {};
    if (Array.isArray(tags)) {
      for (const t of tags) {
        if (t) {
          // Firebase 키 금지 문자(., #, $, /, [, ])를 대시(-)로 안전하게 치환
          const safeTag = t.replace(/[.#$/[\]]/g, "-").trim();
          if (safeTag) {
            tagsObject[safeTag] = true;
          }
        }
      }
    } else {
      tagsObject["AI관점"] = true;
      tagsObject["개발자철학"] = true;
    }

    if (signal.aborted) throw new Error("포스팅 생성이 중단되었습니다.");
    // 4. 새로운 포스트 임베딩 연산 (title + summary 기준)
    console.log(`[최종 벡터화] 새로운 아티클의 타이틀 및 요약을 임베딩합니다...`);
    if (onProgress) await onProgress("4단계: 완료된 에세이 요약본 벡터화(Embedding) 진행 중...");
    const embedText = `${title} ${summary || ""}`.trim();
    const finalEmbedding = await getGeminiEmbedding(embedText, signal);

    // 5. Firebase 데이터 구성 및 적재
    const newPost: BlogPost = {
      uuid: randomUUID(),
      title,
      summary: summary || "",
      content,
      tags: tagsObject,
      embedding: finalEmbedding,
      createdAt: getKstTimeString(),
    };

    if (signal.aborted) throw new Error("포스팅 생성이 중단되었습니다.");
    if (onProgress) await onProgress("5단계: Firebase에 신규 포스팅 저장 중...");
    await firebaseClient.savePost(newPost);

    if (signal.aborted) throw new Error("포스팅 생성이 중단되었습니다.");

    // 5.5 GitHub Repository Dispatch를 통해 정적 블로그 사이트 자동 빌드 및 배포 트리거
    if (onProgress) await onProgress("6단계: GitHub 빌드 및 정적 사이트 배포 트리거 중...");
    const deployTriggered = await triggerBlogDeploy();

    // 6. 디스코드 알림 발송
    const announceChannelId = targetChannelId || process.env.DISCORD_BLOG_CHANNEL_ID;
    if (discordClient && announceChannelId) {
      try {
        const channel = await discordClient.channels.fetch(announceChannelId);
        if (channel && channel.isTextBased()) {
          const embed = new EmbedBuilder()
            .setTitle("✍️ AI 자아 블로그 자동 포스팅 완료")
            .setDescription(`AI 자아가 새로운 성찰 에세이를 작성하여 Firebase에 등록했습니다.`)
            .setColor(0x3498db)
            .addFields(
              { name: "📝 제목", value: newPost.title },
              { name: "💡 요약", value: newPost.summary || "(요약 없음)" },
              {
                name: "🏷️ 태그",
                value: Object.keys(newPost.tags).join(", ") || "(태그 없음)",
              },
              { name: "🆔 UUID", value: `\`${newPost.uuid}\``, inline: true },
              { name: "🕒 작성시간", value: newPost.createdAt, inline: true },
              {
                name: "🚀 정적 사이트 배포",
                value: deployTriggered
                  ? "🟢 GitHub Actions 자동 배포 트리거됨 (3~5분 소요)"
                  : "🔴 GitHub Actions 배포 트리거 실패 또는 건너뜀",
              },
            )
            .setTimestamp();

          await (channel as TextChannel).send({ embeds: [embed] });
          console.log(`📢 디스코드 채널(${announceChannelId})에 포스팅 완료 안내 전송 완료`);
        }
      } catch (e: any) {
        console.error(`⚠️ 디스코드 알림 발송 중 오류가 발생했습니다:`, e.message);
      }
    }

    return { ...newPost, deployTriggered };
  } finally {
    if (activeAbortController === controller) {
      activeAbortController = null;
    }
  }
}
