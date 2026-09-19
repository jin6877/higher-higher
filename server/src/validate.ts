// 점수 신뢰 경계 = 서버. 클라이언트 게임이라 완전한 치팅 방지는 불가하지만,
// 이름 sanitize + 물리적 상한 clamp 로 명백한 위조/남용을 1차 차단한다.

const MAX_HEIGHT_CM = 100_000; // 1000m — 100블록으로 도달 불가능한 상한
const MAX_BLOCKS = 100; // 게임 상한 TOTAL_BLOCKS

/** 게임 모드 — basic: 정사각형만(쉬움) / random: 랜덤 블록(기존). 순위표를 모드별로 나눈다. */
export const MODES = ["basic", "random"] as const;
export type GameMode = (typeof MODES)[number];
export const DEFAULT_MODE: GameMode = "random";

export function sanitizeMode(raw: unknown): GameMode {
  return MODES.includes(raw as GameMode) ? (raw as GameMode) : DEFAULT_MODE;
}

export interface CleanScore {
  playerName: string;
  heightCm: number;
  blocks: number;
  mode: GameMode;
}

/** 제어문자(코드 < 32, 그리고 DEL=127) 제거 — 정규식 대신 문자코드로 필터해 소스에 제어문자를 넣지 않는다. */
function stripControl(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (code >= 32 && code !== 127) {
      out += ch;
    }
  }
  return out;
}

export function sanitizeName(raw: unknown): string {
  let s = typeof raw === "string" ? raw.trim() : "";
  s = stripControl(s).replace(/\s+/g, " ").trim();
  if (s.length === 0) s = "익명";
  if (s.length > 20) s = s.slice(0, 20);
  return s;
}

function clampInt(v: unknown, max: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : 0;
  return Math.max(0, Math.min(n, max));
}

export function validateScore(body: unknown): CleanScore {
  const b = (body ?? {}) as Record<string, unknown>;
  return {
    playerName: sanitizeName(b.playerName),
    heightCm: clampInt(b.heightCm, MAX_HEIGHT_CM),
    blocks: clampInt(b.blocks, MAX_BLOCKS),
    mode: sanitizeMode(b.mode),
  };
}

// ---- 이용 로그 ----

/** 기록하는 이벤트 종류. 목록에 없는 이름은 버린다(임의 데이터 적재 방지). */
export const EVENT_NAMES = ["visit", "start", "end", "submit", "share", "rank"] as const;
export type EventName = (typeof EVENT_NAMES)[number];

export interface CleanEvent {
  session: string | null;
  name: EventName;
  mode: GameMode | null;
  heightCm: number | null;
  blocks: number | null;
  durationMs: number | null;
}

function clampOrNull(v: unknown, max: number): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.max(0, Math.min(Math.floor(v), max));
}

/** 이벤트 본문 검증. 이름이 목록에 없으면 null 을 돌려 아무것도 남기지 않는다. */
export function validateEvent(body: unknown): CleanEvent | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = b.name;
  if (!EVENT_NAMES.includes(name as EventName)) return null;
  const session = typeof b.session === "string" ? b.session.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) : "";
  return {
    session: session || null,
    name: name as EventName,
    mode: MODES.includes(b.mode as GameMode) ? (b.mode as GameMode) : null,
    heightCm: clampOrNull(b.heightCm, MAX_HEIGHT_CM),
    blocks: clampOrNull(b.blocks, MAX_BLOCKS),
    durationMs: clampOrNull(b.durationMs, 24 * 60 * 60 * 1000),
  };
}
