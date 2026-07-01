import http from 'http';

const OLLAMA_HOST = 'localhost';
const OLLAMA_PORT = 11434;
const MODEL_NAME = 'qwen2.5-coder:14b'; // 정돈된 원탑 전용 모델 타겟팅

export async function generateCodeUpdate(
  spec: string, 
  currentCode: string, 
  fileName: string
): Promise<string> {
  
  // 프론트엔드 최신 스택 유지를 위한 강력한 시스템 가이드 펜스 설치
  const systemPrompt = `너는 세계 최고의 시니어 프론트엔드 엔지니어이자 대화형 ChatOps 에이전트다.
제공된 [기획 명세서]의 누적 요건들을 완벽히 반영하여, [현재 소스 코드]를 완성도 높은 코드로 수정해라.

⚠️ [극도로 엄격한 출력 제약 규칙]
1. 코드 이외의 그 어떤 설명, 자연어 멘트, 주석 설명, 마크다운 기호(\`\`\`)도 절대 출력에 포함하지 마라.
2. 오직 수정이 완료되어 즉시 컴파일 가능한 '순수 전체 소스 코드 텍스트' 자체만 완벽하게 출력해라.
3. 기존 Vue/React 프레임워크 규격, TypeScript 구조, 아키텍처 규칙을 일절 훼손하지 마라.`;

  const userPrompt = `
[기획 명세서 (전체 누적 요건)]
${spec}

[대상 파일 명세]
${fileName}

[현재 파일 내부 소스 코드]
${currentCode}

위 누적 기획서를 기반으로 완벽하게 수정·보완된 전체 코드를 반환해라.
`;

  const payload = JSON.stringify({
    model: MODEL_NAME,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    options: {
      temperature: 0.1 // 코딩의 결정론적 정밀성을 위해 온도를 극도로 낮춤
    },
    stream: false
  });

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: OLLAMA_HOST,
      port: OLLAMA_PORT,
      path: '/api/chat',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.message && json.message.content) {
            resolve(json.message.content.trim());
          } else {
            reject(new Error('Ollama로부터 빈 응답을 받았습니다.'));
          }
        } catch (e) {
          reject(new Error('Ollama API JSON 응답 파싱 실패'));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}
