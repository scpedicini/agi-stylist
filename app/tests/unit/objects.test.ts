// Scene objects (engine/objects.ts): hiding an object shows what was painted behind it, composed
// from the full picture's recorded writes, and playback with objects hidden ends on the same picture.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { execute, Painter } from '../../src/engine/execute.ts';
import { maskBox, ObjectModel, paints } from '../../src/engine/objects.ts';
import { Playback } from '../../src/engine/playback.ts';
import { compile, compileProgram, parse } from '../../src/lang/index.ts';

const stdlib = parse(readFileSync('app/src/lang/stdlib.pic', 'utf8'), 'stdlib.pic');
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : f.endsWith('.pic') ? [join(d, f)] : []));
const model = (src: string, variant?: string) => {
  const r = compile(src, { file: 't.pic', prelude: stdlib, variant });
  return ObjectModel.create(r.ops, r.objects)!;
};
const px = (pixels: Uint8Array, x: number, y: number) => pixels[y * 160 + x];
/** The canvas colour overpainted by every layer not hidden. */
const fromLayers = (m: ObjectModel, hidden: string[]) => {
  const objs = m.hiddenObjects(hidden);
  const out = new Uint8Array(160 * 168).fill(m.canvas);
  for (const l of m.layers()) {
    if (l.object >= 0 && objs[l.object]) continue;
    for (let i = 0; i < out.length; i++) if (l.alpha[i]) out[i] = l.pixels[i];
  }
  return out;
};
const played = (m: ObjectModel, hidden: string[]) => {
  const pb = new Playback(m.ops, { hiding: m.hiding(hidden) });
  pb.finish();
  return pb.fb.pixels;
};

// a floor, a table (with a leg inside it), a vase standing on the table, and a rug drawn last
const ROOM = `
color darkgrey
rect 0, 100, 159, 167
object "table" {
  color brown
  rect 40, 80, 120, 90
  object "leg" { rect 44, 91, 46, 120 }
}
object "vase" {
  color blue
  rect 78, 70, 82, 79
  rect 79, 81, 81, 85
}
color red
rect 0, 160, 159, 167
`;

describe('ObjectModel', () => {
  it('composes exactly the scripted picture with nothing hidden, on every scene in the repo', () => {
    for (const f of walk('scenes').sort()) {
      const program = parse(readFileSync(f, 'utf8'), f);
      for (const variant of compileProgram(program, { prelude: stdlib }).variants) {
        const r = compileProgram(program, { prelude: stdlib, variant });
        const m = ObjectModel.create(r.ops, r.objects);
        if (!m) continue;
        const want = execute(r.ops).pixels;
        expect(Buffer.compare(m.compose().pixels, want), `${f} ${variant}`).toBe(0);
        expect(Buffer.compare(fromLayers(m, []), want), `${f} ${variant} layers`).toBe(0);
        for (const o of m.objects) {
          const hidden = m.compose([o.id]).pixels;
          expect(Buffer.compare(fromLayers(m, [o.id]), hidden), `${f} ${variant} layers without ${o.id}`).toBe(0);
          expect(Buffer.compare(played(m, [o.id]), hidden), `${f} ${variant} played without ${o.id}`).toBe(0);
        }
      }
    }
  });

  it('shows what was painted behind a hidden object, and hides what is inside it too', () => {
    const m = model(ROOM);
    const full = m.compose();
    expect(px(full.pixels, 80, 75)).toBe(1); // the vase
    const noVase = m.compose(['vase']);
    expect(px(noVase.pixels, 80, 75)).toBe(15); // bare canvas above the table
    expect(px(noVase.pixels, 80, 85)).toBe(6); // the table top behind the vase's foot
    expect(px(noVase.pixels, 45, 100)).toBe(6); // the leg is untouched
    const noTable = m.compose(['table']);
    expect(px(noTable.pixels, 80, 85)).toBe(1); // the vase stands (it's a sibling)
    expect(px(noTable.pixels, 60, 85)).toBe(15);
    expect(px(noTable.pixels, 45, 100)).toBe(8); // its leg went with it: floor
    expect(px(m.compose(['leg']).pixels, 45, 100)).toBe(8);
    expect(px(m.compose(['leg']).pixels, 60, 85)).toBe(6);
    // everything else is the full picture
    let changed = 0;
    for (let i = 0; i < full.pixels.length; i++) if (full.pixels[i] !== noVase.pixels[i]) changed++;
    expect(changed).toBe(5 * 10 + 3 * 5); // the vase's pixels, and only those
  });

  it('finds the innermost object at a pixel, its visible pixels and its footprint', () => {
    const m = model(ROOM);
    const c = m.compose();
    const at = (x: number, y: number) => m.objects[m.objectAt(c, y * 160 + x)]?.id ?? null;
    expect([at(80, 75), at(60, 85), at(45, 100), at(10, 120), at(10, 10), at(45, 165)]).toEqual(['vase', 'table', 'leg', null, null, null]);
    const table = m.indexOf('table');
    expect(maskBox(m.visible(c, table))).toEqual([40, 80, 120, 120]);
    expect(maskBox(m.visible(c, m.indexOf('vase')))).toEqual([78, 70, 82, 85]);
    // the footprint holds the pixels the vase covers; what's visible doesn't
    const fp = m.footprint(table);
    expect(fp[85 * 160 + 80]).toBe(1);
    expect(m.visible(c, table)[85 * 160 + 80]).toBe(0);
    expect(m.within(m.indexOf('leg'), table)).toBe(true);
    expect(m.within(table, m.indexOf('leg'))).toBe(false);
    expect(maskBox(new Uint8Array(160 * 168))).toBeNull();
    expect([...m.hiddenObjects(['table', 'nope'])]).toEqual([1, 1, 0]);
  });

  it("keeps a later fill to the pixels it filled, even when the object it stopped at is hidden", () => {
    // the wall's outline is an object; the fill inside it stops at it in the full picture
    const m = model('object "wall" {\ncolor black\nline 0, 50, 159, 50\n}\ncolor green\nfill 10, 10');
    const full = m.compose();
    expect(px(full.pixels, 10, 100)).toBe(15); // the fill stayed above the line
    const hidden = m.compose(['wall']);
    expect(px(hidden.pixels, 10, 50)).toBe(15); // the line's pixels: bare canvas
    expect(px(hidden.pixels, 10, 100)).toBe(15); // and the fill didn't spill below
    // (re-running the ops without the wall would flood the whole picture)
    expect(px(execute(m.ops.filter((o) => !(o.obj === 0 && paints(o)))).pixels, 10, 100)).toBe(2);
  });

  it('bakes remaps: a hidden object shows what was behind it in the variant, and bare canvas its remapped white', () => {
    const src = 'variants day, night\ncolor yellow\nrect 0, 0, 159, 80\nobject "moon" { color white\nrect 70, 10, 80, 20 }\nremap night { white: blue, yellow: brown }';
    const m = model(src, 'night');
    expect(px(m.compose().pixels, 75, 15)).toBe(1); // the moon, remapped
    expect(px(m.compose(['moon']).pixels, 75, 15)).toBe(6); // the sky behind it, remapped
    expect(m.canvas).toBe(1);
    expect(px(m.compose().pixels, 10, 120)).toBe(1); // bare canvas, remapped
    expect(Buffer.compare(played(m, ['moon']), m.compose(['moon']).pixels)).toBe(0);
    expect(Buffer.compare(m.compose().pixels, execute(m.ops).pixels)).toBe(0);
  });

  it('plays with objects hidden, delays and all, ending on the composed picture', () => {
    const src = 'delay 2 { color cyan\nrect 0, 0, 159, 167 }\nobject "rock" { delay { color grey\nrect 50, 50, 70, 70 } }\ncolor red\nrect 60, 60, 90, 90';
    const m = model(src);
    const pb = new Playback(m.ops, { hiding: m.hiding(['rock']) });
    pb.finish();
    expect(Buffer.compare(pb.fb.pixels, m.compose(['rock']).pixels)).toBe(0);
    expect(px(pb.fb.pixels, 55, 55)).toBe(3);
    expect(px(pb.fb.pixels, 65, 65)).toBe(4);
    // and with nothing hidden it plays as before
    const plain = new Playback(m.ops, { hiding: m.hiding([]) });
    plain.finish();
    expect(plain.fb.hash()).toBe(execute(m.ops).hash());
  });

  it('agrees with itself for every choice of hidden objects, nested ones included', () => {
    const src = ROOM + 'object "rug" { color yellow\nrect 30, 150, 130, 165\nobject "fringe" { color red\nline 30, 166, 130, 166 } }\nobject "vase" { color lightblue\nplot 80, 72 }';
    const m = model(src);
    const ids = m.objects.map((o) => o.id);
    expect(ids).toEqual(['table', 'leg', 'vase', 'rug', 'fringe']);
    for (let bits = 0; bits < 1 << ids.length; bits++) {
      const hidden = ids.filter((_, i) => bits & (1 << i));
      const c = m.compose(hidden);
      expect(Buffer.compare(fromLayers(m, hidden), c.pixels), hidden.join()).toBe(0);
      expect(Buffer.compare(played(m, hidden), c.pixels), hidden.join()).toBe(0);
      // no pixel is shown by a hidden object
      const objs = m.hiddenObjects(hidden);
      for (let i = 0; i < c.owner.length; i++) {
        const o = m.objectAt(c, i);
        if (o >= 0 && objs[o]) throw new Error(`${hidden.join()}: pixel ${i} shows hidden ${m.objects[o].id}`);
      }
    }
  });

  it('plays a hidden object without painting it, op by op, and seeks back to the same pictures', () => {
    const m = model(ROOM);
    const sup = m.suppressed(['vase']);
    const pb = new Playback(m.ops, { hiding: m.hiding(['vase']) });
    // the reference: script order, baked colours, hidden ops and remaps skipped
    const want = new Uint8Array(160 * 168).fill(m.canvas);
    const { start, pixel } = m.recording;
    for (let k = 0; k < m.ops.length; k++) {
      pb.step();
      if (!sup[k] && m.ops[k].kind !== 'remap') for (let w = start[k]; w < start[k + 1]; w++) want[pixel[w]] = m.baked[w];
      expect(Buffer.compare(pb.fb.pixels, want), `at ${k + 1}`).toBe(0);
    }
    // the vase's own pixels were never painted
    expect(pb.touched[75 * 160 + 80]).toBe(0);
    expect(pb.touched[85 * 160 + 80]).toBe(1);
    const mid = pb.marks[Math.floor(pb.marks.length / 2)];
    pb.seek(mid);
    const there = pb.fb.hash();
    pb.seek(2);
    pb.seek(mid);
    expect(pb.fb.hash()).toBe(there);
  });

  it('plays remaps as they come with objects hidden: op by op it is the script without them', () => {
    // a night variant: the backdrop is painted in day colours and remapped partway through
    const src = 'variants day, night\ncolor yellow\nrect 0, 0, 159, 80\nobject "moon" { color white\nrect 70, 10, 80, 20 }\nobject "hut" { color brown\nrect 20, 90, 40, 120 }\nremap night { white: blue, yellow: brown, brown: red }\nobject "lamp" { color yellow\nrect 30, 100, 32, 102 }\ncolor green\nrect 0, 130, 159, 167';
    const m = model(src, 'night');
    for (const hidden of [['moon'], ['hut'], ['lamp'], ['moon', 'lamp']]) {
      const sup = m.suppressed(hidden);
      const pb = new Playback(m.ops, { hiding: m.hiding(hidden) });
      const painter = new Painter();
      for (let k = 0; k < m.ops.length; k++) {
        pb.step();
        if (!sup[k]) painter.apply(m.ops[k]);
        expect(pb.fb.diffCount(painter.fb), `${hidden} at ${k + 1}`).toBe(0);
      }
      expect(Buffer.compare(pb.fb.pixels, m.compose(hidden).pixels)).toBe(0);
    }
  });

  it('with delays and remaps together, still ends on the composed picture', () => {
    const src = 'variants day, night\ndelay 2 { color yellow\nrect 0, 0, 159, 80 }\nobject "moon" { delay { color white\nrect 70, 10, 80, 20 } }\nobject "hut" { color brown\nrect 20, 90, 40, 120 }\nremap night { white: blue, yellow: brown, brown: red }\ndelay { object "lamp" { color yellow\nrect 30, 100, 32, 102 } }';
    const m = model(src, 'night');
    for (const hidden of [['moon'], ['hut'], ['lamp']]) expect(Buffer.compare(played(m, hidden), m.compose(hidden).pixels), String(hidden)).toBe(0);
  });

  it('bakes several remaps in order', () => {
    // red → blue, then blue → green: what was red ends green, what was blue ends green too
    const m = model('color red\nrect 0, 0, 9, 9\nremap { red: blue }\ncolor blue\nrect 10, 0, 19, 9\nremap { blue: green, white: black }\ncolor red\nrect 20, 0, 29, 9');
    const c = m.compose();
    expect([px(c.pixels, 5, 5), px(c.pixels, 15, 5), px(c.pixels, 25, 5), px(c.pixels, 50, 50)]).toEqual([2, 2, 4, 0]);
    expect(Buffer.compare(c.pixels, execute(m.ops).pixels)).toBe(0);
  });

  it('gives up (null) when the recording would be too big, at exactly the limit', () => {
    const r = compile('color blue\nrect 0, 0, 159, 167', { file: 't.pic' });
    expect(ObjectModel.create(r.ops, r.objects, 100)).toBeNull();
    const three = compile('color blue\nplot 1, 1\nplot 2, 2\nplot 3, 3', { file: 't.pic' });
    expect(ObjectModel.create(three.ops, three.objects, 2)).toBeNull();
    expect(ObjectModel.create(three.ops, three.objects, 3)).not.toBeNull();
  });
});
