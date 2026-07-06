import { FileChange } from "./types";
import { systemPromptSelect, systemPromptUpdate } from "./ollama";

async function logAvailableModels(apiKey: string) {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
    );
    if (response.ok) {
      const data = (await response.json()) as any;
      const modelNames = data.models?.map((m: any) => m.name) || [];
      console.warn("💡 [Gemini API] 사용 가능한 모델 목록:", modelNames);
    } else {
      console.warn(
        `⚠️ [Gemini API] 모델 목록 조회 API 응답 실패: ${response.status} (${response.statusText})`,
      );
    }
  } catch (e: any) {
    console.error("⚠️ [Gemini API] 모델 목록 조회 예외 발생:", e.message);
  }
}

export async function selectRelevantFilesGemini(
  apiKey: string,
  spec: string,
  filePaths: string[],
  userRequest: string,
): Promise<string[]> {
  const userPrompt = `
[기획 명세서]
${spec}

[전체 파일 경로 목록]
${JSON.stringify(filePaths, null, 2)}

[사용자 코딩 요청]
${userRequest}

위 정보를 바탕으로, 이번 요청을 수행하기 위해 읽거나 수정해야 하는 파일 목록(JSON)을 작성해라.
`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPromptSelect }]
      },
      contents: [
        {
          role: "user",
          parts: [{ text: userPrompt }]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.0
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    await logAvailableModels(apiKey);
    throw new Error(`Gemini 1단계 API 호출 실패: ${response.statusText} (${errorText})`);
  }

  const json = (await response.json()) as any;
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (text) {
    const parsed = JSON.parse(text.trim());
    if (parsed && Array.isArray(parsed.relevantFiles)) {
      return parsed.relevantFiles as string[];
    }
  }
  return [];
}

export async function generateCodeUpdateGemini(
  apiKey: string,
  spec: string,
  prunedFiles: { path: string; content: string }[],
  userRequest: string,
): Promise<FileChange[]> {
  const userPrompt = `
[기획 명세서 (전체 누적 요건)]
${spec}

[현재 워크스페이스 핵심 파일들 및 소스 코드 (요청 관련 파일 선별됨)]
${JSON.stringify({ files: prunedFiles }, null, 2)}

[사용자 코딩 요청]
${userRequest}

위 기획서와 워크스페이스 상태를 분석하고, 사용자의 코딩 요청을 완벽하게 반영한 파일 변경사항(JSON)을 생성해라.
`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPromptUpdate }]
      },
      contents: [
        {
          role: "user",
          parts: [{ text: userPrompt }]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    await logAvailableModels(apiKey);
    throw new Error(`Gemini API 호출 실패: ${response.statusText} (${errorText})`);
  }

  const json = (await response.json()) as any;
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (text) {
    try {
      const parsed = JSON.parse(text.trim());
      if (parsed && Array.isArray(parsed.changes)) {
        return parsed.changes as FileChange[];
      }
      throw new Error("JSON 응답 내 'changes' 배열을 찾을 수 없습니다.");
    } catch (e: any) {
      throw new Error(`Gemini 응답 파싱 에러: ${e.message}\n원본 내용: ${text}`);
    }
  } else {
    throw new Error("Gemini로부터 빈 응답을 받았습니다.");
  }
}
