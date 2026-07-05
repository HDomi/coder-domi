import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { getOllamaLogs } from "../logger";
import { Command } from "../types";

export const logs: Command = {
  data: new SlashCommandBuilder()
    .setName("로그")
    .setDescription("현재 가동 중인 봇의 최근 100줄 로그를 출력합니다."),
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();
    try {
      const logLines = getOllamaLogs(100);
      if (!logLines.trim()) {
        await interaction.editReply("ℹ️ 기록된 Ollama 로그가 없습니다.");
        return;
      }

      const codeBlockFormatted = `\`\`\`\n${logLines}\n\`\`\``;
      if (codeBlockFormatted.length > 2000) {
        const buffer = Buffer.from(logLines, "utf-8");
        await interaction.editReply({
          content:
            "📋 Ollama 최근 100줄 로그의 용량이 2000자를 초과하여 텍스트 파일로 첨부합니다.",
          files: [
            {
              attachment: buffer,
              name: "ollama_recent_logs.txt",
            },
          ],
        });
      } else {
        await interaction.editReply(codeBlockFormatted);
      }
    } catch (error: any) {
      console.error(error);
      await interaction.editReply(
        `❌ Ollama 로그를 불러오는 중 에러가 발생했습니다: ${error.message}`,
      );
    }
  },
};
