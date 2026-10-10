import stdlibSource from '../lang/stdlib.pic?raw';
import { parse } from '../lang/index.ts';
import type { Program } from '../lang/ast.ts';
import { HIDDEN_GROUPS } from './config.ts';

export interface SceneEntry {
  /** e.g. "kq1/r01-c01", "handmade/castle", "custom/apple-meadow" */
  id: string;
  group: string;
  name: string;
  path: string;
  source: string;
  /** Reference picture URL (for compare mode), if any. */
  referenceUrl?: string;
  /**
   * The picture the scene was translated or composed from: Myst's or KQ6's screens, or the layout sketch.
   * It's shown on the stage until the user rasterizes the scene,
   * stretched plainly to the 1.9:1 screen, and in compare mode.
   */
  originalUrl?: string;
  /** Whether the gallery shows the original rather than the painted scene (Myst's and KQ6's screens, not sketches). */
  originalThumbnail: boolean;
}

const sources = import.meta.glob('/scenes/**/*.pic', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const references = import.meta.glob('/reference/**/*.png', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
/** The layout sketches the sketch scenes were composed from, shown as they are (an ASCII layout by its
 * preview picture), keyed by name: tests/fixtures/sketches/[holdout/]<name>.{png,jpg}. */
const sketchFiles = import.meta.glob(['/tests/fixtures/sketches/**/*.png', '/tests/fixtures/sketches/**/*.jpg'], { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const sketches = Object.fromEntries(Object.entries(sketchFiles).map(([path, url]) => [path.replace(/^.*\//, '').replace(/(\.preview)?\.(png|jpg)$/, ''), url]));

const GROUP_ORDER = ['custom', 'examples', 'handmade', 'sketches', 'myst', 'kq6', 'kq1'];

/** Groups whose scenes open on their original picture (reference/<group>/<name>.png) and are painted over it. */
const ORIGINAL_GROUPS = ['myst', 'kq6'];

/** `# @reference kq1/r01-c02` in a scene header points compare mode at a reference tile. */
const REFERENCE_DIRECTIVE = /^#\s*@reference\s+(\S+)/m;

export const SCENES: SceneEntry[] = Object.entries(sources)
  .map(([path, source]) => {
    const id = path.replace(/^\/scenes\//, '').replace(/\.pic$/, '');
    const [group, ...rest] = id.split('/');
    const ref = REFERENCE_DIRECTIVE.exec(source)?.[1] ?? (group === 'kq1' ? id : undefined);
    const originalUrl = group === 'sketches' ? sketches[rest.join('/')] : ORIGINAL_GROUPS.includes(group) ? references[`/reference/${id}.png`] : undefined;
    const originalThumbnail = (group === 'kq6' || group === 'myst') && !!originalUrl;
    return { id, group, name: rest.join('/'), path: path.slice(1), source, referenceUrl: ref ? references[`/reference/${ref}.png`] : undefined, originalUrl, originalThumbnail };
  })
  .sort((a, b) => {
    const g = GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group);
    return g || a.id.localeCompare(b.id);
  });

/** Indices into SCENES of the scenes the viewer lists (all but HIDDEN_GROUPS'), in order. */
export const LISTED: readonly number[] = SCENES.flatMap((s, i) => (HIDDEN_GROUPS.includes(s.group) ? [] : [i]));

let stdlib: Program | undefined;
export function stdlibProgram(): Program {
  return (stdlib ??= parse(stdlibSource, 'stdlib.pic'));
}
