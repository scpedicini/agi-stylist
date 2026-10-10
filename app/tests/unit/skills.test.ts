// The skills are instructions for an agent: every file, command and scene they mention must exist,
// and the worked examples must be real, clean scenes.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileProgram, declaredVariants, DEFAULT_VARIANT, parse } from '../../src/lang/index.ts';
import { stdlib } from '../../scripts/lib/stdlib.ts';

const SKILLS = 'skills';
const skillDirs = ['old-adventure-game-draw', 'old-adventure-game-from-image'].map((s) => join(SKILLS, s));
const docs = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? docs(join(dir, e.name)) : e.name.endsWith('.md') ? [join(dir, e.name)] : [],
  );
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };

/** Does a path exist? Supports a `*` wildcard in the file name (e.g. `examples/*.pic`). */
function exists(p: string): boolean {
  if (!p.includes('*')) return existsSync(p.replace(/\/$/, ''));
  const dir = dirname(p);
  const re = new RegExp(`^${basename(p).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
  return existsSync(dir) && readdirSync(dir).some((f) => re.test(f));
}

describe.each(skillDirs)('skill %s', (dir) => {
  const skillMd = readFileSync(join(dir, 'SKILL.md'), 'utf8');

  it('has frontmatter naming its folder, with a description', () => {
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(skillMd)?.[1] ?? '';
    const field = (k: string) => new RegExp(`^${k}:\\s*(.+)$`, 'm').exec(fm)?.[1].trim();
    expect(field('name')).toBe(basename(dir));
    expect(field('description')?.length ?? 0).toBeGreaterThan(80);
  });

  it.each(docs(dir))('every path and pnpm script mentioned in %s exists', (doc) => {
    const text = readFileSync(doc, 'utf8');
    const missing: string[] = [];
    // `references/…`, `examples/…`, `../other-skill/…` are relative to the skill folder; the rest
    // (`scenes/…`, `app/…`, `reference/…`, `design/…`, `docs/…`, and stale `src/…`/`scripts/…`) to the project root.
    // Placeholders like `<slug>` are skipped.
    const pathRe = /`((?:\.\.\/[\w-]+\/)?(?:SKILL\.md|(?:references|examples|scenes|app|src|scripts|reference|design|docs)\/[\w./*-]*))`/g;
    for (const [, p] of text.matchAll(pathRe)) {
      if (p.includes('<')) continue;
      const rel = /^(\.\.\/|references\/|examples\/|SKILL\.md)/.test(p) ? resolve(dir, p) : p;
      if (!exists(rel)) missing.push(p);
    }
    for (const [, s] of text.matchAll(/pnpm ([a-z][\w:-]*)/g)) {
      if (['install', 'exec', 'add'].includes(s)) continue;
      if (!pkg.scripts[s]) missing.push(`pnpm ${s}`);
    }
    expect(missing).toEqual([]);
  });
});

describe('from-image worked examples', () => {
  const guide = readFileSync(join(SKILLS, 'old-adventure-game-from-image/references/translating.md'), 'utf8');
  const listed = [...new Set([...guide.matchAll(/^\| `(scenes\/[\w/-]+\.pic)` \|/gm)].map((m) => m[1]))].sort();

  it('lists the translated example scenes', () => {
    expect(listed).toEqual([
      'scenes/custom/elk-valley.pic',
      'scenes/custom/wizard-library.pic',
      'scenes/kq6/r03-c01.pic',
      'scenes/kq6/r03-c10.pic',
      'scenes/kq6/r05-c07.pic',
      'scenes/kq6/r05-c11.pic',
      'scenes/kq6/r07-c01.pic',
      'scenes/kq6/r07-c02.pic',
      'scenes/kq6/r07-c04.pic',
      'scenes/kq6/r08-c01.pic',
    ]);
  });

  it.each(listed)('%s has a complete header, a reproducible source and compiles cleanly in every variant', (file) => {
    const src = readFileSync(file, 'utf8');
    const head = src.split('\n').slice(0, 15).join('\n');
    for (const k of ['Source', 'Method', 'Colours']) expect(head).toMatch(new RegExp(`^# ${k}: \\S.{20,}`, 'm'));
    // the reproduce line names the scene's slug (its file name, or <group>-<file> outside custom/),
    // and a source inside the repo must exist
    const grid = /pnpm grid (\S+)[^\n]*--name ([\w-]+)/.exec(head.replace(/\n#\s+/g, ' '));
    const [, group, stem] = /^scenes\/([\w-]+)\/([\w-]+)\.pic$/.exec(file)!;
    expect([stem, `${group}-${stem}`]).toContain(grid?.[2]);
    if (grid && !grid[1].startsWith('<')) expect(existsSync(grid[1])).toBe(true);
    const program = parse(src, file);
    const variants = declaredVariants(program);
    for (const variant of variants.length ? variants : [DEFAULT_VARIANT]) {
      expect(compileProgram(program, { prelude: stdlib(), variant }).warnings).toEqual([]);
    }
  });
});

describe('sketch-mode worked examples', () => {
  const guide = readFileSync(join(SKILLS, 'old-adventure-game-from-image/references/sketches.md'), 'utf8');
  const listed = [...new Set([...guide.matchAll(/^\| `(scenes\/[\w/-]+\.pic)` \|/gm)].map((m) => m[1]))].sort();

  it('lists sketch scenes', () => {
    expect(listed.length).toBeGreaterThanOrEqual(3);
    for (const f of listed) expect(f).toMatch(/^scenes\/sketches\//);
  });

  it.each(listed)('%s records its sketch, brief and decisions, reproduces, and compiles cleanly', (file) => {
    const src = readFileSync(file, 'utf8');
    const head = src.split('\n').slice(0, 25).join('\n');
    for (const k of ['Source', 'Brief', 'Method', 'Interpreted']) expect(head).toMatch(new RegExp(`^# ${k}: \\S.{10,}`, 'm'));
    const grid = /pnpm grid (\S+)[^\n]*--name ([\w-]+)/.exec(head.replace(/\n#\s+/g, ' '));
    const [, group, stem] = /^scenes\/([\w-]+)\/([\w-]+)\.pic$/.exec(file)!;
    expect([stem, `${group}-${stem}`]).toContain(grid?.[2]);
    expect(existsSync(grid![1])).toBe(true);
    const program = parse(src, file);
    const variants = declaredVariants(program);
    for (const variant of variants.length ? variants : [DEFAULT_VARIANT]) {
      expect(compileProgram(program, { prelude: stdlib(), variant }).warnings).toEqual([]);
    }
  });
});
