// Track B: hand-authored recreations must stay at or above 90% pixel match with their reference.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { execute } from '../../src/engine/execute.ts';
import { compileProgram, parse } from '../../src/lang/index.ts';
import { readPicturePng } from '../../scripts/lib/png.ts';
import { stdlib } from '../../scripts/lib/stdlib.ts';

const files = readdirSync('scenes/handmade').filter((f) => f.endsWith('.pic')).sort();

describe('hand-authored recreations', () => {
  it('there are at least six', () => expect(files.length).toBeGreaterThanOrEqual(6));

  it.each(files)('%s matches its reference ≥ 90% and every variant compiles', (f) => {
    const src = readFileSync(`scenes/handmade/${f}`, 'utf8');
    const ref = /^#\s*@reference\s+(\S+)/m.exec(src)?.[1];
    expect(ref, 'scene needs a "# @reference group/id" header').toBeTruthy();
    const program = parse(src, `scenes/handmade/${f}`);
    const first = compileProgram(program, { prelude: stdlib() });
    expect(first.variants.length).toBeGreaterThanOrEqual(2);
    for (const v of first.variants) expect(() => compileProgram(program, { prelude: stdlib(), variant: v })).not.toThrow();
    const fb = execute(first.ops);
    const target = readPicturePng(`reference/${ref}.png`);
    const match = 1 - fb.diffCount(target) / fb.pixels.length;
    expect(match).toBeGreaterThanOrEqual(0.9);
  });
});
