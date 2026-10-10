// The title screen's music player against a stand-in for Web Audio: it must never throw, and only
// queue notes once the browser actually lets the sound run.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MusicPlayer } from '../../src/app/welcome/player.ts';

class FakeParam {
  value = 0;
  setValueAtTime() {}
  setTargetAtTime() {}
  cancelScheduledValues() {}
}
class FakeNode {
  frequency = new FakeParam();
  gain = new FakeParam();
  type = '';
  connect<T>(n: T) {
    return n;
  }
  start() {}
}
class FakeContext {
  static made: FakeContext[] = [];
  static initial: AudioContextState = 'suspended';
  static resumeFails = false;
  state: AudioContextState = FakeContext.initial;
  currentTime = 0;
  destination = new FakeNode();
  onstatechange: (() => void) | null = null;
  oscillators = 0;
  closed = false;
  constructor() {
    FakeContext.made.push(this);
  }
  createOscillator() {
    this.oscillators++;
    return new FakeNode();
  }
  createGain() {
    return new FakeNode();
  }
  resume() {
    return FakeContext.resumeFails ? Promise.reject(new Error('not allowed')) : Promise.resolve();
  }
  close() {
    this.closed = true;
    return Promise.resolve();
  }
  /** what the browser does once a click lets the sound go */
  run() {
    this.state = 'running';
    this.onstatechange?.();
  }
}

const install = (initial: AudioContextState) => {
  FakeContext.made = [];
  FakeContext.initial = initial;
  FakeContext.resumeFails = false;
  vi.stubGlobal('AudioContext', FakeContext);
};
afterEach(() => vi.unstubAllGlobals());

describe('music player', () => {
  it('plays at once when the browser allows it, one oscillator per voice', () => {
    install('running');
    const changes = vi.fn();
    const p = new MusicPlayer(changes);
    p.start();
    expect(p.playing).toBe(true);
    expect(FakeContext.made[0].oscillators).toBe(3);
    p.stop();
    expect(p.playing).toBe(false);
    expect(FakeContext.made[0].closed).toBe(true);
    expect(changes).toHaveBeenCalled();
  });

  it('waits while the browser holds the sound back, then plays once it runs', () => {
    install('suspended');
    const p = new MusicPlayer();
    p.start();
    const ctx = FakeContext.made[0];
    expect(p.playing).toBe(false);
    expect(ctx.oscillators).toBe(0);
    p.start(); // a later click retries the same context rather than making another
    expect(FakeContext.made).toHaveLength(1);
    ctx.run();
    expect(p.playing).toBe(true);
    expect(ctx.oscillators).toBe(3);
    p.stop();
  });

  it('queues nothing if stopped before the sound was let through', () => {
    install('suspended');
    const p = new MusicPlayer();
    p.start();
    const ctx = FakeContext.made[0];
    p.stop();
    ctx.run();
    expect(ctx.oscillators).toBe(0);
    expect(p.playing).toBe(false);
  });

  it('stays quiet without throwing when Web Audio is missing or refuses', async () => {
    vi.stubGlobal('AudioContext', class {
      constructor() {
        throw new Error('too many contexts');
      }
    });
    const p = new MusicPlayer();
    expect(() => p.start()).not.toThrow();
    expect(p.playing).toBe(false);
    expect(() => p.stop()).not.toThrow();

    install('suspended');
    FakeContext.resumeFails = true;
    const q = new MusicPlayer();
    expect(() => q.start()).not.toThrow();
    await Promise.resolve();
    expect(q.playing).toBe(false);
    q.stop();
  });
});
