import { CodeUpdateResult, Phase1Result, Phase2Result } from "./types";
import { selectRelevantFilesOllama, generateCodeUpdateOllama } from "./ollama";
import { selectRelevantFilesGemini, generateCodeUpdateGemini } from "./gemini";
import { getWorkspaceContext, executeShellCommand } from "../utils";

export * from "./types";

export async function generateCodeUpdate(
  spec: string,
  projectPath: string,
  userRequest: string,
  localModelOverride?: boolean,
  abortSignal?: AbortSignal,
): Promise<CodeUpdateResult> {
  const isLocalMode = localModelOverride !== undefined ? localModelOverride : (process.env.LOCAL_MODE === "true");
  const geminiApiKey = process.env.GEMINI_API_KEY;

  const useLocal = isLocalMode || !geminiApiKey;
  if (localModelOverride === undefined && !isLocalMode && !geminiApiKey) {
    console.warn(
      "⚠️ GEMINI_API_KEY가 설정되어 있지 않아 로컬 모델(Ollama) 모드로 자동 전환합니다.",
    );
  }

  // 1단계: 초기 파일 목록 획득 및 분석 시작
  let workspaceContext = getWorkspaceContext(projectPath);
  let allPaths = workspaceContext.files.map((f) => f.path);
  let phase1Result: Phase1Result = { relevantFiles: [] };

  console.log(
    `[Prompt Diet] 1단계: 의존 파일 선별 및 초기화 분석 시작... (전체 파일 수: ${
      workspaceContext.files.length
    }개 / 모드: ${useLocal ? "Ollama" : "Gemini"})`,
  );

  try {
    if (useLocal) {
      const aiApiUrl = process.env.AI_API_URL || "http://localhost:11434";
      const cleanUrl = aiApiUrl.endsWith("/") ? aiApiUrl.slice(0, -1) : aiApiUrl;
      phase1Result = await selectRelevantFilesOllama(
        cleanUrl,
        spec,
        allPaths,
        userRequest,
        abortSignal,
      );
    } else {
      phase1Result = await selectRelevantFilesGemini(
        geminiApiKey!,
        spec,
        allPaths,
        userRequest,
        abortSignal,
      );
    }
  } catch (error) {
    console.warn("⚠️ 1단계 파일 선별 도중 에러가 발생했습니다:", error);
    phase1Result = { relevantFiles: allPaths };
  }

  // 1.5단계: 1단계에서 반환된 setupCommands 즉시 실행
  const runSetupCommands: string[] = [];
  if (phase1Result.setupCommands && phase1Result.setupCommands.length > 0) {
    console.log(`[Phase 1 Setup] 실행할 초기화 명령어 발견: ${phase1Result.setupCommands.length}개`);
    for (const cmd of phase1Result.setupCommands) {
      try {
        console.log(`[Phase 1 Setup] Executing: ${cmd}`);
        await executeShellCommand(cmd, projectPath, abortSignal);
        runSetupCommands.push(cmd);
      } catch (err: any) {
        console.error(`❌ [Phase 1 Setup Error] 명령어 실행 실패: ${cmd}`, err.message);
        if (abortSignal?.aborted) {
          throw new Error("작업이 사용자에 의해 중단되었습니다.");
        }
      }
    }
    // 명령어 실행 후 파일 구조 변경 가능성이 있으므로 워크스페이스 컨텍스트 재로드
    workspaceContext = getWorkspaceContext(projectPath);
    allPaths = workspaceContext.files.map((f) => f.path);
  }

  const selectedPaths = phase1Result.relevantFiles;

  // 선별된 파일들을 기반으로 새로운 정제 컨텍스트 구성
  const selectedPathsSet = new Set(selectedPaths);
  const prunedFiles = workspaceContext.files.filter((f) =>
    selectedPathsSet.has(f.path),
  );

  // 만약 새로 생성해야 하는 파일이 있다면, 해당 경로 정보를 빈 본문과 함께 컨텍스트에 표시해준다.
  for (const p of selectedPaths) {
    if (!allPaths.includes(p)) {
      prunedFiles.push({
        path: p,
        content: "(새로 생성할 파일 - 현재 비어있음)",
      });
    }
  }

  console.log(
    `[Prompt Diet] 2단계: 핵심 소스 코드 전송 시작... (다이어트 후 파일 수: ${
      prunedFiles.length
    }개 / ${allPaths.length}개 / 모드: ${useLocal ? "Ollama" : "Gemini"})`,
  );
  console.log(
    `[Prompt Diet] 전송할 파일 목록:\n${prunedFiles
      .map((f) => ` - ${f.path}`)
      .join("\n")}`,
  );

  let phase2Result: Phase2Result = { execute: [] };

  if (useLocal) {
    const aiApiUrl = process.env.AI_API_URL || "http://localhost:11434";
    const cleanUrl = aiApiUrl.endsWith("/") ? aiApiUrl.slice(0, -1) : aiApiUrl;
    phase2Result = await generateCodeUpdateOllama(cleanUrl, spec, prunedFiles, userRequest, abortSignal);
  } else {
    phase2Result = await generateCodeUpdateGemini(
      geminiApiKey!,
      spec,
      prunedFiles,
      userRequest,
      abortSignal,
    );
  }

  return {
    setupCommands: runSetupCommands,
    relevantFiles: selectedPaths,
    execute: phase2Result.execute,
    desc: phase2Result.desc,
  };
}
