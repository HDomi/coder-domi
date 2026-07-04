# Node.js의 공식 이미지를 기반으로 합니다.
FROM node:20-alpine

# FFmpeg, Git 및 필요한 패키지 설치 (Alpine Linux - better-sqlite3 빌드용 빌드 도구 포함)
RUN apk add --no-cache \
    ffmpeg \
    git \
    python3 \
    make \
    g++

# Git 전역 사용자 설정
RUN git config --global user.email "hwangjae1139@gmail.com" && \
    git config --global user.name "CORDER_DOMI"

# 작업 디렉토리를 설정합니다.
WORKDIR /usr/src/app

# package.json과 package-lock.json을 복사합니다.
COPY package*.json ./

# 의존성을 설치합니다.
RUN npm install

# 애플리케이션 소스 코드를 복사합니다.
COPY . .

# TypeScript 빌드 실행
RUN npm run build

# 환경 변수를 설정합니다. (필요에 따라 수정)
ENV NODE_ENV=production
ENV DISCORD_TOKEN=$DISCORD_TOKEN
ENV CLIENT_ID=$CLIENT_ID
ENV PORT=5533

# 애플리케이션을 실행합니다. (dist/index.js 진입점)
CMD ["node", "dist/index.js"]