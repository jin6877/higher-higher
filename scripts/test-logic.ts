// Pure-logic self-tests. Run with: npm test  (tsx scripts/test-logic.ts)
// Exercises the deterministic game logic without any DOM / Matter.

import { mulberry32 } from "../src/game/rng";
import { makeBlockSpec, shapePoolFor } from "../src/game/shapes";
import { swingOffset, swingPeriodMs } from "../src/game/swing";
import { sampleSky, altitude01 } from "../src/game/palette";
import {
  blockHasFallen,
  blocksRemaining,
  detectCollapse,
  formatHeight,
  heightMeters,
  isCleared,
  isNewRecord,
  saveRecord,
  towerHeightMeters,
  towerTopY,
  trackPeak,
  type BlockLite,
} from "../src/game/logic";
import {
  AIM_RANGE,
  FALL_LIMIT,
  PIXELS_PER_METER,
  PLATFORM_TOP_Y,
  PLATFORM_WIDTH,
  SWING_CENTER_X,
  SWING_PERIOD_BASE,
  SWING_PERIOD_MIN,
  SWING_RANGE,
  TOTAL_BLOCKS,
} from "../src/game/constants";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

function approx(a: number, b: number, eps = 1e-6) {
  return Math.abs(a - b) <= eps;
}

// ---- RNG determinism ----
{
  const a = mulberry32(42);
  const b = mulberry32(42);
  ok("rng deterministic", a() === b() && a() === b());
  const r = mulberry32(1);
  let inRange = true;
  for (let i = 0; i < 1000; i++) {
    const v = r();
    if (v < 0 || v >= 1) inRange = false;
  }
  ok("rng in [0,1)", inRange);
}

// ---- shape pool difficulty ramp (rolly shapes pushed later & kept rare) ----
{
  const early = shapePoolFor(0);
  ok("early pool has no rolly shapes", !early.includes("circle"));
  const late = shapePoolFor(60);
  ok("late pool includes circle", late.includes("circle"));
  ok("late pool richer than early", late.length > early.length);

  // round shapes (circle/semicircle) only appear from the mid-tower on
  const roundBefore = (i: number) =>
    shapePoolFor(i).some((k) => k === "circle" || k === "semicircle");
  ok("no round shapes before block 45", !roundBefore(20) && !roundBefore(44));
  ok("round shapes present from block 45", roundBefore(45));

  // the mildly-rolly polygon is delayed too (introduced around block 28)
  ok("no poly in the early flat stretch", !shapePoolFor(13).includes("poly"));
  ok("poly appears by mid-tower", shapePoolFor(45).includes("poly"));

  // rolly shapes stay the exception: flats out-weight round in the full pool
  const full = shapePoolFor(60);
  const round = full.filter((k) => k === "circle" || k === "semicircle").length;
  ok("round shapes are a minority of the full pool", round * 3 <= full.length);
}

// ---- triangle fully removed from the shape system ----
{
  let poolHasTriangle = false;
  for (let idx = 0; idx <= 220; idx++) {
    if ((shapePoolFor(idx) as string[]).includes("triangle")) poolHasTriangle = true;
  }
  ok("no shape pool ever contains triangle", !poolHasTriangle);

  const rng = mulberry32(2024);
  let generatedTriangle = false;
  for (let i = 0; i < 3000; i++) {
    const spec = makeBlockSpec(i, i % 130, rng);
    if ((spec.kind as string) === "triangle") generatedTriangle = true;
  }
  ok("makeBlockSpec never generates a triangle", !generatedTriangle);
}

// ---- auto-swing (crane) math ----
{
  ok("swing starts centred", swingOffset(0, 100, 2000) === 0);
  const quarter = swingOffset(500, 100, 2000); // t = period/4 -> +range
  ok("swing reaches +range at quarter period", approx(quarter, 100, 1e-6));
  const threeQuarter = swingOffset(1500, 100, 2000); // -range
  ok("swing reaches -range at 3/4 period", approx(threeQuarter, -100, 1e-6));

  let bounded = true;
  for (let t = 0; t <= 6000; t += 37) {
    const x = swingOffset(t, 104, 1800);
    if (x < -104.0001 || x > 104.0001) bounded = false;
  }
  ok("swing stays within [-range, range]", bounded);

  ok("swing degenerate period is safe", swingOffset(123, 100, 0) === 0);

  // period ramps: slow at the start, fast (and floored) higher up
  ok("period is base at start", swingPeriodMs(0, 3000, 1400, 60) === 3000);
  ok("period is min once ramped", swingPeriodMs(60, 3000, 1400, 60) === 1400);
  ok("period clamps beyond ramp", swingPeriodMs(999, 3000, 1400, 60) === 1400);
  ok(
    "period decreases as tower grows",
    swingPeriodMs(30, 3000, 1400, 60) < swingPeriodMs(5, 3000, 1400, 60),
  );
}

// ---- eased difficulty defaults (wider base + slower, gentler swing) ----
{
  // the base platform is meaningfully wider than the original 148 units
  ok("platform widened for an easier start", PLATFORM_WIDTH >= 200);
  ok("aim range covers the wider platform", AIM_RANGE >= PLATFORM_WIDTH / 2);

  // the sweep is anchored to the FIXED field centre (pedestal centre = world x 0),
  // NOT the current tower top — so a leaning stack can't drag the sweep sideways.
  ok("swing is centred on the fixed field centre", SWING_CENTER_X === 0);

  // the sweep now spans the WHOLE play field (edge to edge), covering the entire
  // base and beyond, so you can aim anywhere — even the far side of a leaning tower.
  ok("swing amplitude spans the whole base", SWING_RANGE >= PLATFORM_WIDTH / 2);
  ok("swing amplitude covers the full field", SWING_RANGE >= AIM_RANGE);
  ok("swing stays within the hard aim clamp", SWING_RANGE <= AIM_RANGE);

  // with the fixed centre + full range, the sweep reaches both play-field edges
  // symmetrically about the centre (never biased toward one side).
  ok(
    "sweep reaches the field's left & right edges symmetrically",
    approx(SWING_CENTER_X - SWING_RANGE, -AIM_RANGE) &&
      approx(SWING_CENTER_X + SWING_RANGE, AIM_RANGE),
  );

  // swing is slow to begin and only moderately faster at the top
  ok("default swing starts slow", swingPeriodMs(0) === SWING_PERIOD_BASE);
  ok("default swing is slower than the legacy 3000ms start", SWING_PERIOD_BASE >= 3600);
  ok("even the fastest swing stays readable", SWING_PERIOD_MIN >= 1800);
  ok("swing eases from base down to min", SWING_PERIOD_BASE > SWING_PERIOD_MIN);
  ok(
    "default period eases toward min as tower grows",
    swingPeriodMs(80) === SWING_PERIOD_MIN && swingPeriodMs(10) > SWING_PERIOD_MIN,
  );

  // collapse judging is a touch more forgiving than before (was 40)
  ok("fall limit is a little more lenient", FALL_LIMIT >= 50);
}

// ---- block spec generation ----
{
  const rng = mulberry32(7);
  let allValid = true;
  const kinds = new Set<string>();
  for (let i = 0; i < 120; i++) {
    const spec = makeBlockSpec(i, i, rng);
    kinds.add(spec.kind);
    if (!(spec.w > 0 && spec.h > 0)) allValid = false;
    if (!Number.isFinite(spec.cx) || !Number.isFinite(spec.cy)) allValid = false;
    if (spec.parts) {
      for (const p of spec.parts) if (!(p.w > 0 && p.h > 0)) allValid = false;
    }
    if (spec.vertices && spec.vertices.length < 3) allValid = false;
  }
  ok("all specs valid geometry", allValid);
  ok("variety of shapes generated", kinds.size >= 6);

  // deterministic with same seed
  const r1 = mulberry32(99);
  const r2 = mulberry32(99);
  const s1 = makeBlockSpec(0, 20, r1);
  const s2 = makeBlockSpec(0, 20, r2);
  ok("spec deterministic by seed", s1.kind === s2.kind && approx(s1.w, s2.w));
}

// ---- fall / collapse detection ----
{
  ok("resting block above platform is fine", !blockHasFallen(-30));
  ok("block far below platform has fallen", blockHasFallen(PLATFORM_TOP_Y + 200));
  ok("block just under threshold ok", !blockHasFallen(PLATFORM_TOP_Y + 10));

  const stable: BlockLite[] = [
    { centerY: -20, topY: -40, settled: true },
    { centerY: -60, topY: -80, settled: true },
  ];
  ok("stable tower not collapsed", !detectCollapse(stable));

  const collapsed: BlockLite[] = [
    { centerY: -20, topY: -40, settled: true },
    { centerY: 300, topY: 260, settled: false }, // fell into the pit
  ];
  ok("fallen block => collapse", detectCollapse(collapsed));
}

// ---- height / scoring ----
{
  ok("empty tower top is platform", towerTopY([]) === PLATFORM_TOP_Y);
  const blocks: BlockLite[] = [
    { centerY: -30, topY: -60, settled: true },
    { centerY: -110, topY: -150, settled: true },
  ];
  ok("tower top is most-negative", towerTopY(blocks) === -150);
  ok("height meters from top", approx(heightMeters(-PIXELS_PER_METER * 5), 5));
  ok("height never negative", heightMeters(PLATFORM_TOP_Y + 50) === 0);
  ok("towerHeightMeters composes", approx(towerHeightMeters(blocks), 150 / PIXELS_PER_METER));
}

// ---- clear / remaining / record ----
{
  ok("not cleared under total", !isCleared(50));
  ok("cleared at total", isCleared(TOTAL_BLOCKS));
  ok("remaining computes", blocksRemaining(30) === 70);
  ok("remaining clamps", blocksRemaining(120) === 0);
  ok("new record when higher", isNewRecord(12.5, 10));
  ok("not new record when lower", !isNewRecord(8, 10));
}

// ---- peak-height tracking (record is the peak reached, not the post-collapse height) ----
{
  ok("peak keeps the larger value", trackPeak(4, 7) === 7 && trackPeak(9, 3) === 9);
  ok("peak ignores a drop", trackPeak(12.5, 12.5 - 4) === 12.5);

  // simulate a run whose height climbs, then collapses: 0 → up to 8.4 → tumbles to 1.2
  const series = [0, 1.5, 3.2, 5.0, 6.7, 8.4, 5.1, 2.0, 1.2];
  let peak = 0;
  for (const h of series) peak = trackPeak(peak, h);
  ok("peak is the max reached during the run", approx(peak, 8.4));
  ok("peak is not the final (post-collapse) height", peak > series[series.length - 1]);

  // the finalized record uses the peak, so a collapse can't shrink the score
  const finalHeight = series[series.length - 1]; // 1.2 after tumbling
  const rec = saveRecord(peak, 12); // in Node there's no localStorage -> starts from {0,0}
  ok("saved record equals the peak, not the collapsed height", approx(rec.heightM, 8.4));
  ok("saving the collapsed height would have been worse", finalHeight < rec.heightM);
  ok("peak-blocks preserved in record", rec.blocks === 12);
}

// ---- formatting ----
{
  ok("format one decimal under 100", formatHeight(12.34) === "12.3");
  ok("format no decimal at/over 100", formatHeight(120.7) === "121");
}

// ---- sky sampling ----
{
  const ground = sampleSky(0);
  const space = sampleSky(200);
  ok("ground has no stars", ground.stars === 0);
  ok("space is full of stars", space.stars === 1);
  ok("space darker than ground (top)", space.top[2] < ground.top[2]);
  ok("altitude01 clamps", altitude01(9999) === 1 && altitude01(-5) === 0);
  const mid = sampleSky(60);
  ok("mid sky interpolates stars", mid.stars > 0 && mid.stars < 1);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
