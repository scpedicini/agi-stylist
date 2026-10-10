// The title screen: its retitled picture, the credits' layout and the transcribed music.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readPicturePng } from '../../scripts/lib/png.ts';
import { execute } from '../../src/engine/execute.ts';
import { PIC_HEIGHT, PIC_WIDTH } from '../../src/engine/framebuffer.ts';
import { compile } from '../../src/lang/index.ts';
import { WELCOME } from '../../src/app/welcome/config.ts';
import { glyph } from '../../src/app/welcome/font.ts';
import { TEMPO_BPM, VOICES } from '../../src/app/welcome/music.ts';
import { creditLines, wrap } from '../../src/app/welcome/welcome.ts';

describe('title picture', () => {
  it('is KQ1 r07-c09 exactly, apart from the lettering on the left half of the ribbon', () => {
    const src = readFileSync('src/app/welcome/title.pic', 'utf8');
    const prelude = readFileSync('src/lang/stdlib.pic', 'utf8');
    const fb = execute(compile(src, { file: 'title.pic', prelude }).ops);
    const ref = readPicturePng('reference/kq1/r07-c09.png');
    // only "KING'S" was relettered (as "PAINT"); "QUEST" is the original, so it must match too
    const lettering = (x: number, y: number) => y >= 9 && y <= 41 && x >= 22 && x <= 73;
    let outside = 0;
    let inside = 0;
    for (let y = 0; y < PIC_HEIGHT; y++) {
      for (let x = 0; x < PIC_WIDTH; x++) {
        if (fb.get(x, y) === ref.get(x, y)) continue;
        if (lettering(x, y)) inside++;
        else outside++;
      }
    }
    expect(outside).toBe(0);
    expect(inside).toBeGreaterThan(100); // the left half does say something else
    // and it's the approved "PAINT": a fingerprint of the box's pixels (update it when relettering)
    let hash = 0x811c9dc5;
    for (let y = 9; y <= 41; y++) for (let x = 22; x <= 73; x++) hash = Math.imul(hash ^ fb.get(x, y), 0x01000193) >>> 0;
    expect(hash.toString(16)).toBe('b26f7c61');
  });
});

describe('credits', () => {
  it('wraps words to the width, splitting only words that are too long', () => {
    expect(wrap('the quick brown fox jumps', 10)).toEqual(['the quick', 'brown fox', 'jumps']);
    expect(wrap('a\nb c', 10)).toEqual(['a', 'b c']);
    expect(wrap('abcdefghijkl', 5)).toEqual(['abcde', 'fghij', 'kl']);
  });

  it('fit the text area on the scroll, in characters the font has', () => {
    const lines = creditLines();
    expect(lines.length).toBeGreaterThan(20);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(WELCOME.text.columns);
      expect(line).toMatch(/^[\x20-\x7e]*$/);
    }
    expect(lines[0].trim()).toBe('Welcome to');
    expect(lines[0].length - lines[0].trimStart().length).toBe(Math.floor((WELCOME.text.columns - 10) / 2)); // credits are centred
  });
});

describe('text area', () => {
  it("lies on the scroll's black in every row, so no credit is ever clipped at the sides", () => {
    const src = readFileSync('src/app/welcome/title.pic', 'utf8');
    const prelude = readFileSync('src/lang/stdlib.pic', 'utf8');
    const fb = execute(compile(src, { file: 'title.pic', prelude }).ops);
    const { leftColumn, columns } = WELCOME.text;
    // a column is 8 screen pixels = 4 picture pixels
    const x0 = leftColumn * 4;
    const x1 = (leftColumn + columns) * 4 - 1;
    expect(x0).toBeGreaterThanOrEqual(WELCOME.scroll.left);
    expect(x1).toBeLessThanOrEqual(WELCOME.scroll.right);
    for (let y = WELCOME.scroll.top; y <= WELCOME.scroll.bottom; y++) {
      for (let x = x0; x <= x1; x++) expect(fb.get(x, y), `${x},${y}`).toBe(0);
    }
  });
});

describe('font', () => {
  it('has the BIOS 8x8 glyphs', () => {
    expect(glyph(' ')).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    // "A": 0x30 0x78 0xcc 0xcc 0xfc 0xcc 0xcc 0x00
    expect(glyph('A')).toEqual([0x30, 0x78, 0xcc, 0xcc, 0xfc, 0xcc, 0xcc, 0x00]);
    expect(glyph('é')).toEqual(glyph('?'));
  });
});

describe('music', () => {
  it('has voices of equal length, so they stay together when the tune loops', () => {
    const lengths = VOICES.map((v) => v.reduce((sum, [, beats]) => sum + beats, 0));
    expect(new Set(lengths).size).toBe(1);
    expect(lengths[0] % 3).toBe(0); // whole bars of 3/4
    expect(TEMPO_BPM).toBeGreaterThan(0);
    for (const v of VOICES) for (const [midi, beats] of v) {
      expect(beats).toBeGreaterThan(0);
      if (midi !== null) expect(midi).toBeGreaterThanOrEqual(36);
    }
  });
});
