// Trace every reference/kq1/*.png into scenes/kq1/*.pic, verifying each is pixel-exact.
// Usage: pnpm trace [-- r01-c01 ...]
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { estimateAgiBytes, execute } from '../src/engine/execute.ts';
import { compile } from '../src/lang/index.ts';
import { opsToPicScript, patchOps, traceOps } from '../src/trace/tracer.ts';
import { readPicturePng } from './lib/png.ts';

const only = new Set(process.argv.slice(2).filter((a) => a !== '--'));
const files = readdirSync('reference/kq1').filter((f) => f.endsWith('.png')).sort();
mkdirSync('scenes/kq1', { recursive: true });
let failures = 0;
let totalBytes = 0;
const t0 = Date.now();
for (const f of files) {
  const id = f.replace(/\.png$/, '');
  if (only.size && !only.has(id)) continue;
  const target = readPicturePng(`reference/kq1/${f}`);
  const t = Date.now();
  const ops = patchOps(target, traceOps(target));
  const [, r, c] = /^r(\d+)-c(\d+)$/.exec(id)!;
  const src = opsToPicScript(ops, {
    title: `KQ1 row ${Number(r)}, column ${Number(c)}`,
    comment: [
      `King's Quest I background, row ${Number(r)} column ${Number(c)}.`,
      'Auto-traced by scripts/trace.ts (outline-then-fill) - reproduces reference/kq1/' + f + ' exactly.',
      'Regenerate with `pnpm trace`; do not edit by hand.',
    ],
  });
  // Verify through the full PicScript pipeline, not just the op list.
  const compiled = compile(src, { file: `scenes/kq1/${id}.pic` });
  const diff = execute(compiled.ops).diffCount(target);
  const bytes = estimateAgiBytes(compiled.ops);
  totalBytes += bytes;
  if (diff) {
    failures++;
    console.error(`${id}: trace is not exact (${diff} px differ) - keeping the existing scenes/kq1/${id}.pic`);
    continue;
  }
  writeFileSync(`scenes/kq1/${id}.pic`, src);
  console.log(`${id}  ops=${String(compiled.ops.length).padStart(4)}  ~${String(bytes).padStart(5)} AGI bytes  diff=${diff}  ${Date.now() - t}ms`);
}
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s, ~${totalBytes} AGI bytes total, ${failures} failures`);
if (failures) process.exit(1);
