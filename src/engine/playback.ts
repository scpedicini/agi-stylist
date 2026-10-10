import { Painter } from './execute.ts';
import { Framebuffer, PIC_HEIGHT, PIC_WIDTH } from './framebuffer.ts';
import type { Op } from './ops.ts';

const SIZE = PIC_WIDTH * PIC_HEIGHT;

/** Pixel writes a recording may hold (5 bytes each) before playback gives up on `delay`. */
export const MAX_WRITES = 8_000_000;

/** What each op of a list wrote, found by painting the list once in script order. */
export interface Recording {
  /** Op k's writes are entries start[k] … start[k + 1] - 1 of `pixel` and `color`. */
  start: Int32Array;
  pixel: Int32Array;
  color: Uint8Array;
}

/**
 * Paint `ops` in script order and note every pixel each op writes and the colour it leaves there:
 * lines and plots every pixel they draw (even over the same colour), fills every pixel they fill,
 * and remaps every pixel they recolour. Null if that comes to more than `limit` writes.
 */
export function record(ops: readonly Op[], limit = MAX_WRITES): Recording | null {
  const painter = new Painter();
  let pixel = new Int32Array(1 << 14);
  let color = new Uint8Array(1 << 14);
  let n = 0;
  let over = false;
  const push = (i: number, c: number) => {
    if (n === pixel.length) {
      if (n >= limit) {
        over = true;
        return;
      }
      const size = Math.min(n * 2, limit);
      const p = new Int32Array(size);
      p.set(pixel);
      pixel = p;
      const c2 = new Uint8Array(size);
      c2.set(color);
      color = c2;
    }
    pixel[n] = i;
    color[n++] = c;
  };
  painter.onWrite = (i) => push(i, painter.color);
  const start = new Int32Array(ops.length + 1);
  for (let k = 0; k < ops.length && !over; k++) {
    start[k] = n;
    const op = ops[k];
    if (op.kind !== 'remap') {
      painter.apply(op);
      continue;
    }
    const before = painter.fb.pixels.slice();
    painter.apply(op);
    const after = painter.fb.pixels;
    for (let i = 0; i < SIZE; i++) if (after[i] !== before[i]) push(i, after[i]);
  }
  if (over) return null;
  start[ops.length] = n;
  return { start, pixel: pixel.slice(0, n), color: color.slice(0, n) };
}

/**
 * The order the viewer plays ops in: by `delay` level (none is 0), and in script order within a
 * level. Returns op indices.
 */
export function playOrder(ops: readonly Op[]): Int32Array {
  const order = Int32Array.from(ops.keys());
  if (ops.some((op) => op.delay)) order.sort((a, b) => (ops[a].delay ?? 0) - (ops[b].delay ?? 0) || a - b);
  return order;
}

const STATE_ONLY = new Set<Op['kind']>(['color', 'nocolor', 'pen']);

/**
 * Where each instruction starts, as positions in the play order (ascending, from 0, with the op
 * count at the end). An instruction is one run of a scene statement: consecutive ops with the same
 * `src.instr` (an op without one is an instruction of its own). A run that only sets the colour or
 * the pen joins the run after it (or, at the very end, the one before), so every instruction paints
 * something. Turtle moves on one line are merged into one AGI line op even across loop iterations,
 * so such a path is one instruction.
 */
export function instructionMarks(ops: readonly Op[], order: Int32Array): Int32Array {
  const marks: number[] = [];
  let stateOnly = false;
  for (let p = 0; p < order.length; p++) {
    const op = ops[order[p]];
    const id = op.src?.instr;
    if (p === 0 || id === undefined || id !== ops[order[p - 1]].src?.instr) {
      // a new run: it starts an instruction unless the run before it only set state
      if (p === 0 || !stateOnly) marks.push(p);
      stateOnly = true;
    }
    if (!STATE_ONLY.has(op.kind)) stateOnly = false;
  }
  // the last instruction only sets state: it belongs to the one before it
  if (stateOnly && marks.length > 1) marks.pop();
  marks.push(order.length);
  return Int32Array.from(marks);
}

/**
 * Plays an op list one op at a time onto a framebuffer, in `playOrder`.
 *
 * Stacking always follows script order: every pixel shows the colour of the latest op in the script
 * that has played and wrote it, so an op held back by `delay` only shows where nothing after it in
 * the script has painted (it fills in behind). Any played line, plot or fill marks the pixels it
 * wrote as painted (`touched`) even where a later op's colour wins; a remap recolours without
 * painting. Once every op has played, the picture is exactly `execute(ops)`.
 *
 * A list without delays plays straight through a `Painter`, exactly as `execute` paints it. One with
 * delays is recorded first (see `record`); if that would be too big, the delays are ignored
 * (`delaysIgnored`) and it plays in script order.
 */
export class Playback {
  readonly ops: readonly Op[];
  /** Play position → op index. */
  readonly order: Int32Array;
  /** See instructionMarks. */
  readonly marks: Int32Array;
  /** What has been played so far. */
  readonly fb = new Framebuffer();
  /** 1 for every pixel a played line, plot or fill has written. */
  readonly touched = new Uint8Array(SIZE);
  /** The list has delays, but too many pixel writes to record them, so it plays in script order. */
  readonly delaysIgnored: boolean;
  /** With delays: what each op wrote, and per pixel the script index of the op it shows (-1: none). */
  private readonly rec: Recording | null;
  private readonly owner: Int32Array | null;
  /** Without: the painter, painting into `fb`. */
  private painter!: Painter;
  private pos = 0;

  /** `recorded` plays from a recording even without delays (for tests). */
  constructor(ops: readonly Op[], opts: { recorded?: boolean } = {}) {
    this.ops = ops;
    const delayed = ops.some((op) => op.delay);
    this.rec = delayed || opts.recorded ? record(ops) : null;
    this.delaysIgnored = delayed && !this.rec;
    this.owner = this.rec ? new Int32Array(SIZE) : null;
    this.order = this.rec ? playOrder(ops) : Int32Array.from(ops.keys());
    this.marks = instructionMarks(ops, this.order);
    this.reset();
  }

  get position(): number {
    return this.pos;
  }

  get length(): number {
    return this.ops.length;
  }

  get done(): boolean {
    return this.pos >= this.ops.length;
  }

  /** The op played last (its source line is the one to highlight). */
  get last(): Op | undefined {
    return this.pos > 0 ? this.ops[this.order[this.pos - 1]] : undefined;
  }

  /** Back to before the first op: a blank (all white, untouched) picture. */
  reset(): void {
    this.fb.clear();
    this.touched.fill(0);
    this.owner?.fill(-1);
    this.painter = new Painter(this.fb);
    this.painter.touched = this.touched;
    this.pos = 0;
  }

  /** Play one op. */
  step(): void {
    if (this.done) return;
    const k = this.order[this.pos++];
    if (!this.rec || !this.owner) {
      this.painter.apply(this.ops[k]);
      return;
    }
    const { start, pixel, color } = this.rec;
    const paints = this.ops[k].kind !== 'remap';
    const px = this.fb.pixels;
    const owner = this.owner;
    for (let w = start[k]; w < start[k + 1]; w++) {
      const p = pixel[w];
      if (paints) this.touched[p] = 1;
      if (k >= owner[p]) {
        owner[p] = k;
        px[p] = color[w];
      }
    }
  }

  /**
   * Play to the end of the next instruction. Stopped partway through one (paused mid-rect), that is
   * the end of the one under way.
   */
  stepInstruction(): void {
    this.seek(this.nextMark(this.pos));
  }

  /** Go back to the start of the instruction played last (partway through one, to its start). */
  backInstruction(): void {
    if (this.pos > 0) this.seek(this.prevMark(this.pos));
  }

  /** Show the first `n` ops played (replaying from the start when going back). */
  seek(n: number): void {
    n = Math.max(0, Math.min(n, this.ops.length));
    if (n < this.pos) this.reset();
    while (this.pos < n) this.step();
  }

  finish(): void {
    this.seek(this.ops.length);
  }

  /** The first instruction start after `p` (the op count if none). */
  private nextMark(p: number): number {
    for (const m of this.marks) if (m > p) return m;
    return this.ops.length;
  }

  /** The last instruction start before `p` (0 if none). */
  private prevMark(p: number): number {
    let best = 0;
    for (const m of this.marks) {
      if (m >= p) break;
      best = m;
    }
    return best;
  }
}
