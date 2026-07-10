let isOllamaBusy = false;

/**
 * Ollama API 호출 시 동시 실행을 방지하기 위한 전역 뮤텍스 락 래퍼입니다.
 * 리소스 오버헤드로 인한 OOM(Out of Memory) 현상을 방지합니다.
 */
export async function executeWithOllamaLock<T>(fn: () => Promise<T>): Promise<T> {
  if (isOllamaBusy) {
    throw new Error("🔄 현재 서버의 다른 AI 자아가 사색(연산) 중입니다. 잠시 후 다시 시도해 주세요.");
  }

  isOllamaBusy = true;
  try {
    return await fn();
  } finally {
    isOllamaBusy = false;
  }
}

/**
 * 현재 Ollama가 연산 중인지 여부를 반환합니다.
 */
export function isOllamaLocked(): boolean {
  return isOllamaBusy;
}
