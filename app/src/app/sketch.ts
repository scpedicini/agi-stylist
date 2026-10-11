import p5 from 'p5';
import { Framebuffer, PIC_HEIGHT, PIC_WIDTH } from '../engine/framebuffer.ts';
import type { Hiding } from '../engine/objects.ts';
import type { Op } from '../engine/ops.ts';
import { EGA_PALETTE } from '../engine/palette.ts';
import { Playback } from '../engine/playback.ts';

// p5's "friendly errors" are a beginner's aid that, in development builds, scans every script on the
// page for functions named like p5's own and warns about them (PicScript's `line` among them). This
// app drives p5 in instance mode, so nothing is shadowed; turn the scan off (it also costs time).
p5.disableFriendlyErrors = true;

export interface StageOptions {
  /** Integer zoom; each logical pixel becomes (2·scale)×scale screen pixels. */
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
  private ops: readonly Op[] = [];
  private dirty = true;
  private lit: Uint8Array | null = null;
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
        p.createCanvas(PIC_WIDTH * 2 * this.scale, PIC_HEIGHT * this.scale).parent(parent);
        p.noSmooth();
        this.img = p.createImage(PIC_WIDTH, PIC_HEIGHT);
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

  /** Play `ops` from the start, with the objects in `hiding` hidden (see ObjectModel.hiding). */
  load(ops: readonly Op[], hiding?: Hiding): void {
    this.ops = ops;
    this.play = new Playback(ops, { hiding });
    this.restart();
  }

  /** Hide a different set of objects, staying where playback is (a finished picture stays finished). */
  rehide(hiding: Hiding): void {
    const at = this.play.position;
    this.play = new Playback(this.ops, { hiding });
    this.seek(at);
  }

  /**
   * Thatch the pixels set in `mask` (one per picture pixel): every other one of them, in a
   * checkerboard, shows its opposite EGA colour (black ↔ white, blue ↔ yellow, brown ↔ light
   * blue…), so it stands out whatever its colour; the rest of the picture stays as it is. Null
   * shows the picture plain.
   */
  /** How many pixels are lit up, or null when nothing is (for tests). */
  get highlighted(): number | null {
    return this.lit ? this.lit.reduce((a, b) => a + b, 0) : null;
  }

  set highlight(mask: Uint8Array | null) {
    if (mask === this.lit) return;
    this.lit = mask;
    this.dirty = true;
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
    const lit = this.lit;
    if (lit) {
      const px = this.img.pixels;
      const fb = this.play.fb.pixels;
      for (let i = 0; i < lit.length; i++) {
        if (!lit[i] || ((i % PIC_WIDTH) + Math.floor(i / PIC_WIDTH)) % 2) continue;
        const [r, g, b] = EGA_PALETTE[fb[i] ^ 15];
        px[i * 4] = r;
        px[i * 4 + 1] = g;
        px[i * 4 + 2] = b;
      }
    }
    this.img.updatePixels();
    this.p.clear();
    this.p.image(this.img, 0, 0, this.p.width, this.p.height);
  }
}
