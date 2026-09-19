import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { MODES, type GameMode } from "./validate";

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

// 모드 분리(기본/도전) 마이그레이션. 이미 쌓인 기록은 전부 기존 모드(random=도전)로 남는다.
const hasMode = (db.prepare(`PRAGMA table_info(score)`).all() as { name: string }[]).some(
  (c) => c.name === "mode",
);
if (!hasMode) {
  db.exec(`ALTER TABLE score ADD COLUMN mode TEXT NOT NULL DEFAULT 'random'`);
}
db.exec(
  `CREATE INDEX IF NOT EXISTS idx_score_rank_mode ON score (mode, height_cm DESC, blocks DESC, id ASC)`,
);

// 이용 로그 — 몇 명이 들어와 몇 판을 했는지 보기 위한 최소한의 기록.
// 개인을 식별하려는 게 아니라 흐름(방문→시작→종료→등록)을 세는 용도라, 남기는 항목을 좁게 잡는다.
db.exec(`
  CREATE TABLE IF NOT EXISTS event (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    session     TEXT,              -- 탭 단위 임시 id (브라우저를 닫으면 사라짐)
    name        TEXT    NOT NULL,  -- visit | start | end | submit | share | rank
    mode        TEXT,
    height_cm   INTEGER,
    blocks      INTEGER,
    duration_ms INTEGER,
    ua          TEXT,
    referrer    TEXT,
    client_ip   TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_event_time ON event (created_at);
  CREATE INDEX IF NOT EXISTS idx_event_name ON event (name, created_at);
`);

const insertEventStmt = db.prepare(
  `INSERT INTO event (session, name, mode, height_cm, blocks, duration_ms, ua, referrer, client_ip)
   VALUES (@session, @name, @mode, @heightCm, @blocks, @durationMs, @ua, @referrer, @ip)`
);

export interface EventRow {
  session: string | null;
  name: string;
  mode: string | null;
  heightCm: number | null;
  blocks: number | null;
  durationMs: number | null;
  ua: string | null;
  referrer: string | null;
  ip: string | null;
}

export function insertEvent(e: EventRow): void {
  insertEventStmt.run(e);
}

export interface ScoreRow {
  id: number;
  player_name: string;
  height_cm: number;
  blocks: number;
  created_at: string;
}

/** 검색 결과 행 — 전체 랭킹 기준의 실제 순위를 함께 담는다. */
export interface RankedScoreRow extends ScoreRow {
  rank: number;
}

// 아래 질의는 모두 모드 안에서만 순위를 매긴다 — 쉬운 모드(basic) 기록이 도전 모드 순위를 밀어내면 안 된다.
const topStmt = db.prepare(
  `SELECT id, player_name, height_cm, blocks, created_at
     FROM score
    WHERE mode = ?
    ORDER BY height_cm DESC, blocks DESC, id ASC
    LIMIT ?`
);
const insertStmt = db.prepare(
  `INSERT INTO score (player_name, height_cm, blocks, client_ip, mode) VALUES (?, ?, ?, ?, ?)`
);
const betterStmt = db.prepare(
  `SELECT COUNT(*) AS c FROM score WHERE mode = ? AND (height_cm > ? OR (height_cm = ? AND blocks > ?))`
);
const countStmt = db.prepare(`SELECT COUNT(*) AS c FROM score WHERE mode = ?`);
// 닉네임 부분 일치 검색. 순위는 topScores 와 똑같은 정렬 기준으로 매긴 뒤 필터링해야
// Top N 밖의 기록도 그 모드 랭킹에서의 진짜 순위를 얻는다.
const searchStmt = db.prepare(
  `SELECT id, player_name, height_cm, blocks, created_at, rank
     FROM (
       SELECT id, player_name, height_cm, blocks, created_at,
              ROW_NUMBER() OVER (ORDER BY height_cm DESC, blocks DESC, id ASC) AS rank
         FROM score
        WHERE mode = ?
     )
    WHERE player_name LIKE ? ESCAPE '\\'
    ORDER BY rank ASC
    LIMIT ?`
);

export function topScores(limit: number, mode: GameMode): ScoreRow[] {
  return topStmt.all(mode, limit) as ScoreRow[];
}

/** 점수 저장 후 새 row id 반환(탑 이미지 파일명으로 사용). */
export function insertScore(
  name: string,
  heightCm: number,
  blocks: number,
  ip: string | null,
  mode: GameMode,
): number {
  const info = insertStmt.run(name, heightCm, blocks, ip, mode);
  return Number(info.lastInsertRowid);
}

/** 상위 N개 점수의 id 집합 — 탑 이미지 용량 관리(top-N 만 보존)에 쓴다. 모드마다 N개씩 남긴다. */
export function topScoreIds(limit: number): number[] {
  const stmt = db.prepare(
    `SELECT id FROM score WHERE mode = ? ORDER BY height_cm DESC, blocks DESC, id ASC LIMIT ?`,
  );
  return MODES.flatMap((m) => (stmt.all(m, limit) as { id: number }[]).map((r) => r.id));
}

/** 같은 모드 안에서 이 기록보다 '엄격히 나은' 제출 수 + 1 = 순위. */
export function rankOf(heightCm: number, blocks: number, mode: GameMode): number {
  const row = betterStmt.get(mode, heightCm, heightCm, blocks) as { c: number };
  return row.c + 1;
}

export function totalCount(mode: GameMode): number {
  return (countStmt.get(mode) as { c: number }).c;
}

/** 닉네임 부분 일치 검색(대소문자 무시) — 해당 모드의 Top N 밖 기록을 찾는 용도. */
export function searchScores(term: string, limit: number, mode: GameMode): RankedScoreRow[] {
  // LIKE 와일드카드(%, _)와 이스케이프 문자를 리터럴로 취급해, 검색어로 전체 매칭되는 걸 막는다.
  const escaped = term.replace(/[\\%_]/g, (c) => "\\" + c);
  return searchStmt.all(mode, `%${escaped}%`, limit) as RankedScoreRow[];
}

// ---- 이용 통계 (집계값만) ----
// 공개 페이지(/stats)가 쓰므로 개별 행(IP·UA·세션)은 절대 내보내지 않는다. 날짜는 KST 기준.

export interface UsageStats {
  daily: { day: string; visitors: number; starts: number; ends: number; submits: number }[];
  byMode: { mode: string; games: number; avgHeightM: number; avgBlocks: number; avgSec: number; submits: number }[];
  funnel: { visits: number; starts: number; ends: number; submits: number; shares: number };
  totals: { todayVisitors: number; todayGames: number; gamesPerSession: number; scores: number };
}

const KST = "+9 hours";

export function usageStats(): UsageStats {
  const daily = db
    .prepare(
      `SELECT date(created_at, ?) AS day,
              COUNT(DISTINCT CASE WHEN name = 'visit' THEN session END) AS visitors,
              SUM(name = 'start')  AS starts,
              SUM(name = 'end')    AS ends,
              SUM(name = 'submit') AS submits
         FROM event
        WHERE date(created_at, ?) BETWEEN date('now', ?, '-13 days') AND date('now', ?)
        GROUP BY day ORDER BY day`,
    )
    .all(KST, KST, KST, KST) as UsageStats["daily"];

  const byMode = db
    .prepare(
      `SELECT e.mode AS mode,
              COUNT(*) AS games,
              ROUND(AVG(e.height_cm) / 100.0, 1) AS avgHeightM,
              ROUND(AVG(e.blocks), 1) AS avgBlocks,
              ROUND(AVG(e.duration_ms) / 1000.0, 1) AS avgSec,
              (SELECT COUNT(*) FROM event s WHERE s.name = 'submit' AND s.mode = e.mode) AS submits
         FROM event e
        WHERE e.name = 'end' AND e.mode IS NOT NULL
        GROUP BY e.mode`,
    )
    .all() as UsageStats["byMode"];

  const count = (name: string) =>
    (db.prepare(`SELECT COUNT(*) AS c FROM event WHERE name = ?`).get(name) as { c: number }).c;

  const todayVisitors = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT session) AS c FROM event
          WHERE name = 'visit' AND date(created_at, ?) = date('now', ?)`,
      )
      .get(KST, KST) as { c: number }
  ).c;
  const todayGames = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM event WHERE name = 'end' AND date(created_at, ?) = date('now', ?)`,
      )
      .get(KST, KST) as { c: number }
  ).c;
  const perSession = (
    db
      .prepare(
        `SELECT ROUND(AVG(n), 1) AS a FROM
           (SELECT COUNT(*) AS n FROM event WHERE name = 'end' AND session IS NOT NULL GROUP BY session)`,
      )
      .get() as { a: number | null }
  ).a;
  const scores = (db.prepare(`SELECT COUNT(*) AS c FROM score`).get() as { c: number }).c;

  return {
    daily,
    byMode,
    funnel: {
      visits: count("visit"),
      starts: count("start"),
      ends: count("end"),
      submits: count("submit"),
      shares: count("share"),
    },
    totals: { todayVisitors, todayGames, gamesPerSession: perSession ?? 0, scores },
  };
}
