// Pure auto-oscillation ("swing"/crane) math for the aiming block.
// The next block sweeps horizontally on its own and the player taps to drop it
// at the current position. Kept free of DOM / Matter so it stays unit-testable.

import {
  SWING_PERIOD_BASE,
  SWING_PERIOD_MIN,
  SWING_RAMP_BLOCKS,
} from "./constants";

/**
 * Full round-trip period (ms) of the swing, easing faster as the tower grows.
 * Slow and forgiving early; quicker (harder timing) higher up.
 */
export function swingPeriodMs(
  placed: number,
  base = SWING_PERIOD_BASE,
  min = SWING_PERIOD_MIN,
  rampOver = SWING_RAMP_BLOCKS,
): number {
  const t = Math.min(1, Math.max(0, placed / rampOver));
  return base - (base - min) * t;
}

/**
 * Horizontal offset of the swinging block at a given elapsed time.
 * A sine sweep in [-range, +range]: starts centred (0) moving right, eases to a
 * stop at each edge, then returns — a pendulum / crane feel. `periodMs` is a full
 * cycle (centre → right → centre → left → centre).
 */
export function swingOffset(
  elapsedMs: number,
  range: number,
  periodMs: number,
): number {
  if (periodMs <= 0) return 0;
  return range * Math.sin((2 * Math.PI * elapsedMs) / periodMs);
}
