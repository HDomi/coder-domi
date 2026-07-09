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
        .setName("로컬모델사용")
        .setDescription("로컬 모델(Ollama) 사용 여부 (True: Ollama, False: Gemini)")
        .setRequired(false),
    ),
  requiresSession: true,
  requiresSpec: true,
  async execute(interaction: ChatInputCommandInteraction, session?: Session) {
    const currentSession = session!;
    const userRequest = interaction.options.getString("요청", true).trim();
    const localModelOpt = interaction.options.getBoolean("로컬모델사용");

    // 큐 매니저에 작업을 위임합니다.
    // 즉시 Embed 메시지로 응답하므로 deferReply()가 불필요합니다.
    await queueManager.enqueue(
      interaction.channelId,
      userRequest,
      localModelOpt !== null ? localModelOpt : undefined,
      currentSession,
      interaction,
    );
  },
};
