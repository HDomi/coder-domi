import { Client, GatewayIntentBits, Interaction, SlashCommandBuilder, REST, Routes } from 'discord.js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { dbManager } from './db';
import { generateCodeUpdate } from './ollama';

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
  ],
});

// 미니 PC 인프라 내에서 대상 타겟 코드가 동기화되어 움직일 워크스페이스 정의
const WORKSPACE_DIR = path.resolve(process.env.HOME || '', 'discord-coder-domi/workspace');

if (!fs.existsSync(WORKSPACE_DIR)) {
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
}

// 등록할 슬래시 커맨드 명세 정의
const commands = [
  new SlashCommandBuilder()
    .setName('연결')
    .setDescription(`이 채널을 [${WORKSPACE_DIR}] 파이프라인 전용 실시간 개발 세션방으로 연결합니다.`),
  new SlashCommandBuilder()
    .setName('기획')
    .setDescription('프로젝트 기획 요구사항을 추가합니다.')
    .addStringOption(option =>
      option.setName('내용')
        .setDescription('추가할 기획 내용 (예: API 응답 지연 시 스켈레톤 UI 노출)')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('코딩')
    .setDescription('Ollama를 호출하여 특정 소스 코드를 기획서 내용으로 수정합니다.')
    .addStringOption(option =>
      option.setName('파일명')
        .setDescription('대상 소스 파일 경로 (예: src/views/MainView.vue)')
        .setRequired(true)
    )
].map(command => command.toJSON());

client.once('ready', async (readyClient) => {
  console.log(`🚀 Coder-Domi ChatOps 에이전트 가동 상태 정상: ${readyClient.user?.tag}`);

  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.CLIENT_ID;

  if (token && clientId) {
    try {
      const rest = new REST({ version: '10' }).setToken(token);
      console.log(`Started refreshing ${commands.length} application (/) commands.`);
      await rest.put(
        Routes.applicationCommands(clientId),
        { body: commands }
      );
      console.log(`Successfully reloaded ${commands.length} application (/) commands.`);
    } catch (error) {
      console.error('⚠️ 슬래시 커맨드 등록 중 오류 발생:', error);
    }
  } else {
    console.warn('⚠️ DISCORD_TOKEN 또는 CLIENT_ID가 .env에 설정되지 않아 슬래시 커맨드를 등록할 수 없습니다.');
  }
});

client.on('interactionCreate', async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, channelId } = interaction;

  // [명령어 1] 해당 채팅방을 가상 개발 세션으로 연결
  if (commandName === '연결') {
    dbManager.saveSession(channelId, WORKSPACE_DIR, '');
    return interaction.reply(`✅ 이 채널을 [${WORKSPACE_DIR}] 파이프라인 전용 실시간 개발 세션방으로 연결했습니다.`);
  }

  const session = dbManager.getSession(channelId);
  if (!session) {
    return interaction.reply({
      content: '❌ 활성화된 개발 세션이 없습니다. 먼저 `/연결` 명령어로 채널을 연결해 주세요.',
      ephemeral: true
    });
  }

  // [명령어 2] 대화 기록 한계를 깨는 무제한 기획 명세서 아카이빙
  if (commandName === '기획') {
    const newSpec = interaction.options.getString('내용', true).trim();

    // 기존 세션에 누적 적재
    const updatedSpec = session.spec_summary 
      ? `${session.spec_summary}\n- ${newSpec}`
      : `- ${newSpec}`;

    dbManager.saveSession(channelId, session.project_path, updatedSpec);

    // 트랙 A: 파일 시스템(SPEC.md) 실시간 생성 및 동기화 박제
    const specFilePath = path.join(WORKSPACE_DIR, 'SPEC.md');
    fs.writeFileSync(specFilePath, updatedSpec, 'utf-8');

    return interaction.reply(`📝 기획 명세가 추가되었습니다. 전체 기획 아카이브는 프로젝트 내부 SPEC.md 파일에 영구 릴리즈됩니다.`);
  }

  // [명령어 3] qwen2.5-coder 두뇌 가동 -> 파일 변조 -> Git Push 통합 파이프라인 트리거
  if (commandName === '코딩') {
    const fileName = interaction.options.getString('파일명', true).trim();
    const filePath = path.join(WORKSPACE_DIR, fileName);

    if (!fs.existsSync(filePath)) {
      return interaction.reply(`❌ 워크스페이스 하위에 [${fileName}] 파일이 감지되지 않습니다. Git Pull 상태를 체크하거나 경로를 확인하세요.`);
    }

    if (!session.spec_summary) {
      return interaction.reply('❌ 활성화된 기획 명세서가 부재합니다. 먼저 `/기획` 명령어로 프로젝트 골격을 설명해 주세요.');
    }

    // 디스코드는 3초 이내에 응답하지 않으면 타임아웃 에러가 발생하므로 디퍼 응답 상태로 전환합니다.
    await interaction.deferReply();

    try {
      // 1. 소스 코드 소싱
      const currentCode = fs.readFileSync(filePath, 'utf-8');

      // 2. 128K 롱컨텍스트 주입 및 코드 가공 생성
      const updatedCode = await generateCodeUpdate(session.spec_summary, currentCode, fileName);

      // 3. 파일 오버라이트 (수정 완료)
      fs.writeFileSync(filePath, updatedCode, 'utf-8');
      
      // 4. Git 셸 실행 디렉토리 스위칭
      process.chdir(WORKSPACE_DIR);
      
      // 5. Git Diff 트래킹 후 안전한 원격 push
      const hasChanges = execSync('git status --porcelain', { encoding: 'utf-8' }).trim();
      if (hasChanges) {
        execSync('git add .');
        execSync(`git commit -m "ChatOps: 디스코드 세션 기반 AI 자동 코드 반영 및 동기화"`);
        execSync('git push origin main');
        await interaction.editReply('🚀 AI 코드 인젝션 및 GitHub Actions 원격 Push 완료! 배포 파이프라인이 정상적으로 트리거되었습니다.');
      } else {
        await interaction.editReply('ℹ️ 변경 분석 결과 기존 소스 코드와 완전히 동일하여 무의미한 Push를 생략했습니다.');
      }

    } catch (error: any) {
      console.error(error);
      if (interaction.deferred) {
        await interaction.editReply(`❌ ChatOps 자동화 파이프라인 중단 에러: ${error.message}`);
      } else {
        await interaction.reply(`❌ ChatOps 자동화 파이프라인 중단 에러: ${error.message}`);
      }
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
