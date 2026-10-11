import { Painter } from './execute.ts';
import { PIC_HEIGHT, PIC_WIDTH } from './framebuffer.ts';
import type { Op, SceneObject } from './ops.ts';
import { WHITE } from './palette.ts';
import { MAX_WRITES, record, type Recording } from './playback.ts';

const SIZE = PIC_WIDTH * PIC_HEIGHT;

/** Ops that paint pixels; hiding an object drops these and keeps its colour and pen changes. */
export const paints = (op: Op): boolean => op.kind === 'line' || op.kind === 'fill' || op.kind === 'plot';

/**
 * What playback needs to show a scene with objects hidden (see Playback's `hiding` option): the
 * recording, every write's baked colour, the canvas colour and which ops are dropped.
 */
export interface Hiding {
  recording: Recording;
  baked: Uint8Array;
  canvas: number;
  /** 1 for each op hidden. */
  suppressed: Uint8Array;
}

/** The picture composed with some objects hidden, and per pixel the op it shows (-1: bare canvas). */
export interface Composition {
  pixels: Uint8Array;
  owner: Int32Array;
}

/** One run of consecutive painting ops with the same innermost object (-1: no object). */
export interface Layer {
  object: number;
  /** Script indices of its first and last op. */
  from: number;
  to: number;
  /** Per pixel: 1 where the run painted (its last write there shows). */
  alpha: Uint8Array;
  /** Per pixel: the colour it shows there (baked; only meaningful where alpha is 1). */
  pixels: Uint8Array;
}

/**
 * A scene's objects and how to show it with any of them hidden.
 *
 * Hiding never re-runs the ops: the picture is composed from what each op wrote in the full
 * picture (`record`), so every op left paints exactly the pixels it painted there. Where a hidden
 * object was, whatever was painted before it shows; a later fill can't spill into the hole. Remaps
 * are folded in by *baking*: each write takes the colour it ends up after every later remap, and
 * the bare canvas the colour white ends up. With nothing hidden this is exactly `execute(ops)`.
 */
export class ObjectModel {
  readonly ops: readonly Op[];
  readonly objects: readonly SceneObject[];
  readonly recording: Recording;
  /** Each recorded write's colour after every later remap (remaps' own writes are unused). */
  readonly baked: Uint8Array;
  /** The colour bare canvas shows: white after every remap. */
  readonly canvas: number;
  private readonly byId = new Map<string, number>();

  private constructor(ops: readonly Op[], objects: readonly SceneObject[], recording: Recording) {
    this.ops = ops;
    this.objects = objects;
    this.recording = recording;
    objects.forEach((o, i) => this.byId.set(o.id, i));
    // walk back from the end, carrying every later remap composed into one table
    let after = Array.from({ length: 16 }, (_, c) => c);
    this.baked = new Uint8Array(recording.color.length);
    for (let k = ops.length - 1; k >= 0; k--) {
      const op = ops[k];
      if (op.kind === 'remap') {
        after = op.map.map((c) => after[c]);
        continue;
      }
      for (let w = recording.start[k]; w < recording.start[k + 1]; w++) this.baked[w] = after[recording.color[w]];
    }
    this.canvas = after[WHITE];
  }

  /** The model of a compiled scene, or null if its recording would be too big (see `record`). */
  static create(ops: readonly Op[], objects: readonly SceneObject[], limit = MAX_WRITES): ObjectModel | null {
    const rec = record(ops, limit);
    return rec ? new ObjectModel(ops, objects, rec) : null;
  }

  /** The object's index, or -1. */
  indexOf(id: string): number {
    return this.byId.get(id) ?? -1;
  }

  /** Is object `o` the object `ancestor` or inside it? */
  within(o: number, ancestor: number): boolean {
    for (let p = o; p >= 0; p = this.objects[p].parent) if (p === ancestor) return true;
    return false;
  }

  /** Per object: 1 if it is hidden, itself or because an object it's inside is. Unknown ids are ignored. */
  hiddenObjects(hidden: Iterable<string | number>): Uint8Array {
    const out = new Uint8Array(this.objects.length);
    for (const h of hidden) {
      const i = typeof h === 'number' ? h : this.indexOf(h);
      if (i >= 0 && i < out.length) out[i] = 1;
    }
    // a parent is always opened (listed) before its children
    for (let i = 0; i < out.length; i++) if (this.objects[i].parent >= 0 && out[this.objects[i].parent]) out[i] = 1;
    return out;
  }

  /** Per op: 1 if hiding `hidden` drops it (a painting op of a hidden object). */
  suppressed(hidden: Iterable<string | number>): Uint8Array {
    const objs = this.hiddenObjects(hidden);
    const out = new Uint8Array(this.ops.length);
    this.ops.forEach((op, k) => {
      if (op.obj !== undefined && objs[op.obj] && paints(op)) out[k] = 1;
    });
    return out;
  }

  /** What Playback needs to play the scene with `hidden` hidden. */
  hiding(hidden: Iterable<string | number>): Hiding {
    return { recording: this.recording, baked: this.baked, canvas: this.canvas, suppressed: this.suppressed(hidden) };
  }

  /** The picture with `hidden` hidden, and the op each pixel shows. */
  compose(hidden: Iterable<string | number> = []): Composition {
    const sup = this.suppressed(hidden);
    const { start, pixel } = this.recording;
    const pixels = new Uint8Array(SIZE).fill(this.canvas);
    const owner = new Int32Array(SIZE).fill(-1);
    for (let k = 0; k < this.ops.length; k++) {
      if (sup[k] || this.ops[k].kind === 'remap') continue;
      for (let w = start[k]; w < start[k + 1]; w++) {
        pixels[pixel[w]] = this.baked[w];
        owner[pixel[w]] = k;
      }
    }
    return { pixels, owner };
  }

  /** The innermost object shown at pixel index `i` of a composition, or -1 (no object there). */
  objectAt(c: Composition, i: number): number {
    const k = c.owner[i];
    return k < 0 ? -1 : (this.ops[k].obj ?? -1);
  }

  /** Per pixel: 1 where object `o` (or something inside it) shows in the composition. */
  visible(c: Composition, o: number): Uint8Array {
    const mask = new Uint8Array(SIZE);
    for (let i = 0; i < SIZE; i++) {
      const at = this.objectAt(c, i);
      if (at >= 0 && this.within(at, o)) mask[i] = 1;
    }
    return mask;
  }

  /** Per pixel: 1 where object `o` (or something inside it) painted at all, shown or covered. */
  footprint(o: number): Uint8Array {
    const mask = new Uint8Array(SIZE);
    const { start, pixel } = this.recording;
    this.ops.forEach((op, k) => {
      if (op.obj === undefined || !paints(op) || !this.within(op.obj, o)) return;
      for (let w = start[k]; w < start[k + 1]; w++) mask[pixel[w]] = 1;
    });
    return mask;
  }

  /**
   * Where drawing left in the picture depends on `hidden` objects: re-run the script without their
   * painting and mark every pixel some op left now paints differently from the full picture. Lines
   * and plots always paint the same pixels, so only fills can differ (a fill that stopped at a
   * hidden object's edge spills through the gap). Empty when hiding them is clean, whatever covers
   * the difference in the picture.
   */
  dependence(hidden: Iterable<string | number>): Uint8Array {
    const sup = this.suppressed(hidden);
    const out = new Uint8Array(SIZE);
    const { start, pixel } = this.recording;
    const painter = new Painter();
    const seen = new Uint8Array(SIZE);
    const wrote: number[] = [];
    for (let k = 0; k < this.ops.length; k++) {
      if (sup[k]) continue;
      const op = this.ops[k];
      if (op.kind !== 'fill') {
        painter.apply(op);
        continue;
      }
      wrote.length = 0;
      painter.onWrite = (i) => wrote.push(i);
      painter.apply(op);
      painter.onWrite = undefined;
      // the symmetric difference between what it fills now and what it filled in the full picture
      for (let w = start[k]; w < start[k + 1]; w++) seen[pixel[w]] = 1;
      for (const i of wrote) {
        if (seen[i]) seen[i] = 2;
        else out[i] = 1;
      }
      for (let w = start[k]; w < start[k + 1]; w++) {
        if (seen[pixel[w]] === 1) out[pixel[w]] = 1;
        seen[pixel[w]] = 0;
      }
    }
    return out;
  }

  /**
   * Pixels object `o` (or something inside it) paints that nothing else could show once it is
   * hidden: no op outside every object, and none of the objects it is inside, paints them. Hiding
   * it (with whatever else is hidden) can uncover bare canvas there.
   */
  bare(o: number): Uint8Array {
    const keep = new Set<number>();
    for (let p = this.objects[o].parent; p >= 0; p = this.objects[p].parent) keep.add(p);
    const others = this.objects.map((_, i) => i).filter((i) => !keep.has(i));
    const { owner } = this.compose(others);
    const out = this.footprint(o);
    for (let i = 0; i < SIZE; i++) if (owner[i] >= 0) out[i] = 0;
    return out;
  }

  /**
   * The picture as layers: runs of consecutive painting ops with one innermost object, in script
   * order. The canvas colour overpainted by every layer whose object isn't hidden (nor inside a
   * hidden one) is exactly `compose(hidden)`, for any choice of hidden objects.
   */
  layers(): Layer[] {
    const out: Layer[] = [];
    const { start, pixel } = this.recording;
    let cur: Layer | undefined;
    for (let k = 0; k < this.ops.length; k++) {
      const op = this.ops[k];
      if (!paints(op) || start[k] === start[k + 1]) continue;
      const object = op.obj ?? -1;
      if (!cur || cur.object !== object) {
        cur = { object, from: k, to: k, alpha: new Uint8Array(SIZE), pixels: new Uint8Array(SIZE) };
        out.push(cur);
      }
      cur.to = k;
      for (let w = start[k]; w < start[k + 1]; w++) {
        cur.alpha[pixel[w]] = 1;
        cur.pixels[pixel[w]] = this.baked[w];
      }
    }
    return out;
  }
}

/** The smallest box [x1, y1, x2, y2] (inclusive) holding every set pixel of `mask`, or null. */
export function maskBox(mask: Uint8Array): [number, number, number, number] | null {
  let x1 = PIC_WIDTH, y1 = PIC_HEIGHT, x2 = -1, y2 = -1;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const x = i % PIC_WIDTH;
    const y = (i - x) / PIC_WIDTH;
    if (x < x1) x1 = x;
    if (x > x2) x2 = x;
    if (y < y1) y1 = y;
    if (y > y2) y2 = y;
  }
  return x2 < 0 ? null : [x1, y1, x2, y2];
}
