// Verify reference/kq1/*.png against design/kq1bgs.png: every tile must be the exact
// left column of each doubled pixel pair, in the 16 EGA colours.
import { readdirSync } from 'node:fs';
import { readPicturePng, readPng } from './lib/png.ts';
import { rgbToIndex } from '../src/engine/palette.ts';

const sheet = readPng('design/kq1bgs.png');
const files = readdirSync('reference/kq1').filter((f) => f.endsWith('.png')).sort();
let bad = 0;
for (const f of files) {
  const [, r, c] = /^r(\d+)-c(\d+)\.png$/.exec(f)!.map(Number);
  const fb = readPicturePng(`reference/kq1/${f}`);
  for (let y = 0; y < 168; y++) {
    for (let x = 0; x < 160; x++) {
      for (const dx of [0, 1]) {
        const o = ((r - 1) * 168 + y) * sheet.width * 4 + ((c - 1) * 320 + x * 2 + dx) * 4;
        const idx = rgbToIndex(sheet.data[o], sheet.data[o + 1], sheet.data[o + 2]);
        if (idx !== fb.get(x, y)) bad++;
      }
    }
  }
}
console.log(`${files.length} tiles checked, ${bad} mismatched pixels`);
if (files.length !== 82 || bad) process.exit(1);
