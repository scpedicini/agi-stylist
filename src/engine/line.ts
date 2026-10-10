import { PIC_HEIGHT, PIC_WIDTH } from './framebuffer.ts';

export type Plot = (x: number, y: number) => void;

const clip = (v: number, max: number) => (v < 0 ? 0 : v > max ? max : v);

/**
 * Sierra AGI line rasterizer. Endpoints are clipped to the picture, then the line is
 * stepped with the error-accumulator scheme the original interpreter used (as
 * documented by the AGI specs and reproduced by Sarien/NAGI/ScummVM).
 */
export function agiLine(x1: number, y1: number, x2: number, y2: number, plot: Plot): void {
  x1 = clip(x1, PIC_WIDTH - 1);
  x2 = clip(x2, PIC_WIDTH - 1);
  y1 = clip(y1, PIC_HEIGHT - 1);
  y2 = clip(y2, PIC_HEIGHT - 1);

  if (x1 === x2) {
    const [a, b] = y1 <= y2 ? [y1, y2] : [y2, y1];
    for (let y = a; y <= b; y++) plot(x1, y);
    return;
  }
  if (y1 === y2) {
    const [a, b] = x1 <= x2 ? [x1, x2] : [x2, x1];
    for (let x = a; x <= b; x++) plot(x, y1);
    return;
  }

  let stepX = 1;
  let deltaX = x2 - x1;
  if (deltaX < 0) {
    stepX = -1;
    deltaX = -deltaX;
  }
  let stepY = 1;
  let deltaY = y2 - y1;
  if (deltaY < 0) {
    stepY = -1;
    deltaY = -deltaY;
  }

  let i: number, detdelta: number, errorX: number, errorY: number;
  if (deltaY > deltaX) {
    i = deltaY;
    detdelta = deltaY;
    errorX = deltaY >> 1;
    errorY = 0;
  } else {
    i = deltaX;
    detdelta = deltaX;
    errorX = 0;
    errorY = deltaX >> 1;
  }

  let x = x1;
  let y = y1;
  plot(x, y);
  do {
    errorY += deltaY;
    if (errorY >= detdelta) {
      errorY -= detdelta;
      y += stepY;
    }
    errorX += deltaX;
    if (errorX >= detdelta) {
      errorX -= detdelta;
      x += stepX;
    }
    plot(x, y);
    i--;
  } while (i > 0);
}

/** The pixels an AGI line covers, in drawing order (may contain no duplicates). */
export function linePixels(x1: number, y1: number, x2: number, y2: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  agiLine(x1, y1, x2, y2, (x, y) => out.push([x, y]));
  return out;
}
