// Layout sketches (docs/PLAN.md §15): ASCII layouts, ink extraction, the overlay, and grid --fit.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Framebuffer } from '../../src/engine/framebuffer.ts';
import { areaSample, readPng, resampleRgba, writePanelsPng, type RgbaImage } from '../../scripts/lib/png.ts';
import { blobTable, cleanLayout, findFrame, inkBlobs, inkOverlay, layoutLabelArgs, layoutMvg, paperColour, parseLayout } from '../../scripts/lib/sketch.ts';

const tmp = mkdtempSync(join(tmpdir(), 'kq-sketch-'));
const tsx = (script: string, ...args: string[]) =>
  spawnSync('pnpm', ['exec', 'tsx', script, ...args], { encoding: 'utf8', timeout: 60_000 });
const hasMagick = spawnSync('magick', ['-version']).status === 0;

const TODO = `|--------------------------------------------|
|                                       SUN  |
|                                            |
|           BIRD_FLYING_RIGHT                |
|                                            |
|                                            |
|  TREE1                BIG_TREE2            |
|--------------------------------------------|`;

describe('ASCII layouts', () => {
  it('finds the TODO.md frame and computes label centres from cells', () => {
    const l = parseLayout(TODO);
    expect([l.w, l.h, l.framed]).toEqual([44, 6, true]);
    const at = Object.fromEntries(l.labels.map((x) => [x.text, x]));
    expect(Object.keys(at)).toEqual(['SUN', 'BIRD_FLYING_RIGHT', 'TREE1', 'BIG_TREE2']);
    // SUN spans interior columns 39-41 of 44, row 0 of 6
    expect(at.SUN.cols).toEqual([39, 41]);
    const near = (got: number[], want: number[]) => got.forEach((v, i) => expect(v).toBeCloseTo(want[i], 6));
    near(at.SUN.centre, [(40.5 * 160) / 44, 14]); // 147.27…
    near(at.SUN.box, [(39 * 160) / 44, 0, (42 * 160) / 44, 28]);
    near(at.TREE1.centre, [(4.5 * 160) / 44, 154]);
    expect(l.ink).toEqual([]);
  });

  it('cleans up pasted text: fences, CRLF, tabs, common indentation, ragged lines', () => {
    const lines = cleanLayout('```text\r\n    +----+\r\n    |\tA|\r\n    +----+\r\n```\r\n');
    // the tab after `    |` (column 5) runs to column 8, then the common indent of 4 goes
    expect(lines).toEqual(['+----+', '|   A|', '+----+']);
    expect(cleanLayout('AB\n  CDEF\n\n')).toEqual(['AB    ', '  CDEF']);
  });

  it('needs side characters on every row: an internal line is not a frame, a broken side is not either', () => {
    const inner = ['+--------+', '| A      |', '|------- |', '| B      |', '+--------+'].map((r) => [...r]);
    expect(findFrame(inner)).toEqual([0, 0, 4, 9]);
    const broken = ['+------+', '| A    |', '| B     ', '+------+'].map((r) => [...r]);
    expect(findFrame(broken)).toBeUndefined();
    // unicode box drawing
    const box = ['┌────┐', '│ HI │', '└────┘'].map((r) => [...r]);
    expect(findFrame(box)).toEqual([0, 0, 2, 5]);
  });

  it('picks the largest frame and reports words outside it', () => {
    const l = parseLayout(['NOTE: night, fog', '+------+', '| +--+ |', '| |AB| |', '| +--+ |', '+------+', 'key: blue = water'].join('\n'));
    expect([l.w, l.h]).toEqual([6, 3]);
    expect(l.labels.map((x) => x.text)).toEqual(['AB']);
    expect(l.outside).toEqual(['NOTE: night, fog', 'key: blue = water']);
  });

  it('tokens: brackets, single-space phrases, colon/comma phrases; lone letters and underscores are ink', () => {
    const l = parseLayout(['[IRON DOOR]  big oak tree  o  __  SKY: orange sunset', 'sheep x3   a   X-WING'].join('\n'));
    expect(l.framed).toBe(false);
    expect(l.labels.map((x) => x.text)).toEqual(['IRON DOOR', 'big oak tree', 'SKY: orange sunset', 'sheep x3', 'WING']);
    const inkChars = l.ink.map(([, , ch]) => ch).join('');
    expect(inkChars).toBe('o__aX-');
    // a bracketed label's centre includes its brackets: columns 0-10 of the widest row
    expect(l.labels[0].cols).toEqual([0, 10]);
  });

  it('without a frame the whole block is the canvas', () => {
    const l = parseLayout('SUN\n\n\nTREE');
    expect([l.w, l.h, l.framed]).toEqual([4, 4, false]);
    expect(l.labels[1].centre).toEqual([80, 147]); // TREE spans all 4 columns of the bottom row
  });

  it('rejects an empty layout or an empty frame', () => {
    expect(() => parseLayout('   \n  ')).toThrow(/empty/);
  });

  it('draws ink as strokes, and each label auto-sized into a box on its span', () => {
    const l = parseLayout('+----+\n|AB/-|\n+----+');
    const mvg = layoutMvg(l);
    expect(mvg).toContain('line 48,48 72,0'); // the `/` in column 2
    expect(mvg).toContain('line 72,24 96,24'); // the `-` in column 3
    expect(mvg).not.toContain('AB');
    // AB spans columns 0-1 → a 44×38 box at +2+5
    const args = layoutLabelArgs(l);
    expect(args).toEqual(['(', '-background', 'none', '-fill', 'black', '-size', '44x38', '-gravity', 'center', 'label:AB', ')', '-gravity', 'northwest', '-geometry', '+2+5', '-composite']);
    expect(layoutLabelArgs(parseLayout('[@etc/passwd]'))).toContain('label: @etc/passwd');
  });

  it('phrases may hold short inner words; single spaces join, two separate', () => {
    expect(parseLayout('CASTLE ON A HILL   SUN MOON  SUN  MOON  TREE o').labels.map((x) => x.text)).toEqual(['CASTLE ON A HILL', 'SUN MOON', 'SUN', 'MOON', 'TREE']);
  });

  it('counts an astral character as one cell (columns and tab stops)', () => {
    const l = parseLayout('😀 AB');
    expect(l.w).toBe(4);
    expect(l.labels[0].cols).toEqual([2, 3]);
    expect(l.ink).toEqual([[0, 0, '😀']]);
    expect(cleanLayout('😀\tX')).toEqual(['😀       X']);
  });

  it('keeps full precision, so the floored pixel is right', () => {
    // 81 columns: a label in columns 0-1 is centred at x = 160/81 ≈ 1.975, pixel 1 (not 2)
    const l = parseLayout(`AB${' '.repeat(78)}.`);
    expect(l.w).toBe(81);
    expect(Math.floor(l.labels[0].centre[0])).toBe(1);
  });
});

const solid = (w: number, h: number, rgb: [number, number, number], alpha = 255): RgbaImage => {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < data.length; i += 4) data.set([...rgb, alpha], i);
  return { width: w, height: h, data };
};
const put = (img: RgbaImage, x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]) => {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) img.data.set(rgb, (y * img.width + x) * 4);
};

describe('ink extraction', () => {
  it('finds the paper even when a frame or a table fills the border', () => {
    const img = solid(100, 50, [90, 70, 50]); // a brown table…
    put(img, 6, 4, 94, 46, [240, 232, 216]); // …with a cream page on it
    put(img, 30, 20, 60, 22, [80, 80, 80]); // and a pencil line
    expect(paperColour(img)).toEqual([240, 232, 216]);
  });

  it('turns dark, pale-pencil and coloured ink solid, paper and its noise clear, in one colour', () => {
    const img = solid(10, 1, [243, 237, 223]);
    const cols: [number, number, number][] = [[0, 0, 0], [110, 110, 110], [32, 80, 192], [192, 32, 32], [250, 244, 230], [225, 219, 205]];
    cols.forEach((c, i) => img.data.set(c, (i + 1) * 4));
    const ink = inkOverlay(img);
    const alpha = (i: number) => ink.data[i * 4 + 3];
    expect(alpha(0)).toBe(0); // paper
    for (const i of [1, 2, 3, 4]) expect(alpha(i)).toBe(Math.round(0.6 * 255)); // black, pencil, blue, red
    expect(alpha(5)).toBe(0); // paper noise (d ≈ 12)
    expect(alpha(6)).toBe(0); // darker paper noise (d ≈ 31)
    expect([...ink.data.subarray(4, 7)]).toEqual([255, 0, 255]);
  });

  it('a faint mark is partly transparent', () => {
    const img = solid(4, 1, [255, 255, 255]);
    img.data.set([209, 209, 209], 4); // d = 46·√3 ≈ 79.7 → alpha ≈ 0.5
    expect(inkOverlay(img).data[7]).toBe(Math.round(((46 * Math.sqrt(3) - 40) / 80) * 0.6 * 255));
  });
});

describe('panel overlay', () => {
  const render = (name: string, ov: RgbaImage, scale: number, crop?: { x: number; y: number; w: number; h: number }) => {
    const p = join(tmp, `${name}.png`);
    const fb = new Framebuffer();
    fb.pixels.fill(15); // white
    writePanelsPng(p, [{ fb }, { fb, overlay: ov }], scale, crop);
    return readPng(p);
  };

  it('composites only the panel that has it; alpha 0 leaves it alone, alpha 1 replaces it', () => {
    const ov = solid(960, 504, [255, 0, 255], 0);
    // left half fully opaque
    for (let y = 0; y < 504; y++) for (let x = 0; x < 480; x++) ov.data[(y * 960 + x) * 4 + 3] = 255;
    const png = render('ov1', ov, 1);
    const px = (x: number, y: number) => [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3)];
    expect(px(10, 10)).toEqual([255, 255, 255]); // first panel: no overlay
    expect(px(324 + 10, 10)).toEqual([255, 0, 255]); // second panel, left half
    expect(px(324 + 300, 10)).toEqual([255, 255, 255]); // second panel, right half
  });

  it('half alpha blends; box filtering is premultiplied (no dark fringe from transparent pixels)', () => {
    const ov = solid(320, 168, [0, 0, 0], 0); // transparent BLACK around…
    // …a 50% magenta block covering picture x 0-79
    for (let y = 0; y < 168; y++) for (let x = 0; x < 160; x++) ov.data.set([255, 0, 255, 128], (y * 320 + x) * 4);
    const png = render('ov2', ov, 1);
    const px = (x: number) => [...png.data.subarray((10 * png.width + 324 + x) * 4, (10 * png.width + 324 + x) * 4 + 3)];
    expect(px(10)).toEqual([255, 127, 255]);
    expect(px(300)).toEqual([255, 255, 255]); // transparent black adds nothing
  });

  it('weights partial pixels by area (960×504 at the default scale 2 is 1.5 overlay pixels per panel pixel)', () => {
    // overlay columns 0 and 1 opaque magenta, the rest transparent
    const ov = solid(960, 504, [255, 0, 255], 0);
    for (let y = 0; y < 504; y++) for (const x of [0, 1]) ov.data[(y * 960 + x) * 4 + 3] = 255;
    // panel pixel 1 at scale 2 covers overlay u 1.5-3.0: a third of it is the opaque column 1
    expect(areaSample(ov, 1.5, 3, 0, 1.5)[3]).toBeCloseTo(1 / 3, 6);
    const png = render('ov-s2', ov, 2);
    const at = (x: number) => png.data[(10 * png.width + 644 + x) * 4 + 1]; // green channel of panel 2
    expect(at(0)).toBe(0); // fully covered: magenta
    expect(at(1)).toBe(Math.round(255 * (2 / 3))); // a third covered
    expect(at(2)).toBe(255);
  });

  it('resamples odd-sized overlays and keeps the right and bottom edges', () => {
    const ov = solid(400, 210, [255, 0, 255], 0);
    // last column and last row opaque
    for (let y = 0; y < 210; y++) ov.data[(y * 400 + 399) * 4 + 3] = 255;
    for (let x = 0; x < 400; x++) ov.data[(209 * 400 + x) * 4 + 3] = 255;
    const png = render('ov-odd', ov, 1, { x: 150, y: 158, w: 10, h: 10 });
    const g = (x: number, y: number) => png.data[(y * png.width + 24 + x) * 4 + 1];
    expect(g(19, 0)).toBeLessThan(255); // right edge touched
    expect(g(0, 9)).toBeLessThan(255); // bottom edge touched
    expect(g(0, 0)).toBe(255);
    const half = resampleRgba(solid(4, 2, [10, 20, 30], 255), 2, 1);
    expect([...half.data]).toEqual([10, 20, 30, 255, 10, 20, 30, 255]);
  });

  it('lines up under --crop at any scale', () => {
    // a single opaque overlay pixel at picture (100, 50) on a 960×504 overlay (6 × 3 per picture pixel)
    const ov = solid(960, 504, [255, 0, 255], 0);
    for (let y = 150; y < 153; y++) for (let x = 600; x < 606; x++) ov.data[(y * 960 + x) * 4 + 3] = 255;
    for (const scale of [1, 3, 8]) {
      const png = render(`ov3-${scale}`, ov, scale, { x: 90, y: 40, w: 20, h: 20 });
      const pw = 20 * 2 * scale;
      const at = (lx: number, ly: number) => {
        const o = ((ly * scale + Math.floor(scale / 2)) * png.width + pw + 4 + lx * 2 * scale + scale) * 4;
        return [...png.data.subarray(o, o + 3)];
      };
      expect(at(10, 10), `scale ${scale}`).toEqual([255, 0, 255]); // picture (100, 50)
      expect(at(9, 10), `scale ${scale}`).toEqual([255, 255, 255]);
      expect(at(10, 11), `scale ${scale}`).toEqual([255, 255, 255]);
    }
  });
});

describe.skipIf(!hasMagick)('grid --fit and layouts (CLI)', () => {
  it('--fit keeps the whole 4:3 canvas, writes ink.png and transform.json, and reproduces with --fit', () => {
    const img = join(tmp, 'sketch.png');
    spawnSync('magick', ['-size', '1024x768', 'xc:white', '-fill', 'black', '-draw', 'rectangle 0,0 99,99', '-draw', 'rectangle 924,668 1023,767', img]);
    const out = join(tmp, 'fit');
    const r = tsx('app/scripts/grid.ts', img, '--fit', '--name', 's', '--out', out);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/kept all of it, fitted: x ×0\.156, y ×0\.219 \(shapes come out 1\.43× wider than drawn\)/);
    expect(r.stdout).toMatch(/reproduce: .*--crop 0,0,1024,768 .*--fit/);
    const t = JSON.parse(readFileSync(join(out, 's', 'transform.json'), 'utf8'));
    expect(t).toMatchObject({ mode: 'fit', region: { x: 0, y: 0, w: 1024, h: 768 } });
    const ink = readPng(join(out, 's', 'ink.png'));
    expect([ink.width, ink.height]).toEqual([960, 504]);
    const a = (x: number, y: number) => ink.data[(y * 960 + x) * 4 + 3];
    expect(a(5, 5)).toBeGreaterThan(120); // top-left square: picture 0-15 × 0-21
    expect(a(955, 500)).toBeGreaterThan(120); // the bottom-right one survives (it'd be cropped without --fit)
    expect(a(480, 250)).toBe(0);
  });

  it('--fit refuses an explicit --anchor or --max-squash, and works after --tile and --trim', () => {
    const img = join(tmp, 'sheet.png');
    spawnSync('magick', ['-size', '800x400', 'xc:white', '-fill', 'black', '-draw', 'rectangle 450,50 750,350', '-fill', 'white', '-draw', 'rectangle 470,70 730,330', img]);
    expect(tsx('app/scripts/grid.ts', img, '--fit', '--anchor', 'top').status).toBe(2);
    expect(tsx('app/scripts/grid.ts', img, '--fit', '--max-squash', '0.2').status).toBe(2);
    const out = join(tmp, 'tiles');
    const r = tsx('app/scripts/grid.ts', img, '--tile', '2x1:2,1', '--trim', '--fit', '--name', 't', '--out', out);
    expect(r.status, r.stderr).toBe(0);
    // tile 2 starts at x 400; trimming its white border leaves the 301×301 box at 450,50
    const t = JSON.parse(readFileSync(join(out, 't', 'transform.json'), 'utf8'));
    expect(t.region).toEqual({ x: 450, y: 50, w: 301, h: 301 });
  });

  it('an ASCII layout prints exact label positions, writes labels.json, and refuses image options', () => {
    const f = join(tmp, 'layout.txt');
    writeFileSync(f, `\`\`\`\n${TODO}\n\`\`\`\n`);
    const out = join(tmp, 'ascii');
    const r = tsx('app/scripts/grid.ts', f, '--name', 'todo', '--out', out);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/44×6 cells inside the frame/);
    expect(r.stdout).toMatch(/SUN\s+cols 39-41, row 0\s+centre 147\.3,14 /);
    expect(r.stdout).toMatch(/reproduce: pnpm grid \S+layout\.txt --name todo$/m);
    const labels = JSON.parse(readFileSync(join(out, 'todo', 'labels.json'), 'utf8'));
    expect(labels.labels.map((l: { text: string }) => l.text)).toEqual(['SUN', 'BIRD_FLYING_RIGHT', 'TREE1', 'BIG_TREE2']);
    const ink = readPng(join(out, 'todo', 'ink.png'));
    // the word SUN is drawn around picture (147, 14) → ink.png (6×, 3×) ≈ (884, 42)
    let hit = 0;
    for (let y = 30; y < 55; y++) for (let x = 860; x < 910; x++) hit += ink.data[(y * 960 + x) * 4 + 3] > 100 ? 1 : 0;
    expect(hit).toBeGreaterThan(20);
    for (const bad of [['--trim'], ['--crop', '0,0,10,10'], ['--tile', '2x2:1,1'], ['--anchor', 'top']]) {
      expect(tsx('app/scripts/grid.ts', f, ...bad).status, bad.join(' ')).toBe(2);
    }
  });

  it('fits wide words inside their span, and keeps a thin pale line from a large image', () => {
    const f = join(tmp, 'wide.txt');
    writeFileSync(f, '+----------+\n|   WWW    |\n+----------+\n');
    const out = join(tmp, 'wide');
    expect(tsx('app/scripts/grid.ts', f, '--name', 'w', '--out', out).status).toBe(0);
    // WWW is columns 3-5 of 10 → picture x 48-96 → ink.png x 288-576; nothing outside it
    const ink = readPng(join(out, 'w', 'ink.png'));
    let inside = 0;
    let outside = 0;
    for (let y = 0; y < 504; y++) {
      for (let x = 0; x < 960; x++) {
        if (ink.data[(y * 960 + x) * 4 + 3] < 40) continue;
        if (x >= 288 && x < 576) inside++;
        else outside++;
      }
    }
    expect(inside).toBeGreaterThan(500);
    expect(outside).toBe(0);
    const big = join(tmp, 'thin.png');
    spawnSync('magick', ['-size', '4000x3000', 'xc:white', '-stroke', '#888888', '-strokewidth', '1', '-draw', 'line 0,1500 3999,1500', big]);
    expect(tsx('app/scripts/grid.ts', big, '--fit', '--name', 'thin', '--out', out).status).toBe(0);
    const thin = readPng(join(out, 'thin', 'ink.png'));
    let peak = 0;
    for (let y = 240; y < 265; y++) peak = Math.max(peak, thin.data[(y * 960 + 480) * 4 + 3]);
    expect(peak).toBeGreaterThan(20);
  });

  it('render --overlay draws ink.png on the scene panel only, leaves scores alone, and checks the aspect', () => {
    const ink = join(tmp, 'ink.png');
    spawnSync('magick', ['-size', '960x504', 'xc:#ff00ff', ink]);
    const out = join(tmp, 'ovr');
    const plain = tsx('app/scripts/render.ts', 'scenes/kq1/r01-c01.pic', '--compare', '--scale', '1', '--out', join(out, 'a'));
    const r = tsx('app/scripts/render.ts', 'scenes/kq1/r01-c01.pic', '--compare', '--overlay', ink, '--scale', '1', '--out', join(out, 'b'));
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('match 100.00%');
    expect(plain.stdout).toContain('match 100.00%');
    expect(r.stdout).toMatch(/with the overlay .*r01-c01-overlay\.png/);
    // the plain render is unchanged; the overlay goes to its own file
    expect(readPng(join(out, 'b', 'r01-c01.png')).data).toEqual(readPng(join(out, 'a', 'r01-c01.png')).data);
    const png = readPng(join(out, 'b', 'r01-c01-overlay.png'));
    const px = (x: number) => [...png.data.subarray((80 * png.width + x) * 4, (80 * png.width + x) * 4 + 3)];
    const before = readPng(join(out, 'a', 'r01-c01.png'));
    const bx = (x: number) => [...before.data.subarray((80 * before.width + x) * 4, (80 * before.width + x) * 4 + 3)];
    expect(px(100)).toEqual(bx(100)); // reference panel untouched
    expect(px(324 + 100)).toEqual([255, 0, 255]); // scene panel covered
    expect(px(648 + 100)).toEqual(bx(648 + 100)); // diff panel untouched
    expect(tsx('app/scripts/render.ts', 'scenes/kq1/r01-c01.pic', '--overlay', 'reference/kq6/r03-c01.png').status).toBe(2);
    expect(tsx('app/scripts/render.ts', 'scenes/kq1/r01-c01.pic', '--overlay', 'nope.png').status).toBe(2);
  });
});

describe('ink blobs', () => {
  it('finds faint ink that ink.png keeps (pale pencil, RGB distance ≈ 70 from the paper)', () => {
    const page = solid(960, 504, [255, 255, 255]);
    put(page, 400, 200, 440, 214, [215, 215, 215]); // d ≈ 69
    const blobs = inkBlobs(inkOverlay(page));
    expect(blobs).toHaveLength(1);
    expect(blobs[0].box[0]).toBeCloseTo(400 / 6, 3);
  });

  it('joins the letters of a word and single-spaced words, separates labels, and classes line work', () => {
    const img = solid(960, 504, [255, 0, 255], 0);
    const ink = (x0: number, y0: number, x1: number, y1: number) => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) img.data[(y * 960 + x) * 4 + 3] = 255;
    };
    // "SUN": three letters 8 px wide with 3 px gaps, at x 600-630, y 30-45
    for (const x of [600, 611, 622]) ink(x, 30, x + 8, 45);
    // "BIG TREE": two words with a 6 px space
    ink(100, 300, 130, 315);
    ink(136, 300, 170, 315);
    // a separate label 40 px further right
    ink(210, 300, 240, 315);
    // a horizon line across the picture
    ink(0, 200, 960, 202);
    // speckle, dropped
    ink(500, 450, 502, 452);
    // big lettering (5 tall letters, 3 strokes each) is a mark; a box outline is strokes
    for (let k = 0; k < 15; k++) ink(300 + k * 14 + (k % 3) * 2, 400, 304 + k * 14 + (k % 3) * 2, 440);
    ink(700, 400, 900, 402);
    ink(700, 470, 900, 472);
    ink(700, 400, 702, 472);
    ink(898, 400, 900, 472);
    const blobs = inkBlobs(img);
    expect(blobs.map((b) => b.shape)).toEqual(['mark', 'strokes', 'mark', 'mark', 'mark', 'strokes']);
    const near = (got: number[], want: number[]) => got.forEach((v, i) => expect(v).toBeCloseTo(want[i], 3));
    near(blobs[0].box, [100, 10, 105, 15]); // SUN: 600/6 … 630/6, 30/3 … 45/3
    near(blobs[2].box, [100 / 6, 100, 170 / 6, 105]); // BIG TREE as one
    near(blobs[3].box, [35, 100, 40, 105]);
    expect(blobTable(blobs)).toMatch(/#1 +mark +centre 102\.5,12\.5 +box 100,10-105,15/);
  });
});
