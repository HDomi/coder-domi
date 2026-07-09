import { ChatInputCommandInteraction, SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { Session } from "../db";
import { queueManager } from "../queue";
import { Command } from "../types";

export const forceStop: Command = {
  data: new SlashCommandBuilder()
    .setName("강제종료")
    .setDescription("현재 채널의 대기열 작업을 즉시 중지하고 대기 중인 모든 작업을 비웁니다."),
  requiresSession: true,
  async execute(interaction: ChatInputCommandInteraction, session?: Session) {
    const channelId = interaction.channelId;
    const result = queueManager.forceStop(channelId);

    if (!result.success) {
      return interaction.reply({
        content: "ℹ️ 현재 채널의 대기열에 실행 중이거나 대기 중인 작업이 없습니다.",
        ephemeral: true,
      });
    }

    const embed = new EmbedBuilder()
      .setTitle("⏹️ 작업 강제 종료 완료")
      .setColor(0xe74c3c) // 빨간색
      .setTimestamp();

    const descLines: string[] = [];
    if (result.runningCancelled) {
      descLines.push(`🚨 **현재 실행 중이던 작업이 중단되었습니다:**`);
      descLines.push(`> **요청:** ${result.runningRequest}`);
    }
    if (result.cancelledCount > 0) {
      descLines.push(`📋 대기 대기열의 **${result.cancelledCount}개** 작업이 모두 제거되었습니다.`);
    }

    embed.setDescription(descLines.length > 0 ? descLines.join("\n\n") : "모든 작업이 비워졌습니다.");

    return interaction.reply({ embeds: [embed] });
  },
};
