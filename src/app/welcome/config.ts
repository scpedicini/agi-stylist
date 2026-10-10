/** Knobs for the title screen. */
export const WELCOME = {
  /** How long the credits take to move up one picture row, in ms (smaller scrolls faster). */
  scrollRowMs: 100,
  /** The pause after the last line leaves the top, before the credits come round again. */
  pauseBeforeRepeatMs: 1500,
  /** How many of the title picture's drawing instructions to paint per frame. */
  paintOpsPerFrame: 4,
  /**
   * Where the credits are written, in AGI's 40-column text grid (each column is 8 pixels of the
   * 320-wide screen, i.e. 4 picture pixels). The scroll's black runs from about column 9 to 30, but
   * it leans left towards the bottom, so the right edge is tighter there than at the top.
   */
  text: { leftColumn: 12, columns: 16 },
  /**
   * The part of the picture (160×168, picture pixels) the credits may show in. Within it, they're
   * drawn only on the scroll's black, so its outline and rolled ends hide the text that's under them.
   */
  scroll: { top: 43, bottom: 151, left: 36, right: 125 },
  music: {
    /** Each voice's peak loudness, 0-1 (three square waves add up fast). */
    volume: 0.07,
    /** The recording sits about half a semitone sharp of A440 (the PCjr's clock, not the score). */
    detuneCents: 48,
  },
};
