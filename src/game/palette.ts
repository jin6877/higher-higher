// Brand palette + sky layer definitions.
//
// Distinct from the other side-apps: signature is a candy-sunrise accent
// (hot pink -> warm gold) over a deep indigo night base, with a sky that
// morphs from dawn -> day -> stratosphere -> deep space as the tower climbs.

/** Candy block tones — bright & saturated, but a coherent family. */
export const BLOCK_COLORS = [
  "#FF6B9D", // candy pink
  "#FFD166", // warm gold
  "#06D6A0", // mint
  "#4CC9F0", // sky cyan
  "#C77DFF", // soft violet
  "#FF9E64", // tangerine
  "#8AE234", // lime pop
  "#FF5D8F", // deep rose
] as const;

export const BRAND = {
  pink: "#FF6B9D",
  gold: "#FFD166",
  cyan: "#4CC9F0",
  indigo: "#0b1026",
  indigo2: "#141a3c",
};

export interface SkyLayer {
  /** altitude in meters where this layer is centered */
  at: number;
  /** gradient stops top -> bottom (screen top to bottom) */
  top: [number, number, number];
  mid: [number, number, number];
  bottom: [number, number, number];
  /** 0..1 how many stars are visible at this layer */
  stars: number;
}

// Warm dawn on the ground, brightening to day, then deepening into
// stratosphere blue and finally the black of space.
export const SKY_LAYERS: SkyLayer[] = [
  {
    at: 0,
    top: [36, 48, 92],
    mid: [78, 112, 170],
    bottom: [252, 178, 128], // peach horizon glow
    stars: 0,
  },
  {
    at: 22,
    top: [40, 118, 196],
    mid: [96, 168, 224],
    bottom: [196, 230, 252],
    stars: 0,
  },
  {
    at: 48,
    top: [24, 84, 168],
    mid: [58, 128, 200],
    bottom: [128, 190, 236],
    stars: 0.06,
  },
  {
    at: 74,
    top: [12, 40, 104],
    mid: [26, 70, 150],
    bottom: [66, 120, 192],
    stars: 0.35,
  },
  {
    at: 100,
    top: [6, 12, 48],
    mid: [14, 30, 88],
    bottom: [30, 58, 128],
    stars: 0.7,
  },
  {
    at: 140,
    top: [2, 3, 14],
    mid: [6, 10, 34],
    bottom: [14, 22, 62],
    stars: 1,
  },
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerp3(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export function rgb([r, g, b]: [number, number, number], alpha = 1): string {
  const R = Math.round(r);
  const G = Math.round(g);
  const B = Math.round(b);
  return alpha >= 1 ? `rgb(${R}, ${G}, ${B})` : `rgba(${R}, ${G}, ${B}, ${alpha})`;
}

export interface SkySample {
  top: [number, number, number];
  mid: [number, number, number];
  bottom: [number, number, number];
  stars: number;
}

/** Interpolate the sky gradient for a given altitude in meters. */
export function sampleSky(altitudeM: number): SkySample {
  const layers = SKY_LAYERS;
  if (altitudeM <= layers[0].at) {
    const l = layers[0];
    return { top: l.top, mid: l.mid, bottom: l.bottom, stars: l.stars };
  }
  const last = layers[layers.length - 1];
  if (altitudeM >= last.at) {
    return { top: last.top, mid: last.mid, bottom: last.bottom, stars: last.stars };
  }
  for (let i = 0; i < layers.length - 1; i++) {
    const a = layers[i];
    const b = layers[i + 1];
    if (altitudeM >= a.at && altitudeM <= b.at) {
      const t = (altitudeM - a.at) / (b.at - a.at);
      // smoothstep for gentler transitions
      const s = t * t * (3 - 2 * t);
      return {
        top: lerp3(a.top, b.top, s),
        mid: lerp3(a.mid, b.mid, s),
        bottom: lerp3(a.bottom, b.bottom, s),
        stars: lerp(a.stars, b.stars, s),
      };
    }
  }
  return { top: last.top, mid: last.mid, bottom: last.bottom, stars: last.stars };
}

/** Normalized altitude 0..1 across the full climb, for HUD accents. */
export function altitude01(altitudeM: number): number {
  const max = SKY_LAYERS[SKY_LAYERS.length - 1].at;
  return Math.max(0, Math.min(1, altitudeM / max));
}
