import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { Command } from "../types";
import { runFortuneSearchPipeline } from "../fortune/pipeline";

export const fortuneSearch: Command = {
  data: new SlashCommandBuilder()
    .setName("운세검색")
    .setDescription("궁금한 키워드나 질문(예: 이직, 취업, 연애, 재물 등)에 대한 맞춤형 운세를 검색합니다.")
    .addStringOption((option) =>
      option
        .setName("검색어")
        .setDescription("조회하고 싶은 운세 주제, 키워드 또는 질문")
        .setRequired(true)
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    try {
      const query = interaction.options.getString("검색어", true);
      await runFortuneSearchPipeline(query, interaction);
    } catch (error: any) {
      console.error("❌ 운세 검색을 진행하는 도중 오류가 발생했습니다:", error);
      const errMsg = `❌ 운세 검색 실패: ${error.message}`;
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(errMsg);
      } else {
        await interaction.reply({ content: errMsg, ephemeral: true });
      }
    }
  },
};
