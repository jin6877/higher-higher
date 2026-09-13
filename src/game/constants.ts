// World + gameplay constants shared by the physics engine and pure logic.
// World units == pixels at zoom 1. Matter uses a y-down coordinate frame:
// the platform top is at y = 0 and the tower grows into negative y.

export const TOTAL_BLOCKS = 100;

/** world units per in-game meter (a typical block ~1m tall) */
export const PIXELS_PER_METER = 36;

/** platform (base) geometry */
export const PLATFORM_TOP_Y = 0;
export const PLATFORM_WIDTH = 148;
export const PLATFORM_HEIGHT = 60;

/**
 * How far below the platform top (in world units) a block's centre may drop
 * before it counts as "fallen off" -> collapse -> game over. A resting block
 * always sits at negative y (above the platform), so anything meaningfully
 * positive means it tumbled into the pit.
 */
export const FALL_LIMIT = 40;

/** horizontal aim range from centre (world units) — hard clamp for the crane */
export const AIM_RANGE = 128;

/**
 * Auto-swing (crane) parameters. The next block sweeps left↔right on its own;
 * a tap/click/space drops it at the current x. Slow & forgiving early, quicker
 * (harder timing) as the tower grows.
 */
export const SWING_RANGE = 104; // half-width of the sweep from its centre
export const SWING_PERIOD_BASE = 3000; // ms for a full there-and-back at the start
export const SWING_PERIOD_MIN = 1400; // fastest full cycle high up
export const SWING_RAMP_BLOCKS = 60; // blocks over which speed ramps to max

/** settle thresholds */
export const SETTLE_SPEED = 0.4;
export const SETTLE_ANGULAR = 0.04;
export const SETTLE_FRAMES = 12; // consecutive calm frames to count as settled
export const SETTLE_MAX_WAIT_MS = 4200; // give up waiting and accept the block

/** fixed physics timestep */
export const FIXED_DT = 1000 / 60;
