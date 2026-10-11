// The render and lint CLIs are part of the skill's workflow; keep their behaviour pinned.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPng } from '../../scripts/lib/png.ts';

const tsx = (script: string, ...args: string[]) =>
  spawnSync('pnpm', ['exec', 'tsx', script, ...args], { encoding: 'utf8', timeout: 60_000 });

const tmp = mkdtempSync(join(tmpdir(), 'kq-cli-'));
const scene = (name: string, src: string) => {
  const p = join(tmp, `${name}.pic`);
  writeFileSync(p, src);
  return p;
};

describe('render CLI', () => {
  it('renders every variant at display aspect', () => {
    const f = scene('vars', 'variants day, night\nsky 20\nground 21\nif variant == "night" { night() }\nframe');
    const out = join(tmp, 'out1');
    const r = tsx('app/scripts/render.ts', f, '--variant', 'all', '--out', out, '--scale', '1');
    expect(r.status).toBe(0);
    expect(readdirSync(out).sort()).toEqual(['vars-day.png', 'vars-night.png']);
    const png = readPng(join(out, 'vars-day.png'));
    expect([png.width, png.height]).toEqual([320, 168]);
  });

  it('compares against a reference and prints the match and confusion', () => {
    const r = tsx('app/scripts/render.ts', 'scenes/kq1/r05-c06.pic', '--compare', '--confusion', '--out', join(tmp, 'out2'));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('match 100.00% (0 px differ');
  });

  it('writes step frames', () => {
    const out = join(tmp, 'out3');
    tsx('app/scripts/render.ts', 'scenes/kq1/r05-c06.pic', '--steps', '3', '--out', out);
    expect(existsSync(join(out, 'r05-c06-steps.png'))).toBe(true);
  });

  it('reports errors with file:line:col and a non-zero exit', () => {
    const f = scene('bad', 'color blue\nline 0,0 (');
    const r = tsx('app/scripts/render.ts', f, '--out', join(tmp, 'out4'));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/bad\.pic:2:\d+: expected a value/);
  });
});

describe('lint CLI', () => {
  it('flags fills that paint nothing and fills that leak', () => {
    const f = scene('fills', 'color green\nrect 0,0 159,167\ncolor red\nfill 80,80\n');
    const leak = scene('leak', 'color blue\nline 0,20 159,20\nfill 80,5\nline 10,100 40,100 40,120\ncolor yellow\nfill 20,110\n');
    const first = scene('first', 'color red\nfill 10,10\n');
    const ok = scene('ok', 'color red\nfill 10,10   # lint: ok\n');
    const r = tsx('app/scripts/lint-pic.ts', f, leak, first, ok);
    expect(r.stdout).toMatch(/fills\.pic:4: fill painted nothing/);
    expect(r.stdout).toMatch(/leak\.pic:6: fill flooded \d+% of the picture/);
    expect(r.stdout).not.toMatch(/leak\.pic:3:/); // the small sky fill is fine
    expect(r.stdout).toMatch(/first\.pic:2: fill flooded 100% of the picture/);
    expect(r.stdout).not.toMatch(/ok\.pic:2:/);
    expect(r.status).toBe(0);
    expect(tsx('app/scripts/lint-pic.ts', '--strict', f).status).toBe(1);
  });

  it('notes never-painted canvas but not deliberately painted white', () => {
    const r = tsx('app/scripts/lint-pic.ts', scene('gap', 'sky 20\nground 30\ncolor white\nrect 10,40 20,50'));
    expect(r.stdout).toMatch(/1440 px of canvas were never painted \(in 0,21-159,29\)/);
  });

  it('flags variants that render identically, and errors in any variant', () => {
    const same = scene('same', 'variants a, b\nsky 20');
    const broken = scene('broken', 'variants a, b\nif variant == "b" { line 1 }');
    const brokenFirst = scene('broken-first', 'variants a, b\nif variant == "a" { line 1 }\nsky 20');
    const r = tsx('app/scripts/lint-pic.ts', same, broken, brokenFirst);
    expect(r.stdout).toMatch(/variants 'a' and 'b' render identically/);
    expect(r.stdout).toMatch(/\[b\] .*broken\.pic:2:\d+: line needs x,y pairs/);
    expect(r.stdout).toMatch(/\[a\] .*broken-first\.pic:2:\d+: line needs x,y pairs/);
    expect(r.stdout).toMatch(/1440 px of canvas were never painted|never painted/); // variant b still linted
    expect(r.status).toBe(1);
  });

  it('every scene in the repo and every skill example lints without errors or warnings', () => {
    const examples = readdirSync('skills/old-adventure-game-draw/examples').map((f) => `skills/old-adventure-game-draw/examples/${f}`);
    const r = tsx('app/scripts/lint-pic.ts', '--strict', ...examples);
    expect(r.stdout).toMatch(/0 error\(s\), 0 warning\(s\)/);
    const all = tsx('app/scripts/lint-pic.ts', '--strict');
    const count = (dir: string): number =>
      readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(join(dir, e.name)) : e.name.endsWith('.pic') ? 1 : 0), 0);
    expect(all.stdout).toContain(`${count('scenes')} scene(s): 0 error(s), 0 warning(s)`);
    expect(all.stdout).toContain(`${count('scenes/kq1')} generated scenes in scenes/kq1/ (compile check only)`);
  });
});

describe('objects: lint and export', () => {
  const ROOM = 'color darkgrey\nrect 0, 0, 159, 167\nobject "table" {\ncolor brown\nrect 40, 80, 120, 90\nobject "leg" { rect 44, 91, 46, 120 }\n}\nobject "vase" {\ncolor blue\nrect 78, 70, 82, 85\n}\ncolor red\nrect 0, 160, 159, 167\n';

  it('lints objects that later drawing depends on, that uncover bare canvas, or that paint nothing', () => {
    const ok = scene('obj-ok', ROOM);
    const depends = scene('obj-depends', 'color green\nrect 0, 0, 159, 167\ncolor white\nrect 0, 0, 159, 100\nobject "wall" {\ncolor black\nline 0, 50, 159, 50\n}\ncolor blue\nfill 10, 10\ncolor yellow\nrect 0, 50, 159, 50');
    // the sun is on the sky; nothing was painted behind the moon; the ghost paints nothing
    const bare = scene('obj-bare', 'color blue\nrect 0, 0, 159, 50\nobject "sun" { color yellow\nrect 30, 10, 40, 20 }\nobject "moon" { color white\nrect 10, 60, 20, 70 }\nobject "ghost" { color red }\ncolor green\nrect 0, 71, 159, 167');
    const r = tsx('app/scripts/lint-pic.ts', ok, depends, bare);
    expect(r.stdout).toMatch(/✔ .*obj-ok\.pic/);
    expect(r.stdout).toMatch(/later drawing depends on object 'wall' \(line 5\): without it, 8160 px paint differently \(in 0,50-159,100\)/);
    expect(r.stdout).toMatch(/hiding object 'moon' \(line 5\) can uncover 121 px of bare canvas \(in 10,60-20,70\)/);
    expect(r.stdout).not.toMatch(/'sun'/);
    expect(r.stdout).not.toMatch(/depends on object '(sun|moon)'/);
    expect(r.stdout).toMatch(/object 'ghost' \(line 7\) paints nothing/);
    expect(r.stdout).toMatch(/3 scene\(s\): 0 error\(s\), 3 warning\(s\)/);
  });

  it('sees through other objects: a dependence they cover, a fill bordered by two, objects stacked on bare canvas', () => {
    // the fill stops at the wall; the rug, drawn later, covers where it would spill
    const covered = scene('obj-covered', 'color green\nrect 0, 101, 159, 167\nobject "wall" { color black\nline 0, 50, 159, 50 }\ncolor blue\nfill 10, 10\nobject "rug" { color red\nrect 0, 51, 159, 100 }');
    // either fence alone keeps the fill out of the field (the white line behind them doesn't)
    const both = scene('obj-both', 'color green\nrect 0, 101, 159, 167\ncolor white\nline 0, 50, 159, 50\nobject "fence" { color black\nline 0, 50, 159, 50 }\nobject "hedge" { color brown\nline 0, 50, 159, 50 }\ncolor blue\nfill 10, 10\ncolor yellow\nrect 0, 51, 159, 100');
    // two boxes on the same bare patch: the lower one never shows, but hiding both uncovers the canvas
    const stacked = scene('obj-stacked', 'color blue\nrect 0, 30, 159, 167\nobject "under" { color red\nrect 10, 10, 20, 20 }\nobject "over" { color yellow\nrect 10, 10, 20, 20 }');
    // the same, with the fill in an object of its own
    const owned = scene('obj-owned', 'color green\nrect 0, 101, 159, 167\ncolor white\nline 0, 50, 159, 50\nobject "fence" { color black\nline 0, 50, 159, 50 }\nobject "hedge" { color brown\nline 0, 50, 159, 50 }\nobject "sky" { color blue\nfill 10, 10 }\ncolor yellow\nrect 0, 51, 159, 100');
    const r = tsx('app/scripts/lint-pic.ts', covered, both, stacked, owned);
    expect(r.stdout).toMatch(/later drawing depends on the objects together: with every object hidden but 'sky' \(and what it's in\), 8160 px paint differently/);
    expect(r.stdout).toMatch(/later drawing depends on object 'wall' \(line 3\): without it, 8160 px paint differently/);
    expect(r.stdout).not.toMatch(/depends on object '(fence|hedge)'/);
    expect(r.stdout).toMatch(/later drawing depends on the objects together: with every object hidden, 8160 px paint differently/);
    expect(r.stdout).not.toMatch(/(fence|hedge).*bare canvas/);
    expect(r.stdout).toMatch(/hiding object 'under' \(line 3\) can uncover 121 px of bare canvas/);
    expect(r.stdout).toMatch(/hiding object 'over' \(line 5\) can uncover 121 px of bare canvas/);
  });

  it('exports the full picture, the base plate, sprites, layers and a manifest that composes exactly', () => {
    const f = scene('room', ROOM);
    const out = join(tmp, 'objects');
    const r = tsx('app/scripts/objects.ts', f, '--out', out);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/room\/ {2}"room" \[default\] {2}3 object\(s\), 5 layer\(s\)/);
    expect(r.stdout).toContain('table/leg  44,91-46,120  90 px');
    const dir = join(out, 'room');
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    expect(manifest).toMatchObject({ width: 160, height: 168, pixelAspect: 2, canvas: '#ffffff' });
    expect(manifest.objects).toEqual([
      { id: 'table', parent: null, line: 3, box: [40, 80, 120, 120], pixels: 81 * 11 - 5 * 6 + 90, sprite: 'sprites/table.png' },
      { id: 'leg', parent: 'table', line: 6, box: [44, 91, 46, 120], pixels: 90, sprite: 'sprites/leg.png' },
      { id: 'vase', parent: null, line: 8, box: [78, 70, 82, 85], pixels: 80, sprite: 'sprites/vase.png' },
    ]);
    expect(manifest.layers.map((l: { object: string | null }) => l.object)).toEqual([null, 'table', 'leg', 'vase', null]);
    const sprite = readPng(join(dir, 'sprites/vase.png'));
    expect([sprite.width, sprite.height]).toEqual([5, 16]);
    // compose the layers with the table hidden (and so its leg): the floor shows under the vase-less table
    const rgba = (p: string) => readPng(join(dir, p)).data;
    const canvas = [255, 255, 255, 255];
    const composed = Buffer.alloc(160 * 168 * 4);
    for (let i = 0; i < 160 * 168; i++) composed.set(canvas, i * 4);
    for (const l of manifest.layers) {
      if (l.object === 'table' || l.object === 'leg') continue;
      const d = rgba(l.file);
      for (let i = 0; i < 160 * 168; i++) if (d[i * 4 + 3]) composed.set(d.subarray(i * 4, i * 4 + 4), i * 4);
    }
    const at = (img: Buffer, x: number, y: number) => [...img.subarray((y * 160 + x) * 4, (y * 160 + x) * 4 + 3)];
    expect(at(composed, 60, 85)).toEqual([0x55, 0x55, 0x55]); // floor where the table was
    expect(at(composed, 80, 85)).toEqual([0, 0, 0xaa]); // the vase stays
    expect(at(rgba('base.png'), 80, 85)).toEqual([0x55, 0x55, 0x55]);
    expect(at(rgba('full.png'), 60, 85)).toEqual([0xaa, 0x55, 0]);
  });

  it('refuses two exports into one folder, and clears out variants the scene dropped', () => {
    const out = join(tmp, 'objects3');
    const a = join(tmp, 'a');
    const b = join(tmp, 'b');
    for (const d of [a, b]) mkdirSync(d, { recursive: true });
    writeFileSync(join(a, 'room.pic'), ROOM);
    writeFileSync(join(b, 'room.pic'), ROOM);
    const r = tsx('app/scripts/objects.ts', join(a, 'room.pic'), join(b, 'room.pic'), '--out', out);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/b\/room\.pic \[default\] would overwrite the export of .*a\/room\.pic \[default\]/);
    const f = scene('vary', 'variants day, night\n' + ROOM);
    expect(tsx('app/scripts/objects.ts', f, '--variant', 'all', '--out', out).status).toBe(0);
    expect(readdirSync(out).filter((d) => d.startsWith('vary')).sort()).toEqual(['vary-day', 'vary-night']);
    writeFileSync(f, 'variants day\n' + ROOM);
    const again = tsx('app/scripts/objects.ts', f, '--variant', 'all', '--out', out);
    expect(again.stdout).toMatch(/removed .*vary-night\//);
    expect(readdirSync(out).filter((d) => d.startsWith('vary')).sort()).toEqual(['vary-day']);
    // an export made without --variant, by another spelling of the path, goes too once its variant does
    writeFileSync(f, 'variants dusk, day\n' + ROOM);
    expect(tsx('app/scripts/objects.ts', f, '--out', out).status).toBe(0);
    expect(existsSync(join(out, 'vary'))).toBe(true);
    writeFileSync(f, 'variants day\n' + ROOM);
    tsx('app/scripts/objects.ts', relative(process.cwd(), f), '--variant', 'all', '--out', out);
    expect(readdirSync(out).filter((d) => d.startsWith('vary')).sort()).toEqual(['vary-day']);
  });

  it('fails on a scene without objects, and on bad arguments', () => {
    const r = tsx('app/scripts/objects.ts', scene('plain', 'sky 20'), '--out', join(tmp, 'objects2'));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/has no objects/);
    expect(tsx('app/scripts/objects.ts', '--bogus').status).toBe(2);
    // a file name that can't name a folder (it would be the folder above --out)
    const dots = join(tmp, '...pic');
    writeFileSync(dots, ROOM);
    const bad = tsx('app/scripts/objects.ts', dots, '--out', join(tmp, 'objects4'));
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/'\.\.' can't name an export folder - use --name/);
    expect(tsx('app/scripts/objects.ts').status).toBe(2);
  });
});

describe('review hardening (M5/M6)', () => {
  it('render compiles each requested variant on its own', () => {
    const f = scene('day-broken', 'variants day, night\nif variant == "day" { line 1 }\nsky 20');
    const out = join(tmp, 'vb');
    const night = tsx('app/scripts/render.ts', f, '--variant', 'night', '--out', out);
    expect(night.status).toBe(0);
    const all = tsx('app/scripts/render.ts', f, '--variant', 'all', '--out', out);
    expect(all.status).toBe(1);
    expect(all.stderr).toMatch(/\[day\] .*day-broken\.pic:2:\d+/);
    expect(all.stdout).toContain('day-broken-night.png');
  });

  it('CLIs tolerate a stray `--` (as in `pnpm render -- scene.pic`)', () => {
    expect(tsx('app/scripts/render.ts', '--', 'scenes/kq1/r05-c06.pic', '--out', join(tmp, 'dd')).status).toBe(0);
    expect(tsx('app/scripts/lint-pic.ts', '--', 'scenes/kq1/r05-c06.pic').status).toBe(0);
  });

  it('CLIs reject bad arguments with exit code 2', () => {
    const f = 'scenes/kq1/r05-c06.pic';
    for (const bad of [['--scale'], ['--scale', '0'], ['--scale', '1.5'], ['--steps', '-1'], ['--crop', ',,,'], ['--crop', '5,5,2,2'], ['--bogus'], ['--confusion']]) {
      const r = tsx('app/scripts/render.ts', f, ...bad, '--out', join(tmp, 'bad'));
      expect(r.status, bad.join(' ')).toBe(2);
      expect(r.stderr).toMatch(/^render: /);
    }
    const lint = tsx('app/scripts/lint-pic.ts', '--bogus', f);
    expect(lint.status).toBe(2);
  });

  it('--steps writes one painting-order sheet that honours --scale', () => {
    const out = join(tmp, 'steps');
    const r = tsx('app/scripts/render.ts', 'scenes/kq1/r05-c06.pic', '--steps', '3', '--scale', '1', '--out', out);
    expect(r.stdout).toContain('painting order:');
    const png = readPng(join(out, 'r05-c06-steps.png'));
    expect([png.width, png.height]).toEqual([3 * 320 + 2 * 4, 168]);
  });

  it('lint still sees never-painted canvas after night() remaps white', () => {
    const f = scene('nightgap', 'variants day, night\nsky 20\nground 30\nif variant == "night" { night() }');
    const r = tsx('app/scripts/lint-pic.ts', f);
    expect(r.stdout).toMatch(/\[night\] 1440 px of canvas were never painted/);
  });

  it('regions --lines works for white too', () => {
    const r = tsx('app/scripts/regions.ts', 'kq1/r01-c04', '--lines', 'white');
    expect(r.stdout).toMatch(/white line art in .*: [1-9]\d* polylines/);
  });

  it('render --crop zooms into part of the picture', () => {
    const out = join(tmp, 'crop');
    const r = tsx('app/scripts/render.ts', 'scenes/kq1/r05-c06.pic', '--crop', '10,20,49,39', '--scale', '4', '--out', out);
    expect(r.status).toBe(0);
    const png = readPng(join(out, 'r05-c06.png'));
    expect([png.width, png.height]).toEqual([40 * 8, 20 * 4]);
  });
});

const hasMagick = spawnSync('magick', ['-version']).status === 0;

describe.skipIf(!hasMagick)('grid CLI (source images)', () => {
  const image = (name: string, size: string, extra: string[] = []) => {
    const p = join(tmp, name);
    spawnSync('magick', ['-size', size, 'gradient:red-blue', ...extra, p]);
    return p;
  };

  it('reframes a tall image by cropping to within 15% and squashing the rest, and writes every file', () => {
    const out = join(tmp, 'src1');
    const r = tsx('app/scripts/grid.ts', image('tall.png', '400x400'), '--out', out);
    expect(r.status).toBe(0);
    // 400 / (1.905 × 0.85) ≈ 247 rows kept, centred
    expect(r.stdout).toMatch(/kept 400×247 at 0,76, squashed 15% to fit/);
    expect(readdirSync(join(out, 'tall')).sort()).toEqual(['grid-bl.png', 'grid-br.png', 'grid-tl.png', 'grid-tr.png', 'grid.png', 'picture.png', 'transform.json', 'view.png']);
    const sizes = (f: string) => {
      const png = readPng(join(out, 'tall', f));
      return [png.width, png.height];
    };
    expect(sizes('picture.png')).toEqual([160, 168]);
    expect(sizes('view.png')).toEqual([960, 504]);
    expect(sizes('grid.png')).toEqual([640, 672]);
    expect(sizes('grid-br.png')).toEqual([640, 672]);
  });

  it('keeps an image that is already close to 1.9:1 whole, and honours --anchor, --crop, --tile and --trim', () => {
    const out = join(tmp, 'src2');
    expect(tsx('app/scripts/grid.ts', image('wide.jpg', '1920x1080'), '--out', out).stdout).toMatch(/kept all of it, squashed 7% to fit/);
    expect(tsx('app/scripts/grid.ts', image('tall2.png', '400x400'), '--anchor', 'top', '--out', out).stdout).toMatch(/kept 400×247 at 0,0,/);
    expect(tsx('app/scripts/grid.ts', image('tall3.png', '400x400'), '--crop', '0,10,380,200', '--out', out).stdout).toMatch(/kept 380×200 at 0,10/);
    const sheet = image('sheet.png', '640x336');
    const t = tsx('app/scripts/grid.ts', sheet, '--tile', '2x2:2,1', '--out', out);
    expect(t.stdout).toMatch(/tile 2,1 of .*sheet\.png: kept all of it/);
    expect(existsSync(join(out, 'sheet-r01-c02', 'picture.png'))).toBe(true);
    const boxed = image('boxed.png', '320x170', ['-bordercolor', 'black', '-border', '0x15']);
    expect(tsx('app/scripts/grid.ts', boxed, '--trim', '--out', out).stdout).toMatch(/trimmed to 320×170/);
  });

  it('rejects bad arguments with exit code 2', () => {
    const img = image('bad.png', '100x100');
    for (const args of [
      ['nope.png'],
      [img, '--anchor', 'middle'],
      [img, '--tile', '2x2:3,1'],
      [img, '--tile', '1000x1:1,1'],
      [img, '--crop', '0,0,500,10'],
      [img, '--max-squash', '2'],
      [img, '--name', '..'],
      [img, img],
    ]) {
      expect(tsx('app/scripts/grid.ts', ...args).status, args.join(' ')).toBe(2);
    }
  });

  // what colour is the middle of a written picture.png?
  const middle = (dir: string) => {
    const png = readPng(join(dir, 'picture.png'));
    const o = (84 * 160 + 80) * 4;
    return [png.data[o], png.data[o + 1], png.data[o + 2]];
  };
  const solid = (name: string, layout: string[][]) => {
    // a sheet of 320×168 solid-colour tiles, rows of colours
    const p = join(tmp, name);
    const args: string[] = [];
    for (const row of layout) args.push('(', ...row.flatMap((c) => ['-size', '320x168', `xc:${c}`]), '+append', ')');
    spawnSync('magick', [...args, '-append', p]);
    return p;
  };

  it('--tile really takes that tile', () => {
    const out = join(tmp, 'src3');
    const sheet = solid('quad.png', [['red', 'blue'], ['lime', 'yellow']]);
    tsx('app/scripts/grid.ts', sheet, '--tile', '2x2:2,1', '--name', 'q21', '--out', out);
    expect(middle(join(out, 'q21'))).toEqual([0, 0, 255]);
    tsx('app/scripts/grid.ts', sheet, '--tile', '2x2:1,2', '--name', 'q12', '--out', out);
    expect(middle(join(out, 'q12'))).toEqual([0, 255, 0]);
  });

  it('applies EXIF rotation before measuring, and flattens transparency onto white', () => {
    const out = join(tmp, 'src4');
    // stored 400×200 (red left, blue right) but tagged "rotate 90° clockwise": shown 200×400, red on top
    const rotated = join(tmp, 'rotated.jpg');
    spawnSync('magick', ['-size', '200x200', 'xc:red', '-size', '200x200', 'xc:blue', '+append', rotated]);
    // ImageMagick only keeps -orient in an existing EXIF block, so add a minimal one by hand:
    // APP1 "Exif", big-endian TIFF header, one IFD entry: Orientation (0x0112) SHORT = 6
    const tiff = Buffer.from([0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0, 0, 0]);
    const body = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]);
    const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff]), body]);
    const jpg = readFileSync(rotated);
    writeFileSync(rotated, Buffer.concat([jpg.subarray(0, 2), app1, jpg.subarray(2)]));
    expect(spawnSync('magick', ['identify', '-format', '%[orientation]', rotated], { encoding: 'utf8' }).stdout).toBe('RightTop');
    const r = tsx('app/scripts/grid.ts', rotated, '--anchor', 'top', '--out', out);
    expect(r.stdout).toMatch(/\(200×400\): kept 200×123 at 0,0/);
    const [red, green, blue] = middle(join(out, 'rotated'));
    expect(red).toBeGreaterThan(200);
    expect(green + blue).toBeLessThan(80);
    const clear = join(tmp, 'clear.png');
    spawnSync('magick', ['-size', '320x168', 'xc:none', clear]);
    tsx('app/scripts/grid.ts', clear, '--out', out);
    expect(middle(join(out, 'clear'))).toEqual([255, 255, 255]);
  });

  it('brightens the viewing images (not picture.png) of a very dark source', () => {
    const out = join(tmp, 'src6');
    const dark = join(tmp, 'dark.png');
    spawnSync('magick', ['-size', '320x168', 'xc:rgb(30,30,30)', dark]);
    const r = tsx('app/scripts/grid.ts', dark, '--out', out);
    expect(r.stdout).toMatch(/very dark .* brightened \(gamma 2\)/);
    const mean = (f: string) => readPng(join(out, 'dark', f)).data[0];
    expect(mean('picture.png')).toBeLessThan(40);
    expect(mean('view.png')).toBeGreaterThan(70);
    const off = tsx('app/scripts/grid.ts', dark, '--brighten', '1', '--name', 'dark-off', '--out', out);
    expect(off.stdout).not.toMatch(/very dark/);
    expect(readPng(join(out, 'dark-off', 'view.png')).data[0]).toBeLessThan(40);
    expect(tsx('app/scripts/grid.ts', dark, '--brighten', '9').status).toBe(2);
    // a number after --brighten that names an existing file is the image, not a gamma
    const numbered = join(tmp, '2');
    spawnSync('magick', ['-size', '320x168', 'xc:rgb(30,30,30)', `png:${numbered}`]);
    const n = spawnSync(resolve('node_modules/.bin/tsx'), [resolve('app/scripts/grid.ts'), '--brighten', '2', '--out', out], { cwd: tmp, encoding: 'utf8' });
    expect(n.status).toBe(0);
    expect(n.stdout).toMatch(/^2 \(320×168\)/);
  });

  it('notes a solid strip along the bottom edge (it may not be part of the picture)', () => {
    const out = join(tmp, 'src7');
    const barred = join(tmp, 'barred.png');
    spawnSync('magick', ['-size', '320x163', 'plasma:', '-size', '320x5', 'xc:lime', '-append', barred]);
    expect(tsx('app/scripts/grid.ts', barred, '--out', out).stdout).toMatch(/the bottom \d+ rows are one flat colour/);
    const topped = join(tmp, 'topped.png');
    spawnSync('magick', ['-size', '320x5', 'xc:black', '-size', '320x163', 'plasma:', '-append', topped]);
    expect(tsx('app/scripts/grid.ts', topped, '--out', out).stdout).toMatch(/the top \d+ rows are one flat colour/);
    const clean = join(tmp, 'plasma.png');
    spawnSync('magick', ['-size', '320x168', 'plasma:', clean]);
    expect(tsx('app/scripts/grid.ts', clean, '--out', out).stdout).not.toMatch(/flat colour/);
  });

  it('never squashes more than the limit, even when rounding a tiny image', () => {
    const r = tsx('app/scripts/grid.ts', image('tiny.png', '11x20'), '--out', join(tmp, 'src5'));
    expect(r.status).toBe(0);
    const pct = Number(/squashed (\d+)%/.exec(r.stdout)?.[1] ?? 0);
    expect(pct).toBeLessThanOrEqual(15);
    // 3×10 can't get within 15% of 1.9:1 at any whole-pixel crop
    const t = tsx('app/scripts/grid.ts', image('tinier.png', '3x10'), '--out', join(tmp, 'src5'));
    expect(t.status).toBe(2);
    expect(t.stderr).toMatch(/too small to reframe within 15% squash/);
  });
});

describe('render --beside', () => {
  it('puts a 160×168 source picture to the left of the render', () => {
    const src = join(tmp, 'beside-src.png');
    writeFileSync(src, readFileSync('reference/kq1/r01-c01.png'));
    const out = join(tmp, 'beside');
    const r = tsx('app/scripts/render.ts', 'scenes/kq1/r01-c01.pic', '--beside', src, '--scale', '1', '--out', out);
    expect(r.status).toBe(0);
    const png = readPng(join(out, 'r01-c01.png'));
    expect([png.width, png.height]).toEqual([320 * 2 + 4, 168]);
    const c = tsx('app/scripts/render.ts', 'scenes/kq1/r01-c01.pic', '--beside', src, '--compare', '--scale', '1', '--out', out);
    expect(readPng(join(out, 'r01-c01.png')).width).toBe(320 * 4 + 4 * 3);
    expect(c.stdout).toContain('match 100.00%');
  });

  it('flattens a transparent --beside picture onto white', () => {
    const clear = join(tmp, 'clear160.png');
    spawnSync('magick', ['-size', '160x168', 'xc:none', clear]);
    const out = join(tmp, 'beside2');
    expect(tsx('app/scripts/render.ts', 'scenes/kq1/r01-c01.pic', '--beside', clear, '--scale', '1', '--out', out).status).toBe(0);
    const png = readPng(join(out, 'r01-c01.png'));
    expect([...png.data.subarray(0, 3)]).toEqual([255, 255, 255]);
  });

  it('rejects a missing file or a picture of the wrong size with exit code 2', () => {
    expect(tsx('app/scripts/render.ts', 'scenes/kq1/r01-c01.pic', '--beside', 'nope.png').status).toBe(2);
    const r = tsx('app/scripts/render.ts', 'scenes/kq1/r01-c01.pic', '--beside', 'reference/kq6/r03-c01.png');
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/expected 160×168.*pnpm grid/);
  });
});

describe('render --name, --grid and lenient --crop', () => {
  it('--name sets the output name and only works for one scene', () => {
    const out = join(tmp, 'named');
    expect(tsx('app/scripts/render.ts', 'scenes/kq1/r01-c01.pic', '--name', 'kq1-first', '--out', out).status).toBe(0);
    expect(readdirSync(out)).toEqual(['kq1-first.png']);
    expect(tsx('app/scripts/render.ts', 'scenes/kq1/r01-c01.pic', 'scenes/kq1/r01-c02.pic', '--name', 'x').status).toBe(2);
    // with every variant, steps and a compare
    const out2 = join(tmp, 'named2');
    const f = scene('named-vars', 'variants day, night\nsky 20\nground 21\nif variant == "night" { night() }\nframe');
    expect(tsx('app/scripts/render.ts', f, '--name', 'slug', '--variant', 'all', '--steps', '2', '--out', out2).status).toBe(0);
    expect(readdirSync(out2).sort()).toEqual(['slug-day-steps.png', 'slug-day.png', 'slug-night-steps.png', 'slug-night.png']);
    const c = tsx('app/scripts/render.ts', 'scenes/kq1/r01-c01.pic', '--name', 'cmp', '--compare', '--out', out2);
    expect(c.stdout).toContain('cmp.png');
    expect(c.stdout).toContain('match 100.00%');
    expect(tsx('app/scripts/render.ts', 'scenes/kq1/r01-c01.pic', '--name', '../x').status).toBe(2);
  });

  it('--grid draws magenta lines every 10 pixels', () => {
    const out = join(tmp, 'gridded');
    tsx('app/scripts/render.ts', 'scenes/kq1/r01-c01.pic', '--grid', '--scale', '1', '--out', out);
    const png = readPng(join(out, 'r01-c01.png'));
    const px = (x: number, y: number) => [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3)];
    // the vertical line for picture column 50 is at display x = 100; blended magenta has a lot of red and blue
    const [r, g, b] = px(100, 120);
    expect(r).toBeGreaterThan(140);
    expect(b).toBeGreaterThan(140);
    expect(g).toBeLessThan(120);
  });

  it('--grid labels never overlap in a tight crop', () => {
    const out = join(tmp, 'gridcrop');
    expect(tsx('app/scripts/render.ts', 'scenes/kq1/r01-c01.pic', '--grid', '--crop', '19,19,40,40', '--scale', '1', '--out', out).status).toBe(0);
  });

  it('--crop pulls a far corner past the edge back onto the picture', () => {
    const out = join(tmp, 'cropped');
    expect(tsx('app/scripts/render.ts', 'scenes/kq1/r01-c01.pic', '--crop', '150,160,160,168', '--scale', '1', '--out', out).status).toBe(0);
    const png = readPng(join(out, 'r01-c01.png'));
    expect([png.width, png.height]).toEqual([20, 8]);
    expect(tsx('app/scripts/render.ts', 'scenes/kq1/r01-c01.pic', '--crop', '50,50,40,60').status).toBe(2);
  });
});
