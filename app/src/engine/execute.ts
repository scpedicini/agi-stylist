import { DEFAULT_PEN, plotPen, plotPenSquare, type Pen } from './brush.ts';
import { agiFill, vgaFill } from './fill.ts';
import { AGI_SCREEN, Framebuffer, type Screen } from './framebuffer.ts';
import { agiLine } from './line.ts';
import type { LineStyle, Op, Pattern } from './ops.ts';
import { glowLevel, patternColor } from './pattern.ts';

/** The picture an op list paints: VGA when it starts with a `screen` op, else AGI's 160×168 EGA. */
export function screenOf(ops: readonly Op[]): Screen {
  const first = ops[0];
  if (first?.kind !== 'screen') return AGI_SCREEN;
  return { mode: 'vga', width: first.width, height: first.height, aspect: 1, palette: first.palette };
}

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
   * every pixel a fill fills, with the colour it wrote; not remaps. Used to record ops for playback.
   */
  onWrite?: (index: number, color: number) => void;
  /** VGA: the dither or gradient the current colour paints with, if any. */
  pattern?: Pattern;
  private readonly vga: boolean;

  constructor(fb = new Framebuffer()) {
    this.fb = fb;
    this.vga = fb.screen.mode === 'vga';
  }

  /** The colour the pen puts on (x, y): the current colour, or its pattern's colour there. */
  colorAt = (x: number, y: number): number => (this.pattern ? patternColor(this.pattern, x, y) : this.color);

  private readonly plot = (x: number, y: number) => {
    const c = this.pattern ? patternColor(this.pattern, x, y) : this.color;
    this.fb.set(x, y, c);
    if (!this.fb.inBounds(x, y)) return;
    if (this.touched) this.touched[y * this.fb.width + x] = 1;
    this.onWrite?.(y * this.fb.width + x, c);
  };

  apply(op: Op): void {
    switch (op.kind) {
      case 'color':
        this.color = op.color & (this.vga ? 255 : 15);
        this.pattern = this.vga ? op.pattern : undefined;
        this.enabled = true;
        return;
      case 'nocolor':
        this.enabled = false;
        return;
      case 'pen':
        this.pen = { size: op.size & 7, shape: op.shape, splatter: op.splatter };
        return;
      case 'remap': {
        // a remap recolours existing pixels; it does not count as painting them (lint relies on this)
        const px = this.fb.pixels;
        if (!op.spans) {
          for (let i = 0; i < px.length; i++) px[i] = op.map[px[i]];
          return;
        }
        const w = this.fb.width;
        for (let k = 0; k + 2 < op.spans.length; k += 3) {
          const row = op.spans[k] * w;
          for (let x = op.spans[k + 1]; x <= op.spans[k + 2]; x++) px[row + x] = op.map[px[row + x]];
        }
        return;
      }
      case 'glow': {
        // like a remap, a glow recolours without painting
        const { width, height, pixels } = this.fb;
        const steps = op.maps.length;
        const x1 = Math.max(0, Math.floor(op.cx - op.rx));
        const x2 = Math.min(width - 1, Math.ceil(op.cx + op.rx));
        const y1 = Math.max(0, Math.floor(op.cy - op.ry));
        const y2 = Math.min(height - 1, Math.ceil(op.cy + op.ry));
        for (let y = y1; y <= y2; y++) {
          for (let x = x1; x <= x2; x++) {
            const level = glowLevel(op.cx, op.cy, op.rx, op.ry, steps, x, y);
            if (level) pixels[y * width + x] = op.maps[level - 1][pixels[y * width + x]];
          }
        }
        return;
      }
      case 'palette': {
        const e = op.entries;
        for (let k = 0; k + 3 < e.length; k += 4) this.fb.palette[e[k]] = [e[k + 1], e[k + 2], e[k + 3]];
        return;
      }
      case 'screen':
        return;
    }
    if (!this.enabled) return;
    const pts = op.points;
    switch (op.kind) {
      case 'line':
        if (pts.length < 2) return;
        if (pts.length === 2) {
          agiLine(pts[0], pts[1], pts[0], pts[1], this.plot, this.fb.width, this.fb.height);
          return;
        }
        for (let i = 2; i + 1 < pts.length; i += 2) agiLine(pts[i - 2], pts[i - 1], pts[i], pts[i + 1], this.plot, this.fb.width, this.fb.height);
        return;
      case 'fill': {
        // a fill only turns white pixels another colour, so the pixels it fills are the ones it changes
        const { touched, onWrite } = this;
        const filled = touched || onWrite
          ? (i: number) => {
              if (touched) touched[i] = 1;
              onWrite?.(i, this.fb.pixels[i]);
            }
          : undefined;
        if (this.vga) for (let i = 0; i + 1 < pts.length; i += 2) vgaFill(this.fb, pts[i], pts[i + 1], this.colorAt, filled);
        else for (let i = 0; i + 1 < pts.length; i += 2) agiFill(this.fb, pts[i], pts[i + 1], this.color, filled);
        return;
      }
      case 'plot':
        for (let i = 0, n = 0; i + 1 < pts.length; i += 2, n++) {
          if (this.vga) plotPenSquare(this.pen, pts[i], pts[i + 1], op.textures?.[n] ?? 0, this.plot, this.fb.width, this.fb.height);
          else plotPen(this.pen, pts[i], pts[i + 1], op.textures?.[n] ?? 0, this.plot);
        }
        return;
    }
  }
}

/** Paint a whole op list (or its first `limit` ops) onto a fresh white framebuffer. */
export function execute(ops: readonly Op[], limit = ops.length): Framebuffer {
  const painter = new Painter(new Framebuffer(undefined, screenOf(ops)));
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
      case 'screen':
      case 'glow':
      case 'palette':
        break;
    }
  }
  return bytes;
}
