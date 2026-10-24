import p5 from 'p5';
import type { Framebuffer } from '../engine/framebuffer.ts';
import type { Op } from '../engine/ops.ts';
import { Playback } from '../engine/playback.ts';

// p5's "friendly errors" are a beginner's aid that, in development builds, scans every script on the
// page for functions named like p5's own and warns about them (PicScript's `line` among them). This
// app drives p5 in instance mode, so nothing is shadowed; turn the scan off (it also costs time).
p5.disableFriendlyErrors = true;

export interface StageOptions {
  /** Integer zoom; each logical pixel becomes (2·scale)×scale screen pixels (scale×scale in VGA). */
  scale?: number;
  /** After every change: ops played so far, the op count, and the op played last. */
  onProgress?: (position: number, total: number, last: Op | undefined) => void;
}

/**
 * A p5 canvas that plays an op list (see engine/playback.ts: `delay`ed ops come last). Playback
 * speed is ops per frame; Infinity paints instantly. The stage keeps the AGI 2:1 pixel aspect.
 */
export class Stage {
  private p!: p5;
  private img!: p5.Image;
  private play = new Playback([]);
  private dirty = true;
  opsPerFrame = Infinity;
  paused = false;
  /**
   * Paint over whatever is behind the canvas: pixels no op has drawn yet stay transparent until
   * the last op, when the finished picture is shown whole.
   */
  overlay = false;
  readonly scale: number;

  constructor(private readonly parent: HTMLElement, private readonly opts: StageOptions = {}) {
    this.scale = opts.scale ?? 3;
    new p5((p: p5) => {
      this.p = p;
      p.setup = () => {
        p.pixelDensity(1);
        const fb = this.play.fb;
        p.createCanvas(fb.width * fb.screen.aspect * this.scale, fb.height * this.scale).parent(parent);
        p.noSmooth();
        this.img = p.createImage(fb.width, fb.height);
        // once, to create img.pixels: each frame rewrites every pixel of it, so reading the image
        // back from its canvas per frame (what loadPixels does) would be wasted work
        this.img.loadPixels();
      };
      p.draw = () => this.frame();
    }, parent);
  }

  get canvas(): HTMLCanvasElement | null {
    return this.parent.querySelector('canvas');
  }

  get framebuffer(): Framebuffer {
    return this.play.fb;
  }

  get position(): number {
    return this.play.position;
  }

  get done(): boolean {
    return this.play.done;
  }

  /** The scene has `delay` blocks but too much to record for them, so it plays in script order. */
  get delaysIgnored(): boolean {
    return this.play.delaysIgnored;
  }

  load(ops: readonly Op[]): void {
    this.play = new Playback(ops);
    this.fit();
    this.restart();
  }

  /** Match the canvas and image to the picture's size (AGI 160×168, VGA 320×200). */
  private fit(): void {
    const fb = this.play.fb;
    if (!this.img || (this.img.width === fb.width && this.img.height === fb.height)) return;
    this.p.resizeCanvas(fb.width * fb.screen.aspect * this.scale, fb.height * this.scale);
    this.img = this.p.createImage(fb.width, fb.height);
    this.img.loadPixels();
  }

  /** Back to the start: nothing painted. */
  restart(): void {
    this.seek(0);
  }

  /** Play exactly one op. */
  step(): void {
    this.play.step();
    this.changed();
  }

  /** Play to the end of the next instruction (all the ops of one run of a scene statement). */
  stepInstruction(): void {
    this.play.stepInstruction();
    this.changed();
  }

  /** Go back to the start of the instruction played last. */
  backInstruction(): void {
    this.play.backInstruction();
    this.changed();
  }

  /** Show the first `n` ops played. */
  seek(n: number): void {
    this.play.seek(n);
    this.changed();
  }

  finish(): void {
    this.play.finish();
    this.changed();
  }

  private changed(): void {
    this.dirty = true;
    this.opts.onProgress?.(this.play.position, this.play.length, this.play.last);
  }

  private frame(): void {
    if (!this.img) return;
    if (!this.paused && !this.done) {
      if (this.opsPerFrame === Infinity) this.play.finish();
      else for (let i = 0; i < this.opsPerFrame && !this.done; i++) this.play.step();
      this.changed();
    }
    if (!this.dirty) return;
    this.dirty = false;
    this.play.fb.toRGBA(this.img.pixels);
    const touched = this.play.touched;
    if (this.overlay && !this.done) for (let i = 0; i < touched.length; i++) if (!touched[i]) this.img.pixels[i * 4 + 3] = 0;
    this.img.updatePixels();
    this.p.clear();
    this.p.image(this.img, 0, 0, this.p.width, this.p.height);
  }
}
