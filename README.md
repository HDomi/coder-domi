# coder-domi
디스코드 ChatOps 봇 (블로그 포스팅 · 운세)

## Render 배포

1. [Render](https://render.com)에서 GitHub로 가입
2. **New + → Web Service** (또는 Blueprint로 `render.yaml` 사용)
3. 이 레포지토리 연결
4. 설정 확인
   - **Build Command:** `pnpm install --frozen-lockfile && pnpm run build`
   - **Start Command:** `pnpm start`
   - **Health Check Path:** `/health`
5. Environment Variables 입력
   - `DISCORD_TOKEN`
   - `CLIENT_ID`
   - `GEMINI_API_KEY`
   - `GIT_TOKEN`
   - `FIREBASE_DATABASE_URL`
   - `FIREBASE_SERVICE_ACCOUNT_JSON`
   - `DISCORD_BLOG_CHANNEL_ID`
   - (선택) `GEMINI_MODEL`
6. **Create Web Service**

Free 플랜은 유휴 시 슬립될 수 있습니다. 봇을 항상 깨워두려면 paid 인스턴스 또는 외부 keep-alive를 사용하세요.
