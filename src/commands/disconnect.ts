import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { dbManager, Session } from "../db";
import { Command } from "../types";

export const disconnect: Command = {
  data: new SlashCommandBuilder()
    .setName("연결끊기")
    .setDescription(
      "현재 채널의 활성화된 개발 세션 연결을 해제합니다. (로컬 파일 및 GitHub 레포는 안전하게 보존됩니다.)",
    ),
  requiresSession: true,
  async execute(interaction: ChatInputCommandInteraction, session?: Session) {
    // session is guaranteed to be defined due to requiresSession: true
    const currentSession = session!;
    try {
      dbManager.deleteSession(interaction.channelId);
      return interaction.reply(
        `✅ [${currentSession.app_name}] 프로젝트와의 개발 세션 연결이 성공적으로 해제되었습니다.\n(참고: 로컬 디렉토리 파일 및 GitHub 원격 레포지토리는 안전하게 보존되었습니다.)`,
      );
    } catch (error: any) {
      console.error(error);
      return interaction.reply(
        `❌ 개발 세션 연결 해제 중 오류가 발생했습니다: ${error.message}`,
      );
    }
  },
};
