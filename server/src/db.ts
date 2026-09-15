import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

// SQLite 파일 경로 — 운영에선 볼륨 마운트된 /app/data 에 둔다(컨테이너 재생성에도 보존).
const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), "data", "higher.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

/** 데이터 디렉토리 — 탑 이미지(towers/)도 여기에 둔다. */
export const DATA_DIR = path.dirname(DB_PATH);

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS score (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    player_name TEXT    NOT NULL,
    height_cm   INTEGER NOT NULL,
    blocks      INTEGER NOT NULL,
    client_ip   TEXT,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );
  CREATE INDEX IF NOT EXISTS idx_score_rank ON score (height_cm DESC, blocks DESC, id ASC);
`);

export interface ScoreRow {
  id: number;
  player_name: string;
  height_cm: number;
  blocks: number;
  created_at: string;
}

const topStmt = db.prepare(
  `SELECT id, player_name, height_cm, blocks, created_at
     FROM score
    ORDER BY height_cm DESC, blocks DESC, id ASC
    LIMIT ?`
);
const insertStmt = db.prepare(
  `INSERT INTO score (player_name, height_cm, blocks, client_ip) VALUES (?, ?, ?, ?)`
);
const betterStmt = db.prepare(
  `SELECT COUNT(*) AS c FROM score WHERE height_cm > ? OR (height_cm = ? AND blocks > ?)`
);
const countStmt = db.prepare(`SELECT COUNT(*) AS c FROM score`);

export function topScores(limit: number): ScoreRow[] {
  return topStmt.all(limit) as ScoreRow[];
}

/** 점수 저장 후 새 row id 반환(탑 이미지 파일명으로 사용). */
export function insertScore(
  name: string,
  heightCm: number,
  blocks: number,
  ip: string | null
): number {
  const info = insertStmt.run(name, heightCm, blocks, ip);
  return Number(info.lastInsertRowid);
}

/** 상위 N개 점수의 id 집합 — 탑 이미지 용량 관리(top-N 만 보존)에 쓴다. */
export function topScoreIds(limit: number): number[] {
  const rows = db
    .prepare(
      `SELECT id FROM score ORDER BY height_cm DESC, blocks DESC, id ASC LIMIT ?`
    )
    .all(limit) as { id: number }[];
  return rows.map((r) => r.id);
}

/** 이 기록보다 '엄격히 나은' 제출 수 + 1 = 순위. */
export function rankOf(heightCm: number, blocks: number): number {
  const row = betterStmt.get(heightCm, heightCm, blocks) as { c: number };
  return row.c + 1;
}

export function totalCount(): number {
  return (countStmt.get() as { c: number }).c;
}
