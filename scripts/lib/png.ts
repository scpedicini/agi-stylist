import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { PNG } from 'pngjs';
import { Framebuffer, PIC_HEIGHT, PIC_WIDTH } from '../../src/engine/framebuffer.ts';
import { EGA_PALETTE, rgbToIndex } from '../../src/engine/palette.ts';

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export function readPng(path: string): PNG {
  return PNG.sync.read(readFileSync(path));
}

/** Read any 160×168 PNG as opaque RGBA (e.g. a source image reframed by `pnpm grid`);
 *  transparency is flattened onto white, like `pnpm grid` does. */
export function readRgbaPicturePng(path: string): Uint8Array {
  const png = readPng(path);
  if (png.width !== PIC_WIDTH || png.height !== PIC_HEIGHT) {
    throw new Error(`${path}: expected ${PIC_WIDTH}×${PIC_HEIGHT}, got ${png.width}×${png.height}`);
  }
  const out = new Uint8Array(png.data);
  for (let i = 0; i < out.length; i += 4) {
    const a = out[i + 3] / 255;
    for (let k = 0; k < 3; k++) out[i + k] = Math.round(out[i + k] * a + 255 * (1 - a));
    out[i + 3] = 255;
  }
  return out;
}

/** Read a 160×168 EGA PNG into a framebuffer of palette indices. Throws on off-palette colours. */
export function readPicturePng(path: string): Framebuffer {
  const png = readPng(path);
  if (png.width !== PIC_WIDTH || png.height !== PIC_HEIGHT) {
    throw new Error(`${path}: expected ${PIC_WIDTH}×${PIC_HEIGHT}, got ${png.width}×${png.height}`);
  }
  const fb = new Framebuffer();
  for (let i = 0; i < PIC_WIDTH * PIC_HEIGHT; i++) {
    const c = rgbToIndex(png.data[i * 4], png.data[i * 4 + 1], png.data[i * 4 + 2]);
    if (c < 0) throw new Error(`${path}: pixel ${i % PIC_WIDTH},${Math.floor(i / PIC_WIDTH)} is not an EGA colour`);
    fb.pixels[i] = c;
  }
  return fb;
}

export type PanelImage =
  | {
      fb: Framebuffer;
      /** Optional per-pixel highlight mask (1 = draw magenta-ish diff marker). */
      mask?: Uint8Array;
      /** Optional RGBA image covering the whole picture at any size (e.g. the ink.png of a layout
       *  sketch from `pnpm grid --fit`), composited over this panel before the grid. */
      overlay?: RgbaImage;
    }
  | {
      /** A full-colour 160×168 picture (e.g. a reframed source image), RGBA. */
      rgba: Uint8Array;
    };

/**
 * Write one or more framebuffers side by side as a PNG at display aspect
 * (each logical pixel → 2·scale × scale), separated by a 4px dark gutter.
 * `crop` limits every panel to a region of the picture (for zooming in on details).
 */
export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

// 3×5 digit glyphs for grid labels (rows top to bottom, 3 bits each, high bit = left)
const DIGITS = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111', '111001010010010', '111101111101111', '111101111001111'];

export interface PanelOptions {
  /** Overlay a 10-pixel grid in picture coordinates, labelled every 20 (every 10 when zoomed in). */
  grid?: boolean;
}

export function writePanelsPng(
  path: string,
  panels: PanelImage[],
  scale = 2,
  crop: Crop = { x: 0, y: 0, w: PIC_WIDTH, h: PIC_HEIGHT },
  opts: PanelOptions = {},
): void {
  const pw = crop.w * 2 * scale;
  const ph = crop.h * scale;
  const gutter = 4;
  const png = new PNG({ width: panels.length * pw + (panels.length - 1) * gutter, height: ph });
  png.data.fill(0x22);
  for (let i = 3; i < png.data.length; i += 4) png.data[i] = 255;
  panels.forEach((panel, k) => {
    const ox = k * (pw + gutter);
    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++) {
        const li = (crop.y + Math.floor(y / scale)) * PIC_WIDTH + crop.x + Math.floor(x / (2 * scale));
        const [r, g, b] =
          'rgba' in panel
            ? [panel.rgba[li * 4], panel.rgba[li * 4 + 1], panel.rgba[li * 4 + 2]]
            : panel.mask?.[li]
              ? [255, 0, 255]
              : EGA_PALETTE[panel.fb.pixels[li]];
        const o = (y * png.width + ox + x) * 4;
        png.data[o] = r;
        png.data[o + 1] = g;
        png.data[o + 2] = b;
      }
    }
  });
  panels.forEach((panel, k) => {
    if ('fb' in panel && panel.overlay) drawOverlay(png, k * (pw + gutter), pw, ph, scale, crop, panel.overlay);
  });
  if (opts.grid) panels.forEach((_, k) => drawGrid(png, k * (pw + gutter), pw, ph, scale, crop));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, PNG.sync.write(png));
}

/**
 * The area-weighted average of the rectangle [u0,u1)×[v0,v1) of an RGBA image (in its pixel
 * units), premultiplied: returns [r·a, g·a, b·a, a] with a in 0-1. Partial pixels at the edges
 * count by how much of them is covered, so it works for shrinking and enlarging alike.
 */
export function areaSample(img: RgbaImage, u0: number, u1: number, v0: number, v1: number): [number, number, number, number] {
  let [r, g, b, a, area] = [0, 0, 0, 0, 0];
  for (let j = Math.max(0, Math.floor(v0)); j < Math.min(img.height, Math.ceil(v1)); j++) {
    const wy = Math.min(v1, j + 1) - Math.max(v0, j);
    if (wy <= 0) continue;
    for (let i = Math.max(0, Math.floor(u0)); i < Math.min(img.width, Math.ceil(u1)); i++) {
      const w = (Math.min(u1, i + 1) - Math.max(u0, i)) * wy;
      if (w <= 0) continue;
      const o = (j * img.width + i) * 4;
      const al = (img.data[o + 3] / 255) * w;
      r += img.data[o] * al;
      g += img.data[o + 1] * al;
      b += img.data[o + 2] * al;
      a += al;
      area += w;
    }
  }
  return area ? [r / area, g / area, b / area, a / area] : [0, 0, 0, 0];
}

/** Resample an RGBA image to w×h with area weighting on premultiplied alpha (no dark fringes). */
export function resampleRgba(img: RgbaImage, w: number, h: number): RgbaImage {
  const data = new Uint8Array(w * h * 4);
  const fx = img.width / w;
  const fy = img.height / h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = areaSample(img, x * fx, (x + 1) * fx, y * fy, (y + 1) * fy);
      const o = (y * w + x) * 4;
      if (a > 0) data.set([Math.round(r / a), Math.round(g / a), Math.round(b / a)], o);
      data[o + 3] = Math.round(a * 255);
    }
  }
  return { width: w, height: h, data };
}

/** Composite an RGBA image that covers the whole picture over one panel (area-weighted). */
function drawOverlay(png: PNG, ox: number, pw: number, ph: number, scale: number, crop: Crop, ov: RgbaImage) {
  const fx = ov.width / PIC_WIDTH;
  const fy = ov.height / PIC_HEIGHT;
  for (let y = 0; y < ph; y++) {
    const v0 = (crop.y + y / scale) * fy;
    const v1 = (crop.y + (y + 1) / scale) * fy;
    for (let x = 0; x < pw; x++) {
      const u0 = (crop.x + x / (2 * scale)) * fx;
      const u1 = (crop.x + (x + 1) / (2 * scale)) * fx;
      const [r, g, b, a] = areaSample(ov, u0, u1, v0, v1);
      if (!a) continue;
      const o = (y * png.width + ox + x) * 4;
      png.data[o] = Math.round(r + png.data[o] * (1 - a));
      png.data[o + 1] = Math.round(g + png.data[o + 1] * (1 - a));
      png.data[o + 2] = Math.round(b + png.data[o + 2] * (1 - a));
    }
  }
}

/** Read any PNG as straight-alpha RGBA, for --overlay. */
export function readRgbaPng(path: string): RgbaImage {
  const png = readPng(path);
  return { width: png.width, height: png.height, data: new Uint8Array(png.data) };
}

/** Magenta grid lines every 10 picture pixels plus white-on-black coordinate labels. */
function drawGrid(png: PNG, ox: number, pw: number, ph: number, scale: number, crop: Crop) {
  const blend = (x: number, y: number, rgb: readonly [number, number, number], a: number) => {
    if (x < 0 || y < 0 || x >= pw || y >= ph) return;
    const o = (y * png.width + ox + x) * 4;
    for (let k = 0; k < 3; k++) png.data[o + k] = Math.round(png.data[o + k] * (1 - a) + rgb[k] * a);
  };
  const MAGENTA = [255, 0, 255] as const;
  for (let gx = Math.ceil(crop.x / 10) * 10; gx < crop.x + crop.w; gx += 10) {
    const x = (gx - crop.x) * 2 * scale;
    for (let y = 0; y < ph; y++) blend(x, y, MAGENTA, 0.6);
  }
  for (let gy = Math.ceil(crop.y / 10) * 10; gy < crop.y + crop.h; gy += 10) {
    const y = (gy - crop.y) * scale;
    for (let x = 0; x < pw; x++) blend(x, y, MAGENTA, 0.6);
  }
  const every = 10 * scale >= 30 ? 10 : 20;
  const g = Math.max(1, Math.floor(scale / 2)); // glyph pixel size
  const label = (text: string, x0: number, y0: number) => {
    const w = text.length * 4 * g + g;
    for (let y = 0; y < 7 * g; y++) for (let x = 0; x < w; x++) blend(x0 + x, y0 + y, [0, 0, 0], 0.75);
    [...text].forEach((ch, i) => {
      const bits = DIGITS[Number(ch)];
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 3; c++) {
          if (bits[r * 3 + c] !== '1') continue;
          for (let dy = 0; dy < g; dy++) for (let dx = 0; dx < g; dx++) blend(x0 + g + (i * 4 + c) * g + dx, y0 + g + r * g + dy, [255, 255, 255], 1);
        }
      }
    });
  };
  for (let gx = Math.ceil(crop.x / every) * every; gx < crop.x + crop.w; gx += every) label(String(gx), (gx - crop.x) * 2 * scale + 1, 0);
  for (let gy = Math.ceil(crop.y / every) * every; gy < crop.y + crop.h; gy += every) {
    const y = (gy - crop.y) * scale + 1;
    if (y < 7 * g + 1) continue; // would overlap the x labels along the top
    label(String(gy), 0, y);
  }
}

/** Write a framebuffer as a logical-resolution 160×168 PNG. */
export function writePicturePng(path: string, fb: Framebuffer): void {
  const png = new PNG({ width: PIC_WIDTH, height: PIC_HEIGHT });
  fb.toRGBA(png.data);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, PNG.sync.write(png));
}
