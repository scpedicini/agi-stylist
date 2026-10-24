import { MAX_TEXTURE, type PenShape } from '../engine/brush.ts';
import { Painter } from '../engine/execute.ts';
import { Framebuffer, PIC_HEIGHT, PIC_WIDTH, VGA_HEIGHT, VGA_WIDTH, type Screen } from '../engine/framebuffer.ts';
import type { Op, Pattern, SourceRef } from '../engine/ops.ts';
import { agiLine } from '../engine/line.ts';
import { glowLevel } from '../engine/pattern.ts';
import { COLOR_ALIASES, COLOR_NAMES, dac6, EGA_PALETTE, WHITE } from '../engine/palette.ts';
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
  /** 'agi' (160×168, 16 EGA colours) unless the scene says `mode vga`. */
  mode: Mode;
  title?: string;
  variants: string[];
  variant: string;
  warnings: Diagnostic[];
  logs: string[];
}

export const DEFAULT_VARIANT = 'default';

export type Mode = 'agi' | 'vga';

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
  const prelude = !opts.prelude ? undefined : typeof opts.prelude === 'string' ? parse(opts.prelude, 'stdlib.pic') : opts.prelude;
  // a prelude that defines its own `mode` keeps it: the scene's `mode x` lines call it, as before VGA
  const modeIsCall = !!prelude && transparent(prelude.body).some((s) => (s.type === 'fn' || s.type === 'let') && s.name === 'mode');
  const mode = modeIsCall ? 'agi' : declaredMode(program);
  const interp = new Interpreter(program.file, variant, opts, mode, modeIsCall);
  if (prelude) interp.runPrelude(prelude);
  interp.run(program);
  return {
    ops: interp.ops,
    mode,
    title: interp.title,
    variants: variants.length ? variants : [DEFAULT_VARIANT],
    variant,
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
    if (s.type === 'fn' || s.type === 'repeat' || s.type === 'for' || s.type === 'while' || s.type === 'delay') checkRemapVariants(s.body, variants);
    if (s.type === 'if') {
      checkRemapVariants(s.then, variants);
      if (s.else) checkRemapVariants(s.else, variants);
    }
  }
}

/** The picture mode a scene's top-level `mode` statement asks for ('agi' without one), without running it. */
export function declaredMode(program: Program): Mode {
  let mode: Extract<Stmt, { type: 'mode' }> | undefined;
  for (const s of transparent(program.body)) {
    if (s.type !== 'mode') continue;
    if (mode && mode.mode !== s.mode) throw new PicError(`the scene asks for 'mode ${mode.mode}' (line ${mode.loc.line}) and 'mode ${s.mode}'; pick one`, s.loc);
    mode = s;
  }
  return mode?.mode ?? 'agi';
}

/** Variant names declared by top-level `variants` statements, without running the scene. */
export function declaredVariants(program: Program): string[] {
  const names: string[] = [];
  for (const s of transparent(program.body)) if (s.type === 'variants') for (const n of s.names) if (!names.includes(n)) names.push(n);
  return names;
}

/**
 * A block's statements with every `delay` block opened up in place: a delay is see-through, so what
 * is declared in it (functions, variants) counts as declared in the block around it.
 */
function transparent(body: Stmt[]): Stmt[] {
  return body.some((s) => s.type === 'delay') ? body.flatMap((s) => (s.type === 'delay' ? transparent(s.body) : [s])) : body;
}

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
  /** Library errors already given a "called from" note, so outer statements don't add another. */
  private readonly placed = new WeakSet<PicError>();
  private turtle: Turtle;
  private turtleStack: Turtle[] = [];
  private turtleOp?: Op;
  private splatter = false;
  private warnedLines = new Set<string>();
  private readonly maxOps: number;
  private readonly maxSteps: number;
  /** Picture size: 160×168 (AGI) or 320×200 (VGA). */
  private readonly W: number;
  private readonly H: number;
  private readonly vga: boolean;
  /** VGA: the palette so far (index → RGB as allocated, 0-15 the EGA colours), shared with the screen op. */
  private readonly palette: Array<[number, number, number]> = [];
  /** VGA: what each index shows now; differs from `palette` after a whole-picture tint (a palette op). */
  private readonly current: Array<[number, number, number]> = [];
  /** VGA: paints every op as it is emitted, so tint/glow/pixel can see the picture so far. */
  private readonly shadow?: Painter;
  private warnedPalette = false;
  /** VGA: the pen the last `color` set, and whether drawing is on, so a palette tint can renew it. */
  private pen?: { color: number; pattern?: Pattern };
  private penOn = false;
  /** VGA: a palette tint changed a colour of the pen; renew it before the next line, plot or fill. */
  private penStale = false;

  constructor(
    private readonly mainFile: string,
    private readonly variant: string,
    opts: CompileOptions,
    mode: Mode = 'agi',
    private readonly modeIsCall = false,
  ) {
    this.vga = mode === 'vga';
    this.W = this.vga ? VGA_WIDTH : PIC_WIDTH;
    this.H = this.vga ? VGA_HEIGHT : PIC_HEIGHT;
    this.turtle = { x: this.W / 2, y: this.H / 2, heading: 0, down: true };
    if (this.vga) {
      for (const c of EGA_PALETTE) {
        this.palette.push([c[0], c[1], c[2]]);
        this.current.push([c[0], c[1], c[2]]);
      }
      const screen: Screen = { mode: 'vga', width: this.W, height: this.H, aspect: 1, palette: this.palette };
      this.shadow = new Painter(new Framebuffer(undefined, screen));
    }
    this.rng = makeRng(opts.seed ?? 1);
    this.maxOps = opts.maxOps ?? 200_000;
    this.maxSteps = opts.maxSteps ?? 5_000_000;
    this.userLoc = { file: mainFile, line: 1, col: 1 };
    this.globals = new Env(undefined, true);
    this.installBuiltins();
    if (this.vga) {
      this.installVgaBuiltins();
      this.emit({ kind: 'screen', mode: 'vga', width: this.W, height: this.H, palette: this.palette });
    }
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
    if (this.penStale && this.penOn && this.pen && (op.kind === 'line' || op.kind === 'plot' || op.kind === 'fill')) {
      // renew the pen a palette tint changed, so it paints the colours it was given
      this.penStale = false;
      const pen = this.pen;
      this.pen = {
        color: this.fresh(pen.color, this.userLoc),
        ...(pen.pattern ? { pattern: { ...pen.pattern, colors: pen.pattern.colors.map((k) => this.fresh(k, this.userLoc)) } } : {}),
      };
      this.emit({ kind: 'color', ...this.pen });
    }
    this.charge();
    if (this.ops.length >= this.maxOps) throw new PicError(`too many drawing operations (limit ${this.maxOps}) - is a loop running away?`, this.userLoc);
    const src: SourceRef = { ...this.userLoc, instr: this.instr };
    const out = { ...op, src } as Op;
    if (this.delayLevel) out.delay = this.delayLevel;
    this.ops.push(out);
    this.shadow?.apply(out);
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
    // functions are hoisted, including those inside a delay block (it has no scope of its own)
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
      case 'mode':
        // a prelude's own `mode` takes the statement back as a call to it (see compileProgram)
        if (this.modeIsCall) this.eval({ type: 'call', callee: { type: 'ident', name: 'mode', loc: s.loc }, args: [{ value: s.arg, loc: s.arg.loc }], loc: s.loc }, env);
        return;
      case 'remap': {
        if (s.variant && s.variant !== this.variant) return;
        const map = Array.from({ length: this.vga ? 256 : 16 }, (_, i) => i);
        for (const [from, to] of s.pairs) {
          if (!this.vga) {
            map[this.color(this.eval(from, env), from.loc)] = this.color(this.eval(to, env), to.loc);
            continue;
          }
          // VGA: every index showing the `from` colour (after a palette tint that may be several, or none)
          const rgb = this.colorRgb(this.eval(from, env), from.loc);
          const c = this.color(this.eval(to, env), to.loc);
          this.current.forEach((k, i) => {
            if (k[0] === rgb[0] && k[1] === rgb[1] && k[2] === rgb[2]) map[i] = c;
          });
        }
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
      if (idx >= 0) return this.vga ? this.fresh(idx, at) : idx;
      const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim());
      if (hex) {
        if (!this.vga) throw new PicError(`hex colours like '${v}' need 'mode vga' (AGI has only the 16 named colours)`, at);
        const h = hex[1].length === 3 ? [...hex[1]].map((d) => d + d).join('') : hex[1];
        return this.alloc(parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), at);
      }
      throw new PicError(`unknown colour '${v}'`, at);
    }
    if (this.vga && Array.isArray(v)) throw new PicError(`a pattern (dither/linear/radial) can only be used as a pen colour (color, shape(...) fills), not here`, at);
    const n = Math.round(this.num(v, at, 'colour'));
    if (this.vga) {
      if (n < 0 || n >= this.palette.length) throw new PicError(`colour must be a colour name, a '#rrggbb' string or a palette index 0-${this.palette.length - 1} (from rgb(), mix() …), got ${n}`, at);
      return this.fresh(n, at);
    }
    if (n < 0 || n > 15) throw new PicError(`colour must be 0-15 or a colour name, got ${n}`, at);
    return n;
  }

  /** VGA: has a whole-picture tint (a palette op) changed what index i shows from the colour it was made with? */
  private retired(i: number): boolean {
    const [a, b] = [this.palette[i], this.current[i]];
    return a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2];
  }

  /**
   * VGA: index `i` if it still shows the colour it was made with; after a whole-picture tint changed
   * it, an index that shows that colour now. So a colour value always paints the colour it names.
   */
  private fresh(i: number, at: Loc): number {
    if (!this.retired(i)) return i;
    const a = this.palette[i];
    return this.alloc(a[0], a[1], a[2], at);
  }

  /** VGA: the RGB a colour value names, without adding it to the palette (for tint and glow colours). */
  private colorRgb(v: Value, at: Loc): readonly number[] {
    if (typeof v === 'string') {
      const idx = colorIndex(v);
      if (idx >= 0) return EGA_PALETTE[idx];
      const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim());
      if (hex) {
        const h = hex[1].length === 3 ? [...hex[1]].map((d) => d + d).join('') : hex[1];
        return [0, 2, 4].map((k) => dac6(parseInt(h.slice(k, k + 2), 16)));
      }
    }
    if (Array.isArray(v)) return this.palette[this.color(v, at)]; // (an error: patterns aren't colours)
    const n = Math.round(this.num(v, at, 'colour'));
    if (n < 0 || n >= this.palette.length) return this.palette[this.color(v, at)]; // (the range error)
    return this.palette[n];
  }

  /**
   * VGA: the palette index of an RGB colour (rounded to the 6-bit DAC), adding it if it is new.
   * With `near`, a colour already in the palette within that distance (0-255 units) is used instead.
   */
  private alloc(r: number, g: number, b: number, at: Loc, near = 0): number {
    const q: [number, number, number] = [dac6(r), dac6(g), dac6(b)];
    const cur = this.current;
    // index 15 is the white canvas (fills spread into it): a painted white gets its own index; and an
    // index a palette tint changed is never handed out (a colour value must keep its colour)
    for (let i = 0; i < cur.length; i++) if (i !== WHITE && cur[i][0] === q[0] && cur[i][1] === q[1] && cur[i][2] === q[2] && !this.retired(i)) return i;
    if (near > 0) {
      const n = this.nearest(q);
      if (n.d <= near * near) return n.i;
    }
    if (cur.length < 256) {
      this.palette.push(q);
      cur.push([q[0], q[1], q[2]]);
      return cur.length - 1;
    }
    if (!this.warnedPalette) {
      this.warnedPalette = true;
      this.warn('the palette is full (256 colours): further new colours use the nearest one already in it', at);
    }
    return this.nearest(q).i;
  }

  /** The palette index (not the canvas white, nor one a palette tint changed) showing the colour closest to q, and its squared distance. */
  private nearest(q: readonly number[]): { i: number; d: number } {
    const cur = this.current;
    let i = 0;
    let d = Infinity;
    for (const anyway of [false, true]) {
      for (let k = 0; k < cur.length; k++) {
        if (k === WHITE || (this.retired(k) && !anyway)) continue;
        const dk = (cur[k][0] - q[0]) ** 2 + (cur[k][1] - q[1]) ** 2 + (cur[k][2] - q[2]) ** 2;
        if (dk < d) (i = k), (d = dk);
      }
      // only when a palette tint has changed every slot: the closest colour showing now, as best we can
      if (d < Infinity) break;
    }
    return { i, d };
  }

  /** VGA: a pen colour, which may be a pattern made by dither(), linear() or radial(). */
  private penColor(v: Value, at: Loc): { color: number; pattern?: Pattern } {
    if (!this.vga || !Array.isArray(v)) return { color: this.color(v, at) };
    const bad = () => new PicError(`not a colour or pattern: ${show(v)} (make patterns with dither(), linear() or radial())`, at);
    const kind = v[0];
    const nums = (from: number, to: number) => v.slice(from, to).map((x) => this.num(x, at, 'pattern value'));
    const colours = (list: Value) => {
      if (!Array.isArray(list) || !list.length) throw bad();
      return list.map((c) => this.color(c, at));
    };
    let pattern: Pattern;
    if (kind === 'dither' && v.length === 4) pattern = { colors: [this.color(v[1], at), this.color(v[2], at)], t: nums(3, 4)[0] };
    else if (kind === 'linear' && v.length === 6) {
      const [x1, y1, x2, y2] = nums(1, 5);
      pattern = { colors: colours(v[5]), kind: 'linear', x1, y1, x2, y2 };
    } else if (kind === 'radial' && v.length === 5) {
      const [x1, y1, r] = nums(1, 4);
      pattern = { colors: colours(v[4]), kind: 'radial', x1, y1, x2: x1 + r, y2: y1 };
    } else throw bad();
    return { color: pattern.colors[0], pattern };
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
      const max = i % 2 === 0 ? this.W - 1 : this.H - 1;
      const c = r < 0 ? 0 : r > max ? max : r;
      if (c !== r) clamped = true;
      return c;
    });
    if (clamped) this.warn(`${what}: point off the ${this.W}×${this.H} picture was clamped to the edge`, at);
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
    g.declare('WIDTH', this.W);
    g.declare('HEIGHT', this.H);
    g.declare('ASPECT', this.vga ? 1 : 2);
    g.declare('MODE', this.vga ? 'vga' : 'agi');
    g.declare('variant', this.variant);
    g.declare('null', null);

    // --- drawing commands (AGI-level) ---
    def('color', (a, n, at) => {
      noNamed('color', n, at);
      arity('color', a, 1, 1, at);
      if (this.vga) {
        this.pen = this.penColor(a[0], at);
        this.penOn = true;
        this.penStale = false;
        this.emit({ kind: 'color', ...this.pen });
      } else this.emit({ kind: 'color', color: this.color(a[0], at) });
      this.turtleOp = undefined;
      return null;
    });
    def('nocolor', (a, n, at) => {
      noNamed('nocolor', n, at);
      arity('nocolor', a, 0, 0, at);
      this.penOn = false;
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
        if (x < 0 || y < 0 || x >= this.W || y >= this.H) this.warn(`fill seed (${x}, ${y}) is off the picture and was skipped`, at);
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
        if (y < 0 || y >= this.H) continue;
        const a = Math.max(0, x1);
        const b = Math.min(this.W - 1, x2);
        if (a <= b) this.emit({ kind: 'line', points: [a, y, b, y] });
      }
      this.turtleOp = undefined;
    };
    def('polygon', (a, n, at) => {
      noNamed('polygon', n, at);
      const p = this.rawNumbers(a, at, 'polygon');
      if (p.length < 6 || p.length % 2) throw new PicError('polygon needs at least 3 x,y points', at);
      // Clip to the picture once, so the fill and the outline agree; shapes may run off-canvas.
      const clipped = clipToPicture(p, this.W, this.H);
      if (clipped.length < 6) return null;
      const pts = clipped.map(Math.round);
      spans(scanRows(pts));
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
        if (p[0] >= 0 && p[1] >= 0 && p[0] < this.W && p[1] < this.H) this.emit({ kind: 'line', points: p });
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
        const seg = clipSegment(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], this.W, this.H);
        if (!seg) {
          flush();
          continue;
        }
        const [x1, x2] = [seg[0], seg[2]].map((v) => Math.max(0, Math.min(this.W - 1, Math.round(v))));
        const [y1, y2] = [seg[1], seg[3]].map((v) => Math.max(0, Math.min(this.H - 1, Math.round(v))));
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
      for (let y = Math.max(0, y1); y <= Math.min(this.H - 1, y2); y++) rows.push([y, x1, x2]);
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
      const bottom = Math.min(this.H - 1, Math.round(cy + ry));
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

  // ---------- VGA builtins (only in `mode vga` scenes) ----------
  private installVgaBuiltins() {
    const g = this.globals;
    const REQUIRED = Symbol('required');
    type Spec = Array<[string, Value | typeof REQUIRED]>;
    /** Positional and named arguments matched to `spec` (name, default), as one record. */
    const args = (name: string, a: Value[], n: Record<string, Value>, spec: Spec, at: Loc): Record<string, Value> => {
      if (a.length > spec.length) throw new PicError(`${name} takes at most ${spec.length} arguments (${spec.map((p) => p[0]).join(', ')}) but got ${a.length}`, at);
      const out: Record<string, Value> = {};
      spec.forEach(([k, d], i) => {
        if (i < a.length) {
          if (k in n) throw new PicError(`${name}: '${k}' given twice`, at);
          out[k] = a[i];
        } else if (k in n) out[k] = n[k];
        else if (d === REQUIRED) throw new PicError(`${name} is missing argument '${k}' (${spec.map((p) => p[0]).join(', ')})`, at);
        else out[k] = d;
      });
      for (const k of Object.keys(n)) if (!spec.some((p) => p[0] === k)) throw new PicError(`${name} has no argument named '${k}' (arguments: ${spec.map((p) => p[0]).join(', ')})`, at);
      return out;
    };
    const def = (name: string, spec: Spec, call: (v: Record<string, Value>, at: Loc) => Value) =>
      g.declare(name, { kind: 'builtin', name, call: (a, n, at) => call(args(name, a, n, spec, at), at) });
    const rgbOf = (c: number) => this.current[c];
    const num = (v: Value, at: Loc, what: string) => this.num(v, at, what);
    const amount = (v: Value, at: Loc, name: string) => {
      const t = num(v, at, `${name} amount`);
      if (t < 0 || t > 1) throw new PicError(`${name}: amount must be 0-1, got ${t}`, at);
      return t;
    };
    const mixRgb = (a: readonly number[], b: readonly number[], t: number) => [0, 1, 2].map((k) => a[k] + (b[k] - a[k]) * t);
    const BLENDS = ['mix', 'add', 'multiply', 'screen'];
    const blend = (base: readonly number[], c: readonly number[], t: number, how: string) =>
      [0, 1, 2].map((k) => {
        const b = base[k];
        const l = c[k];
        if (how === 'add') return b + l * t;
        if (how === 'multiply') return b * (1 + (l / 255 - 1) * t);
        if (how === 'screen') return 255 - ((255 - b) * (255 - l * t)) / 255;
        return b + (l - b) * t;
      });
    const blendMode = (v: Value, at: Loc, name: string) => {
      if (typeof v !== 'string' || !BLENDS.includes(v)) throw new PicError(`${name}: how must be one of ${BLENDS.map((b) => `"${b}"`).join(', ')}, got ${show(v)}`, at);
      return v;
    };
    const allocRgb = (rgb: number[], at: Loc, near = 0) => this.alloc(rgb[0], rgb[1], rgb[2], at, near);
    /** Lighting reuses a colour within this distance rather than adding a new one: it saves palette, and dithering hides it. */
    const LIGHT_NEAR = 6;
    const colourList = (v: Value, at: Loc, name: string) => {
      if (!Array.isArray(v) || !v.length) throw new PicError(`${name} needs a list of colours, e.g. [black, "#335", white] or ramp(…)`, at);
      return v.map((c) => this.color(c, at));
    };
    /** `stops` blended into `steps` evenly spaced colours (as they are when steps is 0 or no more than them). */
    const spread = (stops: number[], stepsV: Value, at: Loc, name: string) => {
      const steps = Math.round(num(stepsV, at, `${name}() steps`));
      if (steps < 0 || steps > 64) throw new PicError(`${name}: steps must be 0-64, got ${steps}`, at);
      if (steps <= stops.length || stops.length < 2) return stops;
      const out: number[] = [];
      for (let i = 0; i < steps; i++) {
        const s = (i / (steps - 1)) * (stops.length - 1);
        const k = Math.min(Math.floor(s), stops.length - 2);
        out.push(allocRgb(mixRgb(rgbOf(stops[k]), rgbOf(stops[k + 1]), s - k), at));
      }
      return out;
    };
    /** The palette indices showing in rows of [y, x1, x2] runs (or the whole picture). */
    const present = (rows?: number[]) => {
      const fb = this.shadow!.fb;
      const seen = new Set<number>();
      if (!rows) for (const c of fb.pixels) seen.add(c);
      else for (let k = 0; k < rows.length; k += 3) for (let x = rows[k + 1]; x <= rows[k + 2]; x++) seen.add(fb.pixels[rows[k] * fb.width + x]);
      return seen;
    };
    /** A remap table taking each of `colours` to f(its colour); a colour f leaves alone keeps its index. */
    const recolour = (colours: Set<number>, f: (rgb: readonly number[]) => number[], at: Loc) => {
      const map = Array.from({ length: 256 }, (_, i) => i);
      for (const c of colours) {
        const rgb = f(rgbOf(c)).map(dac6);
        const was = rgbOf(c);
        if (rgb[0] !== was[0] || rgb[1] !== was[1] || rgb[2] !== was[2]) map[c] = allocRgb(rgb, at, LIGHT_NEAR);
      }
      return map;
    };

    def('rgb', [['r', REQUIRED], ['g', REQUIRED], ['b', REQUIRED]], (v, at) =>
      this.alloc(num(v.r, at, 'rgb() red'), num(v.g, at, 'rgb() green'), num(v.b, at, 'rgb() blue'), at),
    );
    def('mix', [['a', REQUIRED], ['b', REQUIRED], ['t', 0.5]], (v, at) =>
      allocRgb(mixRgb(rgbOf(this.color(v.a, at)), rgbOf(this.color(v.b, at)), amount(v.t, at, 'mix')), at),
    );
    def('shade', [['c', REQUIRED], ['k', REQUIRED]], (v, at) => {
      const k = num(v.k, at, 'shade() amount');
      if (k < -1 || k > 1) throw new PicError(`shade: k must be -1 (black) … 1 (white), got ${k}`, at);
      return allocRgb(mixRgb(rgbOf(this.color(v.c, at)), k < 0 ? [0, 0, 0] : [255, 255, 255], Math.abs(k)), at);
    });
    def('ramp', [['a', REQUIRED], ['b', null], ['n', null]], (v, at) => {
      // ramp(a, b, n), or ramp([c1, c2, …], n) through several stops
      let stops: number[];
      let nv: Value;
      if (Array.isArray(v.a)) {
        stops = colourList(v.a, at, 'ramp');
        nv = v.b;
      } else {
        if (v.b === null || v.n === null) throw new PicError('ramp takes (a, b, n) or ([colours], n)', at);
        stops = [this.color(v.a, at), this.color(v.b, at)];
        nv = v.n;
      }
      const n = Math.round(num(nv, at, 'ramp() count'));
      if (n < 2 || n > 64) throw new PicError(`ramp: n must be 2-64, got ${n}`, at);
      if (stops.length < 2) throw new PicError('ramp needs at least 2 colours', at);
      const out: Value[] = [];
      for (let i = 0; i < n; i++) {
        const s = (i / (n - 1)) * (stops.length - 1);
        const k = Math.min(Math.floor(s), stops.length - 2);
        out.push(allocRgb(mixRgb(rgbOf(stops[k]), rgbOf(stops[k + 1]), s - k), at));
      }
      return out;
    });
    def('rgbof', [['c', REQUIRED]], (v, at) => [...rgbOf(this.color(v.c, at))]);
    def('dither', [['a', REQUIRED], ['b', REQUIRED], ['t', 0.5]], (v, at) => ['dither', this.color(v.a, at), this.color(v.b, at), amount(v.t, at, 'dither')]);
    def('linear', [['x1', REQUIRED], ['y1', REQUIRED], ['x2', REQUIRED], ['y2', REQUIRED], ['colors', REQUIRED], ['steps', 8]], (v, at) => [
      'linear',
      num(v.x1, at, 'linear() x1'),
      num(v.y1, at, 'linear() y1'),
      num(v.x2, at, 'linear() x2'),
      num(v.y2, at, 'linear() y2'),
      spread(colourList(v.colors, at, 'linear'), v.steps, at, 'linear'),
    ]);
    def('radial', [['cx', REQUIRED], ['cy', REQUIRED], ['r', REQUIRED], ['colors', REQUIRED], ['steps', 8]], (v, at) => {
      const r = num(v.r, at, 'radial() radius');
      if (r <= 0) throw new PicError('radial: r must be more than 0', at);
      return ['radial', num(v.cx, at, 'radial() cx'), num(v.cy, at, 'radial() cy'), r, spread(colourList(v.colors, at, 'radial'), v.steps, at, 'radial')];
    });
    def('palette_size', [], () => this.current.length);
    def('pixel', [['x', REQUIRED], ['y', REQUIRED]], (v, at) => {
      const x = Math.round(num(v.x, at, 'pixel() x'));
      const y = Math.round(num(v.y, at, 'pixel() y'));
      if (x < 0 || y < 0 || x >= this.W || y >= this.H) throw new PicError(`pixel(${x}, ${y}) is off the picture`, at);
      // a colour value for what shows there (white canvas stays the canvas while it still shows white)
      const i = this.shadow!.fb.get(x, y);
      if (!this.retired(i)) return i;
      const rgb = this.current[i];
      return this.alloc(rgb[0], rgb[1], rgb[2], at);
    });
    def('tint', [['c', REQUIRED], ['amount', 0.5], ['region', null], ['how', 'mix']], (v, at) => {
      const c = this.colorRgb(v.c, at);
      const t = amount(v.amount, at, 'tint');
      const how = blendMode(v.how, at, 'tint');
      let spans: number[] | undefined;
      if (v.region !== null) {
        const p = this.rawNumbers([v.region], at, 'tint region');
        if (p.length < 6 || p.length % 2) throw new PicError('tint: region must be a closed outline of at least 3 [x, y] points', at);
        spans = this.regionSpans(clipToPicture(p, this.W, this.H).map(Math.round));
        if (!spans.length) return null;
        const map = recolour(present(spans), (rgb) => blend(rgb, c, t, how), at);
        this.emit({ kind: 'remap', map, spans });
        this.turtleOp = undefined;
        return null;
      }
      // the whole picture: change the palette entries of the colours in it (no new colours), as VGA
      // games faded to night; colour values used afterwards still paint their own colours (fresh)
      const entries: number[] = [];
      for (const i of present()) {
        const rgb = blend(rgbOf(i), c, t, how).map(dac6);
        const was = this.current[i];
        if (rgb[0] === was[0] && rgb[1] === was[1] && rgb[2] === was[2]) continue;
        this.current[i] = [rgb[0], rgb[1], rgb[2]];
        entries.push(i, rgb[0], rgb[1], rgb[2]);
      }
      if (entries.length) this.emit({ kind: 'palette', entries });
      // the pen in hand may use a changed index: it is renewed before it next draws (emit)
      const pen = this.pen;
      if (entries.length && pen && [pen.color, ...(pen.pattern?.colors ?? [])].some((k) => this.retired(k))) this.penStale = true;
      this.turtleOp = undefined;
      return null;
    });
    def('glow', [['cx', REQUIRED], ['cy', REQUIRED], ['rx', REQUIRED], ['ry', REQUIRED], ['c', REQUIRED], ['amount', 0.6], ['steps', 8], ['how', 'add']], (v, at) => {
      const [cx, cy, rx, ry] = [v.cx, v.cy, v.rx, v.ry].map((x) => num(x, at, 'glow() position'));
      if (rx <= 0 || ry <= 0) throw new PicError('glow: rx and ry must be more than 0', at);
      const c = this.colorRgb(v.c, at);
      const t = amount(v.amount, at, 'glow');
      const steps = Math.round(num(v.steps, at, 'glow() steps'));
      if (steps < 1 || steps > 16) throw new PicError(`glow: steps must be 1-16, got ${steps}`, at);
      const how = blendMode(v.how, at, 'glow');
      // only the colours inside the ellipse get new palette entries
      const rows: number[] = [];
      for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(this.H - 1, Math.ceil(cy + ry)); y++) {
        let a = -1;
        let b = -2;
        for (let x = Math.max(0, Math.floor(cx - rx)); x <= Math.min(this.W - 1, Math.ceil(cx + rx)); x++) {
          if (!glowLevel(cx, cy, rx, ry, steps, x, y)) continue;
          if (a < 0) a = x;
          b = x;
        }
        if (a >= 0) rows.push(y, a, b);
      }
      if (!rows.length) return null;
      const colours = present(rows);
      const maps: number[][] = [];
      for (let k = 1; k <= steps; k++) maps.push(recolour(colours, (rgb) => blend(rgb, c, (t * k) / steps, how), at));
      this.emit({ kind: 'glow', cx, cy, rx, ry, maps });
      this.turtleOp = undefined;
      return null;
    });
  }

  /** [y, x1, x2] runs (flattened) of a closed, clipped, rounded outline: its inside and its edge pixels, as `polygon` paints them. */
  private regionSpans(pts: number[]): number[] {
    if (pts.length < 6) return [];
    const rows = new Map<number, Array<[number, number]>>();
    const add = (y: number, a: number, b: number) => {
      if (y < 0 || y >= this.H) return;
      a = Math.max(0, a);
      b = Math.min(this.W - 1, b);
      if (a <= b) (rows.get(y) ?? rows.set(y, []).get(y)!).push([a, b]);
    };
    for (const [y, a, b] of scanRows(pts)) add(y, a, b);
    const closed = [...pts, pts[0], pts[1]];
    for (let i = 0; i + 3 < closed.length; i += 2) agiLine(closed[i], closed[i + 1], closed[i + 2], closed[i + 3], (x, y) => add(y, x, x), this.W, this.H);
    const out: number[] = [];
    for (const y of [...rows.keys()].sort((u, v) => u - v)) {
      const runs = rows.get(y)!.sort((u, v) => u[0] - v[0]);
      let [a, b] = runs[0];
      for (const [c, d] of runs.slice(1)) {
        if (c <= b + 1) b = Math.max(b, d);
        else {
          out.push(y, a, b);
          [a, b] = [c, d];
        }
      }
      out.push(y, a, b);
    }
    return out;
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
      if (p[p.length - 2] === ax && p[p.length - 1] === ay && last.src?.line === this.userLoc.line && (last.delay ?? 0) === this.delayLevel) {
        this.charge();
        p.push(bx, by);
        this.shadow?.apply({ kind: 'line', points: [ax, ay, bx, by] });
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

/** Scanline rows [y, x1, x2] of a closed polygon (flat, rounded x,y list), even-odd. */
function scanRows(pts: number[]): Array<[number, number, number]> {
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
  return rows;
}

/** Sutherland-Hodgman clip of a closed polygon (flat x,y list) to the picture rectangle. */
function clipToPicture(flat: number[], W: number, H: number): number[] {
  let pts: Array<[number, number]> = [];
  for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
  const edges: Array<[(p: [number, number]) => boolean, (a: [number, number], b: [number, number]) => [number, number]]> = [
    [(p) => p[0] >= 0, (a, b) => [0, a[1] + ((b[1] - a[1]) * (0 - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= W - 1, (a, b) => [W - 1, a[1] + ((b[1] - a[1]) * (W - 1 - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= 0, (a, b) => [a[0] + ((b[0] - a[0]) * (0 - a[1])) / (b[1] - a[1]), 0]],
    [(p) => p[1] <= H - 1, (a, b) => [a[0] + ((b[0] - a[0]) * (H - 1 - a[1])) / (b[1] - a[1]), H - 1]],
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
function clipSegment(x1: number, y1: number, x2: number, y2: number, W: number, H: number): [number, number, number, number] | null {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;
  const checks: Array<[number, number]> = [
    [-dx, x1],
    [dx, W - 1 - x1],
    [-dy, y1],
    [dy, H - 1 - y1],
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
  mode: "the picture mode is 'mode vga' (or 'mode agi', the default) on a line of its own at the top of the scene",
};

function suggest(name: string): string {
  const hint = KNOWN_HINTS[name];
  return hint ? ` - ${hint}` : '';
}
