import { GoogleGenAI, Type } from "@google/genai";
import { TextChannel, ChatInputCommandInteraction } from "discord.js";
import { firebaseClient, FortuneUserInfo } from "../firebase";
import { WeeklyFortuneResult, DayFortune } from "./types";

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

  const daysInfoPrompt = days
    .map((d) => `- ${d.dateStr} (${d.dayName})`)
    .join("\n");

  const prompt = `
당신은 동양의 사주명리학과 서양의 별자리 점성술을 집대성한 대한민국 최고의 운세 명인입니다.
아래 사용자의 사주 및 별자리 정보와 이번 주 날짜 범위를 바탕으로, 이번 주 월요일부터 일요일까지 7일간의 요일별 운세를 아주 상세하고 깊이 있게 작성해 주세요.

[사용자 사주 및 별자리 정보]
- 사주 구분: ${userInfo.sajuFormat || "양력"}
- 출생연도: ${userInfo.birthYear}
- 출생월: ${userInfo.birthMonth}
- 출생일: ${userInfo.birthDay}
- 출생시: ${userInfo.birthTime}
- 별자리: ${userInfo.zodiacSign}

[이번 주 요일 목록]
${daysInfoPrompt}

[작성 가이드라인]
1. 월요일부터 일요일까지 7일 각 날짜에 대해 작성합니다.
2. 디스코드 2,000자 글자 수 제한을 감안하여, 각 요일별 내용(content)은 디스코드 마크다운 서식을 활용하여 풍부하고 매끄럽게 작성해 주세요.
3. 각 요일별 운세 content에는 반드시 아래 항목들이 빠짐없이 상세하게 포함되어야 합니다:
   - 📅 **[날짜 및 요일 헤더]**
   - 💼 **직장 & 학업 / 사업운**: 성과, 협업, 업무 주의사항, 추진 전략
   - 💖 **연애 & 대인관계운**: 연인/솔로 관계 흐름, 감정 상태, 대인관계 조언
   - 💰 **금전 & 재물운**: 지출/수입 흐름, 투자/재물 기회, 주의해야 할 지출
   - 🍀 **행운 요소**: 행운의 색상, 행운의 숫자, 행운의 아이템, 행운의 방위
   - 💡 **오늘의 총평 및 힐링 조언**: 마음가짐 및 하루를 다스리는 팁
4. 각 요일의 content는 디스코드 메시지 1개로 발송되므로, 읽는 이가 감동과 몰입감을 느낄 수 있도록 1,200자~1,800자 내외로 정성껏 길고 상세하게 작성하세요. (단, 1,900자 초과 금지)

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
 * 7개의 요일별 운세를 7개의 독립된 디스코드 메시지로 순차 발송합니다.
 */
export async function sendWeeklyFortuneMessages(
  target: TextChannel | ChatInputCommandInteraction,
  result: WeeklyFortuneResult
): Promise<void> {
  const headerText =
    `${result.weekTitle}\n` +
    `👤 **사주 정보**: ${result.userInfo.birthYear} ${result.userInfo.birthMonth} ${result.userInfo.birthDay} (${result.userInfo.birthTime}) / ${result.userInfo.zodiacSign} [${result.userInfo.sajuFormat}]\n` +
    `----------------------------------------`;

  if (target instanceof ChatInputCommandInteraction) {
    // 슬래시 커맨드 인터랙션 대화형 발송
    // 첫 번째 메시지에 헤더 + 월요일 메시지 전달
    for (let i = 0; i < result.days.length; i++) {
      const day = result.days[i];
      let msgContent = day.content;
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
  } else {
    // 디스코드 TextChannel 스케줄러 발송
    await target.send({ content: headerText });
    await new Promise((resolve) => setTimeout(resolve, 600));

    for (let i = 0; i < result.days.length; i++) {
      const day = result.days[i];
      let msgContent = day.content;

      if (msgContent.length > 1980) {
        msgContent = msgContent.substring(0, 1975) + "\n...";
      }

      await target.send({ content: msgContent });
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }
}

/**
 * 스케줄러 또는 커맨드 수동 호출 시 운세 파이프라인 전체를 실행하는 메인 함수
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
