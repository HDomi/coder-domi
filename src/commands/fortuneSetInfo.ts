import { ChatInputCommandInteraction, SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { Command } from "../types";
import { firebaseClient } from "../firebase";

export const fortuneSetInfo: Command = {
  data: new SlashCommandBuilder()
    .setName("운세정보")
    .setDescription("운세 및 사주 분석에 필요한 개인 출생 및 별자리 정보를 설정합니다.")
    .addStringOption((option) =>
      option
        .setName("연")
        .setDescription("태어난 연도 (예: 1995년 또는 1995)")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("월")
        .setDescription("태어난 월 (예: 8월 또는 8)")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("일")
        .setDescription("태어난 일 (예: 15일 또는 15)")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("시")
        .setDescription("태어난 시 (시간 14:30 또는 '미시생', '자시', '모름' 등)")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("별자리")
        .setDescription("본인의 별자리 (예: 사자자리, 전갈자리, 물고기자리 등)")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("사주형식")
        .setDescription("사주 생년월일 구분 (양력 또는 음력, 기본값: 양력)")
        .setRequired(false)
        .addChoices(
          { name: "양력", value: "양력" },
          { name: "음력", value: "음력" }
        )
    )
    .addStringOption((option) =>
      option
        .setName("일간")
        .setDescription("사주 본인의 일간 (예: 계수 癸水, 경금 庚金, 갑목 甲木 등)")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("사주명식")
        .setDescription("본인의 사주 4주 8자 (예: 무인년 정사월 계축일 기미시)")
        .setRequired(false)
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    try {
      const birthYear = interaction.options.getString("연", true);
      const birthMonth = interaction.options.getString("월", true);
      const birthDay = interaction.options.getString("일", true);
      const birthTime = interaction.options.getString("시", true);
      const zodiacSign = interaction.options.getString("별자리", true);
      const sajuFormat = interaction.options.getString("사주형식") || "양력";
      const ilgan = interaction.options.getString("일간") || undefined;
      const sajuPillars = interaction.options.getString("사주명식") || undefined;

      const userInfo = {
        sajuFormat,
        birthYear,
        birthMonth,
        birthDay,
        birthTime,
        zodiacSign,
        ilgan,
        sajuPillars,
        updatedAt: new Date().toISOString(),
      };

      await firebaseClient.setFortuneUserInfo(userInfo);

      const fields: { name: string; value: string; inline?: boolean }[] = [
        { name: "📅 생년월일 (구분)", value: `${birthYear} ${birthMonth} ${birthDay} (${sajuFormat})`, inline: true },
        { name: "⏰ 출생 시각", value: birthTime, inline: true },
        { name: "⭐ 별자리", value: zodiacSign, inline: true },
      ];

      if (ilgan) {
        fields.push({ name: "☯️ 사주 일간", value: ilgan, inline: true });
      }
      if (sajuPillars) {
        fields.push({ name: "📜 사주 명식", value: sajuPillars, inline: false });
      }

      const embed = new EmbedBuilder()
        .setTitle("✨ 운세 및 사주 정보 저장 완료")
        .setDescription("입력하신 개인 운세 정보가 정상적으로 저장되었습니다.")
        .setColor(0x3498db)
        .addFields(fields)
        .setFooter({ text: "이제 /운세받기 명령어나 매주 월요일 7:30 스케줄러로 운세를 받아보실 수 있습니다." })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error: any) {
      console.error("❌ 운세 정보 저장 실패:", error);
      await interaction.editReply(`❌ 운세 정보 저장 중 오류가 발생했습니다: ${error.message}`);
    }
  },
};
