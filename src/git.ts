import { AI_CONFIG } from "./config";

/**
 * 블로그 GitHub Pages 배포를 Repository Dispatch로 트리거합니다.
 * @returns {Promise<boolean>} 트리거 성공 여부
 */
export async function triggerBlogDeploy(): Promise<boolean> {
  const gitToken = process.env.GIT_TOKEN;
  if (!gitToken) {
    console.warn("⚠️ 환경변수 GIT_TOKEN이 누락되어 GitHub Pages 배포 트리거를 건너뜁니다.");
    return false;
  }

  const owner = AI_CONFIG.GITHUB_OWNER;
  const repo = AI_CONFIG.GITHUB_REPO;

  console.log(
    `🚀 [GitHub API] ${owner}/${repo} 레포지토리의 배포 트리거(Repository Dispatch)를 호출합니다...`,
  );

  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${gitToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "coder-domi-bot",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        event_type: "deploy_trigger",
      }),
    });

    if (response.ok) {
      console.log(`✅ [GitHub API] ${owner}/${repo} 배포 트리거 완료!`);
      return true;
    } else {
      const errorText = await response.text();
      console.error(`❌ [GitHub API] 배포 트리거 실패: ${response.statusText} (${errorText})`);
      return false;
    }
  } catch (error: any) {
    console.error(`❌ [GitHub API] 배포 트리거 요청 오류:`, error.message);
    return false;
  }
}
