import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import * as fs from "fs";
import * as path from "path";
import { dbManager, Session } from "../db";
import { Command } from "../types";

export const plan: Command = {
  data: new SlashCommandBuilder()
    .setName("기획")
    .setDescription("프로젝트 기획 요구사항을 추가합니다.")
    .addStringOption((option) =>
      option
        .setName("내용")
        .setDescription("추가할 기획 내용 (예: API 응답 지연 시 스켈레톤 UI 노출)")
        .setRequired(true),
    ),
  requiresSession: true,
  async execute(interaction: ChatInputCommandInteraction, session?: Session) {
    const currentSession = session!;
    const newSpec = interaction.options.getString("내용", true).trim();

    // 기존 세션에 누적 적재
    const updatedSpec = currentSession.spec_summary
      ? `${currentSession.spec_summary}\n- ${newSpec}`
      : `- ${newSpec}`;

    dbManager.saveSession(
      interaction.channelId,
      currentSession.project_path,
      updatedSpec,
      currentSession.app_name,
    );

    // 트랙 A: 파일 시스템(SPEC.md) 실시간 생성 및 동기화 박제
    const specFilePath = path.join(currentSession.project_path, "SPEC.md");
    fs.writeFileSync(specFilePath, updatedSpec, "utf-8");

    return interaction.reply(
      `📝 기획 명세가 추가되었습니다. 전체 기획 아카이브는 프로젝트 내부 SPEC.md 파일에 영구 릴리즈됩니다.`,
    );
  },
};
