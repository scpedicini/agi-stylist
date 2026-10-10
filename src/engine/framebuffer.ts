import { EGA_PALETTE, WHITE } from './palette.ts';

/** Logical AGI picture size. Each logical pixel is displayed twice as wide as it is tall. */
export const PIC_WIDTH = 160;
export const PIC_HEIGHT = 168;

/** A 160×168 visual screen holding EGA palette indices. Starts all white, like AGI. */
export class Framebuffer {
  readonly width = PIC_WIDTH;
  readonly height = PIC_HEIGHT;
  readonly pixels: Uint8Array;

  constructor(pixels?: Uint8Array) {
    this.pixels = pixels ?? new Uint8Array(PIC_WIDTH * PIC_HEIGHT).fill(WHITE);
  }

  get(x: number, y: number): number {
    return this.pixels[y * PIC_WIDTH + x];
  }

  set(x: number, y: number, c: number): void {
    if (x < 0 || y < 0 || x >= PIC_WIDTH || y >= PIC_HEIGHT) return;
    this.pixels[y * PIC_WIDTH + x] = c;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < PIC_WIDTH && y < PIC_HEIGHT;
  }

  clone(): Framebuffer {
    return new Framebuffer(this.pixels.slice());
  }

  clear(c = WHITE): void {
    this.pixels.fill(c);
  }

  /** RGBA bytes at logical resolution (160×168). */
  toRGBA<T extends { [index: number]: number }>(out: T = new Uint8ClampedArray(PIC_WIDTH * PIC_HEIGHT * 4) as unknown as T): T {
    for (let i = 0; i < this.pixels.length; i++) {
      const [r, g, b] = EGA_PALETTE[this.pixels[i]];
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
