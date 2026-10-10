import type { PenShape } from './brush.ts';

/** Where an op came from in PicScript source (1-based). */
export interface SourceRef {
  file: string;
  line: number;
  col: number;
  /**
   * Which run of a scene statement painted it: the compiler numbers every statement it runs at the
   * scene's top level (each loop iteration again; a function call is one). Consecutive ops with the
   * same number are one instruction, what the viewer's +1 steps over.
   */
  instr?: number;
}

/**
 * Paint operations. These mirror AGI PICTURE opcodes (F0 colour, F1 colour off,
 * F6/F7/F4/F5 lines → `line`, F8 fill, F9 pen, FA plot), plus `remap`, a PicScript
 * extension that recolours the picture painted so far (used for day/night variants).
 */
export type Op = (
  | { kind: 'color'; color: number }
  | { kind: 'nocolor' }
  /**
   * Polyline through absolute flat [x0,y0,x1,y1,…]; a single point plots one pixel.
   * `style` records which AGI opcode the line came from (F6 absolute, F7 relative,
   * F5 x-corner, F4 y-corner) - the pixels are identical, only the encoding differs.
   */
  | { kind: 'line'; points: number[]; style?: LineStyle }
  | { kind: 'fill'; points: number[] }
  | { kind: 'pen'; size: number; shape: PenShape; splatter: boolean }
  /** Pen stamps at [x0,y0,…]. `textures` has one entry per point when the pen is splatter. */
  | { kind: 'plot'; points: number[]; textures?: number[] }
  /** 16-entry table mapping old colour → new colour. */
  | { kind: 'remap'; map: number[] }
) & {
  src?: SourceRef;
  /**
   * Set by a PicScript `delay n { … }` block: the viewer plays the op after every op of a lower
   * level (none is level 0). It changes only when the op is shown, never the picture: stacking
   * stays in script order (see engine/playback.ts).
   */
  delay?: number;
};

export type OpKind = Op['kind'];

export type LineStyle = 'abs' | 'rel' | 'xcorner' | 'ycorner';
