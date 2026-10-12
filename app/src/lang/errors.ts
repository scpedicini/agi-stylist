export interface Loc {
  file: string;
  line: number;
  col: number;
}

/** A PicScript compile or runtime error, formatted as `file:line:col: message`. */
export class PicError extends Error {
  constructor(
    readonly detail: string,
    readonly loc: Loc,
  ) {
    super(`${loc.file}:${loc.line}:${loc.col}: ${detail}`);
    this.name = 'PicError';
  }
}

export interface Diagnostic {
  message: string;
  loc: Loc;
}

export const formatDiagnostic = (d: Diagnostic) => `${d.loc.file}:${d.loc.line}:${d.loc.col}: ${d.message}`;
