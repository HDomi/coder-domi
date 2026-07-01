import { Client, GatewayIntentBits, Message } from 'discord.js';
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
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// 미니 PC 인프라 내에서 대상 타겟 코드가 동기화되어 움직일 워크스페이스 정의
const WORKSPACE_DIR = path.resolve(process.env.HOME || '', 'discord-coder-domi/workspace');

if (!fs.existsSync(WORKSPACE_DIR)) {
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
}

client.once('ready', () => {
  console.log(`🚀 Coder-Domi ChatOps 에이전트 가동 상태 정상: ${client.user?.tag}`);
});

client.on('messageCreate', async (message: Message) => {
  if (message.author.bot) return;

  const channelId = message.channel.id;
  const content = message.content.trim();

  // [명령어 1] 해당 채팅방을 가상 개발 세션으로 락온(Lock-on)
  if (content.startsWith('!연결')) {
    dbManager.saveSession(channelId, WORKSPACE_DIR, '');
    return message.reply(`✅ 이 채널을 [${WORKSPACE_DIR}] 파이프라인 전용 실시간 개발 세션방으로 연결했습니다.`);
  }

  const session = dbManager.getSession(channelId);
  if (!session) return; // 활성화되지 않은 일반 채팅방 트래픽은 무시

  // [명령어 2] 대화 기록 한계를 깨는 무제한 기획 명세서 아카이빙
  if (content.startsWith('!기획')) {
    const newSpec = content.replace('!기획', '').trim();
    if (!newSpec) return message.reply('❌ 추가할 기획 내용을 입력하세요. (예: !기획 API 응답 지연 시 스켈레톤 UI 노출)');

    // 기존 세션에 누적 적재
    const updatedSpec = session.spec_summary 
      ? `${session.spec_summary}\n- ${newSpec}`
      : `- ${newSpec}`;

    dbManager.saveSession(channelId, session.project_path, updatedSpec);

    // 트랙 A: 파일 시스템(SPEC.md) 실시간 생성 및 동기화 박제
    const specFilePath = path.join(WORKSPACE_DIR, 'SPEC.md');
    fs.writeFileSync(specFilePath, updatedSpec, 'utf-8');

    return message.reply(`📝 기획 명세가 추가되었습니다. 전체 기획 아카이브는 프로젝트 내부 SPEC.md 파일에 영구 릴리즈됩니다.`);
  }

  // [명령어 3] qwen2.5-coder 두뇌 가동 -> 파일 변조 -> Git Push 통합 파이프라인 트리거
  if (content.startsWith('!코딩')) {
    const fileName = content.replace('!코딩', '').trim();
    if (!fileName) return message.reply('❌ 대상 소스 파일 경로를 입력하세요. (예: !코딩 src/views/MainView.vue)');

    const filePath = path.join(WORKSPACE_DIR, fileName);
    if (!fs.existsSync(filePath)) {
      return message.reply(`❌ 워크스페이스 하위에 [${fileName}] 파일이 감지되지 않습니다. Git Pull 상태를 체크하거나 경로를 확인하세요.`);
    }

    if (!session.spec_summary) {
      return message.reply('❌ 활성화된 기획 명세서가 부재합니다. 먼저 !기획 명령어로 프로젝트 골격을 설명해 주세요.');
    }

    const statusMessage = await message.reply('🧠 미니 PC 내부의 qwen2.5-coder:14b 정밀 추론 엔진 가동 중... 전체 기획 맥락과 소스 코드를 바인딩하고 있습니다.');

    try {
      // 1. 소스 코드 소싱
      const currentCode = fs.readFileSync(filePath, 'utf-8');

      // 2. 128K 롱컨텍스트 주입 및 코드 가공 생성
      const updatedCode = await generateCodeUpdate(session.spec_summary, currentCode, fileName);

      // 3. 파일 오버라이트 (수정 완료)
      fs.writeFileSync(filePath, updatedCode, 'utf-8');
      await statusMessage.edit('✅ AI 코드 인젝션 완료! 소스 검증 및 Git 인프라 자동화를 트리거합니다.');

      // 4. Git 셸 실행 디렉토리 스위칭
      process.chdir(WORKSPACE_DIR);
      
      // 5. Git Diff 트래킹 후 안전한 원격 push
      const hasChanges = execSync('git status --porcelain', { encoding: 'utf-8' }).trim();
      if (hasChanges) {
        execSync('git add .');
        execSync(`git commit -m "ChatOps: 디스코드 세션 기반 AI 자동 코드 반영 및 동기화"`);
        execSync('git push origin main');
        await message.reply('🚀 GitHub Actions 원격 Push 및 배포 파이프라인이 정상적으로 트리거되었습니다!');
      } else {
        await message.reply('ℹ️ 변경 분석 결과 기존 소스 코드와 완전히 동일하여 무의미한 Push를 생략했습니다.');
      }

    } catch (error: any) {
      console.error(error);
      await message.reply(`❌ ChatOps 자동화 파이프라인 중단 에러: ${error.message}`);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
