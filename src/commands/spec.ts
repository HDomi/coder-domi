import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import * as fs from "fs";
import * as path from "path";
import { Session } from "../db";
import { getPuppeteerExecutablePath } from "../utils";
import { Command } from "../types";

export const spec: Command = {
  data: new SlashCommandBuilder()
    .setName("스펙")
    .setDescription(
      "현재 세션의 기획 명세서(SPEC.md)를 이미지 형태로 예쁘게 렌더링하여 출력합니다.",
    ),
  requiresSession: true,
  async execute(interaction: ChatInputCommandInteraction, session?: Session) {
    const currentSession = session!;
    await interaction.deferReply();
    try {
      const specFilePath = path.join(currentSession.project_path, "SPEC.md");
      if (!fs.existsSync(specFilePath)) {
        await interaction.editReply(
          "❌ 현재 세션에 생성된 기획 명세서(SPEC.md)가 없습니다. 먼저 `/기획` 명령어로 기획을 등록해 주세요.",
        );
        return;
      }

      const specContent = fs.readFileSync(specFilePath, "utf-8");
      if (!specContent.trim()) {
        await interaction.editReply("ℹ️ 기획 명세서(SPEC.md)가 비어 있습니다.");
        return;
      }

      // marked를 사용하여 마크다운을 HTML로 파싱
      const { marked } = await import("marked");
      const htmlBody = await marked.parse(specContent);

      // GitHub 스타일 Markdown CSS 템플릿 구성
      const htmlTemplate = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.5.1/github-markdown.min.css">
        <style>
          body {
            background-color: #0d1117;
            padding: 30px;
            margin: 0;
            display: flex;
            justify-content: center;
          }
          .markdown-body {
            box-sizing: border-box;
            min-width: 200px;
            max-width: 800px;
            width: 100%;
            padding: 45px;
            background-color: #0d1117;
            border: 1px solid #30363d;
            border-radius: 6px;
            color: #c9d1d9;
          }
          @media (max-width: 767px) {
            .markdown-body {
              padding: 15px;
            }
          }
        </style>
      </head>
      <body>
        <article class="markdown-body">
          ${htmlBody}
        </article>
      </body>
      </html>
      `;

      // puppeteer-core를 사용하여 스크린샷 렌더링
      const puppeteer = await import("puppeteer-core");

      const executablePath = getPuppeteerExecutablePath();

      const browser = await puppeteer.launch({
        executablePath,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
        ],
        headless: true,
      });

      const page = await browser.newPage();
      await page.setContent(htmlTemplate, { waitUntil: "networkidle0" });

      // 페이지 크기를 콘텐츠 영역에 맞춰 설정
      const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
      const bodyWidth = await page.evaluate(() => document.body.scrollWidth);

      await page.setViewport({
        width: Math.max(bodyWidth, 900),
        height: Math.max(bodyHeight, 100),
        deviceScaleFactor: 2, // 스크린샷 선명도 확보
      });

      const element = await page.$(".markdown-body");
      let imageBuffer: Buffer;
      if (element) {
        imageBuffer = (await element.screenshot({ type: "png" })) as Buffer;
      } else {
        imageBuffer = (await page.screenshot({
          fullPage: true,
          type: "png",
        })) as Buffer;
      }

      await browser.close();

      await interaction.editReply({
        content: `📋 **[${currentSession.app_name}] 프로젝트 기획 명세서 (SPEC.md)**`,
        files: [
          {
            attachment: imageBuffer,
            name: "spec_sheet.png",
          },
        ],
      });
    } catch (error: any) {
      console.error(error);
      await interaction.editReply(
        `❌ SPEC.md 이미지 렌더링 실패: ${error.message}`,
      );
    }
  },
};
