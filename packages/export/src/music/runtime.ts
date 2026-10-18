/// <reference lib="dom" />
// The page side of a video's sound: run in the page before its own scripts (the renderer injects
// this function's source with its argument), so it must not use anything from outside itself.
//
// A music page composes the video's music in WebAudio: `cuttle.music(compose)` hands `compose` an
// OfflineAudioContext as long as the video, the video's timeline (`cuttle.video`: its scenes, cuts,
// clicks, typing, words, markers, all in output seconds) and two buses, `music` and `effects`.
// After the composition the runtime adds the project's sounds (built-ins from the kit, files from the
// project) to `effects`, renders, and keeps the two stems for the renderer to read out.
//
// Rendering is fast only when nodes are made shortly before they play: every connected node is
// pulled through each 128-frame quantum, started or not. `audio.at(t, fn)` runs `fn` a moment before
// the render reaches `t` (the kit's instruments do so for every note); the runtime suspends the
// render every second to run what is due.

/** A scene of the video, in output seconds. */
export interface VideoScene {
  index: number;
  id?: string;
  label?: string;
  type: 'clip' | 'still' | 'card' | 'motion';
  start: number;
  end: number;
  /** A clip's speed, and the source seconds it shows. */
  speed?: number;
  from?: number;
  to?: number;
  /** A motion scene's page. */
  src?: string;
}

/** What the music can follow, in output seconds. */
export interface VideoData {
  /** Seconds the video lasts. */
  duration: number;
  fps: number;
  scenes: VideoScene[];
  /** Where one scene gives way to the next (`scene` is the incoming one's index); `jump`: a cut inside a clip. */
  cuts: { t: number; scene: number; jump: boolean }[];
  /** Clicks the video shows. */
  clicks: number[];
  /** Key presses the video shows (typing), at most one per 1/30 s. */
  keys: number[];
  /** The spoken words, and the stretches with speech (words closer than 0.6 s joined). */
  words: { t: number; end: number; text: string }[];
  speech: { start: number; end: number }[];
  /** Claude's prompt, tool calls and answer, where the video shows them. */
  markers: { t: number; kind: string; label?: string }[];
  /** Zooms as the video shows them. */
  zooms: { start: number; end: number; label?: string }[];
}

/** A sound of the project's `sounds`, at an output second: a built-in (`whoosh`) or a file of the project (its URL). */
export interface SoundCue {
  at: number;
  sound: string;
  url?: string;
  volume: number;
}

/** What the renderer tells the page. */
export interface MusicInit {
  /** The video's length: the render's length (seconds). */
  duration: number;
  rate: number;
  params: Record<string, unknown>;
  seed: number;
  video: VideoData;
  sounds: SoundCue[];
  /** The kit's sound module (built-in sounds), imported once the composition is done. */
  kit: string;
}

/** What `compose` gets. */
export interface MusicAudio {
  context: OfflineAudioContext;
  /** The music's bus (stereo): the export lowers it under speech and sets its level. */
  music: GainNode;
  /** The effects' bus (stereo): hits, whooshes, clicks; never lowered under speech. */
  effects: GainNode;
  video: VideoData;
  params: Record<string, unknown>;
  duration: number;
  /** Runs `fn` shortly before the render reaches `t` (seconds), to make the nodes of what plays then. */
  at(t: number, fn: () => void): void;
  /** A seeded random in [0, 1): the same music on every render. */
  random(): number;
}

/** What a page may tell about its music (shown by `cuttle music check`). */
export interface MusicInfo {
  bpm?: number;
  key?: string;
  /** Its parts, in output seconds. */
  sections?: { start: number; end: number; name: string; energy?: number }[];
  [key: string]: unknown;
}

/** The page's `window.cuttle`. */
export interface CuttleMusicApi {
  readonly video: VideoData;
  readonly params: Record<string, unknown>;
  readonly duration: number;
  /** Composes the music: called once, with the context and the buses. May return what it made (bpm, key, sections). */
  music(compose: (audio: MusicAudio) => void | MusicInfo | Promise<void | MusicInfo>): void;
  /** Holds the composition until `promise` settles (samples, impulse responses). */
  ready(promise: Promise<unknown>): void;
}

/** What a render reports. */
export interface MusicRenderResult {
  /** Frames rendered (rate × duration). */
  length: number;
  /** Each stem's highest sample (absolute), before any level is applied. */
  peaks: { music: number; effects: number };
  /** Nodes the composition made, and how long it took to build and to render (ms). */
  nodes: number;
  buildMs: number;
  renderMs: number;
  info: MusicInfo | null;
  /** Sounds of the project that could not play (an unknown name, a file that does not decode). */
  skipped: string[];
}

export function musicRuntime(init: MusicInit): void {
  const page = window as unknown as Record<string, unknown>;
  const errors: string[] = [];
  page.__cuttleErrors = errors;
  const note = (error: unknown) => errors.push(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  window.addEventListener('error', (event) => note(event.error ?? event.message));
  window.addEventListener('unhandledrejection', (event) => note(event.reason));

  // a seeded random (mulberry32), also for Math.random
  let seed = init.seed >>> 0;
  const random = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Math.random = random;

  let composer: ((audio: MusicAudio) => unknown) | undefined;
  const holds: Promise<unknown>[] = [];
  const api: CuttleMusicApi = {
    video: init.video,
    params: init.params,
    duration: init.duration,
    music: (compose) => {
      if (composer) note(new Error('cuttle.music was called more than once; the first composition plays'));
      else composer = compose as (audio: MusicAudio) => unknown;
    },
    ready: (promise) => void holds.push(Promise.resolve(promise).catch(note)),
  };
  page.cuttle = api;

  /** Seconds the render runs ahead of what is made: what starts within this of the render's time is made before it. */
  const AHEAD = 2;
  /** The render stops this often to make what is due. */
  const STEP = 1;
  let rendered: AudioBuffer | undefined;

  page.__cuttleReady = async () => {
    await Promise.all(holds);
  };

  page.__cuttleCompose = async (): Promise<MusicRenderResult> => {
    const started = performance.now();
    const length = Math.max(1, Math.round(init.duration * init.rate));
    const context = new OfflineAudioContext({ numberOfChannels: 4, length, sampleRate: init.rate });
    // two stereo stems in one render: music on channels 0 and 1, effects on 2 and 3
    const merger = context.createChannelMerger(4);
    merger.connect(context.destination);
    context.destination.channelCount = 4;
    context.destination.channelCountMode = 'explicit';
    context.destination.channelInterpretation = 'discrete';
    const stem = (first: number): GainNode => {
      const bus = context.createGain();
      bus.channelCount = 2;
      bus.channelCountMode = 'explicit';
      bus.channelInterpretation = 'speakers';
      const split = context.createChannelSplitter(2);
      bus.connect(split);
      split.connect(merger, 0, first);
      split.connect(merger, 1, first + 1);
      return bus;
    };
    const music = stem(0);
    const effects = stem(2);

    // what to make, by the time it plays
    const due: { t: number; order: number; fn: () => void }[] = [];
    let order = 0;
    let made = Infinity;
    const run = (until: number) => {
      due.sort((a, b) => a.t - b.t || a.order - b.order);
      while (due.length > 0 && due[0]!.t < until) {
        const item = due.shift()!;
        try {
          item.fn();
        } catch (error) {
          note(error);
        }
      }
    };
    const audio: MusicAudio = {
      context,
      music,
      effects,
      video: init.video,
      params: init.params,
      duration: init.duration,
      at: (t, fn) => {
        // during the render, what is due before the next stop is made at once
        if (t < made) {
          try {
            fn();
          } catch (error) {
            note(error);
          }
        } else due.push({ t, order: order++, fn });
      },
      random,
    };
    // a context's node count is not exposed: the kit counts what it makes on the context
    (context as unknown as { __cuttleNodes: number }).__cuttleNodes = 0;

    // the composition: everything it schedules goes into `due` (before the render, `made` is -Infinity)
    made = -Infinity;
    let info: MusicInfo | null = null;
    if (composer) {
      try {
        const result = await composer(audio);
        if (result && typeof result === 'object') info = result as MusicInfo;
      } catch (error) {
        note(error);
      }
    }
    // the project's sounds, on the effects bus
    const skipped: string[] = [];
    if (init.sounds.length > 0) {
      let kit: Record<string, unknown> = {};
      try {
        // a dynamic import a bundler leaves alone (this function runs as text in the page)
        const load = new Function('url', 'return import(url)') as (url: string) => Promise<Record<string, unknown>>;
        kit = await load(init.kit);
      } catch (error) {
        note(error);
      }
      const builtIns = (kit.SOUNDS ?? {}) as Record<string, (audio: MusicAudio, at: number, options: { volume: number; destination: AudioNode }) => void>;
      for (const cue of init.sounds) {
        if (cue.url) {
          try {
            const bytes = await (await fetch(cue.url)).arrayBuffer();
            const buffer = await context.decodeAudioData(bytes);
            audio.at(cue.at - 0.05, () => {
              const source = context.createBufferSource();
              source.buffer = buffer;
              const gain = context.createGain();
              gain.gain.value = cue.volume;
              source.connect(gain).connect(effects);
              source.start(Math.max(0, cue.at));
            });
          } catch {
            skipped.push(`${cue.sound}: the file does not decode as audio`);
          }
        } else if (typeof builtIns[cue.sound] === 'function') {
          const play = builtIns[cue.sound]!;
          audio.at(cue.at - 0.05, () => play(audio, cue.at, { volume: cue.volume, destination: effects }));
        } else skipped.push(`${cue.sound}: no such sound (cuttle sound list)`);
      }
    }
    const built = performance.now();
    // make the first window now, then stop every STEP to make the next
    made = AHEAD;
    run(made);
    for (let t = STEP; t < init.duration; t += STEP) {
      const when = t;
      context
        .suspend(when)
        .then(() => {
          made = when + AHEAD;
          run(made);
          return context.resume();
        })
        .catch(note);
    }
    rendered = await context.startRendering();
    const done = performance.now();
    // no click where the video ends
    const fade = Math.min(rendered.length, Math.round(0.03 * init.rate));
    const peaks = { music: 0, effects: 0 };
    for (let c = 0; c < 4; c++) {
      const data = rendered.getChannelData(c);
      for (let i = 0; i < fade; i++) data[rendered.length - 1 - i]! *= i / fade;
      let peak = 0;
      for (let i = 0; i < data.length; i++) {
        const v = Math.abs(data[i]!);
        if (v > peak) peak = v;
      }
      if (c < 2) peaks.music = Math.max(peaks.music, peak);
      else peaks.effects = Math.max(peaks.effects, peak);
    }
    return {
      length: rendered.length,
      peaks,
      nodes: (context as unknown as { __cuttleNodes: number }).__cuttleNodes,
      buildMs: Math.round(built - started),
      renderMs: Math.round(done - built),
      info,
      skipped,
    };
  };

  /** Frames `from` to `to` of a stem (`music` or `effects`) as interleaved stereo float32, in base64. */
  page.__cuttleStem = (which: 'music' | 'effects', from: number, to: number): string => {
    if (!rendered) throw new Error('nothing is rendered yet');
    const first = which === 'music' ? 0 : 2;
    const left = rendered.getChannelData(first);
    const right = rendered.getChannelData(first + 1);
    const end = Math.min(to, rendered.length);
    const n = Math.max(0, end - from);
    const out = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      out[i * 2] = left[from + i]!;
      out[i * 2 + 1] = right[from + i]!;
    }
    const bytes = new Uint8Array(out.buffer);
    let text = '';
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(text);
  };
}
