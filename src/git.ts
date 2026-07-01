import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface GitHubUser {
  login: string;
}

export async function setupAndPushRepo(
  projectPath: string,
  appName: string,
  gitToken: string
): Promise<string> {
  // 1. Get authenticated user name
  const userResponse = await fetch('https://api.github.com/user', {
    headers: {
      'Authorization': `Bearer ${gitToken}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'corder-domi-bot',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });

  if (!userResponse.ok) {
    const errorText = await userResponse.text();
    throw new Error(`GitHub 사용자 조회 실패: ${userResponse.statusText} (${errorText})`);
  }

  const userData = await userResponse.json() as GitHubUser;
  const username = userData.login;
  const repoName = appName;

  // 2. Check if repository already exists
  const repoResponse = await fetch(`https://api.github.com/repos/${username}/${repoName}`, {
    headers: {
      'Authorization': `Bearer ${gitToken}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'corder-domi-bot',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });

  if (repoResponse.status === 404) {
    // Repository does not exist, create it
    console.log(`Repository ${repoName} does not exist. Creating...`);
    const createResponse = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${gitToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'corder-domi-bot',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: JSON.stringify({
        name: repoName,
        private: false,
        auto_init: false
      })
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throw new Error(`GitHub 레포지토리 생성 실패: ${createResponse.statusText} (${errorText})`);
    }
  } else if (!repoResponse.ok) {
    throw new Error(`GitHub 레포지토리 확인 중 오류 발생: ${repoResponse.statusText}`);
  }

  // 3. Local git setup
  if (!fs.existsSync(path.join(projectPath, '.git'))) {
    execSync('git init', { cwd: projectPath });
  }

  // Ensure git remote is set up correctly with token auth URL
  const remoteUrlWithToken = `https://${gitToken}@github.com/${username}/${repoName}.git`;

  try {
    execSync('git remote remove origin', { cwd: projectPath, stdio: 'ignore' });
  } catch (e) {
    // Ignore if origin remote didn't exist
  }
  
  execSync(`git remote add origin ${remoteUrlWithToken}`, { cwd: projectPath });
  
  // Ensure default branch is main
  execSync('git branch -M main', { cwd: projectPath });

  // 4. Git commit & push
  const hasChanges = execSync('git status --porcelain', { cwd: projectPath, encoding: 'utf-8' }).trim();
  if (hasChanges) {
    execSync('git add .', { cwd: projectPath });
    execSync('git commit -m "ChatOps: 디스코드 세션 기반 AI 자동 코드 반영 및 동기화"', { cwd: projectPath });
  }

  try {
    execSync('git push -u origin main', { cwd: projectPath });
  } catch (pushError: any) {
    console.warn('Push failed, attempting force push...', pushError.message);
    execSync('git push -u origin main --force', { cwd: projectPath });
  }

  return `https://github.com/${username}/${repoName}`;
}
