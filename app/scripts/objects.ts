// Export a scene's objects (`object "id" { … }` blocks) for a game engine.
//
//   pnpm objects <scene.pic>... [--variant <name>|all] [--out <dir>] [--name <slug>]
//
// Writes <out>/<name>[-<variant>]/ (out defaults to out/objects; <name> is the scene file's name
// or --name, for one scene). The PNGs are at the logical resolution, each pixel shown twice as
// wide as tall; full, base and the layers are the whole 160×168 picture, sprites are cropped:
//   full.png              the picture
//   base.png              the picture with every object hidden
//   sprites/<id>.png      what shows of the object (and of anything inside it), cropped to its box
//                         (manifest: box), transparent elsewhere: a hotspot mask or a sprite
//   layers/NN-<id>.png    the picture in runs of one owner each (NN-base.png: no object), in
//                         painting order, transparent where the run didn't paint
//   manifest.json         size, pixel aspect, canvas colour, the objects (id, parent, source line,
//                         box, visible pixel count, sprite) and the layers (file, object)
// To show the scene with some objects hidden: fill the canvas colour, then draw every layer in
// order, skipping a layer whose object, or an object it is inside, is hidden. That is exact for
// any choice of hidden objects; base.png plus sprites alone isn't (a vase hides part of a table).
//
// Exporting every variant (--variant all) also removes this scene's exports of variants it no
// longer declares. Two exports that would land in the same folder are an error (use --name).
//
// Exit codes: 0 ok, 1 a scene failed to compile, had no objects or was too big to record, or two
// exports would collide, 2 bad arguments.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { PNG } from 'pngjs';
import { PIC_HEIGHT, PIC_WIDTH } from '../src/engine/framebuffer.ts';
import { maskBox, ObjectModel } from '../src/engine/objects.ts';
import { EGA_PALETTE } from '../src/engine/palette.ts';
import { compileProgram, declaredVariants, DEFAULT_VARIANT, formatDiagnostic, parse, PicError } from '../src/lang/index.ts';
import { stdlib } from './lib/stdlib.ts';

class UsageError extends Error {}

interface Args {
  files: string[];
  variant?: string;
  out: string;
  name?: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { files: [], out: join('out', 'objects') };
  const value = (i: number, name: string) => {
    const v = argv[i];
    if (v === undefined || v.startsWith('--')) throw new UsageError(`${name} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--') continue; // tolerate `pnpm objects -- …`
    if (v === '--variant') a.variant = value(++i, '--variant');
    else if (v === '--out') a.out = value(++i, '--out');
    else if (v === '--name') {
      a.name = value(++i, '--name');
      if (!/^[\w.-]+$/.test(a.name) || /^\.+$/.test(a.name)) throw new UsageError('--name may only use letters, digits, - _ and .');
    } else if (v === '--help' || v === '-h') {
      console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
      process.exit(0);
    } else if (v.startsWith('-')) throw new UsageError(`unknown option '${v}' (try --help)`);
    else a.files.push(v);
  }
  if (!a.files.length) throw new UsageError('no scene files given (try --help)');
  if (a.name && a.files.length > 1) throw new UsageError('--name only works with a single scene');
  return a;
}

const hex = (c: number) => '#' + EGA_PALETTE[c].map((v) => v.toString(16).padStart(2, '0')).join('');

/** Write palette `pixels` where `alpha` is set (everywhere without it), cropped to `box`, as RGBA. */
function writePng(path: string, pixels: Uint8Array, alpha: Uint8Array | null, box: [number, number, number, number] = [0, 0, PIC_WIDTH - 1, PIC_HEIGHT - 1]) {
  const [x1, y1, x2, y2] = box;
  const png = new PNG({ width: x2 - x1 + 1, height: y2 - y1 + 1 });
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      const i = y * PIC_WIDTH + x;
      const o = ((y - y1) * png.width + (x - x1)) * 4;
      if (alpha && !alpha[i]) continue; // stays transparent black
      png.data.set([...EGA_PALETTE[pixels[i]], 255], o);
    }
  }
  writeFileSync(path, PNG.sync.write(png));
}

let args: Args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (e) {
  if (!(e instanceof UsageError)) throw e;
  console.error(`objects: ${e.message}`);
  process.exit(2);
}

let failed = false;
/** Folders written this run, and by which scene and variant. */
const written = new Map<string, string>();
for (const file of args.files) {
  if (!existsSync(file)) {
    console.error(`error: ${file}: no such file`);
    failed = true;
    continue;
  }
  const name = args.name ?? basename(file, '.pic');
  if (!/^[\w.-]+$/.test(name) || /^\.+$/.test(name)) {
    console.error(`error: ${file}: '${name}' can't name an export folder - use --name`);
    failed = true;
    continue;
  }
  let program;
  try {
    program = parse(readFileSync(file, 'utf8'), file);
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
    let r;
    try {
      r = compileProgram(program, { variant, prelude: stdlib() });
    } catch (e) {
      if (!(e instanceof PicError)) throw e;
      console.error(`error: [${variant}] ${e.message}`);
      failed = true;
      continue;
    }
    for (const w of r.warnings) console.log(`warning: ${formatDiagnostic(w)}`);
    if (!r.objects.length) {
      console.error(`error: [${variant}] ${file} has no objects - wrap each thing in an object "id" { … } block`);
      failed = true;
      continue;
    }
    const m = ObjectModel.create(r.ops, r.objects);
    if (!m) {
      console.error(`error: [${variant}] ${file}: too many pixel writes to record its objects`);
      failed = true;
      continue;
    }
    const suffix = variants.length > 1 || args.variant ? `-${variant}` : '';
    const dir = join(args.out, `${name}${suffix}`);
    const what = `${file} [${variant}]`;
    if (!resolve(dir).startsWith(resolve(args.out) + sep)) throw new Error(`refusing to write outside ${args.out}: ${dir}`);
    if (written.has(dir)) {
      console.error(`error: ${what} would overwrite the export of ${written.get(dir)} in ${dir}/ - export it on its own with --name`);
      failed = true;
      continue;
    }
    written.set(dir, what);
    // the previous export's sprites and layers go: objects may have been renamed or removed
    rmSync(join(dir, 'sprites'), { recursive: true, force: true });
    rmSync(join(dir, 'layers'), { recursive: true, force: true });
    mkdirSync(join(dir, 'sprites'), { recursive: true });
    mkdirSync(join(dir, 'layers'), { recursive: true });

    const full = m.compose();
    writePng(join(dir, 'full.png'), full.pixels, null);
    writePng(join(dir, 'base.png'), m.compose(m.objects.map((_, i) => i)).pixels, null);
    const objects = m.objects.map((o, i) => {
      const shown = m.visible(full, i);
      const box = maskBox(shown);
      const sprite = box ? `sprites/${o.id}.png` : null;
      if (box) writePng(join(dir, sprite!), full.pixels, shown, box);
      return {
        id: o.id,
        parent: o.parent >= 0 ? m.objects[o.parent].id : null,
        line: o.src.line,
        box,
        pixels: shown.reduce((a, b) => a + b, 0),
        sprite,
      };
    });
    const layers = m.layers();
    const width = Math.max(2, String(layers.length - 1).length);
    const layerList = layers.map((l, n) => {
      const id = l.object >= 0 ? m.objects[l.object].id : null;
      const f = `layers/${String(n).padStart(width, '0')}-${id ?? 'base'}.png`;
      writePng(join(dir, f), l.pixels, l.alpha);
      return { file: f, object: id };
    });
    const manifest = {
      scene: r.title ?? name,
      source: file,
      variant: r.variant,
      width: PIC_WIDTH,
      height: PIC_HEIGHT,
      pixelAspect: 2,
      canvas: hex(m.canvas),
      full: 'full.png',
      base: 'base.png',
      compose:
        'Fill the canvas colour, then draw every layer in order, skipping a layer whose object, or an object it is inside (parent), is hidden. ' +
        'Boxes are inclusive [x1, y1, x2, y2] in picture pixels; a sprite covers its box.',
      objects,
      layers: layerList,
    };
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    const listed = objects.map((o) => `    ${o.parent ? `${o.parent}/` : ''}${o.id}${o.box ? `  ${o.box.join(',').replace(/^(\d+,\d+),/, '$1-')}  ${o.pixels} px` : '  (not visible)'}`);
    console.log(`${dir}/  "${manifest.scene}" [${r.variant}]  ${objects.length} object(s), ${layerList.length} layer(s)\n${listed.join('\n')}`);
  }
  if (args.variant === 'all' && existsSync(args.out)) {
    // exports of this scene's variants that it no longer declares
    for (const d of readdirSync(args.out)) {
      if (d !== name && !d.startsWith(`${name}-`)) continue;
      const m = join(args.out, d, 'manifest.json');
      if (!existsSync(m) || written.has(join(args.out, d))) continue;
      try {
        const old = JSON.parse(readFileSync(m, 'utf8'));
        if (resolve(old.source) !== resolve(file) || all.includes(old.variant)) continue;
      } catch {
        continue;
      }
      rmSync(join(args.out, d), { recursive: true, force: true });
      console.log(`removed ${join(args.out, d)}/ (the scene no longer has that variant)`);
    }
  }
}
process.exit(failed ? 1 : 0);
