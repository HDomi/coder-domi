import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import * as fs from "fs";
import { dbManager, Session } from "../db";
import { deleteRemoteRepo } from "../git";
import { Command } from "../types";

export const deleteApp: Command = {
  data: new SlashCommandBuilder()
    .setName("앱삭제")
    .setDescription(
      "현재 활성화된 개발 세션의 로컬 파일, GitHub 저장소 및 세션 정보를 영구 삭제합니다.",
    )
    .addStringOption((option) =>
      option
        .setName("앱이름")
        .setDescription(
          "삭제 확인을 위해 현재 세션의 앱 이름을 똑같이 입력하세요.",
        )
        .setRequired(true),
    ),
  requiresSession: true,
  async execute(interaction: ChatInputCommandInteraction, session?: Session) {
    const currentSession = session!;
    const inputAppName = interaction.options.getString("앱이름", true).trim();

    // 이중 확인 검사: 입력한 이름이 현재 세션의 앱 이름과 일치하는지 확인
    if (inputAppName !== currentSession.app_name) {
      return interaction.reply({
        content: `❌ 입력하신 앱 이름(\`${inputAppName}\`)이 현재 세션의 앱 이름(\`${currentSession.app_name}\`)과 다릅니다. 삭제가 취소되었습니다.`,
        ephemeral: true,
      });
    }

    const gitToken = process.env.GIT_TOKEN;
    if (!gitToken) {
      return interaction.reply({
        content:
          "❌ 서버 `.env` 파일에 `GIT_TOKEN` 설정이 누락되었습니다. GitHub Personal Access Token을 설정해 주세요.",
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    let githubDeleted = false;
    let githubErrorMsg = "";

    // 1. GitHub 원격 레포지토리 삭제 시도
    try {
      await deleteRemoteRepo(currentSession.app_name, gitToken);
      githubDeleted = true;
    } catch (error: any) {
      console.error("GitHub 레포지토리 삭제 오류:", error);
      githubErrorMsg = error.message;
    }

    // 2. 로컬 디렉토리 삭제 시도
    let localDeleted = false;
    try {
      if (fs.existsSync(currentSession.project_path)) {
        fs.rmSync(currentSession.project_path, { recursive: true, force: true });
      }
      localDeleted = true;
    } catch (error: any) {
      console.error("로컬 디렉토리 삭제 오류:", error);
    }

    // 3. SQLite 세션 말소
    let sessionDeleted = false;
    try {
      dbManager.deleteSession(interaction.channelId);
      sessionDeleted = true;
    } catch (error: any) {
      console.error("SQLite 세션 삭제 오류:", error);
    }

    // 결과 메시지 구성
    const statusLines = [
      `🧹 **[${currentSession.app_name}] 프로젝트 세션 말소 결과**`,
      localDeleted
        ? "✅ 로컬 프로젝트 디렉토리 삭제 완료"
        : "❌ 로컬 프로젝트 디렉토리 삭제 실패",
      sessionDeleted
        ? "✅ SQLite 세션 정보 삭제 완료"
        : "❌ SQLite 세션 정보 삭제 실패",
    ];

    if (githubDeleted) {
      statusLines.push("✅ GitHub 원격 저장소 삭제 완료");
    } else {
      statusLines.push(
        `⚠️ GitHub 원격 저장소 삭제 실패 (사유: ${githubErrorMsg})`,
      );
      statusLines.push(
        `   *(참고: GitHub 토큰에 \`delete_repo\` 권한이 없을 경우 삭제할 수 없습니다.)*`,
      );
    }

    await interaction.editReply(statusLines.join("\n"));
  },
};
