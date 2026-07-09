import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { Command } from "../types";

const startedAt = Date.now();

export const uptime: Command = {
  data: new SlashCommandBuilder()
    .setName("업타임")
    .setDescription("코더도미 봇의 가동 시간을 확인합니다."),
  async execute(interaction: ChatInputCommandInteraction) {
    const elapsed = Date.now() - startedAt;
    const seconds = Math.floor(elapsed / 1000) % 60;
    const minutes = Math.floor(elapsed / 60000) % 60;
    const hours = Math.floor(elapsed / 3600000) % 24;
    const days = Math.floor(elapsed / 86400000);

    const parts: string[] = [];
    if (days > 0) parts.push(`${days}일`);
    if (hours > 0) parts.push(`${hours}시간`);
    if (minutes > 0) parts.push(`${minutes}분`);
    parts.push(`${seconds}초`);

    const embed = new EmbedBuilder()
      .setTitle("🟢 코더도미 가동 상태")
      .setColor(0x2ecc71)
      .addFields(
        { name: "⏱️ 업타임", value: parts.join(" "), inline: true },
        { name: "🕐 시작 시각", value: `<t:${Math.floor(startedAt / 1000)}:F>`, inline: true },
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
