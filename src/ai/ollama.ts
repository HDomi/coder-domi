import { Phase1Result, Phase2Result } from "./types";
import { Agent } from "undici";

// Gemini 호환을 위해 유지하는 시스템 프롬프트
export const systemPromptSelect = `너는 매우 영리하고 정확한 ChatOps 파일 분석 도우미다.
제공된 [기획 명세서]와 [사용자의 코딩 요청], 그리고 [전체 파일 경로 목록]을 분석하여, 사용자의 요청을 해결하기 위해 수정하거나 반드시 참조(분석)해야 하는 핵심 파일 경로들을 골라내라.
추가로, 만약 요청을 수행하기 위해 프로젝트/패키지 생성 등 사전에 실행해야 하는 쉘 명령어가 있다면 함께 명시해라.

출력은 반드시 다음과 같은 JSON 포맷이어야 한다. 설명이나 자연어는 일절 포함하지 마라.
JSON 포맷 예시:
{
  "setupCommands": [
    "npx -y create-vite@latest . --template vue-ts",
    "npm install"
  ],
  "relevantFiles": [
    "src/components/LoginButton.vue",
    "src/store/auth.js"
  ]
}

주의사항:
1. "setupCommands"는 프로젝트 뼈대 구축이나 패키지 설치 등 필요한 사전 명령어 목록이다. 필요 없다면 빈 배열로 처리해라.
2. "relevantFiles" 배열에는 전체 파일 경로 목록 중 필요한 경로만 상대 경로로 정확히 넣어라. 신규 생성할 파일의 예상 경로도 포함해라.
3. 요청과 전혀 상관없는 파일(예: 리드미, 빌드 결과물 등)은 절대 리스트에 포함하지 마라.
4. 출력 형식은 완벽한 JSON 형태여야 한다.
5. 비대화형 환경(non-interactive)에서 명령어들이 정지(대기)되지 않고 즉시 실행될 수 있도록, 프로젝트 생성 시 \`npm create\` 대신 반드시 \`npx -y\` (예: \`npx -y create-vite@latest . --template vue-ts\`) 문법을 사용해라. \`-y\` 또는 \`--yes\` 옵션이 없는 대화형 명령어는 대기열 실행을 강제 중단시키므로 절대 금지한다.`;

export const systemPromptUpdate = `너는 세계 최고의 시니어 프론트엔드 엔지니어이자 대화형 ChatOps 에이전트다.
제공된 [기획 명세서]와 [현재 워크스페이스 상태(관련 파일 목록 및 소스코드)], 그리고 사용자의 [코딩 요청]을 분석하여, 요청을 해결하기 위해 필요한 파일 생성 및 수정을 수행하는 리눅스 명령어들을 작성해라.

장황한 소스코드를 일반 텍스트나 마크다운으로 출력하는 대신, 파일들을 생성/수정할 수 있는 구체적인 리눅스 쉘 명령어 배열('execute')을 반환해야 한다.
파일 생성 및 수정을 위해 bash의 'cat << 'EOF' > 파일경로' 문법을 적극적으로 활용해라.

출력은 반드시 다음과 같은 JSON 포맷이어야 한다. 설명이나 자연어는 일절 포함하지 마라.
JSON 포맷 예시:
{
  "execute": [
    {
      "cmd": "mkdir -p src/components && cat << 'EOF' > src/components/NewComponent.vue\\ntemplate...\\nEOF",
      "desc": "Create NewComponent component"
    }
  ],
  "desc": "이번 요청에 따라 수행된 작업들에 대한 총괄 요약 설명"
}

주의사항:
1. "execute" 배열 내의 "cmd"는 실제 리눅스 bash에서 실행될 명령어 문자열이다. 디렉토리 생성(mkdir -p), 파일 쓰기(cat << 'EOF' > 파일경로), 의존성 추가 등 필요한 모든 조작을 명령어로 기술해라.
2. "execute" 내 "desc"는 해당 명령어가 어떤 작업을 수행하는지 설명하는 간결한 영문/국문 요약이다.
3. "desc" 최상위 필드는 모든 작업이 성공적으로 완수되었을 때 디스코드에 자연어로 보고할 최종 작업 보고서 내용이다. 어떤 파일들이 어떻게 생성/수정되었는지, 무엇을 확인해야 하는지 친절하고 상세하게 작성해라.
4. 출력 형식은 반드시 완전하고 적합한 표준 JSON 형태여야 한다. 특히 "cmd"나 "desc" 문자열 값 내부에는 실제 개행(raw newline) 문자나 제어 문자가 절대로 들어가서는 안 되며, 개행은 반드시 "\\n", 큰따옴표는 "\\\"", 탭은 "\\t" 등 표준 JSON 문자열 규칙대로 완벽히 이스케이프 처리하여 파싱 가능한 유효한 JSON을 보장해라.
5. 비대화형 환경(non-interactive)에서 명령어들이 멈추지 않고 즉시 수행될 수 있도록, 패키지 설치 및 초기화 시 대화형 프롬프트를 생략하기 위해 반드시 \`npx -y\` 옵션(예: \`npx -y create-vite@latest . --template vue-ts\`) 및 \`npm install\` 등을 사용해라. \`-y\` 또는 \`--yes\`가 없는 대화형 명령어는 절대 금지한다.`;

export async function selectRelevantFilesOllama(
  aiApiUrl: string,
  spec: string,
  filePaths: string[],
  userRequest: string,
  abortSignal?: AbortSignal,
): Promise<Phase1Result> {
  const userPrompt = `
[기획 명세서]
${spec}

[전체 파일 경로 목록]
${JSON.stringify(filePaths, null, 2)}

[사용자 코딩 요청]
${userRequest}
`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 300000); // 5분

  if (abortSignal) {
    if (abortSignal.aborted) {
      controller.abort();
    } else {
      const onAbort = () => controller.abort();
      abortSignal.addEventListener("abort", onAbort);
      controller.signal.addEventListener("abort", () => {
        abortSignal.removeEventListener("abort", onAbort);
      });
    }
  }

  try {
    const response = await fetch(`${aiApiUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "domi-coder-select",
        messages: [
          { role: "user", content: userPrompt },
        ],
        format: "json",
        options: { temperature: 0.0 },
        stream: true, // 중단 감지를 위해 스트리밍 사용
      }),
      signal: controller.signal,
      // @ts-ignore
      dispatcher: new Agent({
        headersTimeout: 300000,
        bodyTimeout: 300000,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama 1단계 API 호출 실패: ${response.statusText}`);
    }

    let accumulatedContent = "";
    let buffer = "";
    const decoder = new TextDecoder();

    // @ts-ignore
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsedChunk = JSON.parse(line);
          if (parsedChunk.message && parsedChunk.message.content) {
            accumulatedContent += parsedChunk.message.content;
          }
        } catch (err) {
          // Ignore
        }
      }
    }

    if (buffer.trim()) {
      try {
        const parsedChunk = JSON.parse(buffer);
        if (parsedChunk.message && parsedChunk.message.content) {
          accumulatedContent += parsedChunk.message.content;
        }
      } catch (err) {
        // Ignore
      }
    }

    if (accumulatedContent) {
      const parsed = JSON.parse(accumulatedContent.trim());
      if (parsed) {
        return {
          setupCommands: Array.isArray(parsed.setupCommands) ? parsed.setupCommands : [],
          relevantFiles: Array.isArray(parsed.relevantFiles) ? parsed.relevantFiles : [],
        };
      }
    }
    return { relevantFiles: [] };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function generateCodeUpdateOllama(
  aiApiUrl: string,
  spec: string,
  prunedFiles: { path: string; content: string }[],
  userRequest: string,
  abortSignal?: AbortSignal,
): Promise<Phase2Result> {
  const userPrompt = `
[기획 명세서 (전체 누적 요건)]
${spec}

[현재 워크스페이스 핵심 파일들 및 소스 코드 (요청 관련 파일 선별됨)]
${JSON.stringify({ files: prunedFiles }, null, 2)}

[사용자 코딩 요청]
${userRequest}
`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1800000); // 30분

  if (abortSignal) {
    if (abortSignal.aborted) {
      controller.abort();
    } else {
      const onAbort = () => controller.abort();
      abortSignal.addEventListener("abort", onAbort);
      controller.signal.addEventListener("abort", () => {
        abortSignal.removeEventListener("abort", onAbort);
      });
    }
  }

  try {
    const response = await fetch(`${aiApiUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "domi-coder-update",
        messages: [
          { role: "user", content: userPrompt },
        ],
        format: "json",
        options: { temperature: 0.1 },
        stream: true, // 중단 감지를 위해 스트리밍 사용
      }),
      signal: controller.signal,
      // @ts-ignore
      dispatcher: new Agent({
        headersTimeout: 1800000,
        bodyTimeout: 1800000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API 호출 실패: ${response.statusText} (${errorText})`);
    }

    let accumulatedContent = "";
    let buffer = "";
    const decoder = new TextDecoder();

    // @ts-ignore
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsedChunk = JSON.parse(line);
          if (parsedChunk.message && parsedChunk.message.content) {
            accumulatedContent += parsedChunk.message.content;
          }
        } catch (err) {
          // Ignore
        }
      }
    }

    if (buffer.trim()) {
      try {
        const parsedChunk = JSON.parse(buffer);
        if (parsedChunk.message && parsedChunk.message.content) {
          accumulatedContent += parsedChunk.message.content;
        }
      } catch (err) {
        // Ignore
      }
    }

    if (accumulatedContent) {
      try {
        const parsed = JSON.parse(accumulatedContent.trim());
        if (parsed && Array.isArray(parsed.execute)) {
          return {
            execute: parsed.execute,
            desc: parsed.desc,
          };
        }
        throw new Error("JSON 응답 내 'execute' 배열을 찾을 수 없습니다.");
      } catch (e: any) {
        console.error("❌ Ollama 파싱 실패 원본 내용:", accumulatedContent);
        throw new Error(`Ollama 응답 파싱 에러: ${e.message}`);
      }
    } else {
      throw new Error("Ollama로부터 빈 응답을 받았습니다.");
    }
  } finally {
    clearTimeout(timeoutId);
  }
}
