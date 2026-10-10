import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { execute } from '../../src/engine/execute.ts';
import { compile, compileProgram, parse } from '../../src/lang/index.ts';
import { stdlib } from '../../scripts/lib/stdlib.ts';

const run = (src: string, variant?: string) => compileProgram(parse(src, 't.pic'), { prelude: stdlib(), variant });

describe('shape builtins', () => {
  it('rect paints every pixel of the box over anything underneath', () => {
    const fb = execute(compile('color red\nfill 0,0\ncolor blue\nrect 10,10 13,12').ops);
    let n = 0;
    for (let y = 0; y < 168; y++) for (let x = 0; x < 160; x++) if (fb.get(x, y) === 1) n++;
    expect(n).toBe(4 * 3);
    expect(fb.get(9, 10)).toBe(4);
  });

  it('polygon fills its interior and outlines its edge', () => {
    const fb = execute(compile('color green\nfill 0,0\ncolor yellow\npolygon 10,10 30,10 20,30').ops);
    expect(fb.get(20, 15)).toBe(14);
    expect(fb.get(10, 10)).toBe(14);
    expect(fb.get(20, 30)).toBe(14);
    expect(fb.get(11, 25)).toBe(2);
  });

  it('polygon handles concave shapes', () => {
    const fb = execute(compile('color blue\npolygon 0,0 40,0 40,40 30,40 30,10 10,10 10,40 0,40').ops);
    expect(fb.get(5, 30)).toBe(1);
    expect(fb.get(35, 30)).toBe(1);
    expect(fb.get(20, 30)).toBe(15);
  });

  it('ellipse is symmetric and bounded', () => {
    const fb = execute(compile('color red\nellipse 80, 80, 10, 20').ops);
    expect(fb.get(80, 60)).toBe(4);
    expect(fb.get(80, 100)).toBe(4);
    expect(fb.get(70, 80)).toBe(4);
    expect(fb.get(90, 80)).toBe(4);
    expect(fb.get(72, 62)).toBe(15);
  });

  it('noise is stateless and deterministic', () => {
    const a = compile('log noise(3, 4), noise(3, 4), noise(3, 5)').logs[0];
    const [x, y, z] = a.split(': ')[1].split(' ').map(Number);
    expect(x).toBe(y);
    expect(x).not.toBe(z);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThan(1);
  });
});

describe('stdlib', () => {
  const calls = [
    'frame()', 'sky()', 'hills()', 'treeline()', 'ground()', 'ridge(30)', 'tree(80, 120)', 'fruit(80, 60, 10, 10)',
    'pine(40, 120)', 'bush(60, 140)', 'reeds(20, 150)', 'flowers(10, 140, 40, 160)', 'stump(100, 150)', 'rock(120, 150)',
    'pond(80, 120)', 'river([[0, 80], [159, 90]])', 'path([[80, 167], [80, 100]])', 'cave_mouth(80, 100)',
    'fence(10, 150, 60, 150)', 'stonewall(10, 120, 60, 110)', 'cloud(40, 8)', 'moon(140, 8)', 'moon(140, 8, phase: 0.5)',
    'stars()', 'night()', 'dusk()', 'outline(blob(80, 80, 10, 10))', 'squiggle(50, 50, 20)',
  ];
  it.each(calls)('%s runs without errors or warnings', (call) => {
    const r = run(call);
    expect(r.warnings).toEqual([]);
    expect(r.ops.length).toBeGreaterThan(0);
  });

  it('objects are repeatable by seed and vary across seeds', () => {
    const a = run('tree(80, 120, seed: 3)').ops;
    expect(run('tree(80, 120, seed: 3)').ops).toEqual(a);
    expect(run('tree(80, 120, seed: 4)').ops).not.toEqual(a);
  });

  it('stdlib functions do not disturb the global random stream', () => {
    const value = (logs: string[]) => logs[0].split(': ')[1];
    const plain = value(run('log random(0, 1000)').logs);
    expect(value(run('tree(80, 120)\nrock(10, 150)\nlog random(0, 1000)').logs)).toBe(plain);
  });

  it('the stdlib tour scene renders both variants', () => {
    const src = readFileSync('scenes/examples/stdlib-tour.pic', 'utf8');
    for (const v of ['day', 'night']) {
      const fb = execute(compileProgram(parse(src, 'tour.pic'), { prelude: stdlib(), variant: v }).ops);
      expect(fb.get(80, 1)).toBe(v === 'day' ? 1 : 0); // sky
      expect(fb.get(0, 0)).toBe(0); // frame
    }
  });
});

describe('review hardening (M5)', () => {
  it('shapes far off the picture are clipped cheaply and draw nothing stray', () => {
    const r = compile('color red\npolygon -1000000000,0 (-1000000000 + 10),0 -1000000000,50\nrect 0,-1000000000000 10,1000000000000\nellipse 80, 80, 5, 1000000000000');
    const fb = execute(r.ops);
    expect(fb.get(0, 25)).toBe(4); // the rect column
    expect(fb.get(80, 0)).toBe(4); // the ellipse column
    expect(fb.get(0, 160)).toBe(4);
    expect(r.ops.length).toBeLessThan(500);
    // a polygon entirely left of the canvas paints nothing (no stray edge on x = 0)
    const off = execute(compile('color red\npolygon -40,10 -10,10 -20,40').ops);
    expect(off.pixels.every((c) => c === 15)).toBe(true);
  });

  it('a polygon partly off-canvas is clipped consistently, without warnings', () => {
    const r = compile('color blue\npolygon -20,10 40,10 40,40 -20,40');
    expect(r.warnings).toEqual([]);
    const fb = execute(r.ops);
    expect(fb.get(0, 20)).toBe(1);
    expect(fb.get(40, 20)).toBe(1);
    expect(fb.get(41, 20)).toBe(15);
  });

  it('horizon() paints a gap-free backdrop', () => {
    const r = run('horizon(30)');
    const fb = execute(r.ops);
    expect(fb.pixels.includes(15)).toBe(false);
  });

  it('fruit stays inside its ellipse and night() dims trunks and fruit', () => {
    const fb = execute(run('color white\nrect 0,0 159,167\nfruit(80, 80, 10, 20, 30, red)').ops);
    for (let y = 0; y < 168; y++) {
      for (let x = 0; x < 160; x++) {
        if (fb.get(x, y) !== 4) continue;
        expect(((x - 80) / 12) ** 2 + ((y - 80) / 23) ** 2).toBeLessThanOrEqual(1);
      }
    }
    const night = execute(run('color red\nrect 0,0 9,9\ncolor brown\nrect 10,0 19,9\nnight()').ops);
    expect(night.get(0, 0)).toBe(5);
    expect(night.get(10, 0)).toBe(0);
  });
});

describe('arc and shift', () => {
  const val = (expr: string) => {
    const r = run(`print ${expr}`);
    return r.logs[0].replace(/^t\.pic:\d+: /, '');
  };

  it('arc walks an ellipse with 0° at the top, clockwise, and includes both ends', () => {
    expect(val('arc(80, 80, 10, 20, 0, 180, 90)')).toBe('[[80, 60], [90, 80], [80, 100]]');
    expect(val('len(arc(0, 0, 5, 5))')).toBe('37');
    expect(val('arc(80, 80, 10, 10, 90, 0, 90)')).toBe('[[90, 80], [80, 70]]');
  });

  it('an error inside a stdlib function names the scene line that called it', () => {
    expect(() => run('color red\nfn ring() {\n  stroke arc(80, 80, 10, 10, 0, 90, -5)\n}\nring()')).toThrow(/stdlib\.pic:\d+:\d+: arc: step must be more than 0 degrees \(called from t\.pic:3\)$/);
    // a scene callback that returned normally doesn't take the blame for a later library error
    const prelude = 'fn each(f) {\n  f()\n  error "after the callback"\n}';
    const src = 'fn cb() {\n  color red\n}\neach(cb)';
    expect(() => compileProgram(parse(src, 't.pic'), { prelude })).toThrow(/after the callback \(called from t\.pic:4\)$/);
  });

  it('arc rejects a step that is not positive', () => {
    expect(() => run('let a = arc(80, 80, 10, 10, 0, 90, 0)')).toThrow(/arc: step must be more than 0/);
    expect(() => run('let a = arc(80, 80, 10, 10, 0, 90, -10)')).toThrow(/arc: step must be more than 0/);
  });

  it('shift moves a copy of the points and leaves the original alone', () => {
    expect(val('shift([[1, 2], [3, 4]], 10, -1)')).toBe('[[11, 1], [13, 3]]');
    expect(run('let a = [[1, 2]]\nlet b = shift(a, 1, 1)\nprint a').logs[0]).toMatch(/: \[\[1, 2\]\]$/);
  });

  it('shape outlines running off the picture no longer warn', () => {
    expect(run('shape(blob(155, 5, 20, 20, 3), green)').warnings).toEqual([]);
    expect(run('pine(4, 100, 1.0, seed: 1)').warnings).toEqual([]);
  });
});

describe('helpers added after the first image-translation wave', () => {
  const val = (expr: string) => run(`print ${expr}`).logs[0].replace(/^t\.pic:\d+: /, '');
  const clean = (src: string) => {
    const r = run(src);
    expect(r.warnings).toEqual([]);
    return execute(r.ops);
  };

  it('interp reads a polyline at a column and holds the ends', () => {
    expect(val('interp([[0, 10], [10, 20], [20, 0]], 5)')).toBe('15');
    expect(val('interp([[0, 10], [10, 20], [20, 0]], 15)')).toBe('10');
    expect(val('interp([[0, 10], [10, 20]], -5)')).toBe('10');
    expect(val('interp([[0, 10], [10, 20]], 99)')).toBe('20');
  });

  it('band runs out along the right-hand side and back along the left, allowing for 2:1 pixels', () => {
    // heading right: the right-hand side is below; 4 rows thick
    expect(val('band([[10, 50], [30, 50]], 4)')).toBe('[[10, 52], [30, 52], [30, 48], [10, 48]]');
    // heading down: 4 rows thick looks like 2 columns either way
    expect(val('band([[10, 50], [10, 70]], 4)')).toBe('[[9, 50], [9, 70], [11, 70], [11, 50]]');
    expect(val('len(band([[0, 0], [5, 5], [10, 0]], 6, 2))')).toBe('6');
    expect(() => run('let b = band([[1, 1]], 3)')).toThrow(/band: needs at least 2 points/);
  });

  it('archway stands on its bottom row and peaks at its top row', () => {
    const pts = JSON.parse(val('archway(40, 20, 10, 12, 60)'));
    expect(pts[0]).toEqual([30, 60]);
    expect(pts.at(-1)).toEqual([50, 60]);
    expect(Math.min(...pts.map((p: number[]) => p[1]))).toBe(20);
  });

  it('blobs merges masses: no black inside, black around', () => {
    const fb = clean('color yellow\nrect 0, 0, 159, 167\nblobs([[70, 80, 12, 10], [86, 80, 12, 10]], green)');
    for (let x = 64; x <= 92; x++) expect(fb.get(x, 80), `x=${x}`).toBe(2);
    let black = 0;
    for (let x = 40; x < 120; x++) if (fb.get(x, 80) === 0) black++;
    expect(black).toBeGreaterThanOrEqual(2);
  });

  it('shape with no fill colour draws only the edge', () => {
    const fb = clean('shape([[10, 10], [40, 10], [40, 40], [10, 40]], null, black)');
    expect(fb.get(10, 20)).toBe(0);
    expect(fb.get(25, 25)).toBe(15);
  });

  it('zero-sized plants draw nothing, and archway makes horseshoe arches', () => {
    for (const call of ['palm(80, 150, 0)', 'palm(80, 150, 1)', 'fern(80, 150, 0, 0)', 'frond(80, 80, 0)']) {
      expect(run(call).ops.filter((o) => o.kind !== 'color'), call).toEqual([]);
    }
    const horseshoe = JSON.parse(val('archway(40, 20, 10, 12, 60, 240)'));
    // the feet stand inside the widest part of the arch
    const xs = horseshoe.map((p: number[]) => p[0]);
    expect(horseshoe[0][0]).toBeGreaterThan(Math.min(...xs));
    expect(horseshoe.at(-1)[0]).toBeLessThan(Math.max(...xs));
    expect(horseshoe[0][1]).toBe(60);
  });

  it('palm, fern, frond, column, stones and books draw cleanly, even running off the picture', () => {
    for (const call of [
      'palm(80, 150)',
      'palm(156, 120, 50, 10)',
      'fern(4, 166, 30, 20)',
      'frond(80, 80, 30, 90)',
      'column(70, 80, 40, 140)',
      'color lightgrey\nrect 10, 10, 60, 60\nstones(10, 10, 60, 60)',
      'books(10, 60, 100)',
    ]) {
      const fb = clean(call);
      expect(fb.pixels.some((p) => p !== 15), call).toBe(true);
    }
  });
});

describe('helpers added after the second image-translation wave', () => {
  const val = (expr: string) => run(`print ${expr}`).logs[0].replace(/^t\.pic:\d+: /, '');
  const clean = (src: string) => {
    const r = run(src);
    expect(r.warnings).toEqual([]);
    return execute(r.ops);
  };

  it('scale insets or enlarges about the average point; slice takes part of a list', () => {
    expect(val('scale([[0, 0], [20, 0], [20, 10], [0, 10]], 0.5)')).toBe('[[5, 2.5], [15, 2.5], [15, 7.5], [5, 7.5]]');
    expect(val('slice([1, 2, 3, 4, 5], 1, 3)')).toBe('[2, 3]');
    expect(val('slice([1, 2, 3, 4, 5], -2)')).toBe('[4, 5]');
    expect(val('slice([1, 2, 3], 2, 99)')).toBe('[3]');
    expect(val('slice([1, 2, 3], 2, 1)')).toBe('[]');
    expect(val('slice([1, 2, 3], 5)')).toBe('[]');
    expect(val('slice([1, 2, 3], -9, -1)')).toBe('[1, 2]');
    expect(val('scale([], 2)')).toBe('[]');
  });

  it('surround paints only outside the hole, with an edge round it', () => {
    const fb = clean('color red\nrect 0, 0, 159, 167\nsurround([[60, 60], [100, 60], [100, 100], [60, 100]], brown)');
    expect(fb.get(80, 80)).toBe(4); // inside the hole: untouched
    expect(fb.get(10, 10)).toBe(6);
    expect(fb.get(150, 160)).toBe(6);
    expect(fb.get(10, 80)).toBe(6); // left of the hole, on the row of the cut
    expect(fb.get(60, 80)).toBe(0); // the edge
  });

  it('boulder shades the part below and right of its diagonal', () => {
    const fb = clean('boulder([[40, 60], [80, 60], [80, 100], [40, 100]])');
    expect(fb.get(45, 65)).toBe(7);
    expect(fb.get(75, 95)).toBe(8);
    expect(fb.get(40, 80)).toBe(0);
  });

  it('palm takes a trunk width and frond a leaf width', () => {
    const thin = clean('palm(80, 160, 50, 0)');
    const thick = clean('palm(80, 160, 50, 0, w: 14)');
    const trunk = (fb: typeof thin) => [...Array(20).keys()].filter((i) => fb.get(70 + i, 150) === 6).length;
    expect(trunk(thick)).toBeGreaterThan(trunk(thin));
    const broad = clean('frond(20, 80, 60, 90, 10)');
    const needle = clean('frond(20, 80, 60, 90, 10, width: 0.07)');
    const ink = (fb: typeof thin) => fb.pixels.filter((p) => p !== 15).length;
    expect(ink(needle)).toBeLessThan(ink(broad));
  });
});

describe('helpers added after the third image-translation wave', () => {
  const clean = (src: string) => {
    const r = run(src);
    expect(r.warnings).toEqual([]);
    return execute(r.ops);
  };

  it('palm(crown:) sets the frond length; the default is unchanged', () => {
    expect(run('palm(80, 150, 60)').ops).toEqual(run('palm(80, 150, 60, crown: null)').ops);
    const ink = (fb: ReturnType<typeof clean>) => fb.pixels.filter((p) => p === 2).length;
    expect(ink(clean('palm(80, 150, 60, crown: 12)'))).toBeLessThan(ink(clean('palm(80, 150, 60)')));
  });

  it('web needs a spoke; zero rings draws spokes only', () => {
    expect(() => run('web(80, 84, 30, 30, 0)')).toThrow(/web: needs at least 1 spoke/);
    expect(run('color blue\nweb(80, 84, 30, 30, 8, 0)').ops.filter((o) => o.kind === 'line').length).toBe(8);
  });

  it('the narrow-column switch is at 7 columns', () => {
    const lit = (x1: number, x2: number) => {
      const fb = clean(`column(${x1}, ${x2}, 40, 140)`);
      return [...Array(x2 - x1 + 1).keys()].map((i) => fb.get(x1 + i, 90));
    };
    expect(lit(70, 76)).toContain(15); // 7 columns: highlight line drawn
    expect(lit(70, 75)).not.toContain(15); // 6 columns: no highlight
  });

  it('a narrow column keeps its main colour', () => {
    const fb = clean('column(70, 75, 40, 140)');
    const row = [...Array(6).keys()].map((i) => fb.get(70 + i, 90));
    expect(row.filter((c) => c === 7).length).toBeGreaterThanOrEqual(3);
  });

  it('web draws spokes and sagging rings, clipped at the edge', () => {
    const dark = clean('color blue\nrect 0, 0, 159, 167\nweb(80, 84, 40, 50)\nweb(150, 10, 40, 50)');
    expect(dark.get(80, 50)).toBe(15); // the spoke straight up
    expect(dark.pixels.filter((p) => p === 15).length).toBeGreaterThan(300);
  });
});

describe('helpers added after the fourth image-translation wave', () => {
  const val = (expr: string) => run(`print ${expr}`).logs[0].replace(/^t\.pic:\d+: /, '');
  const clean = (src: string) => {
    const r = run(src);
    expect(r.warnings).toEqual([]);
    return execute(r.ops);
  };

  it('offset moves a path sideways like band does (positive = right-hand side)', () => {
    expect(val('offset([[10, 50], [30, 50]], 2)')).toBe('[[10, 52], [30, 52]]');
    expect(val('offset([[10, 50], [10, 70]], 4)')).toBe('[[8, 50], [8, 70]]');
    expect(val('offset([[1, 1]], 4)')).toBe('[[1, 1]]');
    // repeated points keep their place in the list and move with their neighbours
    expect(val('offset([[0, 0], [0, 0], [10, 0]], 2)')).toBe('[[0, 2], [0, 2], [10, 2]]');
    expect(val('offset([[0, 0], [10, 0], [10, 0]], 2)')).toBe('[[0, 2], [10, 2], [10, 2]]');
    expect(val('offset([[3, 3], [3, 3]], 2)')).toBe('[[3, 3], [3, 3]]');
    expect(run('let a = [[1, 1]]\nlet b = offset(a, 2)\npush(b, [9, 9])\nprint len(a)').logs[0]).toMatch(/: 1$/);
  });

  it('along gives evenly spaced points (in screen rows) with the direction there', () => {
    // a horizontal path 20 columns long is 40 rows on screen: points every 10 rows = 5 columns
    expect(val('along([[0, 50], [20, 50]], 10)')).toBe('[[0, 50, 1, 0, 0], [5, 50, 1, 0, 0.25], [10, 50, 1, 0, 0.5], [15, 50, 1, 0, 0.75], [20, 50, 1, 0, 1]]');
    expect(val('len(along([[0, 0], [0, 10], [0, 25]], 5))')).toBe('6');
    expect(() => run('let p = along([[0, 0], [1, 1]], 0)')).toThrow(/along: step must be more than 0/);
    expect(val('along([], 5)')).toBe('[]');
    expect(val('along([[4, 4]], 5)')).toBe('[]');
    expect(val('len(along([[0, 0], [0, 0], [0, 10]], 5))')).toBe('3');
  });

  it('leaf and trunk draw cleanly, trunks running off the top', () => {
    const fb = clean('leaf(80, 100, 30, 45)\ntrunk(40, 56, 150)\ntrunk(150, 158, 120)');
    expect(fb.pixels.some((p) => p === 2)).toBe(true);
    expect(fb.get(48, 0)).not.toBe(15);
    expect(clean('leaf(80, 100, 1)').pixels.every((p) => p === 15)).toBe(true);
    // a narrow trunk keeps its marks inside it; one off the right edge paints nothing
    const thin = clean('trunk(10, 12, 60, 0)');
    for (let x = 14; x < 160; x++) for (let y = 0; y < 168; y++) expect(thin.get(x, y)).toBe(15);
    expect(clean('trunk(170, 180, 60)').pixels.every((p) => p === 15)).toBe(true);
    expect(() => run('trunk(20, 20, 60)')).toThrow(/trunk: x2 must be right of x1/);
  });
});

describe('helpers added after the fifth image-translation wave', () => {
  const val = (expr: string) => run(`print ${expr}`).logs[0].replace(/^t\.pic:\d+: /, '');
  const clean = (src: string) => {
    const r = run(src);
    expect(r.warnings).toEqual([]);
    return execute(r.ops);
  };

  it('reverse copies a list backwards', () => {
    expect(val('reverse([1, 2, 3])')).toBe('[3, 2, 1]');
    expect(val('reverse([])')).toBe('[]');
  });

  it('lancet stands on its bottom row, peaks at (cx, top) and is symmetric', () => {
    const pts: number[][] = JSON.parse(val('lancet(80, 20, 10, 100)'));
    expect(pts[0]).toEqual([70, 100]);
    expect(pts.at(-1)).toEqual([90, 100]);
    const apex = pts.reduce((a, b) => (b[1] < a[1] ? b : a));
    expect(apex[1]).toBeCloseTo(20, 5);
    expect(apex[0]).toBeCloseTo(80, 5);
  });

  it('ribbed draws a body, ribs inside it and a rim, cleanly even off the picture', () => {
    const fb = clean('color blue\nrect 0, 0, 159, 167\nribbed([[10, 150], [80, 90], [170, 40]], 20, 8, darkgrey, black, cyan)');
    expect(fb.pixels.filter((p) => p === 8).length).toBeGreaterThan(200);
    expect(fb.pixels.filter((p) => p === 3).length).toBeGreaterThan(20);
  });

  it('column can give its plinth another colour', () => {
    const fb = clean('column(70, 80, 40, 140, lightred, red, white, darkgrey)');
    expect(fb.get(75, 138)).toBe(8);
    expect(fb.get(75, 42)).toBe(12);
  });
});

describe('across, ribbed and chain (wave 5)', () => {
  const val = (expr: string) => run(`print ${expr}`).logs[0].replace(/^t\.pic:\d+: /, '');
  const clean = (src: string) => {
    const r = run(src);
    expect(r.warnings).toEqual([]);
    return execute(r.ops);
  };

  it('across gives screen-correct segments straight across a path', () => {
    // walking right: segments run up and down, `half` rows each way
    expect(val('across([[10, 50], [30, 50]], 20, 3)')).toBe('[[[10, 53], [10, 47]], [[20, 53], [20, 47]], [[30, 53], [30, 47]]]');
    // walking down: half 4 rows looks like 2 columns each way
    expect(val('across([[10, 50], [10, 70]], 20, 4)')).toBe('[[[8, 50], [12, 50]], [[8, 70], [12, 70]]]');
    // half as a function of the distance along
    const r = run('fn tw(t) { return 2 + t * 4 }\nprint across([[10, 50], [30, 50]], 40, tw)');
    expect(r.logs[0]).toMatch(/\[\[\[10, 52\], \[10, 48\]\], \[\[30, 56\], \[30, 44\]\]\]$/);
  });

  it('ribbed keeps its ribs inside the tube and draws cleanly off the picture', () => {
    const fb = clean('color blue\nrect 0, 0, 159, 167\nribbed([[10, 150], [80, 90], [175, 40]], 20, 8, darkgrey, black, cyan)');
    expect(fb.pixels.filter((p) => p === 8).length).toBeGreaterThan(200);
    expect(fb.pixels.filter((p) => p === 3).length).toBeGreaterThan(20);
  });

  it('ribbed keeps its ribs inside the body even on unevenly spaced points', () => {
    // body darkgrey on a blue backdrop: every black rib pixel must sit inside the band region,
    // i.e. never with blue directly above and below it in a horizontal tube
    const fb = clean('color blue\nrect 0, 0, 159, 167\nribbed([[10, 50], [11, 50], [100, 50]], 20, 2, darkgrey, black, null, 12, null)');
    for (let x = 0; x < 160; x++) {
      for (let y = 1; y < 167; y++) {
        if (fb.get(x, y) === 0) expect(fb.get(x, y - 1) === 1 && fb.get(x, y + 1) === 1, `${x},${y}`).toBe(false);
      }
    }
  });

  it('chain bars are the same length on screen in any direction', () => {
    const bar = (path: string) => {
      const fb = clean(`color blue\nrect 0, 0, 159, 167\nchain(${path}, 9, lightgrey)`);
      return fb.pixels.filter((p) => p === 7).length;
    };
    const h = bar('[[20, 80], [38, 80]]');
    const v = bar('[[80, 20], [80, 38]]');
    expect(Math.abs(h - v) / Math.max(h, v)).toBeLessThan(0.5);
  });

  it('lancet rejects degenerate sizes', () => {
    expect(() => run('let a = lancet(80, 20, 0, 100)')).toThrow(/lancet: needs hw > 0/);
    expect(() => run('let a = lancet(80, 90, 10, 100)')).toThrow(/top \+ rise <= bottom/);
  });

  it('chain alternates rings and bars', () => {
    const fb = clean('color blue\nrect 0, 0, 159, 167\nchain([[20, 20], [20, 120]])');
    expect(fb.pixels.filter((p) => p === 7).length).toBeGreaterThan(20);
    expect(fb.pixels.filter((p) => p === 0).length).toBeGreaterThan(20);
  });
});

describe('helpers added after the sixth image-translation wave', () => {
  const val = (expr: string) => run(`print ${expr}`).logs[0].replace(/^t\.pic:\d+: /, '');
  const clean = (src: string) => {
    const r = run(src);
    expect(r.warnings).toEqual([]);
    return execute(r.ops);
  };

  it('spanx gives an outline\'s column range on a row', () => {
    expect(val('spanx([[10, 10], [50, 10], [30, 50]], 30)')).toBe('[20, 40]');
    expect(val('spanx([[10, 10], [50, 10], [30, 50]], 10)')).toBe('[10, 50]');
    expect(val('spanx([[10, 10], [50, 10], [30, 50]], 60)')).toBe('null');
  });

  it('stones(clip:) keeps the joints inside the outline', () => {
    const fb = clean('color lightgrey\nrect 0, 0, 159, 167\nstones(0, 0, 159, 167, 6, 8, darkgrey, [[40, 40], [120, 40], [80, 120]])');
    for (let y = 0; y < 168; y++) {
      for (let x = 0; x < 160; x++) {
        if (fb.get(x, y) !== 8) continue;
        const inside = y >= 40 && y <= 120 && Math.abs(x - 80) <= 40 * (1 - (y - 40) / 80) + 1;
        expect(inside, `${x},${y}`).toBe(true);
      }
    }
    expect(fb.pixels.filter((p) => p === 8).length).toBeGreaterThan(100);
  });

  it('surround(box:) paints only inside the box, outside the hole', () => {
    const fb = clean('color red\nrect 0, 0, 159, 167\nsurround([[60, 60], [100, 60], [100, 100], [60, 100]], yellow, null, [40, 40, 120, 120])');
    expect(fb.get(50, 50)).toBe(14);
    expect(fb.get(80, 80)).toBe(4);
    expect(fb.get(10, 10)).toBe(4);
    expect(fb.get(130, 130)).toBe(4);
  });

  it('room and depth lay out a box room', () => {
    expect(val('room(50, 40, 110, 110)[4]')).toBe('[[50, 110], [110, 110], [159, 167], [0, 167]]');
    expect(val('depth(50, 40, 110, 110, 0)')).toBe('[50, 40, 110, 110]');
    expect(val('depth(50, 40, 110, 110, 1)')).toBe('[0, 0, 159, 167]');
  });
});

describe('review fixes (wave 6)', () => {
  const clean = (src: string) => {
    const r = run(src);
    expect(r.warnings).toEqual([]);
    return execute(r.ops);
  };

  it('surround with a box rejects a hole that leaves the box', () => {
    expect(() => run('surround([[30, 60], [100, 60], [100, 100]], yellow, null, [40, 40, 120, 120])')).toThrow(/hole must lie inside it/);
  });

  it('clipped stone joints skip the pinched rows of an outline', () => {
    // an hourglass: wide at the top and bottom, only columns 76-84 wide in the middle
    const glass = '[[40, 20], [120, 20], [84, 60], [120, 100], [40, 100], [76, 60]]';
    const fb = clean(`color lightgrey\nrect 0, 0, 159, 167\nstones(0, 0, 159, 167, 40, 40, darkgrey, ${glass})`);
    // the joint at x = 60 (course rows 41-79) must not cross the narrow waist around row 60
    expect(fb.get(60, 60)).toBe(7);
  });
});

describe('bird, baretree and horizon colours (layout-sketch pilot)', () => {
  const draw = (src: string) => {
    const r = run(src);
    expect(r.warnings).toEqual([]);
    return execute(r.ops);
  };
  const bounds = (fb: ReturnType<typeof execute>, c: number) => {
    let [x0, y0, x1, y1] = [160, 168, -1, -1];
    for (let y = 0; y < 168; y++) {
      for (let x = 0; x < 160; x++) {
        if (fb.get(x, y) !== c) continue;
        [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
      }
    }
    return [x0, y0, x1, y1];
  };

  it('bird is centred on (x, y), mirrors with facing, and becomes a far "m" when small', () => {
    const right = bounds(draw('bird(80, 80)'), 0);
    const left = bounds(draw('bird(80, 80, -1)'), 0);
    // about 16 columns × 12 rows, around the centre
    expect(right[2] - right[0]).toBeGreaterThanOrEqual(12);
    expect(right[3] - right[1]).toBeGreaterThanOrEqual(8);
    expect(right[0]).toBeLessThan(80);
    expect(right[2]).toBeGreaterThan(80);
    // mirrored: the left-facing one is the right-facing one reflected about x = 80
    expect(80 - left[2]).toBeCloseTo(right[0] - 80, -0.5);
    // the beak is on the facing side
    const beak = bounds(draw('bird(80, 80)'), 14);
    expect(beak[0]).toBeGreaterThan(84);
    expect(bounds(draw('bird(80, 80, -1)'), 14)[2]).toBeLessThan(76);
    const far = bounds(draw('bird(80, 80, 1, 0.4)'), 0);
    expect(far[2] - far[0]).toBeLessThanOrEqual(8);
    expect(bounds(draw('bird(80, 80, 1, 0.4)'), 14)[0]).toBe(160); // no beak on a far bird
  });

  it('baretree stands on (x, y), is centred on x, and draws no leaves', () => {
    const fb = draw('baretree(80, 150)');
    const wood = bounds(fb, 6);
    expect(wood[3]).toBeLessThanOrEqual(150);
    expect(wood[3]).toBeGreaterThanOrEqual(147);
    expect(150 - wood[1]).toBeGreaterThan(40); // tall
    expect(Math.abs((wood[0] + wood[2]) / 2 - 80)).toBeLessThan(8); // balanced over its base
    for (const c of [2, 10]) expect(bounds(fb, c)[0]).toBe(160); // no green
    // different seeds differ, the same seed repeats
    expect(draw('baretree(80, 150, 1, 2)').hash()).not.toBe(fb.hash());
    expect(draw('baretree(80, 150)').hash()).toBe(fb.hash());
  });

  it('horizon takes a sky colour (the hills keep it behind them)', () => {
    expect(draw('horizon(60)').hash()).toBe(draw('horizon(60, 3, lightgreen, blue, lightblue)').hash());
    const fb = draw('horizon(60, 3, lightgreen, lightcyan, lightblue)');
    expect(fb.get(80, 5)).toBe(11);
  });
});

describe('road, pixmap, shift and bird edge (development wave)', () => {
  const draw = (src: string) => {
    const r = run(src);
    expect(r.warnings).toEqual([]);
    return execute(r.ops);
  };
  const val = (expr: string) => run(`print ${expr}`).logs[0].replace(/^t\.pic:\d+: /, '');

  it('road widens from far to near with a purely sideways offset', () => {
    // two equal-length legs on screen: the half-width is halfway at the middle point
    const pts: number[][] = JSON.parse(val('road([[80, 40], [50, 100], [80, 160]], 2, 20)'));
    // left side going down, then right side coming back up
    expect(pts).toEqual([[78, 40], [39, 100], [60, 160], [100, 160], [61, 100], [82, 40]]);
    // a stretch that doubles back up the screen still widens with distance travelled
    const back: number[][] = JSON.parse(val('road([[80, 40], [80, 100], [80, 70]], 0, 9)'));
    expect(back.slice(0, 3).map((p) => p[0])).toEqual([80, 74, 71]);
    expect(() => run('road([[1, 1]], 1, 2)')).toThrow(/at least 2 points/);
  });

  it('pixmap paints the keyed characters and leaves the rest', () => {
    const fb = draw('color blue\nrect 0, 0, 20, 20\npixmap(5, 6, ["ab.", ".a "], "ab", [red, yellow])');
    expect([fb.get(5, 6), fb.get(6, 6), fb.get(7, 6), fb.get(5, 7), fb.get(6, 7), fb.get(7, 7)]).toEqual([4, 14, 1, 1, 4, 1]);
  });

  it('pixmap checks its keys and colours up front', () => {
    expect(() => run('pixmap(0, 0, ["ab"], "ab", [red])')).toThrow(/one colour per key character \(2 keys, 1 colours\)/);
    expect(() => run('pixmap(0, 0, ["a"], "aa", [red, blue])')).toThrow(/listed twice/);
  });

  it('shift keeps fields after x and y', () => {
    expect(val('shift([[1, 2, 7, 8], [3, 4]], 10, 20)')).toBe('[[11, 22, 7, 8], [13, 24]]');
  });

  it('bird takes an edge colour (null for none)', () => {
    const black = (src: string) => {
      const fb = draw(`color blue\nrect 0, 0, 159, 167\n${src}`);
      let n = 0;
      for (let y = 0; y < 168; y++) for (let x = 0; x < 160; x++) if (fb.get(x, y) === 0) n++;
      return n;
    };
    expect(black('bird(80, 80, 1, 1, 1, white)')).toBeGreaterThan(10);
    expect(black('bird(80, 80, 1, 1, 1, white, yellow, null)')).toBe(0);
  });
});

describe('the stage: groundscale, trail, inside and forest (hybrid sketches)', () => {
  const val = (expr: string) => run(`print ${expr}`).logs[0].replace(/^t\.pic:\d+: /, '');
  const pts = (expr: string): number[][] => JSON.parse(val(expr));

  it('groundscale is 1 on the bottom row, falls to the horizon, and never goes under 0.05', () => {
    expect(Number(val('groundscale(167, 40)'))).toBe(1);
    expect(Number(val('groundscale(103.5, 40)'))).toBeCloseTo(0.5, 6);
    expect(Number(val('groundscale(20, 40)'))).toBe(0.05);
    expect(() => run('groundscale(100, 167)')).toThrow(/horizon must be above the bottom row/);
  });

  it('trail keeps its ground width: half as wide halfway to the horizon', () => {
    // horizon 40, flat 0.45 (f = 282.2): half-width 12 on the bottom row, 6 at y 103.5
    const p = pts('trail([[80, 167], [80, 103.5]], 12)');
    expect(p.map((q) => q.map((v) => +v.toFixed(3)))).toEqual([[68, 167], [74, 103.5], [86, 103.5], [92, 167]]);
  });

  it('trail turns a far sideways stretch into a thin, flat strip', () => {
    const p = pts('trail([[60, 103.5], [100, 103.5]], 12)');
    const ys = p.map((q) => q[1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(5.41, 1);
    // road() would make it 12 + 12 columns tall instead: the old trouble
  });

  it('trail survives a hairpin, repeated points and off-screen ends, and stays finite near the horizon', () => {
    for (const src of ['trail([[40, 160], [100, 120], [40, 100], [100, 90]], 10)', 'trail([[80, 170], [80, 170], [80, 120]], 8)', 'trail([[80, 167], [80, 40.5]], 8)']) {
      const p = pts(src);
      expect(p.every((q) => Number.isFinite(q[0]) && Number.isFinite(q[1]))).toBe(true);
    }
    // the hairpin's mitres are limited to twice the half-width
    const h = pts('trail([[40, 160], [100, 120], [40, 100]], 10)');
    expect(Math.max(...h.map((q) => q[0])) - 100).toBeLessThan(25);
  });

  it('trail bevels a sharp turn: a simple outline, the inside of the turn at the centre line', () => {
    const p = pts('trail([[40, 160], [100, 120], [50, 118]], 10)');
    // 3 points on the inside, 4 round the outside (a bevel at the turn)
    expect(p.length).toBe(7);
    // no two edges cross
    const cross = (a: number[], b: number[], c: number[], d: number[]) => {
      const o = (p: number[], q: number[], r: number[]) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
      return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
    };
    for (let i = 0; i < p.length; i++) for (let j = i + 2; j < p.length; j++) {
      if (i === 0 && j === p.length - 1) continue;
      expect(cross(p[i], p[(i + 1) % p.length], p[j], p[(j + 1) % p.length])).toBe(false);
    }
    // and it fills: pixels along both arms are painted
    const fb = execute(run('color white\nrect 0, 0, 159, 167\nshape(trail([[40, 160], [100, 120], [50, 118]], 10), brown)').ops);
    for (const [x, y] of [[55, 150], [85, 130], [70, 118]]) expect(fb.get(x, y)).toBe(6);
  });

  it('trail refuses a path that doubles straight back on itself', () => {
    expect(() => run('trail([[80, 160], [80, 100], [80, 140]], 8)')).toThrow(/doubles straight back on itself at point 1/);
  });

  it('trail reports its errors', () => {
    expect(() => run('trail([[80, 160]], 8)')).toThrow(/at least 2 distinct points/);
    expect(() => run('trail([[80, 160], [80, 160]], 8)')).toThrow(/at least 2 distinct points/);
    expect(() => run('trail([[80, 160], [80, 30]], 8)')).toThrow(/at or above the horizon/);
    expect(() => run('trail([[80, 160], [80, 100]], 8, 40, 0)')).toThrow(/flat must be more than 0/);
    expect(() => run('trail([[80, 160], [80, 100]], -1)')).toThrow(/must not be negative/);
  });

  it('fenceline stands posts along its line, shorter and closer together further away', () => {
    const fb = execute(run('color white\nrect 0, 0, 159, 167\nfenceline([[0, 160], [159, 60]], 16, 30)').ops);
    // brown post columns: their heights, from left (near) to right (far)
    const heights: number[] = [];
    for (let x = 0; x < 160; x++) {
      let n = 0;
      for (let y = 0; y < 168; y++) if (fb.get(x, y) === 6) n++;
      heights.push(n);
    }
    const near = Math.max(...heights.slice(0, 30));
    const far = Math.max(...heights.slice(130));
    expect(near).toBeGreaterThan(far);
    expect(() => run('fenceline([[0, 160]])')).toThrow(/at least 2 points/);
    expect(() => run('fenceline([[0, 160], [100, 20]], 12, 30)')).toThrow(/at or above the horizon/);
  });

  it('poplar is a tall narrow column standing on (x, y)', () => {
    const fb = execute(run('color white\nrect 0, 0, 159, 167\npoplar(80, 150, 100)').ops);
    let [x0, y0, x1, y1] = [160, 168, -1, -1];
    for (let y = 0; y < 168; y++) for (let x = 0; x < 160; x++) if (fb.get(x, y) !== 15) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
    expect(y1).toBe(150);
    expect(y0).toBeLessThanOrEqual(51);
    // on screen (a column is two wide) about a fifth as wide as tall
    expect(((x1 - x0 + 1) * 2) / (y1 - y0 + 1)).toBeLessThan(0.3);
    expect(Math.abs((x0 + x1) / 2 - 80)).toBeLessThan(1);
  });

  it('inside uses the even-odd rule', () => {
    const sq = '[[10, 10], [50, 10], [50, 50], [10, 50]]';
    expect(val(`inside(${sq}, 30, 30)`)).toBe('true');
    expect(val(`inside(${sq}, 60, 30)`)).toBe('false');
    const u = '[[0, 0], [40, 0], [40, 40], [30, 40], [30, 10], [10, 10], [10, 40], [0, 40]]';
    expect(val(`inside(${u}, 20, 30)`)).toBe('false');
    expect(val(`inside(${u}, 5, 30)`)).toBe('true');
  });

  it('forest checks its size and always finishes', () => {
    expect(() => run('forest([[90, 60], [150, 55], [156, 150], [92, 152]], 30, 0)')).toThrow(/size must be more than 0/);
    expect(() => run('forest([[90, 60], [150, 55], [156, 150], [92, 152]], 30, -1)')).toThrow(/size must be more than 0/);
    expect(run('forest([[90, 60], [150, 55], [156, 150], [92, 152]], 30, 0.001)').warnings).toEqual([]);
  });

  it("forest keeps its trees' lumpy crowns inside a convex outline", () => {
    // red leaves on a green outline: no red may land outside the outline
    const o: [number, number][] = [[20, 30], [130, 30], [150, 160], [10, 142]];
    const r = run(`forest(${JSON.stringify(o)}, 10, 1.5, 29, red, green, brown, yellow, black)`);
    const fb = execute(r.ops);
    const inside = (x: number, y: number) => {
      let c = false;
      for (let i = 0, j = o.length - 1; i < o.length; j = i++) {
        if (o[i][1] > y !== o[j][1] > y && x < o[i][0] + ((o[j][0] - o[i][0]) * (y - o[i][1])) / (o[j][1] - o[i][1])) c = !c;
      }
      return c;
    };
    let red = 0;
    let outside = 0;
    for (let y = 0; y < 168; y++) for (let x = 0; x < 160; x++) {
      if (fb.get(x, y) !== 4) continue;
      red++;
      if (!inside(x + 0.5, y + 0.5) && !inside(x - 0.5, y + 0.5) && !inside(x + 1.5, y + 0.5)) outside++;
    }
    expect(red).toBeGreaterThan(100);
    expect(outside).toBe(0);
  });

  it('forest paints nothing outside its outline, over many sizes, seeds and shapes', () => {
    const outlines: [number, number][][] = [[[20, 30], [130, 30], [150, 160], [10, 142]], [[40, 60], [120, 60], [120, 150], [40, 150]], [[10, 40], [76, 40], [78, 120], [82, 120], [84, 40], [150, 40], [150, 160], [10, 160]]];
    const inside = (o: [number, number][], x: number, y: number) => {
      let c = false;
      for (let i = 0, j = o.length - 1; i < o.length; j = i++) {
        if (o[i][1] > y !== o[j][1] > y && x < o[i][0] + ((o[j][0] - o[i][0]) * (y - o[i][1])) / (o[j][1] - o[i][1])) c = !c;
      }
      return c;
    };
    for (const o of outlines) for (const size of [0.5, 0.7, 1, 1.5]) for (const seed of [1, 2, 3, 4, 5]) for (const horizon of [10, 36]) {
      const fb = execute(run(`color white\nrect 0, 0, 159, 167\nforest(${JSON.stringify(o)}, ${horizon}, ${size}, ${seed}, red, green, brown, yellow, black)`).ops);
      for (let y = 0; y < 168; y++) for (let x = 0; x < 160; x++) {
        if (fb.get(x, y) === 15) continue;
        // the outline's own edge sits on its boundary: allow a pixel either way
        const near = [-1, 0, 1].some((dx) => [-1, 0, 1].some((dy) => inside(o, x + 0.5 + dx, y + 0.5 + dy)));
        if (!near) throw new Error(`forest(${JSON.stringify(o)}, ${horizon}, ${size}, ${seed}) painted (${x}, ${y}) outside`);
      }
    }
  });

  it('forest draws its merged far canopy behind every separate tree', () => {
    // the far canopy is painted before the first near tree: no trunk pixel is covered by leaves
    // of the canopy, so every trunk drawn is still visible as brown somewhere
    const fb = execute(run('color white\nrect 0, 0, 159, 167\nforest([[20, 30], [140, 30], [150, 160], [10, 160]], 20, 0.7, 4, red, green, brown, yellow, black)').ops);
    let trunk = 0;
    for (let y = 0; y < 168; y++) for (let x = 0; x < 160; x++) if (fb.get(x, y) === 6) trunk++;
    expect(trunk).toBeGreaterThan(30);
  });

  it('forest keeps its trees out of a narrow notch in a concave outline', () => {
    // a broad stand with a narrow notch cut down into it from the top
    const o: [number, number][] = [[10, 40], [76, 40], [78, 120], [82, 120], [84, 40], [150, 40], [150, 160], [10, 160]];
    const fb = execute(run(`forest(${JSON.stringify(o)}, 10, 1, 3, red, green, brown, yellow, black)`).ops);
    let inNotch = 0;
    for (let y = 42; y < 118; y++) for (let x = 79; x <= 81; x++) if (fb.get(x, y) === 4) inNotch++;
    expect(inNotch).toBe(0);
  });

  it('forest fills its outline, stays inside it, puts small trees at the back, and repeats by seed', () => {
    const outline = '[[90, 60], [150, 55], [156, 150], [92, 152]]';
    const draw = (src: string) => {
      const r = run(`color lightgreen\nrect 0, 0, 159, 167\n${src}`);
      expect(r.warnings).toEqual([]);
      return execute(r.ops);
    };
    const fb = draw(`forest(${outline}, 30)`);
    let outside = 0;
    let trunk = 0;
    for (let y = 0; y < 168; y++) for (let x = 0; x < 160; x++) {
      const c = fb.get(x, y);
      if (c === 6) trunk++;
      const inBox = x >= 89 && x <= 157 && y >= 54 && y <= 153;
      if (!inBox && c !== 10) outside++;
    }
    expect(outside).toBe(0);
    expect(trunk).toBeGreaterThan(20);
    expect(draw(`forest(${outline}, 30)`).hash()).toBe(fb.hash());
    expect(draw(`forest(${outline}, 30, 1, 2)`).hash()).not.toBe(fb.hash());
    // trunks near the bottom are wider than trunks higher up (nearer trees are bigger)
    const runs = (y: number) => {
      const w: number[] = [];
      let n = 0;
      for (let x = 0; x < 160; x++) if (fb.get(x, y) === 6) n++; else if (n) (w.push(n), (n = 0));
      return w;
    };
    const low = Math.max(...[140, 142, 144, 146, 148].flatMap(runs));
    const high = Math.max(...[95, 98, 101, 104, 107].flatMap(runs), 0);
    expect(low).toBeGreaterThan(high);
  });
});
