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
