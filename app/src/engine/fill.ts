import type { Framebuffer } from './framebuffer.ts';
import { WHITE } from './palette.ts';

/**
 * AGI flood fill on the visual screen: starting at (x, y), replace the 4-connected
 * area of white pixels with `color`. Filling with white, or from a non-white seed,
 * does nothing - exactly as in AGI, where the canvas is white and fills only spread
 * into unpainted pixels. `onPaint` hears the index of every pixel it fills.
 */
export function agiFill(fb: Framebuffer, x: number, y: number, color: number, onPaint?: (index: number) => void): number {
  if (color === WHITE || !fb.inBounds(x, y) || fb.get(x, y) !== WHITE) return 0;
  const { width, height, pixels } = fb;
  const fillable = (px: number, py: number) => px >= 0 && py >= 0 && px < width && py < height && pixels[py * width + px] === WHITE;

  let painted = 0;
  const stack: number[] = [x, y];
  while (stack.length) {
    const py = stack.pop()!;
    const px = stack.pop()!;
    if (!fillable(px, py)) continue;
    let c = px - 1;
    while (fillable(c, py)) c--;
    let spanUp = true;
    let spanDown = true;
    for (c++; fillable(c, py); c++) {
      pixels[py * width + c] = color;
      onPaint?.(py * width + c);
      painted++;
      if (fillable(c, py - 1)) {
        if (spanUp) {
          stack.push(c, py - 1);
          spanUp = false;
        }
      } else spanUp = true;
      if (fillable(c, py + 1)) {
        if (spanDown) {
          stack.push(c, py + 1);
          spanDown = false;
        }
      } else spanDown = true;
    }
  }
  return painted;
}

/**
 * The VGA flood fill: like agiFill it only spreads into white (unpainted) pixels, 4-connected, but
 * each pixel takes `colorAt(x, y)` (a dither or gradient may put white back), so it keeps its own
 * record of the pixels it has visited.
 */
export function vgaFill(fb: Framebuffer, x: number, y: number, colorAt: (x: number, y: number) => number, onPaint?: (index: number) => void): number {
  if (!fb.inBounds(x, y) || fb.get(x, y) !== WHITE) return 0;
  const { width, height, pixels } = fb;
  const seen = new Uint8Array(width * height);
  const stack: number[] = [y * width + x];
  seen[y * width + x] = 1;
  let painted = 0;
  while (stack.length) {
    const i = stack.pop()!;
    const px = i % width;
    const py = (i - px) / width;
    pixels[i] = colorAt(px, py);
    onPaint?.(i);
    painted++;
    const visit = (j: number) => {
      if (!seen[j] && pixels[j] === WHITE) {
        seen[j] = 1;
        stack.push(j);
      }
    };
    if (px > 0) visit(i - 1);
    if (px < width - 1) visit(i + 1);
    if (py > 0) visit(i - width);
    if (py < height - 1) visit(i + width);
  }
  return painted;
}
