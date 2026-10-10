import { execute } from '../engine/execute.ts';
import { Framebuffer, PIC_HEIGHT, PIC_WIDTH } from '../engine/framebuffer.ts';
import { agiLine } from '../engine/line.ts';
import type { Op } from '../engine/ops.ts';
import { COLOR_NAMES, WHITE } from '../engine/palette.ts';

/**
 * Automatic tracer: turns a 160×168 EGA picture into AGI-style paint ops that
 * reproduce it pixel-for-pixel, using the original artists' recipe:
 *
 *   for each colour c (largest area first):
 *     1. draw polylines in c that cover every *boundary* pixel of c - a pixel of
 *        colour c with a 4-neighbour of another colour. Every line pixel must be
 *        colour c in the target, so lines never paint anything wrong.
 *     2. flood-fill each remaining white area that should be c. Because every
 *        boundary pixel is already drawn, each such area is walled in by its own
 *        colour, and AGI fill (white-only, 4-connected) cannot leak.
 *   isolated pixels become single-pixel pen plots.
 *
 * White (15) is the canvas and is never drawn.
 */
export interface TraceOptions {
  /** Max Chebyshev distance searched for the next polyline vertex. */
  radius?: number;
}

const N = PIC_WIDTH * PIC_HEIGHT;
const CELL = 8;
const GW = Math.ceil(PIC_WIDTH / CELL);
const GH = Math.ceil(PIC_HEIGHT / CELL);

export function traceOps(target: Framebuffer, opts: TraceOptions = {}): Op[] {
  const radius = opts.radius ?? 32;
  const T = target.pixels;
  const canvas = new Framebuffer();
  const C = canvas.pixels;
  const ops: Op[] = [];
  let penSet = false;

  const area = new Array(16).fill(0);
  for (let i = 0; i < N; i++) area[T[i]]++;
  const colors = area
    .map((a, c) => [a, c] as const)
    .filter(([a, c]) => a > 0 && c !== WHITE)
    .sort((x, y) => y[0] - x[0])
    .map(([, c]) => c);

  const linePx: number[] = [];
  const collect = (x1: number, y1: number, x2: number, y2: number) => {
    linePx.length = 0;
    agiLine(x1, y1, x2, y2, (x, y) => linePx.push(y * PIC_WIDTH + x));
  };

  for (const c of colors) {
    // boundary pixels of colour c
    const boundary = new Uint8Array(N);
    const uncovered = new Uint8Array(N);
    const buckets: number[][] = Array.from({ length: GW * GH }, () => []);
    let remaining = 0;
    for (let y = 0; y < PIC_HEIGHT; y++) {
      for (let x = 0; x < PIC_WIDTH; x++) {
        const i = y * PIC_WIDTH + x;
        if (T[i] !== c) continue;
        const edge =
          (x > 0 && T[i - 1] !== c) ||
          (x < PIC_WIDTH - 1 && T[i + 1] !== c) ||
          (y > 0 && T[i - PIC_WIDTH] !== c) ||
          (y < PIC_HEIGHT - 1 && T[i + PIC_WIDTH] !== c);
        if (!edge) continue;
        boundary[i] = 1;
        uncovered[i] = 1;
        remaining++;
        buckets[((y / CELL) | 0) * GW + ((x / CELL) | 0)].push(i);
      }
    }

    const polylines: number[][] = [];
    const singles: number[] = [];
    let scan = 0;
    while (remaining > 0) {
      while (!uncovered[scan]) scan++;
      let cur = scan;
      uncovered[cur] = 0;
      remaining--;
      const pts = [cur % PIC_WIDTH, (cur / PIC_WIDTH) | 0];
      for (;;) {
        const cx = cur % PIC_WIDTH;
        const cy = (cur / PIC_WIDTH) | 0;
        let best = -1;
        let bestScore = 0;
        let bestCov = 0;
        const gx0 = Math.max(0, ((cx - radius) / CELL) | 0);
        const gx1 = Math.min(GW - 1, ((cx + radius) / CELL) | 0);
        const gy0 = Math.max(0, ((cy - radius) / CELL) | 0);
        const gy1 = Math.min(GH - 1, ((cy + radius) / CELL) | 0);
        for (let gy = gy0; gy <= gy1; gy++) {
          for (let gx = gx0; gx <= gx1; gx++) {
            for (const e of buckets[gy * GW + gx]) {
              if (!uncovered[e]) continue;
              const ex = e % PIC_WIDTH;
              const ey = (e / PIC_WIDTH) | 0;
              if (Math.abs(ex - cx) > radius || Math.abs(ey - cy) > radius) continue;
              collect(cx, cy, ex, ey);
              let ok = true;
              let cov = 0;
              let interior = 0;
              for (const p of linePx) {
                if (T[p] !== c) {
                  ok = false;
                  break;
                }
                if (uncovered[p]) cov++;
                else if (!boundary[p] && C[p] === WHITE) interior++;
              }
              if (!ok) continue;
              const score = cov - 0.3 * interior;
              if (score > bestScore || (score === bestScore && cov > bestCov)) {
                best = e;
                bestScore = score;
                bestCov = cov;
              }
            }
          }
        }
        if (best < 0) break;
        collect(cx, cy, best % PIC_WIDTH, (best / PIC_WIDTH) | 0);
        for (const p of linePx) {
          if (uncovered[p]) {
            uncovered[p] = 0;
            remaining--;
          }
          C[p] = c;
        }
        pts.push(best % PIC_WIDTH, (best / PIC_WIDTH) | 0);
        cur = best;
      }
      C[pts[1] * PIC_WIDTH + pts[0]] = c;
      if (pts.length === 2) singles.push(pts[0], pts[1]);
      else polylines.push(mergeCollinear(pts));
    }

    ops.push({ kind: 'color', color: c });
    for (const pts of polylines) ops.push(isShortHops(pts) ? { kind: 'line', points: pts, style: 'rel' } : { kind: 'line', points: pts });
    if (singles.length) {
      if (!penSet) {
        ops.push({ kind: 'pen', size: 0, shape: 'circle', splatter: false });
        penSet = true;
      }
      ops.push({ kind: 'plot', points: singles });
    }

    // fill seeds: one per white 4-connected area that should become c
    const seeds: number[] = [];
    const seen = new Uint8Array(N);
    const stack: number[] = [];
    for (let i = 0; i < N; i++) {
      if (seen[i] || T[i] !== c || C[i] !== WHITE) continue;
      seeds.push(i % PIC_WIDTH, (i / PIC_WIDTH) | 0);
      seen[i] = 1;
      stack.push(i);
      while (stack.length) {
        const p = stack.pop()!;
        C[p] = c;
        const x = p % PIC_WIDTH;
        const nbrs = [x > 0 ? p - 1 : -1, x < PIC_WIDTH - 1 ? p + 1 : -1, p - PIC_WIDTH, p + PIC_WIDTH];
        for (const q of nbrs) {
          if (q < 0 || q >= N || seen[q] || C[q] !== WHITE) continue;
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    if (seeds.length) ops.push({ kind: 'fill', points: seeds });
  }
  return ops;
}

/** True when every step fits AGI's relative-line encoding (F7: ±7 per axis). */
function isShortHops(pts: number[]): boolean {
  for (let i = 2; i < pts.length; i += 2) {
    if (Math.abs(pts[i] - pts[i - 2]) > 7 || Math.abs(pts[i + 1] - pts[i - 1]) > 7) return false;
  }
  return true;
}

/**
 * Safety net: append single-pixel corrections for any pixel the ops get wrong.
 * By construction the tracer is exact, so this normally adds nothing.
 */
export function patchOps(target: Framebuffer, ops: readonly Op[]): Op[] {
  const fb = execute(ops);
  const byColor = new Map<number, number[]>();
  for (let i = 0; i < fb.pixels.length; i++) {
    if (fb.pixels[i] === target.pixels[i]) continue;
    const c = target.pixels[i];
    if (!byColor.has(c)) byColor.set(c, []);
    byColor.get(c)!.push(i % PIC_WIDTH, (i / PIC_WIDTH) | 0);
  }
  if (!byColor.size) return [...ops];
  const out: Op[] = [...ops, { kind: 'pen', size: 0, shape: 'circle', splatter: false }];
  for (const [c, points] of byColor) out.push({ kind: 'color', color: c }, { kind: 'plot', points });
  return out;
}

const pixelKey = (x1: number, y1: number, x2: number, y2: number) => {
  const out: number[] = [];
  agiLine(x1, y1, x2, y2, (x, y) => out.push(y * PIC_WIDTH + x));
  return out;
};

/**
 * Drop a polyline vertex when the single line skipping it rasterizes to exactly the
 * same pixels as the two segments through it - the picture is unchanged.
 */
function mergeCollinear(pts: number[]): number[] {
  const out = [pts[0], pts[1]];
  let i = 2;
  while (i < pts.length) {
    const [ax, ay] = [out[out.length - 2], out[out.length - 1]];
    let [bx, by] = [pts[i], pts[i + 1]];
    let j = i + 2;
    while (j < pts.length) {
      const [cx, cy] = [pts[j], pts[j + 1]];
      const merged = new Set(pixelKey(ax, ay, cx, cy));
      const parts = new Set([...pixelKey(ax, ay, bx, by), ...pixelKey(bx, by, cx, cy)]);
      if (merged.size !== parts.size || [...parts].some((p) => !merged.has(p))) break;
      [bx, by] = [cx, cy];
      j += 2;
    }
    out.push(bx, by);
    i = j;
  }
  return out;
}

/** Render traced ops as PicScript source. */
export function opsToPicScript(ops: readonly Op[], header: { title: string; comment?: string[] }): string {
  const lines: string[] = [];
  for (const c of header.comment ?? []) lines.push(`# ${c}`);
  lines.push(`scene "${header.title}"`);
  const pairs = (p: number[]) => {
    const out: string[] = [];
    for (let i = 0; i < p.length; i += 2) out.push(`${p[i]},${p[i + 1]}`);
    return out;
  };
  const wrap = (cmd: string, p: number[]) => {
    const parts = pairs(p);
    const rows: string[] = [];
    for (let i = 0; i < parts.length; i += 12) rows.push(parts.slice(i, i + 12).join(' '));
    return `${cmd} ${rows.join(',\n    ')}`;
  };
  for (const op of ops) {
    switch (op.kind) {
      case 'color':
        lines.push('', `color ${COLOR_NAMES[op.color]}`);
        break;
      case 'line':
        if (op.style === 'rel') {
          const p = op.points;
          const steps: number[] = [];
          for (let i = 2; i < p.length; i += 2) steps.push(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
          lines.push(`rline ${p[0]},${p[1]}${steps.length ? ' ' + pairs(steps).join(' ') : ''}`);
        } else lines.push(wrap('line', op.points));
        break;
      case 'plot':
        lines.push(wrap('plot', op.points));
        break;
      case 'fill':
        lines.push(wrap('fill', op.points));
        break;
      case 'pen':
        lines.push(`pen ${op.size}${op.shape === 'rect' ? ', square' : ''}${op.splatter ? ', splatter' : ''}`);
        break;
      default:
        throw new Error(`tracer does not emit ${op.kind}`);
    }
  }
  return lines.join('\n') + '\n';
}

/** Render the ops and count pixels that differ from the target. */
export function verifyTrace(target: Framebuffer, ops: readonly Op[]): number {
  return execute(ops).diffCount(target);
}
