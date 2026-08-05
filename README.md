# coder-domi

디스코드 ChatOps 봇 — AI 블로그 포스팅 · 운세

Node.js 20 / TypeScript / Discord.js / Gemini / Firebase RTDB  
배포: Render Web Service

---

## 기능 요약

| 영역 | 내용 |
| --- | --- |
| 블로그 | Gemini로 에세이 생성 → Firebase 저장 → GitHub Pages 배포 트리거 |
| 운세 | 사주/별자리 기반 오늘·주간·검색 운세, 월요일 자동 발송 |
| 운영 | 업타임, 채팅삭제, 헬스체크 HTTP |

---

## 로컬 실행

```bash
pnpm install
cp .env.example .env   # 없으면 .env 직접 작성
pnpm dev               # 개발 (ts-node)
# 또는
pnpm build && pnpm start
```

### npm / pnpm 스크립트

| 명령 | 설명 |
| --- | --- |
| `pnpm install` | 의존성 설치 |
| `pnpm build` | TypeScript → `dist/` |
| `pnpm start` | `node dist/index.js` |
| `pnpm dev` | `ts-node src/index.ts` |
| `pnpm format` | Prettier 포맷 |
| `pnpm lint` | ESLint 수정 모드 |

---

## Discord 슬래시 커맨드

봇이 기동되면 `CLIENT_ID` 기준으로 애플리케이션 커맨드를 등록/갱신합니다.

### 블로그

| 커맨드 | 옵션 | 설명 |
| --- | --- | --- |
| `/포스팅` | — | 즉시 AI 블로그 포스팅 생성 후 Firebase 업로드 |
| `/자동포스팅` | `활성화` (boolean, 선택) | 자동 포스팅 스케줄러 on/off 조회·변경. 생략 시 토글 |
| `/포스팅중지` | — | 진행 중인 포스팅 파이프라인 즉시 중단 |
| `/포스트삭제` | — | 포스트 목록을 보여 주고 선택 삭제 (확인 버튼) |

### 운세

| 커맨드 | 옵션 | 설명 |
| --- | --- | --- |
| `/운세설정` | — | 현재 채널을 주간 운세 자동 알림 채널로 지정 |
| `/운세정보` | 아래 표 참고 | 사주/별자리 개인 정보 저장 |
| `/오늘운세` | — | 오늘(KST) 운세 즉시 생성 |
| `/운세받기` | — | 이번 주(월~일) 주간 운세 즉시 생성 |
| `/운세검색` | `검색어` (필수) | 키워드/질문 맞춤 운세 |

#### `/운세정보` 옵션

| 옵션 | 필수 | 설명 |
| --- | --- | --- |
| `연` | ✅ | 출생 연도 (예: `1995`) |
| `월` | ✅ | 출생 월 |
| `일` | ✅ | 출생 일 |
| `시` | ✅ | 출생 시 (`14:30`, `미시생`, `모름` 등) |
| `별자리` | ✅ | 예: `사자자리` |
| `사주형식` | — | `양력`(기본) / `음력` |
| `일간` | — | 예: `계수 癸水` |
| `사주명식` | — | 예: `무인년 정사월 계축일 기미시` |

### 유틸

| 커맨드 | 설명 |
| --- | --- |
| `/업타임` | 봇 프로세스 가동 시간 |
| `/채팅삭제` | 현재 채널 최근 14일 이내 메시지 bulk delete |

---

## 환경 변수

`.env` 또는 Render Environment Variables에 설정합니다.  
`firebase-key.json` / `.env`는 gitignore 대상입니다.

### 필수

| 변수 | 설명 |
| --- | --- |
| `DISCORD_TOKEN` | Discord 봇 토큰 |
| `CLIENT_ID` | Discord 애플리케이션(클라이언트) ID |
| `GEMINI_API_KEY` | Google AI (Gemini) API 키 — 글 생성·임베딩·운세 |
| `FIREBASE_DATABASE_URL` | Realtime Database URL (예: `https://….firebaseio.com/`) |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | **Admin SDK 서비스 계정 JSON** (또는 Base64). 웹 클라이언트 `apiKey` 설정 아님 |

서비스 계정 키: Firebase Console → 프로젝트 설정 → 서비스 계정 → **새 비공개 키 생성**

대안 (로컬):

| 변수 / 파일 | 설명 |
| --- | --- |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | 서비스 계정 JSON 파일 절대 경로 |
| `firebase-key.json` | 프로젝트 루트에 두면 자동 로드 |

### 권장 / 기능별

| 변수 | 필수 | 설명 |
| --- | --- | --- |
| `GIT_TOKEN` | 블로그 배포 시 | GitHub PAT — Pages 배포 Repository Dispatch |
| `DISCORD_BLOG_CHANNEL_ID` | 자동 알림 시 | 포스팅 완료 공지 채널 ID |
| `GEMINI_MODEL` | — | 운세 등 생성 모델 (기본: `gemini-2.5-flash`) |
| `PORT` | — | 헬스체크 HTTP 포트 (기본 `3000`, Render가 주입) |
| `NODE_ENV` | — | `production` 권장 |

---

## 코드 상수 (`src/config.ts`)

| 상수 | 값 | 용도 |
| --- | --- | --- |
| `BLOG_EMBED_MODEL` | `gemini-embedding-001` | 주제 중복 검사용 임베딩 |
| `GITHUB_OWNER` | `HDomi` | 블로그 레포 owner |
| `GITHUB_REPO` | `hdomi.github.io` | 배포 트리거 대상 레포 |

임베딩 출력 차원: `768` (`taskType: SEMANTIC_SIMILARITY`)

---

## 스케줄러 (KST)

| 일정 | cron | 동작 |
| --- | --- | --- |
| 매일 14:00 | `0 14 * * *` | 자동 블로그 포스팅 (`/자동포스팅`으로 비활성 가능) |
| 매주 월 07:30 | `30 7 * * 1` | 주간 운세 → `/운세설정` 채널로 발송 |
| 기동 시 | — | 14시 이후인데 당일 자동포스팅 누락이면 보정 실행 |

---

## HTTP 엔드포인트

Render Web Service용 Express 서버 (`PORT`).

| 경로 | 응답 |
| --- | --- |
| `GET /` | `OK` |
| `GET /health` | `{ status, uptime, discordReady }` |

---

## Firebase RTDB 경로

| 경로 | 용도 |
| --- | --- |
| `posts/{uuid}` | 블로그 포스트 |
| `config/isSchedulerActive` | 자동 포스팅 on/off |
| `config/lastAutoPostingDate` | 마지막 자동 포스팅 날짜 (KST) |
| `fortune/config/channelId` | 운세 알림 채널 |
| `fortune/config/userInfo` | 사주/별자리 개인정보 |
| `fortune/config/lastWeeklyFortuneWeek` | 마지막 주간 운세 주차 |

---

## 블로그 파이프라인 흐름

1. 과거 포스트 로드 (RAG)
2. Gemini로 주제 3개 피칭 (기술 없는 인간 상황 최소 1개, 상투 제목어 금지)
3. 임베딩 유사도로 중복 주제 필터 (0.8↑ 반려, 0.6↑ 맥락 참고)
4. 오프닝 모드·스탠스 랜덤 지정 후 에세이 작성 (`gemini-2.5-flash`)
5. 상투 오프닝 감지 시 1회 재작성
6. 제목+요약 임베딩 후 Firebase 저장
7. `GIT_TOKEN`으로 `hdomi.github.io` Repository Dispatch (`deploy_trigger`)
8. (설정 시) Discord 채널 공지

에세이 톤: AI 자기소개 오프닝 금지, 은유는 글당 1개, 분량 900~1500자 권장.
---

## Render 배포

1. [Render](https://render.com) → GitHub 가입
2. **New + → Web Service** 또는 Blueprint (`render.yaml`)
3. 레포 연결
4. 설정
   - **Build:** `pnpm install --frozen-lockfile && pnpm run build`
   - **Start:** `pnpm start`
   - **Health Check:** `/health`
   - **Node:** `20` (`engines.node: 20.x`)
5. 위 환경 변수 입력 후 배포

Free 플랜은 유휴 시 슬립될 수 있습니다. 봇을 항상 켜두려면 paid 인스턴스 또는 keep-alive가 필요합니다.

---

## 디렉터리 구조 (핵심)

```
src/
  index.ts          # Discord 봇 + 헬스체크
  commands/         # 슬래시 커맨드
  blogPipeline.ts   # 포스팅 파이프라인
  blogConfig.ts     # 프롬프트/톤
  fortune/          # 운세 생성
  firebase.ts       # RTDB Admin
  git.ts            # GitHub Pages 트리거
  scheduler.ts      # cron
  config.ts         # AI/GitHub 상수
  logger.ts         # 콘솔 파일 로깅
render.yaml         # Render Blueprint
```
