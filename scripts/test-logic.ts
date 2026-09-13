// Pure-logic self-tests. Run with: npm test  (tsx scripts/test-logic.ts)
// Exercises the deterministic game logic without any DOM / Matter.

import { mulberry32 } from "../src/game/rng";
import { makeBlockSpec, shapePoolFor } from "../src/game/shapes";
import { sampleSky, altitude01 } from "../src/game/palette";
import {
  blockHasFallen,
  blocksRemaining,
  detectCollapse,
  formatHeight,
  heightMeters,
  isCleared,
  isNewRecord,
  towerHeightMeters,
  towerTopY,
  type BlockLite,
} from "../src/game/logic";
import { PIXELS_PER_METER, PLATFORM_TOP_Y, TOTAL_BLOCKS } from "../src/game/constants";

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

// ---- shape pool difficulty ramp ----
{
  const early = shapePoolFor(0);
  ok("early pool has no rolly shapes", !early.includes("circle") && !early.includes("triangle"));
  const late = shapePoolFor(30);
  ok("late pool includes circle", late.includes("circle"));
  ok("late pool richer than early", late.length > early.length);
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

  // triangle centroid should sit below geometric centre (apex up => +y)
  const triRng = mulberry32(3);
  let triFound = false;
  for (let i = 0; i < 200 && !triFound; i++) {
    const sp = makeBlockSpec(i, 20, triRng);
    if (sp.kind === "triangle") {
      triFound = true;
      ok("triangle centroid y positive (toward base)", sp.cy > 0);
    }
  }
  ok("found a triangle in sequence", triFound);
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
