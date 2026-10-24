import { EGA_PALETTE, WHITE, type RGB } from './palette.ts';

/** Logical AGI picture size. Each logical pixel is displayed twice as wide as it is tall. */
export const PIC_WIDTH = 160;
export const PIC_HEIGHT = 168;

/** VGA (SCI1-style) picture size: square pixels. */
export const VGA_WIDTH = 320;
export const VGA_HEIGHT = 200;

/** The picture a scene paints: its size, how wide a pixel shows on screen, and its palette. */
export interface Screen {
  mode: 'agi' | 'vga';
  width: number;
  height: number;
  /** Screen width of one pixel in units of its height: 2 for AGI, 1 for VGA. */
  aspect: number;
  /** Colour of each palette index: the 16 EGA colours for AGI; up to 256 for VGA. */
  palette: ReadonlyArray<RGB>;
}

export const AGI_SCREEN: Screen = { mode: 'agi', width: PIC_WIDTH, height: PIC_HEIGHT, aspect: 2, palette: EGA_PALETTE };

/** A visual screen holding palette indices (160×168 EGA unless given a screen). Starts all white, like AGI. */
export class Framebuffer {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
  /** The colour each index shows now: the screen's palette, changed by VGA `palette` ops. */
  readonly palette: RGB[];

  constructor(
    pixels?: Uint8Array,
    readonly screen: Screen = AGI_SCREEN,
  ) {
    this.width = screen.width;
    this.height = screen.height;
    this.pixels = pixels ?? new Uint8Array(this.width * this.height).fill(WHITE);
    this.palette = screen.palette.slice();
  }

  /** Back to the screen's own palette (undoing `palette` ops). */
  resetPalette(): void {
    this.palette.splice(0, this.palette.length, ...this.screen.palette);
  }

  get(x: number, y: number): number {
    return this.pixels[y * this.width + x];
  }

  set(x: number, y: number, c: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.pixels[y * this.width + x] = c;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  clone(): Framebuffer {
    const fb = new Framebuffer(this.pixels.slice(), this.screen);
    fb.palette.splice(0, fb.palette.length, ...this.palette);
    return fb;
  }

  clear(c = WHITE): void {
    this.pixels.fill(c);
  }

  /** RGBA bytes at logical resolution (width × height). */
  toRGBA<T extends { [index: number]: number }>(out: T = new Uint8ClampedArray(this.width * this.height * 4) as unknown as T): T {
    const palette = this.palette;
    for (let i = 0; i < this.pixels.length; i++) {
      const [r, g, b] = palette[this.pixels[i]] ?? palette[0];
      out[i * 4] = r;
      out[i * 4 + 1] = g;
      out[i * 4 + 2] = b;
      out[i * 4 + 3] = 255;
    }
    return out;
  }

  /** Count pixels that differ from another framebuffer. */
  diffCount(other: Framebuffer): number {
    let n = 0;
    for (let i = 0; i < this.pixels.length; i++) if (this.pixels[i] !== other.pixels[i]) n++;
    return n;
  }

  /** FNV-1a hash of the pixel indices; used to compare browser and Node renders. */
  hash(): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < this.pixels.length; i++) {
      h ^= this.pixels[i];
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }
}
