import { MAX_TEXTURE, type PenShape } from '../engine/brush.ts';
import { PIC_HEIGHT, PIC_WIDTH } from '../engine/framebuffer.ts';
import type { Op, SceneObject, SourceRef } from '../engine/ops.ts';
import { COLOR_ALIASES, COLOR_NAMES } from '../engine/palette.ts';
import type { Arg, Expr, Program, Stmt } from './ast.ts';
import { PicError, type Diagnostic, type Loc } from './errors.ts';
import { parse } from './parser.ts';

// ---------------------------------------------------------------------------
// Values

export type Value = number | string | boolean | null | Value[] | FnValue;

export type FnValue =
  | { kind: 'fn'; name: string; params: Extract<Stmt, { type: 'fn' }>['params']; body: Stmt[]; closure: Env }
  | { kind: 'builtin'; name: string; call: (args: Value[], named: Record<string, Value>, at: Loc) => Value };

const isFn = (v: Value): v is FnValue => typeof v === 'object' && v !== null && !Array.isArray(v);

class Env {
  private readonly vars = new Map<string, Value>();
  /** Built-ins live in a read-only env: they can be shadowed with `let` but not reassigned. */
  constructor(
    readonly parent?: Env,
    readonly readonly = false,
  ) {}
  has(name: string): boolean {
    return this.vars.has(name) || !!this.parent?.has(name);
  }
  get(name: string): Value | undefined {
    if (this.vars.has(name)) return this.vars.get(name);
    return this.parent?.get(name);
  }
  declare(name: string, v: Value) {
    this.vars.set(name, v);
  }
  /** Returns 'ok', 'readonly' (found in the built-in env) or 'missing'. */
  assign(name: string, v: Value): 'ok' | 'readonly' | 'missing' {
    if (this.vars.has(name)) {
      if (this.readonly) return 'readonly';
      this.vars.set(name, v);
      return 'ok';
    }
    return this.parent?.assign(name, v) ?? 'missing';
  }
}

class ReturnSignal {
  constructor(readonly value: Value) {}
}

/** Thrown by `break` / `continue`; caught by the innermost loop (the parser checks one exists). */
class LoopSignal {
  constructor(readonly kind: 'break' | 'continue') {}
}

/** mulberry32 - small, fast, deterministic. */
function makeRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Public API

export interface CompileOptions {
  file?: string;
  /** Which variant to render. Defaults to the first one the scene declares. */
  variant?: string;
  /** Library source (or parsed program) evaluated before the scene, e.g. the stdlib. */
  prelude?: string | Program | null;
  seed?: number;
  maxOps?: number;
  maxSteps?: number;
}

export interface CompileResult {
  ops: Op[];
  title?: string;
  variants: string[];
  variant: string;
  /** The `object` blocks this variant ran, in the order first opened (Op.obj indexes this). */
  objects: SceneObject[];
  warnings: Diagnostic[];
  logs: string[];
}

export const DEFAULT_VARIANT = 'default';

/** Compile PicScript source to paint ops. Throws PicError on syntax or runtime errors. */
export function compile(src: string, opts: CompileOptions = {}): CompileResult {
  const program = parse(src, opts.file ?? '<scene>');
  return compileProgram(program, opts);
}

export function compileProgram(program: Program, opts: CompileOptions = {}): CompileResult {
  const variants = declaredVariants(program);
  const variant = opts.variant ?? variants[0] ?? DEFAULT_VARIANT;
  if (variants.length && !variants.includes(variant)) {
    const decl = transparent(program.body).find((s) => s.type === 'variants')!;
    throw new PicError(`unknown variant '${variant}' (this scene declares: ${variants.join(', ')})`, decl.loc);
  }
  if (!variants.length && variant !== DEFAULT_VARIANT) {
    throw new PicError(`unknown variant '${variant}' (this scene declares no variants)`, { file: program.file, line: 1, col: 1 });
  }
  checkRemapVariants(program.body, variants);
  const interp = new Interpreter(program.file, variant, opts);
  if (opts.prelude) {
    const prelude = typeof opts.prelude === 'string' ? parse(opts.prelude, 'stdlib.pic') : opts.prelude;
    interp.runPrelude(prelude);
  }
  interp.run(program);
  return {
    ops: interp.ops,
    title: interp.title,
    variants: variants.length ? variants : [DEFAULT_VARIANT],
    variant,
    objects: interp.objects,
    warnings: interp.warnings,
    logs: interp.logs,
  };
}

function checkRemapVariants(body: Stmt[], variants: string[]) {
  for (const s of body) {
    if (s.type === 'remap' && s.variant && !variants.includes(s.variant)) {
      const known = variants.length ? `this scene declares: ${variants.join(', ')}` : "add 'variants …' first";
      throw new PicError(`remap for unknown variant '${s.variant}' (${known})`, s.loc);
    }
    if (s.type === 'fn' || s.type === 'repeat' || s.type === 'for' || s.type === 'while' || s.type === 'delay' || s.type === 'object') checkRemapVariants(s.body, variants);
    if (s.type === 'if') {
      checkRemapVariants(s.then, variants);
      if (s.else) checkRemapVariants(s.else, variants);
    }
  }
}

/** Variant names declared by top-level `variants` statements, without running the scene. */
export function declaredVariants(program: Program): string[] {
  const names: string[] = [];
  for (const s of transparent(program.body)) if (s.type === 'variants') for (const n of s.names) if (!names.includes(n)) names.push(n);
  return names;
}

/**
 * A block's statements with every `delay` and `object` block opened up in place: they are
 * see-through, so what is declared in them (functions, variants) counts as declared in the block
 * around them.
 */
function transparent(body: Stmt[]): Stmt[] {
  const open = (s: Stmt) => s.type === 'delay' || s.type === 'object';
  return body.some(open) ? body.flatMap((s) => (s.type === 'delay' || s.type === 'object' ? transparent(s.body) : [s])) : body;
}

/** An object's name: kebab-case, so it is safe as a file name and in a game's data. */
const OBJECT_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

// ---------------------------------------------------------------------------
// Interpreter

interface Turtle {
  x: number;
  y: number;
  heading: number;
  down: boolean;
}

const MAX_DEPTH = 200;
const MAX_WARNINGS = 50;

class Interpreter {
  readonly ops: Op[] = [];
  readonly objects: SceneObject[] = [];
  readonly warnings: Diagnostic[] = [];
  readonly logs: string[] = [];
  title?: string;

  private readonly globals: Env;
  private sceneEnv: Env;
  private rng: () => number;
  private steps = 0;
  private depth = 0;
  private userLoc: Loc;
  /** Counts the scene statements run so far (see SourceRef.instr). */
  private instr = 0;
  /** The level of the innermost `delay` block running, 0 outside one. */
  private delayLevel = 0;
  /** Index (in `objects`) of the innermost `object` block running, -1 outside one. */
  private currentObject = -1;
  private readonly objectIds = new Map<string, number>();
  /** Library errors already given a "called from" note, so outer statements don't add another. */
  private readonly placed = new WeakSet<PicError>();
  private turtle: Turtle = { x: 80, y: 84, heading: 0, down: true };
  private turtleStack: Turtle[] = [];
  private turtleOp?: Op;
  private splatter = false;
  private warnedLines = new Set<string>();
  private readonly maxOps: number;
  private readonly maxSteps: number;

  constructor(
    private readonly mainFile: string,
    private readonly variant: string,
    opts: CompileOptions,
  ) {
    this.rng = makeRng(opts.seed ?? 1);
    this.maxOps = opts.maxOps ?? 200_000;
    this.maxSteps = opts.maxSteps ?? 5_000_000;
    this.userLoc = { file: mainFile, line: 1, col: 1 };
    this.globals = new Env(undefined, true);
    this.installBuiltins();
    this.sceneEnv = new Env(this.globals);
  }

  runPrelude(p: Program) {
    const env = new Env(this.globals);
    this.execBlock(p.body, env);
    this.sceneEnv = new Env(env);
  }

  run(p: Program) {
    this.execBlock(p.body, this.sceneEnv);
  }

  // ---------- ops ----------
  private opBudget = 0;

  private charge() {
    if (++this.opBudget > this.maxOps)
      throw new PicError(`too many drawing operations (limit ${this.maxOps}) - is a loop running away?`, this.userLoc);
  }

  private emit(op: Op): Op {
    this.charge();
    if (this.ops.length >= this.maxOps) throw new PicError(`too many drawing operations (limit ${this.maxOps}) - is a loop running away?`, this.userLoc);
    const src: SourceRef = { ...this.userLoc, instr: this.instr };
    const out = { ...op, src } as Op;
    if (this.delayLevel) out.delay = this.delayLevel;
    if (this.currentObject >= 0) out.obj = this.currentObject;
    this.ops.push(out);
    return out;
  }

  private warn(message: string, at: Loc) {
    // one warning per top-level statement and site (a loop or a library call warns once)
    const site = at.file === this.mainFile ? `${at.line}:${at.col}` : '';
    const key = `${this.userLoc.file}:${this.userLoc.line}:${site}:${message}`;
    if (this.warnedLines.has(key) || this.warnings.length >= MAX_WARNINGS) return;
    this.warnedLines.add(key);
    // inside one of the scene's own functions, also say which top-level line called it
    const caller = at.file === this.mainFile && this.depth > 0 ? ` (called from line ${this.userLoc.line})` : '';
    this.warnings.push({ message: message + caller, loc: at.file === this.mainFile ? at : this.userLoc });
  }

  // ---------- statements ----------
  private tick(at: Loc) {
    if (++this.steps > this.maxSteps) throw new PicError(`script ran too long (over ${this.maxSteps} steps) - is a loop running away?`, at);
  }

  /** Run one loop iteration; returns false when the body hit `break`. */
  private iterate(body: Stmt[], env: Env): boolean {
    try {
      this.execBlock(body, env);
    } catch (sig) {
      if (sig instanceof LoopSignal) return sig.kind === 'continue';
      throw sig;
    }
    return true;
  }

  private execBlock(body: Stmt[], env: Env) {
    // functions are hoisted, including those inside a delay or object block (no scope of their own)
    for (const s of transparent(body)) if (s.type === 'fn') env.declare(s.name, { kind: 'fn', name: s.name, params: s.params, body: s.body, closure: env });
    for (const s of body) this.exec(s, env);
  }

  private exec(s: Stmt, env: Env): void {
    if (s.loc.file !== this.mainFile) return this.execStmt(s, env);
    try {
      this.execStmt(s, env);
    } catch (e) {
      // An error raised inside a library function also names the innermost scene line that
      // was running when it happened (the call into the library).
      if (e instanceof PicError && e.loc.file !== this.mainFile && !this.placed.has(e)) {
        const placed = new PicError(`${e.detail} (called from ${s.loc.file}:${s.loc.line})`, e.loc);
        this.placed.add(placed);
        throw placed;
      }
      throw e;
    }
  }

  private execStmt(s: Stmt, env: Env): void {
    this.tick(s.loc);
    if (s.loc.file === this.mainFile && this.depth === 0) {
      this.userLoc = s.loc;
      this.instr++;
    }
    switch (s.type) {
      case 'let':
        if (s.name === 'variant') throw new PicError("'variant' is reserved - it holds the variant being rendered", s.loc);
        env.declare(s.name, this.eval(s.value, env));
        return;
      case 'assign':
        return this.assign(s, env);
      case 'expr':
        this.eval(s.expr, env);
        return;
      case 'fn':
        return; // hoisted in execBlock
      case 'repeat': {
        const n = this.num(this.eval(s.count, env), s.count.loc, 'repeat count');
        for (let i = 0; i < Math.floor(n); i++) {
          this.tick(s.loc);
          const inner = new Env(env);
          inner.declare('repcount', i + 1);
          if (!this.iterate(s.body, inner)) break;
        }
        return;
      }
      case 'for': {
        const from = this.eval(s.from, env);
        if (s.to) {
          const a = this.num(from, s.from.loc, 'range start');
          const b = this.num(this.eval(s.to, env), s.to.loc, 'range end');
          const step = a <= b ? 1 : -1;
          for (let i = a; s.inclusive ? (step > 0 ? i <= b : i >= b) : step > 0 ? i < b : i > b; i += step) {
            this.tick(s.loc);
            const inner = new Env(env);
            inner.declare(s.name, i);
            if (!this.iterate(s.body, inner)) break;
          }
        } else {
          if (!Array.isArray(from)) throw new PicError(`'for ${s.name} in …' needs a list or a range like 0..10`, s.from.loc);
          for (const item of [...from]) {
            this.tick(s.loc);
            const inner = new Env(env);
            inner.declare(s.name, item);
            if (!this.iterate(s.body, inner)) break;
          }
        }
        return;
      }
      case 'while':
        while (truthy(this.eval(s.cond, env))) {
          this.tick(s.loc);
          if (!this.iterate(s.body, new Env(env))) break;
        }
        return;
      case 'if':
        if (truthy(this.eval(s.cond, env))) this.execBlock(s.then, new Env(env));
        else if (s.else) this.execBlock(s.else, new Env(env));
        return;
      case 'break':
      case 'continue':
        throw new LoopSignal(s.type);
      case 'return':
        if (this.depth === 0) throw new PicError("'return' outside of a function", s.loc);
        throw new ReturnSignal(s.value ? this.eval(s.value, env) : null);
      case 'scene': {
        const t = this.eval(s.title, env);
        if (typeof t !== 'string') throw new PicError('scene title must be a string', s.title.loc);
        this.title = t;
        return;
      }
      case 'variants':
        return; // resolved before execution
      case 'remap': {
        if (s.variant && s.variant !== this.variant) return;
        if (this.currentObject >= 0) {
          const o = this.objects[this.currentObject];
          throw new PicError(`remap can't be inside an object block (it recolours the whole picture; this one is in '${o.id}', opened at line ${o.src.line})`, s.loc);
        }
        const map = Array.from({ length: 16 }, (_, i) => i);
        for (const [from, to] of s.pairs) map[this.color(this.eval(from, env), from.loc)] = this.color(this.eval(to, env), to.loc);
        this.emit({ kind: 'remap', map });
        this.turtleOp = undefined;
        return;
      }
      case 'delay': {
        const level = s.level ? this.num(this.eval(s.level, env), s.level.loc, 'delay level') : 1;
        if (!Number.isInteger(level) || level < 1) throw new PicError(`delay level must be a whole number, 1 or more (got ${level})`, s.level!.loc);
        // No scope of its own, and its functions were hoisted with the block around it (execBlock), so
        // wrapping lines in a delay never changes what they do: only when the viewer shows them.
        const outer = this.delayLevel;
        this.delayLevel = level;
        try {
          for (const st of s.body) this.exec(st, env);
        } finally {
          this.delayLevel = outer;
        }
        return;
      }
      case 'object':
        return this.objectBlock(s, env);
    }
  }

  /**
   * `object "id" { … }`: what the body paints belongs to the object. Like `delay` it has no scope of
   * its own, so wrapping lines in an object never changes the picture. Opening an id again adds
   * to the same object, which must then have the same parent.
   */
  private objectBlock(s: Extract<Stmt, { type: 'object' }>, env: Env) {
    const id = this.eval(s.id, env);
    if (typeof id !== 'string') throw new PicError(`an object's name must be a string like "vase", got ${typeName(id)}`, s.id.loc);
    if (!OBJECT_ID.test(id)) throw new PicError(`object name '${id}' must be kebab-case: lowercase letters and digits in words joined by '-', starting with a letter (e.g. "blue-vase")`, s.id.loc);
    const parent = this.currentObject;
    let index = this.objectIds.get(id);
    if (index === undefined) {
      index = this.objects.length;
      this.objects.push({ id, parent, src: { file: s.loc.file, line: s.loc.line, col: s.loc.col } });
      this.objectIds.set(id, index);
    } else {
      const o = this.objects[index];
      for (let p = parent; p >= 0; p = this.objects[p].parent) {
        if (p === index) throw new PicError(`object '${id}' is already open here (an object can't be inside itself)`, s.loc);
      }
      if (o.parent !== parent) {
        const where = (p: number) => (p < 0 ? 'outside any object' : `inside '${this.objects[p].id}'`);
        throw new PicError(`object '${id}' was first opened ${where(o.parent)} (line ${o.src.line}), so it must be reopened there too, not ${where(parent)}`, s.loc);
      }
    }
    this.currentObject = index;
    this.turtleOp = undefined; // a turtle path never runs across an object's edge
    try {
      for (const st of s.body) this.exec(st, env);
    } finally {
      this.currentObject = parent;
      this.turtleOp = undefined;
    }
  }

  private assign(s: Extract<Stmt, { type: 'assign' }>, env: Env) {
    const rhs = this.eval(s.value, env);
    const combine = (old: Value): Value => (s.op === '=' ? rhs : this.binop(s.op[0], old, rhs, s.loc));
    if (s.target.type === 'ident') {
      const name = s.target.name;
      if (!env.has(name)) throw new PicError(`'${name}' is not defined - declare it first with 'let ${name} = …'`, s.target.loc);
      if (env.assign(name, combine(env.get(name)!)) === 'readonly') {
        throw new PicError(`'${name}' is built in and can't be reassigned${name === 'variant' ? ' - pick variants when rendering, not in the script' : ` (use 'let ${name} = …' to make your own)`}`, s.target.loc);
      }
      return;
    }
    if (s.target.type === 'index') {
      const list = this.eval(s.target.object, env);
      if (!Array.isArray(list)) throw new PicError('only lists can be indexed', s.target.loc);
      const i = this.index(list, this.eval(s.target.index, env), s.target.index.loc);
      const v = combine(list[i]);
      if (reaches(v, list)) throw new PicError('a list cannot contain itself', s.loc);
      list[i] = v;
    }
  }

  // ---------- expressions ----------
  private eval(e: Expr, env: Env): Value {
    switch (e.type) {
      case 'num':
      case 'str':
      case 'bool':
        return e.value;
      case 'ident': {
        const v = env.get(e.name);
        if (v === undefined) throw new PicError(`'${e.name}' is not defined${suggest(e.name)}`, e.loc);
        return v;
      }
      case 'list':
        return e.items.map((i) => this.eval(i, env));
      case 'unary': {
        const v = this.eval(e.arg, env);
        if (e.op === '!') return !truthy(v);
        return -this.num(v, e.loc, "operand of '-'");
      }
      case 'ternary':
        return truthy(this.eval(e.cond, env)) ? this.eval(e.then, env) : this.eval(e.else, env);
      case 'binary': {
        if (e.op === '&&') {
          const l = this.eval(e.left, env);
          return truthy(l) ? this.eval(e.right, env) : l;
        }
        if (e.op === '||') {
          const l = this.eval(e.left, env);
          return truthy(l) ? l : this.eval(e.right, env);
        }
        return this.binop(e.op, this.eval(e.left, env), this.eval(e.right, env), e.loc);
      }
      case 'index': {
        const obj = this.eval(e.object, env);
        if (typeof obj === 'string') return obj[this.index([...obj], this.eval(e.index, env), e.index.loc)];
        if (!Array.isArray(obj)) throw new PicError('only lists and strings can be indexed', e.loc);
        return obj[this.index(obj, this.eval(e.index, env), e.index.loc)];
      }
      case 'call':
        return this.call(e, env);
    }
  }

  private index(list: unknown[], v: Value, at: Loc): number {
    let i = Math.floor(this.num(v, at, 'list index'));
    if (i < 0) i += list.length;
    if (i < 0 || i >= list.length) throw new PicError(`index ${i} is out of range (length ${list.length})`, at);
    return i;
  }

  private binop(op: string, l: Value, r: Value, at: Loc): Value {
    switch (op) {
      case '==':
        return equal(l, r);
      case '!=':
        return !equal(l, r);
      case '+':
        if (typeof l === 'string' || typeof r === 'string') return show(l) + show(r);
        if (Array.isArray(l) && Array.isArray(r)) return [...l, ...r];
        break;
      case '<':
      case '<=':
      case '>':
      case '>=':
        if (typeof l === 'string' && typeof r === 'string') {
          return op === '<' ? l < r : op === '<=' ? l <= r : op === '>' ? l > r : l >= r;
        }
    }
    const a = this.num(l, at, `left side of '${op}'`);
    const b = this.num(r, at, `right side of '${op}'`);
    switch (op) {
      case '+':
        return a + b;
      case '-':
        return a - b;
      case '*':
        return a * b;
      case '/':
        if (b === 0) throw new PicError('division by zero', at);
        return a / b;
      case '%':
        if (b === 0) throw new PicError('division by zero', at);
        return ((a % b) + b) % b;
      case '<':
        return a < b;
      case '<=':
        return a <= b;
      case '>':
        return a > b;
      case '>=':
        return a >= b;
    }
    throw new PicError(`unknown operator '${op}'`, at);
  }

  private call(e: Extract<Expr, { type: 'call' }>, env: Env): Value {
    const callee = this.eval(e.callee, env);
    const name = e.callee.type === 'ident' ? e.callee.name : 'expression';
    if (!isFn(callee)) {
      throw new PicError(`'${name}' is a ${typeName(callee)}, not a command or function`, e.loc);
    }
    const positional: Value[] = [];
    const named: Record<string, Value> = Object.create(null);
    let sawNamed = false;
    for (const a of e.args) {
      const v = this.eval(a.value, env);
      if (a.name) {
        if (a.name in named) throw new PicError(`argument '${a.name}' given twice`, a.loc);
        named[a.name] = v;
        sawNamed = true;
      } else {
        if (sawNamed) throw new PicError('positional arguments must come before named ones', a.loc);
        positional.push(v);
      }
    }
    if (callee.kind === 'builtin') return callee.call(positional, named, e.loc);
    return this.callUser(callee, positional, named, e.args, e.loc);
  }

  private callUser(fn: Extract<FnValue, { kind: 'fn' }>, positional: Value[], named: Record<string, Value>, args: Arg[], at: Loc): Value {
    if (positional.length > fn.params.length) {
      throw new PicError(`${fn.name}() takes ${fn.params.length} argument${fn.params.length === 1 ? '' : 's'} but got ${positional.length}`, at);
    }
    for (const k of Object.keys(named)) {
      if (!fn.params.some((p) => p.name === k)) {
        const a = args.find((x) => x.name === k)!;
        throw new PicError(`${fn.name}() has no parameter named '${k}' (parameters: ${fn.params.map((p) => p.name).join(', ') || 'none'})`, a.loc);
      }
    }
    if (++this.depth > MAX_DEPTH) throw new PicError(`calls nested too deeply in ${fn.name}() - runaway recursion?`, at);
    try {
      const local = new Env(fn.closure);
      fn.params.forEach((p, i) => {
        if (i < positional.length) {
          if (p.name in named) throw new PicError(`${fn.name}(): '${p.name}' given twice`, at);
          local.declare(p.name, positional[i]);
        } else if (p.name in named) local.declare(p.name, named[p.name]);
        else if (p.default) local.declare(p.name, this.eval(p.default, local));
        else throw new PicError(`${fn.name}() is missing argument '${p.name}'`, at);
      });
      this.execBlock(fn.body, local);
      return null;
    } catch (sig) {
      if (sig instanceof ReturnSignal) return sig.value;
      throw sig;
    } finally {
      this.depth--;
    }
  }

  // ---------- coercions ----------
  private num(v: Value, at: Loc, what: string): number {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new PicError(`${what} must be a number, got ${typeName(v)}`, at);
    return v;
  }

  private color(v: Value, at: Loc): number {
    if (typeof v === 'string') {
      const idx = colorIndex(v);
      if (idx >= 0) return idx;
      throw new PicError(`unknown colour '${v}'`, at);
    }
    const n = Math.round(this.num(v, at, 'colour'));
    if (n < 0 || n > 15) throw new PicError(`colour must be 0-15 or a colour name, got ${n}`, at);
    return n;
  }

  /** Flatten numbers/lists into integer x,y pairs, clamped to the picture. */
  private points(args: Value[], at: Loc, what: string, minPairs = 1): number[] {
    const flat: number[] = [];
    const walk = (v: Value) => {
      if (Array.isArray(v)) v.forEach(walk);
      else flat.push(this.num(v, at, `${what} coordinate`));
    };
    args.forEach(walk);
    if (flat.length % 2) throw new PicError(`${what} needs x,y pairs but got an odd number of values (${flat.length})`, at);
    if (flat.length < minPairs * 2) throw new PicError(`${what} needs at least ${minPairs} point${minPairs > 1 ? 's' : ''}`, at);
    return this.clampPoints(flat, at, what);
  }

  private clampPoints(flat: number[], at: Loc, what: string): number[] {
    let clamped = false;
    const out = flat.map((v, i) => {
      const r = Math.round(v);
      const max = i % 2 === 0 ? PIC_WIDTH - 1 : PIC_HEIGHT - 1;
      const c = r < 0 ? 0 : r > max ? max : r;
      if (c !== r) clamped = true;
      return c;
    });
    if (clamped) this.warn(`${what}: point off the 160×168 picture was clamped to the edge`, at);
    return out;
  }

  // ---------- builtins ----------
  private installBuiltins() {
    const g = this.globals;
    const def = (names: string | string[], call: (args: Value[], named: Record<string, Value>, at: Loc) => Value) => {
      for (const name of ([] as string[]).concat(names)) g.declare(name, { kind: 'builtin', name, call });
    };
    const noNamed = (name: string, named: Record<string, Value>, at: Loc) => {
      const k = Object.keys(named)[0];
      if (k) throw new PicError(`${name} has no named argument '${k}'`, at);
    };
    const arity = (name: string, args: Value[], min: number, max: number, at: Loc) => {
      if (args.length < min || args.length > max) {
        throw new PicError(`${name} takes ${min === max ? min : `${min}-${max}`} argument${max === 1 ? '' : 's'} but got ${args.length}`, at);
      }
    };

    COLOR_NAMES.forEach((n, i) => g.declare(n, i));
    for (const [n, i] of Object.entries(COLOR_ALIASES)) g.declare(n, i);
    for (const s of ['circle', 'square', 'solid', 'splatter']) g.declare(s, s);
    g.declare('WIDTH', PIC_WIDTH);
    g.declare('HEIGHT', PIC_HEIGHT);
    g.declare('variant', this.variant);
    g.declare('null', null);

    // --- drawing commands (AGI-level) ---
    def('color', (a, n, at) => {
      noNamed('color', n, at);
      arity('color', a, 1, 1, at);
      this.emit({ kind: 'color', color: this.color(a[0], at) });
      this.turtleOp = undefined;
      return null;
    });
    def('nocolor', (a, n, at) => {
      noNamed('nocolor', n, at);
      arity('nocolor', a, 0, 0, at);
      this.emit({ kind: 'nocolor' });
      this.turtleOp = undefined;
      return null;
    });
    def('line', (a, n, at) => {
      noNamed('line', n, at);
      this.emit({ kind: 'line', points: this.points(a, at, 'line') });
      this.turtleOp = undefined;
      return null;
    });
    def('rline', (a, n, at) => {
      noNamed('rline', n, at);
      const p = this.rawNumbers(a, at, 'rline');
      if (p.length < 2 || p.length % 2) throw new PicError('rline needs a start x,y followed by dx,dy steps', at);
      const abs = [p[0], p[1]];
      for (let i = 2; i < p.length; i += 2) abs.push(abs[i - 2] + p[i], abs[i - 1] + p[i + 1]);
      this.emit({ kind: 'line', points: this.clampPoints(abs, at, 'rline'), style: 'rel' });
      this.turtleOp = undefined;
      return null;
    });
    const corner = (name: string, xFirst: boolean) =>
      def(name, (a, n, at) => {
        noNamed(name, n, at);
        const p = this.rawNumbers(a, at, name);
        if (p.length < 2) throw new PicError(`${name} needs a start x,y followed by alternating ${xFirst ? 'x and y' : 'y and x'} values`, at);
        let [x, y] = p;
        const abs = [x, y];
        for (let i = 2; i < p.length; i++) {
          if ((i % 2 === 0) === xFirst) x = p[i];
          else y = p[i];
          abs.push(x, y);
        }
        this.emit({ kind: 'line', points: this.clampPoints(abs, at, name), style: xFirst ? 'xcorner' : 'ycorner' });
        this.turtleOp = undefined;
        return null;
      });
    corner('xcorner', true);
    corner('ycorner', false);
    def('fill', (a, n, at) => {
      noNamed('fill', n, at);
      const raw = this.rawNumbers(a, at, 'fill');
      if (raw.length < 2 || raw.length % 2) throw new PicError('fill needs one or more x,y seed points', at);
      const pts: number[] = [];
      for (let i = 0; i < raw.length; i += 2) {
        const x = Math.round(raw[i]);
        const y = Math.round(raw[i + 1]);
        if (x < 0 || y < 0 || x >= PIC_WIDTH || y >= PIC_HEIGHT) this.warn(`fill seed (${x}, ${y}) is off the picture and was skipped`, at);
        else pts.push(x, y);
      }
      if (pts.length) this.emit({ kind: 'fill', points: pts });
      this.turtleOp = undefined;
      return null;
    });
    def('pen', (a, n, at) => {
      noNamed('pen', n, at);
      arity('pen', a, 1, 3, at);
      const size = Math.round(this.num(a[0], at, 'pen size'));
      if (size < 0 || size > 7) throw new PicError(`pen size must be 0-7, got ${size}`, at);
      let shape: PenShape = 'circle';
      let splatter = false;
      for (const v of a.slice(1)) {
        if (v === 'circle') shape = 'circle';
        else if (v === 'rect' || v === 'square' || (isFn(v) && v.name === 'rect')) shape = 'rect';
        else if (v === 'solid') splatter = false;
        else if (v === 'splatter') splatter = true;
        else throw new PicError(`pen options are circle, square, solid, splatter - got ${show(v)}`, at);
      }
      this.splatter = splatter;
      this.emit({ kind: 'pen', size, shape, splatter });
      return null;
    });
    def('plot', (a, n, at) => {
      const pts = this.points(a, at, 'plot');
      let textures: number[] | undefined;
      if (this.splatter) {
        const fixed = n.texture;
        if (fixed !== undefined) {
          const t = Math.round(this.num(fixed, at, 'texture'));
          if (t < 0 || t > MAX_TEXTURE) throw new PicError(`texture must be 0-${MAX_TEXTURE}`, at);
          textures = Array(pts.length / 2).fill(t);
        } else textures = Array.from({ length: pts.length / 2 }, () => Math.floor(this.rng() * (MAX_TEXTURE + 1)));
      }
      for (const k of Object.keys(n)) if (k !== 'texture') throw new PicError(`plot has no named argument '${k}'`, at);
      this.emit(textures ? { kind: 'plot', points: pts, textures } : { kind: 'plot', points: pts });
      this.turtleOp = undefined;
      return null;
    });
    def('seed', (a, n, at) => {
      noNamed('seed', n, at);
      arity('seed', a, 1, 1, at);
      this.rng = makeRng(Math.round(this.num(a[0], at, 'seed')));
      return null;
    });

    // --- solid shapes: painted as horizontal AGI lines, so they cover anything underneath ---
    const spans = (rows: Array<[number, number, number]>) => {
      for (const [y, x1, x2] of rows) {
        if (y < 0 || y >= PIC_HEIGHT) continue;
        const a = Math.max(0, x1);
        const b = Math.min(PIC_WIDTH - 1, x2);
        if (a <= b) this.emit({ kind: 'line', points: [a, y, b, y] });
      }
      this.turtleOp = undefined;
    };
    def('polygon', (a, n, at) => {
      noNamed('polygon', n, at);
      const p = this.rawNumbers(a, at, 'polygon');
      if (p.length < 6 || p.length % 2) throw new PicError('polygon needs at least 3 x,y points', at);
      // Clip to the picture once, so the fill and the outline agree; shapes may run off-canvas.
      const clipped = clipToPicture(p);
      if (clipped.length < 6) return null;
      const pts = clipped.map(Math.round);
      const rows: Array<[number, number, number]> = [];
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 1; i < pts.length; i += 2) {
        minY = Math.min(minY, pts[i]);
        maxY = Math.max(maxY, pts[i]);
      }
      const n2 = pts.length / 2;
      for (let y = minY; y <= maxY; y++) {
        const xs: number[] = [];
        for (let i = 0; i < n2; i++) {
          const [x1, y1] = [pts[2 * i], pts[2 * i + 1]];
          const [x2, y2] = [pts[(2 * i + 2) % pts.length], pts[(2 * i + 3) % pts.length]];
          if ((y1 <= y && y < y2) || (y2 <= y && y < y1)) xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
        }
        xs.sort((u, v) => u - v);
        for (let k = 0; k + 1 < xs.length; k += 2) rows.push([y, Math.ceil(xs[k]), Math.floor(xs[k + 1])]);
      }
      spans(rows);
      // the outline makes the edge pixels match AGI line rasterization exactly
      this.emit({ kind: 'line', points: [...pts, pts[0], pts[1]] });
      return null;
    });
    // Polylines clipped to the picture (not clamped), so they can run off-screen. Points are
    // rounded first like every other drawing command, so on-picture polylines emit exactly the
    // same op as `line`; absurdly far points are capped so the clipping arithmetic can't overflow.
    const clippedPolyline = (name: string, a: Value[], n: Record<string, Value>, at: Loc, closed: boolean) => {
      noNamed(name, n, at);
      const p = this.rawNumbers(a, at, name).map((v) => Math.round(Math.max(-1e6, Math.min(1e6, v))));
      // stroke also takes a single point (a dot), skipped when it is off the picture
      if (!closed && p.length === 2) {
        if (p[0] >= 0 && p[1] >= 0 && p[0] < PIC_WIDTH && p[1] < PIC_HEIGHT) this.emit({ kind: 'line', points: p });
        this.turtleOp = undefined;
        return null;
      }
      if (p.length < 4 || p.length % 2) throw new PicError(closed ? `${name} needs at least 2 x,y points` : `${name} needs at least one x,y point`, at);
      const pts = closed ? [...p, p[0], p[1]] : p;
      const runs: number[][] = [];
      let run: number[] = [];
      const flush = () => {
        if (run.length) runs.push(run);
        run = [];
      };
      for (let i = 0; i + 3 < pts.length; i += 2) {
        const seg = clipSegment(pts[i], pts[i + 1], pts[i + 2], pts[i + 3]);
        if (!seg) {
          flush();
          continue;
        }
        const [x1, x2] = [seg[0], seg[2]].map((v) => Math.max(0, Math.min(PIC_WIDTH - 1, Math.round(v))));
        const [y1, y2] = [seg[1], seg[3]].map((v) => Math.max(0, Math.min(PIC_HEIGHT - 1, Math.round(v))));
        if (run.length && (run[run.length - 2] !== x1 || run[run.length - 1] !== y1)) flush();
        if (!run.length) run.push(x1, y1);
        run.push(x2, y2);
      }
      flush();
      // a closed outline's last piece may run on into its first (it started off-screen mid-edge)
      if (closed && runs.length > 1) {
        const first = runs[0];
        const last = runs[runs.length - 1];
        if (last[last.length - 2] === first[0] && last[last.length - 1] === first[1]) {
          runs[0] = [...last, ...first.slice(2)];
          runs.pop();
        }
      }
      for (const r of runs) this.emit({ kind: 'line', points: r });
      this.turtleOp = undefined;
      return null;
    };
    def('outline', (a, n, at) => clippedPolyline('outline', a, n, at, true));
    def('stroke', (a, n, at) => clippedPolyline('stroke', a, n, at, false));
    def('rect', (a, n, at) => {
      noNamed('rect', n, at);
      const p = this.rawNumbers(a, at, 'rect').map(Math.round);
      if (p.length !== 4) throw new PicError('rect takes x1, y1, x2, y2 (opposite corners)', at);
      const [x1, x2] = p[0] <= p[2] ? [p[0], p[2]] : [p[2], p[0]];
      const [y1, y2] = p[1] <= p[3] ? [p[1], p[3]] : [p[3], p[1]];
      const rows: Array<[number, number, number]> = [];
      for (let y = Math.max(0, y1); y <= Math.min(PIC_HEIGHT - 1, y2); y++) rows.push([y, x1, x2]);
      spans(rows);
      return null;
    });
    def('ellipse', (a, n, at) => {
      noNamed('ellipse', n, at);
      const p = this.rawNumbers(a, at, 'ellipse');
      if (p.length !== 4) throw new PicError('ellipse takes cx, cy, rx, ry', at);
      const [cx, cy, rx, ry] = p;
      if (rx < 0 || ry < 0) throw new PicError('ellipse radii must not be negative', at);
      const rows: Array<[number, number, number]> = [];
      const top = Math.max(0, Math.round(cy - ry));
      const bottom = Math.min(PIC_HEIGHT - 1, Math.round(cy + ry));
      for (let y = top; y <= bottom; y++) {
        const t = ry === 0 ? 0 : (y - cy) / ry;
        if (Math.abs(t) > 1) continue;
        const dx = rx * Math.sqrt(1 - t * t);
        rows.push([y, Math.round(cx - dx), Math.round(cx + dx)]);
      }
      spans(rows);
      return null;
    });

    // --- turtle graphics ---
    const move = (d: number, at: Loc) => {
      const t = this.turtle;
      const rad = (t.heading * Math.PI) / 180;
      const nx = t.x + d * Math.sin(rad);
      const ny = t.y - d * Math.cos(rad);
      if (t.down) this.turtleLine(t.x, t.y, nx, ny, at);
      t.x = nx;
      t.y = ny;
    };
    def(['forward', 'fd'], (a, n, at) => {
      noNamed('forward', n, at);
      arity('forward', a, 1, 1, at);
      move(this.num(a[0], at, 'distance'), at);
      return null;
    });
    def(['back', 'bk'], (a, n, at) => {
      noNamed('back', n, at);
      arity('back', a, 1, 1, at);
      move(-this.num(a[0], at, 'distance'), at);
      return null;
    });
    def(['right', 'rt'], (a, n, at) => {
      noNamed('right', n, at);
      arity('right', a, 1, 1, at);
      this.turtle.heading = (this.turtle.heading + this.num(a[0], at, 'angle')) % 360;
      return null;
    });
    def(['left', 'lt'], (a, n, at) => {
      noNamed('left', n, at);
      arity('left', a, 1, 1, at);
      this.turtle.heading = (this.turtle.heading - this.num(a[0], at, 'angle')) % 360;
      return null;
    });
    def(['heading', 'seth'], (a, n, at) => {
      noNamed('heading', n, at);
      arity('heading', a, 1, 1, at);
      this.turtle.heading = this.num(a[0], at, 'heading') % 360;
      return null;
    });
    def(['penup', 'pu'], (a, n, at) => {
      noNamed('penup', n, at);
      arity('penup', a, 0, 0, at);
      this.turtle.down = false;
      return null;
    });
    def(['pendown', 'pd'], (a, n, at) => {
      noNamed('pendown', n, at);
      arity('pendown', a, 0, 0, at);
      this.turtle.down = true;
      return null;
    });
    def('moveto', (a, n, at) => {
      noNamed('moveto', n, at);
      const p = this.rawNumbers(a, at, 'moveto');
      if (p.length !== 2) throw new PicError('moveto takes x, y', at);
      [this.turtle.x, this.turtle.y] = p;
      this.turtleOp = undefined;
      return null;
    });
    def('lineto', (a, n, at) => {
      noNamed('lineto', n, at);
      const p = this.rawNumbers(a, at, 'lineto');
      if (p.length !== 2) throw new PicError('lineto takes x, y', at);
      this.turtleLine(this.turtle.x, this.turtle.y, p[0], p[1], at);
      [this.turtle.x, this.turtle.y] = p;
      return null;
    });
    def('save_turtle', (a, n, at) => {
      noNamed('save_turtle', n, at);
      arity('save_turtle', a, 0, 0, at);
      this.turtleStack.push({ ...this.turtle });
      return null;
    });
    def('restore_turtle', (a, n, at) => {
      noNamed('restore_turtle', n, at);
      arity('restore_turtle', a, 0, 0, at);
      const t = this.turtleStack.pop();
      if (!t) throw new PicError('restore_turtle without a matching save_turtle', at);
      this.turtle = t;
      this.turtleOp = undefined;
      return null;
    });
    def('turtle_x', () => this.turtle.x);
    def('turtle_y', () => this.turtle.y);
    def('turtle_heading', () => this.turtle.heading);

    // --- functions ---
    const math1 = (name: string, f: (x: number) => number) =>
      def(name, (a, n, at) => {
        noNamed(name, n, at);
        arity(name, a, 1, 1, at);
        return f(this.num(a[0], at, `${name}() argument`));
      });
    const DEG = Math.PI / 180;
    math1('abs', Math.abs);
    math1('floor', Math.floor);
    math1('ceil', Math.ceil);
    math1('round', Math.round);
    math1('sqrt', (x) => Math.sqrt(Math.max(0, x)));
    math1('sin', (d) => Math.sin(d * DEG));
    math1('cos', (d) => Math.cos(d * DEG));
    def('atan2', (a, n, at) => {
      noNamed('atan2', n, at);
      arity('atan2', a, 2, 2, at);
      return Math.atan2(this.num(a[0], at, 'y'), this.num(a[1], at, 'x')) / DEG;
    });
    const minmax = (name: string, f: (...x: number[]) => number) =>
      def(name, (a, n, at) => {
        noNamed(name, n, at);
        const nums = this.rawNumbers(a, at, name);
        if (!nums.length) throw new PicError(`${name}() needs at least one number`, at);
        return f(...nums);
      });
    minmax('min', Math.min);
    minmax('max', Math.max);
    def('clamp', (a, n, at) => {
      noNamed('clamp', n, at);
      arity('clamp', a, 3, 3, at);
      const [v, lo, hi] = a.map((x) => this.num(x, at, 'clamp() argument'));
      return Math.min(hi, Math.max(lo, v));
    });
    def('random', (a, n, at) => {
      noNamed('random', n, at);
      arity('random', a, 0, 2, at);
      if (a.length === 0) return this.rng();
      const lo = Math.ceil(this.num(a[0], at, 'random() low'));
      const hi = a.length > 1 ? Math.floor(this.num(a[1], at, 'random() high')) : lo;
      const [l, h] = a.length === 1 ? [0, lo] : [lo, hi];
      if (h < l) throw new PicError(`random(${l}, ${h}): high is below low`, at);
      return l + Math.floor(this.rng() * (h - l + 1));
    });
    def('noise', (a, n, at) => {
      noNamed('noise', n, at);
      arity('noise', a, 1, 2, at);
      return hashNoise(Math.round(this.num(a[0], at, 'noise() seed')), a.length > 1 ? Math.round(this.num(a[1], at, 'noise() index')) : 0);
    });
    def('randf', (a, n, at) => {
      noNamed('randf', n, at);
      arity('randf', a, 2, 2, at);
      const lo = this.num(a[0], at, 'randf() low');
      const hi = this.num(a[1], at, 'randf() high');
      return lo + this.rng() * (hi - lo);
    });
    def('type', (a, n, at) => {
      noNamed('type', n, at);
      arity('type', a, 1, 1, at);
      const t = typeName(a[0]);
      return t === 'boolean' ? 'bool' : t;
    });
    def('len', (a, n, at) => {
      noNamed('len', n, at);
      arity('len', a, 1, 1, at);
      const v = a[0];
      if (Array.isArray(v) || typeof v === 'string') return v.length;
      throw new PicError(`len() needs a list or string, got ${typeName(v)}`, at);
    });
    def('range', (a, n, at) => {
      noNamed('range', n, at);
      arity('range', a, 1, 3, at);
      const nums = a.map((x) => this.num(x, at, 'range() argument'));
      const [lo, hi, step] = nums.length === 1 ? [0, nums[0], 1] : [nums[0], nums[1], nums[2] ?? 1];
      if (step === 0) throw new PicError('range() step cannot be 0', at);
      const out: number[] = [];
      for (let i = lo; step > 0 ? i < hi : i > hi; i += step) {
        out.push(i);
        if (out.length > 100_000) throw new PicError('range() is too long', at);
      }
      return out;
    });
    def('push', (a, n, at) => {
      noNamed('push', n, at);
      arity('push', a, 2, 2, at);
      if (!Array.isArray(a[0])) throw new PicError('push() needs a list first', at);
      if (reaches(a[1], a[0])) throw new PicError('a list cannot contain itself', at);
      a[0].push(a[1]);
      return a[0];
    });
    def('pop', (a, n, at) => {
      noNamed('pop', n, at);
      arity('pop', a, 1, 1, at);
      if (!Array.isArray(a[0])) throw new PicError('pop() needs a list', at);
      if (!a[0].length) throw new PicError('pop() on an empty list', at);
      return a[0].pop()!;
    });
    def('str', (a, n, at) => {
      noNamed('str', n, at);
      arity('str', a, 1, 1, at);
      return show(a[0]);
    });
    def(['log', 'print'], (a) => {
      this.logs.push(`${this.userLoc.file}:${this.userLoc.line}: ${a.map(show).join(' ')}`);
      return null;
    });
    def('error', (a, n, at) => {
      noNamed('error', n, at);
      throw new PicError(a.map(show).join(' ') || 'error()', at);
    });
  }

  private rawNumbers(args: Value[], at: Loc, what: string): number[] {
    const flat: number[] = [];
    const walk = (v: Value) => {
      if (Array.isArray(v)) v.forEach(walk);
      else flat.push(this.num(v, at, `${what} argument`));
    };
    args.forEach(walk);
    return flat;
  }

  /** Turtle segments extend the previous turtle polyline when nothing else was drawn in between. */
  private turtleLine(x1: number, y1: number, x2: number, y2: number, at: Loc) {
    const [ax, ay, bx, by] = this.clampPoints([x1, y1, x2, y2], at, 'turtle');
    const last = this.ops[this.ops.length - 1];
    if (this.turtleOp && last === this.turtleOp && last.kind === 'line') {
      const p = last.points;
      if (p[p.length - 2] === ax && p[p.length - 1] === ay && last.src?.line === this.userLoc.line && (last.delay ?? 0) === this.delayLevel && (last.obj ?? -1) === this.currentObject) {
        this.charge();
        p.push(bx, by);
        return;
      }
    }
    this.turtleOp = this.emit({ kind: 'line', points: [ax, ay, bx, by] });
  }
}

// ---------------------------------------------------------------------------
// helpers

export function colorIndex(name: string): number {
  const n = name.toLowerCase();
  const i = (COLOR_NAMES as readonly string[]).indexOf(n);
  return i >= 0 ? i : (COLOR_ALIASES[n] ?? -1);
}

/** Sutherland-Hodgman clip of a closed polygon (flat x,y list) to the picture rectangle. */
function clipToPicture(flat: number[]): number[] {
  let pts: Array<[number, number]> = [];
  for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
  const edges: Array<[(p: [number, number]) => boolean, (a: [number, number], b: [number, number]) => [number, number]]> = [
    [(p) => p[0] >= 0, (a, b) => [0, a[1] + ((b[1] - a[1]) * (0 - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= PIC_WIDTH - 1, (a, b) => [PIC_WIDTH - 1, a[1] + ((b[1] - a[1]) * (PIC_WIDTH - 1 - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= 0, (a, b) => [a[0] + ((b[0] - a[0]) * (0 - a[1])) / (b[1] - a[1]), 0]],
    [(p) => p[1] <= PIC_HEIGHT - 1, (a, b) => [a[0] + ((b[0] - a[0]) * (PIC_HEIGHT - 1 - a[1])) / (b[1] - a[1]), PIC_HEIGHT - 1]],
  ];
  for (const [inside, cross] of edges) {
    const input = pts;
    pts = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      if (inside(cur)) {
        if (!inside(prev)) pts.push(cross(prev, cur));
        pts.push(cur);
      } else if (inside(prev)) pts.push(cross(prev, cur));
    }
    if (!pts.length) return [];
  }
  return pts.flat();
}

/** Liang-Barsky clip of the segment (x1,y1)-(x2,y2) to the picture; null if it is entirely off it. */
function clipSegment(x1: number, y1: number, x2: number, y2: number): [number, number, number, number] | null {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;
  const checks: Array<[number, number]> = [
    [-dx, x1],
    [dx, PIC_WIDTH - 1 - x1],
    [-dy, y1],
    [dy, PIC_HEIGHT - 1 - y1],
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const r = q / p;
      if (p < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
      if (t0 > t1) return null;
    }
  }
  return [x1 + t0 * dx, y1 + t0 * dy, x1 + t1 * dx, y1 + t1 * dy];
}

/** Stateless hash noise in [0, 1) - the same (seed, i) always gives the same value. */
function hashNoise(seed: number, i: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(i + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Does `v` (or any list nested in it) refer to `target`? Used to keep lists acyclic. */
function reaches(v: Value, target: Value[]): boolean {
  if (!Array.isArray(v)) return false;
  return v === target || v.some((x) => reaches(x, target));
}

function truthy(v: Value): boolean {
  return !(v === false || v === null || v === 0 || v === '');
}

function equal(a: Value, b: Value): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => equal(x, b[i]));
  return a === b;
}

function typeName(v: Value): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'list';
  if (isFn(v)) return 'function';
  return typeof v;
}

function show(v: Value): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `[${v.map(show).join(', ')}]`;
  if (isFn(v)) return `<fn ${v.name}>`;
  if (typeof v === 'number') return String(Math.round(v * 1000) / 1000);
  return String(v);
}

const KNOWN_HINTS: Record<string, string> = {
  goto: "use 'moveto x, y' (no drawing) or 'lineto x, y'",
  setxy: "use 'moveto x, y'",
  setheading: "use 'heading angle'",
  gray: 'colour names: black blue green cyan red magenta brown lightgrey darkgrey lightblue lightgreen lightcyan lightred lightmagenta yellow white',
  def: "define functions with 'fn name(a, b) { … }'",
  to: "define functions with 'fn name(a, b) { … }'",
  var: "declare variables with 'let name = …'",
  const: "declare variables with 'let name = …'",
  elif: "use 'else if'",
};

function suggest(name: string): string {
  const hint = KNOWN_HINTS[name];
  return hint ? ` - ${hint}` : '';
}
