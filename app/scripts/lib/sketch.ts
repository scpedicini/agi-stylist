// Layout sketches (docs/PLAN.md §15): ASCII layouts and the ink overlay. Pure functions, used by
// `pnpm grid` and tested directly.
import { PIC } from './geometry.ts';
import type { RgbaImage } from './png.ts';

// ---- ASCII layouts ---------------------------------------------------------------------------

export interface LayoutLabel {
  text: string;
  /** row inside the canvas, 0-based */
  row: number;
  /** first and last column of the token (inclusive, brackets included) */
  cols: [number, number];
  /** centre in continuous picture coordinates (floor for the pixel) */
  centre: [number, number];
  /** x0, y0, x1, y1 in continuous picture coordinates */
  box: [number, number, number, number];
}

export interface Layout {
  /** canvas size in character cells (the frame's interior, or the whole block) */
  w: number;
  h: number;
  framed: boolean;
  /** the canvas rows, padded to w */
  rows: string[];
  labels: LayoutLabel[];
  /** non-space characters that aren't labels: [col, row, char] */
  ink: [number, number, string][];
  /** words found outside the frame (notes, legends) */
  outside: string[];
}

const HORIZ = new Set(['-', '=', '─', '═', '━']);
const CORNER = new Set(['+', '|', '┌', '┐', '└', '┘', '╔', '╗', '╚', '╝', '┏', '┓', '┗', '┛', '├', '┤', '╠', '╣', '│', '║', '┃']);
const SIDE = new Set(['|', '+', '│', '║', '┃', '├', '┤', '╠', '╣']);

/** Normalise pasted text: CRLF, a Markdown fence, tabs (to 8), common indentation, blank edges, ragged lines. */
export function cleanLayout(text: string): string[] {
  let lines = text.replace(/\r\n?/g, '\n').split('\n');
  const fence = (l: string) => /^\s*(```|~~~)/.test(l);
  const first = lines.findIndex((l) => l.trim() !== '');
  if (first >= 0 && fence(lines[first])) {
    const close = lines.findIndex((l, i) => i > first && fence(l));
    lines = lines.slice(first + 1, close < 0 ? undefined : close);
  }
  lines = lines.map((l) => {
    let out = '';
    let col = 0; // in code points, so an emoji is one cell
    for (const ch of l) {
      const n = ch === '\t' ? 8 - (col % 8) : 1;
      out += ch === '\t' ? ' '.repeat(n) : ch;
      col += n;
    }
    return out.replace(/\s+$/, '');
  });
  while (lines.length && lines[0] === '') lines.shift();
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  const indent = Math.min(...lines.filter((l) => l !== '').map((l) => l.length - l.trimStart().length));
  lines = lines.map((l) => l.slice(Number.isFinite(indent) ? indent : 0));
  const w = Math.max(0, ...lines.map((l) => [...l].length));
  return lines.map((l) => l + ' '.repeat(w - [...l].length));
}

/** The largest frame: top and bottom rows of horizontal characters with a corner at each end, and
 * a side character in both columns on every row between. Returns inclusive [top, left, bottom, right]. */
export function findFrame(grid: string[][]): [number, number, number, number] | undefined {
  // horizontal runs with a corner at each end, by row
  const runs: [number, number, number][] = [];
  grid.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      if (!CORNER.has(row[c])) continue;
      let e = c + 1;
      while (e < row.length && HORIZ.has(row[e])) e++;
      if (e > c + 1 && e < row.length && CORNER.has(row[e])) runs.push([r, c, e]);
    }
  });
  let best: [number, number, number, number] | undefined;
  let area = 0;
  for (const [t, l, r] of runs) {
    for (const [b, l2, r2] of runs) {
      if (b <= t + 1 || l2 !== l || r2 !== r) continue;
      let ok = true;
      for (let y = t + 1; y < b && ok; y++) ok = SIDE.has(grid[y][l]) && SIDE.has(grid[y][r]);
      const a = (b - t - 1) * (r - l - 1);
      if (ok && a > area) (best = [t, l, b, r]), (area = a);
    }
  }
  return best;
}

/** Parse an ASCII layout. Labels: `[anything]`, or words that start with a letter and are at least
 * 2 characters of [A-Za-z0-9_]; words joined by single spaces (optionally after `:` or `,`) form
 * one label (`big oak tree`, `SKY: orange sunset`, `sheep x3`, `CASTLE ON A HILL`: short words
 * may sit inside a phrase, but it ends on a word of 2+ characters). Two or more spaces separate
 * labels. Everything else that isn't a space is ink. Coordinates are kept at full precision
 * (floor for the pixel). */
export function parseLayout(text: string): Layout {
  const lines = cleanLayout(text);
  const grid = lines.map((l) => [...l]);
  if (!grid.length || !grid[0].length) throw new Error('the layout is empty');
  const frame = findFrame(grid);
  const [t, l, b, r] = frame ?? [-1, -1, grid.length, grid[0].length];
  const rows = grid.slice(t + 1, b).map((row) => row.slice(l + 1, r));
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  if (!w || !h) throw new Error('the frame has nothing inside it');
  const sx = PIC.width / w;
  const sy = PIC.height / h;
  const token = /\[([^\]\n]*)\]|[A-Za-z][A-Za-z0-9_]+(?:[:,]? (?:[A-Za-z0-9_]+ )*[A-Za-z0-9][A-Za-z0-9_]+)*/g;
  const labels: LayoutLabel[] = [];
  const ink: Layout['ink'] = [];
  rows.forEach((chars, row) => {
    // one UTF-16 unit per cell, so regex offsets are cell columns (astral characters become U+FFFC)
    const s = chars.map((c) => (c.length > 1 ? '\uFFFC' : c)).join('');
    const used = new Uint8Array(chars.length);
    for (const m of s.matchAll(token)) {
      const c0 = m.index;
      const c1 = c0 + m[0].length - 1;
      const text = chars.slice(c0, c1 + 1).join('').replace(/^\[|\]$/g, '').trim();
      used.fill(1, c0, c1 + 1);
      if (!text) continue;
      labels.push({
        text,
        row,
        cols: [c0, c1],
        centre: [((c0 + c1 + 1) / 2) * sx, (row + 0.5) * sy],
        box: [c0 * sx, row * sy, (c1 + 1) * sx, (row + 1) * sy],
      });
    }
    chars.forEach((ch, col) => {
      if (!used[col] && ch !== ' ') ink.push([col, row, ch]);
    });
  });
  const outside: string[] = [];
  if (frame) {
    grid.forEach((row, y) => {
      const s = y > t && y < b ? row.slice(0, l).join('') + ' ' + row.slice(r + 1).join('') : row.join('');
      for (const part of s.split(/\s{2,}/)) if (/[A-Za-z]/.test(part)) outside.push(part.trim());
    });
  }
  return { w, h, framed: !!frame, rows: rows.map((c) => c.join('')), labels, ink, outside };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Cell size of the rendered layout, in pixels (1:2, like a terminal character). */
export const CELL_W = 24;
export const CELL_H = 48;

/** ImageMagick MVG that draws a layout's ink on a w·CELL_W × h·CELL_H canvas, as strokes inside
 * each character's cell (labels are drawn by `layoutLabelArgs`). */
export function layoutMvg(layout: Layout): string {
  const out = ['stroke black', 'stroke-width 4', 'fill none', 'stroke-linecap round'];
  for (const [col, row, ch] of layout.ink) {
    const x0 = col * CELL_W;
    const y0 = row * CELL_H;
    const [xm, ym, x1, y1] = [x0 + CELL_W / 2, y0 + CELL_H / 2, x0 + CELL_W, y0 + CELL_H];
    const line = (a: number, b: number, c: number, d: number) => out.push(`line ${a},${b} ${c},${d}`);
    if (ch === '-' || ch === '─' || ch === '━') line(x0, ym, x1, ym);
    else if (ch === '=' || ch === '═') (line(x0, ym - 5, x1, ym - 5), line(x0, ym + 5, x1, ym + 5));
    else if (ch === '_') line(x0, y1 - 2, x1, y1 - 2);
    else if (ch === '|' || ch === '│' || ch === '║' || ch === '┃') line(xm, y0, xm, y1);
    else if (ch === '/') line(x0, y1, x1, y0);
    else if (ch === '\\') line(x0, y0, x1, y1);
    else if (ch === '+' || CORNER.has(ch)) (line(x0, ym, x1, ym), line(xm, y0, xm, y1));
    else if (ch === '~') out.push(`polyline ${x0},${ym} ${x0 + 6},${ym - 5} ${xm},${ym} ${x1 - 6},${ym + 5} ${x1},${ym}`);
    else if (ch === '^') out.push(`polyline ${x0 + 2},${ym + 8} ${xm},${ym - 8} ${x1 - 2},${ym + 8}`);
    else if (ch === '.' || ch === ',') out.push(`circle ${xm},${y1 - 8} ${xm + 2},${y1 - 8}`);
    else out.push(`circle ${xm},${ym} ${xm + 5},${ym}`);
  }
  return out.join('\n');
}

/** ImageMagick arguments that draw each label's text onto the canvas, auto-sized to fit its span
 * (ImageMagick picks the point size for the box) and centred in it, so no font metric can move a
 * position. Append after the canvas, before the output file. */
export function layoutLabelArgs(layout: Layout): string[] {
  const args: string[] = [];
  for (const lab of layout.labels) {
    const [c0, c1] = lab.cols;
    const w = (c1 - c0 + 1) * CELL_W - 4;
    const h = CELL_H - 10;
    // `label:` text starting with @ would read a file; a leading space keeps it literal
    const text = lab.text.startsWith('@') ? ` ${lab.text}` : lab.text;
    args.push('(', '-background', 'none', '-fill', 'black', '-size', `${w}x${h}`, '-gravity', 'center', `label:${text}`, ')');
    args.push('-gravity', 'northwest', '-geometry', `+${c0 * CELL_W + 2}+${lab.row * CELL_H + 5}`, '-composite');
  }
  return args;
}

/** A printable table of a layout's labels. */
export function layoutTable(layout: Layout): string {
  const sx = PIC.width / layout.w;
  const sy = PIC.height / layout.h;
  const head = `${layout.w}×${layout.h} cells${layout.framed ? ' inside the frame' : ' (no frame found: the whole block is the canvas)'}; one cell is ${sx.toFixed(1)} × ${sy.toFixed(1)} picture pixels`;
  const rows = layout.labels.map((l) => {
    const cells = `cols ${l.cols[0]}-${l.cols[1]}, row ${l.row}`;
    const [x0, y0, x1, y1] = l.box.map(round1);
    return `    ${l.text.padEnd(22)} ${cells.padEnd(22)} centre ${l.centre.map(round1).join(',').padEnd(12)} box ${x0},${y0}-${x1},${y1}`;
  });
  const notes = layout.outside.length ? [`  outside the frame (notes?): ${layout.outside.map((s) => JSON.stringify(s)).join(', ')}`] : [];
  return [head, ...rows, ...notes].join('\n');
}

// ---- ink overlay -----------------------------------------------------------------------------

/** The paper colour: the dominant colour of the whole image (colours binned to 32 levels per
 * channel; the median of the most frequent bin). A sketch is mostly blank paper, so this holds
 * even when a frame, a table edge or a dark border fills the outside of the image. */
export function paperColour(img: RgbaImage): [number, number, number] {
  const { data } = img;
  const counts = new Map<number, number>();
  const key = (i: number) => ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
  for (let i = 0; i < data.length; i += 4) counts.set(key(i), (counts.get(key(i)) ?? 0) + 1);
  let best = -1;
  let n = 0;
  for (const [k, c] of counts) if (c > n) (best = k), (n = c);
  const channels: number[][] = [[], [], []];
  for (let i = 0; i < data.length; i += 4) if (key(i) === best) for (let k = 0; k < 3; k++) channels[k].push(data[i + k]);
  return channels.map((v) => v.sort((a, b) => a - b)[v.length >> 1]) as [number, number, number];
}

/** The paper's colour at each point of the page: a photographed page is often lit unevenly, so its
 * corners can be far darker than its middle. The page is cut into cells (12 along the longer side,
 * at least 32 px); a cell whose most common colour covers a third of it and looks like the paper (about the
 * paper's hue and saturation, no darker than 60% of it) gives the paper there; other cells (paint,
 * a big word) are filled in from their neighbours; then it is smoothed and read bilinearly. On
 * evenly lit paper it is the paper colour everywhere. */
export interface PaperField {
  at(x: number, y: number): [number, number, number];
}

export function paperField(img: RgbaImage, paper = paperColour(img)): PaperField {
  const { width: w, height: h, data } = img;
  // cells of at least 32 px, so a mark never fills one
  const size = Math.max(32, Math.ceil(Math.max(w, h) / 12));
  const cw = Math.ceil(w / size);
  const ch = Math.ceil(h / size);
  const cells: ([number, number, number] | undefined)[] = [];
  const hsv = ([r, g, b]: number[]) => {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let hue = 0;
    if (d) hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [((hue * 60) + 360) % 360, max ? d / max : 0, max];
  };
  const [ph, ps, pv] = hsv(paper);
  const paperLike = (c: number[]) => {
    const [hh, ss, vv] = hsv(c);
    const hueOk = ps < 0.12 || ss < 0.12 || Math.min(Math.abs(hh - ph), 360 - Math.abs(hh - ph)) < 30;
    return Math.abs(ss - ps) < 0.12 && hueOk && vv >= 0.6 * pv && vv <= pv + 40;
  };
  for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
    const counts = new Map<number, [number, number, number, number]>();
    let n = 0;
    for (let y = cy * size; y < Math.min(h, (cy + 1) * size); y++) for (let x = cx * size; x < Math.min(w, (cx + 1) * size); x++) {
      const i = (y * w + x) * 4;
      const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
      const c = counts.get(key) ?? [0, 0, 0, 0];
      c[0]++;
      c[1] += data[i];
      c[2] += data[i + 1];
      c[3] += data[i + 2];
      counts.set(key, c);
      n++;
    }
    let best: [number, number, number, number] = [0, 0, 0, 0];
    for (const c of counts.values()) if (c[0] > best[0]) best = c;
    const mode = [best[1] / best[0], best[2] / best[0], best[3] / best[0]] as [number, number, number];
    cells.push(best[0] >= n / 3 && paperLike(mode) ? mode : undefined);
  }
  if (cells.every((c) => !c)) return { at: () => paper };
  // fill the cells that showed no paper from their neighbours, ring by ring
  for (let pass = 0; cells.some((c) => !c) && pass < cw + ch; pass++) {
    const next = cells.slice();
    for (let i = 0; i < cells.length; i++) {
      if (cells[i]) continue;
      const [x, y] = [i % cw, Math.floor(i / cw)];
      const near: [number, number, number][] = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const c = x + dx >= 0 && x + dx < cw && y + dy >= 0 && y + dy < ch ? cells[(y + dy) * cw + x + dx] : undefined;
        if (c) near.push(c);
      }
      if (near.length) next[i] = [0, 1, 2].map((k) => near.reduce((a, c) => a + c[k], 0) / near.length) as [number, number, number];
    }
    cells.splice(0, cells.length, ...next);
  }
  // smooth once (3×3 average)
  const smooth = cells.map((_, i) => {
    const [x, y] = [i % cw, Math.floor(i / cw)];
    const near: [number, number, number][] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (x + dx >= 0 && x + dx < cw && y + dy >= 0 && y + dy < ch) near.push(cells[(y + dy) * cw + x + dx]!);
    return [0, 1, 2].map((k) => near.reduce((a, c) => a + c[k], 0) / near.length) as [number, number, number];
  });
  return {
    at(x, y) {
      // bilinear between cell centres
      const fx = Math.min(cw - 1, Math.max(0, x / size - 0.5));
      const fy = Math.min(ch - 1, Math.max(0, y / size - 0.5));
      const [x0, y0] = [Math.floor(fx), Math.floor(fy)];
      const [x1, y1] = [Math.min(cw - 1, x0 + 1), Math.min(ch - 1, y0 + 1)];
      const [tx, ty] = [fx - x0, fy - y0];
      const c = (cx: number, cy: number) => smooth[cy * cw + cx];
      return [0, 1, 2].map((k) => (c(x0, y0)[k] * (1 - tx) + c(x1, y0)[k] * tx) * (1 - ty) + (c(x0, y1)[k] * (1 - tx) + c(x1, y1)[k] * tx) * ty) as [number, number, number];
    },
  };
}

/** The paper field sampled every 4 px over a w×h image (it changes slowly, so that's plenty):
 * `index(x, y)` gives the offset of pixel (x, y)'s paper colour in `rgb`. */
export function paperTable(paper: [number, number, number] | PaperField, w: number, h: number) {
  const step = 4;
  const cols = Math.ceil(w / step);
  const rows = Math.ceil(h / step);
  const rgb = new Float32Array(cols * rows * 3);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    rgb.set(Array.isArray(paper) ? paper : (paper as PaperField).at(i * step + step / 2, j * step + step / 2), (j * cols + i) * 3);
  }
  return { rgb, index: (x: number, y: number) => (Math.floor(y / step) * cols + Math.floor(x / step)) * 3 };
}

export const INK_RGB = [255, 0, 255] as const;

/** The sketch's ink as an overlay: magenta, with alpha from the distance to the paper colour there
 * (below 40 is paper noise and vanishes; 120 and up is solid), scaled by 0.6 so the scene shows
 * through. Works for any ink hue, pale pencil included. */
export function inkOverlay(img: RgbaImage, paper: [number, number, number] | PaperField = paperField(img)): RgbaImage {
  const out = new Uint8Array(img.width * img.height * 4);
  const { rgb: pp, index } = paperTable(paper, img.width, img.height);
  for (let i = 0; i < out.length; i += 4) {
    const o = index((i / 4) % img.width, Math.floor(i / 4 / img.width));
    const d = Math.hypot(img.data[i] - pp[o], img.data[i + 1] - pp[o + 1], img.data[i + 2] - pp[o + 2]);
    const a = Math.min(1, Math.max(0, (d - 40) / 80));
    out[i] = INK_RGB[0];
    out[i + 1] = INK_RGB[1];
    out[i + 2] = INK_RGB[2];
    out[i + 3] = Math.round(a * 0.6 * 255);
  }
  return { width: img.width, height: img.height, data: out };
}

// ---- ink blobs -------------------------------------------------------------------------------

export interface InkBlob {
  /** bounding box in continuous picture coordinates: x0, y0, x1, y1 */
  box: [number, number, number, number];
  centre: [number, number];
  /** 'strokes' for line work (a horizon, a bank, a frame, a box outline: one or two runs of ink
   *  per row), else 'mark' (a word, a symbol, an arrowhead). A hint, not a reading */
  shape: 'strokes' | 'mark';
  /** inked overlay pixels in it */
  pixels: number;
}

/**
 * Group an ink overlay (e.g. ink.png, display aspect) into blobs: ink pixels (alpha ≥ 40) are
 * grown by `gap` overlay pixels sideways and a third of that up and down, so the letters of a word
 * and the words of a single-spaced phrase join but separate labels don't; then connected groups
 * are measured on the ungrown ink. Blobs smaller than `minPixels` are dropped (noise).
 */
export function inkBlobs(ink: RgbaImage, gap = 7, minPixels = 25): InkBlob[] {
  const { width: w, height: h, data } = ink;
  const on = new Uint8Array(w * h);
  // alpha 40 of ink.png's 153 maximum: an RGB distance of about 61 from the paper
  for (let i = 0; i < w * h; i++) on[i] = data[i * 4 + 3] >= 40 ? 1 : 0;
  // grow: horizontal then vertical running maxima
  const gy = Math.max(1, Math.round(gap / 3));
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let last = -1e9;
    for (let x = 0; x < w; x++) if (on[y * w + x]) last = x; else if (x - last <= gap) tmp[y * w + x] = 1;
    last = 1e9;
    for (let x = w - 1; x >= 0; x--) if (on[y * w + x]) last = x; else if (last - x <= gap) tmp[y * w + x] = 1;
    for (let x = 0; x < w; x++) if (on[y * w + x]) tmp[y * w + x] = 1;
  }
  const grown = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    let last = -1e9;
    for (let y = 0; y < h; y++) if (tmp[y * w + x]) last = y; else if (y - last <= gy) grown[y * w + x] = 1;
    last = 1e9;
    for (let y = h - 1; y >= 0; y--) if (tmp[y * w + x]) last = y; else if (last - y <= gy) grown[y * w + x] = 1;
    for (let y = 0; y < h; y++) if (tmp[y * w + x]) grown[y * w + x] = 1;
  }
  // connected components (4-neighbour) of the grown mask
  const label = new Int32Array(w * h).fill(-1);
  const blobs: InkBlob[] = [];
  const stack: number[] = [];
  const sx = PIC.width / w;
  const sy = PIC.height / h;
  for (let start = 0; start < w * h; start++) {
    if (!grown[start] || label[start] >= 0) continue;
    const id = blobs.length;
    let [x0, y0, x1, y1, n] = [w, h, -1, -1, 0];
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w;
      const y = (p - x) / w;
      if (on[p]) {
        n++;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q >= 0 && grown[q] && label[q] < 0) (label[q] = id), stack.push(q);
      }
    }
    const box: InkBlob['box'] = [x0 * sx, y0 * sy, (x1 + 1) * sx, (y1 + 1) * sy];
    // text crosses many strokes on each row (3+ runs of ink); a line, an outline or a frame
    // crosses one or two. Small blobs (a star, an arrowhead, a short word) stay marks.
    let runs = 0;
    let inkRows = 0;
    for (let y = y0; y <= y1; y++) {
      let inRun = false;
      let any = false;
      for (let x = x0; x <= x1; x++) {
        const hit = on[y * w + x] === 1 && label[y * w + x] === id;
        if (hit && !inRun) runs++;
        inRun = hit;
        any ||= hit;
      }
      if (any) inkRows++;
    }
    const long = Math.max((box[2] - box[0]) * PIC.aspect, box[3] - box[1]); // on screen a pixel is ASPECT wide
    const shape = long >= 40 && runs / Math.max(1, inkRows) < 2.5 ? 'strokes' : 'mark';
    blobs.push({ box, centre: [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2], shape, pixels: n });
  }
  return blobs.filter((b) => b.pixels >= minPixels).sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0]);
}

/** A printable table of ink blobs. */
export function blobTable(blobs: InkBlob[]): string {
  const f = (n: number) => String(Math.round(n * 10) / 10);
  const whole = (b: InkBlob) => b.box[2] - b.box[0] >= PIC.width * 0.95 && b.box[3] - b.box[1] >= PIC.height * 0.95;
  return blobs
    .map((b, i) => `    #${String(i + 1).padEnd(3)} ${b.shape.padEnd(7)} centre ${`${f(b.centre[0])},${f(b.centre[1])}`.padEnd(12)} box ${f(b.box[0])},${f(b.box[1])}-${f(b.box[2])},${f(b.box[3])}` +
      (whole(b) ? '  (spans the whole picture: lines merged with each other, a frame or a table edge; read what it holds off grid.png)' : ''))
    .join('\n');
}
