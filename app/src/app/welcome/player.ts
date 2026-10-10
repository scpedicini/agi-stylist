import { WELCOME } from './config.ts';
import { TEMPO_BPM, VOICES } from './music.ts';

/** Each note starts loud and decays (×0.62 every 0.2 s) to a quiet hold, as the PCjr played it. */
const SUSTAIN = 0.1;
const DECAY_TIME_CONSTANT = 0.42;
/** Notes are queued this far ahead, so a throttled background-tab timer can't starve the tune. */
const LOOKAHEAD_S = 1.5;
const TICK_MS = 200;

const frequency = (midi: number) => 440 * 2 ** ((midi - 69 + WELCOME.music.detuneCents / 100) / 12);

/** Loops the three-voice Greensleeves on square-wave oscillators, like the PCjr's sound chip. */
export class MusicPlayer {
  private ctx?: AudioContext;
  private timer?: ReturnType<typeof setInterval>;

  /** `onChange` hears when the music actually starts or stops. */
  constructor(private readonly onChange: () => void = () => {}) {}

  get playing(): boolean {
    return this.ctx?.state === 'running';
  }

  /**
   * Start the tune. Browsers hold sound back until a click or key press, so without one the music
   * waits, and starts when `start()` is next called from one. Without working Web Audio it stays
   * quiet (and never throws).
   */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume().catch(() => {});
      return;
    }
    let ctx: AudioContext;
    try {
      ctx = new AudioContext();
    } catch {
      return; // no Web Audio (or too many contexts): no music
    }
    this.ctx = ctx;
    ctx.onstatechange = () => {
      if (this.ctx !== ctx) return;
      if (ctx.state === 'running' && !this.timer) this.schedule(ctx);
      this.onChange();
    };
    if (ctx.state === 'running') this.schedule(ctx);
    else void ctx.resume().catch(() => {});
  }

  stop(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.ctx = undefined;
    clearInterval(this.timer);
    this.timer = undefined;
    void ctx.close().catch(() => {});
    this.onChange();
  }

  private schedule(ctx: AudioContext): void {
    try {
      this.play(ctx);
    } catch {
      this.stop();
    }
  }

  private play(ctx: AudioContext): void {
    const beat = 60 / TEMPO_BPM;
    const volume = WELCOME.music.volume;
    const start = ctx.currentTime + 0.05;
    const voices = VOICES.map((notes) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      gain.gain.value = 0;
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      return { notes, osc, gain, index: 0, time: start };
    });
    const queue = () => {
      const until = ctx.currentTime + LOOKAHEAD_S;
      for (const v of voices) {
        while (v.time < until) {
          const [midi, beats] = v.notes[v.index];
          const g = v.gain.gain;
          g.cancelScheduledValues(v.time);
          if (midi === null) g.setTargetAtTime(0, v.time, 0.005);
          else {
            v.osc.frequency.setValueAtTime(frequency(midi), v.time);
            g.setTargetAtTime(volume, v.time, 0.002);
            g.setTargetAtTime(volume * SUSTAIN, v.time + 0.01, DECAY_TIME_CONSTANT);
          }
          v.time += beats * beat;
          v.index = (v.index + 1) % v.notes.length;
        }
      }
    };
    queue();
    this.timer = setInterval(queue, TICK_MS);
  }
}
