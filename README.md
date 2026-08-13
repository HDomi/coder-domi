# coder-domi

디스코드 ChatOps 봇 — AI 블로그 포스팅 · 운세

Node.js 20 / TypeScript / Discord.js / Gemini / Firebase RTDB  
배포: Render Web Service

---

## 기능 요약

| 영역 | 내용 |
| --- | --- |
| 블로그 | Gemini로 글 생성(에세이·개발기·기술 가이드) → Firebase 저장 → GitHub Pages 배포 트리거 |
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
| `/포스팅` | `장르` (선택: 에세이·개발기·기술 가이드) | 즉시 AI 블로그 포스팅 생성 후 Firebase 업로드. 생략 시 요일 배정 장르 |
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
| `ACTIVE_GENRE_PRESET` | `approval` | 요일별 장르 배정 프리셋 선택 |

임베딩 출력 차원: `768` (`taskType: SEMANTIC_SIMILARITY`)

---

## 글 장르

| 장르 | 화자·목적 | 소재 |
| --- | --- | --- |
| `essay` | AI 화자의 성찰 에세이 | 없음 (주제 피칭만) |
| `devlog` | 개발자 시점 작업 기록 | 공개 저장소 README·커밋 |
| `guide` | 검색 유입용 기술 가이드 | 공개 저장소의 기술 스택 |

### 요일 배정 프리셋 (`GENRE_SCHEDULE_PRESETS`)

| 프리셋 | 월 | 화 | 수 | 목 | 금 | 토·일 |
| --- | --- | --- | --- | --- | --- | --- |
| `approval` | guide | devlog | guide | devlog | essay | 휴재 |
| `balanced` | guide | devlog | essay | devlog | essay | 휴재 |

프리셋 전환은 `src/config.ts`의 `ACTIVE_GENRE_PRESET` 한 줄만 바꾸면 된다.

### 소재 수집 보안 원칙 (`DEVLOG_CONFIG`)

devlog·guide는 GitHub에서 소재를 가져오므로 비공개 정보가 프롬프트로 나가지 않도록 4단계로 막는다.

| 단계 | 동작 |
| --- | --- |
| 화이트리스트 | `allowedRepos`에 명시한 저장소만 수집. 자동 탐색 없음 |
| 공개 여부 재확인 | GitHub API의 `private` 필드를 매번 확인, `true`거나 확인 불가면 수집 중단 |
| 경로 차단 | `.env`·`*key*.json`·`*.pem`·`secret`·`credential` 등은 파일 목록에서 제거 |
| 자격 증명 스캔 | API 키·토큰·개인키 패턴이 걸리면 해당 커밋/README를 통째로 폐기 |

파일 본문과 diff는 가져오지 않는다. 수집 범위는 README·커밋 메시지·변경 파일 경로뿐이며, 커밋 메시지의 이메일은 마스킹된다.

---

## 스케줄러 (KST)

| 일정 | cron | 동작 |
| --- | --- | --- |
| 평일 14:00 | `0 14 * * 1-5` | 자동 블로그 포스팅 (`/자동포스팅`으로 비활성 가능) |
| 매주 월 07:30 | `30 7 * * 1` | 주간 운세 → `/운세설정` 채널로 발송 |
| 기동 시 | — | 14시 이후인데 당일 자동포스팅 누락이면 보정 실행 (휴재일 제외) |

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
2. 장르 확정 — 커맨드 인자 > 요일 배정 순. devlog·guide면 공개 저장소 소재 수집
3. Gemini로 주제 3개 피칭 (장르별 프롬프트)
4. 임베딩 유사도로 중복 주제 필터 (0.8↑ 반려, 0.6↑ 맥락 참고)
5. 본문 작성 (`gemini-2.5-flash`, 온도는 essay 0.95 / devlog 0.8 / guide 0.7)
6. 상투 오프닝 감지 시 1회 재작성 (essay 전용)
7. 제목+요약 임베딩 후 Firebase 저장 (`genre`·`sourceRepo` 포함)
8. `GIT_TOKEN`으로 `hdomi.github.io` Repository Dispatch (`deploy_trigger`)
9. (설정 시) Discord 채널 공지

소재 수집에 실패하면 essay로 자동 대체해 포스팅이 중단되지 않는다.

장르별 톤:

| 장르 | 규칙 |
| --- | --- |
| `essay` | AI 자기소개 오프닝 금지, 은유는 글당 1개, 900~1500자 |
| `devlog` | 소재에 없는 사실(수치·기간·버전) 생성 금지, 시행착오 서술, 1200~2000자 |
| `guide` | 첫 문단에 결론, 코드 블록 필수, 불확실한 내용 단정 금지, 1500~2500자 |
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
  blogConfig.ts     # 장르별 프롬프트/톤
  blogSources.ts    # 공개 저장소 소재 수집 + 자격 증명 차단
  fortune/          # 운세 생성
  firebase.ts       # RTDB Admin
  git.ts            # GitHub Pages 트리거
  scheduler.ts      # cron
  config.ts         # AI/GitHub 상수
  logger.ts         # 콘솔 파일 로깅
render.yaml         # Render Blueprint
```
