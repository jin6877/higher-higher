// Pure block-dimension helpers. Turns a block's world-unit bounding box into a
// human-readable size label in metres, matching the HUD's height unit (m) so the
// on-block dimension labels use the same scale as the altitude read-out.
//
// Kept free of Matter / DOM so it stays unit-testable and can be shared by the
// canvas renderer (engine) and the React HUD preview.

import { PIXELS_PER_METER } from "./constants";
import type { ShapeKind } from "./types";

/** Convert a world-unit length (px at zoom 1) into in-game metres. */
export function worldToMeters(px: number, pxPerM: number = PIXELS_PER_METER): number {
  return px / pxPerM;
}

/** Read-friendly metres: one decimal place (e.g. 1.0, 2.4). */
export function formatDim(m: number): string {
  // guard tiny negative zero / float noise, then fix to 1 decimal
  return (Math.max(0, m) + 1e-9).toFixed(1);
}

/** Minimal geometry needed to describe a block's size. */
export interface DimInput {
  kind: ShapeKind;
  /** bounding-box width in world units */
  w: number;
  /** bounding-box height in world units */
  h: number;
  /** radius (circle only) in world units */
  radius?: number;
}

/**
 * A block's size label in metres.
 *  - circle: diameter form, e.g. `⌀1.2`
 *  - everything else: `가로 × 세로` bounding box, e.g. `2.4 × 1.0`
 */
export function dimLabel(spec: DimInput, pxPerM: number = PIXELS_PER_METER): string {
  if (spec.kind === "circle") {
    const d = spec.radius != null ? spec.radius * 2 : spec.w;
    return `⌀${formatDim(worldToMeters(d, pxPerM))}`;
  }
  const w = formatDim(worldToMeters(spec.w, pxPerM));
  const h = formatDim(worldToMeters(spec.h, pxPerM));
  return `${w} × ${h}`;
}
