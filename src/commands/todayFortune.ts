import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { Command } from "../types";
import { runTodayFortunePipeline } from "../fortune/pipeline";

export const todayFortune: Command = {
  data: new SlashCommandBuilder()
    .setName("오늘운세")
    .setDescription("오늘(KST 기준)의 사주 및 별자리 운세를 상세하게 생성하여 즉시 확인합니다."),
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    try {
      await runTodayFortunePipeline(null, interaction);
    } catch (error: any) {
      console.error("❌ 오늘 운세 생성을 진행하는 도중 오류가 발생했습니다:", error);
      const errMsg = `❌ 운세 생성 실패: ${error.message}`;
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(errMsg);
      } else {
        await interaction.reply({ content: errMsg, ephemeral: true });
      }
    }
  },
};
