// World + gameplay constants shared by the physics engine and pure logic.
// World units == pixels at zoom 1. Matter uses a y-down coordinate frame:
// the platform top is at y = 0 and the tower grows into negative y.

export const TOTAL_BLOCKS = 100;

/** world units per in-game meter (a typical block ~1m tall) */
export const PIXELS_PER_METER = 36;

/** platform (base) geometry — a wide, forgiving base so early blocks nest easily */
export const PLATFORM_TOP_Y = 0;
export const PLATFORM_WIDTH = 208; // widened ~40% from 148 for an easier start
export const PLATFORM_HEIGHT = 60;

/**
 * How far below the platform top (in world units) a block's centre may drop
 * before it counts as "fallen off" -> collapse -> game over. A resting block
 * always sits at negative y (above the platform), so anything meaningfully
 * positive means it tumbled into the pit. A touch lenient so a block that
 * teeters and recovers isn't punished — but a clear tumble still collapses.
 */
export const FALL_LIMIT = 60;

/** horizontal aim range from centre (world units) — hard clamp for the crane */
export const AIM_RANGE = 150;

/**
 * Auto-swing (crane) parameters. The next block sweeps left↔right on its own;
 * a tap/click/space drops it at the current x. Slow & forgiving early, and only
 * moderately quicker (still fairly relaxed) as the tower grows.
 *
 * The sweep is anchored to the FIXED field centre (the pedestal centre, world
 * x = 0) — NOT the current tower top. This way a leaning tower never drags the
 * sweep with it: you can always aim across the whole play field and drop on the
 * far side / anywhere on the base, no matter which way the stack is tilting.
 */
export const SWING_CENTER_X = 0; // fixed sweep centre = pedestal / play-field centre (world x)
export const SWING_RANGE = AIM_RANGE; // half-width of the sweep — spans the WHOLE field, edge to edge
export const SWING_PERIOD_BASE = 3800; // ms for a full there-and-back at the start (slower)
export const SWING_PERIOD_MIN = 2000; // fastest full cycle high up (still readable)
export const SWING_RAMP_BLOCKS = 80; // blocks over which speed ramps to max (gentler)

/** settle thresholds */
export const SETTLE_SPEED = 0.4;
export const SETTLE_ANGULAR = 0.04;
export const SETTLE_FRAMES = 12; // consecutive calm frames to count as settled
export const SETTLE_MAX_WAIT_MS = 4200; // give up waiting and accept the block

/** fixed physics timestep */
export const FIXED_DT = 1000 / 60;
