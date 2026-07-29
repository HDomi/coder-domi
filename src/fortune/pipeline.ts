import { GoogleGenAI, Type } from "@google/genai";
import { TextChannel, ChatInputCommandInteraction } from "discord.js";
import { firebaseClient, FortuneUserInfo } from "../firebase";
import { WeeklyFortuneResult, DayFortune, TodayFortuneResult } from "./types";
import {
  getIljinForDate,
  parseIlganIndex,
  getSipseongForDay,
  CHEONGAN,
} from "./sajuUtils";

/**
 * KST(Asia/Seoul) 기준 현재 날짜와 요일을 구합니다.
 */
export function getTodayKst(): { dateStr: string; dayName: string } {
  const now = new Date();
  const kstFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = kstFormatter.formatToParts(now);
  const partMap = Object.fromEntries(parts.map((p) => [p.type, p.value]));

  const dateStr = `${partMap.year}-${partMap.month}-${partMap.day}`;
  const kstDate = new Date(`${dateStr}T12:00:00+09:00`);
  const dayNames = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];
  const dayName = dayNames[kstDate.getDay()];

  return { dateStr, dayName };
}

/**
 * KST(Asia/Seoul) 기준 현재 주의 월요일~일요일 날짜와 주차 정보를 계산합니다.
 */
export function getCurrentWeekDaysKst(): {
  weekTitle: string;
  weekCode: string;
  days: { dayName: string; dateStr: string }[];
} {
  const now = new Date();
  const kstFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = kstFormatter.formatToParts(now);
  const partMap = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  
  // KST 정오 기준 Date 객체 생성
  const kstDate = new Date(
    `${partMap.year}-${partMap.month}-${partMap.day}T12:00:00+09:00`
  );

  // 일요일: 0, 월요일: 1, ..., 토요일: 6
  const dayOfWeek = kstDate.getDay();
  // 월요일과의 차이 (월요일=0, 화=1, ..., 일=6)
  const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  const mondayDate = new Date(kstDate);
  mondayDate.setDate(kstDate.getDate() - diffToMonday);

  const dayNames = ["월요일", "화요일", "수요일", "목요일", "금요일", "토요일", "일요일"];
  const days: { dayName: string; dateStr: string }[] = [];

  for (let i = 0; i < 7; i++) {
    const cur = new Date(mondayDate);
    cur.setDate(mondayDate.getDate() + i);

    const year = cur.getFullYear();
    const month = String(cur.getMonth() + 1).padStart(2, "0");
    const day = String(cur.getDate()).padStart(2, "0");

    days.push({
      dayName: dayNames[i],
      dateStr: `${year}-${month}-${day}`,
    });
  }

  const startStr = days[0].dateStr;
  const endStr = days[6].dateStr;
  const weekTitle = `🔮 **[주간 사주/운세] ${startStr} ~ ${endStr}**`;
  const weekCode = `${startStr}`;

  return { weekTitle, weekCode, days };
}

let genAIClient: GoogleGenAI | null = null;

function getGenAI(): GoogleGenAI {
  if (!genAIClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY 환경변수가 설정되어 있지 않습니다.");
    }
    genAIClient = new GoogleGenAI({ apiKey });
  }
  return genAIClient;
}

/**
 * Gemini API를 호출하여 이번 주 월~일요일 사주 & 별자리 운세를 생성합니다.
 */
export async function generateWeeklyFortune(
  userInfo: FortuneUserInfo
): Promise<WeeklyFortuneResult> {
  const { weekTitle, days } = getCurrentWeekDaysKst();
  const ai = getGenAI();

  // 일간 인덱스 분석 (예: "계수", "癸水" -> 9 (계))
  const ilganIdx = parseIlganIndex(userInfo.ilgan);
  let ilganDisplay = userInfo.ilgan ? userInfo.ilgan : "미지정 (제공된 일진 기반 해석)";
  if (ilganIdx !== null) {
    const c = CHEONGAN[ilganIdx];
    ilganDisplay = `${c.name}수/목/화/토/금 (${c.name}${c.hanja})`;
    if (userInfo.ilgan) {
      ilganDisplay = `${userInfo.ilgan} (천간: ${c.name}${c.hanja})`;
    }
  }

  const daysInfoPrompt = days
    .map((d) => {
      const iljin = getIljinForDate(d.dateStr);
      let sipseongText = "";
      if (ilganIdx !== null) {
        sipseongText = ` ${getSipseongForDay(iljin, ilganIdx)}`;
      }
      return `- ${d.dateStr} (${d.dayName.substring(0, 1)}): ${iljin.fullName}${sipseongText}`;
    })
    .join("\n");

  const prompt = `
[역할 정의]
너는 명리학과 동양철학에 깊은 지식을 가진 전문 역학 상담가야. 
아래 제공된 [사용자 사주 및 별자리 정보]와 [해당 주간의 실제 만세력 일진] 데이터를 바탕으로, 각 날짜별 십성(十星)과 오행의 상생상극을 논리적으로 분석하여 주간 운세를 작성해 줘.

[사용자 사주 및 별자리 정보]
- 생년월일: ${userInfo.birthYear}년 ${userInfo.birthMonth}월 ${userInfo.birthDay}일 (${userInfo.sajuFormat || "양력"})
- 출생시: ${userInfo.birthTime}
- 사주 일간: ${ilganDisplay}
${userInfo.sajuPillars ? `- 사주 명식: ${userInfo.sajuPillars}` : ""}
- 별자리: ${userInfo.zodiacSign}
- 현재 연애 상태: **솔로 (Single)** (※ 매우 중요: 반드시 솔로/싱글 관점에서 연애운을 풀이할 것)

[분석할 주간 및 실제 만세력 일진]
${daysInfoPrompt}

[운세 분석 태도 및 톤앤매너]
- **냉철하고 객관적인 혜안**: 무조건 칭찬이나 덕담 위주의 긍정적인 말만 늘어놓지 마세요. 위험 요소, 대인관계 마찰, 지출 손실, 경솔한 판단 등 피해야 할 흉한 기운이나 위험이 있는 날에는 객관적이고 냉철하게 직언해 주세요.
- **센스 있는 평가 및 길흉의 입체감**: 경고할 부분은 분명히 짚어주되, 실제로 기운이 매우 좋은 분야(호재, 대길한 운, 귀인과의 만남 등)가 있다면 화끈하게 인정하고 그 기회를 적극 잡으라고 확실하게 밝혀주는 센스를 발휘하세요.
- **실질적 대처법**: 나쁜 운세에는 피해를 줄이는 방어적인 대처법을, 좋은 운세에는 성과를 극대화하는 실행 전략을 명확히 제시하세요.

[작성 가이드라인]
1. 반드시 지정된 사주 일간과 각 날짜의 60갑자 일진 및 일봉 십성(十星) 작용을 정확히 적용해서 명리학 원리에 입각하여 해석할 것. (절대 사용자의 일간을 임의로 변경하거나 가상의 일진으로 착각하지 말 것)
2. 추상적이거나 화려하기만 한 미사여구는 줄이고, 실질적으로 도움이 되는 직장/학업/대인관계/재물/컨디션 관리 팁 위주로 작성할 것.
3. 디스코드 마크다운 서식을 활용하여 각 요일별 내용(content)에는 반드시 아래 항목들이 빠짐없이 상세하게 포함되어야 합니다:
   - 📅 **[날짜 및 요일 헤더]** (예: \`📅 2026년 7월 27일 (월) - 정축(丁丑)일 [편재/편관]\`)
   - 💼 **직장 & 학업 / 사업운**: 성과, 협업, 업무 주의사항, 추진 전략
   - 💖 **연애 & 대인관계운 (솔로 강조)**: 현재 사용자가 **솔로(싱글)** 상태임을 명확히 반영하세요. 커플 이야기 대신 **솔로의 관점**에서 새로운 인연 운, 소개팅/모임 기회, 매력 발산 지수, 호감을 이끌어내는 전략, 대인관계 조언을 핵심으로 작성할 것.
   - 💰 **금전 & 재물운**: 지출/수입 흐름, 투자/재물 기회, 주의해야 할 지출
   - 🍀 **행운 요소**: 행운의 색상, 행운의 숫자, 행운의 아이템, 행운의 방위
   - 💡 **오늘의 총평 및 힐링 조언**: 마음가짐 및 하루를 다스리는 팁
4. 각 요일의 content는 디스코드 메시지 1개로 발송되므로, 읽는 이가 몰입감을 느낄 수 있도록 1,200자~1,800자 내외로 정성껏 길고 상세하게 작성하세요. (단, 1,900자 초과 금지)

응답은 지정된 JSON 형식으로 작성해 주세요.
`;

  const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  const response = await ai.models.generateContent({
    model: modelName,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          fortunes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                dayName: { type: Type.STRING },
                dateStr: { type: Type.STRING },
                content: { type: Type.STRING },
              },
              required: ["dayName", "dateStr", "content"],
            },
          },
        },
        required: ["fortunes"],
      },
    },
  });

  const rawText = response.text || "";
  let parsed: any;
  try {
    parsed = JSON.parse(rawText);
  } catch (e: any) {
    throw new Error(`Gemini 운세 응답 파싱 실패: ${e.message}`);
  }

  const generatedFortunes: DayFortune[] = (parsed.fortunes || []).map((f: any) => ({
    dayName: f.dayName,
    dateStr: f.dateStr,
    content: f.content,
  }));

  return {
    weekTitle,
    days: generatedFortunes,
    userInfo,
  };
}

/**
 * Gemini API를 호출하여 오늘(KST 기준)의 사주 & 별자리 상세 운세를 생성합니다.
 */
export async function generateTodayFortune(
  userInfo: FortuneUserInfo
): Promise<TodayFortuneResult> {
  const today = getTodayKst();
  const ai = getGenAI();

  const ilganIdx = parseIlganIndex(userInfo.ilgan);
  let ilganDisplay = userInfo.ilgan ? userInfo.ilgan : "미지정 (제공된 일진 기반 해석)";
  if (ilganIdx !== null) {
    const c = CHEONGAN[ilganIdx];
    ilganDisplay = `${c.name}수/목/화/토/금 (${c.name}${c.hanja})`;
    if (userInfo.ilgan) {
      ilganDisplay = `${userInfo.ilgan} (천간: ${c.name}${c.hanja})`;
    }
  }

  const iljin = getIljinForDate(today.dateStr);
  let sipseongText = "";
  if (ilganIdx !== null) {
    sipseongText = ` ${getSipseongForDay(iljin, ilganIdx)}`;
  }

  const prompt = `
[역할 정의]
너는 명리학과 동양철학에 깊은 지식을 가진 전문 역학 상담가야. 
아래 제공된 [사용자 사주 및 별자리 정보]와 [오늘의 만세력 일진] 데이터를 바탕으로, 십성(十星)과 오행의 상생상극을 논리적으로 분석하여 오늘의 상세 운세를 작성해 줘.

[사용자 사주 및 별자리 정보]
- 생년월일: ${userInfo.birthYear}년 ${userInfo.birthMonth}월 ${userInfo.birthDay}일 (${userInfo.sajuFormat || "양력"})
- 출생시: ${userInfo.birthTime}
- 사주 일간: ${ilganDisplay}
${userInfo.sajuPillars ? `- 사주 명식: ${userInfo.sajuPillars}` : ""}
- 별자리: ${userInfo.zodiacSign}
- 현재 연애 상태: **솔로 (Single)** (※ 매우 중요: 반드시 솔로/싱글 관점에서 분석할 것)

[오늘의 만세력 일진]
- 날짜: ${today.dateStr} (${today.dayName})
- 일진: ${iljin.fullName}${sipseongText}

[운세 분석 태도 및 톤앤매너]
- **냉철하고 객관적인 혜안**: 무조건 칭찬이나 덕담 위주의 긍정적인 말만 늘어놓지 마세요. 위험 요소, 대인관계 마찰, 지출 손실, 경솔한 판단 등 피해야 할 흉한 기운이나 위험이 있는 부분은 객관적이고 냉철하게 직언해 주세요.
- **센스 있는 평가 및 길흉의 입체감**: 경고할 부분은 분명히 짚어주되, 실제로 기운이 매우 좋은 분야(호재, 대길한 운, 귀인과의 만남 등)가 있다면 화끈하게 인정하고 그 기회를 적극 잡으라고 확실하게 밝혀주는 센스를 발휘하세요.
- **실질적 대처법**: 나쁜 운세에는 피해를 줄이는 방어적인 대처법을, 좋은 운세에는 성과를 극대화하는 실행 전략을 명확히 제시하세요.

[작성 가이드라인]
1. 반드시 지정된 사주 일간과 오늘의 60갑자 일진 및 일봉 십성(十星) 작용을 정확히 적용해서 명리학 원리에 입각하여 해석할 것.
2. 추상적이거나 화려하기만 한 미사여구는 줄이고, 실질적으로 도움이 되는 시간대별 기운, 직장/학업, 연애, 재물, 건강, 행운 요소, 대처 전략 위주로 풍성하고 상세하게 작성할 것.
3. 디스코드 마크다운 서식을 활용하여 내용(content)에는 반드시 아래 항목들이 빠짐없이 매우 상세하게 포함되어야 합니다:
   - 📅 **[오늘의 운세 헤더]** (예: \`📅 ${today.dateStr} (${today.dayName.substring(0, 1)}) - ${iljin.fullName} ${sipseongText}\`)
   - 🕒 **오늘의 시간대별 기운 흐름**:
     - 🌅 **오전 (아침~정오)**: 기운의 특징, 집중할 업무/행동, 마음가짐
     - ☀️ **오후 (정오~해질녘)**: 성과 창출 및 대인관계 주의점
     - 🌙 **저녁 & 밤**: 감정 정리, 휴식 및 내일을 위한 충전 전략
   - 💼 **직장 & 학업 / 사업운**: 업무 성과, 협업, 실수 방지 및 우선순위 과제
   - 💖 **연애 & 대인관계운 (솔로 강조)**: 
     - ⚠️ **필수 강조**: 현재 사용자는 **솔로(싱글)** 상태입니다! 커플 이야기나 연인 위주의 해석을 절대 하지 말고, **솔로 관점**에서 새로운 인연과의 만남 운, 나의 매력 지수, 소개팅/모임 운, 호감을 사기 위한 행동 팁, 피해야 할 사람 유형 등을 핵심으로 강조하여 상세히 작성하세요.
   - 💰 **금전 & 재물운**: 지출/수입 흐름, 낭비 방지 주의사항, 투자 및 금전 기회
   - 🏥 **건강 & 컨디션**: 주의해야 할 신체 부위, 에너지 관리, 스트레스 완화 팁
   - 🍀 **오늘의 행운 요소**:
     - 🎨 행운의 색상 / 🔢 행운의 숫자 / 🧭 행운의 방위 / 🎒 행운의 아이템 / 🍱 행운의 음식
   - 💡 **오늘의 총평 및 힐링 조언**: 오늘 하루를 지혜롭게 보내기 위한 총평 및 실천 조언
4. 오늘 운세를 매우 상세하고 깊이 있게 제공하기 위해, 1,400자~1,800자 내외로 정성껏 길고 상세하게 작성하세요. (단, 디스코드 글자수 제한으로 인해 1,900자 초과 금지)

응답은 지정된 JSON 형식으로 작성해 주세요.
`;

  const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  const response = await ai.models.generateContent({
    model: modelName,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          content: { type: Type.STRING },
        },
        required: ["content"],
      },
    },
  });

  const rawText = response.text || "";
  let parsed: any;
  try {
    parsed = JSON.parse(rawText);
  } catch (e: any) {
    throw new Error(`Gemini 오늘 운세 응답 파싱 실패: ${e.message}`);
  }

  return {
    dateStr: today.dateStr,
    dayName: today.dayName,
    content: parsed.content || "",
    userInfo,
  };
}

const DIVIDER_MESSAGE = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";

/**
 * 7개의 요일별 운세를 7개의 독립된 디스코드 메시지로 순차 발송한 후,
 * 마지막에 구분선 메시지를 별도로 추가 발송합니다.
 */
export async function sendWeeklyFortuneMessages(
  target: TextChannel | ChatInputCommandInteraction,
  result: WeeklyFortuneResult
): Promise<void> {
  const ilganStr = result.userInfo.ilgan ? ` / 일간: ${result.userInfo.ilgan}` : "";
  const pillarsStr = result.userInfo.sajuPillars ? ` / 명식: ${result.userInfo.sajuPillars}` : "";
  const headerText =
    `${result.weekTitle}\n` +
    `👤 **사주 정보**: ${result.userInfo.birthYear} ${result.userInfo.birthMonth} ${result.userInfo.birthDay} (${result.userInfo.birthTime})${ilganStr}${pillarsStr} / ${result.userInfo.zodiacSign} [${result.userInfo.sajuFormat}]\n` +
    `----------------------------------------`;

  if (target instanceof ChatInputCommandInteraction) {
    // 슬래시 커맨드 인터랙션 대화형 발송
    // 첫 번째 메시지에 헤더 + 월요일 메시지 전달
    for (let i = 0; i < result.days.length; i++) {
      const day = result.days[i];
      let msgContent = day.content.trim();
      if (i === 0) {
        msgContent = `${headerText}\n\n${msgContent}`;
      }

      // 글자수 안전 차단 (2000자 초과시 자르기)
      if (msgContent.length > 1980) {
        msgContent = msgContent.substring(0, 1975) + "\n...";
      }

      if (i === 0) {
        if (target.deferred || target.replied) {
          await target.editReply({ content: msgContent });
        } else {
          await target.reply({ content: msgContent });
        }
      } else {
        await target.followUp({ content: msgContent });
      }

      // 메시지간 짧은 딜레이
      await new Promise((resolve) => setTimeout(resolve, 600));
    }

    // 월~일 7개 운세 메시지 출력이 모두 완료된 후 마지막에 추가 구분선 메시지 전송
    await target.followUp({ content: DIVIDER_MESSAGE });
  } else {
    // 디스코드 TextChannel 스케줄러 발송
    await target.send({ content: headerText });
    await new Promise((resolve) => setTimeout(resolve, 600));

    for (let i = 0; i < result.days.length; i++) {
      const day = result.days[i];
      let msgContent = day.content.trim();

      if (msgContent.length > 1980) {
        msgContent = msgContent.substring(0, 1975) + "\n...";
      }

      await target.send({ content: msgContent });
      await new Promise((resolve) => setTimeout(resolve, 600));
    }

    // 월~일 7개 운세 메시지 출력이 모두 완료된 후 마지막에 추가 구분선 메시지 전송
    await target.send({ content: DIVIDER_MESSAGE });
  }
}

/**
 * 오늘 운세 메시지를 발송합니다.
 */
export async function sendTodayFortuneMessage(
  target: TextChannel | ChatInputCommandInteraction,
  result: TodayFortuneResult
): Promise<void> {
  const ilganStr = result.userInfo.ilgan ? ` / 일간: ${result.userInfo.ilgan}` : "";
  const pillarsStr = result.userInfo.sajuPillars ? ` / 명식: ${result.userInfo.sajuPillars}` : "";
  const headerText =
    `🔮 **[오늘의 사주/운세] ${result.dateStr} (${result.dayName})**\n` +
    `👤 **사주 정보**: ${result.userInfo.birthYear} ${result.userInfo.birthMonth} ${result.userInfo.birthDay} (${result.userInfo.birthTime})${ilganStr}${pillarsStr} / ${result.userInfo.zodiacSign} [${result.userInfo.sajuFormat}]\n` +
    `----------------------------------------`;

  let msgContent = `${headerText}\n\n${result.content.trim()}`;

  if (msgContent.length > 1980) {
    msgContent = msgContent.substring(0, 1975) + "\n...";
  }

  if (target instanceof ChatInputCommandInteraction) {
    if (target.deferred || target.replied) {
      await target.editReply({ content: msgContent });
    } else {
      await target.reply({ content: msgContent });
    }
  } else {
    await target.send({ content: msgContent });
  }
}

/**
 * 스케줄러 또는 커맨드 수동 호출 시 주간 운세 파이프라인 전체를 실행하는 메인 함수
 */
export async function runWeeklyFortunePipeline(
  clientOrChannelId: any,
  interaction?: ChatInputCommandInteraction
): Promise<void> {
  const userInfo = await firebaseClient.getFortuneUserInfo();
  if (!userInfo) {
    throw new Error(
      "❌ 사주 및 별자리 정보가 설정되지 않았습니다. 먼저 `/운세정보` 커맨드로 입력해 주세요."
    );
  }

  const fortuneResult = await generateWeeklyFortune(userInfo);

  if (interaction) {
    await sendWeeklyFortuneMessages(interaction, fortuneResult);
  } else {
    const channelId = await firebaseClient.getFortuneChannel();
    if (!channelId) {
      throw new Error(
        "❌ 운세 알림 디스코드 채널이 설정되지 않았습니다. 먼저 `/운세설정` 커맨드로 지정해 주세요."
      );
    }

    const channel = await clientOrChannelId.channels.fetch(channelId);
    if (!channel || !(channel instanceof TextChannel)) {
      throw new Error(`❌ 유효한 텍스트 채널을 찾을 수 없습니다 (채널 ID: ${channelId})`);
    }

    await sendWeeklyFortuneMessages(channel, fortuneResult);
  }
}

/**
 * 스케줄러 또는 커맨드 수동 호출 시 오늘 운세 파이프라인 전체를 실행하는 메인 함수
 */
export async function runTodayFortunePipeline(
  clientOrChannelId?: any,
  interaction?: ChatInputCommandInteraction
): Promise<void> {
  const userInfo = await firebaseClient.getFortuneUserInfo();
  if (!userInfo) {
    throw new Error(
      "❌ 사주 및 별자리 정보가 설정되지 않았습니다. 먼저 `/운세정보` 커맨드로 입력해 주세요."
    );
  }

  const fortuneResult = await generateTodayFortune(userInfo);

  if (interaction) {
    await sendTodayFortuneMessage(interaction, fortuneResult);
  } else {
    const channelId = await firebaseClient.getFortuneChannel();
    if (!channelId) {
      throw new Error(
        "❌ 운세 알림 디스코드 채널이 설정되지 않았습니다. 먼저 `/운세설정` 커맨드로 지정해 주세요."
      );
    }

    const channel = await clientOrChannelId.channels.fetch(channelId);
    if (!channel || !(channel instanceof TextChannel)) {
      throw new Error(`❌ 유효한 텍스트 채널을 찾을 수 없습니다 (채널 ID: ${channelId})`);
    }

    await sendTodayFortuneMessage(channel, fortuneResult);
  }
}

