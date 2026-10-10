// Generates the site's icons and link-preview images into public/:
//
//   pnpm social
//
//   favicon.svg, favicon.ico (16-256), favicon-192x192.png, apple-touch-icon.png
//       a paintbrush in EGA colours on the viewer's black-and-red panel, drawn on a 16×16 grid
//   social/og-1200x630.png (Open Graph, 1.91:1) and social/x-1200x600.png (X's 2:1 large card)
//       the title screen's picture with a few lines written on its scroll in the BIOS font, as the
//       title screen writes its credits
//
// The images are committed; rerun after changing the title picture, the icon or the scroll text.
// The page links the previews with a hash of each file in the URL (vite.config.ts), so the platforms
// that cache previews by URL fetch new ones by themselves. Needs ImageMagick 7 (`magick`).
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { WELCOME } from '../src/app/welcome/config.ts';
import { GLYPH_SIZE, glyph } from '../src/app/welcome/font.ts';
import { execute } from '../src/engine/execute.ts';
import { PIC_HEIGHT, PIC_WIDTH } from '../src/engine/framebuffer.ts';
import { EGA_PALETTE } from '../src/engine/palette.ts';
import { compile } from '../src/lang/index.ts';

const OUT = 'public';
const tmp = mkdtempSync(join(tmpdir(), 'social-'));
const magick = (...args: string[]) => execFileSync('magick', args, { stdio: 'inherit' });

function writePng(path: string, width: number, height: number, rgb: (x: number, y: number) => readonly number[]) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = rgb(x, y);
      png.data.set([r, g, b, 255], (y * width + x) * 4);
    }
  }
  writeFileSync(path, PNG.sync.write(png));
}

// ---------------------------------------------------------------- the icon
// A paintbrush with blue paint on its tip, on the viewer's black panel with its red frame.
// R red, K black, b brown, g light grey, W white, B blue, L light blue.
const ICON = [
  'RRRRRRRRRRRRRRRR',
  'RKKKKKKKKKKKKKKR',
  'RKKKKKKKKKKKKBKR',
  'RKKKKKKKKKKKBBLR',
  'RKKKKKKKKKKBBLKR',
  'RKKKKKKKKKWWLKKR',
  'RKKKKKKKKWWWKKKR',
  'RKKKKKKKggWKKKKR',
  'RKKKKKKgggKKKKKR',
  'RKKKKKbbgKKKKKKR',
  'RKKKKbbbKKKKKKKR',
  'RKKKbbbKKKKKKKKR',
  'RKKbbbKKKKKKKKKR',
  'RKbbbKKKKKKKKKKR',
  'RKbbKKKKKKKKKKKR',
  'RRRRRRRRRRRRRRRR',
];
const ICON_COLORS: Record<string, number> = { R: 4, K: 0, b: 6, g: 7, W: 15, B: 1, L: 9 };
const hex = (c: number) => '#' + EGA_PALETTE[c].map((v) => v.toString(16).padStart(2, '0')).join('');

/** The icon as an SVG of crisp squares, one rect per run of a colour along a row. */
function iconSvg(): string {
  const rects: string[] = [];
  ICON.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      let x1 = x;
      while (x1 + 1 < row.length && row[x1 + 1] === row[x]) x1++;
      if (row[x] !== 'K') rects.push(`<rect x="${x}" y="${y}" width="${x1 - x + 1}" height="1" fill="${hex(ICON_COLORS[row[x]])}"/>`);
      x = x1 + 1;
    }
  });
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">',
    `<rect width="16" height="16" fill="${hex(0)}"/>`,
    ...rects,
    '</svg>',
    '',
  ].join('\n');
}

/** The icon at `scale`× (nearest neighbour), centred on a black square of side `size`; `frame` false drops the red border. */
function iconPng(path: string, scale: number, size = 16 * scale, frame = true) {
  const pad = Math.floor((size - 16 * scale) / 2);
  writePng(path, size, size, (x, y) => {
    const gx = Math.floor((x - pad) / scale);
    const gy = Math.floor((y - pad) / scale);
    let ch = ICON[gy]?.[gx] ?? 'K';
    if (!frame && ch === 'R') ch = 'K';
    return EGA_PALETTE[ICON_COLORS[ch]];
  });
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'favicon.svg'), iconSvg());
const icoSizes = [16, 32, 48, 64, 256];
for (const s of icoSizes) iconPng(join(tmp, `icon-${s}.png`), s / 16);
magick(...icoSizes.map((s) => join(tmp, `icon-${s}.png`)), join(OUT, 'favicon.ico'));
// home-screen icons get their corners rounded (iOS) or cut to a circle (Android), which would
// clip the red frame, so these are the brush on black with a margin
iconPng(join(OUT, 'favicon-192x192.png'), 10, 192, false);
iconPng(join(OUT, 'apple-touch-icon.png'), 10, 180, false);

// ---------------------------------------------------------------- the link previews
/** Written on the scroll, centred (each line at most WELCOME.text.columns characters). Run through the humanizer skill. */
const SCROLL_TEXT = "Pictures drawn\nfrom code, the\nway Sierra drew\nKing's Quest\nin 1984";

const prelude = readFileSync('src/lang/stdlib.pic', 'utf8');
const fb = execute(compile(readFileSync('src/app/welcome/title.pic', 'utf8'), { file: 'src/app/welcome/title.pic', prelude }).ops);
const SCREEN_WIDTH = PIC_WIDTH * 2;
const screen = new Uint8Array(SCREEN_WIDTH * PIC_HEIGHT); // EGA colour per screen pixel
for (let y = 0; y < PIC_HEIGHT; y++) for (let x = 0; x < SCREEN_WIDTH; x++) screen[y * SCREEN_WIDTH + x] = fb.get(x >> 1, y);

// the text, centred in the text area and in the scroll's height, only on the scroll's black
const { scroll, text } = WELCOME;
const lines = SCROLL_TEXT.split('\n').map((l) => ' '.repeat(Math.floor((text.columns - l.length) / 2)) + l);
const top = scroll.top + Math.floor((scroll.bottom - scroll.top + 1 - lines.length * GLYPH_SIZE) / 2);
lines.forEach((line, row) => {
  for (let c = 0; c < line.length; c++) {
    const bits = glyph(line[c]);
    for (let gy = 0; gy < GLYPH_SIZE; gy++) {
      for (let gx = 0; gx < GLYPH_SIZE; gx++) {
        if (!(bits[gy] & (0x80 >> gx))) continue;
        const x = (text.leftColumn + c) * GLYPH_SIZE + gx;
        const y = top + row * GLYPH_SIZE + gy;
        if (y < scroll.top || y > scroll.bottom || x >> 1 < scroll.left || x >> 1 > scroll.right) continue;
        if (fb.get(x >> 1, y) === 0) screen[y * SCREEN_WIDTH + x] = 15;
      }
    }
  }
});
const titlePng = join(tmp, 'title.png');
writePng(titlePng, SCREEN_WIDTH, PIC_HEIGHT, (x, y) => EGA_PALETTE[screen[y * SCREEN_WIDTH + x]]);

// 320×168 is 1.905:1, Open Graph's own ratio: scaled to 1200×630 it fills the card exactly. X's
// card is 2:1, so there the picture keeps its height and sits on black.
mkdirSync(join(OUT, 'social'), { recursive: true });
magick(titlePng, '-filter', 'point', '-resize', '1200x630!', '-strip', join(OUT, 'social', 'og-1200x630.png'));
magick(titlePng, '-filter', 'point', '-resize', '1143x600!', '-background', hex(0), '-gravity', 'center', '-extent', '1200x600', '-strip', join(OUT, 'social', 'x-1200x600.png'));

rmSync(tmp, { recursive: true, force: true });
console.log('wrote public/favicon.svg, favicon.ico, favicon-192x192.png, apple-touch-icon.png, social/og-1200x630.png, social/x-1200x600.png');
