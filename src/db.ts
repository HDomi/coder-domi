import Database from 'better-sqlite3';
import path from 'path';

// 프로젝트 루트 경로에 chatops.db 생성 및 추적
const dbPath = path.resolve(__dirname, '../chatops.db');
const db = new Database(dbPath);

// 디스코드 채널 고유 ID를 PK로 두어 뇌(세션)를 완벽 분리
db.exec(`
  CREATE TABLE IF NOT EXISTS project_sessions (
    channel_id TEXT PRIMARY KEY,
    project_path TEXT,
    spec_summary TEXT,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// 마이그레이션: app_name 컬럼 추가 (존재하지 않을 때만)
try {
  db.exec(`ALTER TABLE project_sessions ADD COLUMN app_name TEXT`);
} catch (e) {
  // 이미 컬럼이 존재하는 경우 예외 처리 무시
}

export interface Session {
  channel_id: string;
  project_path: string;
  spec_summary: string;
  app_name: string;
}

export const dbManager = {
  // 채널 ID 기반 가상 개발 세션 조회
  getSession(channelId: string): Session | null {
    const stmt = db.prepare('SELECT * FROM project_sessions WHERE channel_id = ?');
    return stmt.get(channelId) as Session | null;
  },

  // 영구 한계 없는 기획 명세서 컨텍스트 업데이트 및 저장
  saveSession(channelId: string, projectPath: string, specSummary: string, appName: string) {
    const stmt = db.prepare(`
      INSERT INTO project_sessions (channel_id, project_path, spec_summary, app_name, last_updated)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(channel_id) DO UPDATE SET
        project_path = excluded.project_path,
        spec_summary = excluded.spec_summary,
        app_name = excluded.app_name,
        last_updated = CURRENT_TIMESTAMP
    `);
    stmt.run(channelId, projectPath, specSummary, appName);
  },

  // 채널 ID 기반 개발 세션 정보 삭제 (말소)
  deleteSession(channelId: string) {
    const stmt = db.prepare('DELETE FROM project_sessions WHERE channel_id = ?');
    stmt.run(channelId);
  }
};
