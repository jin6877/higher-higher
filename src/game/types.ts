// Shared types for the Higher Higher game.

export type ShapeKind =
  | "square"
  | "rect"
  | "wide"
  | "lshape"
  | "tshape"
  | "triangle"
  | "trapezoid"
  | "circle"
  | "semicircle"
  | "poly"; // irregular convex-ish polygon

export interface BlockSpec {
  /** stable id */
  id: number;
  kind: ShapeKind;
  /** hex fill color */
  color: string;
  /** approx width in world units (bounding) */
  w: number;
  /** approx height in world units (bounding) */
  h: number;
  /** for circle / semicircle */
  radius?: number;
  /** for regular-ish polygons: number of sides */
  sides?: number;
  /** optional explicit vertex path (local coords, centered) for fromVertices */
  vertices?: { x: number; y: number }[];
  /** compound rectangles (local coords) for concave shapes like L / T */
  parts?: { x: number; y: number; w: number; h: number }[];
  /** centre-of-mass offset of the local geometry (for aligning the preview) */
  cx: number;
  cy: number;
  /** whether the shape rolls easily (circle/semicircle/poly) */
  roundish: boolean;
}

export type Phase = "home" | "playing" | "gameover" | "clear";

export interface HudState {
  phase: Phase;
  placed: number; // number of blocks successfully placed (settled)
  total: number; // max blocks (100)
  heightM: number; // current tower height in meters
  bestM: number; // best height record (meters)
  bestBlocks: number;
  awaitingDrop: boolean; // a new block is ready to be aimed & dropped
  altitude01: number; // 0..1 normalized altitude for sky feedback
  wobble: number; // 0..1 instability warning level
  cleared: boolean;
}
