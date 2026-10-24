// Brushstrokes in a hybrid layout sketch (docs/PLAN.md §16): thick paint, told apart from pen work
// (words, pencil lines, arrows) by its width, grouped by colour, and described as lines, loops,
// fills or dabs in picture coordinates. Advisory: it says what it found and how sure it is, and
// view.png stays the authority (no rule can always tell a bold "O" from a round dab of paint).
// Pure functions, used by `pnpm grid` and tested directly.
import { PIC } from './geometry.ts';
import { COLOR_NAMES, EGA_PALETTE } from '../../src/engine/palette.ts';
import { paperTable, type InkBlob, type PaperField } from './sketch.ts';
import type { RgbaImage } from './png.ts';

type Pt = [number, number];
type Rgb = [number, number, number];

export interface StrokeLayer {
  id: number;
  /** median colour of the layer's solid paint */
  rgb: Rgb;
  /** the nearest EGA colour (a hint for matching, not the colour to paint) */
  ega: string;
  /** a plain colour name: green, olive, brown, grey, pale blue, … */
  name: string;
  /** low when the colour rests on few solid pixels (thin or faint paint) */
  confidence: 'high' | 'low';
  pixels: number;
}

export interface BrushStroke {
  id: number;
  layer: number;
  colour: string;
  /** line: an open stroke (centre line given); loop: a closed outline round an area; fill: a
   *  scribble or patch of paint; dab: a short blob of paint */
  class: 'line' | 'loop' | 'fill' | 'dab';
  /** the brush's width in picture columns and rows (a dab: its size) */
  width: [number, number];
  /** bounding box in continuous picture coordinates: x0, y0, x1, y1 */
  box: [number, number, number, number];
  centre: Pt;
  /** canvas edges it touches */
  edges: ('left' | 'right' | 'top' | 'bottom')[];
  /** a line's centre line, upper end first */
  line?: Pt[];
  /** a loop's or fill's outline (filled: the area it encloses, the paint included) */
  outline?: Pt[];
  /** a line's ends after small spurs are pruned: more than 2 means branches or crossing strokes */
  ends?: number;
  /** a branched line's arms, each from its end in to the first junction */
  branches?: Pt[][];
  /** pen blobs (1-based, as in the blob table) inside it or near it, nearest first */
  words: { blob: number; inside: boolean; distance: number }[];
  flags: string[];
  pixels: number;
}

export interface StrokeResult {
  layers: StrokeLayer[];
  strokes: BrushStroke[];
  /** is native pixel (x, y) brush paint, or its rim? (for taking it out of the pen blobs) */
  isBrush: (x: number, y: number) => boolean;
}

// ---- colour ----------------------------------------------------------------------------------

function toLab([r, g, b]: Rgb): [number, number, number] {
  const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
  const y = f(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** CIEDE2000 colour difference. */
export function deltaE00(l1: readonly number[], l2: readonly number[]): number {
  const [L1, a1, b1] = l1;
  const [L2, a2, b2] = l2;
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const [ap1, ap2] = [a1 * (1 + G), a2 * (1 + G)];
  const [Cp1, Cp2] = [Math.hypot(ap1, b1), Math.hypot(ap2, b2)];
  const hue = (b: number, a: number) => (b === 0 && a === 0 ? 0 : (Math.atan2(b, a) / rad + 360) % 360);
  const [hp1, hp2] = [hue(b1, ap1), hue(b2, ap2)];
  const dL = L2 - L1;
  const dC = Cp2 - Cp1;
  let dh = 0;
  if (Cp1 * Cp2 !== 0) dh = hp2 - hp1 > 180 ? hp2 - hp1 - 360 : hp2 - hp1 < -180 ? hp2 - hp1 + 360 : hp2 - hp1;
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dh / 2) * rad);
  const Lb = (L1 + L2) / 2;
  const Cpb = (Cp1 + Cp2) / 2;
  let hb = hp1 + hp2;
  if (Cp1 * Cp2 !== 0) hb = Math.abs(hp1 - hp2) > 180 ? (hp1 + hp2 + (hp1 + hp2 < 360 ? 360 : -360)) / 2 : (hp1 + hp2) / 2;
  const T = 1 - 0.17 * Math.cos((hb - 30) * rad) + 0.24 * Math.cos(2 * hb * rad) + 0.32 * Math.cos((3 * hb + 6) * rad) - 0.2 * Math.cos((4 * hb - 63) * rad);
  const SL = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2);
  const SC = 1 + 0.045 * Cpb;
  const SH = 1 + 0.015 * Cpb * T;
  const RT = -2 * Math.sqrt(Cpb ** 7 / (Cpb ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hb - 275) / 25) ** 2)) * rad);
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}

/** A plain name for a paint colour, from its hue, saturation and value. */
export function colourName([r, g, b]: Rgb): string {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const s = max ? (max - min) / max : 0;
  const v = max;
  if (s < 0.18) return v < 0.2 ? 'black' : v < 0.45 ? 'dark grey' : v < 0.75 ? 'grey' : v < 0.92 ? 'light grey' : 'white';
  let h = 0;
  const d = max - min;
  if (max === r / 255) h = 60 * ((((g - b) / 255) / d) % 6);
  else if (max === g / 255) h = 60 * (((b - r) / 255) / d + 2);
  else h = 60 * (((r - g) / 255) / d + 4);
  h = (h + 360) % 360;
  if (h < 15 || h >= 340) return v < 0.5 ? 'dark red' : s < 0.45 ? 'pink' : 'red';
  if (h < 45) return v < 0.65 ? 'brown' : 'orange';
  if (h < 70) return v < 0.6 ? 'olive' : 'yellow';
  if (h < 165) return v < 0.45 ? 'dark green' : 'green';
  if (h < 200) return 'cyan';
  if (h < 260) return s < 0.45 && v > 0.75 ? 'pale blue' : 'blue';
  if (h < 300) return 'purple';
  return 'magenta';
}

function nearestEga(rgb: Rgb): string {
  let best = 0;
  let bd = Infinity;
  const lab = toLab(rgb);
  EGA_PALETTE.forEach((p, i) => {
    const d = deltaE00(lab, toLab([p[0], p[1], p[2]]));
    if (d < bd) (bd = d), (best = i);
  });
  return COLOR_NAMES[best];
}

// ---- distance transforms ---------------------------------------------------------------------

/** Squared Euclidean distance from every pixel to the nearest pixel where `target` is set
 * (Felzenszwalb-Huttenlocher, exact). */
export function distance2(target: Uint8Array, w: number, h: number): Float64Array {
  const INF = 1e20;
  const out = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = target[i] ? 0 : INF;
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const pass = (len: number) => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) ** 2 + f[v[k]];
    }
  };
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = out[y * w + x];
    pass(h);
    for (let y = 0; y < h; y++) out[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = out[y * w + x];
    pass(w);
    for (let x = 0; x < w; x++) out[y * w + x] = d[x];
  }
  return out;
}

const not = (m: Uint8Array) => m.map((v) => (v ? 0 : 1));

/** Pixels of `mask` that a disc of radius r fits around (erosion), and the union of those discs
 * (the opening: everything at least 2r wide survives, thinner work vanishes). */
function opening(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const toBg = distance2(not(mask), w, h);
  const core = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) core[i] = mask[i] && toBg[i] >= r * r ? 1 : 0;
  const toCore = distance2(core, w, h);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = mask[i] && toCore[i] <= r * r ? 1 : 0;
  return out;
}

function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const d = distance2(mask, w, h);
  return d.map((v) => (v <= r * r ? 1 : 0)) as unknown as Uint8Array;
}

// ---- shapes ----------------------------------------------------------------------------------

/** 8-connected components of the pixels where `mask` is set; -1 elsewhere. */
function components(mask: Uint8Array, w: number, h: number): { label: Int32Array; count: number } {
  const label = new Int32Array(w * h).fill(-1);
  let count = 0;
  const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || label[s] >= 0) continue;
    label[s] = count;
    stack.push(s);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w;
      const y = (p - x) / w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx;
        const Y = y + dy;
        if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const q = Y * w + X;
        if (mask[q] && label[q] < 0) (label[q] = count), stack.push(q);
      }
    }
    count++;
  }
  return { label, count };
}

/** The mask with its holes filled (everything the outside can't reach, 4-connected). */
function fillHoles(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h).fill(1);
  const stack: number[] = [];
  const seed = (p: number) => {
    if (!mask[p] && out[p]) (out[p] = 0), stack.push(p);
  };
  for (let x = 0; x < w; x++) seed(x), seed((h - 1) * w + x);
  for (let y = 0; y < h; y++) seed(y * w), seed(y * w + w - 1);
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w;
    if (x > 0) seed(p - 1);
    if (x < w - 1) seed(p + 1);
    if (p >= w) seed(p - w);
    if (p < w * (h - 1)) seed(p + w);
  }
  return out;
}

/** The outer boundary of the (first) blob in a mask, clockwise (Moore-neighbour tracing). */
function traceOutline(mask: Uint8Array, w: number, h: number): Pt[] {
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  let start = -1;
  for (let i = 0; i < w * h && start < 0; i++) if (mask[i]) start = i;
  if (start < 0) return [];
  const dirs: Pt[] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const dirOf = (dx: number, dy: number) => dirs.findIndex(([a, b]) => a === dx && b === dy);
  const sx = start % w;
  const sy = (start - sx) / w;
  let [cx, cy] = [sx, sy];
  let [bx, by] = [sx - 1, sy];
  const out: Pt[] = [[sx, sy]];
  let first = -1;
  for (let steps = 0; steps < 4 * w * h; steps++) {
    const d = dirOf(bx - cx, by - cy);
    let moved = false;
    for (let i = 1; i <= 8; i++) {
      const nd = (d + i) % 8;
      const [nx, ny] = [cx + dirs[nd][0], cy + dirs[nd][1]];
      if (on(nx, ny)) {
        const pd = (nd + 7) % 8;
        [bx, by] = [cx + dirs[pd][0], cy + dirs[pd][1]];
        [cx, cy] = [nx, ny];
        moved = true;
        break;
      }
    }
    if (!moved) break; // a single pixel
    // done when the walk leaves the start the way it first did
    const here = cy * w + cx;
    const prev = out[out.length - 1];
    if (prev[0] === sx && prev[1] === sy) {
      if (first < 0) first = here;
      else if (here === first) break;
    }
    out.push([cx, cy]);
  }
  return out;
}

/** Zhang-Suen thinning to a one-pixel skeleton. */
function thin(mask: Uint8Array, w: number, h: number): Uint8Array {
  const m = mask.slice();
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h ? m[y * w + x] : 0);
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of [0, 1]) {
      const del: number[] = [];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (!m[y * w + x]) continue;
        const p = [at(x, y - 1), at(x + 1, y - 1), at(x + 1, y), at(x + 1, y + 1), at(x, y + 1), at(x - 1, y + 1), at(x - 1, y), at(x - 1, y - 1)];
        const b = p.reduce((a, c) => a + c, 0);
        if (b < 2 || b > 6) continue;
        let a = 0;
        for (let i = 0; i < 8; i++) if (!p[i] && p[(i + 1) % 8]) a++;
        if (a !== 1) continue;
        if (step === 0 ? p[0] * p[2] * p[4] || p[2] * p[4] * p[6] : p[0] * p[2] * p[6] || p[0] * p[4] * p[6]) continue;
        del.push(y * w + x);
      }
      for (const i of del) m[i] = 0;
      if (del.length) changed = true;
    }
  }
  return m;
}

const neighbours8 = (p: number, w: number, h: number) => {
  const x = p % w;
  const y = (p - x) / w;
  const out: number[] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if ((dx || dy) && x + dx >= 0 && y + dy >= 0 && x + dx < w && y + dy < h) out.push(p + dy * w + dx);
  }
  return out;
};

/** The longest path through a skeleton after pruning spurs shorter than `spur` pixels, and how
 * many ends the pruned skeleton has. Ends and junctions are told by the crossing number (how
 * many separate runs of skeleton surround a pixel), so staircase steps don't count as branches. */
function centreLine(skel: Uint8Array, w: number, h: number, spur: number): { path: number[]; ends: number; branches: number[][] } {
  const on = (p: number) => skel[p] === 1;
  const ring = (p: number) => {
    const x = p % w;
    const y = (p - x) / w;
    const at = (dx: number, dy: number) => (x + dx >= 0 && y + dy >= 0 && x + dx < w && y + dy < h ? skel[(y + dy) * w + x + dx] : 0);
    return [at(0, -1), at(1, -1), at(1, 0), at(1, 1), at(0, 1), at(-1, 1), at(-1, 0), at(-1, -1)];
  };
  const crossings = (p: number) => {
    const r = ring(p);
    let n = 0;
    for (let i = 0; i < 8; i++) if (!r[i] && r[(i + 1) % 8]) n++;
    return n;
  };
  const isEnd = (p: number) => on(p) && crossings(p) === 1;
  const isJunction = (p: number) => on(p) && crossings(p) >= 3;
  // prune: walk in from every end; a branch that reaches a junction within `spur` pixels goes
  for (let round = 0; round < 3; round++) {
    let pruned = false;
    for (let e = 0; e < w * h; e++) {
      if (!isEnd(e)) continue;
      const branch = [e];
      const inBranch = new Set(branch);
      let cur = e;
      let junction = false;
      while (branch.length <= spur) {
        const next = neighbours8(cur, w, h).filter((q) => on(q) && !inBranch.has(q));
        if (!next.length) break;
        if (next.some(isJunction)) {
          junction = true;
          break;
        }
        // prefer a side neighbour to a corner one (a staircase offers both)
        cur = next.find((q) => Math.abs(q - cur) === 1 || Math.abs(q - cur) === w) ?? next[0];
        branch.push(cur);
        inBranch.add(cur);
      }
      if (junction && branch.length <= spur) {
        for (const q of branch) skel[q] = 0;
        pruned = true;
      }
    }
    if (!pruned) break;
  }
  const pts: number[] = [];
  for (let p = 0; p < w * h; p++) if (on(p)) pts.push(p);
  if (!pts.length) return { path: [], ends: 0, branches: [] };
  const bfs = (from: number) => {
    const dist = new Map<number, number>([[from, 0]]);
    const parent = new Map<number, number>();
    const queue = [from];
    let far = from;
    for (let i = 0; i < queue.length; i++) {
      const p = queue[i];
      for (const q of neighbours8(p, w, h)) {
        if (on(q) && !dist.has(q)) {
          dist.set(q, dist.get(p)! + 1);
          parent.set(q, p);
          queue.push(q);
          if (dist.get(q)! > dist.get(far)!) far = q;
        }
      }
    }
    return { far, parent };
  };
  const a = bfs(pts[0]).far;
  const { far: b, parent } = bfs(a);
  const path = [b];
  while (path[path.length - 1] !== a) path.push(parent.get(path[path.length - 1])!);
  // with more than two ends, each arm: from its end in to the first junction
  const endPts = pts.filter(isEnd);
  const branches: number[][] = [];
  if (endPts.length > 2) {
    for (const e of endPts) {
      const arm = [e];
      const seen = new Set(arm);
      let cur = e;
      for (;;) {
        const next = neighbours8(cur, w, h).filter((q) => on(q) && !seen.has(q));
        const junction = next.find(isJunction);
        if (junction !== undefined) {
          // the arm ends at the junction itself
          arm.push(junction);
          break;
        }
        if (!next.length) break;
        cur = next.find((q) => Math.abs(q - cur) === 1 || Math.abs(q - cur) === w) ?? next[0];
        arm.push(cur);
        seen.add(cur);
      }
      branches.push(arm);
    }
  }
  return { path, ends: endPts.length, branches };
}

/** Douglas-Peucker simplification to within `eps`. */
function simplify(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  let best = -1;
  let bd = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const d = len ? Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / len : Math.hypot(p[0] - a[0], p[1] - a[1]);
    if (d > bd) (bd = d), (best = i);
  }
  if (bd <= eps) return [a, b];
  return [...simplify(pts.slice(0, best + 1), eps).slice(0, -1), ...simplify(pts.slice(best), eps)];
}

// ---- the whole pipeline ----------------------------------------------------------------------

/** Where each stroke's paint is, for attachWords (kept out of the JSON). */
const WHERE = new WeakMap<BrushStroke, { pts: Pt[]; inside: (pt: Pt) => boolean; rim: number }>();

/**
 * Find the brushstrokes in a sketch (RGBA, opaque, at its own resolution; `paper` as from
 * paperField). Brush = ink at least T = max(8 px, 1.5% of the shorter side) wide, kept per pixel by
 * a morphological opening, so text touching paint stays pen. Colour layers: solid paint (ink
 * strength ≥ 0.7, away from a stroke's soft rim) binned in CIELAB and merged nearest-first while
 * CIEDE2000 ≤ 10 and the cluster stays within 12 of its mean; the rest of the paint takes its
 * nearest solid neighbour's layer. Dark lettering written over paint is pen again. Strokes:
 * connected paint of one layer (pieces closer than T/2 joined; slivers go to their neighbour);
 * then pieces cut apart by other paint are rejoined: anything into a fill it touches through other
 * paint, and two line pieces across a crossing no wider than three brush widths.
 */
export function brushStrokes(img: RgbaImage, paper: PaperField): StrokeResult {
  // work at most 1280 px on the long side
  const k = Math.max(1, Math.ceil(Math.max(img.width, img.height) / 1280));
  const w = Math.ceil(img.width / k);
  const h = Math.ceil(img.height / k);
  const rgb = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let [r, g, b, n] = [0, 0, 0, 0];
    for (let j = y * k; j < Math.min(img.height, (y + 1) * k); j++) for (let i = x * k; i < Math.min(img.width, (x + 1) * k); i++) {
      const o = (j * img.width + i) * 4;
      r += img.data[o];
      g += img.data[o + 1];
      b += img.data[o + 2];
      n++;
    }
    rgb.set([r / n, g / n, b / n], (y * w + x) * 3);
  }
  const colourAt = (p: number): Rgb => [rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2]];
  const q = new Float32Array(w * h);
  const support = new Uint8Array(w * h);
  const { rgb: pp, index } = paperTable(paper, img.width, img.height);
  for (let p = 0; p < w * h; p++) {
    const [r, g, b] = colourAt(p);
    const o = index((p % w) * k, Math.floor(p / w) * k);
    q[p] = Math.min(1, Math.max(0, (Math.hypot(r - pp[o], g - pp[o + 1], b - pp[o + 2]) - 40) / 80));
    support[p] = q[p] >= 0.25 ? 1 : 0;
  }
  const T = Math.max(8, 0.015 * Math.min(img.width, img.height)) / k;
  const brush = opening(support, w, h, T / 2);

  // colour layers from the solid paint in the middle of the strokes (a brush's soft rim is paint
  // mixed with paper, so it would make layers of its own)
  const toEdge = distance2(not(brush), w, h);
  const labOf = new Map<number, [number, number, number]>();
  const bins = new Map<number, { n: number; L: number; a: number; b: number }>();
  const binKey = (lab: number[]) => (Math.floor(lab[0] / 4) << 16) | (Math.floor((lab[1] + 128) / 4) << 8) | Math.floor((lab[2] + 128) / 4);
  for (let p = 0; p < w * h; p++) {
    if (!brush[p] || q[p] < 0.7 || toEdge[p] < (T / 4) ** 2) continue;
    const lab = toLab(colourAt(p));
    labOf.set(p, lab);
    const key = binKey(lab);
    const bin = bins.get(key) ?? { n: 0, L: 0, a: 0, b: 0 };
    bin.n++;
    bin.L += lab[0];
    bin.a += lab[1];
    bin.b += lab[2];
    bins.set(key, bin);
  }
  const sorted = [...bins.entries()].sort((x, y) => y[1].n - x[1].n || x[0] - y[0]);
  const top = sorted.slice(0, 256);
  interface Cluster { n: number; mean: number[]; members: { mean: number[]; n: number }[]; alive: boolean }
  const clusters: Cluster[] = top.map(([, b]) => {
    const mean = [b.L / b.n, b.a / b.n, b.b / b.n];
    return { n: b.n, mean, members: [{ mean, n: b.n }], alive: true };
  });
  const dist: number[][] = clusters.map((c, i) => clusters.map((d, j) => (i < j ? deltaE00(c.mean, d.mean) : Infinity)));
  for (;;) {
    let [bi, bj, bd] = [-1, -1, 10];
    for (let i = 0; i < clusters.length; i++) {
      if (!clusters[i].alive) continue;
      for (let j = i + 1; j < clusters.length; j++) if (clusters[j].alive && dist[i][j] <= bd) [bi, bj, bd] = [i, j, dist[i][j]];
    }
    if (bi < 0) break;
    const [c, d] = [clusters[bi], clusters[bj]];
    const n = c.n + d.n;
    const mean = c.mean.map((v, t) => (v * c.n + d.mean[t] * d.n) / n);
    const members = [...c.members, ...d.members];
    if (members.some((m) => deltaE00(m.mean, mean) > 12)) {
      dist[bi][bj] = Infinity;
      continue;
    }
    Object.assign(c, { n, mean, members });
    d.alive = false;
    for (let t = 0; t < clusters.length; t++) {
      if (t === bi || !clusters[t].alive) continue;
      const e = deltaE00(mean, clusters[t].mean);
      if (t < bi) dist[t][bi] = e;
      else dist[bi][t] = e;
    }
  }
  const live = clusters.filter((c) => c.alive);
  const median = (xs: number[]) => xs.sort((a, b) => a - b)[xs.length >> 1] ?? 0;
  const nearest = (lab: number[]) => {
    let best = 0;
    let bd = Infinity;
    live.forEach((c, i) => {
      const d = deltaE00(lab, c.mean);
      if (d < bd) (bd = d), (best = i);
    });
    return best;
  };
  const layerOfBin = new Map<number, number>();
  for (const [key, b] of sorted) layerOfBin.set(key, nearest([b.L / b.n, b.a / b.n, b.b / b.n]));
  const layer = new Int32Array(w * h).fill(-1);
  const queue: number[] = [];
  for (const [p, lab] of labOf) (layer[p] = layerOfBin.get(binKey(lab))!), queue.push(p);
  // the rest of the paint takes its nearest solid neighbour's layer, as long as it looks like that
  // paint thinned with paper (its colour within 15 of the line from the paper to the paint, in
  // CIELAB): a soft rim or a faint end of the same stroke, but not a different, paler paint
  // crossing it, which gets its own layer below
  const paperLab = new Map<number, number[]>();
  const fits = (p: number, li: number) => {
    const o = index((p % w) * k, Math.floor(p / w) * k);
    let pl = paperLab.get(o);
    if (!pl) paperLab.set(o, (pl = toLab([pp[o], pp[o + 1], pp[o + 2]])));
    const c = toLab(colourAt(p));
    const m = live[li].mean;
    const d = m.map((v, t) => v - pl![t]);
    const len2 = d.reduce((a, v) => a + v * v, 0) || 1;
    const t = Math.max(0, Math.min(1, d.reduce((a, v, j) => a + v * (c[j] - pl![j]), 0) / len2));
    return Math.hypot(...c.map((v, j) => v - (pl![j] + t * d[j]))) <= 15;
  };
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    const x = p % w;
    for (const nq of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p < w * (h - 1) ? p + w : -1]) {
      if (nq >= 0 && brush[nq] && layer[nq] < 0 && fits(nq, layer[p])) (layer[nq] = layer[p]), queue.push(nq);
    }
  }
  // paint with no solid pixel at all (faint or thin all over): each such patch is a layer of its
  // own, coloured by its median, and marked uncertain
  const faint = new Set<number>();
  const unlayered = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) if (brush[p] && layer[p] < 0) unlayered[p] = 1;
  const patches = components(unlayered, w, h);
  const patchPix: number[][] = Array.from({ length: patches.count }, () => []);
  for (let p = 0; p < w * h; p++) if (patches.label[p] >= 0) patchPix[patches.label[p]].push(p);
  for (const pix of patchPix) {
    const labs = pix.map((p) => toLab(colourAt(p)));
    const mean = [0, 1, 2].map((c) => median(labs.map((l) => l[c])));
    const id = live.push({ n: pix.length, mean, members: [{ mean, n: pix.length }], alive: true }) - 1;
    faint.add(id);
    for (const p of pix) layer[p] = id;
  }

  const toPic = (x: number, y: number): Pt => [(x * PIC.width) / w, (y * PIC.height) / h];
  const layerRgb: Rgb[] = live.map((_, i) => {
    const solid: Rgb[] = [];
    if (faint.has(i)) for (let p = 0; p < w * h && solid.length < 20000; p++) if (layer[p] === i) solid.push(colourAt(p));
    for (const [p] of labOf) if (layer[p] === i && solid.length < 20000) solid.push(colourAt(p));
    return [0, 1, 2].map((c) => Math.round(median(solid.map((s) => s[c])))) as Rgb;
  });

  // strokes: connected paint of one layer, pieces closer than T/2 joined
  const groups: { pix: number[]; layer: number }[] = [];
  const groupOf = new Int32Array(w * h).fill(-1);
  for (let li = 0; li < live.length; li++) {
    const own = new Uint8Array(w * h);
    let any = false;
    for (let p = 0; p < w * h; p++) if (layer[p] === li) (own[p] = 1), (any = true);
    if (!any) continue;
    const joined = components(dilate(own, w, h, T / 4), w, h);
    const byLabel = new Map<number, number>();
    for (let p = 0; p < w * h; p++) {
      if (!own[p]) continue;
      let g = byLabel.get(joined.label[p]);
      if (g === undefined) byLabel.set(joined.label[p], (g = groups.push({ pix: [], layer: li }) - 1));
      groups[g].pix.push(p);
      groupOf[p] = g;
    }
  }
  const perimeterOf = (pix: number[], g: number) => {
    let n = 0;
    for (const p of pix) {
      const x = p % w;
      for (const nq of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p < w * (h - 1) ? p + w : -1]) if (nq < 0 || groupOf[nq] !== g) n++;
    }
    return n;
  };
  const widthOf = (g: number) => (2 * groups[g].pix.length) / Math.max(1, perimeterOf(groups[g].pix, g));
  // how thick a piece is at its thickest (the radius of the biggest disc inside it)
  const inRadius = (g: number) => {
    const pix = groups[g].pix;
    let [x0, y0, x1, y1] = [w, h, -1, -1];
    for (const p of pix) {
      const x = p % w;
      const y = (p - x) / w;
      [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
    }
    const bw = x1 - x0 + 3;
    const bh = y1 - y0 + 3;
    const m = new Uint8Array(bw * bh);
    for (const p of pix) m[(Math.floor(p / w) - y0 + 1) * bw + (p % w) - x0 + 1] = 1;
    return Math.sqrt(distance2(not(m), bw, bh).reduce((a, v) => Math.max(a, v), 0));
  };
  // a sliver: a speck, or a strip much thinner than any brush (a soft rim in a colour of its own)
  const isSliver = (g: number) => groups[g].pix.length < Math.max(16, 0.5 * T * T) || inRadius(g) < T / 4 + 0.5;
  // a dark, colourless layer made only of slivers is lettering written over paint: pen again
  const darkInk = (li: number) => {
    const [r, g, b] = layerRgb[li];
    return Math.max(r, g, b) < 115 && Math.max(r, g, b) - Math.min(r, g, b) < 40;
  };
  // and a small dark shape joined to thin pen ink is pen work too (a filled arrowhead on its shaft)
  const penJoined = (g: number) => {
    let [x0, y0, x1, y1] = [w, h, -1, -1];
    for (const p of groups[g].pix) {
      const x = p % w;
      const y = (p - x) / w;
      [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
    }
    if (Math.max(x1 - x0, y1 - y0) + 1 > 3 * T) return false;
    // walk out over pen ink (not paint): a rim stops within a pixel or two, a shaft goes on
    const seen = new Set(groups[g].pix);
    let front = groups[g].pix;
    for (let step = 1; step <= 4 && front.length; step++) {
      const next: number[] = [];
      for (const p of front) for (const nq of neighbours8(p, w, h)) if (support[nq] && !brush[nq] && !seen.has(nq)) seen.add(nq), next.push(nq);
      front = next;
    }
    return front.length > 0;
  };
  for (let li = 0; li < live.length; li++) {
    const mine = groups.map((gr, g) => (gr.layer === li && gr.pix.length ? g : -1)).filter((g) => g >= 0);
    if (!mine.length || !darkInk(li)) continue;
    // pen: slivers, pieces joined to pen lines, and slender pieces (letters written over paint);
    // a compact dark blob on its own (a black dab) stays paint
    const slender = (g: number) => {
      let [x0, y0, x1, y1] = [w, h, -1, -1];
      for (const p of groups[g].pix) {
        const x = p % w;
        const y = (p - x) / w;
        [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
      }
      const big = Math.max(x1 - x0, y1 - y0) + 1;
      return widthOf(g) < 0.75 * T && inRadius(g) < 0.35 * big;
    };
    const pen = mine.every(isSliver) ? mine : mine.filter((g) => isSliver(g) || penJoined(g) || slender(g));
    for (const g of pen) {
      for (const p of groups[g].pix) (brush[p] = 0), (groupOf[p] = -1), (layer[p] = -1);
      groups[g].pix = [];
    }
  }
  // other slivers (a thin strip along another stroke, a speck) join the stroke they touch most, or go
  for (let g = 0; g < groups.length; g++) {
    if (!groups[g].pix.length || !isSliver(g)) continue;
    const touch = new Map<number, number>();
    for (const p of groups[g].pix) for (const nq of neighbours8(p, w, h)) {
      const o = groupOf[nq];
      if (o >= 0 && o !== g && groups[o].pix.length) touch.set(o, (touch.get(o) ?? 0) + 1);
    }
    const into = [...touch.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
    for (const p of groups[g].pix) groupOf[p] = into ?? -1;
    if (into !== undefined) for (const p of groups[g].pix) groups[into].pix.push(p);
    else for (const p of groups[g].pix) brush[p] = 0;
    groups[g].pix = [];
  }
  // for taking paint out of the pen blobs: a little wider, so a stroke's soft rim and the thin
  // tips of a scribble don't stay behind as specks; but lettering on the paint (clearly darker
  // than the paint around it) stays pen
  const wide = dilate(brush, w, h, 0.35 * T);
  const paintL = new Float32Array(w * h).fill(-1);
  const spread: number[] = [];
  for (let p = 0; p < w * h; p++) if (brush[p] && layer[p] >= 0) (paintL[p] = toLab(layerRgb[layer[p]])[0]), spread.push(p);
  for (let i = 0; i < spread.length; i++) {
    const p = spread[i];
    for (const nq of neighbours8(p, w, h)) if (wide[nq] && paintL[nq] < 0) (paintL[nq] = paintL[p]), spread.push(nq);
  }
  const lettering = (p: number) => paintL[p] >= 0 && toLab(colourAt(p))[0] < paintL[p] - 15 && q[p] >= 0.25;
  const isBrush = (x: number, y: number) => {
    const p = Math.min(h - 1, Math.floor(y / k)) * w + Math.min(w - 1, Math.floor(x / k));
    return wide[p] === 1 && !lettering(p);
  };

  const layerPixels = live.map((_, i) => groups.reduce((a, gr) => a + (gr.layer === i ? gr.pix.length : 0), 0));
  const layers: StrokeLayer[] = live.map((_, i) => ({
    id: i + 1, rgb: layerRgb[i], ega: nearestEga(layerRgb[i]), name: colourName(layerRgb[i]),
    confidence: [...labOf.keys()].filter((p) => layer[p] === i).length < 50 || faint.has(i) ? 'low' : 'high', pixels: layerPixels[i] * k * k,
  }));

  // describe every piece, then rejoin pieces of one layer that other paint has cut apart
  let described = new Map<number, BrushStroke>();
  for (let g = 0; g < groups.length; g++) if (groups[g].pix.length) described.set(g, describe(g));
  // Can paint walk from piece a to piece b over other layers' paint alone, within `reach` px?
  const bridged = (a: number, b: number, reach: number) => {
    const seen = new Map<number, number>();
    const frontier: number[] = [];
    for (const p of groups[a].pix) for (const nq of neighbours8(p, w, h)) {
      if (brush[nq] && groupOf[nq] !== a && groups[groupOf[nq]]?.layer !== groups[a].layer && !seen.has(nq)) seen.set(nq, 1), frontier.push(nq);
    }
    for (let i = 0; i < frontier.length; i++) {
      const p = frontier[i];
      const d = seen.get(p)!;
      for (const nq of neighbours8(p, w, h)) {
        if (groupOf[nq] === b) return true;
        if (d < reach && brush[nq] && !seen.has(nq) && groups[groupOf[nq]]?.layer !== groups[a].layer) seen.set(nq, d + 1), frontier.push(nq);
      }
    }
    return false;
  };
  const boxGap = (a: BrushStroke, b: BrushStroke) => Math.max(0, a.box[0] - b.box[2], b.box[0] - a.box[2]) * (w / PIC.width) + Math.max(0, a.box[1] - b.box[3], b.box[1] - a.box[3]) * (h / PIC.height);
  for (let changed = true; changed; ) {
    changed = false;
    const ids = [...described.keys()];
    outer: for (const a of ids) for (const b of ids) {
      if (a >= b || groups[a].layer !== groups[b].layer) continue;
      const [sa, sb] = [described.get(a)!, described.get(b)!];
      if (sa.class === 'loop' || sb.class === 'loop') continue;
      const fill = sa.class === 'fill' || sb.class === 'fill';
      // a fill takes back any piece of itself; a dab otherwise stays a thing of its own
      if (!fill && (sa.class === 'dab' || sb.class === 'dab')) continue;
      const reach = fill ? 0.25 * Math.hypot(w, h) : 3 * Math.max(widthOf(a), widthOf(b));
      if (boxGap(sa, sb) > reach || !bridged(a, b, reach)) continue;
      for (const p of groups[b].pix) groupOf[p] = a;
      for (const p of groups[b].pix) groups[a].pix.push(p);
      groups[b].pix = [];
      described.delete(b);
      described.set(a, describe(a));
      changed = true;
      break outer;
    }
  }
  // a dab touching a bigger stroke of the same plain colour (one paint that came out as two
  // layers, e.g. the faint start of a translucent stroke) is part of it
  for (const [d, sd] of [...described]) {
    if (sd.class !== 'dab') continue;
    const touch = new Map<number, number>();
    for (const p of groups[d].pix) for (const nq of neighbours8(p, w, h)) {
      const o = groupOf[nq];
      if (o >= 0 && o !== d && described.has(o) && described.get(o)!.colour === sd.colour && groups[o].pix.length > groups[d].pix.length) touch.set(o, (touch.get(o) ?? 0) + 1);
    }
    const into = [...touch.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
    if (into === undefined) continue;
    for (const p of groups[d].pix) (groupOf[p] = into), groups[into].pix.push(p);
    groups[d].pix = [];
    described.delete(d);
    described.set(into, describe(into));
  }
  // a piece of the same colour inside a loop is colouring-in: it joins the loop
  for (const [a, sa] of [...described]) {
    if (sa.class !== 'loop') continue;
    for (const [b, sb] of [...described]) {
      if (b === a || !described.has(a) || sb.colour !== sa.colour || sb.class === 'loop') continue;
      if (!WHERE.get(sa)!.inside(sb.centre)) continue;
      for (const p of groups[b].pix) (groupOf[p] = a), groups[a].pix.push(p);
      groups[b].pix = [];
      described.delete(b);
      described.set(a, describe(a, true));
    }
  }
  const strokesOut = [...described.values()];
  // the layers' pixel counts, now that pieces have moved between them
  for (const l of layers) l.pixels = strokesOut.filter((st) => st.layer === l.id).reduce((a, st) => a + st.pixels, 0);

  function describe(g: number, keepLoop = false): BrushStroke {
    const { pix, layer: li } = groups[g];
    let [x0, y0, x1, y1] = [w, h, -1, -1];
    let [sx, sy] = [0, 0];
    for (const p of pix) {
      const x = p % w;
      const y = (p - x) / w;
      [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
      sx += x + 0.5;
      sy += y + 0.5;
    }
    const width = widthOf(g);
    // a local mask with room round it for closing the gaps in a scribble
    const M = Math.ceil(0.8 * width + 1) + 2;
    const bw = x1 - x0 + 1 + 2 * M;
    const bh = y1 - y0 + 1 + 2 * M;
    const m = new Uint8Array(bw * bh);
    // the same, with other layers' paint that crosses it: a loop crossed by another stroke is
    // still closed (only paint within two widths of this stroke counts, so a separate loop of
    // another colour inside its box doesn't make it a loop)
    const withOthers = new Uint8Array(bw * bh);
    for (const p of pix) {
      const x = p % w;
      const y = (p - x) / w;
      m[(y - y0 + M) * bw + (x - x0 + M)] = 1;
    }
    const nearOwn = distance2(m, bw, bh);
    for (let y = Math.max(0, y0 - M); y <= Math.min(h - 1, y1 + M); y++) for (let x = Math.max(0, x0 - M); x <= Math.min(w - 1, x1 + M); x++) {
      const i = (y - y0 + M) * bw + (x - x0 + M);
      withOthers[i] = m[i] || (brush[y * w + x] && groups[groupOf[y * w + x]]?.layer !== li && nearOwn[i] <= (2 * width) ** 2) ? 1 : 0;
    }
    const local = (pts: Pt[]): Pt[] => pts.map(([x, y]) => toPic(x + x0 - M + 0.5, y + y0 - M + 0.5));
    const big = Math.max(x1 - x0 + 1, y1 - y0 + 1);
    const holesIn = (mask: Uint8Array) => {
      const f = fillHoles(mask, bw, bh);
      let area = 0;
      let holes = 0;
      for (let i = 0; i < bw * bh; i++) if (f[i]) (area++, mask[i] || holes++);
      return { f, area, holes };
    };
    let cls: BrushStroke['class'];
    let solid: Uint8Array;
    const own = holesIn(m);
    const crossed = holesIn(withOthers);
    const isLoop = (r: { area: number; holes: number }) => r.holes >= 0.3 * r.area && r.holes >= (2 * width) ** 2;
    if (keepLoop) (cls = 'loop'), (solid = own.f);
    else if (isLoop(own) || isLoop(crossed)) {
      cls = 'loop';
      if (isLoop(own)) solid = own.f;
      else {
        // the outline: only the bit of the crossing stroke that bridges the gap in this one (within
        // ¾ of a width of it), so the other stroke's ends don't notch or bulge the outline
        const bridge = withOthers.map((v, i) => (v && (m[i] || nearOwn[i] <= (0.75 * width) ** 2) ? 1 : 0)) as unknown as Uint8Array;
        const b = holesIn(bridge);
        // and an opening takes off what's left of its stub (a bump narrower than the brush)
        solid = isLoop(b) ? opening(b.f, bw, bh, 0.8 * width) : crossed.f;
      }
    } else {
      // close the gaps between a scribble's passes; a mass much thicker than one stroke is a fill
      const c = 0.8 * width + 1;
      const grown = dilate(m, bw, bh, c);
      const toOut = distance2(not(grown), bw, bh);
      const closed = fillHoles(toOut.map((v) => (v > c * c ? 1 : 0)) as unknown as Uint8Array, bw, bh);
      for (let i = 0; i < bw * bh; i++) if (m[i]) closed[i] = 1;
      const inner = Math.sqrt(distance2(not(closed), bw, bh).reduce((a, v) => Math.max(a, v), 0));
      // a dab is small (at most 3T across); a fill is a mass much thicker than one stroke of the
      // brush, or a solid patch (its thickness a fifth of its length or more); the rest are lines
      if (big <= 3 * T) (cls = 'dab'), (solid = own.f);
      else if (inner >= 1.5 * width || inner >= 0.2 * big) (cls = 'fill'), (solid = closed);
      else (cls = 'line'), (solid = own.f);
    }
    const s: BrushStroke = {
      id: 0,
      layer: li + 1,
      colour: layers[li].name,
      class: cls,
      width: cls === 'dab' ? [((x1 - x0 + 1) * PIC.width) / w, ((y1 - y0 + 1) * PIC.height) / h] : [(width * PIC.width) / w, (width * PIC.height) / h],
      box: [...toPic(x0, y0), ...toPic(x1 + 1, y1 + 1)] as BrushStroke['box'],
      centre: toPic(sx / pix.length, sy / pix.length),
      edges: [],
      words: [],
      flags: [],
      pixels: pix.length * k * k,
    };
    const near = 0.02;
    if (x0 <= near * w) s.edges.push('left');
    if (x1 >= (1 - near) * w - 1) s.edges.push('right');
    if (y0 <= near * h) s.edges.push('top');
    if (y1 >= (1 - near) * h - 1) s.edges.push('bottom');
    let edgeCut: { side: string; at: number } | undefined;
    if (cls === 'line') {
      // pieces rejoined across other paint: a centre line for each, chained end to end
      const parts = components(m, bw, bh);
      const pieces: Pt[][] = [];
      const arms: Pt[][] = [];
      let ends = 0;
      for (let c = 0; c < parts.count; c++) {
        const one = parts.label.map((v) => (v === c ? 1 : 0)) as unknown as Uint8Array;
        const r = centreLine(thin(one, bw, bh), bw, bh, Math.round(2 * width));
        if (r.path.length) pieces.push(r.path.map((p): Pt => [p % bw, Math.floor(p / bw)]));
        for (const b of r.branches) arms.push(b.map((p): Pt => [p % bw, Math.floor(p / bw)]));
        ends += r.ends;
      }
      // a piece's skeleton frays where other paint cut it: drop its last width or so at a join
      const fray = Math.max(2, Math.round(width));
      const trim = (pc: Pt[], atStart: boolean, atEnd: boolean) => pc.slice(atStart && pc.length > 3 * fray ? fray : 0, atEnd && pc.length > 3 * fray ? pc.length - fray : pc.length);
      const joins: Pt[] = [];
      // each join uses up one end of each of the two pieces it joins (never fewer than the
      // chain's own two ends, nor more than the pieces had)
      const joinCount = Math.max(0, pieces.length - 1);
      ends = Math.max(Math.min(ends, 2), ends - 2 * joinCount);
      const gap = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
      let chain = pieces.shift() ?? [];
      while (pieces.length) {
        let best = { i: 0, d: Infinity, flip: false, front: false };
        pieces.forEach((pc, i) => {
          for (const flip of [false, true]) {
            const q = flip ? [...pc].reverse() : pc;
            const dEnd = gap(chain[chain.length - 1], q[0]);
            const dStart = gap(q[q.length - 1], chain[0]);
            if (dEnd < best.d) best = { i, d: dEnd, flip, front: false };
            if (dStart < best.d) best = { i, d: dStart, flip, front: true };
          }
        });
        const pc = pieces.splice(best.i, 1)[0];
        const q = best.flip ? pc.reverse() : pc;
        if (best.front) {
          joins.push(chain[0]);
          chain = [...trim(q, false, true), ...trim(chain, true, false)];
        } else {
          joins.push(chain[chain.length - 1]);
          chain = [...trim(chain, false, true), ...trim(q, true, false)];
        }
      }
      // a thinned stroke ends about half a width inside its paint: carry each end on along its
      // direction to the end of the paint, less half a width (the middle of the brush's round
      // end), or to the edge of the canvas if the paint runs off it
      const extend = (pts: Pt[]) => {
        if (pts.length < 2) return pts;
        const e = pts[pts.length - 1];
        const back = pts[Math.max(0, pts.length - 1 - Math.max(2, Math.round(width)))];
        const len = Math.hypot(e[0] - back[0], e[1] - back[1]) || 1;
        const [dx, dy] = [(e[0] - back[0]) / len, (e[1] - back[1]) / len];
        let t = 0;
        let atCanvasEdge = false;
        for (;;) {
          const [x, y] = [Math.round(e[0] + dx * (t + 1)), Math.round(e[1] + dy * (t + 1))];
          const [gx, gy] = [x + x0 - M, y + y0 - M];
          if (gx < 0 || gy < 0 || gx >= w || gy >= h) {
            atCanvasEdge = true;
            break;
          }
          if (x < 0 || y < 0 || x >= bw || y >= bh || !m[y * bw + x]) break;
          t++;
        }
        const go = atCanvasEdge ? t + 1 : t - width / 2;
        return go > 0.5 ? [...pts, [e[0] + dx * go, e[1] + dy * go] as Pt] : pts;
      };
      chain = extend([...extend(chain)].reverse()).reverse();
      let line = simplify(local(chain), 1);
      if (line.length && line[0][1] > line[line.length - 1][1]) line = line.reverse();
      // both ends on the same canvas edge: a loop that runs off the picture, closed by the edge
      const edgeOf = ([x, y]: Pt) => (x < PIC.width * 0.04 ? 'left' : x > PIC.width * 0.96 ? 'right' : y < PIC.height * 0.04 ? 'top' : y > PIC.height * 0.96 ? 'bottom' : '');
      const [ea, eb] = line.length > 1 ? [edgeOf(line[0]), edgeOf(line[line.length - 1])] : ['', ''];
      if (ea && ea === eb && ends <= 2 && chain.length > 1) {
        // close it along that edge, between its two ends only
        const closedByEdge = m.slice();
        const side = ea;
        const [a, b] = [chain[0], chain[chain.length - 1]];
        const lim = side === 'left' || side === 'right' ? bh - 1 : bw - 1;
        const span = side === 'left' || side === 'right' ? [a[1], b[1]] : [a[0], b[0]];
        const along = [Math.max(0, Math.round(Math.min(...span))), Math.min(lim, Math.round(Math.max(...span)))];
        const at = side === 'left' ? x0 - x0 + M : side === 'right' ? x1 - x0 + M : side === 'top' ? y0 - y0 + M : y1 - y0 + M;
        for (let t = along[0]; t <= along[1]; t++) closedByEdge[side === 'left' || side === 'right' ? t * bw + at : at * bw + t] = 1;
        const r = holesIn(closedByEdge);
        if (isLoop(r)) {
          s.class = 'loop';
          s.flags.push(`runs off the ${side} edge: closed along it`);
          solid = r.f;
          edgeCut = { side, at };
        }
      }
      if (s.class === 'line') {
        s.line = line;
        s.ends = ends;
        if (ends > 2) {
          s.flags.push(`branched (${ends} ends): strokes crossing or joined - its arms are listed below; pair them by eye`);
          s.branches = arms.filter((a) => a.length >= 2).map((a) => simplify(local(a), 1));
        }
        const f = (n: number) => Math.round(n * 10) / 10;
        for (const j of local(joins)) s.flags.push(`joined across other paint near (${f(j[0])},${f(j[1])}): its centre line is bridged there`);
        // a sharp turn back (more than 150°) in the centre line is usually a word or other paint
        // pulling the skeleton: check it against view.png
        for (let i = 1; i < line.length - 1; i++) {
          const [a, b, c] = [line[i - 1], line[i], line[i + 1]];
          const [ux, uy, vx, vy] = [(b[0] - a[0]) * PIC.aspect, b[1] - a[1], (c[0] - b[0]) * PIC.aspect, c[1] - b[1]];
          const cos = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1);
          if (cos < -0.87) s.flags.push(`turns sharply back at (${f(b[0])},${f(b[1])}): something pulls the centre line there; check view.png`);
        }
      }
    }
    if (s.class === 'loop' && !s.outline) {
      // the area a loop encloses: tails and flourishes past where it closes trimmed off (an
      // opening), and the edge along the middle of the painted ring, not its outside
      const trimmed = opening(solid, bw, bh, 0.8 * width);
      const toOut = distance2(not(trimmed), bw, bh);
      const middle = toOut.map((v) => (v > (width / 2) ** 2 ? 1 : 0)) as unknown as Uint8Array;
      // a loop cut off by the canvas keeps the canvas edge as its edge there
      if (edgeCut) {
        const { side, at } = edgeCut;
        const near = width / 2 + 1;
        for (let i = 0; i < bw * bh; i++) {
          const [x, y] = [i % bw, Math.floor(i / bw)];
          const d = side === 'left' ? x - at : side === 'right' ? at - x : side === 'top' ? y - at : at - y;
          if (trimmed[i] && d >= 0 && d <= near) middle[i] = 1;
        }
      }
      if (middle.some((v) => v)) solid = middle;
    }
    if (s.class === 'loop' || s.class === 'fill') {
      s.outline ??= simplify(local(traceOutline(solid, bw, bh)), 1.5).slice(0, -1);
      if (s.outline.length < 3) s.outline = local(traceOutline(solid, bw, bh));
    }
    if (layers[li].confidence === 'low') s.flags.push('faint or thin paint: its colour is uncertain');
    const hugs = (s.edges.includes('top') || s.edges.includes('bottom')) && s.box[3] - s.box[1] < PIC.height * 0.03 || (s.edges.includes('left') || s.edges.includes('right')) && s.box[2] - s.box[0] < PIC.width * 0.03;
    if (hugs) s.flags.push('a thin strip along the picture edge: a sliver of table or frame? check view.png');
    if (s.edges.length === 4 && s.box[2] - s.box[0] >= PIC.width * 0.95 && s.box[3] - s.box[1] >= PIC.height * 0.95) {
      s.flags.push('spans the whole picture on all four edges: the table or a frame round the page? crop to the page (--crop, --trim)');
    }
    // for the word search: some of the paint's pixels, and the inside of a loop or fill
    const every = Math.max(1, Math.floor(pix.length / 4000));
    const area = solid;
    const kind = s.class;
    WHERE.set(s, {
      // how far round the paint pen ink is taken out with it (on screen, a column counting double)
      rim: ((0.35 * T + 1.5) * PIC.aspect * PIC.width) / w,
      pts: pix.filter((_, i) => i % every === 0).map((p) => toPic((p % w) + 0.5, Math.floor(p / w) + 0.5)),
      inside: ([px, py]) => {
        const x = Math.floor((px * w) / PIC.width) - x0 + M;
        const y = Math.floor((py * h) / PIC.height) - y0 + M;
        return (kind === 'loop' || kind === 'fill') && x >= 0 && y >= 0 && x < bw && y < bh && area[y * bw + x] === 1;
      },
    });
    return s;
  }

  // reading order: top to bottom, then left to right
  strokesOut.sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0]);
  strokesOut.forEach((s, i) => (s.id = i + 1));
  // three or more shapes of about one height side by side on one baseline: a row of things, or
  // big bold lettering?
  for (const d of strokesOut) {
    const ht = d.box[3] - d.box[1];
    if (d.class === 'loop' || ht > PIC.height * 0.2) continue;
    const alike = (e: BrushStroke) => {
      const he = e.box[3] - e.box[1];
      return e.class !== 'loop' && Math.abs(he - ht) <= 0.3 * ht && Math.abs(e.box[1] - d.box[1]) <= 0.25 * ht && Math.abs(e.box[3] - d.box[3]) <= 0.25 * ht;
    };
    // the run of alike shapes through d, each within 1.5 heights (on screen) of the next
    const row = strokesOut.filter(alike).sort((a, b) => a.box[0] - b.box[0]);
    const at = row.indexOf(d);
    let [lo, hi] = [at, at];
    // side by side: each starts after the middle of the one before (not overlapping it much)
    const next = (a: BrushStroke, b: BrushStroke) => b.box[0] >= (a.box[0] + a.box[2]) / 2 && (b.box[0] - a.box[2]) * PIC.aspect <= 1.5 * ht;
    while (lo > 0 && next(row[lo - 1], row[lo])) lo--;
    while (hi < row.length - 1 && next(row[hi], row[hi + 1])) hi++;
    if (hi - lo + 1 >= 3) d.flags.push(`one of ${hi - lo + 1} similar shapes in a row: a row of things, or big lettering? check view.png`);
  }
  return { layers: layers.filter((l) => strokesOut.some((s) => s.layer === l.id)), strokes: strokesOut, isBrush };
}

/** Attach pen blobs (words) to the strokes they sit in or beside: inside a loop or fill, or within
 * two brush widths of the paint (measured on screen, a column counting double), nearest first. */
export function attachWords(strokes: BrushStroke[], blobs: InkBlob[]): void {
  for (const s of strokes) {
    const where = WHERE.get(s);
    const reach = 2 * Math.hypot(s.width[0] * PIC.aspect, s.width[1]) / Math.SQRT2;
    const found: BrushStroke['words'] = [];
    blobs.forEach((b, i) => {
      if (b.shape !== 'mark') return;
      if (where?.inside(b.centre)) {
        found.push({ blob: i + 1, inside: true, distance: 0 });
        return;
      }
      // the nearest paint pixel to the blob's box
      let best = Infinity;
      for (const [x, y] of where?.pts ?? []) {
        const dx = Math.max(0, b.box[0] - x, x - b.box[2]);
        const dy = Math.max(0, b.box[1] - y, y - b.box[3]);
        best = Math.min(best, Math.hypot(PIC.aspect * dx, dy));
      }
      if (best <= reach) found.push({ blob: i + 1, inside: false, distance: Math.round(best * 10) / 10 });
    });
    s.words = found.sort((a, b) => a.distance - b.distance).slice(0, 6);
    if (found.some((f) => !f.inside && f.distance <= (where?.rim ?? 0))) s.flags.push('a word touches this paint: read it off view.png');
  }
}

/** A printable table of brushstrokes. */
export function strokeTable(strokes: BrushStroke[], layers: StrokeLayer[]): string {
  const f = (n: number) => String(Math.round(n * 10) / 10);
  const pt = (p: Pt) => `${f(p[0])},${f(p[1])}`;
  const few = (pts: Pt[]) => (pts.length <= 6 ? pts.map(pt).join(' ') : `${pts.slice(0, 3).map(pt).join(' ')} … ${pts.slice(-3).map(pt).join(' ')}`);
  return strokes
    .map((s) => {
      const l = layers.find((x) => x.id === s.layer)!;
      const head = `    ~${String(s.id).padEnd(3)} ${`${s.colour}${l.confidence === 'low' ? '?' : ''}`.padEnd(11)} ${s.class.padEnd(5)} w ${f(s.width[0])}×${f(s.width[1])}`.padEnd(42);
      const where = `box ${f(s.box[0])},${f(s.box[1])}-${f(s.box[2])},${f(s.box[3])}${s.edges.length ? `  touches ${s.edges.join('+')}` : ''}`;
      const words = s.words.length ? `  words ${s.words.map((x) => `#${x.blob}${x.inside ? ' inside' : ` ${f(x.distance)}`}`).join(', ')}` : '';
      const geom = (s.line ? `\n          centre line ${few(s.line)}` : s.outline ? `\n          outline (${s.outline.length} pts) ${few(s.outline)}` : `\n          centre ${pt(s.centre)}`) +
        (s.branches ?? []).map((b, i) => `\n          arm ${String.fromCharCode(97 + i)}: ${few(b)}`).join('');
      const flags = s.flags.map((x) => `\n          ! ${x}`).join('');
      return `${head}${where}${words}${geom}${flags}`;
    })
    .join('\n');
}

/** Every stroke's points as PicScript lists, to paste into a scene (`let stroke_3 = [[x, y], …]`:
 * a line's centre line, a loop's or fill's outline, a dab's centre), one decimal. */
export function strokesPic(strokes: BrushStroke[]): string {
  const f = (n: number) => String(Math.round(n * 10) / 10);
  const lines = ['# Brush strokes from pnpm grid, in picture coordinates: paste what you need.'];
  for (const s of strokes) {
    const pts = s.line ?? s.outline ?? [s.centre];
    const what = s.line ? 'centre line' : s.outline ? 'outline' : 'centre';
    lines.push(`# ~${s.id} ${s.colour} ${s.class} (${what})`, `let stroke_${s.id} = [${pts.map((p) => `[${f(p[0])}, ${f(p[1])}]`).join(', ')}]`);
    (s.branches ?? []).forEach((b, i) => lines.push(`# ~${s.id} arm ${String.fromCharCode(97 + i)} (from its end in to the junction)`, `let stroke_${s.id}${String.fromCharCode(97 + i)} = [${b.map((p) => `[${f(p[0])}, ${f(p[1])}]`).join(', ')}]`));
  }
  return `${lines.join('\n')}\n`;
}

/** The sketch's ink in its own colours, for `render --overlay` when the paint's colour matters:
 * like inkOverlay (alpha from the distance to the paper, × 0.6), but each pixel keeps its colour. */
export function paintOverlay(img: RgbaImage, paper: PaperField): RgbaImage {
  const out = new Uint8Array(img.width * img.height * 4);
  const { rgb: pp, index } = paperTable(paper, img.width, img.height);
  for (let i = 0; i < out.length; i += 4) {
    const o = index((i / 4) % img.width, Math.floor(i / 4 / img.width));
    const d = Math.hypot(img.data[i] - pp[o], img.data[i + 1] - pp[o + 1], img.data[i + 2] - pp[o + 2]);
    const a = Math.min(1, Math.max(0, (d - 40) / 80));
    out[i] = img.data[i];
    out[i + 1] = img.data[i + 1];
    out[i + 2] = img.data[i + 2];
    out[i + 3] = Math.round(a * 0.6 * 255);
  }
  return { width: img.width, height: img.height, data: out };
}
