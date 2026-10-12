import { describe, expect, it } from 'vitest';
import { COLOR_NAMES, EGA_PALETTE, rgbToIndex } from '../../src/engine/palette.ts';

describe('palette', () => {
  it('has 16 named EGA colours', () => {
    expect(EGA_PALETTE).toHaveLength(16);
    expect(COLOR_NAMES).toHaveLength(16);
  });
  it('round-trips rgb to index', () => {
    EGA_PALETTE.forEach(([r, g, b], i) => expect(rgbToIndex(r, g, b)).toBe(i));
    expect(rgbToIndex(1, 2, 3)).toBe(-1);
  });
});
