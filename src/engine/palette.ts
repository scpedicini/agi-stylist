/** The 16-colour EGA palette used by AGI, as 8-bit RGB triples. */
export const EGA_PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [0x00, 0x00, 0x00], // 0  black
  [0x00, 0x00, 0xaa], // 1  blue
  [0x00, 0xaa, 0x00], // 2  green
  [0x00, 0xaa, 0xaa], // 3  cyan
  [0xaa, 0x00, 0x00], // 4  red
  [0xaa, 0x00, 0xaa], // 5  magenta
  [0xaa, 0x55, 0x00], // 6  brown
  [0xaa, 0xaa, 0xaa], // 7  lightgrey
  [0x55, 0x55, 0x55], // 8  darkgrey
  [0x55, 0x55, 0xff], // 9  lightblue
  [0x55, 0xff, 0x55], // 10 lightgreen
  [0x55, 0xff, 0xff], // 11 lightcyan
  [0xff, 0x55, 0x55], // 12 lightred
  [0xff, 0x55, 0xff], // 13 lightmagenta
  [0xff, 0xff, 0x55], // 14 yellow
  [0xff, 0xff, 0xff], // 15 white
];

/** Canonical colour names, indexed by palette number. */
export const COLOR_NAMES = [
  'black', 'blue', 'green', 'cyan', 'red', 'magenta', 'brown', 'lightgrey',
  'darkgrey', 'lightblue', 'lightgreen', 'lightcyan', 'lightred', 'lightmagenta', 'yellow', 'white',
] as const;

/** Extra spellings accepted by PicScript. */
export const COLOR_ALIASES: Record<string, number> = {
  grey: 7, gray: 7, lightgray: 7, darkgray: 8, pink: 12, orange: 6,
};

export const WHITE = 15;

/** Map an RGB triple to its EGA palette index, or -1 if it is not an exact palette colour. */
export function rgbToIndex(r: number, g: number, b: number): number {
  return EGA_PALETTE.findIndex(([pr, pg, pb]) => pr === r && pg === g && pb === b);
}
