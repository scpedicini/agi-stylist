// Generate the skill's stdlib reference (signatures, docs, thumbnails) from app/src/lang/stdlib.pic.
//   pnpm skill:docs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execute } from '../src/engine/execute.ts';
import { compileProgram, parse } from '../src/lang/index.ts';
import { writePanelsPng } from './lib/png.ts';
import { STDLIB_PATH, stdlib } from './lib/stdlib.ts';

const SKILL = 'skills/old-adventure-game-draw';
const src = readFileSync(STDLIB_PATH, 'utf8').split('\n');

// A small demo scene per function: grass + sky backdrop, then the call.
const BACKDROP = 'sky 30\nground 31\n';
const DEMOS: Record<string, string> = {
  shape: 'shape(blob(80, 84, 30, 40, 3), yellow)',
  blob: 'shape(blob(80, 84, 40, 50, 5, 0.25), red)',
  arc: 'color black\nline arc(80, 90, 40, 50, 270, 450)\ncolor red\nline arc(80, 90, 30, 40, 0, 180, 30)',
  shift: 'let pts = blob(80, 90, 26, 34, 3)\ncolor black\noutline pts\ncolor red\noutline shift(pts, 20, 10)',
  interp: 'let edge = [[0, 70], [60, 50], [100, 80], [159, 60]]\ncolor black\nline edge\ncolor red\nfor x in range(5, 160, 10) { line x, interp(edge, x), x, interp(edge, x) + 12 }',
  spanx: 'let torn = blob(80, 90, 40, 50, 6, 0.3)\ncolor yellow\nrect 0, 31, 159, 167\ncolor darkgrey\nfor y in range(45, 140, 4) {\n  let sp = spanx(torn, y)\n  if sp != null { stroke sp[0], y, sp[1], y }\n}',
  scale: 'let pts = blob(80, 90, 40, 50, 3)\nshape(pts, brown)\nshape(scale(pts, 0.6), yellow, null)',
  slice: 'let edge = [[0, 90], [40, 70], [80, 80], [120, 60], [159, 75]]\ncolor black\nline edge\ncolor red\nline slice(edge, 1, 4)',
  surround: 'color lightcyan\nrect 0, 0, 159, 167\nsurround(blob(80, 84, 40, 56, 2, 0.15), brown)',
  band: 'shape(band([[20, 160], [50, 130], [70, 90], [110, 70], [150, 74]], 12, 3), brown)',
  offset: 'let path = [[20, 150], [60, 110], [100, 100], [140, 60]]\nshape(band(path, 14, 8), lightgrey)\ncolor white\nstroke offset(path, -4)\ncolor darkgrey\nstroke offset(path, 4)',
  along: 'let path = [[10, 140], [60, 90], [110, 110], [150, 60]]\ncolor black\nline path\ncolor red\nfor p in along(path, 16) { rect p[0] - 1, p[1] - 2, p[0] + 1, p[1] + 2 }',
  ribbed: 'color black\nrect 0, 31, 159, 167\nribbed([[10, 150], [50, 110], [90, 100], [150, 50]], 22, 8, darkgrey, black, cyan)',
  across: 'let path = [[10, 140], [60, 90], [110, 100], [150, 50]]\ncolor black\nline path\ncolor red\nfor seg in across(path, 14, 8) { stroke seg }',
  chain: 'color darkgrey\nrect 0, 31, 159, 167\nchain([[30, 40], [50, 120], [90, 140], [130, 100], [140, 40]])',
  reverse: 'let edge = [[10, 80], [50, 60], [110, 70], [150, 50]]\nshape(edge + reverse(shift(edge, 0, 12)), brown)',
  lancet: 'color lightgrey\nrect 20, 40, 140, 150\nshape(lancet(55, 50, 12, 150), black)\nshape(lancet(110, 60, 9, 150), blue)',
  bird: 'color lightcyan\nrect 0, 0, 159, 167\nbird(40, 50)\nbird(110, 40, -1, 1.5, 0)\nbird(70, 110, 1, 1, -1, white)\nbird(120, 110, 1, 0.5)\nbird(135, 100, 1, 0.4)',
  baretree: 'color lightblue\nrect 0, 0, 159, 99\ncolor lightgreen\nrect 0, 100, 159, 167\nbaretree(45, 150, 1.2)\nbaretree(115, 140, 0.8, 3, darkgrey)',
  road: 'color lightgreen\nrect 0, 40, 159, 167\nshape(road([[85, 40], [70, 70], [100, 105], [75, 167]], 2, 22), brown)',
  groundscale: 'color lightgreen\nrect 0, 30, 159, 167\nfor y in [60, 85, 115, 160] {\n  tree(15 + (y - 60) * 1.2, y, groundscale(y, 30))\n}',
  inside: 'let o = blob(80, 95, 50, 55, 4, 0.35)\ncolor black\noutline o\nfor y in range(40, 152, 6) {\n  for x in range(26, 136, 4) {\n    color inside(o, x, y) ? red : darkgrey\n    rect x, y, x, y\n  }\n}',
  fenceline: 'color lightgreen\nrect 0, 30, 159, 167\nfenceline([[-5, 150], [60, 122], [100, 100], [160, 88]], 16, 30)',
  poplar: 'color lightgreen\nrect 0, 30, 159, 167\npoplar(30, 150, 100)\npoplar(70, 120, 60)\npoplar(100, 95, 34)\npoplar(120, 80, 20)\npoplar(132, 70, 12)',
  trail: 'color lightgreen\nrect 0, 30, 159, 167\nshape(trail([[0, 50], [40, 52], [70, 62], [86, 90], [86, 167]], 12, 30), brown)',
  forest: 'forest([[90, 52], [150, 48], [158, 150], [94, 152]], 30)\nforest([[6, 78], [58, 74], [62, 142], [8, 146]], 30, 1, 4)',
  pixmap: 'color lightblue\nrect 40, 50, 120, 120\npixmap(64, 70, ["..yyyy..", ".y....y.", "y.y..y.y", "y......y", "y.y..y.y", ".y.yy.y.", "..yyyy.."], "y", [brown])\npixmap(90, 72, ["kk.", "k.k", "kk.", "k..", "k.."], "k", [black])',
  blobs: 'blobs([[60, 90, 16, 12], [84, 80, 18, 14], [106, 92, 16, 12], [80, 102, 22, 10]], green)',
  room: 'let r = room(50, 40, 110, 110)\nshape(r[3], brown)\nshape(r[1], lightgrey)\nshape(r[2], darkgrey)\nshape(r[4], yellow)\nshape(r[0], lightgrey)\ncolor black\nfor i in 1..5 {\n  let d = depth(50, 40, 110, 110, (i / 5) * sqrt(i / 5))\n  stroke d[0], d[3], d[2], d[3]\n}',
  depth: 'let r = room(50, 40, 110, 110)\nshape(r[4], yellow)\ncolor black\nfor i in 0..=6 {\n  let d = depth(50, 40, 110, 110, (i / 6) * sqrt(i / 6))\n  stroke d[0], d[3], d[2], d[3]\n}',
  archway: 'color lightgrey\nrect 20, 40, 140, 150\nshape(archway(55, 60, 18, 20, 150), black)\nshape(archway(110, 60, 16, 18, 150, 240), black)',
  frond: 'frond(40, 120, 50, 60)\nfrond(120, 120, 50, 300, 70)',
  leaf: 'color brown\nline 20, 150, 80, 100, 140, 80\nleaf(40, 133, 26, 300)\nleaf(60, 117, 26, 30)\nleaf(100, 93, 26, 330)\nleaf(120, 87, 26, 60)',
  trunk: 'trunk(30, 46, 160)\ntrunk(80, 90, 140, 2, brown, yellow, 3)\ntrunk(120, 128, 120, 2, lightgrey, white, 5)',
  palm: 'palm(60, 160, 70, 10)\npalm(120, 160, 50, -6, 3)',
  fern: 'fern(50, 150, 30, 24)\nfern(115, 150, 20, 16, 4)',
  wavy: 'color brown\nline wavy(0, 159, 90, 20, 2)',
  squiggle: 'color black\nsquiggle(30, 84, 100, 90, 4)',
  frame: 'frame()',
  sky: 'sky(60)',
  hills: 'hills(20, 50)',
  treeline: 'treeline(40, 60)',
  ground: 'ground(80)',
  ridge: 'ridge(80)',
  tree: 'tree(80, 150)',
  fruit: 'tree(80, 150)\nfruit(80, 110, 11, 18, 9, red)',
  sparkle: 'color yellow\nrect 79, 82, 81, 86\nsparkle(80, 84, white, 4)',
  horizon: 'horizon(30)',
  pine: 'pine(80, 150, 2)',
  bush: 'bush(80, 140, 40, 24)',
  reeds: 'reeds(70, 150, 40, 6)',
  flowers: 'flowers(40, 100, 120, 160, 60)',
  stump: 'stump(80, 140, 16, 14)',
  boulder: 'boulder([[30, 140], [38, 112], [62, 104], [84, 116], [88, 140], [58, 148]])\nboulder([[96, 140], [104, 120], [124, 116], [138, 128], [134, 144]], lightgrey, brown, black, -0.3)',
  rock: 'rock(80, 140, 40, 24)',
  pond: 'pond(80, 110, 50, 24)',
  stream: 'stream([[0, 100], [60, 110], [100, 90], [159, 120]], 10)',
  river: 'river([[0, 100], [60, 110], [100, 90], [159, 120]], 14)',
  path: 'path([[80, 167], [70, 120], [90, 70]], 12)',
  cave_mouth: 'cave_mouth(80, 140, 50, 50)',
  fence: 'fence(10, 150, 150, 130, 14)',
  column: 'column(50, 62, 50, 160)\ncolumn(100, 108, 70, 150, lightred, red)',
  web: 'color blue\nrect 0, 31, 159, 167\nweb(80, 100, 50, 60)',
  stones: 'color lightgrey\nrect 30, 50, 130, 150\nstones(30, 50, 130, 150)',
  books: 'color brown\nrect 30, 70, 130, 130\nbooks(32, 128, 90, 12)\nbooks(32, 128, 110, 12, 7)\nbooks(32, 128, 128, 12, 3)\ncolor yellow\nline 30, 90, 130, 90\nline 30, 110, 130, 110',
  stonewall: 'stonewall(10, 150, 150, 130, 14)',
  night: 'tree(80, 150)\nnight()\nmoon(130, 12)\nstars()',
  dusk: 'tree(80, 150)\ndusk()',
  cloud: 'cloud(80, 14, 60)',
  moon: 'moon(80, 15, 10)',
  stars: 'stars(60, 1, 30)',
};

interface Fn {
  name: string;
  signature: string;
  doc: string[];
  section: string;
}
const fns: Fn[] = [];
let section = '';
for (let i = 0; i < src.length; i++) {
  const sec = /^# (\S[\w ]+)$/.exec(src[i]);
  if (sec && /^# -{5,}/.test(src[i - 1] ?? '')) section = sec[1];
  const m = /^fn (\w+)\((.*)\) \{/.exec(src[i]);
  if (!m) continue;
  const doc: string[] = [];
  for (let j = i - 1; j >= 0 && src[j].startsWith('#'); j--) doc.unshift(src[j].replace(/^#\s?/, ''));
  fns.push({ name: m[1], signature: `${m[1]}(${m[2]})`, doc, section });
}

mkdirSync(`${SKILL}/references/stdlib`, { recursive: true });
const md: string[] = [
  '# PicScript standard library',
  '',
  'Generated from `app/src/lang/stdlib.pic` by `pnpm skill:docs` - do not edit by hand.',
  'Every function is available in every scene. Thumbnails show each one on a sky/grass backdrop;',
  'open them with the Read tool to see what a function draws before using it.',
  '',
];
let lastSection = '';
for (const f of fns) {
  if (f.section !== lastSection) {
    md.push(`## ${f.section}`, '');
    lastSection = f.section;
  }
  md.push(`### \`${f.signature}\``, '');
  if (f.doc.length) md.push(f.doc.join(' '), '');
  const demo = DEMOS[f.name];
  if (demo) {
    const scene = (f.name === 'sky' || f.name === 'ground' || f.name === 'hills' ? '' : BACKDROP) + demo;
    const fb = execute(compileProgram(parse(scene, `${f.name}-demo.pic`), { prelude: stdlib() }).ops);
    writePanelsPng(`${SKILL}/references/stdlib/${f.name}.png`, [{ fb }], 1);
    md.push('```js', demo, '```', '', `Thumbnail: \`references/stdlib/${f.name}.png\``, '');
  }
}
// seed sheets: the same call with seeds 1-8, left to right, top row then bottom row
const SHEETS: Record<string, (seed: number, x: number, y: number) => string> = {
  tree: (s, x, y) => `tree(${x}, ${y}, 0.7, seed: ${s})`,
  pine: (s, x, y) => `pine(${x}, ${y}, 0.9, seed: ${s})`,
  bush: (s, x, y) => `bush(${x}, ${y}, 26, 16, seed: ${s})`,
  rock: (s, x, y) => `rock(${x}, ${y}, 26, 14, seed: ${s})`,
  cloud: (s, x, y) => `cloud(${x}, ${y - 30}, 30, seed: ${s})`,
  baretree: (s, x, y) => `baretree(${x}, ${y}, 0.7, seed: ${s})`,
};
md.push('## Seed sheets', '', 'The same call with `seed:` 1-8 (top row 1-4, bottom row 5-8, left to right). Pick a seed whose shape you like instead of guessing.', '');
for (const [name, call] of Object.entries(SHEETS)) {
  const lines = ['sky 40', 'ground 41'];
  for (let k = 0; k < 8; k++) lines.push(call(k + 1, 20 + (k % 4) * 40, k < 4 ? 80 : 160));
  const fb = execute(compileProgram(parse(lines.join('\n'), `${name}-seeds.pic`), { prelude: stdlib() }).ops);
  writePanelsPng(`${SKILL}/references/stdlib/${name}-seeds.png`, [{ fb }], 2);
  md.push(`- \`${name}\`: \`references/stdlib/${name}-seeds.png\``);
}
md.push('');
// the 16 colours as they look on screen, 0-15 left to right, for choosing colours by eye
const swatches = execute(
  compileProgram(parse(Array.from({ length: 16 }, (_, i) => `color ${i}\nrect ${i * 10}, 0, ${i * 10 + 9}, 167`).join('\n'), 'palette.pic')).ops,
);
writePanelsPng(`${SKILL}/references/palette.png`, [{ fb: swatches }], 1);
writeFileSync(`${SKILL}/references/stdlib.md`, md.join('\n'));
const missing = fns.filter((f) => !DEMOS[f.name]).map((f) => f.name);
console.log(`${fns.length} functions documented${missing.length ? `; no demo for: ${missing.join(', ')}` : ''}`);
