import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { Session } from "../db";
import { setupAndPushRepo } from "../git";
import { Command } from "../types";

export const apply: Command = {
  data: new SlashCommandBuilder()
    .setName("적용")
    .setDescription(
      "현재 프로젝트의 변경 코드를 GitHub 원격 레포지토리에 반영(Push)합니다.",
    ),
  requiresSession: true,
  async execute(interaction: ChatInputCommandInteraction, session?: Session) {
    const currentSession = session!;
    const gitToken = process.env.GIT_TOKEN;
    if (!gitToken) {
      return interaction.reply({
        content:
          "❌ 서버 `.env` 파일에 `GIT_TOKEN` 설정이 누락되었습니다. GitHub Personal Access Token을 설정해 주세요.",
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    try {
      const repoUrl = await setupAndPushRepo(
        currentSession.project_path,
        currentSession.app_name,
        gitToken,
      );
      await interaction.editReply(
        `🚀 GitHub 레포지토리 배포 완료!\n원격 저장소 주소: ${repoUrl}`,
      );
    } catch (error: any) {
      console.error(error);
      await interaction.editReply(
        `❌ GitHub 동기화 적용 실패: ${error.message}`,
      );
    }
  },
};
