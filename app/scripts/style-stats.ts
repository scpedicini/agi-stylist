// Measure KQ1 art conventions across reference/kq1/*.png and write docs/style-stats.md.
import { readdirSync, writeFileSync } from 'node:fs';
import { PIC_HEIGHT, PIC_WIDTH } from '../src/engine/framebuffer.ts';
import { COLOR_NAMES } from '../src/engine/palette.ts';
import { readPicturePng } from './lib/png.ts';

const ids = readdirSync('reference/kq1').filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)).sort();
const pics = ids.map((id) => ({ id, fb: readPicturePng(`reference/kq1/${id}.png`) }));
const pct = (n: number, d: number) => `${((100 * n) / d).toFixed(1)}%`;

// Outdoor = top rows are mostly blue sky.
const isOutdoor = (fb: (typeof pics)[number]['fb']) => {
  let blue = 0;
  for (let x = 0; x < PIC_WIDTH; x++) for (let y = 1; y < 7; y++) if (fb.get(x, y) === 1) blue++;
  return blue > PIC_WIDTH * 6 * 0.5;
};
const outdoor = pics.filter((p) => isOutdoor(p.fb));
const out: string[] = [];
out.push('# KQ1 style statistics', '', `Measured by \`app/scripts/style-stats.ts\` over the ${pics.length} reference scenes in \`reference/kq1/\`.`, '');

// frame: how often each picture edge is solid black
const edge = (name: string, get: (fb: (typeof pics)[number]['fb'], i: number) => number, len: number) => {
  const solid = pics.filter(({ fb }) => {
    let n = 0;
    for (let i = 0; i < len; i++) if (get(fb, i) === 0) n++;
    return n / len > 0.9;
  }).length;
  return `${name} ${solid}/${pics.length}`;
};
out.push(
  '## Frame',
  '',
  `Edges that are ≥90% black: ${[
    edge('top row', (fb, i) => fb.get(i, 0), PIC_WIDTH),
    edge('bottom row', (fb, i) => fb.get(i, PIC_HEIGHT - 1), PIC_WIDTH),
    edge('left column', (fb, i) => fb.get(0, i), PIC_HEIGHT),
    edge('right column', (fb, i) => fb.get(PIC_WIDTH - 1, i), PIC_HEIGHT),
  ].join(', ')}.`,
  '',
);

// overall colour usage
const total = new Array(16).fill(0);
for (const { fb } of pics) for (const c of fb.pixels) total[c]++;
const all = pics.length * PIC_WIDTH * PIC_HEIGHT;
out.push('## Colour usage (all scenes)', '', '| # | colour | share |', '|---|---|---|');
total
  .map((n, c) => [n, c])
  .sort((a, b) => b[0] - a[0])
  .forEach(([n, c]) => out.push(`| ${c} | ${COLOR_NAMES[c]} | ${pct(n, all)} |`));

// vertical layout of outdoor scenes
out.push('', `## Outdoor layout (${outdoor.length} scenes whose top rows are blue sky)`, '');
const skyBottom: number[] = [];
const horizonRows: number[] = [];
for (const { fb } of outdoor) {
  // sky: first row (from top) where blue covers < 50% of the row
  let y = 1; // row 0 is the black frame
  const share = (row: number, c: number) => {
    let n = 0;
    for (let x = 0; x < PIC_WIDTH; x++) if (fb.get(x, row) === c) n++;
    return n / PIC_WIDTH;
  };
  while (y < PIC_HEIGHT && share(y, 1) >= 0.5) y++;
  skyBottom.push(y);
  let h = 0;
  for (let r = y; r < Math.min(PIC_HEIGHT, y + 12); r++) if (share(r, 9) >= 0.3) h++;
  horizonRows.push(h);
}
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
out.push(
  `- Sky (blue, colour 1) fills rows 1-${median(skyBottom) - 1} in the median scene (range ${Math.min(...skyBottom)}-${Math.max(...skyBottom)}).`,
  `- Directly below the sky, a light-blue (9) "distant hills/horizon" strip is ${median(horizonRows)} rows tall in the median scene.`,
);

// dominant colour per 8-row band
out.push('', '### Dominant colours by height (outdoor scenes)', '', '| rows | top colours |', '|---|---|');
for (let y0 = 0; y0 < PIC_HEIGHT; y0 += 12) {
  const counts = new Array(16).fill(0);
  for (const { fb } of outdoor) for (let y = y0; y < Math.min(PIC_HEIGHT, y0 + 12); y++) for (let x = 0; x < PIC_WIDTH; x++) counts[fb.get(x, y)]++;
  const sum = counts.reduce((a, b) => a + b, 0);
  const top = counts
    .map((n, c) => [n, c])
    .sort((a, b) => b[0] - a[0])
    .slice(0, 4)
    .filter(([n]) => n / sum > 0.03)
    .map(([n, c]) => `${COLOR_NAMES[c]} ${pct(n, sum)}`)
    .join(', ');
  out.push(`| ${y0}-${Math.min(PIC_HEIGHT, y0 + 12) - 1} | ${top} |`);
}

// colour adjacency: which colours border which (tells us outline/highlight conventions)
out.push('', '## Colour neighbours', '', 'For each colour, the colours it most often touches (4-neighbour pixel pairs), all scenes.', '', '| colour | most common neighbours |', '|---|---|');
const adj = Array.from({ length: 16 }, () => new Array(16).fill(0));
for (const { fb } of pics) {
  for (let y = 0; y < PIC_HEIGHT; y++) {
    for (let x = 0; x < PIC_WIDTH; x++) {
      const c = fb.get(x, y);
      if (x + 1 < PIC_WIDTH && fb.get(x + 1, y) !== c) (adj[c][fb.get(x + 1, y)]++, adj[fb.get(x + 1, y)][c]++);
      if (y + 1 < PIC_HEIGHT && fb.get(x, y + 1) !== c) (adj[c][fb.get(x, y + 1)]++, adj[fb.get(x, y + 1)][c]++);
    }
  }
}
for (let c = 0; c < 16; c++) {
  const s = adj[c].reduce((a, b) => a + b, 0);
  if (!s) continue;
  const top = adj[c]
    .map((n, d) => [n, d])
    .sort((a, b) => b[0] - a[0])
    .slice(0, 4)
    .map(([n, d]) => `${COLOR_NAMES[d]} ${pct(n, s)}`)
    .join(', ');
  out.push(`| ${COLOR_NAMES[c]} | ${top} |`);
}

// scene categories
const black = pics.filter(({ fb }) => fb.pixels.filter((c) => c === 0).length > fb.pixels.length * 0.3);
const clouds = pics.filter(({ fb }) => fb.pixels.filter((c) => c === 15).length > fb.pixels.length * 0.15);
out.push(
  '',
  '## Scene families',
  '',
  `- Outdoor daytime scenes (blue sky at top): ${outdoor.length}/${pics.length}`,
  `- Dark scenes (>30% black - caves, tunnels, interiors at night): ${black.length} (${black.map((p) => p.id).join(', ')})`,
  `- Cloud-land scenes (>15% white): ${clouds.length} (${clouds.map((p) => p.id).join(', ')})`,
  '',
);
writeFileSync('docs/style-stats.md', out.join('\n'));
console.log(out.join('\n'));
