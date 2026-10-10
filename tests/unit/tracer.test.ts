import { describe, expect, it } from 'vitest';
import { execute } from '../../src/engine/execute.ts';
import { Framebuffer } from '../../src/engine/framebuffer.ts';
import { compile } from '../../src/lang/index.ts';
import { opsToPicScript, patchOps, traceOps, verifyTrace } from '../../src/trace/tracer.ts';

function synthetic(seed: number): Framebuffer {
  // random overlapping rectangles, lines and specks - awkward shapes with holes and 1px features
  let s = seed;
  const rnd = (n: number) => ((s = (s * 1103515245 + 12345) & 0x7fffffff) % n);
  const fb = new Framebuffer();
  for (let k = 0; k < 40; k++) {
    const c = rnd(16);
    const [x, y, w, h] = [rnd(160), rnd(168), 1 + rnd(50), 1 + rnd(40)];
    for (let yy = y; yy < Math.min(168, y + h); yy++) for (let xx = x; xx < Math.min(160, x + w); xx++) fb.set(xx, yy, c);
  }
  for (let k = 0; k < 300; k++) fb.set(rnd(160), rnd(168), rnd(16));
  return fb;
}

describe('tracer', () => {
  it.each([1, 2, 3, 4, 5])('reproduces synthetic picture %i exactly, through PicScript too', (seed) => {
    const target = synthetic(seed);
    const ops = traceOps(target);
    expect(verifyTrace(target, ops)).toBe(0);
    const src = opsToPicScript(ops, { title: 't' });
    expect(execute(compile(src).ops).diffCount(target)).toBe(0);
  });

  it('emits rline for short hops and patchOps repairs wrong pixels', () => {
    const target = synthetic(9);
    const ops = traceOps(target);
    expect(ops.some((o) => o.kind === 'line' && o.style === 'rel')).toBe(true);
    expect(opsToPicScript(ops, { title: 't' })).toMatch(/^rline \d+,\d+ -?\d+,-?\d+/m);
    expect(patchOps(target, ops)).toEqual(ops);
    const broken = ops.slice(0, Math.floor(ops.length / 2));
    expect(verifyTrace(target, broken)).toBeGreaterThan(0);
    expect(verifyTrace(target, patchOps(target, broken))).toBe(0);
  });

  it('emits nothing for an all-white picture and one fill for a solid one', () => {
    expect(traceOps(new Framebuffer())).toEqual([]);
    const solid = new Framebuffer();
    solid.clear(2);
    const ops = traceOps(solid);
    expect(verifyTrace(solid, ops)).toBe(0);
    expect(ops.filter((o) => o.kind === 'fill')).toHaveLength(1);
  });
});
