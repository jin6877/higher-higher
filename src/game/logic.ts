// Pure game logic — no Matter, no DOM (except guarded localStorage helpers).
// These functions are exercised directly by scripts/test-logic.mts.

import { FALL_LIMIT, PIXELS_PER_METER, PLATFORM_TOP_Y, TOTAL_BLOCKS } from "./constants";
import type { GameMode } from "./types";

/** Minimal view of a placed block used for judging the tower. */
export interface BlockLite {
  /** world y of the block centre (y-down: negative == above platform) */
  centerY: number;
  /** world y of the block's top edge (most-negative == highest) */
  topY: number;
  /** whether the block has come to rest */
  settled: boolean;
}

/** A block has tumbled off if its centre drops well below the platform top. */
export function blockHasFallen(
  centerY: number,
  platformTopY = PLATFORM_TOP_Y,
  fallLimit = FALL_LIMIT,
): boolean {
  return centerY > platformTopY + fallLimit;
}

/** Any block fallen off -> the tower has collapsed. */
export function detectCollapse(
  blocks: BlockLite[],
  platformTopY = PLATFORM_TOP_Y,
  fallLimit = FALL_LIMIT,
): boolean {
  for (const b of blocks) {
    if (blockHasFallen(b.centerY, platformTopY, fallLimit)) return true;
  }
  return false;
}

/** World y of the highest point among blocks (most negative). */
export function towerTopY(blocks: BlockLite[]): number {
  if (blocks.length === 0) return PLATFORM_TOP_Y;
  let top = PLATFORM_TOP_Y;
  for (const b of blocks) {
    if (b.topY < top) top = b.topY;
  }
  return top;
}

/** Height of the tower in metres, given the top world-y. */
export function heightMeters(
  topY: number,
  platformTopY = PLATFORM_TOP_Y,
  pxPerM = PIXELS_PER_METER,
): number {
  const worldH = platformTopY - topY; // positive when above platform
  return Math.max(0, worldH / pxPerM);
}

/** Convenience: height in metres directly from blocks. */
export function towerHeightMeters(blocks: BlockLite[]): number {
  return heightMeters(towerTopY(blocks));
}

export function isCleared(placed: number, total = TOTAL_BLOCKS): boolean {
  return placed >= total;
}

export function blocksRemaining(placed: number, total = TOTAL_BLOCKS): number {
  return Math.max(0, total - placed);
}

/** Is candidate record strictly better than the stored one? */
export function isNewRecord(candidateM: number, bestM: number): boolean {
  return candidateM > bestM + 1e-6;
}

/**
 * Running peak of a series of instantaneous heights. The tower's height rises as
 * blocks settle but can *drop* the instant it topples (blocks tumble away). We
 * keep the highest value ever seen so the run is scored by the peak it reached,
 * not by whatever is left standing after a collapse.
 */
export function trackPeak(peak: number, current: number): number {
  return current > peak ? current : peak;
}

export function formatHeight(m: number): string {
  if (m >= 100) return m.toFixed(0);
  return m.toFixed(1);
}

// ---- localStorage record persistence (guarded, side-effectful) ----

// 모드마다 따로 보관한다 — 쉬운 모드 기록이 도전 모드 최고 기록을 덮어쓰면 안 된다.
// 기존 키(v1)는 모드가 생기기 전 기록이라 그대로 도전 모드 기록으로 쓴다.
const REC_KEY = "higher-higher:best:v1";
const recKey = (mode: GameMode) => (mode === "random" ? REC_KEY : `${REC_KEY}:${mode}`);

export interface Record {
  heightM: number;
  blocks: number;
}

export function loadRecord(mode: GameMode = "random"): Record {
  try {
    const raw = typeof localStorage !== "undefined" && localStorage.getItem(recKey(mode));
    if (!raw) return { heightM: 0, blocks: 0 };
    const parsed = JSON.parse(raw);
    return {
      heightM: Number(parsed.heightM) || 0,
      blocks: Number(parsed.blocks) || 0,
    };
  } catch {
    return { heightM: 0, blocks: 0 };
  }
}

/** Persist a run if it beats the stored record. Returns the (possibly updated) record. */
export function saveRecord(heightM: number, blocks: number, mode: GameMode = "random"): Record {
  const cur = loadRecord(mode);
  const next: Record = {
    heightM: Math.max(cur.heightM, heightM),
    blocks: Math.max(cur.blocks, blocks),
  };
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(recKey(mode), JSON.stringify(next));
    }
  } catch {
    // ignore quota / privacy-mode errors
  }
  return next;
}
