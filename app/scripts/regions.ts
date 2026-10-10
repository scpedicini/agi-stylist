// Authoring aid: list the major colour regions of a reference picture as simplified
// polygons, so a hand-written scene can place its shapes like an artist working over
// a gridded reference.
//
//   pnpm regions kq1/r01-c04 [--min 40] [--tolerance 1.5]
//   pnpm regions kq1/r02-c03 --lines darkgrey [--box x1,y1,x2,y2]
//     → the thin line art of one colour as polylines (diagonal AGI lines are only
//       8-connected, so they don't show up as 4-connected regions)
import { Framebuffer, PIC_HEIGHT, PIC_WIDTH } from '../src/engine/framebuffer.ts';
import { COLOR_NAMES } from '../src/engine/palette.ts';
import { colorIndex } from '../src/lang/index.ts';
import { traceOps } from '../src/trace/tracer.ts';
import { readPicturePng } from './lib/png.ts';

const argv = process.argv.slice(2).filter((a) => a !== '--');
const id = argv.find((a) => !a.startsWith('--'));
if (!id) throw new Error('usage: pnpm regions <group/id> [--min N] [--tolerance T]');
const opt = (name: string, d: number) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? Number(argv[i + 1]) : d;
};
const minArea = opt('min', 40);
const tol = opt('tolerance', 1.5);
process.stdout.on('error', () => process.exit(0));
const fb = readPicturePng(id.endsWith('.png') ? id : `reference/${id}.png`);

const linesArg = argv.indexOf('--lines');
if (linesArg >= 0) {
  const c = colorIndex(argv[linesArg + 1] ?? '');
  if (c < 0) throw new Error(`unknown colour '${argv[linesArg + 1]}'`);
  const boxArg = argv.indexOf('--box');
  const [bx1, by1, bx2, by2] = boxArg >= 0 ? argv[boxArg + 1].split(',').map(Number) : [0, 0, PIC_WIDTH - 1, PIC_HEIGHT - 1];
  // Keep only colour c inside the box, drawn as a stand-in colour the tracer will emit (it never
  // emits white, the canvas colour); everything else becomes one other colour.
  const mark = c === 15 ? 14 : c;
  const filler = mark === 0 ? 1 : 0;
  const only = new Framebuffer();
  for (let y = 0; y < PIC_HEIGHT; y++) {
    for (let x = 0; x < PIC_WIDTH; x++) {
      const inBox = x >= bx1 && x <= bx2 && y >= by1 && y <= by2;
      only.set(x, y, inBox && fb.get(x, y) === c ? mark : filler);
    }
  }
  let current = -1;
  const polylines: string[] = [];
  for (const op of traceOps(only)) {
    if (op.kind === 'color') current = op.color;
    if (current !== mark || (op.kind !== 'line' && op.kind !== 'plot')) continue;
    if (op.kind === 'plot') {
      for (let i = 0; i < op.points.length; i += 2) polylines.push(`[${op.points[i]}, ${op.points[i + 1]}]`);
      continue;
    }
    const pairs: string[] = [];
    for (let i = 0; i < op.points.length; i += 2) pairs.push(`[${op.points[i]}, ${op.points[i + 1]}]`);
    polylines.push(pairs.join(', '));
  }
  console.log(`# ${COLOR_NAMES[c]} line art in ${bx1},${by1}-${bx2},${by2}: ${polylines.length} polylines`);
  console.log('let lines = [');
  for (const p of polylines) console.log(`  [${p}],`);
  console.log(']');
  process.exit(0);
}

const label = new Int32Array(PIC_WIDTH * PIC_HEIGHT).fill(-1);
interface Region { color: number; area: number; minX: number; minY: number; maxX: number; maxY: number; start: number; sx: number; sy: number }
const regions: Region[] = [];
for (let i = 0; i < label.length; i++) {
  if (label[i] >= 0) continue;
  const c = fb.pixels[i];
  const r: Region = { color: c, area: 0, minX: 999, minY: 999, maxX: -1, maxY: -1, start: i, sx: 0, sy: 0 };
  const stack = [i];
  label[i] = regions.length;
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % PIC_WIDTH;
    const y = (p / PIC_WIDTH) | 0;
    r.area++;
    r.sx += x;
    r.sy += y;
    r.minX = Math.min(r.minX, x);
    r.maxX = Math.max(r.maxX, x);
    r.minY = Math.min(r.minY, y);
    r.maxY = Math.max(r.maxY, y);
    for (const q of [x > 0 ? p - 1 : -1, x < PIC_WIDTH - 1 ? p + 1 : -1, p - PIC_WIDTH, p + PIC_WIDTH]) {
      if (q < 0 || q >= label.length || label[q] >= 0 || fb.pixels[q] !== c) continue;
      label[q] = regions.length;
      stack.push(q);
    }
  }
  regions.push(r);
}

// Moore-neighbour contour of a region (outer boundary), starting at its first pixel in scan order.
function contour(rid: number, start: number): Array<[number, number]> {
  const inR = (x: number, y: number) => x >= 0 && y >= 0 && x < PIC_WIDTH && y < PIC_HEIGHT && label[y * PIC_WIDTH + x] === rid;
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const sx = start % PIC_WIDTH;
  const sy = (start / PIC_WIDTH) | 0;
  const pts: Array<[number, number]> = [[sx, sy]];
  let [x, y] = [sx, sy];
  let d = 7;
  for (let guard = 0; guard < 20000; guard++) {
    let found = false;
    for (let k = 0; k < 8; k++) {
      const nd = (d + 6 + k) % 8; // start looking back-left of the previous direction
      const [dx, dy] = dirs[nd];
      if (inR(x + dx, y + dy)) {
        x += dx;
        y += dy;
        d = nd;
        found = true;
        break;
      }
    }
    if (!found || (x === sx && y === sy)) break;
    pts.push([x, y]);
  }
  return pts;
}

function simplify(pts: Array<[number, number]>, eps: number): Array<[number, number]> {
  if (pts.length < 3) return pts;
  const dist = (p: [number, number], a: [number, number], b: [number, number]) => {
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const len = Math.hypot(dx, dy) || 1;
    return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
  };
  let maxD = 0;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const dd = dist(pts[i], pts[0], pts[pts.length - 1]);
    if (dd > maxD) (maxD = dd), (idx = i);
  }
  if (maxD <= eps) return [pts[0], pts[pts.length - 1]];
  return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)];
}

const big = regions
  .map((r, i) => ({ ...r, i }))
  .filter((r) => r.area >= minArea)
  .sort((a, b) => b.area - a.area);
const area = new Array(16).fill(0);
for (const c of fb.pixels) area[c]++;
console.log(`# ${id}: colour areas - ${area.map((a, c) => [a, c]).filter(([a]) => a).sort((a, b) => b[0] - a[0]).map(([a, c]) => `${COLOR_NAMES[c]} ${((100 * a) / fb.pixels.length).toFixed(1)}%`).join(', ')}`);
console.log(`# ${big.length} regions with area ≥ ${minArea} px (largest first). Outlines are simplified outer contours.`);
for (const r of big) {
  const poly = simplify(contour(r.i, r.start), tol);
  console.log(
    `\n# ${COLOR_NAMES[r.color]}  area ${r.area}  bbox ${r.minX},${r.minY}-${r.maxX},${r.maxY}  centroid ${Math.round(r.sx / r.area)},${Math.round(r.sy / r.area)}`,
  );
  console.log(`#   ${poly.map(([x, y]) => `${x},${y}`).join(' ')}`);
}
