import express from "express";
import path from "node:path";
import fs from "node:fs";
import {
  DATA_DIR,
  insertEvent,
  insertScore,
  rankOf,
  searchScores,
  topScoreIds,
  topScores,
  totalCount,
  usageStats,
  type ScoreRow,
} from "./db";
import { sanitizeMode, validateEvent, validateScore, type GameMode } from "./validate";

const app = express();
// nginx 뒤에 있으므로 X-Forwarded-For 를 신뢰해 req.ip 를 실제 클라이언트 IP 로.
app.set("trust proxy", true);
// 탑 이미지(1080×1350 PNG data URL)를 함께 받으므로 본문 상한을 넉넉히.
app.use(express.json({ limit: "3mb" }));

// ── 탑 이미지 저장소 (볼륨) ──
const TOWERS_DIR = path.join(DATA_DIR, "towers");
fs.mkdirSync(TOWERS_DIR, { recursive: true });
const KEEP_TOWER_IMAGES = 100; // 상위 N개 기록의 탑 이미지만 보존(용량 관리)
const MAX_IMAGE_BYTES = 2_000_000; // 디코드 후 상한 (~2MB)

function towerPath(id: number): string {
  return path.join(TOWERS_DIR, `${id}.png`);
}
function hasTower(id: number): boolean {
  return fs.existsSync(towerPath(id));
}

/** data:image/png;base64,... 를 검증·디코드해 <id>.png 로 저장. 실패해도 점수 저장엔 영향 없음. */
function saveTowerImage(id: number, dataUrl: unknown): void {
  if (typeof dataUrl !== "string") return;
  const prefix = "data:image/png;base64,";
  if (!dataUrl.startsWith(prefix)) return;
  const b64 = dataUrl.slice(prefix.length);
  // 대략적 크기 선검사 (base64 는 원본의 ~4/3)
  if (b64.length > MAX_IMAGE_BYTES * 1.4) return;
  try {
    const buf = Buffer.from(b64, "base64");
    if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) return;
    // PNG 매직넘버 확인
    if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return;
    fs.writeFileSync(towerPath(id), buf);
  } catch {
    /* 저장 실패 무시 */
  }
}

/** 상위 N개 밖의 탑 이미지를 삭제해 용량을 top-N 으로 유지. */
function pruneTowerImages(): void {
  try {
    const keep = new Set(topScoreIds(KEEP_TOWER_IMAGES));
    for (const f of fs.readdirSync(TOWERS_DIR)) {
      const m = /^(\d+)\.png$/.exec(f);
      if (m && !keep.has(Number(m[1]))) {
        fs.rmSync(path.join(TOWERS_DIR, f), { force: true });
      }
    }
  } catch {
    /* 정리 실패 무시 */
  }
}

// ── best-effort IP Rate Limit (인메모리) — 스크립트 폭주 방지. 랭킹은 캐주얼이라 완만하게. ──
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
// 점수 제출과 이용 로그는 빈도가 달라 버킷을 나눈다 — 로그가 제출 한도를 잡아먹으면 안 된다.
const buckets = new Map<string, Map<string, { count: number; resetAt: number }>>();

function rateLimited(ip: string, bucket = "score", max = MAX_PER_WINDOW): boolean {
  let hits = buckets.get(bucket);
  if (!hits) buckets.set(bucket, (hits = new Map()));
  const now = Date.now();
  const cur = hits.get(ip);
  if (!cur || now > cur.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  cur.count += 1;
  return cur.count > max;
}
setInterval(() => {
  const now = Date.now();
  for (const hits of buckets.values()) {
    for (const [ip, v] of hits) {
      if (now > v.resetAt) hits.delete(ip);
    }
  }
}, WINDOW_MS).unref();

function ok<T>(data: T) {
  return { success: true, data, error: null };
}
function fail(code: string, message: string) {
  return { success: false, data: null, error: { code, message } };
}
function toEntry(r: ScoreRow, rank: number) {
  return {
    id: r.id,
    rank,
    playerName: r.player_name,
    heightCm: r.height_cm,
    blocks: r.blocks,
    createdAt: r.created_at,
    hasImage: hasTower(r.id),
  };
}

app.get("/healthz", (_req, res) => {
  res.type("text/plain").send("ok");
});

/** 모드는 순위표를 가르는 축 — 없거나 이상하면 기존 모드(도전)로 본다. */
function modeOf(req: { query: Record<string, unknown> }): GameMode {
  return sanitizeMode(req.query.mode);
}

// Top N 랭킹 (기본 20, 최대 100). 모드별로 따로 매긴다.
app.get("/api/scores", (req, res) => {
  const raw = parseInt(String(req.query.limit ?? "20"), 10);
  const limit = Math.min(Math.max(Number.isFinite(raw) ? raw : 20, 1), 100);
  const mode = modeOf(req);
  const top = topScores(limit, mode).map((r, i) => toEntry(r, i + 1));
  res.json(ok({ top, mode }));
});

// 닉네임 검색 — Top 20 밖의 기록은 이걸로만 찾을 수 있다.
// (":id/tower.png" 는 세그먼트 수가 달라 이 경로와 충돌하지 않는다.)
app.get("/api/scores/search", (req, res) => {
  // 닉네임 상한(20자)과 맞춰 잘라, 긴 검색어로 스캔을 유발하는 걸 막는다.
  const mode = modeOf(req);
  const q = String(req.query.q ?? "").trim().slice(0, 20);
  if (!q) return res.json(ok({ results: [], totalCount: totalCount(mode), mode }));
  const raw = parseInt(String(req.query.limit ?? "20"), 10);
  const limit = Math.min(Math.max(Number.isFinite(raw) ? raw : 20, 1), 50);
  const results = searchScores(q, limit, mode).map((r) => toEntry(r, r.rank));
  res.json(ok({ results, totalCount: totalCount(mode), mode }));
});

// 특정 기록의 탑 이미지 (PNG). 없으면 404.
app.get("/api/scores/:id/tower.png", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0 || !hasTower(id)) {
    return res.status(404).type("text/plain").send("no tower");
  }
  res.type("image/png");
  res.setHeader("Cache-Control", "public, max-age=86400, immutable");
  res.sendFile(towerPath(id));
});

// 점수 제출 → 내 순위 + Top N. body.image(선택) = 탑 스냅샷 data URL.
app.post("/api/scores", (req, res) => {
  const ip = String(req.ip ?? "");
  if (rateLimited(ip)) {
    return res.status(429).json(fail("RATE_LIMITED", "잠시 후 다시 시도해주세요."));
  }
  const clean = validateScore(req.body);
  const id = insertScore(clean.playerName, clean.heightCm, clean.blocks, ip || null, clean.mode);
  const body = (req.body ?? {}) as Record<string, unknown>;
  saveTowerImage(id, body.image);
  pruneTowerImages();

  const rank = rankOf(clean.heightCm, clean.blocks, clean.mode);
  const top = topScores(20, clean.mode).map((r, i) => toEntry(r, i + 1));
  const entry = {
    id,
    rank,
    playerName: clean.playerName,
    heightCm: clean.heightCm,
    blocks: clean.blocks,
    createdAt: new Date().toISOString(),
    hasImage: hasTower(id),
  };
  res.json(ok({ rank, totalCount: totalCount(clean.mode), mode: clean.mode, entry, top }));
});

// 이용 로그 수집 — 방문/시작/종료/등록/공유. 실패해도 게임엔 영향이 없도록 항상 204 로 끝낸다.
// 로그는 몇 판이 이뤄졌는지 세기 위한 것이라 sendBeacon 으로 던져도 되게 응답 본문을 두지 않는다.
app.post("/api/events", (req, res) => {
  const ip = String(req.ip ?? "");
  if (rateLimited(ip, "event", 120)) return res.status(204).end();
  const clean = validateEvent(req.body);
  if (!clean) return res.status(204).end();
  try {
    insertEvent({
      ...clean,
      ua: String(req.get("user-agent") ?? "").slice(0, 200) || null,
      referrer: String(req.get("referer") ?? "").slice(0, 200) || null,
      ip: ip || null,
    });
  } catch {
    /* 로그 실패는 무시 */
  }
  res.status(204).end();
});

// 이용 통계 — /stats 페이지가 쓴다. 집계값만 내보내고 개별 로그(IP·UA·세션)는 나가지 않는다.
app.get("/api/stats", (_req, res) => {
  res.json(ok(usageStats()));
});

// ── 게임 정적 파일 (빌드된 dist) + SPA 폴백 ──
const distDir = process.env.STATIC_DIR ?? path.join(__dirname, "..", "public");
app.use(express.static(distDir));
app.get("*", (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => {
  console.log(`higher-higher up on :${port} (api + static from ${distDir})`);
});
