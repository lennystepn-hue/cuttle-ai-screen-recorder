import { afterEach, describe, expect, it } from 'vitest';
import { musicRuntime, type CuttleMusicApi, type MusicInit, type MusicRenderResult, type VideoData } from '../src/music/runtime';

/** The kit as the test's server serves it. */
const KIT = new URL('../../motion-kit/kit/sound.js', import.meta.url).href;

const VIDEO: VideoData = {
  duration: 2,
  fps: 30,
  scenes: [{ index: 0, type: 'clip', start: 0, end: 2, speed: 1, from: 0, to: 2 }],
  cuts: [],
  clicks: [0.5],
  keys: [],
  words: [],
  speech: [],
  markers: [],
  zooms: [],
};
const INIT: MusicInit = { duration: 2, rate: 48_000, params: { level: 0.5 }, seed: 3, video: VIDEO, sounds: [], kit: KIT };

type Page = Window &
  typeof globalThis & {
    cuttle: CuttleMusicApi;
    __cuttleReady(): Promise<void>;
    __cuttleCompose(): Promise<MusicRenderResult>;
    __cuttleStem(which: 'music' | 'effects', from: number, to: number): string;
    __cuttleErrors: string[];
    seen: unknown[];
  };

const frames: HTMLIFrameElement[] = [];
afterEach(() => frames.splice(0).forEach((frame) => frame.remove()));

/** A page in an iframe, as the renderer makes one: the runtime from its source text first, then the page's script. */
function page(script: string, init: MusicInit = INIT): Page {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  frames.push(frame);
  const win = frame.contentWindow as Page;
  win.eval(`(${musicRuntime.toString()})(${JSON.stringify(init)});`);
  win.seen = [];
  win.eval(script);
  return win;
}

/** A stem read back as the renderer reads it: interleaved stereo float32. */
function stem(win: Page, which: 'music' | 'effects', from: number, to: number): Float32Array {
  const bytes = Uint8Array.from(atob(win.__cuttleStem(which, from, to)), (c) => c.charCodeAt(0));
  return new Float32Array(bytes.buffer);
}

const peak = (samples: Float32Array, from = 0, to = samples.length) => {
  let max = 0;
  for (let i = from; i < to; i++) max = Math.max(max, Math.abs(samples[i]!));
  return max;
};

describe('the music runtime', () => {
  it('renders the composition as long as the video into two stems, music and effects', async () => {
    const win = page(`cuttle.music((audio) => {
      seen.push(audio.duration, audio.params.level, audio.video.clicks);
      // a 220 Hz tone on the music bus, a burst on the effects bus at 1 s
      const tone = audio.context.createOscillator();
      tone.frequency.value = 220;
      const level = audio.context.createGain();
      level.gain.value = audio.params.level;
      tone.connect(level).connect(audio.music);
      tone.start(0);
      audio.at(1, () => {
        const burst = audio.context.createOscillator();
        burst.connect(audio.effects);
        burst.start(1);
        burst.stop(1.1);
      });
      return { bpm: 120, key: 'D minor', sections: [{ start: 0, end: 2, name: 'all' }] };
    });`);
    await win.__cuttleReady();
    const result = await win.__cuttleCompose();
    expect(win.seen).toEqual([2, 0.5, [0.5]]);
    expect(result.length).toBe(96_000);
    expect(result.info).toEqual({ bpm: 120, key: 'D minor', sections: [{ start: 0, end: 2, name: 'all' }] });
    expect(result.peaks.music).toBeCloseTo(0.5, 2);
    expect(result.peaks.effects).toBeGreaterThan(0.9);
    const music = stem(win, 'music', 0, 96_000);
    const effects = stem(win, 'effects', 0, 96_000);
    expect(music.length).toBe(192_000);
    expect(peak(music, 0, 4800)).toBeCloseTo(0.5, 2);
    // the effect only on its own stem, only from 1 s to 1.1 s
    expect(peak(effects, 0, 2 * 47_000)).toBe(0);
    expect(peak(effects, 2 * 48_200, 2 * 52_000)).toBeGreaterThan(0.9);
    expect(peak(effects, 2 * 53_000, 2 * 96_000)).toBe(0);
    // the last 30 ms fade to silence: no click where the video ends
    expect(Math.abs(music[music.length - 2]!)).toBeLessThan(0.01);
    expect(win.__cuttleErrors).toEqual([]);
  });

  it('makes what plays later a moment before the render reaches it, not up front', async () => {
    const init = { ...INIT, duration: 6, video: { ...VIDEO, duration: 6 } };
    const win = page(
      `cuttle.music((audio) => {
        for (const t of [0.5, 3, 5.5]) audio.at(t, () => seen.push([t, audio.context.currentTime]));
      });`,
      init,
    );
    await win.__cuttleReady();
    await win.__cuttleCompose();
    const made = win.seen as [number, number][];
    expect(made.map(([t]) => t)).toEqual([0.5, 3, 5.5]);
    for (const [t, when] of made) {
      expect(when).toBeLessThanOrEqual(t);
      expect(when).toBeGreaterThanOrEqual(t - 2.01);
    }
    // the first is made before the render starts, the last during it
    expect(made[0]![1]).toBe(0);
    expect(made[2]![1]).toBeGreaterThan(3);
  });

  it('plays the project\'s built-in sounds on the effects stem and names the ones it cannot', async () => {
    const win = page('', { ...INIT, sounds: [{ at: 0.5, sound: 'pop', volume: 1 }, { at: 1, sound: 'kazoo', volume: 1 }] });
    await win.__cuttleReady();
    const result = await win.__cuttleCompose();
    expect(result.skipped).toEqual(['kazoo: no such sound (cuttle sound list)']);
    const effects = stem(win, 'effects', 0, 96_000);
    expect(peak(effects, 0, 2 * 23_500)).toBe(0);
    expect(peak(effects, 2 * 24_000, 2 * 30_000)).toBeGreaterThan(0.05);
    expect(peak(stem(win, 'music', 0, 96_000))).toBe(0);
  });

  it('notes what the composition threw, and renders on', async () => {
    const win = page(`cuttle.music(() => { throw new Error('no chords'); }); cuttle.music(() => {});`);
    await win.__cuttleReady();
    const result = await win.__cuttleCompose();
    expect(result.length).toBe(96_000);
    expect(win.__cuttleErrors).toEqual(['Error: cuttle.music was called more than once; the first composition plays', 'Error: no chords']);
  });

  it('seeds Math.random: the same music on every render', () => {
    const a = page('seen.push(Math.random(), Math.random());');
    const b = page('seen.push(Math.random(), Math.random());');
    expect(a.seen).toEqual(b.seen);
    expect(a.seen[0]).not.toBe(a.seen[1]);
  });

  it('plays a song from the kit: drums, bass and a pad on the grid, effects on the cuts', async () => {
    const init = { ...INIT, duration: 4, video: { ...VIDEO, duration: 4, cuts: [{ t: 2, scene: 1, jump: false }] } };
    const win = page(
      `cuttle.ready(import(${JSON.stringify(KIT)}).then((kit) => {
        cuttle.music((audio) => {
          const s = kit.song(audio, { bpm: 120, key: 'D', mode: 'minor' });
          const k = kit.kick(s);
          const b = kit.bass(s);
          const p = kit.pad(s);
          for (let beat = 0; beat < 8; beat++) {
            k.hit(s.time(0, beat));
            b.play(s.time(0, beat), 'D2', s.beat / 2);
          }
          p.play(0, kit.chord('Dm', 3), 4);
          kit.fx.impact(audio, 2);
          kit.fx.riser(audio, 2, { length: 1 });
          return { bpm: s.bpm };
        });
      }));`,
      init,
    );
    await win.__cuttleReady();
    const result = await win.__cuttleCompose();
    expect(win.__cuttleErrors).toEqual([]);
    expect(result.nodes).toBeGreaterThan(30);
    expect(result.peaks.music).toBeGreaterThan(0.1);
    expect(result.peaks.music).toBeLessThan(1);
    const effects = stem(win, 'effects', 0, 192_000);
    // the riser grows into the cut, the impact hits on it
    expect(peak(effects, 2 * 48_000, 2 * 60_000)).toBeLessThan(peak(effects, 2 * 90_000, 2 * 96_000));
    expect(peak(effects, 2 * 96_000, 2 * 100_000)).toBeGreaterThan(0.1);
  });
});
