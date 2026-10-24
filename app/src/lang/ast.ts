import type { Loc } from './errors.ts';

export type Expr =
  | { type: 'num'; value: number; loc: Loc }
  | { type: 'str'; value: string; loc: Loc }
  | { type: 'bool'; value: boolean; loc: Loc }
  | { type: 'ident'; name: string; loc: Loc }
  | { type: 'list'; items: Expr[]; loc: Loc }
  | { type: 'unary'; op: '-' | '!'; arg: Expr; loc: Loc }
  | { type: 'binary'; op: string; left: Expr; right: Expr; loc: Loc }
  | { type: 'ternary'; cond: Expr; then: Expr; else: Expr; loc: Loc }
  | { type: 'call'; callee: Expr; args: Arg[]; loc: Loc }
  | { type: 'index'; object: Expr; index: Expr; loc: Loc };

export interface Arg {
  name?: string;
  value: Expr;
  loc: Loc;
}

export interface Param {
  name: string;
  default?: Expr;
}

export type Stmt =
  | { type: 'let'; name: string; value: Expr; loc: Loc }
  | { type: 'assign'; target: Expr; op: '=' | '+=' | '-=' | '*=' | '/='; value: Expr; loc: Loc }
  | { type: 'expr'; expr: Expr; loc: Loc }
  | { type: 'fn'; name: string; params: Param[]; body: Stmt[]; loc: Loc }
  | { type: 'repeat'; count: Expr; body: Stmt[]; loc: Loc }
  | { type: 'for'; name: string; from: Expr; to?: Expr; inclusive: boolean; body: Stmt[]; loc: Loc }
  | { type: 'while'; cond: Expr; body: Stmt[]; loc: Loc }
  | { type: 'if'; cond: Expr; then: Stmt[]; else?: Stmt[]; loc: Loc }
  | { type: 'return'; value?: Expr; loc: Loc }
  | { type: 'break'; loc: Loc }
  | { type: 'continue'; loc: Loc }
  | { type: 'scene'; title: Expr; loc: Loc }
  | { type: 'variants'; names: string[]; loc: Loc }
  /** `mode vga`: the picture this scene paints (AGI 160×168 EGA without one). */
  | { type: 'mode'; mode: 'agi' | 'vga'; arg: Expr; loc: Loc }
  | { type: 'remap'; variant?: string; pairs: Array<[Expr, Expr]>; loc: Loc }
  /** Ops painted inside are played later by the viewer (level 1 when omitted); see Op.delay. */
  | { type: 'delay'; level?: Expr; body: Stmt[]; loc: Loc };

export interface Program {
  file: string;
  body: Stmt[];
}
