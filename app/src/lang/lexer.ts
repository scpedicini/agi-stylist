import { PicError, type Loc } from './errors.ts';

export type TokenType = 'num' | 'str' | 'ident' | 'op' | 'newline' | 'eof';

export interface Token {
  type: TokenType;
  value: string;
  num?: number;
  loc: Loc;
  /** Whitespace (or line start) immediately precedes this token. Used to tell `f(x)` from `f (x)` and `a - 1` from `a -1`. */
  spaceBefore: boolean;
}

// Longest operators first.
const OPERATORS = [
  '..=', '==', '!=', '<=', '>=', '&&', '||', '+=', '-=', '*=', '/=', '..',
  '(', ')', '{', '}', '[', ']', ',', ':', ';', '=', '<', '>', '+', '-', '*', '/', '%', '!', '?',
];

/**
 * Tokenize PicScript. `#` starts a comment. Newlines are significant (they end
 * statements) except inside (), [] - so long argument lists can wrap freely there.
 */
export function lex(src: string, file = '<input>'): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let col = 1;
  let depth = 0;
  let spaceBefore = true;
  const loc = (): Loc => ({ file, line, col });
  const advance = (n: number) => {
    for (let k = 0; k < n; k++) {
      if (src[i] === '\n') {
        line++;
        col = 1;
      } else col++;
      i++;
    }
  };

  while (i < src.length) {
    const ch = src[i];
    if (ch === '\n') {
      if (depth === 0) tokens.push({ type: 'newline', value: '\n', loc: loc(), spaceBefore });
      advance(1);
      spaceBefore = true;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      advance(1);
      spaceBefore = true;
      continue;
    }
    if (ch === '#') {
      while (i < src.length && src[i] !== '\n') advance(1);
      continue;
    }
    const start = loc();
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i;
      while (/[0-9]/.test(src[j] ?? '')) j++;
      if (src[j] === '.' && /[0-9]/.test(src[j + 1] ?? '')) {
        j++;
        while (/[0-9]/.test(src[j] ?? '')) j++;
      }
      const text = src.slice(i, j);
      tokens.push({ type: 'num', value: text, num: Number(text), loc: start, spaceBefore });
      advance(j - i);
      spaceBefore = false;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (/[A-Za-z0-9_]/.test(src[j] ?? '')) j++;
      tokens.push({ type: 'ident', value: src.slice(i, j), loc: start, spaceBefore });
      advance(j - i);
      spaceBefore = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let text = '';
      while (j < src.length && src[j] !== ch) {
        if (src[j] === '\n') throw new PicError('unterminated string', start);
        if (src[j] === '\\' && j + 1 < src.length) {
          const esc = src[j + 1];
          text += esc === 'n' ? '\n' : esc === 't' ? '\t' : esc;
          j += 2;
        } else text += src[j++];
      }
      if (j >= src.length) throw new PicError('unterminated string', start);
      tokens.push({ type: 'str', value: text, loc: start, spaceBefore });
      advance(j + 1 - i);
      spaceBefore = false;
      continue;
    }
    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (!op) throw new PicError(`unexpected character '${ch}'`, start);
    if (op === '(' || op === '[') depth++;
    if ((op === ')' || op === ']') && depth > 0) depth--;
    tokens.push({ type: 'op', value: op, loc: start, spaceBefore });
    advance(op.length);
    spaceBefore = false;
  }
  tokens.push({ type: 'eof', value: '', loc: loc(), spaceBefore: true });
  return tokens;
}
