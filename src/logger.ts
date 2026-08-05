import * as fs from "fs";
import * as path from "path";

const LOG_DIR = path.resolve(__dirname, "../logs");
const LOG_FILE = path.join(LOG_DIR, "bot.log");

// 로그 디렉토리 생성
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// 오리지널 콘솔 함수 백업
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;
const originalInfo = console.info;

function getTimestamp(): string {
  return new Date().toISOString();
}

function writeToFile(level: string, message: string) {
  try {
    const logMessage = `[${getTimestamp()}] [${level}] ${message}\n`;
    fs.appendFileSync(LOG_FILE, logMessage, "utf-8");
  } catch (e) {
    originalError("로그 파일에 기록하는 데 실패했습니다:", e);
  }
}

function formatArgs(args: any[]): string {
  return args
    .map((arg) => {
      if (typeof arg === "object") {
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    })
    .join(" ");
}

export function initLogger() {
  console.log = (...args: any[]) => {
    const message = formatArgs(args);
    originalLog(...args);
    writeToFile("INFO", message);
  };

  console.error = (...args: any[]) => {
    const message = formatArgs(args);
    originalError(...args);
    writeToFile("ERROR", message);
  };

  console.warn = (...args: any[]) => {
    const message = formatArgs(args);
    originalWarn(...args);
    writeToFile("WARN", message);
  };

  console.info = (...args: any[]) => {
    const message = formatArgs(args);
    originalInfo(...args);
    writeToFile("INFO", message);
  };
}
