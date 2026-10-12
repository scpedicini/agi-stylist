// The viewer's playback (engine/playback.ts): delayed ops play last but stack in script order, and
// +1 steps over whole instructions.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { execute, Painter } from '../../src/engine/execute.ts';
import type { Op } from '../../src/engine/ops.ts';
import { instructionMarks, Playback, playOrder, record } from '../../src/engine/playback.ts';
import { compile, compileProgram, parse } from '../../src/lang/index.ts';

const stdlib = parse(readFileSync('app/src/lang/stdlib.pic', 'utf8'), 'stdlib.pic');
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : f.endsWith('.pic') ? [join(d, f)] : []));
const at = (pb: Playback, x: number, y: number) => pb.fb.pixels[y * 160 + x];
const touched = (pb: Playback, x: number, y: number) => pb.touched[y * 160 + x];
const scene = (src: string) => compile(src, { file: 't.pic', prelude: stdlib }).ops;

/** Every scene in the repo, every variant: [name, ops]. */
const ALL = walk('scenes')
  .sort()
  .flatMap((f) => {
    const program = parse(readFileSync(f, 'utf8'), f);
    return compileProgram(program, { prelude: stdlib }).variants.map((v) => [`${f} ${v}`, compileProgram(program, { prelude: stdlib, variant: v }).ops] as const);
  });

describe('Playback, played op by op', () => {
  // the viewer shows exactly what Painter shows, at every op, painted pixels included
  for (const recorded of [false, true]) {
    it(`matches Painter on every scene in the repo${recorded ? ', from a recording' : ''}`, () => {
      for (const [name, ops] of ALL) {
        if (ops.some((o) => o.delay)) continue;
        const pb = new Playback(ops, { recorded });
        const painter = new Painter();
        painter.touched = new Uint8Array(160 * 168);
        const every = Math.max(1, Math.floor(ops.length / 12));
        for (let i = 0; i < ops.length; i++) {
          painter.apply(ops[i]);
          pb.step();
          if (i % every && i !== ops.length - 1) continue;
          expect(pb.fb.diffCount(painter.fb), `${name} at ${i + 1}`).toBe(0);
          expect(Buffer.compare(pb.touched, painter.touched), `${name} painted pixels at ${i + 1}`).toBe(0);
        }
      }
    });
  }

  it('finishes on exactly the scripted picture, delays or not, and seeks back to the same pictures', () => {
    let delayed = 0;
    for (const [name, ops] of ALL) {
      const pb = new Playback(ops);
      if (ops.some((o) => o.delay)) delayed++;
      pb.finish();
      expect(pb.fb.hash(), name).toBe(execute(ops).hash());
      const mid = pb.marks[Math.floor(pb.marks.length / 2)];
      pb.seek(mid);
      const there = pb.fb.hash();
      pb.seek(3);
      pb.seek(mid);
      expect(pb.fb.hash(), name).toBe(there);
    }
    expect(delayed).toBeGreaterThanOrEqual(11); // the Myst scenes
  });
});

describe('delay', () => {
  it('plays delayed ops last, by level, in script order within a level', () => {
    const ops = scene('delay 2 { line 0, 0 }\ndelay { line 1, 1 }\nline 2, 2\ndelay 2 { line 3, 3 }\nline 4, 4');
    const lines = ops.flatMap((o, i) => (o.kind === 'line' ? [i] : []));
    expect([...playOrder(ops)].filter((i) => lines.includes(i)).map((i) => (ops[i].kind === 'line' ? ops[i].points[0] : -1))).toEqual([2, 4, 1, 0, 3]);
  });

  it('fills in behind: a held-back backdrop only shows where nothing later in the script painted', () => {
    const ops = scene('delay {\n  color lightcyan\n  rect 0, 0, 159, 167\n}\ncolor red\nrect 10, 10, 20, 20');
    const pb = new Playback(ops);
    pb.stepInstruction(); // the red square comes first
    expect([at(pb, 15, 15), touched(pb, 15, 15), touched(pb, 50, 50)]).toEqual([4, 1, 0]);
    pb.finish(); // then the sky, round it
    expect([at(pb, 15, 15), at(pb, 50, 50), touched(pb, 50, 50)]).toEqual([4, 11, 1]);
  });

  it('a held-back op reveals its pixels even where a later op (a remap) decides their colour', () => {
    // in the script: red, then red → blue. Played: the remap first (it paints nothing), then the red
    const ops = scene('delay { color red\nrect 0, 0, 3, 3 }\nremap { red: blue }');
    const pb = new Playback(ops);
    pb.stepInstruction();
    expect(pb.last?.kind).toBe('remap');
    expect([at(pb, 1, 1), touched(pb, 1, 1)]).toEqual([1, 0]);
    pb.finish();
    expect([at(pb, 1, 1), touched(pb, 1, 1)]).toEqual([1, 1]);
    expect(pb.fb.hash()).toBe(execute(ops).hash());
  });

  it("a remap of unpainted canvas recolours it without painting it (the original still shows there)", () => {
    const pb = new Playback(scene('delay { color red\nline 0, 0 }\nremap { white: lightgrey }'), { recorded: true });
    pb.stepInstruction();
    expect([at(pb, 50, 50), touched(pb, 50, 50)]).toEqual([7, 0]);
  });

  it('ignores delays (script order) when the recording would be too big', () => {
    const ops = scene('delay { color red\nrect 0, 0, 159, 167 }\ncolor blue\nline 0, 0');
    expect(record(ops, 1000)).toBeNull();
    expect(record(ops)).not.toBeNull();
  });
});

describe('instructions', () => {
  const marks = (ops: Op[]) => [...instructionMarks(ops, playOrder(ops))];

  it('a whole rect is one step, and a colour change goes with the drawing after it', () => {
    const ops = scene('color lightcyan\nrect 0, 0, 159, 167\ncolor red\nline 0, 0, 5, 5');
    expect(marks(ops)).toEqual([0, 169, 171]);
  });

  it('a stdlib call is one step; each statement in a loop body is one step per iteration', () => {
    expect(marks(scene('tree(80, 150)\nline 0, 0'))).toHaveLength(3);
    const loop = scene('color 1\nfor i in 0..3 {\n  line i, 0\n  line i, 1\n}');
    expect(marks(loop)).toEqual([0, 2, 3, 4, 5, 6, 7]);
  });

  it('a remap is a step of its own; a trailing colour change joins the step before it', () => {
    expect(marks(scene('color 1\nline 0, 0\nremap { 1: 2 }\ncolor 3'))).toEqual([0, 2, 4]);
  });

  it('a turtle path merged into one AGI line across loop iterations is one step', () => {
    const ops = scene('color 1\nrepeat 4 { forward 10 }\nline 0, 0');
    expect(ops.filter((o) => o.kind === 'line')).toHaveLength(2);
    expect(marks(ops)).toEqual([0, 2, 3]);
  });

  it('ops without an instruction number are a step each', () => {
    const ops: Op[] = [{ kind: 'color', color: 1 }, { kind: 'line', points: [0, 0] }, { kind: 'line', points: [1, 1] }];
    expect(marks(ops)).toEqual([0, 2, 3]);
  });

  it('+1 partway through an instruction finishes it, and -1 goes back to its start', () => {
    const pb = new Playback(scene('color 1\nrect 0, 0, 159, 9\ncolor 2\nrect 0, 20, 159, 29'));
    expect([...pb.marks]).toEqual([0, 11, 22]);
    pb.seek(5); // paused mid-rect
    pb.stepInstruction();
    expect(pb.position).toBe(11);
    pb.seek(15);
    pb.backInstruction();
    expect(pb.position).toBe(11);
    pb.backInstruction();
    expect(pb.position).toBe(0);
    pb.backInstruction();
    expect(pb.position).toBe(0);
    pb.finish();
    pb.stepInstruction();
    expect(pb.position).toBe(22);
  });

  it('copes with an empty scene', () => {
    const pb = new Playback([]);
    expect([pb.done, [...pb.marks]]).toEqual([true, [0]]);
    pb.stepInstruction();
    pb.backInstruction();
    expect(pb.position).toBe(0);
  });
});
