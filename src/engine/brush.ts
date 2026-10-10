import { PIC_HEIGHT, PIC_WIDTH } from './framebuffer.ts';
import type { Plot } from './line.ts';

export type PenShape = 'circle' | 'rect';

export interface Pen {
  /** 0-7. Size 0 is a single pixel. */
  size: number;
  shape: PenShape;
  /** When true, each plot uses a pseudo-random "splatter" texture instead of a solid shape. */
  splatter: boolean;
}

export const DEFAULT_PEN: Pen = { size: 0, shape: 'circle', splatter: false };

/** Highest texture number (0-119) - the AGI texture byte is `n << 1` and must stay below 0xF0. */
export const MAX_TEXTURE = 119;

const BINARY_LIST = [
  0x8000, 0x4000, 0x2000, 0x1000, 0x800, 0x400, 0x200, 0x100, 0x80, 0x40, 0x20, 0x10, 0x8, 0x4, 0x2, 0x1,
];

// Row bitmaps for each circular pen size, from the AGI interpreter's brush table.
const CIRCLE_LIST = [0, 1, 4, 9, 16, 25, 37, 50];
const CIRCLE_DATA = [
  0x8000,
  0x0000, 0xe000, 0x0000,
  0x7000, 0xf800, 0xf800, 0xf800, 0x7000,
  0x3800, 0x7c00, 0xfe00, 0xfe00, 0xfe00, 0x7c00, 0x3800,
  0x1c00, 0x7f00, 0xff80, 0xff80, 0xff80, 0xff80, 0xff80, 0x7f00, 0x1c00,
  0x0e00, 0x3f80, 0x7fc0, 0x7fc0, 0xffe0, 0xffe0, 0xffe0, 0x7fc0, 0x7fc0, 0x3f80, 0x1f00, 0x0e00,
  0x0f80, 0x3fe0, 0x7ff0, 0x7ff0, 0xfff8, 0xfff8, 0xfff8, 0xfff8, 0xfff8, 0x7ff0, 0x7ff0, 0x3fe0, 0x0f80,
  0x07c0, 0x1ff0, 0x3ff8, 0x7ffc, 0x7ffc, 0xfffe, 0xfffe, 0xfffe, 0xfffe, 0xfffe, 0x7ffc, 0x7ffc, 0x3ff8, 0x1ff0, 0x07c0,
];

/**
 * Stamp the pen centred near (x, y), reproducing AGI's brush plot: the shape is
 * (size+1) logical pixels wide and (2·size+1) tall (logical pixels are double-wide),
 * clamped inside the picture. Splatter pens gate each pixel with an 8-bit LFSR seeded
 * from the texture number.
 */
export function plotPen(pen: Pen, x: number, y: number, texture: number, plot: Plot): void {
  const size = pen.size & 7;
  let rowPtr = CIRCLE_LIST[size];

  let penX = x * 2 - size;
  if (penX < 0) penX = 0;
  const maxX = PIC_WIDTH * 2 - 2 * size;
  if (penX >= maxX) penX = maxX;
  penX >>= 1;
  const startX = penX;

  let penY = y - size;
  if (penY < 0) penY = 0;
  const maxY = PIC_HEIGHT - 1 - 2 * size;
  if (penY >= maxY) penY = maxY;
  const endY = penY + size * 2 + 1;
  const penWidth = (size * 2 + 1) * 2;

  let t = ((texture & 0x7f) << 1) | 1;
  for (; penY < endY; penY++) {
    const rowBits = CIRCLE_DATA[rowPtr++];
    for (let counter = 0; counter <= penWidth; counter += 4) {
      if (pen.shape === 'rect' || (BINARY_LIST[counter >> 1] & rowBits) !== 0) {
        if (pen.splatter) {
          const bit = t & 1;
          t >>= 1;
          if (bit) t ^= 0xb8;
        }
        if (!pen.splatter || (t & 3) === 2) plot(penX, penY);
      }
      penX++;
    }
    penX = startX;
  }
}
