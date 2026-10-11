// Lint PicScript scenes: compile every variant and check for the classic AGI-painting mistakes.
//
//   pnpm lint:pic [<scene.pic>...] [--strict]
//
// With no files, lints every scene under scenes/. The generated scenes in scenes/kq1/ get a
// compile-only check (they are machine-made and verified pixel-exact by the golden tests).
//
// Errors   - syntax/runtime errors in any variant (each variant is compiled on its own).
// Warnings - clamped points; fills that painted nothing (seed not on white: fill only spreads
//            into unpainted canvas); fills that flooded more than 40% of the picture (usually a
//            gap in an outline - end the line with `# lint: ok` if the big fill is intended);
//            variants that render identically.
//            Objects (`object "id" { … }`) that aren't separable: hiding any of them must show
//            exactly what was painted behind. Warned: later drawing that depends on an object
//            (re-running the script without it, a fill paints other pixels: it stopped at the
//            object's edge), checked for each object, and for each fill with every object it isn't
//            in hidden together (a fill can need any one of several objects as its border); an object
//            that paints where nothing outside it (or outside the objects it is inside) paints, so
//            hiding it can uncover bare canvas; and an object that paints nothing.
// Notes    - canvas no instruction ever painted. It shows as white (or as whatever a later remap
//            turned white into), usually a gap between shapes.
// --strict makes warnings fail too. Exit codes: 0 ok, 1 errors (or warnings with --strict),
// 2 bad arguments.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Painter } from '../src/engine/execute.ts';
import { maskBox, ObjectModel } from '../src/engine/objects.ts';
import { PIC_HEIGHT, PIC_WIDTH } from '../src/engine/framebuffer.ts';
import { compileProgram, declaredVariants, DEFAULT_VARIANT, formatDiagnostic, parse, PicError } from '../src/lang/index.ts';
import { stdlib } from './lib/stdlib.ts';

const LEAK_FRACTION = 0.4;
const argv = process.argv.slice(2).filter((a) => a !== '--'); // tolerate `pnpm lint:pic -- …`
const unknown = argv.find((a) => a.startsWith('-') && a !== '--strict');
if (unknown) {
  console.error(`lint:pic: unknown option '${unknown}' (only --strict is supported)`);
  process.exit(2);
}
const strict = argv.includes('--strict');
const walk = (dir: string): string[] =>
  readdirSync(dir)
    .sort()
    .flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.pic') ? [p] : [];
    });
const files = argv.filter((a) => !a.startsWith('-'));
const targets = files.length ? files : walk('scenes');
const generated = (f: string) => /(^|\/)scenes\/kq1\//.test(f);

const box = (mask: Uint8Array) => maskBox(mask)!.join(',').replace(/^(\d+,\d+),/, '$1-');

/** Can every object be hidden cleanly? See the header. */
function checkObjects(m: ObjectModel, warn: (msg: string) => void) {
  const count = (mask: Uint8Array) => mask.reduce((a, b) => a + b, 0);
  const fix = 'a fill stopped at its edge; give the fill its own border, or draw the object after it';
  let depends = false;
  m.objects.forEach((o, i) => {
    const name = `object '${o.id}' (line ${o.src.line})`;
    if (!m.footprint(i).includes(1)) return warn(`${name} paints nothing`);
    const d = m.dependence([i]);
    if (d.includes(1)) {
      depends = true;
      warn(`later drawing depends on ${name}: without it, ${count(d)} px paint differently (in ${box(d)}) - ${fix}`);
    }
    const bare = m.bare(i);
    if (bare.includes(1)) warn(`hiding ${name} can uncover ${count(bare)} px of bare canvas (in ${box(bare)}) - nothing outside it paints there; paint what's behind it first`);
  });
  if (depends || m.objects.length < 2) return;
  // A fill can need any one of several objects as its border: hide every object the fill isn't
  // in (the ones it is in can't be hidden without hiding the fill too), for each object with fills.
  const owners = new Set(m.ops.filter((op) => op.kind === 'fill').map((op) => op.obj ?? -1));
  for (const f of owners) {
    const hidden = m.objects.map((_, i) => i).filter((i) => f < 0 || !m.within(f, i));
    const d = m.dependence(hidden);
    const whose = f < 0 ? 'with every object hidden' : `with every object hidden but '${m.objects[f].id}' (and what it's in)`;
    if (d.includes(1)) warn(`later drawing depends on the objects together: ${whose}, ${count(d)} px paint differently (in ${box(d)}) - ${fix}`);
  }
}

let errors = 0;
let warnings = 0;
let compileOnly = 0;
const total = PIC_WIDTH * PIC_HEIGHT;

for (const file of targets) {
  const out: string[] = [];
  const say = (kind: 'error' | 'warning' | 'note', msg: string) => {
    if (kind === 'error') errors++;
    if (kind === 'warning') warnings++;
    out.push(`  ${kind}: ${msg}`);
  };
  if (!existsSync(file)) {
    say('error', `${file}: no such file`);
    console.log(`✖ ${file}`);
    for (const l of out) console.log(l);
    continue;
  }
  const source = readFileSync(file, 'utf8');
  const sourceLines = source.split('\n');
  let program;
  try {
    program = parse(source, file);
  } catch (e) {
    if (!(e instanceof PicError)) throw e;
    say('error', e.message);
  }
  if (program) {
    const declared = declaredVariants(program);
    const hashes = new Map<string, string>();
    for (const variant of declared.length ? declared : [DEFAULT_VARIANT]) {
      let r;
      try {
        r = compileProgram(program, { prelude: stdlib(), variant });
      } catch (e) {
        if (!(e instanceof PicError)) throw e;
        say('error', `[${variant}] ${e.message}`);
        continue;
      }
      for (const w of r.warnings) say('warning', `[${variant}] ${formatDiagnostic(w)}`);
      if (generated(file)) continue;
      const painter = new Painter();
      painter.touched = new Uint8Array(total);
      const before = new Uint8Array(total);
      for (const op of r.ops) {
        if (op.kind !== 'fill') {
          painter.apply(op);
          continue;
        }
        before.set(painter.fb.pixels);
        painter.apply(op);
        let painted = 0;
        for (let i = 0; i < total; i++) if (before[i] !== painter.fb.pixels[i]) painted++;
        const where = op.src ? `${op.src.file}:${op.src.line}` : file;
        if (op.src && /#\s*lint:\s*ok/.test(sourceLines[op.src.line - 1] ?? '')) continue;
        if (painted === 0) {
          say('warning', `[${variant}] ${where}: fill painted nothing - its seed is not on white canvas (fill only spreads into unpainted white; was the area already painted?)`);
        } else if (painted > total * LEAK_FRACTION) {
          say('warning', `[${variant}] ${where}: fill flooded ${((100 * painted) / total).toFixed(0)}% of the picture - check the outline for a gap (end the line with '# lint: ok' if intended)`);
        }
      }
      let unpainted = 0;
      let x1 = PIC_WIDTH, y1 = PIC_HEIGHT, x2 = -1, y2 = -1;
      for (let y = 0; y < PIC_HEIGHT; y++) {
        for (let x = 0; x < PIC_WIDTH; x++) {
          if (painter.touched[y * PIC_WIDTH + x]) continue;
          unpainted++;
          x1 = Math.min(x1, x);
          y1 = Math.min(y1, y);
          x2 = Math.max(x2, x);
          y2 = Math.max(y2, y);
        }
      }
      if (r.objects.length) {
        const m = ObjectModel.create(r.ops, r.objects);
        if (!m) say('warning', `[${variant}] too many pixel writes to check its objects can be hidden`);
        else checkObjects(m, (msg) => say('warning', `[${variant}] ${msg}`));
      }
      if (unpainted) say('note', `[${variant}] ${unpainted} px of canvas were never painted (in ${x1},${y1}-${x2},${y2}) - they show as white, or as white's colour after a remap; a gap between shapes?`);
      hashes.set(variant, painter.fb.hash());
    }
    const seen = new Map<string, string>();
    for (const [v, h] of hashes) {
      if (seen.has(h)) say('warning', `variants '${seen.get(h)}' and '${v}' render identically`);
      else seen.set(h, v);
    }
  }
  if (generated(file)) compileOnly++;
  const mark = out.some((l) => l.includes('error:')) ? '✖' : out.some((l) => l.includes('warning:')) ? '⚠' : '✔';
  // when linting everything, list generated scenes only if something is wrong with them
  if (!(generated(file) && mark === '✔' && !files.length)) console.log(`${mark} ${file}${generated(file) ? ' (generated: compile check only)' : ''}`);
  for (const l of out) console.log(l);
}
if (compileOnly && !files.length) console.log(`✔ ${compileOnly} generated scenes in scenes/kq1/ (compile check only)`);
console.log(`\n${targets.length} scene(s): ${errors} error(s), ${warnings} warning(s)`);
process.exit(errors || (strict && warnings) ? 1 : 0);
