import { Painter } from '../../engine/execute.ts';
import { PIC_HEIGHT, PIC_WIDTH } from '../../engine/framebuffer.ts';
import type { Op } from '../../engine/ops.ts';
import { EGA_PALETTE } from '../../engine/palette.ts';
import { compileProgram, parse } from '../../lang/index.ts';
import { APP_NAME } from '../config.ts';
import { stdlibProgram } from '../scenes.ts';
import { WELCOME } from './config.ts';
import { GLYPH_SIZE, glyph } from './font.ts';
import { MusicPlayer } from './player.ts';
import titleSource from './title.pic?raw';
import './welcome.css';

/**
 * The title screen: KQ1's scroll-and-ribbon picture (retitled), painted stroke by stroke, then the
 * credits rolling up the black scroll in the PC's 8×8 BIOS font while Greensleeves plays.
 */

/** Set once the welcome screen has been dismissed, so it greets each browser only once. */
export const SEEN_KEY = 'kq-welcome-seen';

// The screen is AGI's 320-wide text grid over the 160×168 picture: a character is 8×8 there, i.e.
// four picture pixels wide. Positions and timings are in config.ts.
const SCREEN_WIDTH = PIC_WIDTH * 2;
const BLACK = 0;
const TEXT_COLOR = EGA_PALETTE[15];

type Paragraph = { text: string; center?: boolean };

/** Wrapped to the scroll's width; centred lines are credits, the rest is prose. Run through the humanizer skill. */
const CREDITS: Paragraph[] = [
  { text: `Welcome to\n${APP_NAME}`, center: true },
  { text: 'Each picture here is a short program, written in PicScript, a little drawing language that borrows from Logo. You set a colour and draw lines, then flood-fill between them.' },
  { text: "The program compiles to the kind of picture commands Sierra's AGI engine used for King's Quest in 1984: 160 by 168 pixels, sixteen EGA colours." },
  { text: 'A custom skill drives a large language model to generate the scene\'s script. Describe a scene, or give it a picture or a rough sketch, and it writes the PicScript. Then it renders the scene, looks at it and fixes what came out wrong.' },
  { text: 'The viewer replays each scene stroke by stroke.' },
  { text: "Title picture and King's Quest I backgrounds:\nSierra On-Line, 1984", center: true },
  { text: "Music:\nGreensleeves, after the King's Quest I PCjr arrangement", center: true },
  { text: "Font:\nIBM PC BIOS 8x8, from VileR's Ultimate Oldschool PC Font Pack", center: true },
  { text: 'Press ENTER\nto come in', center: true },
];

/** Greedy word wrap to `width` columns (a word longer than that is split). */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (let word of para.split(/\s+/).filter(Boolean)) {
      while (word.length > width) {
        if (line) lines.push(line);
        lines.push(word.slice(0, width));
        word = word.slice(width);
        line = '';
      }
      if (!line) line = word;
      else if (line.length + 1 + word.length <= width) line += ` ${word}`;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** The credits as text-grid lines, blank lines between paragraphs. */
export function creditLines(paragraphs = CREDITS, width = WELCOME.text.columns): string[] {
  return paragraphs.flatMap((p, i) => {
    const lines = wrap(p.text, width).map((l) => (p.center ? ' '.repeat(Math.floor((width - l.length) / 2)) + l : l));
    return i ? ['', ...lines] : lines;
  });
}

let titleOps: Op[] | undefined;
function compileTitle(): Op[] {
  return (titleOps ??= compileProgram(parse(titleSource, 'src/app/welcome/title.pic'), { prelude: stdlibProgram() }).ops);
}

/** Paints the title picture and rolls the credits over it on a 320×168 canvas. */
class TitleScreen {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private readonly painter = new Painter();
  private readonly ops = compileTitle();
  private readonly lines = creditLines();
  private cursor = 0;
  private scrollStart = 0;
  private raf = 0;
  /** The finished picture, once painted, to lay the credits over without repainting it. */
  private background?: Uint8ClampedArray;
  /** Where the credits were last drawn, so frames where nothing moves skip the work. */
  private shownTop = NaN;
  /** Where the credits are: 'painting' the picture, then 'scrolling'. */
  phase: 'painting' | 'scrolling' = 'painting';

  constructor(private readonly canvas: HTMLCanvasElement, private readonly reducedMotion: boolean) {
    canvas.width = SCREEN_WIDTH;
    canvas.height = PIC_HEIGHT;
    this.ctx = canvas.getContext('2d')!;
    this.image = this.ctx.createImageData(SCREEN_WIDTH, PIC_HEIGHT);
  }

  start(): void {
    const tick = (now: number) => {
      this.frame(now);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }

  private frame(now: number): void {
    if (this.phase === 'painting') {
      // with reduced motion the picture appears whole rather than stroke by stroke
      const n = this.reducedMotion ? Infinity : WELCOME.paintOpsPerFrame;
      for (let i = 0; i < n && this.cursor < this.ops.length; i++) this.painter.apply(this.ops[this.cursor++]);
      this.drawPicture();
      if (this.cursor < this.ops.length) {
        this.ctx.putImageData(this.image, 0, 0);
        return;
      }
      this.background = this.image.data.slice();
      this.phase = 'scrolling';
      this.scrollStart = now;
      this.canvas.dataset.phase = 'scrolling';
    }
    const top = this.creditsTop(now - this.scrollStart);
    if (top === this.shownTop) return;
    this.shownTop = top;
    this.canvas.dataset.top = String(top); // (for the tests)
    this.image.data.set(this.background!);
    this.drawCredits(top);
    this.ctx.putImageData(this.image, 0, 0);
  }

  private drawPicture(): void {
    const { pixels } = this.painter.fb;
    const data = this.image.data;
    for (let y = 0; y < PIC_HEIGHT; y++) {
      for (let x = 0; x < PIC_WIDTH; x++) {
        const [r, g, b] = EGA_PALETTE[pixels[y * PIC_WIDTH + x]];
        const i = (y * SCREEN_WIDTH + x * 2) * 4;
        data[i] = data[i + 4] = r;
        data[i + 1] = data[i + 5] = g;
        data[i + 2] = data[i + 6] = b;
        data[i + 3] = data[i + 7] = 255;
      }
    }
  }

  /**
   * The top of the credits, in picture rows, `elapsed` ms into the roll. They roll the same with
   * reduced motion: a slow, steady crawl is gentler than turning over a page of text at a time.
   */
  private creditsTop(elapsed: number): number {
    const { top, bottom } = WELCOME.scroll;
    const height = this.lines.length * GLYPH_SIZE;
    // in from below the roll, out over the top, then round again after a pause
    const travel = bottom - top + 1 + height;
    const cycle = travel * WELCOME.scrollRowMs + WELCOME.pauseBeforeRepeatMs;
    return bottom + 1 - Math.floor((elapsed % cycle) / WELCOME.scrollRowMs);
  }

  /** Write the credits, their first line's top at picture row `top`, onto the finished picture. */
  private drawCredits(top: number): void {
    const scroll = WELCOME.scroll;
    const left = WELCOME.text.leftColumn * GLYPH_SIZE;
    const { pixels } = this.painter.fb;
    const data = this.image.data;
    this.lines.forEach((line, row) => {
      const y0 = top + row * GLYPH_SIZE;
      if (y0 > scroll.bottom || y0 + GLYPH_SIZE <= scroll.top) return;
      for (let c = 0; c < line.length; c++) {
        if (line[c] === ' ') continue;
        const bits = glyph(line[c]);
        for (let gy = 0; gy < GLYPH_SIZE; gy++) {
          const y = y0 + gy;
          if (y < scroll.top || y > scroll.bottom) continue;
          for (let gx = 0; gx < GLYPH_SIZE; gx++) {
            if (!(bits[gy] & (0x80 >> gx))) continue;
            const x = left + c * GLYPH_SIZE + gx;
            const px = x >> 1;
            // only on the scroll's black: the rolled ends and outline hide what's under them
            if (px < scroll.left || px > scroll.right || pixels[y * PIC_WIDTH + px] !== BLACK) continue;
            const i = (y * SCREEN_WIDTH + x) * 4;
            [data[i], data[i + 1], data[i + 2]] = TEXT_COLOR;
          }
        }
      }
    });
  }
}

let open: { close(): void } | undefined;

/**
 * Show the title screen (a modal dialog), with the music playing. Clicking off the picture, Enter,
 * Space or Escape dismisses it, after which `onClose` runs.
 */
export function openWelcome(onClose?: () => void): void {
  if (open) return;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dialog = document.createElement('dialog');
  dialog.id = 'welcome';
  dialog.tabIndex = -1;
  dialog.setAttribute('aria-labelledby', 'welcome-heading');
  dialog.setAttribute('aria-describedby', 'welcome-hint');
  dialog.innerHTML = `
    <h2 id="welcome-heading" class="visually-hidden">${APP_NAME}</h2>
    <div class="welcome-frame"><canvas aria-hidden="true" data-phase="painting"></canvas></div>
    <div class="visually-hidden">${CREDITS.map((p) => `<p>${p.text.replace(/\n/g, ' ')}</p>`).join('')}</div>
    <p id="welcome-hint" class="visually-hidden">Press Enter or Escape, or click outside the picture, to go in.</p>`;
  document.body.append(dialog);
  const canvas = dialog.querySelector('canvas')!;
  const screen = new TitleScreen(canvas, reducedMotion);
  const music = new MusicPlayer(() => (dialog.dataset.music = music.playing ? 'on' : 'off'));
  dialog.dataset.music = 'off';

  const close = () => {
    if (open !== handle) return;
    open = undefined;
    screen.stop();
    music.stop();
    if (dialog.open) dialog.close();
    dialog.remove();
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      // storage may be unavailable (private mode); the screen just shows again next time
    }
    onClose?.();
  };
  const handle = { close };
  open = handle;

  // Browsers let sound start only after a click or key press on the page. When the screen was
  // opened by one, it plays at once; otherwise a click on the picture (or any other key) starts it.
  dialog.showModal();
  dialog.focus();
  screen.start();
  music.start();
  dialog.addEventListener('click', (e) => {
    // the backdrop is part of the dialog element; the picture is inside it
    if (e.target === dialog) close();
    else music.start();
  });
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault(); // Escape: close through the same path
    close();
  });
  dialog.addEventListener('keydown', (e) => {
    e.stopPropagation(); // the viewer's shortcuts stay quiet behind the dialog
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      close();
    } else if (!e.metaKey && !e.ctrlKey && !e.altKey) music.start();
  });
}

/** Whether this browser has dismissed the title screen before. */
export function welcomeSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}
