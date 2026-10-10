import { describe, expect, it } from 'vitest';
import { plotPen } from '../../src/engine/brush.ts';
import { execute, Painter } from '../../src/engine/execute.ts';
import { agiFill } from '../../src/engine/fill.ts';
import { Framebuffer, PIC_HEIGHT, PIC_WIDTH } from '../../src/engine/framebuffer.ts';
import { linePixels } from '../../src/engine/line.ts';

describe('agiLine', () => {
  it('draws inclusive horizontal and vertical lines in either direction', () => {
    expect(linePixels(5, 3, 2, 3)).toEqual([[2, 3], [3, 3], [4, 3], [5, 3]]);
    expect(linePixels(1, 4, 1, 2)).toEqual([[1, 2], [1, 3], [1, 4]]);
  });

  it('draws a perfect diagonal', () => {
    expect(linePixels(0, 0, 3, 3)).toEqual([[0, 0], [1, 1], [2, 2], [3, 3]]);
  });

  it('matches the AGI error-accumulator stepping for shallow and steep lines', () => {
    expect(linePixels(0, 0, 4, 1)).toEqual([[0, 0], [1, 0], [2, 1], [3, 1], [4, 1]]);
    expect(linePixels(0, 0, 1, 4)).toEqual([[0, 0], [0, 1], [1, 2], [1, 3], [1, 4]]);
  });

  it('always hits both endpoints, is 8-connected, and stays in bounds', () => {
    let seed = 7;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
    for (let k = 0; k < 2000; k++) {
      const [x1, y1, x2, y2] = [rnd(160), rnd(168), rnd(160), rnd(168)];
      const px = linePixels(x1, y1, x2, y2);
      const keys = px.map(([x, y]) => `${x},${y}`);
      expect(keys).toContain(`${x1},${y1}`);
      expect(keys).toContain(`${x2},${y2}`);
      for (let i = 1; i < px.length; i++) {
        expect(Math.abs(px[i][0] - px[i - 1][0])).toBeLessThanOrEqual(1);
        expect(Math.abs(px[i][1] - px[i - 1][1])).toBeLessThanOrEqual(1);
      }
      expect(px.length).toBe(Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) + 1);
    }
  });

  it('clips endpoints to the picture', () => {
    const px = linePixels(-5, 0, 200, 0);
    expect(px[0]).toEqual([0, 0]);
    expect(px.at(-1)).toEqual([PIC_WIDTH - 1, 0]);
    expect(linePixels(0, 300, 0, 300)).toEqual([[0, PIC_HEIGHT - 1]]);
  });
});

describe('agiFill', () => {
  it('fills only the 4-connected white area and stops at colour', () => {
    const fb = execute([
      { kind: 'color', color: 1 },
      { kind: 'line', points: [10, 10, 20, 10, 20, 20, 10, 20, 10, 10] },
      { kind: 'fill', points: [15, 15] },
    ]);
    expect(fb.get(15, 15)).toBe(1);
    expect(fb.get(11, 19)).toBe(1);
    expect(fb.get(5, 5)).toBe(15);
    expect(fb.get(25, 15)).toBe(15);
  });

  it('leaks through diagonal gaps (4-connectivity of white means 8-connected walls are not needed)', () => {
    // A diagonal wall still blocks a 4-connected fill.
    const fb = execute([
      { kind: 'color', color: 4 },
      { kind: 'line', points: [0, 5, 5, 0] },
      { kind: 'fill', points: [0, 0] },
    ]);
    expect(fb.get(1, 1)).toBe(4);
    expect(fb.get(6, 6)).toBe(15);
  });

  it('is a no-op on non-white seeds, when filling white, and out of bounds', () => {
    const fb = new Framebuffer();
    expect(agiFill(fb, 3, 3, 15)).toBe(0);
    expect(agiFill(fb, -1, 3, 2)).toBe(0);
    expect(agiFill(fb, 3, 3, 2)).toBe(PIC_WIDTH * PIC_HEIGHT);
    expect(agiFill(fb, 3, 3, 4)).toBe(0);
  });
});

describe('brush', () => {
  const stamp = (size: number, shape: 'circle' | 'rect', splatter = false, texture = 0) => {
    const px: string[] = [];
    plotPen({ size, shape, splatter }, 80, 80, texture, (x, y) => px.push(`${x},${y}`));
    return px;
  };

  it('size 0 is one pixel', () => {
    expect(stamp(0, 'circle')).toEqual(['80,80']);
    expect(stamp(0, 'rect')).toEqual(['80,80']);
  });

  it('rectangles are (size+1) wide and (2·size+1) tall', () => {
    for (let s = 0; s < 8; s++) expect(stamp(s, 'rect')).toHaveLength((s + 1) * (2 * s + 1));
  });

  it('circles are subsets of the rectangle', () => {
    for (let s = 1; s < 8; s++) {
      const rect = new Set(stamp(s, 'rect'));
      const circle = stamp(s, 'circle');
      expect(circle.length).toBeGreaterThan(0);
      expect(circle.length).toBeLessThan(rect.size);
      circle.forEach((p) => expect(rect.has(p)).toBe(true));
    }
  });

  it('splatter is deterministic per texture and sparser than solid', () => {
    const a = stamp(4, 'rect', true, 17);
    expect(stamp(4, 'rect', true, 17)).toEqual(a);
    expect(a.length).toBeLessThan(stamp(4, 'rect').length);
    expect(stamp(4, 'rect', true, 18)).not.toEqual(a);
  });

  it('clamps the stamp origin like AGI (the right edge may overhang one column, which the screen drops)', () => {
    const px: Array<[number, number]> = [];
    plotPen({ size: 7, shape: 'rect', splatter: false }, 0, 0, 0, (x, y) => px.push([x, y]));
    plotPen({ size: 7, shape: 'rect', splatter: false }, 159, 167, 0, (x, y) => px.push([x, y]));
    px.forEach(([x, y]) => {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(PIC_WIDTH);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(PIC_HEIGHT);
    });
    const fb = execute([
      { kind: 'color', color: 1 },
      { kind: 'pen', size: 7, shape: 'rect', splatter: false },
      { kind: 'plot', points: [159, 167] },
    ]);
    expect(fb.pixels.filter((c) => c === 1).length).toBe(7 * 15);
  });
});

describe('Painter', () => {
  it('ignores drawing while colour is disabled, and remaps the picture', () => {
    const p = new Painter();
    p.apply({ kind: 'line', points: [0, 0, 10, 0] });
    expect(p.fb.get(5, 0)).toBe(15);
    p.apply({ kind: 'color', color: 2 });
    p.apply({ kind: 'line', points: [0, 0, 10, 0] });
    p.apply({ kind: 'nocolor' });
    p.apply({ kind: 'line', points: [0, 1, 10, 1] });
    expect(p.fb.get(5, 0)).toBe(2);
    expect(p.fb.get(5, 1)).toBe(15);
    const map = Array.from({ length: 16 }, (_, i) => i);
    map[2] = 0;
    p.apply({ kind: 'remap', map });
    expect(p.fb.get(5, 0)).toBe(0);
  });

  it('single-point line plots one pixel', () => {
    const fb = execute([{ kind: 'color', color: 6 }, { kind: 'line', points: [7, 9] }]);
    expect(fb.get(7, 9)).toBe(6);
    expect(fb.pixels.filter((c) => c === 6)).toHaveLength(1);
  });
});
