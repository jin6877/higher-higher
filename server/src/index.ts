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
app.get("/api/stats", (req, res) => {
  // from/to 는 한국 시간 기준 날짜(YYYY-MM-DD). 없으면 최근 14일.
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  // 형식만 보면 2026-99-99 같은 값이 통과한다 — 실제 있는 날짜인지까지 확인한다.
  const day = (d: unknown, fallback: string) => {
    if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return fallback;
    const parsed = new Date(d + "T00:00:00Z");
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === d ? d : fallback;
  };
  const back = (n: number) =>
    new Date(Date.now() + 9 * 3600_000 - n * 86_400_000).toISOString().slice(0, 10);
  let from = day(req.query.from, back(13));
  let to = day(req.query.to, today);
  if (to > today) to = today; // 미래 날짜는 오늘까지로
  if (from > to) [from, to] = [to, from];
  // 너무 긴 범위는 응답이 커지니 1년으로 제한한다.
  if (Date.parse(to) - Date.parse(from) > 366 * 86_400_000) from = new Date(Date.parse(to) - 366 * 86_400_000).toISOString().slice(0, 10);
  res.json(ok(usageStats(from, to)));
});

// ── 게임 정적 파일 (빌드된 dist) + SPA 폴백 ──
//
// index.html 은 그냥 내려주지 않고, 방문자 언어에 맞춰 제목·설명·og 를 갈아끼운다.
// 게임 UI 는 브라우저에서 언어를 고르지만(src/i18n.ts), 카카오톡·트위터·검색 크롤러는
// JS 를 돌리지 않아 그 결과를 보지 못한다 — 영어권에 링크를 공유하면 미리보기가
// 한국어로 뜨게 된다. 그래서 메타만 여기서 바꾼다.
const distDir = process.env.STATIC_DIR ?? path.join(__dirname, "..", "public");

interface DocMeta {
  lang: string;
  locale: string;
  title: string;
  desc: string;
  ogDesc: string;
}

/** 게임 빌드가 내보낸 dist/meta.json (scripts/emit-meta.ts). 없으면 치환 없이 원본대로. */
const META: Partial<Record<"ko" | "en", DocMeta>> = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(distDir, "meta.json"), "utf8"));
  } catch {
    console.warn("meta.json 없음 — index.html 을 원본(한국어) 그대로 내려준다");
    return {};
  }
})();

/**
 * 한국어로 볼 사람인가. 클라이언트(src/i18n.ts)와 같은 규칙을 쓴다 —
 * Accept-Language 목록에 한국어가 하나라도 있으면 한국어. 해외에 있는 한국어 사용자에게
 * 영어를 보여주는 게 더 나쁜 결과라서 "가장 앞 언어" 가 아니라 "포함 여부" 로 본다.
 * ?lang= 가 있으면 그게 우선 — 공유 링크의 미리보기 언어를 지정할 수 있어야 한다.
 */
function wantsKorean(req: express.Request): boolean {
  const q = req.query.lang;
  if (q === "ko") return true;
  if (q === "en") return false;
  const header = String(req.headers["accept-language"] ?? "").trim();
  // 단서가 없으면 원문 언어(한국어)로. 미리보기를 만드는 크롤러는 Accept-Language 를
  // 안 보내는 경우가 많은데, 그때 영어를 내려주면 정작 주 사용자층인 카카오톡 공유
  // 미리보기가 영어로 뜬다.
  if (!header) return true;
  return header
    .split(",")
    .some((part) => part.split(";")[0].trim().toLowerCase().startsWith("ko"));
}

// index.html 은 배포마다 바뀌므로 mtime 이 그대로일 때만 캐시한다.
let htmlCache: { mtimeMs: number; html: string } | null = null;
function indexHtml(): string {
  const file = path.join(distDir, "index.html");
  const { mtimeMs } = fs.statSync(file);
  if (!htmlCache || htmlCache.mtimeMs !== mtimeMs) {
    htmlCache = { mtimeMs, html: fs.readFileSync(file, "utf8") };
  }
  return htmlCache.html;
}

/** 한국어 원본의 값들을 영어 값으로 바꾼다. 같은 문자열이 title·og:title 에 함께 쓰여 전부 치환된다. */
function localizeHtml(html: string, ko: DocMeta, en: DocMeta): string {
  return html
    .replace(`<html lang="${ko.lang}">`, `<html lang="${en.lang}">`)
    .split(ko.locale)
    .join(en.locale)
    .split(ko.title)
    .join(en.title)
    .split(ko.desc)
    .join(en.desc)
    .split(ko.ogDesc)
    .join(en.ogDesc);
}

function serveIndex(req: express.Request, res: express.Response): void {
  let html = indexHtml();
  const { ko, en } = META;
  if (ko && en && !wantsKorean(req)) html = localizeHtml(html, ko, en);
  // 같은 URL 이 언어에 따라 다른 내용을 주므로 중간 캐시가 한 벌만 들고 있으면 안 된다.
  res.set("Vary", "Accept-Language");
  res.set("Cache-Control", "no-cache");
  res.type("html").send(html);
}

// '/' 와 '/index.html' 은 static 보다 먼저 잡아야 치환을 거친다.
app.get(["/", "/index.html"], serveIndex);
app.use(express.static(distDir, { index: false }));
app.get("*", serveIndex);

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => {
  console.log(`higher-higher up on :${port} (api + static from ${distDir})`);
});
