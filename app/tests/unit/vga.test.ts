// `mode vga`: 320×200 square pixels and a 256-colour palette, opt-in per scene. AGI scenes must not
// change at all (the golden tests pin that); these pin the VGA side.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { execute, screenOf } from '../../src/engine/execute.ts';
import { Framebuffer, VGA_HEIGHT, VGA_WIDTH } from '../../src/engine/framebuffer.ts';
import { EGA_PALETTE, WHITE } from '../../src/engine/palette.ts';
import { BAYER4 } from '../../src/engine/pattern.ts';
import { Playback } from '../../src/engine/playback.ts';
import { compileProgram, declaredMode, parse, PicError } from '../../src/lang/index.ts';
import { readPng } from '../../scripts/lib/png.ts';
import { stdlib } from '../../scripts/lib/stdlib.ts';

const run = (src: string, variant?: string) => compileProgram(parse(src, 't.pic'), { prelude: stdlib(), variant });
const vga = (body: string, variant?: string) => run(`mode vga\n${body}`, variant);
const paint = (body: string) => {
  const r = vga(body);
  return { r, fb: execute(r.ops), pal: screenOf(r.ops).palette };
};
const rgbAt = (fb: Framebuffer, x: number, y: number) => [...fb.palette[fb.get(x, y)]];

describe('mode', () => {
  it('is AGI without a mode statement, and the op list does not change', () => {
    const r = run('color red\nrect 0, 0, 10, 10');
    expect(r.mode).toBe('agi');
    expect(r.ops[0].kind).toBe('color');
    expect(execute(r.ops).width).toBe(160);
  });

  it('mode vga paints a 320×200 picture that starts with a screen op', () => {
    const r = vga('color red\nrect 0, 0, WIDTH - 1, HEIGHT - 1');
    expect(r.mode).toBe('vga');
    expect(r.ops[0]).toMatchObject({ kind: 'screen', width: VGA_WIDTH, height: VGA_HEIGHT });
    const fb = execute(r.ops);
    expect([fb.width, fb.height, fb.screen.aspect]).toEqual([320, 200, 1]);
    expect(fb.get(319, 199)).toBe(4);
  });

  it('sets WIDTH, HEIGHT, ASPECT and MODE for each mode', () => {
    expect(run('print WIDTH, HEIGHT, ASPECT, MODE').logs[0]).toMatch(/160 168 2 agi$/);
    expect(vga('print WIDTH, HEIGHT, ASPECT, MODE').logs[0]).toMatch(/320 200 1 vga$/);
  });

  it('mode is only a statement at the top level; `mode` is still a usable name', () => {
    expect(declaredMode(parse('scene "x"\nmode vga', 't.pic'))).toBe('vga');
    expect(() => run('if true {\n  mode vga\n}')).toThrow(/'mode' is not defined - .*top of the scene/);
    // a prelude's own mode(), called inside a block, still works
    const inBlock = compileProgram(parse('let vga = red\nrepeat 1 { mode vga }', 't.pic'), { prelude: 'fn mode(c) {\n color c\n line 1, 1\n}' });
    expect(inBlock.ops.map((o) => o.kind)).toEqual(['color', 'line']);
    expect(() => run('mode svga')).toThrow(/'mode' is not defined - .*mode vga/);
    expect(() => run('mode vga\nmode agi')).toThrow(/pick one/);
    expect(run('let mode = 3\nprint mode * 2').logs[0]).toMatch(/6$/);
    // a scene with its own `mode` function keeps calling it, even as `mode vga`
    const own = run('let vga = red\nfn mode(c) { color c\n line 1, 1 }\nmode vga');
    expect(own.mode).toBe('agi');
    expect(own.ops.map((o) => o.kind)).toEqual(['color', 'line']);
  });

  it('a prelude with its own `mode` keeps it: `mode vga` calls it, in AGI', () => {
    const r = compileProgram(parse('let vga = red\nmode vga', 't.pic'), { prelude: 'fn mode(c) {\n color c\n line 1, 1\n}' });
    expect(r.mode).toBe('agi');
    expect(r.ops.map((o) => o.kind)).toEqual(['color', 'line']);
  });

    it('keeps hex colours and the VGA builtins out of AGI scenes', () => {
    expect(() => run('color "#ff8800"')).toThrow(/need 'mode vga'/);
    expect(() => run('color rgb(1, 2, 3)')).toThrow(PicError);
  });
});

describe('VGA palette', () => {
  it('starts with the 16 EGA colours, so colour names still work', () => {
    const { fb } = paint('color lightcyan\nrect 0, 0, 3, 3');
    expect(rgbAt(fb, 1, 1)).toEqual([...EGA_PALETTE[11]]);
  });

  it('adds hex and rgb() colours once each, rounded to the 6-bit DAC', () => {
    const r = vga('print rgb(200, 100, 50), rgb(199, 101, 50)\ncolor "#c86432"\nrect 0, 0, 1, 1');
    const [a, b] = r.logs[0].split(': ')[1].split(' ').map(Number);
    expect(a).toBeGreaterThanOrEqual(16);
    expect(b).toBe(a);
    expect(r.ops.find((o) => o.kind === 'color')).toMatchObject({ color: a });
    expect(screenOf(r.ops).palette[a]).toEqual([198, 101, 49]);
  });

  it('gives a painted white its own index, so it is not the fillable canvas', () => {
    const r = vga('print rgb(255, 255, 255), rgb(0, 0, 0)');
    const [w, k] = r.logs[0].split(': ')[1].split(' ').map(Number);
    expect(w).not.toBe(WHITE);
    expect(k).toBe(0);
  });

  it('snaps to the nearest colour with a warning once the 256 entries are used', () => {
    const r = vga('for i in 0..300 { let c = rgb((i % 64) * 4, floor(i / 64) * 40, 7) }\nprint rgb(3, 1, 7)');
    expect(screenOf(r.ops).palette.length).toBe(256);
    expect(r.warnings.some((w) => /palette is full/.test(w.message))).toBe(true);
    expect(Number(r.logs[0].split(': ')[1])).toBeLessThan(256);
  });

  it('mix, shade and ramp blend colours', () => {
    const r = vga('print rgbof(mix(black, white, 0.5)), rgbof(shade("#808080", -1)), len(ramp(black, white, 5)), len(ramp([red, yellow, white], 9))');
    expect(r.logs[0]).toMatch(/\[130, 130, 130\] \[0, 0, 0\] 5 9$/);
  });

  it('ramp takes its count named, but only once', () => {
    expect(vga('print len(ramp(black, white, n: 4)), len(ramp([red, blue], n: 4))').logs[0]).toMatch(/4 4$/);
    expect(() => vga('let r = ramp([red, blue], 3, n: 4)')).toThrow(/not both counts/);
    expect(() => vga('let r = ramp([red, blue])')).toThrow(/ramp takes/);
  });
});

describe('VGA patterns', () => {
  it('dither follows the 4×4 ordered pattern', () => {
    const { fb } = paint('color dither(black, white, 0.5)\nrect 0, 0, 3, 3');
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) expect(fb.get(x, y)).toBe(BAYER4[y][x] < 8 ? WHITE : 0);
  });

  it('linear gradients run from the first colour to the last', () => {
    const { fb } = paint('color linear(0, 0, 0, HEIGHT - 1, [black, "#ff0000"])\nrect 0, 0, WIDTH - 1, HEIGHT - 1');
    expect(rgbAt(fb, 10, 0)).toEqual([0, 0, 0]);
    expect(rgbAt(fb, 10, 199)).toEqual([255, 0, 0]);
    const mid = rgbAt(fb, 10, 100)[0];
    expect(mid).toBeGreaterThan(80);
    expect(mid).toBeLessThan(180);
  });

  it('radial gradients fade out from the centre, and patterns work through shape()', () => {
    const { fb } = paint('shape([[100, 50], [220, 50], [220, 150], [100, 150]], radial(160, 100, 50, [white, black], steps: 0), null)');
    expect(fb.get(160, 100)).toBe(WHITE);
    expect(fb.get(219, 51)).toBe(0);
  });

  it('fills only spread into white canvas, even with a pattern that contains white', () => {
    const { fb } = paint('color red\nrect 50, 0, 50, 199\ncolor dither(white, blue, 0.5)\nfill 10, 10');
    expect(fb.get(50, 60)).toBe(4);
    expect(fb.get(60, 60)).toBe(WHITE);
    expect(new Set(Array.from({ length: 50 }, (_, x) => fb.get(x, 20)))).toEqual(new Set([WHITE, 1]));
  });
});

describe('VGA lighting', () => {
  it('tint recolours the whole picture, or only inside a region', () => {
    const all = paint('color "#808080"\nrect 0, 0, WIDTH - 1, HEIGHT - 1\ntint black, 0.5');
    expect(rgbAt(all.fb, 5, 5)).toEqual([65, 65, 65]);
    const part = paint('color "#808080"\nrect 0, 0, WIDTH - 1, HEIGHT - 1\ntint "#ff0000", 1, [[0, 0], [99, 0], [99, 99], [0, 99]]');
    expect(rgbAt(part.fb, 50, 50)).toEqual([255, 0, 0]);
    expect(rgbAt(part.fb, 150, 150)).toEqual([130, 130, 130]);
  });

  it('tint multiply darkens, glow adds light at the centre and none outside', () => {
    const { fb } = paint('color "#404040"\nrect 0, 0, WIDTH - 1, HEIGHT - 1\nglow 160, 100, 40, 30, "#ffff00", 0.8');
    expect(rgbAt(fb, 160, 100)[0]).toBeGreaterThan(200);
    expect(rgbAt(fb, 160, 100)[2]).toBe(65);
    expect(rgbAt(fb, 10, 10)).toEqual([65, 65, 65]);
    const dark = paint('color "#808080"\nrect 0, 0, 9, 9\ntint "#000080", 1, how: "multiply"');
    expect(rgbAt(dark.fb, 5, 5)).toEqual([0, 0, 65]);
  });

  it('a whole-picture tint changes palette entries, adding no colours, and later colours stay true', () => {
    const r = vga('let navy = rgb(0, 0, 128)\ncolor "#808080"\nrect 0, 0, 99, 99\nprint palette_size()\ntint navy, 1, how: "multiply"\nprint palette_size()\ncolor "#808080"\nrect 200, 0, 299, 99');
    const sizes = r.logs.map((l) => Number(l.split(': ')[1]));
    expect(sizes[1]).toBe(sizes[0]);
    expect(r.ops.some((o) => o.kind === 'palette')).toBe(true);
    const fb = execute(r.ops);
    expect(rgbAt(fb, 50, 50)).toEqual([0, 0, 65]);
    expect(rgbAt(fb, 250, 50)).toEqual([130, 130, 130]);
    expect(fb.get(250, 50)).not.toBe(fb.get(50, 50));
  });

  it('a delayed palette change does not undo a later one in playback', () => {
    const r = vga('color red\nline 0, 0\ndelay { tint black, 1 }\ntint white, 1');
    const want = execute(r.ops);
    const p = new Playback(r.ops);
    p.finish();
    expect([...p.fb.palette[p.fb.get(0, 0)]]).toEqual([...want.palette[want.get(0, 0)]]);
    expect(rgbAt(want, 0, 0)).toEqual([255, 255, 255]);
  });

  it('colour values keep their colour after a palette tint: rgb(), patterns, and the pen in hand', () => {
    const { fb } = paint('color red\nline 0, 0\ntint black, 0.5\nline 1, 0\nlet dark = rgb(85, 0, 0)\ncolor dark\nline 2, 0\ncolor dither("#550000", "#550000")\nline 3, 0\ncolor red\nline 4, 0');
    expect(rgbAt(fb, 0, 0)).toEqual([85, 0, 0]);
    expect(rgbAt(fb, 1, 0)).toEqual([170, 0, 0]);
    expect(rgbAt(fb, 2, 0)).toEqual([85, 0, 0]);
    expect(rgbAt(fb, 3, 0)).toEqual([85, 0, 0]);
    expect(rgbAt(fb, 4, 0)).toEqual([170, 0, 0]);
  });

  it('pixel() and remap work by the colours shown, also after a palette tint', () => {
    const r = vga('color red\nline 0, 0\ntint black, 0.5\nprint rgbof(pixel(0, 0))\nremap { pixel(0, 0): blue }');
    expect(r.logs[0]).toMatch(/\[85, 0, 0\]$/);
    expect(execute(r.ops).get(0, 0)).toBe(1);
    expect(vga('print pixel(5, 5) == white').logs[0]).toMatch(/true$/);
  });

  it('with a full palette, lighting targets and pixel() keep their exact colours', () => {
    const fill = 'for i in 0..240 { let c = rgb(4, (i % 16) * 16, floor(i / 16) * 16) }\n';
    const r = vga(fill + 'color red\nline 0, 0\ntint black, 0.5\nprint palette_size()\ntint red, 0\nprint palette_size()\nprint rgbof(pixel(0, 0))');
    const [a, b] = r.logs.slice(0, 2).map((l) => Number(l.split(': ')[1]));
    expect(b).toBe(a);
    const all = vga(fill + 'for i in 0..256 { color i\n line i, 0 }\ntint white, 0.5\nprint rgb(255, 0, 0)');
    // every slot changed: the closest colour showing now (red, tinted) rather than slot 0
    expect(all.logs[0]).toMatch(/: 4$/);
  });

    it('the tint colour itself takes no palette slot', () => {
    const r = vga('color red\nline 0, 0\nprint palette_size()\ntint "#123456", 1\nprint palette_size()');
    const [a, b] = r.logs.map((l) => Number(l.split(': ')[1]));
    expect(b).toBe(a);
  });

  it('playback shows a palette change only once it has played', () => {
    const r = vga('color "#808080"\nrect 0, 0, 99, 99\ntint black, 1');
    const p = new Playback(r.ops);
    p.seek(r.ops.length - 1);
    expect([...p.fb.palette[p.fb.get(5, 5)]]).toEqual([130, 130, 130]);
    p.finish();
    expect([...p.fb.palette[p.fb.get(5, 5)]]).toEqual([0, 0, 0]);
    p.seek(1);
    expect([...p.fb.palette[p.fb.get(5, 5)]]).toEqual([...EGA_PALETTE[WHITE]]);
  });

  it('lighting of zero strength changes nothing, so the canvas stays fillable', () => {
    const { fb } = paint('tint black, 0, [[0, 0], [319, 0], [319, 199], [0, 199]]\nglow 160, 100, 50, 50, red, 0\ncolor red\nfill 1, 1');
    expect(fb.get(160, 100)).toBe(4);
    expect(fb.get(319, 199)).toBe(4);
  });

  it('a region tint covers the region\'s edge, including the last row', () => {
    const { fb } = paint('color red\nrect 0, 0, 319, 199\ntint blue, 1, [[-1, -1], [320, -1], [320, 200], [-1, 200]]');
    expect(fb.get(100, 198)).toBe(fb.get(100, 199));
    expect(fb.get(319, 199)).toBe(fb.get(0, 0));
  });

  it('remap tables cover all 256 colours', () => {
    const r = vga('color "#123456"\nrect 0, 0, 5, 5\nremap { "#123456": red }');
    const op = r.ops.find((o) => o.kind === 'remap');
    expect(op?.kind === 'remap' && op.map.length).toBe(256);
    expect(execute(r.ops).get(2, 2)).toBe(4);
  });

  it('pixel() reads the picture painted so far', () => {
    expect(vga('color green\nrect 10, 10, 20, 20\nprint pixel(15, 15), pixel(100, 100)').logs[0]).toMatch(/2 15$/);
  });
});

describe('VGA drawing', () => {
  it('pens stamp round, square-pixel discs', () => {
    const { fb } = paint('color black\npen 3\nplot 100, 100');
    expect(fb.get(103, 100)).toBe(0);
    expect(fb.get(100, 103)).toBe(0);
    expect(fb.get(103, 103)).toBe(WHITE);
  });

  it('stdlib helpers fill the VGA picture: room() reaches its corners, frame() its edges', () => {
    const { fb } = paint('let r = room(100, 50, 220, 150)\nfor k in 0..5 { shape(r[k], [red, blue, green, yellow, cyan][k], null) }\nframe()');
    expect(fb.get(319, 100)).toBe(0);
    expect(fb.get(318, 100)).toBe(2);
    expect(fb.get(160, 198)).toBe(3);
    expect(fb.get(160, 100)).toBe(4);
  });

  it('frond() is as long across as it is down', () => {
    const across = paint('frond(100, 100, 30, heading: 90, droop: 0, edge: null)').fb;
    let right = 0;
    for (let x = 100; x < 320; x++) if (across.get(x, 100) !== WHITE) right = x;
    expect(right - 100).toBeGreaterThanOrEqual(28);
  });

    it('band() and friends use square pixels: a horizontal band w rows thick is w rows thick', () => {
    const { fb } = paint('shape(band([[50, 100], [250, 100]], 20), red, null)');
    expect(fb.get(150, 91)).toBe(4);
    expect(fb.get(150, 109)).toBe(4);
    expect(fb.get(150, 112)).toBe(WHITE);
  });

  it('plays back to exactly the executed picture, delays and all', () => {
    const r = vga('delay { color linear(0, 0, 0, 199, [blue, white])\nrect 0, 0, 319, 120 }\ncolor brown\nrect 0, 100, 319, 199\nglow 160, 150, 60, 40, yellow');
    const p = new Playback(r.ops);
    p.finish();
    expect(p.fb.hash()).toBe(execute(r.ops).hash());
    expect([p.fb.width, p.fb.height]).toEqual([320, 200]);
  });
});

describe('render CLI with a VGA scene', () => {
  const tsx = (...args: string[]) => spawnSync('pnpm', ['exec', 'tsx', 'app/scripts/render.ts', ...args], { encoding: 'utf8', timeout: 60_000 });
  const tmp = mkdtempSync(join(tmpdir(), 'kq-vga-'));
  const file = join(tmp, 'v.pic');
  writeFileSync(file, 'mode vga\ncolor linear(0, 0, 0, 199, [blue, white])\nrect 0, 0, 319, 199\nframe()');

  it('writes square pixels at the VGA size, and crops inside it', () => {
    expect(tsx(file, '--out', tmp, '--scale', '2').status).toBe(0);
    const png = readPng(join(tmp, 'v.png'));
    expect([png.width, png.height]).toEqual([640, 400]);
    expect(tsx(file, '--out', join(tmp, 'c'), '--scale', '1', '--crop', '300,180,400,300').status).toBe(0);
    const crop = readPng(join(tmp, 'c', 'v.png'));
    expect([crop.width, crop.height]).toEqual([20, 20]);
  });

  it('lint tells VGA variants apart by the colours they show', () => {
    const f = join(tmp, 'vars.pic');
    writeFileSync(f, 'mode vga\nvariants day, night\ncolor variant == "day" ? "#ff0000" : "#0000ff"\nrect 0, 0, 319, 199');
    const r = spawnSync('pnpm', ['exec', 'tsx', 'app/scripts/lint-pic.ts', '--strict', f], { encoding: 'utf8', timeout: 60_000 });
    expect(r.stdout).not.toMatch(/render identically/);
    expect(r.status).toBe(0);
  });

    it('refuses --compare for a VGA scene', () => {
    const r = tsx(file, '--compare', '--out', tmp);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/--compare only works with AGI scenes/);
  });
});
