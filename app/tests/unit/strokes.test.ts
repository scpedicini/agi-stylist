// Hybrid sketches (docs/PLAN.md §16): brushstrokes told from pen work, grouped by colour and
// described as lines, loops, fills and dabs; the paper field; grid's stroke outputs.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileProgram, parse } from '../../src/lang/index.ts';
import { readRgbaPng, type RgbaImage } from '../../scripts/lib/png.ts';
import { inkBlobs, inkOverlay, paperField } from '../../scripts/lib/sketch.ts';
import { attachWords, brushStrokes, colourName, deltaE00, paintOverlay } from '../../scripts/lib/strokes.ts';

type Pt = [number, number];
type Rgb = [number, number, number];

const W = 800;
const H = 600;
const canvas = (paper: Rgb = [255, 255, 255], w = W, h = H): RgbaImage => {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([...paper, 255], i * 4);
  return { width: w, height: h, data };
};
/** Paint a polyline of round-capped segments of radius r (alpha < 1 mixes with what's there). */
const paint = (img: RgbaImage, pts: Pt[], r: number, rgb: Rgb, alpha = 1) => {
  const hit = new Uint8Array(img.width * img.height);
  for (let i = 0; i < pts.length - 1; i++) {
    const [[ax, ay], [bx, by]] = [pts[i], pts[i + 1]];
    for (let y = Math.floor(Math.min(ay, by) - r); y <= Math.max(ay, by) + r; y++) for (let x = Math.floor(Math.min(ax, bx) - r); x <= Math.max(ax, bx) + r; x++) {
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
      const [dx, dy] = [bx - ax, by - ay];
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
      if (Math.hypot(x - ax - t * dx, y - ay - t * dy) <= r) hit[y * img.width + x] = 1;
    }
  }
  for (let p = 0; p < hit.length; p++) {
    if (!hit[p]) continue;
    for (let c = 0; c < 3; c++) img.data[p * 4 + c] = Math.round(img.data[p * 4 + c] * (1 - alpha) + rgb[c] * alpha);
  }
};
const ring = (cx: number, cy: number, rx: number, ry: number, n = 48): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => [cx + rx * Math.cos((i / n) * 2 * Math.PI), cy + ry * Math.sin((i / n) * 2 * Math.PI)] as Pt);
const zigzag = (x0: number, y0: number, x1: number, y1: number, step: number): Pt[] => {
  const out: Pt[] = [];
  for (let y = y0, k = 0; y <= y1; y += step, k++) out.push([k % 2 ? x1 : x0, y]);
  return out;
};
/** Thin pen "lettering": a little zig-zag of 3-px strokes, like a word. */
const word = (img: RgbaImage, x: number, y: number, rgb: Rgb = [40, 40, 40], len = 60) => {
  const pts: Pt[] = [];
  for (let i = 0; i <= len / 6; i++) pts.push([x + i * 6, y + (i % 2 ? -8 : 8)]);
  paint(img, pts, 1.5, rgb);
};
const strokesOf = (img: RgbaImage) => brushStrokes(img, paperField(img));
const GREEN: Rgb = [76, 187, 60];
const BLUE: Rgb = [47, 111, 208];
const RED: Rgb = [216, 58, 42];
const BROWN: Rgb = [139, 90, 43];

describe('colour', () => {
  it('CIEDE2000 matches the published test pair', () => {
    // Sharma, Wu & Dalal (2005), pair 1
    expect(deltaE00([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 3);
    expect(deltaE00([50, 0, 0], [50, 0, 0])).toBe(0);
  });

  it('names paint colours plainly', () => {
    expect(colourName([155, 155, 155])).toBe('grey');
    expect(colourName([141, 140, 76])).toBe('olive');
    expect(colourName([139, 90, 43])).toBe('brown');
    expect(colourName([150, 249, 98])).toBe('green');
    expect(colourName([159, 208, 255])).toBe('pale blue');
    expect(colourName([47, 111, 208])).toBe('blue');
    expect(colourName([216, 58, 42])).toBe('red');
    expect(colourName([240, 208, 64])).toBe('yellow');
  });
});

describe('brushstrokes', () => {
  it('reads a straight stroke as a line with its centre line, and ignores pen work', () => {
    const img = canvas();
    paint(img, [[100, 300], [700, 300]], 14, BROWN);
    paint(img, [[100, 450], [700, 470]], 1.5, [30, 30, 30]); // a pencil line
    word(img, 300, 200);
    const { strokes } = strokesOf(img);
    expect(strokes.length).toBe(1);
    const [s] = strokes;
    expect([s.class, s.colour]).toEqual(['line', 'brown']);
    for (const [, y] of s.line!) expect(Math.abs(y - (300 * 168) / H)).toBeLessThan(1);
    // its ends reach the ends of the stroke (the middle of the brush's round ends), not the
    // thinned stroke's ends half a width inside them
    expect(Math.abs(s.line![0][0] - 20)).toBeLessThan(1.5);
    expect(Math.abs(s.line![s.line!.length - 1][0] - 140)).toBeLessThan(1.5);
  });

  it('reads a closed ring as a loop, a zig-zag as a fill, and a small blob as a dab', () => {
    const img = canvas();
    paint(img, ring(200, 200, 140, 90), 12, GREEN);
    paint(img, zigzag(450, 100, 750, 350, 26), 11, [240, 208, 64]);
    paint(img, [[600, 500], [604, 502]], 11, RED);
    const byColour = Object.fromEntries(strokesOf(img).strokes.map((s) => [s.colour, s]));
    expect(byColour.green.class).toBe('loop');
    expect(byColour.yellow.class).toBe('fill');
    expect(byColour.red.class).toBe('dab');
    // the loop's outline follows the middle of the painted ring
    const xs = byColour.green.outline!.map((p) => p[0]);
    expect(Math.abs(Math.min(...xs) - ((200 - 140) * 160) / W)).toBeLessThan(1);
    expect(Math.abs(Math.max(...xs) - ((200 + 140) * 160) / W)).toBeLessThan(1);
  });

  it("a loop's tail past where it closes is trimmed off its outline", () => {
    const img = canvas();
    // a ring, then the brush carries on 120 px past the start
    paint(img, [...ring(350, 300, 200, 150), [550, 300], [550, 300]], 12, GREEN);
    paint(img, [[550, 300], [600, 420], [680, 470]], 12, GREEN);
    const [s] = strokesOf(img).strokes;
    expect(s.class).toBe('loop');
    expect(Math.max(...s.outline!.map((p) => p[0]))).toBeLessThan(((550 + 24) * 160) / W);
  });

  it('a loop with scribbles inside is still one loop', () => {
    const img = canvas();
    paint(img, ring(400, 300, 250, 180), 13, GREEN);
    paint(img, [[250, 220], [450, 160], [300, 300], [520, 240], [380, 380]], 13, GREEN);
    const { strokes } = strokesOf(img);
    expect(strokes.map((s) => s.class)).toEqual(['loop']);
  });

  it('keeps two colours that cross as two strokes, and rejoins the one cut in two', () => {
    const img = canvas();
    paint(img, [[50, 200], [400, 300], [750, 450]], 16, BLUE); // a river
    paint(img, [[330, 380], [470, 200]], 12, [138, 138, 138]); // a bridge over it
    const { strokes } = strokesOf(img);
    expect(strokes.map((s) => `${s.colour} ${s.class}`).sort()).toEqual(['blue line', 'grey line']);
    const river = strokes.find((s) => s.colour === 'blue')!;
    expect(river.line![0][0]).toBeLessThan(15);
    expect(river.line![river.line!.length - 1][0]).toBeGreaterThan(145);
    expect(river.flags.join()).toMatch(/joined across other paint/);
    // and its centre line doesn't kink where it's bridged: every turn is gentle
    const l = river.line!;
    for (let i = 1; i < l.length - 1; i++) {
      const [ux, uy, vx, vy] = [l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1], l[i + 1][0] - l[i][0], l[i + 1][1] - l[i][1]];
      expect((ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy))).toBeGreaterThan(0.5);
    }
  });

  it('a loop crossed by another colour is still a loop', () => {
    const img = canvas();
    paint(img, ring(450, 300, 220, 120), 12, BLUE);
    paint(img, [[150, 330], [330, 310]], 10, BROWN); // a dock into the lake
    const lake = strokesOf(img).strokes.find((s) => s.colour === 'blue')!;
    expect(lake.class).toBe('loop');
  });

  it('closes a loop that runs off the canvas along the edge', () => {
    const img = canvas();
    paint(img, [[800, 120], [560, 150], [500, 300], [560, 450], [800, 480]], 12, GREEN);
    const [s] = strokesOf(img).strokes;
    expect(s.class).toBe('loop');
    expect(s.edges).toContain('right');
    expect(s.flags.join()).toMatch(/runs off the right edge/);
  });

  it('a line touching two different edges stays a line', () => {
    const img = canvas();
    paint(img, [[0, 250], [300, 280], [450, 400], [480, 600]], 14, BROWN);
    const [s] = strokesOf(img).strokes;
    expect(s.class).toBe('line');
    expect(s.edges.sort()).toEqual(['bottom', 'left']);
  });

  it('a line cut into several pieces never reports fewer than its own two ends', () => {
    const img = canvas();
    paint(img, [[50, 300], [750, 300]], 14, BROWN);
    for (const x of [200, 350, 500, 650]) paint(img, [[x, 200], [x + 10, 400]], 10, BLUE);
    const brown = strokesOf(img).strokes.find((s) => s.colour === 'brown')!;
    expect(brown.class).toBe('line');
    expect(brown.ends).toBe(2);
  });

  it('keeps a tiny dab of paint, and a thin stylus line is pen', () => {
    const img = canvas();
    paint(img, [[400, 300], [401, 300]], 6, RED);
    paint(img, [[100, 100], [700, 120]], 1.5, BLUE);
    const { strokes } = strokesOf(img);
    expect(strokes.map((s) => `${s.colour} ${s.class}`)).toEqual(['red dab']);
  });

  it('one paint at two opacities gets the same name', () => {
    const img = canvas();
    paint(img, [[100, 200], [400, 220]], 10, GREEN);
    paint(img, [[100, 400], [400, 420]], 10, GREEN, 0.45);
    const names = strokesOf(img).strokes.map((s) => s.colour);
    expect(names).toEqual(['green', 'green']);
  });

  it('flags a row of similar shapes (things in a row, or big lettering?)', () => {
    const img = canvas();
    for (let i = 0; i < 4; i++) paint(img, [[200 + i * 60, 300], [204 + i * 60, 300]], 14, [40, 40, 40]);
    const { strokes } = strokesOf(img);
    expect(strokes.length).toBe(4);
    for (const s of strokes) expect(s.flags.join()).toMatch(/similar shapes in a row/);
  });

  it('faint paint on its own is a stroke of its own colour, marked uncertain', () => {
    const img = canvas();
    paint(img, [[100, 200], [600, 220]], 10, [190, 210, 250]); // pale: never strong enough to be "solid"
    const alone = strokesOf(img);
    expect(alone.strokes.map((s) => s.colour)).toEqual(['pale blue']);
    expect(alone.layers[0].confidence).toBe('low');
    paint(img, [[100, 400], [600, 420]], 10, RED);
    const both = strokesOf(img);
    expect(both.strokes.map((s) => s.colour).sort()).toEqual(['pale blue', 'red']);
    expect(both.layers.find((l) => l.name === 'red')!.confidence).toBe('high');
  });

  it('faint paint crossing strong paint keeps its own colour', () => {
    const img = canvas();
    paint(img, [[100, 300], [700, 300]], 12, RED);
    paint(img, [[400, 60], [420, 560]], 10, [190, 210, 250]);
    const names = strokesOf(img).strokes.map((s) => s.colour).sort();
    expect(names).toEqual(['pale blue', 'red']);
  });

  it('a small dark dab is kept (only thin dark slivers on paint are lettering)', () => {
    const img = canvas();
    paint(img, [[400, 300], [401, 300]], 6, [20, 20, 20]);
    expect(strokesOf(img).strokes.map((s) => `${s.colour} ${s.class}`)).toEqual(['black dab']);
  });

  it("a thin strip of a different colour along a stroke (a soft rim) doesn't become a stroke", () => {
    const img = canvas();
    paint(img, [[100, 300], [700, 300]], 14, BROWN);
    for (let x = 100; x < 700; x++) for (let y = 314; y < 317; y++) img.data.set([200, 170, 120], (y * W + x) * 4);
    expect(strokesOf(img).strokes.map((s) => s.colour)).toEqual(['brown']);
  });

  it("strokes crossing each other aren't a row of shapes", () => {
    const img = canvas();
    for (let i = 0; i < 3; i++) paint(img, [[300 + i * 20, 250], [330 + i * 20, 330]], 10, [[200, 40, 40], [40, 160, 40], [40, 60, 200]][i] as Rgb);
    for (const s of strokesOf(img).strokes) expect(s.flags.join()).not.toMatch(/similar shapes in a row/);
  });

  it('a solid patch of paint is a fill, not a dab', () => {
    const img = canvas();
    for (let y = 150; y < 390; y++) for (let x = 100; x < 460; x++) img.data.set(GREEN, (y * W + x) * 4);
    paint(img, [[640, 300], [641, 300]], 90, BLUE); // a big disc
    const classes = Object.fromEntries(strokesOf(img).strokes.map((s) => [s.colour, s.class]));
    expect(classes).toEqual({ green: 'fill', blue: 'fill' });
  });

  it('two crossing strokes of one colour come out as one branched line, flagged', () => {
    const img = canvas();
    paint(img, [[100, 550], [700, 80]], 12, BROWN);
    paint(img, [[80, 150], [760, 420]], 12, BROWN);
    const [s] = strokesOf(img).strokes;
    expect(s.class).toBe('line');
    expect(s.ends).toBe(4);
    expect(s.flags.join()).toMatch(/branched \(4 ends\)/);
    // each arm, from its end in to the crossing, to pair up by eye
    expect(s.branches!.length).toBe(4);
    // and each arm runs from its end right in to the crossing (where the two strokes meet)
    const meet = s.branches!.map((b) => b[b.length - 1]);
    for (const m of meet) for (const n of meet) expect(Math.hypot((m[0] - n[0]) * 2, m[1] - n[1])).toBeLessThan(12);
  });

  it('black lettering touching a black stroke stays pen', () => {
    const img = canvas();
    paint(img, [[0, 300], [800, 300]], 12, [20, 20, 20]);
    word(img, 300, 278, [20, 20, 20]);
    const res = strokesOf(img);
    expect(res.strokes.length).toBe(1);
    // the word's upper strokes are pen, the paint is paint
    for (const x of [306, 318, 330]) expect(res.isBrush(x, 270)).toBe(false);
    expect(res.isBrush(500, 300)).toBe(true);
  });

  it('a word touching a stroke of the same colour stays pen, and is attached and flagged', () => {
    const img = canvas();
    paint(img, [[0, 300], [800, 290]], 12, BROWN);
    word(img, 100, 274, BROWN);
    const res = strokesOf(img);
    expect(res.strokes.length).toBe(1);
    // the word's ink away from the stroke is not paint
    expect(res.isBrush(130, 266)).toBe(false);
    const ink = inkOverlay(img);
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (res.isBrush(x, y)) ink.data[(y * img.width + x) * 4 + 3] = 0;
    const small = { ...ink };
    const blobs = inkBlobs(resample(small));
    attachWords(res.strokes, blobs);
    expect(res.strokes[0].words.length).toBeGreaterThan(0);
    expect(res.strokes[0].flags.join()).toMatch(/a word touches this paint/);
  });

  it('lettering written on a fill stays pen', () => {
    const img = canvas();
    paint(img, zigzag(100, 100, 700, 500, 22), 12, [242, 211, 107]);
    word(img, 360, 300);
    const res = strokesOf(img);
    expect(res.strokes.map((s) => s.class)).toEqual(['fill']);
    expect(res.isBrush(366, 292)).toBe(false);
    // and the fill is still paint where there's no lettering
    expect(res.isBrush(150, 111)).toBe(true);
  });

  it('flags a stroke that frames the whole picture (a table round a photographed page)', () => {
    const img = canvas([90, 74, 58]);
    for (let y = 30; y < H - 30; y++) for (let x = 30; x < W - 30; x++) img.data.set([244, 239, 226], (y * W + x) * 4);
    word(img, 300, 300);
    const { strokes } = strokesOf(img);
    expect(strokes.length).toBe(1);
    expect(strokes[0].flags.join()).toMatch(/spans the whole picture/);
  });
});

describe('paper field', () => {
  // light falling off from the top left to a dark bottom right
  const uneven = () => {
    const img = canvas();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = (x / W + y / H) / 2;
      img.data.set([244 - 60 * t, 239 - 62 * t, 226 - 64 * t], (y * W + x) * 4);
    }
    return img;
  };

  it('follows unevenly lit paper, so the paper itself is not ink', () => {
    const img = uneven();
    paint(img, [[100, 300], [700, 300]], 1.5, [40, 40, 40]);
    const ink = inkOverlay(img);
    const alpha = (x: number, y: number) => ink.data[(y * W + x) * 4 + 3];
    expect(alpha(10, 10)).toBe(0);
    expect(alpha(790, 590)).toBe(0);
    expect(alpha(400, 300)).toBeGreaterThan(100);
    expect(strokesOf(img).strokes).toEqual([]);
  });

  it('is the paper colour everywhere on evenly lit paper, even under big paint', () => {
    const img = canvas([250, 248, 240]);
    paint(img, zigzag(100, 100, 500, 400, 20), 14, GREEN);
    const f = paperField(img);
    for (const [x, y] of [[5, 5], [300, 250], [795, 595]] as Pt[]) expect(f.at(x, y).map(Math.round)).toEqual([250, 248, 240]);
  });

  it('paint.png keeps the ink in its own colours', () => {
    const img = canvas();
    paint(img, [[100, 300], [700, 300]], 14, BROWN);
    const p = paintOverlay(img, paperField(img));
    const i = (300 * W + 400) * 4;
    expect([...p.data.slice(i, i + 4)]).toEqual([...BROWN, 153]);
    expect(p.data[(10 * W + 10) * 4 + 3]).toBe(0);
  });
});

describe.skipIf(spawnSync('magick', ['-version']).status !== 0)('real lettering', () => {
  it('big bold lettering that passes for paint is flagged as maybe lettering', () => {
    const f = join(mkdtempSync(join(tmpdir(), 'kq-bold-')), 'bold.png');
    spawnSync('magick', ['-size', '800x600', 'xc:white', '-font', 'Arial-Black', '-pointsize', '90', '-fill', '#222222', '-annotate', '+60+200', 'BIG TITLE', f]);
    const { strokes } = strokesOf(readRgbaPng(f));
    expect(strokes.length).toBeGreaterThan(0);
    expect(strokes.filter((s) => /similar shapes in a row/.test(s.flags.join())).length).toBeGreaterThanOrEqual(strokes.length - 1);
  });
});

describe('the fixtures', () => {
  it('finds no paint in the pen-only sketches (01-08), only the table round the photographed pages', () => {
    const pngs = ['01-castle-words', '02-river-valley', '03-cottage-kitchen', '04-farm-extents', '05-street-levels'];
    for (const f of [...pngs.map((n) => `app/tests/fixtures/sketches/${n}.png`), 'app/tests/fixtures/sketches/holdout/07-graveyard.png']) {
      expect(strokesOf(readRgbaPng(f)).strokes).toEqual([]);
    }
  });
});

const hasMagick = spawnSync('magick', ['-version']).status === 0;
describe.skipIf(!hasMagick)('grid with paint', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'kq-strokes-'));
  it('writes strokes.json and paint.png and prints the stroke table for a hybrid sketch only', () => {
    const run = (f: string, name: string) => spawnSync('pnpm', ['exec', 'tsx', 'app/scripts/grid.ts', f, '--fit', '--name', name, '--out', tmp], { encoding: 'utf8', timeout: 120_000 });
    const r = run('app/tests/fixtures/sketches/10-lake-cabin.png', 'h');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/brush strokes \(4;/);
    expect(r.stdout).toMatch(/~1 +blue +loop/);
    const json = JSON.parse(readFileSync(join(tmp, 'h', 'strokes.json'), 'utf8'));
    expect(json.strokes.map((s: { class: string }) => s.class).sort()).toEqual(['dab', 'fill', 'line', 'loop']);
    expect(existsSync(join(tmp, 'h', 'paint.png'))).toBe(true);
    // strokes.pic is PicScript: it compiles, and has one list per stroke
    const pic = readFileSync(join(tmp, 'h', 'strokes.pic'), 'utf8');
    expect(pic.match(/^let stroke_\d+ = \[\[/gm)?.length).toBe(4);
    expect(() => compileProgram(parse(pic, 'strokes.pic'))).not.toThrow();
    // a pen-only sketch into the same folder: nothing left over from the hybrid
    const p = run('app/tests/fixtures/sketches/01-castle-words.png', 'h');
    expect(p.status).toBe(0);
    expect(p.stdout).not.toMatch(/brush strokes/);
    expect(existsSync(join(tmp, 'h', 'strokes.json'))).toBe(false);
    expect(existsSync(join(tmp, 'h', 'strokes.pic'))).toBe(false);
    expect(existsSync(join(tmp, 'h', 'paint.png'))).toBe(false);
    // the photographed pages: only the table round the page, flagged
    for (const f of ['app/tests/fixtures/sketches/06-camp-scan.jpg']) {
      const r2 = run(f, 'photo');
      expect(r2.status).toBe(0);
      const strokes = existsSync(join(tmp, 'photo', 'strokes.json')) ? JSON.parse(readFileSync(join(tmp, 'photo', 'strokes.json'), 'utf8')).strokes : [];
      const big = strokes.filter((s: { flags: string[] }) => s.flags.some((x) => /spans the whole picture/.test(x)));
      expect(big.length).toBe(1);
    }
  }, 240_000);
});

function resample(img: RgbaImage): RgbaImage {
  // the blob table works on the display-sized overlay (960×504)
  const w = 960;
  const h = 504;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.floor((x * img.width) / w);
    const sy = Math.floor((y * img.height) / h);
    data.set(img.data.slice((sy * img.width + sx) * 4, (sy * img.width + sx) * 4 + 4), (y * w + x) * 4);
  }
  return { width: w, height: h, data };
}
