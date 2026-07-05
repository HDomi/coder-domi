import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import * as fs from "fs";
import * as path from "path";
import { dbManager } from "../db";
import { WORKSPACE_DIR } from "../utils";
import { Command } from "../types";

export const connect: Command = {
  data: new SlashCommandBuilder()
    .setName("연결")
    .setDescription("이 채널을 특정 애플리케이션의 개발 세션방으로 연결합니다.")
    .addStringOption((option) =>
      option
        .setName("앱이름")
        .setDescription(
          "생성하거나 연결할 애플리케이션 이름 (영어/숫자/대시만 가능)",
        )
        .setRequired(true),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const appName = interaction.options.getString("앱이름", true).trim();

    // 영어, 숫자, 대시(-) 문자만 포함하도록 방어적 이름 체크
    if (!/^[a-zA-Z0-9-_]+$/.test(appName)) {
      return interaction.reply({
        content:
          "❌ 앱 이름은 영문, 숫자, 대시(-), 언더바(_)만 사용할 수 있습니다.",
        ephemeral: true,
      });
    }

    const projectPath = path.join(WORKSPACE_DIR, appName);
    if (!fs.existsSync(projectPath)) {
      fs.mkdirSync(projectPath, { recursive: true });
    }

    dbManager.saveSession(interaction.channelId, projectPath, "", appName);
    return interaction.reply(
      `✅ 이 채널을 [${appName}] 프로젝트 전용 실시간 개발 세션방으로 연결했습니다.\n경로: \`${projectPath}\``,
    );
  },
};
