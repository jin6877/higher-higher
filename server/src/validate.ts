// 점수 신뢰 경계 = 서버. 클라이언트 게임이라 완전한 치팅 방지는 불가하지만,
// 이름 sanitize + 물리적 상한 clamp 로 명백한 위조/남용을 1차 차단한다.

const MAX_HEIGHT_CM = 100_000; // 1000m — 100블록으로 도달 불가능한 상한
const MAX_BLOCKS = 100; // 게임 상한 TOTAL_BLOCKS

export interface CleanScore {
  playerName: string;
  heightCm: number;
  blocks: number;
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
  };
}
