import { DEFAULT_PEN, plotPen, type Pen } from './brush.ts';
import { agiFill } from './fill.ts';
import { Framebuffer } from './framebuffer.ts';
import { agiLine } from './line.ts';
import type { LineStyle, Op } from './ops.ts';

/** Applies ops one at a time to a framebuffer, holding AGI drawing state between them. */
export class Painter {
  readonly fb: Framebuffer;
  color = 15;
  enabled = false;
  pen: Pen = { ...DEFAULT_PEN };
  /** When set, every pixel any op writes (even white on white) is marked with 1 - used by lint. */
  touched?: Uint8Array;
  /**
   * When set, hears the index of every pixel a line or plot writes (even over the same colour) and
   * every pixel a fill fills, in the current colour; not remaps. Used to record ops for playback.
   */
  onWrite?: (index: number) => void;

  constructor(fb = new Framebuffer()) {
    this.fb = fb;
  }

  private readonly plot = (x: number, y: number) => {
    this.fb.set(x, y, this.color);
    if (!this.fb.inBounds(x, y)) return;
    if (this.touched) this.touched[y * this.fb.width + x] = 1;
    this.onWrite?.(y * this.fb.width + x);
  };

  apply(op: Op): void {
    switch (op.kind) {
      case 'color':
        this.color = op.color & 15;
        this.enabled = true;
        return;
      case 'nocolor':
        this.enabled = false;
        return;
      case 'pen':
        this.pen = { size: op.size & 7, shape: op.shape, splatter: op.splatter };
        return;
      case 'remap':
        // a remap recolours existing pixels; it does not count as painting them (lint relies on this)
        for (let i = 0; i < this.fb.pixels.length; i++) this.fb.pixels[i] = op.map[this.fb.pixels[i]];
        return;
    }
    if (!this.enabled) return;
    const pts = op.points;
    switch (op.kind) {
      case 'line':
        if (pts.length < 2) return;
        if (pts.length === 2) {
          agiLine(pts[0], pts[1], pts[0], pts[1], this.plot);
          return;
        }
        for (let i = 2; i + 1 < pts.length; i += 2) agiLine(pts[i - 2], pts[i - 1], pts[i], pts[i + 1], this.plot);
        return;
      case 'fill': {
        // a fill only turns white pixels another colour, so the pixels it fills are the ones it changes
        const { touched, onWrite } = this;
        const filled = touched || onWrite
          ? (i: number) => {
              if (touched) touched[i] = 1;
              onWrite?.(i);
            }
          : undefined;
        for (let i = 0; i + 1 < pts.length; i += 2) agiFill(this.fb, pts[i], pts[i + 1], this.color, filled);
        return;
      }
      case 'plot':
        for (let i = 0, n = 0; i + 1 < pts.length; i += 2, n++) {
          plotPen(this.pen, pts[i], pts[i + 1], op.textures?.[n] ?? 0, this.plot);
        }
        return;
    }
  }
}

/** Paint a whole op list (or its first `limit` ops) onto a fresh white framebuffer. */
export function execute(ops: readonly Op[], limit = ops.length): Framebuffer {
  const painter = new Painter();
  const n = Math.min(limit, ops.length);
  for (let i = 0; i < n; i++) painter.apply(ops[i]);
  return painter.fb;
}

/** Bytes a line op would take as its AGI opcode (falls back to F6 when relative steps exceed ±7). */
function lineBytes(points: number[], style: LineStyle | undefined): number {
  const n = points.length / 2;
  if (style === 'rel') {
    let fits = true;
    for (let i = 2; i < points.length; i += 2) {
      if (Math.abs(points[i] - points[i - 2]) > 7 || Math.abs(points[i + 1] - points[i - 1]) > 7) fits = false;
    }
    if (fits) return 1 + 2 + (n - 1);
  }
  if (style === 'xcorner' || style === 'ycorner') return 1 + 2 + (n - 1);
  return 1 + points.length;
}

/** Rough size of the op list as AGI PICTURE bytes (remap has no AGI equivalent and counts 0). */
export function estimateAgiBytes(ops: readonly Op[]): number {
  let bytes = 1; // 0xFF terminator
  let splatter = false;
  for (const op of ops) {
    switch (op.kind) {
      case 'color':
        bytes += 2;
        break;
      case 'pen':
        splatter = op.splatter;
        bytes += 2;
        break;
      case 'nocolor':
        bytes += 1;
        break;
      case 'line':
        bytes += lineBytes(op.points, op.style);
        break;
      case 'fill':
        bytes += 1 + op.points.length;
        break;
      case 'plot':
        bytes += 1 + op.points.length + (splatter ? op.points.length / 2 : 0);
        break;
      case 'remap':
        break;
    }
  }
  return bytes;
}
