// Every auto-traced KQ1 scene must reproduce its reference tile with 0 differing pixels.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { execute } from '../../src/engine/execute.ts';
import { compile } from '../../src/lang/index.ts';
import { readPicturePng } from '../../scripts/lib/png.ts';

const ids = readdirSync('reference/kq1')
  .filter((f) => f.endsWith('.png'))
  .map((f) => f.replace(/\.png$/, ''))
  .sort();

describe('KQ1 traced scenes are pixel-exact', () => {
  it('has a scene for every reference tile and a reference tile for every scene', () => {
    expect(ids.length).toBeGreaterThan(0);
    const scenes = readdirSync('scenes/kq1').filter((f) => f.endsWith('.pic')).map((f) => f.replace(/\.pic$/, '')).sort();
    expect(scenes).toEqual(ids);
  });

  it.each(ids)('%s', (id) => {
    const src = readFileSync(`scenes/kq1/${id}.pic`, 'utf8');
    const { ops, warnings } = compile(src, { file: `scenes/kq1/${id}.pic` });
    expect(warnings).toEqual([]);
    expect(execute(ops).diffCount(readPicturePng(`reference/kq1/${id}.png`))).toBe(0);
  });
});
