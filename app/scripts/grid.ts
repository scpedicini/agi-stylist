// Prepare a source image (photo, painting, screenshot, game background…) for translating by eye
// into a PicScript scene.
//
//   pnpm grid <image> [--name <name>] [--anchor center|top|bottom|left|right]
//                     [--crop x,y,w,h] [--max-squash <0-0.5>] [--tile CxR:c,r] [--trim]
//                     [--brighten [<gamma>]] [--fit] [--vga] [--out <dir>]
//   pnpm grid <layout.txt> [--name <name>] [--vga] [--out <dir>]
//
// The picture is 160×168 logical pixels shown at 2:1, i.e. a 1.9:1 screen. Most images are a
// different shape, so the image is REFRAMED first: it is cropped to within --max-squash (default
// 0.15) of 1.9:1, then squashed the rest of the way. --anchor says which part of the image to
// keep when cropping (default center; use top/bottom for tall images, left/right for wide ones),
// and --crop x,y,w,h (in source pixels) picks the region yourself. --tile CxR:c,r first cuts
// tile (c, r) - 1-based - out of a sheet of C columns × R rows. --trim strips plain, solid
// borders (letterboxing, black bars) before reframing; a status bar with text in it is not
// plain, so cut that off with --crop, which is then relative to the trimmed image. Only the first frame of an animation is used; EXIF rotation is applied and
// transparency is flattened onto white (the colour of an unpainted AGI canvas).
// --brighten lifts the shadows (gamma, default 2) in view.png and the grids so you can see what
// is in a dark picture; picture.png stays true. Very dark images are brightened automatically.
//
// LAYOUT SKETCHES (words placed where things go): --fit maps the whole region (after --tile,
// --trim, --crop) onto the picture however far from 1.9:1 it is (a normalised stretch, so no
// label is cropped off), and also writes ink.png, the sketch's lines and words as a magenta
// overlay for `pnpm render --overlay`. Thick coloured paint (a hybrid sketch's brushstrokes) is
// told apart from pen work by its width and listed on its own: colour, line/loop/fill/dab, centre
// line or outline, and the words in or beside it. A .txt file is an ASCII layout: its frame (|---| or +---+)
// is the picture's edge, and every label's position is computed exactly from the character cells
// (printed, and written to labels.json); it is drawn to a PNG and then handled like --fit.
//
// Writes to <out>/<name>/ (default out/source/<name>/):
//   view.png       the reframed image as it will look on screen (960×504) - look at this first
//   grid.png       the whole picture with a labelled 10-pixel grid in picture coordinates
//   grid-tl.png, grid-tr.png, grid-bl.png, grid-br.png
//                  the four quarters, zoomed, gridded and labelled - read positions off these
//   picture.png    the reframed image at 160×168, full colour - for `pnpm render --beside`
//   transform.json how source pixels map to picture coordinates
//   ink.png        (--fit and layouts) the sketch's ink, for `pnpm render --overlay`
//   labels.json    (layouts) each label's text, cells, centre and box in picture coordinates
//   blobs.json     (--fit images) groups of ink - words, marks, line work - with their boxes
//   strokes.json   (--fit images with paint) the brushstrokes and their colour layers
//   strokes.pic    (--fit images with paint) every stroke's points as PicScript lists to paste
//   paint.png      (--fit images with paint) the ink in its own colours, for `render --overlay`
//
// --vga prepares for a `mode vga` scene instead: the picture is 320×200 with square pixels (a 1.6:1
// screen), so everything above is measured in VGA picture coordinates (x 0-319, y 0-199):
// picture.png is 320×200, view.png and the overlays 960×600, and the grids are labelled to match.
//
// The grid is a measuring aid only: choose colours by eye, never by sampling these images.
// Needs ImageMagick 7 (`magick`). Exit codes: 0 ok, 1 ImageMagick failed, 2 bad arguments.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PIC, usePicture } from './lib/geometry.ts';
import { readPng, resampleRgba } from './lib/png.ts';
import { blobTable, CELL_H, CELL_W, inkBlobs, inkOverlay, layoutLabelArgs, layoutMvg, layoutTable, paperField, parseLayout, type InkBlob, type Layout } from './lib/sketch.ts';
import { attachWords, brushStrokes, paintOverlay, strokesPic, strokeTable, type StrokeResult } from './lib/strokes.ts';
import { PNG } from 'pngjs';

/** The screen's shape: 320:168 ≈ 1.905 for AGI (2:1 pixels), 320:200 = 1.6 for VGA. */
const screenAspect = () => (PIC.width * PIC.aspect) / PIC.height;

class UsageError extends Error {}
class MagickError extends Error {}

type Anchor = 'center' | 'top' | 'bottom' | 'left' | 'right';

interface Args {
  image: string;
  name?: string;
  anchor: Anchor;
  crop?: [number, number, number, number];
  maxSquash: number;
  tile?: { cols: number; rows: number; c: number; r: number };
  trim: boolean;
  /** gamma for view.png and the grids; undefined = automatic */
  brighten?: number;
  /** map the whole region onto the picture (layout sketches) */
  fit: boolean;
  /** an ASCII layout (.txt) rather than an image */
  layout: boolean;
  /** prepare for a `mode vga` scene: a 320×200 picture with square pixels */
  vga: boolean;
  out: string;
}

function parseArgs(argv: string[]): Args {
  let image: string | undefined;
  const a: Omit<Args, 'image'> = { anchor: 'center', maxSquash: 0.15, out: 'out/source', trim: false, fit: false, layout: false, vga: false };
  const given = new Set<string>();
  const value = (i: number, name: string) => {
    const v = argv[i];
    if (v === undefined || v.startsWith('--')) throw new UsageError(`${name} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--') continue; // tolerate `pnpm grid -- …` like the other CLIs (use ./-name for odd file names)
    if (v.startsWith('--')) given.add(v);
    if (v === '--name') a.name = value(++i, '--name');
    else if (v === '--trim') a.trim = true;
    else if (v === '--fit') a.fit = true;
    else if (v === '--vga') a.vga = true;
    else if (v === '--brighten') {
      const next = argv[i + 1];
      // a number after --brighten is its gamma, unless it is the name of an existing file
      if (next !== undefined && /^\d*\.?\d+$/.test(next) && !existsSync(next)) {
        a.brighten = Number(next);
        i++;
        if (a.brighten < 1 || a.brighten > 4) throw new UsageError('--brighten takes a gamma from 1 (no change) to 4');
      } else a.brighten = 2;
    }
    else if (v === '--out') a.out = value(++i, '--out');
    else if (v === '--anchor') {
      const anchor = value(++i, '--anchor');
      if (!['center', 'top', 'bottom', 'left', 'right'].includes(anchor)) throw new UsageError('--anchor must be center, top, bottom, left or right');
      a.anchor = anchor as Anchor;
    } else if (v === '--crop') {
      const m = /^(\d{1,6}),(\d{1,6}),(\d{1,6}),(\d{1,6})$/.exec(value(++i, '--crop'));
      if (!m || Number(m[3]) < 1 || Number(m[4]) < 1) throw new UsageError('--crop needs x,y,w,h in source pixels (w, h ≥ 1)');
      a.crop = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
    } else if (v === '--max-squash') {
      const raw = value(++i, '--max-squash');
      const n = Number(raw);
      if (!/^\d*\.?\d+$/.test(raw) || n < 0 || n > 0.5) throw new UsageError('--max-squash must be a number from 0 to 0.5');
      a.maxSquash = n;
    } else if (v === '--tile') {
      const m = /^(\d{1,4})x(\d{1,4}):(\d{1,4}),(\d{1,4})$/.exec(value(++i, '--tile'));
      const [cols, rows, c, r] = m ? m.slice(1).map(Number) : [];
      if (!m || cols < 1 || rows < 1 || c < 1 || r < 1 || c > cols || r > rows) {
        throw new UsageError('--tile needs COLSxROWS:col,row with 1-based col/row, e.g. 11x8:3,1');
      }
      a.tile = { cols, rows, c, r };
    } else if (v === '--help' || v === '-h') {
      const src = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
      console.log(src.slice(0, src.findIndex((l) => !l.startsWith('//'))).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
      process.exit(0);
    } else if (v.startsWith('-')) throw new UsageError(`unknown option '${v}' (try --help)`);
    else if (image) throw new UsageError(`only one image at a time (got '${image}' and '${v}')`);
    else image = v;
  }
  if (!image) throw new UsageError('no image given (try --help)');
  if (!existsSync(image)) throw new UsageError(`${image}: no such file`);
  if (a.fit) {
    for (const o of ['--anchor', '--max-squash']) if (given.has(o)) throw new UsageError(`${o} chooses what to crop; --fit keeps everything, so they don't go together`);
  }
  if (/\.txt$/i.test(image)) {
    const extra = [...given].filter((o) => !['--name', '--out', '--fit', '--vga'].includes(o));
    if (extra.length) throw new UsageError(`${extra.join(', ')} can't be used with an ASCII layout (.txt): the frame is the picture's edge`);
    a.layout = true;
    a.fit = true;
  }
  if (a.name !== undefined && (!/^[\w.-]+$/.test(a.name) || /^\.+$/.test(a.name))) {
    throw new UsageError('--name may only use letters, digits, - _ and . (and not just dots)');
  }
  return { ...a, image };
}

function magick(args: string[]): string {
  try {
    return execFileSync('magick', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    throw new MagickError((err.stderr || err.message).trim());
  }
}

/** Squash needed to show a w×h region on the 1.9:1 screen (0 = none). */
const squashOf = (w: number, h: number) => (w / h < screenAspect() ? 1 - w / h / screenAspect() : 1 - screenAspect() / (w / h));

/** How a --fit region is stretched on the 1.9:1 screen, in words. */
export function stretchOf(w: number, h: number): string {
  const r = w / h / screenAspect(); // > 1: wider than the screen, so squeezed horizontally
  if (Math.abs(r - 1) < 0.005) return 'no distortion';
  return r > 1 ? `shapes come out ${r.toFixed(2)}× narrower than drawn` : `shapes come out ${(1 / r).toFixed(2)}× wider than drawn`;
}

/** The region of a w×h image to keep, so that at most `maxSquash` squashing reaches 1.9:1. */
export function reframe(w: number, h: number, maxSquash: number, anchor: Anchor): { x: number; y: number; w: number; h: number; squash: number } {
  const tallest = screenAspect() * (1 - maxSquash); // narrower than this: crop height
  const widest = screenAspect() / (1 - maxSquash); // wider than this: crop width
  let cw = w;
  let ch = h;
  // round inward, so rounding never pushes the squash past the limit
  if (w / h < tallest) ch = Math.floor(w / tallest);
  else if (w / h > widest) cw = Math.floor(h * widest);
  if (cw < 1 || ch < 1 || squashOf(cw, ch) > maxSquash + 1e-9) {
    throw new UsageError(`a ${w}×${h} image is too small to reframe within ${Math.round(maxSquash * 100)}% squash - pass --crop or a bigger --max-squash`);
  }
  const along = (free: number, lo: boolean, hi: boolean) => (lo ? 0 : hi ? free : Math.floor(free / 2));
  const x = along(w - cw, anchor === 'left', anchor === 'right');
  const y = along(h - ch, anchor === 'top', anchor === 'bottom');
  return { x, y, w: cw, h: ch, squash: squashOf(cw, ch) };
}

function gridMvg(x0: number, y0: number, w: number, h: number, zoom: number, labelEvery: number): string {
  const lines = ['stroke rgba(255,0,255,0.7)', 'stroke-width 1', 'fill none'];
  for (let x = Math.ceil(x0 / 10) * 10; x <= x0 + w; x += 10) lines.push(`line ${(x - x0) * zoom},0 ${(x - x0) * zoom},${h * zoom}`);
  for (let y = Math.ceil(y0 / 10) * 10; y <= y0 + h; y += 10) lines.push(`line 0,${(y - y0) * zoom} ${w * zoom},${(y - y0) * zoom}`);
  lines.push('stroke none', 'fill white', 'font-size 13', 'text-undercolor rgba(0,0,0,0.6)');
  for (let x = Math.ceil(x0 / labelEvery) * labelEvery; x < x0 + w; x += labelEvery) lines.push(`text ${(x - x0) * zoom + 2},12 '${x}'`);
  for (let y = Math.ceil(y0 / labelEvery) * labelEvery; y < y0 + h; y += labelEvery) {
    if (y === y0) continue; // the top-left corner already has the x label
    lines.push(`text 2,${(y - y0) * zoom + 13} '${y}'`);
  }
  return lines.join('\n');
}

/** Quote an argument for a POSIX shell, only when it needs it. */
const shq = (s: string) => (/^[\w./:,+=-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

function run(args: Args) {
  try {
    magick(['-version']);
  } catch {
    throw new MagickError('ImageMagick 7 (`magick`) is required - e.g. `brew install imagemagick`');
  }
  const work = mkdtempSync(join(tmpdir(), 'kq-grid-'));
  try {
    // Normalise once - first frame, EXIF rotation applied, transparency on white, 8-bit sRGB - so
    // every size and crop below is measured on exactly the pixels that get cropped. PNG24 keeps a
    // picture with ≤ 256 colours from being saved as a palette PNG, which resizes differently.
    const norm = join(work, 'source.png');
    let layout: Layout | undefined;
    if (args.layout) {
      try {
        layout = parseLayout(readFileSync(args.image, 'utf8'));
      } catch (e) {
        throw new UsageError(`${args.image}: ${(e as Error).message}`);
      }
      writeFileSync(join(work, 'layout.mvg'), layoutMvg(layout));
      magick(['-size', `${layout.w * CELL_W}x${layout.h * CELL_H}`, 'xc:white', '-draw', `@${join(work, 'layout.mvg')}`, ...layoutLabelArgs(layout), '-alpha', 'off', '-depth', '8', `PNG24:${norm}`]);
    } else {
      magick([`${args.image}[0]`, '-auto-orient', '-colorspace', 'sRGB', '-background', 'white', '-alpha', 'remove', '-alpha', 'off', '-depth', '8', `PNG24:${norm}`]);
    }
    const [iw, ih] = magick(['identify', '-format', '%w %h', norm]).trim().split(' ').map(Number);

    // the source region (after an optional sheet tile and trim), in normalised pixels
    let sx = 0;
    let sy = 0;
    let sw = iw;
    let sh = ih;
    const notes: string[] = [];
    if (args.tile) {
      const { cols, rows, c, r } = args.tile;
      if (cols > iw || rows > ih) throw new UsageError(`--tile ${cols}x${rows}: the ${iw}×${ih} image is too small for that many tiles`);
      sw = Math.floor(iw / cols);
      sh = Math.floor(ih / rows);
      sx = (c - 1) * sw;
      sy = (r - 1) * sh;
      if (iw % cols || ih % rows) notes.push(`the ${iw}×${ih} sheet doesn't divide evenly into ${cols}×${rows}; tiles are ${sw}×${sh} and the leftover right/bottom pixels are ignored`);
    }
    if (args.trim) {
      // bounding box of everything that isn't the border colour, within the tile
      const box = magick([norm, '-crop', `${sw}x${sh}+${sx}+${sy}`, '+repage', '-fuzz', '10%', '-format', '%@', 'info:']).trim();
      const m = /^(\d+)x(\d+)\+(\d+)\+(\d+)$/.exec(box);
      if (m && Number(m[1]) > 1 && Number(m[2]) > 1) {
        sx += Number(m[3]);
        sy += Number(m[4]);
        sw = Number(m[1]);
        sh = Number(m[2]);
      } else notes.push('--trim found no border to remove');
    }
    let region: { x: number; y: number; w: number; h: number; squash: number };
    if (args.crop) {
      const [x, y, w, h] = args.crop;
      if (x + w > sw || y + h > sh) throw new UsageError(`--crop ${args.crop.join(',')} runs outside the ${sw}×${sh} image`);
      region = { x, y, w, h, squash: squashOf(w, h) };
    } else if (args.fit) region = { x: 0, y: 0, w: sw, h: sh, squash: squashOf(sw, sh) };
    else region = reframe(sw, sh, args.maxSquash, args.anchor);
    const geometry = `${region.w}x${region.h}+${sx + region.x}+${sy + region.y}`;

    const tileSuffix = args.tile ? `-r${String(args.tile.r).padStart(2, '0')}-c${String(args.tile.c).padStart(2, '0')}` : '';
    const name = args.name ?? (basename(args.image, extname(args.image)).replace(/[^\w.-]+/g, '-').replace(/^\.+$/, 'image') || 'image') + tileSuffix;
    const dir = join(args.out, name);
    mkdirSync(dir, { recursive: true });
    const src = [norm, '-crop', geometry, '+repage'];
    // a solid strip along the top or bottom edge (a status bar, a sheet's divider) is usually
    // not part of the picture: say so, so it can be cropped off
    const stats = (y: number, h: number) =>
      magick([norm, '-crop', `${region.w}x${h}+${sx + region.x}+${y}`, '+repage', '-format', '%[fx:standard_deviation] %[fx:mean.r] %[fx:mean.g] %[fx:mean.b]', 'info:'])
        .trim()
        .split(' ')
        .map(Number);
    // (not for a sketch: blank paper next to a painted strip is just the layout)
    if (region.h >= 40 && !args.fit) {
      const strip = Math.max(2, Math.round(region.h / 40));
      for (const [edge, y, inner] of [
        ['top', sy + region.y, sy + region.y + strip],
        ['bottom', sy + region.y + region.h - strip, sy + region.y + region.h - 4 * strip],
      ] as const) {
        const [sd, r, g, b] = stats(y, strip);
        const [, r2, g2, b2] = stats(inner, 3 * strip);
        if (sd < 0.03 && Math.abs(r - r2) + Math.abs(g - g2) + Math.abs(b - b2) > 0.25) {
          notes.push(`the ${edge} ${strip} rows are one flat colour that differs from the rows next to them: maybe a strip that isn't part of the picture (a status bar, a sheet's divider), maybe just a flat sky or floor. Look at view.png; if it's a strip, crop it off with --crop`);
        }
      }
    }
    // dark pictures are hard to read: lift the shadows in the images you look at (not picture.png)
    let gamma = args.brighten ?? 1;
    if (args.brighten === undefined) {
      const mean = Number(magick([...src, '-resize', '64x64!', '-colorspace', 'Gray', '-format', '%[fx:mean]', 'info:']).trim());
      if (mean < 0.18) {
        gamma = 2;
        notes.push(`the picture is very dark (mean brightness ${(mean * 100).toFixed(0)}%), so view.png and the grids are brightened (gamma 2) to show shapes; that also washes out hues, so judge colours from picture.png (e.g. the first --beside render). Use --brighten 1 to turn this off`);
      }
    }
    const look = gamma > 1 ? ['-gamma', String(gamma)] : [];

    // full-colour picture (160×168; 320×200 VGA), and the on-screen view at ×3 (2:1 pixels → 960×504; VGA 960×600)
    magick([...src, '-resize', `${PIC.width}x${PIC.height}!`, join(dir, 'picture.png')]);
    magick([...src, ...look, '-resize', `${PIC.width * PIC.aspect * 3}x${PIC.height * 3}!`, join(dir, 'view.png')]);

    // gridded overview (×4) and four zoomed quarters (×8), smooth-scaled from the source so
    // details stay legible, in picture coordinates
    const zoomed = join(work, 'zoom8.png');
    magick([...src, ...look, '-resize', `${PIC.width * 8}x${PIC.height * 8}!`, zoomed]);
    writeFileSync(join(work, 'grid.mvg'), gridMvg(0, 0, PIC.width, PIC.height, 4, 20));
    magick([zoomed, '-resize', `${PIC.width * 4}x${PIC.height * 4}!`, '-draw', `@${join(work, 'grid.mvg')}`, join(dir, 'grid.png')]);
    const hw = PIC.width / 2;
    const hh = PIC.height / 2;
    for (const [q, qx, qy] of [['tl', 0, 0], ['tr', hw, 0], ['bl', 0, hh], ['br', hw, hh]] as const) {
      writeFileSync(join(work, `grid-${q}.mvg`), gridMvg(qx, qy, hw, hh, 8, 10));
      magick([zoomed, '-crop', `${hw * 8}x${hh * 8}+${qx * 8}+${qy * 8}`, '+repage', '-draw', `@${join(work, `grid-${q}.mvg`)}`, join(dir, `grid-${q}.png`)]);
    }

    // how source pixels map to the picture: continuous coordinates, pixel edges at integers
    const transform = {
      source: args.image,
      mode: args.layout ? 'layout' : args.fit ? 'fit' : 'reframe',
      normalisedSize: [iw, ih],
      region: { x: sx + region.x, y: sy + region.y, w: region.w, h: region.h },
      scale: [PIC.width / region.w, PIC.height / region.h],
      picture: '(sx − region.x)·scale[0], (sy − region.y)·scale[1]; floor for the pixel',
      ...(args.vga && { pictureSize: [PIC.width, PIC.height], pixelAspect: PIC.aspect, sceneMode: 'vga' }),
      ...(layout && { cells: [layout.w, layout.h], cellPixels: [CELL_W, CELL_H] }),
    };
    writeFileSync(join(dir, 'transform.json'), `${JSON.stringify(transform, null, 2)}\n`);
    // outputs that only some runs write: clear them, so a rerun into the same folder leaves none
    // from an earlier, different sketch
    for (const f of ['ink.png', 'paint.png', 'blobs.json', 'strokes.json', 'strokes.pic', 'labels.json']) rmSync(join(dir, f), { force: true });
    let blobs: InkBlob[] | undefined;
    let strokes: StrokeResult | undefined;
    if (args.fit) {
      // extract at the source's own resolution (capped at 4× view.png), so thin or pale marks
      // aren't blended away before the threshold, then shrink the overlay
      const nativePath = join(work, 'ink-src.png');
      magick([...src, '-resize', `${PIC.width * PIC.aspect * 12}x${PIC.height * 12}>`, nativePath]);
      const native = readPng(nativePath);
      const img = { width: native.width, height: native.height, data: native.data };
      const paper = paperField(img);
      const writeOverlay = (o: { width: number; height: number; data: Uint8Array }, name: string) => {
        const png = new PNG({ width: o.width, height: o.height });
        png.data.set(o.data);
        writeFileSync(join(dir, name), PNG.sync.write(png));
      };
      const inkNative = inkOverlay(img, paper);
      writeOverlay(resampleRgba(inkNative, PIC.width * PIC.aspect * 3, PIC.height * 3), 'ink.png');
      // where the ink is: words, marks and line work, for reading label positions off an image
      // sketch (an ASCII layout has exact positions instead); thick paint goes to its own table
      if (!layout) {
        strokes = brushStrokes(img, paper);
        if (strokes.strokes.length) {
          for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (strokes.isBrush(x, y)) inkNative.data[(y * img.width + x) * 4 + 3] = 0;
          writeOverlay(resampleRgba(paintOverlay(img, paper), PIC.width * PIC.aspect * 3, PIC.height * 3), 'paint.png');
        }
        blobs = inkBlobs(resampleRgba(inkNative, PIC.width * PIC.aspect * 3, PIC.height * 3));
        writeFileSync(join(dir, 'blobs.json'), `${JSON.stringify(blobs, null, 2)}\n`);
        if (strokes.strokes.length) {
          attachWords(strokes.strokes, blobs);
          writeFileSync(join(dir, 'strokes.json'), `${JSON.stringify({ layers: strokes.layers, strokes: strokes.strokes }, null, 2)}\n`);
          writeFileSync(join(dir, 'strokes.pic'), strokesPic(strokes.strokes));
        }
      }
    }
    if (layout) {
      writeFileSync(join(dir, 'labels.json'), `${JSON.stringify({ cells: [layout.w, layout.h], framed: layout.framed, labels: layout.labels, outside: layout.outside }, null, 2)}\n`);
    }

    const how = layout
      ? ''
      : args.fit
      ? `, fitted: x ×${(PIC.width / region.w).toFixed(3)}, y ×${(PIC.height / region.h).toFixed(3)} (${stretchOf(region.w, region.h)})`
      : region.squash > 0.005 ? `, squashed ${(region.squash * 100).toFixed(0)}% to fit` : '';
    const trimmed = args.trim && !notes.some((n) => n.startsWith('--trim')) ? `, trimmed to ${sw}×${sh}` : '';
    const what = layout ? `${args.image}: ASCII layout, ${layoutTable(layout)}\n  drawn as ${iw}×${ih}` : (args.tile ? `tile ${args.tile.c},${args.tile.r} of ${args.image}` : `${args.image} (${iw}×${ih})`) + trimmed;
    const cropped = region.w !== sw || region.h !== sh ? `kept ${region.w}×${region.h} at ${region.x},${region.y}` : 'kept all of it';
    console.log(`${what}: ${cropped}${how}`);
    for (const n of notes) console.log(`  note: ${n}`);
    console.log(`  view:    ${join(dir, 'view.png')}`);
    console.log(`  grid:    ${join(dir, 'grid.png')}  (quarters: grid-tl/tr/bl/br.png)`);
    console.log(`  picture: ${join(dir, 'picture.png')}  (pnpm render <scene> --beside ${shq(join(dir, 'picture.png'))})`);
    if (args.fit) console.log(`  ink:     ${join(dir, 'ink.png')}  (pnpm render <scene> --overlay ${shq(join(dir, 'ink.png'))})`);
    if (strokes?.strokes.length) console.log(`  paint:   ${join(dir, 'paint.png')}  (the same in the sketch's own colours, for --overlay when colour matters)`);
    if (layout) console.log(`  labels:  ${join(dir, 'labels.json')}`);
    if (blobs) {
      console.log(`  ink blobs (${blobs.length}; words and marks, with "strokes" for line work; picture coordinates - check each against view.png), also in ${join(dir, 'blobs.json')}:`);
      if (blobs.length > 40) console.log(`${blobTable(blobs.slice(0, 40))}\n    … ${blobs.length - 40} more in blobs.json`);
      else if (blobs.length) console.log(blobTable(blobs));
    }
    if (strokes?.strokes.length) {
      console.log(`  brush strokes (${strokes.strokes.length}; thick paint, taken out of the blobs above; class, colour and words are hints - check each against view.png), also in ${join(dir, 'strokes.json')}; every point as PicScript lists in ${join(dir, 'strokes.pic')}:`);
      console.log(strokeTable(strokes.strokes, strokes.layers));
    }
    const again = ['pnpm', 'grid', args.image];
    if (args.tile) again.push('--tile', `${args.tile.cols}x${args.tile.rows}:${args.tile.c},${args.tile.r}`);
    if (args.trim) again.push('--trim');
    if (args.brighten !== undefined) again.push('--brighten', String(args.brighten));
    if (!args.layout) again.push('--crop', `${region.x},${region.y},${region.w},${region.h}`);
    if (args.fit && !args.layout) again.push('--fit');
    if (args.vga) again.push('--vga');
    if (args.name) again.push('--name', args.name);
    console.log(`  reproduce: ${again.map(shq).join(' ')}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.vga) usePicture('vga');
  run(args);
} catch (e) {
  if (e instanceof UsageError) {
    console.error(`grid: ${e.message}`);
    process.exit(2);
  }
  if (e instanceof MagickError) {
    console.error(`grid: ImageMagick failed: ${e.message}`);
    process.exit(1);
  }
  throw e;
}
