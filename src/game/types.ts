// Shared types for the Higher Higher game.

export type ShapeKind =
  | "square"
  | "rect"
  | "wide"
  | "lshape"
  | "tshape"
  | "trapezoid"
  | "circle"
  | "semicircle"
  | "poly"; // irregular convex-ish polygon

/** Minimal shape info shown in the HUD "next block" preview. */
export interface BlockPreview {
  kind: ShapeKind;
  color: string;
  /** bounding-box width in world units (for the size label) */
  w: number;
  /** bounding-box height in world units (for the size label) */
  h: number;
  /** radius (circle only) in world units */
  radius?: number;
}

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
  peakM: number; // highest height reached this run (survives a collapse)
  peakBlocks: number; // most blocks standing this run (survives a collapse)
  bestM: number; // best height record (meters)
  bestBlocks: number;
  awaitingDrop: boolean; // a new block is ready to be aimed & dropped
  altitude01: number; // 0..1 normalized altitude for sky feedback
  wobble: number; // 0..1 instability warning level
  cleared: boolean;
  /** the block that will drop next (after the current one) — HUD preview */
  next: BlockPreview | null;
}
