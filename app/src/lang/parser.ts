import type { Arg, Expr, Param, Program, Stmt } from './ast.ts';
import { PicError } from './errors.ts';
import { lex, type Token } from './lexer.ts';

const KEYWORDS = new Set(['let', 'fn', 'repeat', 'for', 'in', 'while', 'if', 'else', 'return', 'break', 'continue', 'scene', 'variants', 'remap', 'delay', 'true', 'false']);
const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=']);
const BINARY_PRECEDENCE: Record<string, number> = {
  '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6,
};

export function parse(src: string, file = '<input>'): Program {
  return new Parser(lex(src, file), file).program();
}

class Parser {
  private pos = 0;
  /** How many loops enclose the current statement (reset inside `fn` bodies). */
  private loopDepth = 0;
  constructor(
    private readonly tokens: Token[],
    private readonly file: string,
  ) {}

  program(): Program {
    const body = this.statements(false);
    return { file: this.file, body };
  }

  // ---------- token helpers ----------
  private get tok(): Token {
    return this.tokens[this.pos];
  }
  private peek(n = 1): Token {
    return this.tokens[Math.min(this.pos + n, this.tokens.length - 1)];
  }
  private next(): Token {
    return this.tokens[this.pos++];
  }
  private isOp(v: string, t = this.tok) {
    return t.type === 'op' && t.value === v;
  }
  private isWord(v: string, t = this.tok) {
    return t.type === 'ident' && t.value === v;
  }
  private expectOp(v: string): Token {
    if (!this.isOp(v)) this.fail(`expected '${v}' but found ${describe(this.tok)}`);
    return this.next();
  }
  private expectIdent(what = 'a name'): Token {
    if (this.tok.type !== 'ident' || KEYWORDS.has(this.tok.value)) this.fail(`expected ${what} but found ${describe(this.tok)}`);
    return this.next();
  }
  private fail(msg: string, t = this.tok): never {
    throw new PicError(msg, t.loc);
  }
  private skipNewlines() {
    while (this.tok.type === 'newline' || this.isOp(';')) this.next();
  }
  /** True at a token that ends a statement. */
  private atStatementEnd(t = this.tok) {
    return t.type === 'newline' || t.type === 'eof' || this.isOp(';', t) || this.isOp('}', t);
  }
  private endStatement() {
    if (this.tok.type === 'newline' || this.isOp(';')) this.next();
    else if (!(this.tok.type === 'eof' || this.isOp('}'))) this.fail(`expected end of statement but found ${describe(this.tok)}`);
  }

  // ---------- statements ----------
  private statements(inBlock: boolean): Stmt[] {
    const out: Stmt[] = [];
    this.skipNewlines();
    while (!(this.tok.type === 'eof' || (inBlock && this.isOp('}')))) {
      out.push(this.statement());
      this.skipNewlines();
    }
    return out;
  }

  private loopBody(): Stmt[] {
    this.loopDepth++;
    try {
      return this.block();
    } finally {
      this.loopDepth--;
    }
  }

  private block(): Stmt[] {
    this.expectOp('{');
    const body = this.statements(true);
    if (!this.isOp('}')) this.fail(`expected '}' to close block but found ${describe(this.tok)}`);
    this.next();
    return body;
  }

  private statement(): Stmt {
    const t = this.tok;
    const loc = t.loc;
    if (t.type === 'ident') {
      switch (t.value) {
        case 'let': {
          this.next();
          const name = this.expectIdent('a variable name').value;
          this.expectOp('=');
          const value = this.expr();
          this.endStatement();
          return { type: 'let', name, value, loc };
        }
        case 'fn': {
          this.next();
          const name = this.expectIdent('a function name').value;
          this.expectOp('(');
          const params: Param[] = [];
          while (!this.isOp(')')) {
            const pTok = this.expectIdent('a parameter name');
            const pname = pTok.value;
            if (params.some((p) => p.name === pname)) this.fail(`parameter '${pname}' is listed twice`, pTok);
            const param: Param = { name: pname };
            if (this.isOp('=')) {
              this.next();
              param.default = this.expr();
            }
            params.push(param);
            if (!this.isOp(')')) this.expectOp(',');
          }
          this.next();
          // `break`/`continue` can't reach a loop outside the function
          const outerLoops = this.loopDepth;
          this.loopDepth = 0;
          const body = this.block();
          this.loopDepth = outerLoops;
          return { type: 'fn', name, params, body, loc };
        }
        case 'repeat': {
          this.next();
          const count = this.expr();
          return { type: 'repeat', count, body: this.loopBody(), loc };
        }
        case 'for': {
          this.next();
          const name = this.expectIdent('a loop variable').value;
          if (!this.isWord('in')) this.fail(`expected 'in' but found ${describe(this.tok)}`);
          this.next();
          const from = this.expr();
          if (this.isOp('..') || this.isOp('..=')) {
            const inclusive = this.next().value === '..=';
            const to = this.expr();
            return { type: 'for', name, from, to, inclusive, body: this.loopBody(), loc };
          }
          return { type: 'for', name, from, inclusive: false, body: this.loopBody(), loc };
        }
        case 'while': {
          this.next();
          const cond = this.expr();
          return { type: 'while', cond, body: this.loopBody(), loc };
        }
        case 'if':
          return this.ifStatement();
        case 'break':
        case 'continue': {
          this.next();
          if (this.loopDepth === 0) this.fail(`'${t.value}' can only be used inside a loop (repeat, for or while)`, t);
          this.endStatement();
          return { type: t.value as 'break' | 'continue', loc };
        }
        case 'return': {
          this.next();
          const value = this.atStatementEnd() ? undefined : this.expr();
          this.endStatement();
          return { type: 'return', value, loc };
        }
        case 'scene': {
          this.next();
          const title = this.expr();
          this.endStatement();
          return { type: 'scene', title, loc };
        }
        case 'variants': {
          this.next();
          const names = [this.expectIdent('a variant name').value];
          while (this.isOp(',')) {
            this.next();
            names.push(this.expectIdent('a variant name').value);
          }
          this.endStatement();
          return { type: 'variants', names, loc };
        }
        case 'remap':
          return this.remapStatement();
        case 'delay': {
          this.next();
          const level = this.isOp('{') ? undefined : this.expr();
          return { type: 'delay', level, body: this.block(), loc };
        }
        case 'else':
          this.fail("'else' without a matching 'if'");
      }
      if (!KEYWORDS.has(t.value)) return this.identStatement();
    }
    const expr = this.expr();
    return this.finishExprStatement(expr, loc);
  }

  private ifStatement(): Stmt {
    const loc = this.next().loc;
    const cond = this.expr();
    const then = this.block();
    // allow `}` newline `else`
    const save = this.pos;
    while (this.tok.type === 'newline') this.next();
    if (!this.isWord('else')) {
      this.pos = save;
      return { type: 'if', cond, then, loc };
    }
    this.next();
    const elseBody = this.isWord('if') ? [this.ifStatement()] : this.block();
    return { type: 'if', cond, then, else: elseBody, loc };
  }

  private remapStatement(): Stmt {
    const loc = this.next().loc;
    let variant: string | undefined;
    if (this.tok.type === 'ident') variant = this.next().value;
    this.expectOp('{');
    const pairs: Array<[Expr, Expr]> = [];
    this.skipNewlines();
    while (!this.isOp('}')) {
      const from = this.expr();
      this.expectOp(':');
      const to = this.expr();
      pairs.push([from, to]);
      if (this.isOp(',')) this.next();
      else if (!this.isOp('}') && this.tok.type !== 'newline') this.fail(`expected ',' or '}' in remap but found ${describe(this.tok)}`);
      this.skipNewlines();
    }
    this.next();
    this.endStatement();
    return { type: 'remap', variant, pairs, loc };
  }

  /** A statement starting with a non-keyword identifier: assignment, call, or command. */
  private identStatement(): Stmt {
    const t = this.tok;
    const after = this.peek();
    const adjacentCall = (this.isOp('(', after) || this.isOp('[', after)) && !after.spaceBefore;
    if (adjacentCall || (after.type === 'op' && ASSIGN_OPS.has(after.value)) || this.atStatementEnd(after)) {
      if (this.atStatementEnd(after)) {
        // bare name → zero-argument command
        this.next();
        this.endStatement();
        const callee: Expr = { type: 'ident', name: t.value, loc: t.loc };
        return { type: 'expr', expr: { type: 'call', callee, args: [], loc: t.loc }, loc: t.loc };
      }
      const expr = this.expr();
      return this.finishExprStatement(expr, t.loc);
    }
    // Command form: `name arg, arg  arg ...`
    this.next();
    const args = this.commandArgs();
    this.endStatement();
    const callee: Expr = { type: 'ident', name: t.value, loc: t.loc };
    return { type: 'expr', expr: { type: 'call', callee, args, loc: t.loc }, loc: t.loc };
  }

  private finishExprStatement(expr: Expr, loc: Stmt['loc']): Stmt {
    if (this.tok.type === 'op' && ASSIGN_OPS.has(this.tok.value)) {
      if (expr.type !== 'ident' && expr.type !== 'index') this.fail('can only assign to a variable or list element');
      const op = this.next().value as '=' | '+=' | '-=' | '*=' | '/=';
      const value = this.expr();
      this.endStatement();
      return { type: 'assign', target: expr, op, value, loc };
    }
    if (expr.type !== 'call') throw new PicError('this expression does nothing on its own (expected a command, call, or assignment)', loc);
    this.endStatement();
    return { type: 'expr', expr, loc };
  }

  /**
   * Arguments of a command written without parentheses. Arguments are separated by
   * commas or by whitespace (`line 0,0  10,5`). A trailing comma continues onto the next line.
   */
  private commandArgs(): Arg[] {
    const args: Arg[] = [];
    while (!this.atStatementEnd()) {
      args.push(this.arg(true));
      if (this.isOp(',')) {
        this.next();
        while (this.tok.type === 'newline') this.next();
        if (this.atStatementEnd()) this.fail('expected an argument after \',\'');
      }
    }
    return args;
  }

  private arg(juxtaposed: boolean): Arg {
    const loc = this.tok.loc;
    if (this.tok.type === 'ident' && this.isOp(':', this.peek()) && !KEYWORDS.has(this.tok.value)) {
      const name = this.next().value;
      this.next();
      return { name, value: this.expr(juxtaposed), loc };
    }
    return { value: this.expr(juxtaposed), loc };
  }

  // ---------- expressions ----------
  /** `juxtaposed` = parsing a whitespace-separated command argument, where ` -5` starts a new argument. */
  expr(juxtaposed = false): Expr {
    const cond = this.binary(0, juxtaposed);
    if (this.isOp('?')) {
      this.next();
      const then = this.expr();
      this.expectOp(':');
      const otherwise = this.expr(juxtaposed);
      return { type: 'ternary', cond, then, else: otherwise, loc: cond.loc };
    }
    return cond;
  }

  private binary(minPrec: number, juxtaposed: boolean): Expr {
    let left = this.unary(juxtaposed);
    for (;;) {
      const t = this.tok;
      if (t.type !== 'op') break;
      const prec = BINARY_PRECEDENCE[t.value];
      if (prec === undefined || prec <= minPrec) break;
      // in command arguments ` -5` starts a new argument - but not a `-` at the end of a line
      if (juxtaposed && t.value === '-' && t.spaceBefore && !this.peek().spaceBefore && this.peek().type !== 'newline') break;
      this.next();
      // a binary operator at the end of a line continues the expression on the next line
      // (line breaks only: a `;` still ends the statement)
      while (this.tok.type === 'newline') this.next();
      const right = this.binary(prec, juxtaposed);
      left = { type: 'binary', op: t.value, left, right, loc: t.loc };
    }
    return left;
  }

  private unary(juxtaposed: boolean): Expr {
    const t = this.tok;
    if (this.isOp('-') || this.isOp('!')) {
      this.next();
      const arg = this.unary(juxtaposed);
      if (t.value === '-' && arg.type === 'num') return { type: 'num', value: -arg.value, loc: t.loc };
      return { type: 'unary', op: t.value as '-' | '!', arg, loc: t.loc };
    }
    return this.postfix();
  }

  private postfix(): Expr {
    let e = this.primary();
    for (;;) {
      if (this.isOp('(') && !this.tok.spaceBefore) {
        const loc = this.next().loc;
        const args: Arg[] = [];
        while (!this.isOp(')')) {
          args.push(this.arg(false));
          if (!this.isOp(')')) this.expectOp(',');
        }
        this.next();
        e = { type: 'call', callee: e, args, loc: e.loc ?? loc };
      } else if (this.isOp('[') && !this.tok.spaceBefore) {
        this.next();
        const index = this.expr();
        this.expectOp(']');
        e = { type: 'index', object: e, index, loc: e.loc };
      } else return e;
    }
  }

  private primary(): Expr {
    const t = this.tok;
    switch (t.type) {
      case 'num':
        this.next();
        return { type: 'num', value: t.num!, loc: t.loc };
      case 'str':
        this.next();
        return { type: 'str', value: t.value, loc: t.loc };
      case 'ident':
        if (t.value === 'true' || t.value === 'false') {
          this.next();
          return { type: 'bool', value: t.value === 'true', loc: t.loc };
        }
        if (KEYWORDS.has(t.value)) this.fail(`'${t.value}' is a keyword and can't be used here`);
        this.next();
        return { type: 'ident', name: t.value, loc: t.loc };
      case 'op':
        if (t.value === '(') {
          this.next();
          const e = this.expr();
          if (this.isOp(',')) {
            this.fail("a parenthesised value can't contain ',' - to call a function write name(a, b) with no space before '(', or name a, b");
          }
          this.expectOp(')');
          return e;
        }
        if (t.value === '[') {
          this.next();
          const items: Expr[] = [];
          while (!this.isOp(']')) {
            items.push(this.expr());
            if (!this.isOp(']')) this.expectOp(',');
          }
          this.next();
          return { type: 'list', items, loc: t.loc };
        }
    }
    this.fail(`expected a value but found ${describe(t)}`);
  }
}

function describe(t: Token): string {
  switch (t.type) {
    case 'eof':
      return 'end of file';
    case 'newline':
      return 'end of line';
    case 'str':
      return `"${t.value}"`;
    default:
      return `'${t.value}'`;
  }
}
