// `pnpm grid --vga` and `pnpm render --beside/--overlay` for `mode vga` scenes: everything is
// measured in VGA picture coordinates (320×200, square pixels). The AGI behaviour of both tools is
// pinned by cli.test.ts and must not change.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPng } from '../../scripts/lib/png.ts';

const tsx = (script: string, ...args: string[]) => spawnSync('pnpm', ['exec', 'tsx', script, ...args], { encoding: 'utf8', timeout: 120_000 });
const magick = (...args: string[]) => spawnSync('magick', args, { encoding: 'utf8' });
const tmp = mkdtempSync(join(tmpdir(), 'kq-vga-tools-'));
// like the other grid tests, these need ImageMagick
const hasMagick = spawnSync('magick', ['-version']).status === 0;
const at = (png: ReturnType<typeof readPng>, x: number, y: number) => [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3)];

// a 640×400 (1.6:1) test card: grey, with a red block at source (588-611, 368-391) → picture ≈ (294-305, 184-195)
const card = join(tmp, 'card.png');
if (hasMagick) magick('-size', '640x400', 'xc:#808080', '-fill', '#ff0000', '-draw', 'rectangle 588,368 611,391', '-fill', '#0000ff', '-draw', 'rectangle 0,0 23,23', card);

describe.skipIf(!hasMagick)('pnpm grid --vga', () => {
  const out = join(tmp, 'g');
  const r = tsx('app/scripts/grid.ts', card, '--vga', '--name', 'card', '--out', out);
  const dir = join(out, 'card');

  it('keeps a 1.6:1 image whole and writes VGA-sized outputs', () => {
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/kept all of it/);
    expect(r.stdout).not.toMatch(/squashed/);
    const size = (f: string) => {
      const p = readPng(join(dir, f));
      return [p.width, p.height];
    };
    expect(size('picture.png')).toEqual([320, 200]);
    expect(size('view.png')).toEqual([960, 600]);
    expect(size('grid.png')).toEqual([1280, 800]);
    for (const q of ['tl', 'tr', 'bl', 'br']) expect(size(`grid-${q}.png`)).toEqual([1280, 800]);
  });

  it('puts a landmark past AGI\'s 159/167 limits at its VGA picture coordinates', () => {
    const pic = readPng(join(dir, 'picture.png'));
    expect(at(pic, 300, 190)).toEqual([255, 0, 0]);
    expect(at(pic, 5, 5)).toEqual([0, 0, 255]);
    expect(at(pic, 280, 170)).toEqual([128, 128, 128]);
    const t = JSON.parse(readFileSync(join(dir, 'transform.json'), 'utf8'));
    expect(t).toMatchObject({ pictureSize: [320, 200], pixelAspect: 1, scale: [0.5, 0.5] });
  });

  it('the bottom-right quarter covers x 160-319, y 100-199', () => {
    // the red block is at picture (294-305, 184-195): in grid-br (×8 from 160,100) at ((300-160)·8, (190-100)·8)
    const br = readPng(join(dir, 'grid-br.png'));
    expect(at(br, (300 - 160) * 8 + 4, (190 - 100) * 8 + 4)).toEqual([255, 0, 0]);
  });

  it('reproduces with --vga, and squashes a 1.9:1 image to 1.6:1 within the limit', () => {
    expect(r.stdout).toMatch(/reproduce: pnpm grid \S+ --crop 0,0,640,400 --vga --name card/);
    const wide = join(tmp, 'wide.png');
    magick('-size', '760x400', 'xc:#808080', wide);
    const w = tsx('app/scripts/grid.ts', wide, '--vga', '--name', 'wide', '--out', out);
    expect(w.stdout).toMatch(/kept 752×400 at 4,0, squashed 15% to fit/);
  });

  it('maps an ASCII layout onto the VGA picture: the AGI positions scaled to 320×200', () => {
    const txt = 'app/tests/fixtures/sketches/holdout/08-dungeon-ascii.txt';
    const l = tsx('app/scripts/grid.ts', txt, '--vga', '--name', 'lay', '--out', out);
    expect(l.status).toBe(0);
    expect(l.stdout).toMatch(/reproduce: pnpm grid \S+ --vga --name lay/);
    tsx('app/scripts/grid.ts', txt, '--name', 'lay-agi', '--out', out);
    type Label = { text: string; centre: number[]; box: number[] };
    const read = (n: string) => JSON.parse(readFileSync(join(out, n, 'labels.json'), 'utf8')).labels as Label[];
    const [vga, agi] = [read('lay'), read('lay-agi')];
    expect(vga.length).toBe(agi.length);
    vga.forEach((v, i) => {
      expect(v.box[0]).toBeCloseTo(agi[i].box[0] * 2, 6);
      expect(v.box[3]).toBeCloseTo((agi[i].box[3] * 200) / 168, 6);
    });
    expect(Math.max(...vga.map((v) => v.box[2]))).toBeGreaterThan(160);
    expect(readPng(join(out, 'lay', 'ink.png')).width).toBe(960);
  });

  it('a --fit sketch gives a 960×600 ink overlay and blobs in VGA coordinates', () => {
    const f = tsx('app/scripts/grid.ts', 'app/tests/fixtures/sketches/04-farm-extents.png', '--fit', '--vga', '--name', 'farm', '--out', out);
    expect(f.status).toBe(0);
    const ink = readPng(join(out, 'farm', 'ink.png'));
    expect([ink.width, ink.height]).toEqual([960, 600]);
    const blobs = JSON.parse(readFileSync(join(out, 'farm', 'blobs.json'), 'utf8')) as Array<{ box: number[] }>;
    expect(Math.max(...blobs.map((b) => b.box[2]))).toBeGreaterThan(200);
    expect(Math.max(...blobs.map((b) => b.box[2]))).toBeLessThanOrEqual(320);
    expect(Math.max(...blobs.map((b) => b.box[3]))).toBeLessThanOrEqual(200);
  });

  it('a hybrid sketch\'s brush strokes are the AGI strokes scaled to 320×200', () => {
    const src = 'app/tests/fixtures/sketches/13-cove.png';
    expect(tsx('app/scripts/grid.ts', src, '--fit', '--vga', '--name', 'cove', '--out', out).status).toBe(0);
    tsx('app/scripts/grid.ts', src, '--fit', '--name', 'cove-agi', '--out', out);
    type Stroke = { box: number[] };
    const read = (n: string) => JSON.parse(readFileSync(join(out, n, 'strokes.json'), 'utf8')).strokes as Stroke[];
    const [vga, agi] = [read('cove'), read('cove-agi')];
    expect(vga.length).toBeGreaterThan(0);
    expect(vga.length).toBe(agi.length);
    vga.forEach((v, i) => {
      expect(v.box[0]).toBeCloseTo(agi[i].box[0] * 2, 4);
      expect(v.box[2]).toBeCloseTo(agi[i].box[2] * 2, 4);
      expect(v.box[1]).toBeCloseTo((agi[i].box[1] * 200) / 168, 4);
    });
    expect(readPng(join(out, 'cove', 'paint.png')).height).toBe(600);
  });
});

describe.skipIf(!hasMagick)('pnpm render with a VGA reference', () => {
  const out = join(tmp, 'r');
  tsx('app/scripts/grid.ts', card, '--vga', '--name', 'card', '--out', join(tmp, 'g2'));
  tsx('app/scripts/grid.ts', 'app/tests/fixtures/sketches/04-farm-extents.png', '--fit', '--vga', '--name', 'farm', '--out', join(tmp, 'g2'));
  const pic = join(tmp, 'g2', 'card', 'picture.png');
  const ink = join(tmp, 'g2', 'farm', 'ink.png');
  const scene = join(tmp, 'v.pic');
  writeFileSync(scene, 'mode vga\ncolor "#808080"\nrect 0, 0, 319, 199\ncolor "#ff0000"\nrect 294, 184, 305, 195\nframe()');
  const agi = join(tmp, 'a.pic');
  writeFileSync(agi, 'color red\nrect 0, 0, 159, 167');

  it('--beside takes a 320×200 picture and lines it up with the render', () => {
    const r = tsx('app/scripts/render.ts', scene, '--beside', pic, '--scale', '1', '--out', out);
    expect(r.status).toBe(0);
    const png = readPng(join(out, 'v.png'));
    expect([png.width, png.height]).toEqual([320 * 2 + 4, 200]);
    // the same landmark in both panels
    expect(at(png, 300, 190)).toEqual([255, 0, 0]);
    expect(at(png, 324 + 300, 190)).toEqual([255, 0, 0]);
  });

  it('--overlay takes a 960×600 ink overlay, and crops near the bottom-right corner', () => {
    const r = tsx('app/scripts/render.ts', scene, '--overlay', ink, '--scale', '3', '--crop', '280,160,319,199', '--out', out);
    expect(r.status).toBe(0);
    const png = readPng(join(out, 'v-overlay.png'));
    expect([png.width, png.height]).toEqual([40 * 3, 40 * 3]);
  });

  it('refuses an AGI-sized picture for a VGA scene, and a VGA picture for an AGI scene', () => {
    const agiPic = join(tmp, 'agi.png');
    magick('-size', '160x168', 'xc:gray', agiPic);
    const a = tsx('app/scripts/render.ts', scene, '--beside', agiPic, '--out', out);
    expect(a.status).toBe(2);
    expect(a.stderr).toMatch(/expected 320×200, got 160×168 - make one with 'pnpm grid <image> --vga'/);
    const b = tsx('app/scripts/render.ts', agi, '--beside', pic, '--out', out);
    expect(b.status).toBe(2);
    expect(b.stderr).toMatch(/expected 160×168, got 320×200/);
    const c = tsx('app/scripts/render.ts', agi, scene, '--beside', pic, '--out', out);
    expect(c.status).toBe(2);
  });

  it('crops are measured in VGA coordinates for VGA scenes, with the usual errors', () => {
    expect(tsx('app/scripts/render.ts', scene, '--crop', '300,180,400,300', '--scale', '1', '--out', join(out, 'c')).status).toBe(0);
    expect(readPng(join(out, 'c', 'v.png')).width).toBe(20);
    const bad = tsx('app/scripts/render.ts', scene, '--crop', '330,0,340,10', '--out', out);
    expect(bad.status).toBe(2);
    expect(bad.stderr).toMatch(/inside 0-319 × 0-199/);
  });

  it('a mixed batch keeps AGI\'s picture for --beside, and says so for the VGA scene', () => {
    const agiPic = join(tmp, 'agi.png');
    const r = tsx('app/scripts/render.ts', agi, scene, '--beside', agiPic, '--out', out);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/is a 'mode vga' scene, but --beside\/--overlay were checked against the AGI \(160×168\) picture/);
  });

  it('--compare stays AGI-only', () => {
    const r = tsx('app/scripts/render.ts', scene, '--compare', pic, '--out', out);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/--compare only works with AGI scenes/);
  });
});
