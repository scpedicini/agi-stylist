import { describe, expect, it } from 'vitest';
import { execute } from '../../src/engine/execute.ts';
import type { Op } from '../../src/engine/ops.ts';
import { compile, parse, PicError } from '../../src/lang/index.ts';

const ops = (src: string, opts = {}) => compile(src, { file: 't.pic', ...opts }).ops.map(({ src: _s, ...rest }) => rest as Op);
const err = (src: string, opts = {}) => {
  try {
    compile(src, { file: 't.pic', ...opts });
  } catch (e) {
    if (e instanceof PicError) return e.message;
    throw e;
  }
  throw new Error('expected a PicError');
};

describe('lexer/parser', () => {
  it('parses commands with comma and whitespace separated points', () => {
    expect(ops('color blue\nline 0,0  159,0, 159,20')).toEqual([
      { kind: 'color', color: 1 },
      { kind: 'line', points: [0, 0, 159, 0, 159, 20] },
    ]);
  });

  it('treats `a -1` as two arguments but `a - 1` as subtraction', () => {
    expect(ops('let a = 5\ncolor 1\nline a -1, 3, 4')).toEqual([
      { kind: 'color', color: 1 },
      { kind: 'line', points: [5, 0, 3, 4] },
    ]);
    expect(ops('let a = 5\ncolor 1\nline a - 1, 3')).toEqual([
      { kind: 'color', color: 1 },
      { kind: 'line', points: [4, 3] },
    ]);
  });

  it('continues commands after a trailing comma and inside parentheses', () => {
    expect(ops('color 2\nline 0,0,\n  10,10\nline (1 +\n 1),2')).toEqual([
      { kind: 'color', color: 2 },
      { kind: 'line', points: [0, 0, 10, 10] },
      { kind: 'line', points: [2, 2] },
    ]);
  });

  it('supports ; separated statements and one-line blocks', () => {
    expect(ops('fn dot(x, y) { color red; line x,y }\ndot 3, 4\ndot(5, 6)')).toEqual([
      { kind: 'color', color: 4 },
      { kind: 'line', points: [3, 4] },
      { kind: 'color', color: 4 },
      { kind: 'line', points: [5, 6] },
    ]);
  });

  it('ignores # comments', () => {
    expect(ops('# hello\ncolor 3 # trailing\n')).toEqual([{ kind: 'color', color: 3 }]);
  });

  it('reports syntax errors with file:line:col', () => {
    expect(err('color 1\nline 0,0 (')).toMatch(/^t\.pic:2:\d+: expected a value/);
    expect(err('if x {\n color 1\n')).toMatch(/t\.pic:3:\d+: expected '}'/);
    expect(err('let = 4')).toMatch(/t\.pic:1:5: expected a variable name/);
    expect(err('"str"')).toMatch(/t\.pic:1:1: this expression does nothing/);
  });

  it('parses else-if chains across lines', () => {
    const p = parse('if a {\n} else if b {\n}\nelse {\n}');
    expect(p.body).toHaveLength(1);
  });
});

describe('evaluator', () => {
  it('evaluates arithmetic, precedence, comparison and logic', () => {
    expect(ops('color 1\nline 2 + 3 * 4, (2 + 3) * 4, 10 % 3, 7 / 2, -4 + 10, 1 < 2 && 3 > 2 ? 9 : 8')).toEqual([
      { kind: 'color', color: 1 },
      { kind: 'line', points: [14, 20, 1, 4, 6, 9] },
    ]);
  });

  it('supports let, assignment, compound assignment and block scope', () => {
    expect(ops('let x = 1\nx += 4\nx *= 2\nif true { let x = 99 }\ncolor 1\nline x, x')).toEqual([
      { kind: 'color', color: 1 },
      { kind: 'line', points: [10, 10] },
    ]);
    expect(err('y = 3')).toMatch(/'y' is not defined - declare it first with 'let y = …'/);
  });

  it('runs repeat, for ranges (exclusive and inclusive), for-in lists and while', () => {
    const r = ops(`
      color 1
      repeat 2 { line repcount, 0 }
      for i in 0..2 { line i, 1 }
      for i in 3..=4 { line i, 2 }
      for p in [[7, 7], [8, 8]] { line p }
      let n = 0
      while n < 2 { n += 1; line n, 9 }
    `);
    expect(r.slice(1).map((o) => (o as { points: number[] }).points)).toEqual([
      [1, 0], [2, 0], [0, 1], [1, 1], [3, 2], [4, 2], [7, 7], [8, 8], [1, 9], [2, 9],
    ]);
  });

  it('calls functions with defaults, named args, return values and recursion', () => {
    const r = ops(`
      fn fact(n) { if n <= 1 { return 1 } return n * fact(n - 1) }
      fn box(x, y, w = 2, c = blue) { color c; line x,y  x + w,y }
      box 1, 1
      box 1, 2, c: red, w: fact(3)
    `);
    expect(r).toEqual([
      { kind: 'color', color: 1 },
      { kind: 'line', points: [1, 1, 3, 1] },
      { kind: 'color', color: 4 },
      { kind: 'line', points: [1, 2, 7, 2] },
    ]);
  });

  it('hoists functions so they can be called before their definition', () => {
    expect(ops('later()\nfn later() { color 5 }')).toEqual([{ kind: 'color', color: 5 }]);
  });

  it('reports helpful argument errors', () => {
    expect(err('fn f(a) {}\nf(1, 2)')).toMatch(/f\(\) takes 1 argument but got 2/);
    expect(err('fn f(a) {}\nf(b: 1)')).toMatch(/has no parameter named 'b'/);
    expect(err('fn f(a) {}\nf()')).toMatch(/missing argument 'a'/);
    expect(err('color 16')).toMatch(/colour must be 0-15/);
    expect(err('color "mauve"')).toMatch(/unknown colour 'mauve'/);
    expect(err('line 1,2,3')).toMatch(/odd number of values/);
    expect(err('setxy 1, 2')).toMatch(/'setxy' is not defined - use 'moveto x, y'/);
    expect(err('let x = 4\nx 1')).toMatch(/'x' is a number, not a command/);
  });

  it('stops runaway loops and recursion', () => {
    expect(err('while true { }', { maxSteps: 10_000 })).toMatch(/ran too long/);
    expect(err('fn f() { f() }\nf()')).toMatch(/nested too deeply/);
    expect(err('color 1\nwhile true { line 0,0 }', { maxOps: 100 })).toMatch(/too many drawing operations/);
  });

  it('lists, indexing, len, push, range, string concat', () => {
    const r = ops(`
      let pts = [1, 2]
      push(pts, 3)
      pts[0] = 9
      color 1
      line pts[0], pts[-1], len(pts), len("ab" + str(5))
      line range(4)
    `);
    expect(r.slice(1)).toEqual([
      { kind: 'line', points: [9, 3, 3, 3] },
      { kind: 'line', points: [0, 1, 2, 3] },
    ]);
  });

  it('colour names, aliases and indices', () => {
    expect(ops('color lightgreen\ncolor grey\ncolor "yellow"\ncolor 0')).toEqual([
      { kind: 'color', color: 10 },
      { kind: 'color', color: 7 },
      { kind: 'color', color: 14 },
      { kind: 'color', color: 0 },
    ]);
  });
});

describe('drawing commands', () => {
  it('rline, xcorner and ycorner become absolute polylines tagged with their AGI style', () => {
    expect(ops('color 1\nrline 10,10, 3,0, 0,-2\nxcorner 0,0, 5, 6, 7\nycorner 0,0, 5, 6, 7')).toEqual([
      { kind: 'color', color: 1 },
      { kind: 'line', points: [10, 10, 13, 10, 13, 8], style: 'rel' },
      { kind: 'line', points: [0, 0, 5, 0, 5, 6, 7, 6], style: 'xcorner' },
      { kind: 'line', points: [0, 0, 0, 5, 6, 5, 6, 7], style: 'ycorner' },
    ]);
  });

  it('clamps off-picture points with a warning and skips off-picture fill seeds', () => {
    const r = compile('color 1\nline -5,3  200,170\nfill 500,3  4,4', { file: 't.pic' });
    expect(r.ops.slice(1).map((o) => ('points' in o ? o.points : null))).toEqual([[0, 3, 159, 167], [4, 4]]);
    expect(r.warnings.map((w) => w.message)).toEqual([
      'line: point off the 160×168 picture was clamped to the edge',
      'fill seed (500, 3) is off the picture and was skipped',
    ]);
    expect(r.warnings[0].loc.line).toBe(2);
  });

  it('pen options and splatter textures are deterministic', () => {
    const a = ops('pen 3, square, splatter\nplot 10,10  20,20\nplot 5,5, texture: 7');
    expect(a[0]).toEqual({ kind: 'pen', size: 3, shape: 'rect', splatter: true });
    expect((a[1] as { textures: number[] }).textures).toHaveLength(2);
    expect((a[2] as { textures: number[] }).textures).toEqual([7]);
    expect(ops('pen 3, rect, splatter\nplot 10,10  20,20')).toEqual(a.slice(0, 2));
    expect(ops('pen 3, "rect", splatter')[0]).toEqual(a[0]);
    expect(err('pen 9')).toMatch(/pen size must be 0-7/);
    expect(err('pen 2, "fuzzy"')).toMatch(/pen options are circle, square, solid, splatter/);
  });

  it('seeded random is deterministic and reseedable', () => {
    const src = 'color 1\nline random(0, 159), random(0, 167)\nseed 42\nline random(0, 159), random(0, 167)';
    expect(ops(src)).toEqual(ops(src));
    expect(ops('seed 42\ncolor 1\nline random(0, 159), random(0, 167)')[1]).toEqual(ops(src)[2]);
  });

  it('turtle graphics draw merged polylines; heading 0 is up and right turns clockwise', () => {
    const r = ops('color 1\nmoveto 10, 20\nrepeat 4 { forward 5; right 90 }');
    // repeat body lines share a source line so the 4 segments merge into one polyline
    expect(r.slice(1)).toEqual([{ kind: 'line', points: [10, 20, 10, 15, 15, 15, 15, 20, 10, 20] }]);
    const pen = ops('color 1\nmoveto 0,10\npenup\nforward 5\npendown\nright 180\nforward 2');
    expect(pen.slice(1)).toEqual([{ kind: 'line', points: [0, 5, 0, 7] }]);
  });

  it('save_turtle/restore_turtle and lineto', () => {
    const r = ops('color 1\nmoveto 50,50\nsave_turtle\nforward 10\nrestore_turtle\nlineto 60,50');
    expect(r.slice(1)).toEqual([
      { kind: 'line', points: [50, 50, 50, 40] },
      { kind: 'line', points: [50, 50, 60, 50] },
    ]);
  });
});

describe('review hardening (M3)', () => {
  it('rejects cyclic lists', () => {
    expect(err('let xs = []\npush(xs, xs)')).toMatch(/cannot contain itself/);
    expect(err('let xs = [1]\nlet ys = [xs]\nxs[0] = ys')).toMatch(/cannot contain itself/);
  });

  it('charges merged turtle segments against the op limit', () => {
    expect(err('color 1\nrepeat 1000 { forward 1; right 180 }', { maxOps: 50 })).toMatch(/too many drawing operations/);
  });

  it('built-ins cannot be reassigned and variant is reserved', () => {
    expect(err('variants day, night\nvariant = "night"')).toMatch(/'variant' is built in/);
    expect(err('red = 3')).toMatch(/'red' is built in and can't be reassigned/);
    expect(err('let variant = 1')).toMatch(/'variant' is reserved/);
    expect(ops('let red = 2\ncolor red')).toEqual([{ kind: 'color', color: 2 }]);
  });

  it('validates remap variant names before running', () => {
    expect(err('variants day, night\ncolor 1\nremap nigth { blue: black }')).toMatch(/t\.pic:3:1: remap for unknown variant 'nigth'/);
    expect(err('if true { remap night { blue: black } }')).toMatch(/remap for unknown variant 'night'/);
  });

  it('rejects duplicate named arguments and parameters, and handles prototype-ish names', () => {
    expect(err('fn f(a) { color a }\nf(a: red, a: blue)')).toMatch(/argument 'a' given twice/);
    expect(err('fn f(a, a) { }')).toMatch(/parameter 'a' is listed twice/);
    expect(err('fn f(a) { }\nf(toString: 1)')).toMatch(/has no parameter named 'toString'/);
  });

  it('only a spaced minus starts a new argument; spaced plus is addition', () => {
    expect(ops('color 1\nline 10 +5, 20')).toEqual([{ kind: 'color', color: 1 }, { kind: 'line', points: [15, 20] }]);
  });

  it('explains `name (a, b)` calls', () => {
    expect(err('fn dot(x, y) { line x,y }\ndot (1, 2)')).toMatch(/write name\(a, b\) with no space/);
  });
});

describe('scenes and variants', () => {
  const scene = `
    scene "Test"
    variants day, night
    color variant == "night" ? black : blue
    line 0,0 159,0 159,9 0,9 0,0
    fill 5,5
    remap night { blue: darkgrey }
    if variant == "night" { color yellow; line 3,3 }
  `;

  it('defaults to the first variant and reports title/variants', () => {
    const r = compile(scene, { file: 's.pic' });
    expect(r.title).toBe('Test');
    expect(r.variants).toEqual(['day', 'night']);
    expect(r.variant).toBe('day');
    expect(execute(r.ops).get(5, 5)).toBe(1);
  });

  it('renders the requested variant, with remap applied at its position', () => {
    const fb = execute(compile(scene, { file: 's.pic', variant: 'night' }).ops);
    expect(fb.get(5, 5)).toBe(0);
    expect(fb.get(3, 3)).toBe(14);
  });

  it('rejects unknown variants', () => {
    expect(() => compile(scene, { variant: 'dusk' })).toThrow(/unknown variant 'dusk'/);
    expect(() => compile('color 1', { variant: 'night' })).toThrow(/declares no variants/);
  });

  it('remap without a variant always applies', () => {
    const fb = execute(compile('color red\nfill 0,0\nremap { red: green }').ops);
    expect(fb.get(0, 0)).toBe(2);
  });

  it('records the user line for ops produced inside prelude functions', () => {
    const r = compile('\n\nblob 5, 5', { file: 'main.pic', prelude: 'fn blob(x, y) {\n color red\n line x,y\n}' });
    expect(r.ops.map((o) => o.src?.line)).toEqual([3, 3]);
    expect(r.ops.every((o) => o.src?.file === 'main.pic')).toBe(true);
  });

  it('logs print output', () => {
    expect(compile('print "hi", 1 + 1', { file: 'p.pic' }).logs).toEqual(['p.pic:1: hi 2']);
  });
});

describe('break and continue', () => {
  const xs = (src: string) => compile(`color 1\n${src}`, { file: 't.pic' }).ops.filter((o) => o.kind === 'line').map((o) => (o.kind === 'line' ? o.points[0] : -1));

  it('continue skips to the next iteration and break leaves the loop, in every kind of loop', () => {
    expect(xs('for i in 0..6 { if i == 2 { continue }\nif i == 4 { break }\nline i, 0 }')).toEqual([0, 1, 3]);
    expect(xs('for i in [5, 6, 7] { if i == 6 { continue }\nline i, 0 }')).toEqual([5, 7]);
    expect(xs('repeat 9 { if repcount > 3 { break }\nline repcount, 0 }')).toEqual([1, 2, 3]);
    expect(xs('let i = 0\nwhile true { i += 1\nif i % 2 == 0 { continue }\nif i > 7 { break }\nline i, 0 }')).toEqual([1, 3, 5, 7]);
  });

  it('only affects the innermost loop', () => {
    expect(xs('for a in 0..3 { for b in 0..3 { if b == 1 { break }\nline a * 10 + b, 0 } }')).toEqual([0, 10, 20]);
  });

  it('works inside a function called from a loop body, and in a loop inside a function', () => {
    expect(xs('fn f() { for i in 0..9 { if i == 2 { return null }\nline i, 0 } }\nfor k in 0..2 { f() }')).toEqual([0, 1, 0, 1]);
    expect(xs('fn g(n) { for i in 0..9 { if i == n { break }\nline i, 0 }\nline 99, 0 }\ng(2)')).toEqual([0, 1, 99]);
  });

  it('is a syntax error outside a loop, including a fn defined inside a loop', () => {
    expect(err('break')).toMatch(/t\.pic:1:1: 'break' can only be used inside a loop/);
    expect(err('if true { continue }')).toMatch(/'continue' can only be used inside a loop/);
    expect(err('for i in 0..3 { fn f() { break } }')).toMatch(/'break' can only be used inside a loop/);
  });

  it('are keywords', () => {
    expect(err('let break = 1')).toMatch(/expected a variable name/);
  });
});

describe('outline', () => {
  it('on the picture it is exactly a closed polyline', () => {
    expect(ops('outline [[10, 10], [20, 10], [15, 20]]')).toEqual([{ kind: 'line', points: [10, 10, 20, 10, 15, 20, 10, 10] }]);
    expect(ops('outline 10.4, 10, 20, 9.6')).toEqual([{ kind: 'line', points: [10, 10, 20, 10, 10, 10] }]);
  });

  it('clips edges that leave the picture instead of clamping them, silently', () => {
    const r = compile('outline [[150, 10], [170, 10], [170, 30], [150, 30]]', { file: 't.pic' });
    expect(r.warnings).toEqual([]);
    const pieces = r.ops.map((o) => (o.kind === 'line' ? o.points : []));
    // the right edge (x = 170) is off the picture: no line runs down the border
    expect(pieces).toEqual([[159, 30, 150, 30, 150, 10, 159, 10]]);
    for (const p of pieces) for (let i = 0; i < p.length; i += 2) expect(p[i]).toBeLessThanOrEqual(159);
  });

  it('keeps every emitted coordinate on the picture, even for absurd inputs', () => {
    // (the lexer has no exponent notation, so build 10^16 and ±10^308 in the script)
    for (const [power, sign] of [[16, 1], [308, 1], [308, -1]]) {
      const src = `let big = ${sign}\nrepeat ${power} { big *= 10 }\ncolor 1\noutline [[10, 10], [big, 20], [30, big]]`;
      const r = compile(src, { file: 't.pic' });
      for (const o of r.ops) {
        if (o.kind !== 'line') continue;
        o.points.forEach((v, i) => {
          expect(Number.isInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(i % 2 ? 167 : 159);
        });
      }
    }
  });

  it('draws nothing for a shape entirely off the picture and needs two points', () => {
    expect(ops('outline [[-50, -50], [-10, -50], [-10, -10]]')).toEqual([]);
    expect(err('outline 1, 2')).toMatch(/at least 2 x,y points/);
  });

  it('a big blob running off two edges keeps its on-picture edges and warns about nothing', () => {
    const r = compile('color black\noutline [[-20, 80], [80, -20], [180, 80], [80, 190]]', { file: 't.pic' });
    expect(r.warnings).toEqual([]);
    const fb = execute(r.ops);
    expect(fb.get(0, 0)).toBe(15); // the corner is not part of the outline (clamping would have drawn the border)
    expect(fb.get(80, 0)).toBe(15);
    expect(fb.get(30, 30)).toBe(0); // on the diagonal edge from (-20, 80) to (80, -20)
  });
});

describe('stroke', () => {
  it('on the picture it is exactly `line`; it never closes the path', () => {
    expect(ops('color 1\nstroke [[10, 10], [20, 10], [15, 20]]')).toEqual(ops('color 1\nline [[10, 10], [20, 10], [15, 20]]'));
  });

  it('clips the parts that leave the picture, silently, without bending the line to the edge', () => {
    const r = compile('color 1\nstroke [[150, 10], [170, 30], [150, 50]]', { file: 't.pic' });
    expect(r.warnings).toEqual([]);
    const lines = r.ops.filter((o) => o.kind === 'line').map((o) => (o.kind === 'line' ? o.points : []));
    expect(lines).toEqual([[150, 10, 159, 19], [159, 41, 150, 50]]);
  });

  it('draws nothing for a path entirely off the picture, and clips a corner-crossing segment', () => {
    expect(ops('color 1\nstroke [[-50, -50], [-10, -60]]')).toEqual([{ kind: 'color', color: 1 }]);
    expect(ops('color 1\nstroke [[-10, 10], [10, -10]]')).toEqual([{ kind: 'color', color: 1 }, { kind: 'line', points: [0, 0, 0, 0] }]);
    expect(ops('color 1\nstroke 5, 5')).toEqual([{ kind: 'color', color: 1 }, { kind: 'line', points: [5, 5] }]);
    expect(ops('color 1\nstroke 500, 5')).toEqual([{ kind: 'color', color: 1 }]);
    expect(err('stroke 5')).toMatch(/stroke needs at least one x,y point/);
  });
});

describe('warnings inside the scene\'s own functions', () => {
  it('name the top-level line that called the function', () => {
    const r = compile('fn edge(x) {\n  color 1\n  line x, 10, x + 20, 10\n}\nedge(10)\nedge(150)', { file: 't.pic' });
    expect(r.warnings.map((w) => `${w.loc.line}: ${w.message}`)).toEqual(['3: line: point off the 160×168 picture was clamped to the edge (called from line 6)']);
  });
});

describe('warnings inside functions (review fixes)', () => {
  it('turtle warnings point at the turtle command and name the caller', () => {
    const r = compile('fn walk() {\n  color 1\n  moveto 150, 10\n  heading 90\n  forward 40\n}\nwalk()', { file: 't.pic' });
    expect(r.warnings.map((w) => `${w.loc.line}: ${w.message}`)).toEqual(['5: turtle: point off the 160×168 picture was clamped to the edge (called from line 7)']);
  });

  it('two different clamped lines in one function both warn; a loop of calls warns once per site', () => {
    const r = compile('fn two() {\n  color 1\n  line 150, 10, 170, 10\n  line 150, 20, 170, 20\n}\nrepeat 3 { two() }', { file: 't.pic' });
    expect(r.warnings.map((w) => w.loc.line)).toEqual([3, 4]);
  });
});

describe('type()', () => {
  it('names the kind of a value', () => {
    const logs = compile('fn f() { }\nprint type(1), type("a"), type([1]), type(f), type(true), type(null), type(red)', { file: 't.pic' }).logs;
    expect(logs[0]).toBe('t.pic:2: number string list function bool null number');
  });
});

describe('line continuation', () => {
  it('an operator at the end of a line continues the expression', () => {
    expect(compile('let a = 1 +\n  2 *\n  3\nprint a', { file: 't.pic' }).logs[0]).toBe('t.pic:4: 7');
    expect(compile('let xs = [1] +\n  [2]\nprint xs', { file: 't.pic' }).logs[0]).toBe('t.pic:3: [1, 2]');
    expect(ops('color 1\nline 10, 10 +\n  5')).toEqual([{ kind: 'color', color: 1 }, { kind: 'line', points: [10, 15] }]);
    // a trailing minus continues too, with or without a space after it; ` -5` still splits
    expect(ops('color 1\nline 10, 10 -\n5')).toEqual([{ kind: 'color', color: 1 }, { kind: 'line', points: [10, 5] }]);
    expect(ops('color 1\nline 20 -5, 3, 4')).toEqual([{ kind: 'color', color: 1 }, { kind: 'line', points: [20, 0, 3, 4] }]);
  });

  it('a semicolon still ends the statement after an operator', () => {
    expect(err('let x = 1 +;\n2')).toMatch(/t\.pic:1:12: expected a value/);
  });
});

describe('delay', () => {
  const levels = (src: string) => compile(src, { file: 't.pic' }).ops.map((o) => `${o.kind}${o.delay ? `@${o.delay}` : ''}`);

  it('tags the ops painted inside it with its level (1 by default); the innermost block wins', () => {
    expect(levels('color 1\ndelay { line 0, 0 }\ndelay 3 { line 1, 1\ndelay 2 { line 2, 2 }\nline 3, 3 }\nline 4, 4')).toEqual([
      'color',
      'line@1',
      'line@3',
      'line@2',
      'line@3',
      'line',
    ]);
  });

  it('also tags what functions called inside it paint, and the stdlib', () => {
    expect(levels('fn f() { color 2\nline 0, 0 }\ndelay { f() }\nf()')).toEqual(['color@1', 'line@1', 'color', 'line']);
    const r = compile('delay { rect 0, 0, 3, 2 }', { file: 't.pic' });
    expect(r.ops.length).toBe(3);
    expect(r.ops.every((o) => o.delay === 1)).toBe(true);
  });

  it('is see-through: no scope of its own, and its functions and variants count as declared around it', () => {
    expect(ops('delay { let h = 7 }\nline 0, h')).toEqual([{ kind: 'line', points: [0, 7] }]);
    expect(ops('f()\ndelay { fn f() { line 1, 1 } }')).toEqual([{ kind: 'line', points: [1, 1] }]);
    const r = compile('delay { variants day, night }\nif variant == "night" { color 1 }', { file: 't.pic', variant: 'night' });
    expect(r.variants).toEqual(['day', 'night']);
    expect(err('variants day\ndelay { remap dusk { 1: 2 } }')).toMatch(/remap for unknown variant 'dusk'/);
    expect(err('delay { variants day, night }', { variant: 'dusk' })).toMatch(/unknown variant 'dusk' \(this scene declares: day, night\)/);
  });

  it('never changes the picture: only when the viewer shows it', () => {
    const plain = 'color 3\nrect 0, 0, 159, 80\ncolor 2\nfill 5, 100\ncolor 4\nrect 40, 40, 60, 120';
    const held = 'delay 2 {\ncolor 3\nrect 0, 0, 159, 80\n}\ndelay { color 2\nfill 5, 100 }\ncolor 4\nrect 40, 40, 60, 120';
    const a = compile(plain, { file: 't.pic' }).ops;
    const b = compile(held, { file: 't.pic' }).ops;
    expect(b.map(({ src: _s, delay: _d, ...rest }) => rest)).toEqual(a.map(({ src: _s, ...rest }) => rest));
    expect(execute(b).hash()).toBe(execute(a).hash());
  });

  it('needs a whole-number level of 1 or more, and is a keyword', () => {
    expect(err('delay 0 { }')).toMatch(/t\.pic:1:7: delay level must be a whole number, 1 or more \(got 0\)/);
    expect(err('delay 1.5 { }')).toMatch(/delay level must be a whole number/);
    expect(err('delay "sky" { }')).toMatch(/delay level must be a number, got string/);
    expect(err('let delay = 1')).toMatch(/expected a variable name/);
    expect(err('delay 2')).toMatch(/expected '\{'/);
  });
});

describe('object', () => {
  const tags = (src: string, opts = {}) => {
    const r = compile(src, { file: 't.pic', ...opts });
    return r.ops.map((o) => `${o.kind}${o.obj === undefined ? '' : `:${r.objects[o.obj].id}`}`);
  };

  it('tags the ops painted inside it with its innermost object, and lists the objects', () => {
    const src = 'color 1\nobject "table" { line 0, 0\nobject "leg" { line 1, 1 }\nline 2, 2 }\nobject "vase" { color 2\nline 3, 3 }\nline 4, 4';
    expect(tags(src)).toEqual(['color', 'line:table', 'line:leg', 'line:table', 'color:vase', 'line:vase', 'line']);
    const r = compile(src, { file: 't.pic' });
    expect(r.objects.map((o) => [o.id, o.parent, o.src.line])).toEqual([
      ['table', -1, 2],
      ['leg', 0, 3],
      ['vase', -1, 5],
    ]);
  });

  it('also tags what functions and the stdlib paint inside it, and takes a computed name', () => {
    expect(tags('fn f() { color 2\nline 0, 0 }\nobject "a" { f() }\nf()')).toEqual(['color:a', 'line:a', 'color', 'line']);
    const r = compile('for i in 0..2 { object "candle-" + i { rect i, 0, i, 1 } }', { file: 't.pic' });
    expect(r.objects.map((o) => o.id)).toEqual(['candle-0', 'candle-1']);
    expect(r.ops.every((o) => o.obj !== undefined)).toBe(true);
    const lib = compile('object "a" { paint() }', { file: 't.pic', prelude: 'fn paint() { color 3\nline 0, 0 }' });
    expect(lib.ops.map((o) => o.obj)).toEqual([0, 0]);
  });

  it('can be reopened with the same parent, adding to the same object', () => {
    const r = compile('object "table" { line 0, 0 }\nline 1, 1\nobject "table" { line 2, 2 }', { file: 't.pic' });
    expect(r.objects.length).toBe(1);
    expect(r.ops.map((o) => o.obj)).toEqual([0, undefined, 0]);
    expect(err('object "a" { object "b" { } }\nobject "b" { }')).toMatch(/t\.pic:2:1: object 'b' was first opened inside 'a' \(line 1\), so it must be reopened there too, not outside any object/);
    expect(err('object "a" { object "a" { } }')).toMatch(/object 'a' is already open here/);
    expect(err('object "a" { object "b" { object "a" { } } }')).toMatch(/object 'a' is already open here/);
  });

  it('is see-through: no scope, functions hoisted, and never changes the picture', () => {
    expect(ops('object "a" { let h = 7 }\nline 0, h')).toEqual([{ kind: 'line', points: [0, 7] }]);
    expect(ops('f()\nobject "a" { fn f() { line 1, 1 } }')).toEqual([{ kind: 'line', points: [1, 1] }]);
    const plain = 'color 3\nrect 0, 0, 159, 80\ncolor 2\nfill 5, 100\ncolor 4\nrect 40, 40, 60, 120';
    const held = 'object "sky" {\ncolor 3\nrect 0, 0, 159, 80\n}\ndelay { object "sea" { color 2\nfill 5, 100 } }\nobject "rock" { color 4\nrect 40, 40, 60, 120 }';
    const a = compile(plain, { file: 't.pic' }).ops;
    const b = compile(held, { file: 't.pic' }).ops;
    expect(b.map(({ src: _s, delay: _d, obj: _o, ...rest }) => rest)).toEqual(a.map(({ src: _s, ...rest }) => rest));
    expect(execute(b).hash()).toBe(execute(a).hash());
    expect(b.find((o) => o.kind === 'fill')).toMatchObject({ delay: 1, obj: 1 });
    const c = compile('object "a" { variants day, night\ndelay 2 { line 0, 0 } }', { file: 't.pic', variant: 'night' });
    expect(c.variants).toEqual(['day', 'night']);
    expect(c.ops[0]).toMatchObject({ delay: 2, obj: 0 });
  });

  it("doesn't merge a turtle path across an object's edge", () => {
    const r = compile('color 1\nforward 5; object "a" { forward 5 }; forward 5', { file: 't.pic' });
    expect(r.ops.filter((o) => o.kind === 'line').map((o) => o.obj)).toEqual([undefined, 0, undefined]);
  });

  it("can't hold a remap, and needs a kebab-case string name", () => {
    expect(err('variants day, night\nobject "sky" { remap night { 1: 2 } }', { variant: 'night' })).toMatch(/t\.pic:2:16: remap can't be inside an object block .*'sky', opened at line 2/);
    // a remap for another variant doesn't run, so it isn't an error there
    expect(() => compile('variants day, night\nobject "sky" { remap night { 1: 2 } }', { file: 't.pic', variant: 'day' })).not.toThrow();
    expect(err('variants day\nobject "a" { remap dusk { 1: 2 } }')).toMatch(/remap for unknown variant 'dusk'/);
    expect(err('object 3 { }')).toMatch(/t\.pic:1:8: an object's name must be a string like "vase", got number/);
    expect(err('object "Blue Vase" { }')).toMatch(/object name 'Blue Vase' must be kebab-case/);
    expect(err('object "vase-" { }')).toMatch(/must be kebab-case/);
    expect(err('object { }')).toMatch(/expected the object's name/);
    expect(err('object "a"\nline 0, 0')).toMatch(/expected '\{'/);
    expect(err('let object = 1')).toMatch(/expected a variable name/);
  });

  it('lists only the objects the variant ran', () => {
    const src = 'variants day, night\nobject "sun" { line 0, 0 }\nif variant == "night" { object "moon" { line 1, 1 } }';
    expect(compile(src, { file: 't.pic', variant: 'day' }).objects.map((o) => o.id)).toEqual(['sun']);
    expect(compile(src, { file: 't.pic', variant: 'night' }).objects.map((o) => o.id)).toEqual(['sun', 'moon']);
  });
});

describe('instructions (src.instr)', () => {
  const instr = (src: string) => compile(src, { file: 't.pic' }).ops.map((o) => o.src?.instr);

  it('numbers every run of a scene statement: each statement, each loop iteration, one per call', () => {
    const ids = instr('color 1\nrect 0, 0, 3, 1\nfor i in 0..2 { line i, 0\nline i, 1 }\nfn f() { line 5, 5\nline 6, 6 }\nf()');
    const [c, r1, r2, a, b, d, e, f1, f2] = ids;
    expect(r1).toBe(r2);
    expect(new Set([c, r1, a, b, d, e, f1]).size).toBe(7);
    expect(f1).toBe(f2);
  });
});
