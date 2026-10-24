import { PIC_HEIGHT, PIC_WIDTH, VGA_HEIGHT, VGA_WIDTH } from '../../src/engine/framebuffer.ts';

/**
 * The picture the grid and sketch tools measure in: AGI's 160×168 with pixels twice as wide as tall
 * (aspect 2), unless `pnpm grid --vga` switched it to VGA's 320×200 square pixels (aspect 1). Set
 * once, before any measuring; the AGI values are the defaults.
 */
export const PIC = { width: PIC_WIDTH, height: PIC_HEIGHT, aspect: 2 };

export function usePicture(mode: 'agi' | 'vga'): void {
  Object.assign(PIC, mode === 'vga' ? { width: VGA_WIDTH, height: VGA_HEIGHT, aspect: 1 } : { width: PIC_WIDTH, height: PIC_HEIGHT, aspect: 2 });
}
