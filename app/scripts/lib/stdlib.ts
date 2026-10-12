import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Program } from '../../src/lang/ast.ts';
import { parse } from '../../src/lang/index.ts';

export const STDLIB_PATH = fileURLToPath(new URL('../../src/lang/stdlib.pic', import.meta.url));

let cached: Program | undefined;
/** The parsed PicScript standard library (Node side; the browser imports it with ?raw). */
export function stdlib(): Program {
  return (cached ??= parse(readFileSync(STDLIB_PATH, 'utf8'), 'stdlib.pic'));
}
