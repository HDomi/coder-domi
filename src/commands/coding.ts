import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { Session } from "../db";
import { queueManager } from "../queue";
import { Command } from "../types";

export const coding: Command = {
  data: new SlashCommandBuilder()
    .setName("코딩")
    .setDescription(
      "AI를 통해 기획 명세 및 대화 내용을 분석해 자동으로 파일을 생성/수정합니다.",
    )
    .addStringOption((option) =>
      option
        .setName("요청")
        .setDescription("실행할 코딩 작업 지시 (예: 로그인 버튼 컴포넌트 추가)")
        .setRequired(true),
    )
    .addBooleanOption((option) =>
      option
        .setName("gemini사용")
        .setDescription("Gemini 모델 사용 여부 (True: Gemini, False: Ollama (로컬 기본값))")
        .setRequired(false),
    ),
  requiresSession: true,
  requiresSpec: true,
  async execute(interaction: ChatInputCommandInteraction, session?: Session) {
    const currentSession = session!;
    const userRequest = interaction.options.getString("요청", true).trim();
    const useGemini = interaction.options.getBoolean("gemini사용");
    
    // 기본값은 로컬 모델(Ollama) 사용이므로, gemini사용이 true가 아니면 localModelOpt = true
    const localModelOpt = useGemini === true ? false : true;

    // 큐 매니저에 작업을 위임합니다.
    // 즉시 Embed 메시지로 응답하므로 deferReply()가 불필요합니다.
    await queueManager.enqueue(
      interaction.channelId,
      userRequest,
      localModelOpt,
      currentSession,
      interaction,
    );
  },
};
