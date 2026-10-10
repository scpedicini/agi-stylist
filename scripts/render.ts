// Render PicScript scenes to PNG.
//
//   pnpm render <scene.pic>... [--variant <name>|all] [--out <dir>] [--scale <n>]
//                                    [--compare [<reference.png>] [--confusion]] [--steps <n>]
//                                    [--crop x1,y1,x2,y2] [--beside <picture.png>] [--grid]
//                                    [--overlay <ink.png>] [--name <slug>]
//
// Writes <out>/<name>[-<variant>].png at display aspect (each logical pixel is 2·scale × scale,
// scale 1-16, default 2). With no --variant the scene's default (first) variant is rendered.
// --compare puts reference | rendered | diff side by side and prints the % match; with no path
// it uses the scene's `# @reference <group/id>` header (or reference/kq1/<id>.png for kq1 scenes).
// --confusion (with --compare) lists the biggest "wanted colour X, got colour Y" mismatches
// with their bounding boxes - the quickest way to see what to fix next.
// <name> is the scene file's name, or --name <slug> (one scene only), e.g. for a scene stored as
// scenes/kq6/r03-c01.pic that you want written as out/kq6-r03-c01-day.png.
// --crop x1,y1,x2,y2 zooms in on part of the picture (combine with a big --scale, e.g. 8) to
// inspect small details. The corners are inclusive picture pixels (x 0-159, y 0-167); a corner
// past the edge is pulled back onto it.
// --grid overlays a 10-pixel grid with picture coordinates on every panel, for checking
// positions against the source.
// --beside <png> puts a full-colour 160×168 picture to the left of the render - normally the
// picture.png that `pnpm grid <image>` writes when you work from a source image. Combines with
// --compare and --crop.
// --overlay <png> also writes <name>[-<variant>]-overlay.png: the render with an image that covers
// the whole picture (any size, display aspect) drawn over it - normally the ink.png that
// `pnpm grid --fit` writes for a layout sketch, so you can see whether each object sits under its
// label. The plain render is written as usual, and --grid then goes on the overlay render only.
// Only the scene panel gets the overlay (not --beside, the --compare reference or diff, or
// --steps); match scores are unaffected.
// --steps N (1-50) also writes <name>[-<variant>]-steps.png: N snapshots side by side showing
// the painting order (honours --scale and --crop).
//
// Exit codes: 0 ok, 1 a scene failed to compile or had nothing to compare with, 2 bad arguments.
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { execute } from '../src/engine/execute.ts';
import { Framebuffer, PIC_HEIGHT, PIC_WIDTH } from '../src/engine/framebuffer.ts';
import { COLOR_NAMES } from '../src/engine/palette.ts';
import { compileProgram, declaredVariants, DEFAULT_VARIANT, formatDiagnostic, parse, PicError } from '../src/lang/index.ts';
import { readPicturePng, readRgbaPicturePng, readRgbaPng, writePanelsPng, type Crop, type PanelImage, type RgbaImage } from './lib/png.ts';
import { stdlib } from './lib/stdlib.ts';

interface Args {
  files: string[];
  variant?: string;
  out: string;
  scale: number;
  compare?: string | true;
  confusion: boolean;
  steps: number;
  crop?: Crop;
  beside?: string;
  overlay?: string;
  grid: boolean;
  name?: string;
}

class UsageError extends Error {}

function intOption(name: string, raw: string | undefined, min: number, max: number): number {
  if (raw === undefined || !/^\d+$/.test(raw)) throw new UsageError(`${name} needs a whole number (${min}-${max})`);
  const n = Number(raw);
  if (n < min || n > max) throw new UsageError(`${name} must be ${min}-${max}, got ${n}`);
  return n;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { files: [], out: 'out', scale: 2, steps: 0, confusion: false, grid: false };
  const value = (i: number, name: string) => {
    const v = argv[i];
    if (v === undefined || v.startsWith('--')) throw new UsageError(`${name} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--') continue; // tolerate `pnpm render -- …`
    if (v === '--variant') a.variant = value(++i, '--variant');
    else if (v === '--out') a.out = value(++i, '--out');
    else if (v === '--scale') a.scale = intOption('--scale', argv[++i], 1, 16);
    else if (v === '--steps') a.steps = intOption('--steps', argv[++i], 1, 50);
    else if (v === '--confusion') a.confusion = true;
    else if (v === '--beside') a.beside = value(++i, '--beside');
    else if (v === '--grid') a.grid = true;
    else if (v === '--overlay') a.overlay = value(++i, '--overlay');
    else if (v === '--name') {
      a.name = value(++i, '--name');
      if (!/^[\w.-]+$/.test(a.name) || /^\.+$/.test(a.name)) throw new UsageError('--name may only use letters, digits, - _ and .');
    }
    else if (v === '--crop') {
      const raw = value(++i, '--crop');
      const m = /^(\d+),(\d+),(\d+),(\d+)$/.exec(raw);
      if (!m) throw new UsageError('--crop needs inclusive corners x1,y1,x2,y2 (x 0-159, y 0-167)');
      const [x1, y1] = [Number(m[1]), Number(m[2])];
      // a far corner past the edge is pulled back onto the picture (e.g. 160 → 159)
      const [x2, y2] = [Math.min(Number(m[3]), PIC_WIDTH - 1), Math.min(Number(m[4]), PIC_HEIGHT - 1)];
      if (x2 < x1 || y2 < y1) {
        throw new UsageError('--crop needs inclusive corners x1,y1,x2,y2 with x1 ≤ x2 and y1 ≤ y2, inside 0-159 × 0-167');
      }
      a.crop = { x: x1, y: y1, w: x2 - x1 + 1, h: y2 - y1 + 1 };
    } else if (v === '--compare') a.compare = argv[i + 1]?.endsWith('.png') ? argv[++i] : true;
    else if (v === '--help' || v === '-h') {
      console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
      process.exit(0);
    } else if (v.startsWith('-')) throw new UsageError(`unknown option '${v}' (try --help)`);
    else a.files.push(v);
  }
  if (!a.files.length) throw new UsageError('no scene files given (try --help)');
  if (a.name && a.files.length > 1) throw new UsageError('--name only works with a single scene');
  if (a.confusion && !a.compare) throw new UsageError('--confusion only works together with --compare');
  if (a.beside) {
    if (!existsSync(a.beside)) throw new UsageError(`--beside: ${a.beside}: no such file`);
    try {
      readRgbaPicturePng(a.beside);
    } catch (e) {
      throw new UsageError(`--beside: ${(e as Error).message} - make one with 'pnpm grid <image>' (it writes out/source/<name>/picture.png)`);
    }
  }
  if (a.overlay) {
    if (!existsSync(a.overlay)) throw new UsageError(`--overlay: ${a.overlay}: no such file`);
    let img: RgbaImage;
    try {
      img = readRgbaPng(a.overlay);
    } catch (e) {
      throw new UsageError(`--overlay: ${a.overlay}: ${(e as Error).message}`);
    }
    const aspect = img.width / img.height / ((PIC_WIDTH * 2) / PIC_HEIGHT);
    if (Math.abs(aspect - 1) > 0.03) {
      throw new UsageError(`--overlay: ${a.overlay} is ${img.width}×${img.height}; it must cover the picture at display aspect (320:168, e.g. 960×504) - use the ink.png from 'pnpm grid --fit'`);
    }
  }
  return a;
}

/** Top "wanted X, got Y" mismatch pairs with bounding boxes. */
function confusion(target: Framebuffer, fb: Framebuffer, top = 10): string {
  const m = new Map<string, { n: number; x1: number; y1: number; x2: number; y2: number }>();
  for (let i = 0; i < fb.pixels.length; i++) {
    if (fb.pixels[i] === target.pixels[i]) continue;
    const k = `want ${COLOR_NAMES[target.pixels[i]]}, got ${COLOR_NAMES[fb.pixels[i]]}`;
    const x = i % PIC_WIDTH;
    const y = Math.floor(i / PIC_WIDTH);
    const e = m.get(k) ?? { n: 0, x1: x, y1: y, x2: x, y2: y };
    e.n++;
    e.x1 = Math.min(e.x1, x);
    e.y1 = Math.min(e.y1, y);
    e.x2 = Math.max(e.x2, x);
    e.y2 = Math.max(e.y2, y);
    m.set(k, e);
  }
  return [...m]
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, top)
    .map(([k, e]) => `    ${String(e.n).padStart(5)} px  ${k}  (in ${e.x1},${e.y1}-${e.x2},${e.y2})`)
    .join('\n');
}

function referenceFor(file: string, source: string): string | undefined {
  const m = /^#\s*@reference\s+(\S+)/m.exec(source);
  if (m) return `reference/${m[1]}.png`;
  const rel = relative('scenes', file);
  if (rel.startsWith('kq1/')) return `reference/${rel.replace(/\.pic$/, '.png')}`;
  return undefined;
}

let args: Args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (e) {
  if (!(e instanceof UsageError)) throw e;
  console.error(`render: ${e.message}`);
  process.exit(2);
}

const beside: PanelImage[] = args.beside ? [{ rgba: readRgbaPicturePng(args.beside) }] : [];
const overlay = args.overlay ? readRgbaPng(args.overlay) : undefined;
let failed = false;
for (const file of args.files) {
  if (!existsSync(file)) {
    console.error(`error: ${file}: no such file`);
    failed = true;
    continue;
  }
  const source = readFileSync(file, 'utf8');
  const name = args.name ?? basename(file, '.pic');
  let program;
  try {
    program = parse(source, file);
  } catch (e) {
    if (!(e instanceof PicError)) throw e;
    console.error(`error: ${e.message}`);
    failed = true;
    continue;
  }
  const declared = declaredVariants(program);
  const all = declared.length ? declared : [DEFAULT_VARIANT];
  const variants = args.variant === 'all' ? all : [args.variant ?? all[0]];
  for (const variant of variants) {
    // each variant compiles on its own, so one broken variant can't hide the others
    let r;
    try {
      r = compileProgram(program, { variant, prelude: stdlib() });
    } catch (e) {
      if (!(e instanceof PicError)) throw e;
      console.error(`error: [${variant}] ${e.message}`);
      failed = true;
      continue;
    }
    const fb = execute(r.ops);
    const suffix = variants.length > 1 || args.variant ? `-${variant}` : '';
    const outPath = join(args.out, `${name}${suffix}.png`);
    const overlayPath = join(args.out, `${name}${suffix}-overlay.png`);
    for (const w of r.warnings) console.log(`warning: ${formatDiagnostic(w)}`);
    for (const l of r.logs) console.log(l);
    let line = `${outPath}  ${r.title ? `"${r.title}" ` : ''}[${variant}]  ${r.ops.length} ops`;
    if (args.compare) {
      const ref = args.compare === true ? referenceFor(file, source) : args.compare;
      if (!ref || !existsSync(ref)) {
        console.error(`${file}: no reference picture to compare with (add '# @reference kq1/rRR-cCC' or pass --compare <png>)`);
        failed = true;
        continue;
      }
      const target = readPicturePng(ref);
      const mask = new Uint8Array(fb.pixels.length);
      let diff = 0;
      for (let i = 0; i < mask.length; i++) if (fb.pixels[i] !== target.pixels[i]) (mask[i] = 1), diff++;
      writePanelsPng(outPath, [...beside, { fb: target }, { fb }, { fb, mask }], args.scale, args.crop, { grid: args.grid && !overlay });
      if (overlay) writePanelsPng(overlayPath, [...beside, { fb: target }, { fb, overlay }, { fb, mask }], args.scale, args.crop, { grid: args.grid });
      line += `  match ${((100 * (mask.length - diff)) / mask.length).toFixed(2)}% (${diff} px differ, vs ${ref})`;
      if (args.confusion) line += '\n' + confusion(target, fb);
    } else {
      writePanelsPng(outPath, [...beside, { fb }], args.scale, args.crop, { grid: args.grid && !overlay });
      if (overlay) writePanelsPng(overlayPath, [...beside, { fb, overlay }], args.scale, args.crop, { grid: args.grid });
    }
    if (args.beside) line += `  (beside ${args.beside})`;
    if (overlay) line += `\n    with the overlay (${args.overlay}): ${overlayPath}`;
    if (args.steps > 0) {
      const frames: Array<{ fb: Framebuffer }> = [];
      for (let k = 1; k <= args.steps; k++) frames.push({ fb: execute(r.ops, Math.round((r.ops.length * k) / args.steps)) });
      const stepsPath = join(args.out, `${name}${suffix}-steps.png`);
      writePanelsPng(stepsPath, frames, args.scale, args.crop, { grid: args.grid });
      line += `\n    painting order: ${stepsPath}`;
    }
    console.log(line);
  }
}
process.exit(failed ? 1 : 0);
