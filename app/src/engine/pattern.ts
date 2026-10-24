import type { Pattern } from './ops.ts';

/** 4×4 ordered-dither thresholds (0-15). */
export const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** Does the ordered dither put the "next" colour on (x, y) for a fraction f (0 … 1) of the way to it? */
export function ditherNext(x: number, y: number, f: number): boolean {
  return BAYER4[y & 3][x & 3] < f * 16;
}

/** Where (x, y) falls along a pattern, 0 … 1. */
export function patternT(p: Pattern, x: number, y: number): number {
  let t: number;
  if (p.t !== undefined) t = p.t;
  else {
    const x1 = p.x1 ?? 0;
    const y1 = p.y1 ?? 0;
    const dx = (p.x2 ?? 0) - x1;
    const dy = (p.y2 ?? 0) - y1;
    if (p.kind === 'radial') {
      const r = Math.hypot(dx, dy);
      t = r > 0 ? Math.hypot(x - x1, y - y1) / r : 0;
    } else {
      const l2 = dx * dx + dy * dy;
      t = l2 > 0 ? ((x - x1) * dx + (y - y1) * dy) / l2 : 0;
    }
  }
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** The colour a pattern puts on pixel (x, y). */
export function patternColor(p: Pattern, x: number, y: number): number {
  const n = p.colors.length;
  if (n === 1) return p.colors[0];
  const s = patternT(p, x, y) * (n - 1);
  const k = Math.min(Math.floor(s), n - 2);
  return ditherNext(x, y, s - k) ? p.colors[k + 1] : p.colors[k];
}

/** The light level (0 … steps) a glow puts on (x, y): rises from the rim to the centre (as the square of the distance in from the rim, so it fades out softly), dithered. */
export function glowLevel(cx: number, cy: number, rx: number, ry: number, steps: number, x: number, y: number): number {
  const u = rx > 0 ? (x - cx) / rx : x === cx ? 0 : 2;
  const v = ry > 0 ? (y - cy) / ry : y === cy ? 0 : 2;
  const d = Math.sqrt(u * u + v * v);
  if (d >= 1) return 0;
  const s = (1 - d) * (1 - d) * steps;
  const k = Math.floor(s);
  return Math.min(steps, k + (ditherNext(x, y, s - k) ? 1 : 0));
}
