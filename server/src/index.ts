import express from "express";
import path from "node:path";
import { insertScore, rankOf, topScores, totalCount, type ScoreRow } from "./db";
import { validateScore } from "./validate";

const app = express();
// nginx 뒤에 있으므로 X-Forwarded-For 를 신뢰해 req.ip 를 실제 클라이언트 IP 로.
app.set("trust proxy", true);
app.use(express.json({ limit: "8kb" }));

// ── best-effort IP Rate Limit (인메모리) — 스크립트 폭주 방지. 랭킹은 캐주얼이라 완만하게. ──
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const cur = hits.get(ip);
  if (!cur || now > cur.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  cur.count += 1;
  return cur.count > MAX_PER_WINDOW;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, v] of hits) {
    if (now > v.resetAt) hits.delete(ip);
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
    rank,
    playerName: r.player_name,
    heightCm: r.height_cm,
    blocks: r.blocks,
    createdAt: r.created_at,
  };
}

app.get("/healthz", (_req, res) => {
  res.type("text/plain").send("ok");
});

// Top N 랭킹 (기본 20, 최대 100).
app.get("/api/scores", (req, res) => {
  const raw = parseInt(String(req.query.limit ?? "20"), 10);
  const limit = Math.min(Math.max(Number.isFinite(raw) ? raw : 20, 1), 100);
  const top = topScores(limit).map((r, i) => toEntry(r, i + 1));
  res.json(ok({ top }));
});

// 점수 제출 → 내 순위 + Top N.
app.post("/api/scores", (req, res) => {
  const ip = String(req.ip ?? "");
  if (rateLimited(ip)) {
    return res.status(429).json(fail("RATE_LIMITED", "잠시 후 다시 시도해주세요."));
  }
  const clean = validateScore(req.body);
  insertScore(clean.playerName, clean.heightCm, clean.blocks, ip || null);
  const rank = rankOf(clean.heightCm, clean.blocks);
  const top = topScores(20).map((r, i) => toEntry(r, i + 1));
  const entry = {
    rank,
    playerName: clean.playerName,
    heightCm: clean.heightCm,
    blocks: clean.blocks,
    createdAt: new Date().toISOString(),
  };
  res.json(ok({ rank, totalCount: totalCount(), entry, top }));
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
