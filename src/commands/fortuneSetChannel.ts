import { ChatInputCommandInteraction, SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { Command } from "../types";
import { firebaseClient } from "../firebase";

export const fortuneSetChannel: Command = {
  data: new SlashCommandBuilder()
    .setName("운세설정")
    .setDescription("현재 명령을 입력한 채널을 주간 운세 자동 알림 채널로 설정합니다."),
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    try {
      const channelId = interaction.channelId;
      await firebaseClient.setFortuneChannel(channelId);

      const embed = new EmbedBuilder()
        .setTitle("🔮 주간 운세 알림 채널 설정 완료")
        .setDescription(
          `이 채널(<#${channelId}>)이 **매주 월요일 아침 7시 30분(KST)** 정기 주간 운세 알림 채널로 지정되었습니다.`
        )
        .setColor(0x9b59b6)
        .addFields(
          { name: "📍 설정 채널 ID", value: channelId, inline: true },
          { name: "⏰ 정기 발송 시각", value: "매주 월요일 오전 07:30 (KST)", inline: true }
        )
        .setFooter({ text: "다른 채널에서 /운세설정 실행 시 대상 채널이 변경됩니다." })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error: any) {
      console.error("❌ 운세 채널 설정 실패:", error);
      await interaction.editReply(`❌ 운세 알림 채널 설정 중 오류가 발생했습니다: ${error.message}`);
    }
  },
};
