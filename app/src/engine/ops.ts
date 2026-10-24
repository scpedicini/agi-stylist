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
 * A VGA colour pattern: each pixel takes one of `colors`, chosen by a 4×4 ordered (Bayer) dither
 * of a position t (0 … 1) along them. `t` fixed is a plain dither of two colours; otherwise t is
 * how far the pixel is from (x1, y1) towards (x2, y2) (linear), or from (x1, y1) out to the
 * distance of (x2, y2) (radial).
 */
export interface Pattern {
  colors: number[];
  t?: number;
  kind?: 'linear' | 'radial';
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
}

/**
 * Paint operations. These mirror AGI PICTURE opcodes (F0 colour, F1 colour off,
 * F6/F7/F4/F5 lines → `line`, F8 fill, F9 pen, FA plot), plus `remap`, a PicScript
 * extension that recolours the picture painted so far (used for day/night variants).
 * `screen`, `glow`, colour patterns and remap regions only appear in `mode vga` scenes.
 */
export type Op = (
  | { kind: 'color'; color: number; pattern?: Pattern }
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
  /**
   * Table mapping old colour → new colour (16 entries; 256 in VGA). `spans` (VGA) limits it to
   * the pixels of [y, x1, x2] row runs, flattened.
   */
  | { kind: 'remap'; map: number[]; spans?: number[] }
  /**
   * VGA only, always the first op: the picture's size and its palette (index → RGB; the palette is
   * complete once the scene has compiled).
   */
  | { kind: 'screen'; mode: 'vga'; width: number; height: number; palette: Array<[number, number, number]> }
  /**
   * VGA only: a pool of light (or shadow) in the ellipse (cx, cy, rx, ry). Each pixel inside gets a
   * level from 0 (rim) up to maps.length (centre), dithered between steps (see glowLevel), and
   * level k > 0 recolours it through maps[k - 1].
   */
  | { kind: 'glow'; cx: number; cy: number; rx: number; ry: number; maps: number[][] }
  /**
   * VGA only: set palette entries, flattened [index, r, g, b, …]. Every pixel of those colours
   * changes at once (how VGA games faded to night), and no new colours are used.
   */
  | { kind: 'palette'; entries: number[] }
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
