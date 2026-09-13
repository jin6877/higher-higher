// Pure block-shape generation. Given a block index + RNG it produces a
// BlockSpec describing geometry (in world units) that the physics engine
// turns into a Matter body. Kept free of Matter so it stays unit-testable.

import { BLOCK_COLORS } from "./palette";
import { pick, randInt, randRange, type Rng } from "./rng";
import type { BlockSpec, ShapeKind } from "./types";

export interface CompoundPart {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ResolvedShape {
  kind: ShapeKind;
  w: number;
  h: number;
  radius?: number;
  vertices?: { x: number; y: number }[];
  /** compound rectangles for concave shapes (L / T) */
  parts?: CompoundPart[];
  cx: number;
  cy: number;
  roundish: boolean;
}

function polygonCentroid(pts: { x: number; y: number }[]): { x: number; y: number } {
  let a = 0;
  let cx = 0;
  let cy = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-6) return { x: 0, y: 0 };
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

function partsCentroid(parts: CompoundPart[]): { x: number; y: number } {
  let A = 0;
  let cx = 0;
  let cy = 0;
  for (const p of parts) {
    const a = p.w * p.h;
    A += a;
    cx += p.x * a;
    cy += p.y * a;
  }
  if (A < 1e-6) return { x: 0, y: 0 };
  return { x: cx / A, y: cy / A };
}

function trapezoidVerts(bottom: number, top: number, h: number) {
  return [
    { x: -bottom / 2, y: h / 2 },
    { x: bottom / 2, y: h / 2 },
    { x: top / 2, y: -h / 2 },
    { x: -top / 2, y: -h / 2 },
  ];
}

function semicircleVerts(r: number, seg = 14) {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= seg; i++) {
    const t = (Math.PI * i) / seg; // 0..PI
    pts.push({ x: -r * Math.cos(t), y: r / 2 - r * Math.sin(t) });
  }
  return pts;
}

function polyVerts(rng: Rng, rx: number, ry: number, n: number) {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const base = (Math.PI * 2 * i) / n;
    const jitter = randRange(rng, -0.18, 0.18);
    const a = base + jitter;
    const rr = randRange(rng, 0.78, 1);
    pts.push({ x: Math.cos(a) * rx * rr, y: Math.sin(a) * ry * rr });
  }
  return pts;
}

/** The pool of shape kinds available at a given block index (difficulty ramp). */
export function shapePoolFor(index: number): ShapeKind[] {
  if (index < 1) return ["wide"]; // guaranteed wide, stable foundation
  if (index < 4) return ["square", "wide", "wide", "rect"];
  // long early stretch: only flat-topped shapes so a well-aimed drop always nests
  if (index < 14) return ["square", "wide", "rect", "trapezoid"];
  // add concave (L / T) shapes but still nothing that rolls
  if (index < 28)
    return ["square", "rect", "wide", "trapezoid", "lshape", "tshape"];
  // introduce the mildly-rolly polygon, kept rare (1 of 7)
  if (index < 45)
    return ["square", "rect", "wide", "trapezoid", "lshape", "tshape", "poly"];
  // full pool from ~half-way up — flats weighted heavier so round shapes
  // (semicircle / circle) stay the exception, not the rule
  return [
    "square",
    "square",
    "rect",
    "rect",
    "wide",
    "wide",
    "trapezoid",
    "lshape",
    "tshape",
    "poly",
    "semicircle",
    "circle",
  ];
}

function fromVerts(kind: ShapeKind, w: number, h: number, verts: { x: number; y: number }[], roundish: boolean): ResolvedShape {
  const c = polygonCentroid(verts);
  return { kind, w, h, vertices: verts, cx: c.x, cy: c.y, roundish };
}

function fromParts(kind: ShapeKind, w: number, h: number, parts: CompoundPart[]): ResolvedShape {
  const c = partsCentroid(parts);
  return { kind, w, h, parts, cx: c.x, cy: c.y, roundish: false };
}

function resolve(kind: ShapeKind, rng: Rng): ResolvedShape {
  switch (kind) {
    case "square": {
      const s = randRange(rng, 46, 60);
      return { kind, w: s, h: s, cx: 0, cy: 0, roundish: false };
    }
    case "rect": {
      const w = randRange(rng, 40, 52);
      const h = randRange(rng, 46, 62);
      return { kind, w, h, cx: 0, cy: 0, roundish: false };
    }
    case "wide": {
      const w = randRange(rng, 66, 96);
      const h = randRange(rng, 30, 42);
      return { kind, w, h, cx: 0, cy: 0, roundish: false };
    }
    case "trapezoid": {
      const bottom = randRange(rng, 56, 74);
      const top = randRange(rng, 30, 46);
      const h = randRange(rng, 34, 48);
      return fromVerts(kind, bottom, h, trapezoidVerts(bottom, top, h), false);
    }
    case "lshape": {
      const t = randRange(rng, 22, 28);
      const len = randRange(rng, 50, 64);
      // clean L tiling (no overlap): left bar + bottom foot
      const parts: CompoundPart[] = [
        { x: -len / 2 + t / 2, y: 0, w: t, h: len },
        { x: t / 2, y: len / 2 - t / 2, w: len - t, h: t },
      ];
      return fromParts(kind, len, len, parts);
    }
    case "tshape": {
      const t = randRange(rng, 22, 28);
      const span = randRange(rng, 54, 68);
      const stem = randRange(rng, 42, 52);
      const parts: CompoundPart[] = [
        { x: 0, y: -(stem) / 2 + t / 2, w: span, h: t }, // top bar
        { x: 0, y: t / 2, w: t, h: stem - t }, // stem below bar
      ];
      return fromParts(kind, span, stem, parts);
    }
    case "semicircle": {
      const r = randRange(rng, 26, 34);
      return fromVerts(kind, 2 * r, r, semicircleVerts(r), true);
    }
    case "circle": {
      const r = randRange(rng, 18, 26);
      return { kind, w: 2 * r, h: 2 * r, radius: r, cx: 0, cy: 0, roundish: true };
    }
    case "poly": {
      const rx = randRange(rng, 24, 32);
      const ry = randRange(rng, 22, 30);
      const n = randInt(rng, 5, 7);
      return fromVerts(kind, rx * 2, ry * 2, polyVerts(rng, rx, ry, n), true);
    }
  }
}

export function makeBlockSpec(
  id: number,
  index: number,
  rng: Rng,
  avoidColor?: string,
): BlockSpec {
  const pool = shapePoolFor(index);
  const kind = pick(rng, pool);
  const shape = resolve(kind, rng);

  let color = pick(rng, BLOCK_COLORS);
  if (avoidColor) {
    let guard = 0;
    while (color === avoidColor && guard++ < 6) color = pick(rng, BLOCK_COLORS);
  }

  return {
    id,
    kind,
    color,
    w: shape.w,
    h: shape.h,
    radius: shape.radius,
    vertices: shape.vertices,
    parts: shape.parts,
    cx: shape.cx,
    cy: shape.cy,
    roundish: shape.roundish,
  };
}

// Re-export resolve so the engine can rebuild geometry deterministically
// from a kind if needed (engine actually uses BlockSpec directly, but this
// keeps resolution logic in one place).
export { resolve as resolveShape };
