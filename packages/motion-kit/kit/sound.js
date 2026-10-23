// Cuttle's sound kit for music pages: import { song, kick, pad, fx, chord } from 'cuttle/sound'.
//
// Everything is made of WebAudio nodes in the page's OfflineAudioContext. Each note makes its nodes
// a moment before it plays (`audio.at`), so a long, dense track renders fast. Times are output
// seconds of the video; notes are MIDI numbers or names ('D3', 'F#4').
//
//   song(audio, { bpm, key, mode })   the grid, the buses (drums, bass, keys, pads, lead), reverb, delay
//   kick snare clap hat shaker tom rim crash ride   drums: .hit(t, velocity)
//   bass pad pluck keys bell strings lead sub        tonal: .play(t, note | notes, seconds, { velocity })
//   fx.riser fx.impact fx.whoosh …                   effects at a moment (a riser ends on it)
//   chord scale progression voiceLead arp euclid steps   harmony and rhythm
//   sections fitTempo                                parts of the video with an energy, a tempo whose beats meet its cuts

// ---- nodes ------------------------------------------------------------------------------------------

/** Counts a node the kit made (the runtime reports how many). */
function made(ctx, node) {
  ctx.__cuttleNodes = (ctx.__cuttleNodes ?? 0) + 1;
  return node;
}
const osc = (ctx, type, frequency) => {
  const node = made(ctx, ctx.createOscillator());
  node.type = type;
  node.frequency.value = frequency;
  return node;
};
const amp = (ctx, value = 1) => {
  const node = made(ctx, ctx.createGain());
  node.gain.value = value;
  return node;
};
const filter = (ctx, type, frequency, q = 0.707) => {
  const node = made(ctx, ctx.createBiquadFilter());
  node.type = type;
  node.frequency.value = frequency;
  node.Q.value = q;
  return node;
};
const panner = (ctx, pan) => {
  const node = made(ctx, ctx.createStereoPanner());
  node.pan.value = Math.max(-1, Math.min(1, pan));
  return node;
};

/** A seeded random for the kit's own noise (the same on every render). */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const noises = new WeakMap();
/** Two seconds of white noise per context, shared by every noisy sound (each starts at its own offset). */
function noiseBuffer(ctx) {
  let buffer = noises.get(ctx);
  if (!buffer) {
    buffer = ctx.createBuffer(2, ctx.sampleRate * 2, ctx.sampleRate);
    const random = seeded(0x51ed);
    for (let c = 0; c < 2; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < data.length; i++) data[i] = random() * 2 - 1;
    }
    noises.set(ctx, buffer);
  }
  return buffer;
}
let noiseOffset = 0;
/** A looping noise source starting at `t` (stopped at `stop`). */
function noise(ctx, t, stop) {
  const node = made(ctx, ctx.createBufferSource());
  node.buffer = noiseBuffer(ctx);
  node.loop = true;
  noiseOffset = (noiseOffset + 0.37) % 1.9;
  node.start(t, noiseOffset);
  node.stop(stop);
  return node;
}

const curves = new Map();
/**
 * A soft saturation curve (tanh), `drive` 0 (clean) to 1 (hot): quiet signals come out `1 + drive`
 * times louder, loud ones are rounded off (harmonics, not volume).
 */
function saturator(ctx, drive) {
  const key = Math.round(drive * 100);
  let curve = curves.get(key);
  if (!curve) {
    const d = key / 100;
    const k = 1 + 4 * d;
    curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = ((1 + d) * Math.tanh(k * x)) / k;
    }
    curves.set(key, curve);
  }
  const node = made(ctx, ctx.createWaveShaper());
  node.curve = curve;
  node.oversample = '2x';
  return node;
}

/** An envelope on `param`: up to `peak` in `attack`, down to `sustain × peak` in `decay`, held to `end`, released over `release`. */
function envelope(param, t, { attack = 0.005, decay = 0.1, sustain = 0, release = 0.08, peak = 1, end }) {
  param.cancelScheduledValues(t);
  param.setValueAtTime(0.0001, t);
  param.linearRampToValueAtTime(peak, t + attack);
  const level = Math.max(0.0001, peak * sustain);
  if (sustain > 0) param.setTargetAtTime(level, t + attack, decay / 3);
  else param.setTargetAtTime(0.0001, t + attack, decay / 4);
  if (end !== undefined && sustain > 0) {
    param.setValueAtTime(level, Math.max(t + attack + decay, end));
    param.setTargetAtTime(0.0001, Math.max(t + attack + decay, end), release / 4);
  }
}

// ---- notes and harmony ------------------------------------------------------------------------------

const PITCH = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** A note as a MIDI number: 62, 'D4' (62), 'F#3', 'Bb2'; a note name without an octave is in octave 4. */
export function midi(note) {
  if (typeof note === 'number') return note;
  const match = /^([A-Ga-g])([#b]*)(-?\d+)?$/.exec(String(note).trim());
  if (!match) throw new Error(`not a note: ${note}`);
  const pitch = PITCH[match[1].toUpperCase()] + [...match[2]].reduce((sum, sign) => sum + (sign === '#' ? 1 : -1), 0);
  const octave = match[3] === undefined ? 4 : Number(match[3]);
  return 12 * (octave + 1) + pitch;
}
/** A note's frequency in Hz. */
export const hz = (note) => 440 * Math.pow(2, (midi(note) - 69) / 12);

/** The scales a key can be in (semitones from the root). */
export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  pentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
};

/** A key's scale: `degree(n, octave)` is its n-th note (0 the root; negative and past 7 wrap octaves), `notes(octave)` all of them. */
export function scale(key = 'C', mode = 'minor') {
  const root = midi(`${String(key).replace(/-?\d+$/, '')}0`) % 12;
  const steps = SCALES[mode] ?? SCALES.minor;
  const degree = (n, octave = 4) => {
    const size = steps.length;
    const wrapped = ((n % size) + size) % size;
    return 12 * (octave + 1 + Math.floor(n / size)) + root + steps[wrapped];
  };
  return { root, mode, steps, degree, notes: (octave = 4) => steps.map((_, i) => degree(i, octave)) };
}

const QUALITIES = {
  '': [0, 4, 7],
  maj: [0, 4, 7],
  m: [0, 3, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  5: [0, 7],
  6: [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  m7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  9: [0, 4, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
  m9: [0, 3, 7, 10, 14],
  11: [0, 4, 7, 10, 14, 17],
  m11: [0, 3, 7, 10, 14, 17],
  '7sus4': [0, 5, 7, 10],
};
/** A chord's notes: 'Dm7', 'Bbmaj7', 'F/A' (A in the bass), 'Csus4', in `octave` (its root's). */
export function chord(symbol, octave = 4) {
  const match = /^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/.exec(String(symbol).trim());
  if (!match) throw new Error(`not a chord: ${symbol}`);
  const quality = QUALITIES[match[2]];
  if (!quality) throw new Error(`not a chord quality: ${match[2]} (in ${symbol})`);
  const root = midi(`${match[1]}${octave}`);
  const notes = quality.map((step) => root + step);
  if (match[3]) {
    let bass = midi(`${match[3]}${octave}`);
    while (bass >= root) bass -= 12;
    notes.unshift(bass);
  }
  return notes;
}

const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
/**
 * Chords from roman numerals in a key: 'i VI III VII', 'I V vi IV', 'ii7 V7 Imaj7'. Upper case is major,
 * lower minor, ° diminished; a suffix (7, maj7, sus4, add9…) is the chord's quality on top.
 */
export function progression(key, mode, numerals, octave = 3) {
  const sc = scale(key, mode);
  return String(numerals)
    .trim()
    .split(/[\s,|-]+/)
    .map((numeral) => {
      const match = /^(b|#)?([ivIV]+)(°|o)?(.*)$/.exec(numeral);
      if (!match) throw new Error(`not a numeral: ${numeral}`);
      const index = NUMERALS.indexOf(match[2].toUpperCase());
      if (index < 0) throw new Error(`not a numeral: ${numeral}`);
      const shift = match[1] === 'b' ? -1 : match[1] === '#' ? 1 : 0;
      const root = sc.degree(index, octave) + shift;
      const minor = match[2] === match[2].toLowerCase();
      const diminished = match[3] !== undefined;
      let suffix = match[4];
      let quality = diminished ? 'dim' : minor ? 'm' : '';
      if (suffix === '7' && minor) quality = diminished ? 'm7b5' : 'm7';
      else if (suffix === '7' && diminished) quality = 'm7b5';
      else if (suffix) quality = minor && !/^m/.test(suffix) && !['sus2', 'sus4', '5', '7sus4'].includes(suffix) ? `m${suffix}` : suffix;
      const steps = QUALITIES[quality] ?? QUALITIES[minor ? 'm' : ''];
      return steps.map((step) => root + step);
    });
}

/** Each chord turned (inverted, moved an octave) to lie close to the one before, inside [low, high]. */
export function voiceLead(chords, { low = 'A2', high = 'E5' } = {}) {
  const lo = midi(low);
  const hi = midi(high);
  let previous;
  return chords.map((notes) => {
    const options = [];
    for (let shift = -24; shift <= 24; shift += 12) {
      for (let inversion = 0; inversion < notes.length; inversion++) {
        const voiced = notes.map((n, i) => n + shift + (i < inversion ? 12 : 0)).sort((a, b) => a - b);
        if (voiced[0] >= lo && voiced.at(-1) <= hi) options.push(voiced);
      }
    }
    if (options.length === 0) return notes;
    const centre = previous ? previous.reduce((a, b) => a + b, 0) / previous.length : (lo + hi) / 2;
    const best = options.reduce((a, b) => {
      const da = Math.abs(a.reduce((x, y) => x + y, 0) / a.length - centre);
      const db = Math.abs(b.reduce((x, y) => x + y, 0) / b.length - centre);
      return db < da ? b : a;
    });
    previous = best;
    return best;
  });
}

/** A rhythm from text: 'x..x..x.' (x a hit, X an accent, . a rest), as velocities (0 for a rest). */
export const steps = (text) => [...String(text).replace(/\s/g, '')].map((c) => (c === 'X' ? 1 : c === 'x' ? 0.75 : c === 'o' ? 0.45 : 0));

/** `hits` spread as evenly as can be over `count` steps (Bjorklund), turned by `rotate`, as velocities. */
export function euclid(hits, count, rotate = 0) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(Math.floor(((i + rotate) * hits) / count) !== Math.floor(((i + rotate - 1) * hits) / count) ? 0.8 : 0);
  return out;
}

/** The notes of `notes` in turn, `pattern` 'up' | 'down' | 'updown' | 'random', over `octaves`. */
export function arp(notes, { pattern = 'up', octaves = 1, random = Math.random } = {}) {
  const base = [...notes].sort((a, b) => a - b);
  const all = [];
  for (let o = 0; o < octaves; o++) for (const n of base) all.push(n + 12 * o);
  if (pattern === 'down') return all.reverse();
  if (pattern === 'updown') return [...all, ...all.slice(1, -1).reverse()];
  if (pattern === 'random') return all.map(() => all[Math.floor(random() * all.length)]);
  return all;
}

// ---- the video --------------------------------------------------------------------------------------

/**
 * The video's parts, one per scene (a clip's pieces joined), each with an energy from 0 (quiet) to 3
 * (full), from what it shows:
 * - a motion scene, a still or a card at the start: an intro (1); at the end: the outro (1);
 * - a clip: 2; a sped-up clip (Claude at work): 3; the clip with Claude's answer: 3;
 * - in a video without clips (a reel of motion scenes) the scenes are the content (2), only a card
 *   at the end is the outro;
 * - the last part before the outro is the climax (3), so the music builds to it;
 * `energy`: what to set by a scene's id or label ({ s3: 0, Answer: 3 }), over all of these.
 */
export function sections(video, { energy = {} } = {}) {
  const parts = [];
  const scenes = video.scenes;
  const hasClips = scenes.some((scene) => scene.type === 'clip');
  scenes.forEach((scene, i) => {
    const previous = parts.at(-1);
    // pieces of one clip (a jump cut between) stay one part
    if (previous && previous.scene.type === 'clip' && scene.type === 'clip' && previous.scene.speed === scene.speed && video.cuts.some((cut) => cut.jump && Math.abs(cut.t - scene.start) < 1e-3)) {
      previous.end = scene.end;
      return;
    }
    let level = 2;
    let name = 'main';
    if (scene.type !== 'clip' && !hasClips) {
      if (i === scenes.length - 1 && i > 0 && scene.type === 'card') [level, name] = [1, 'outro'];
    } else if (scene.type !== 'clip') {
      if (i === 0) [level, name] = [1, 'intro'];
      else if (i === scenes.length - 1) [level, name] = [1, 'outro'];
      else [level, name] = [2, 'interlude'];
    } else if ((scene.speed ?? 1) > 1.5) [level, name] = [3, 'drive'];
    else if (video.markers.some((m) => m.kind === 'answer' && m.t >= scene.start && m.t < scene.end)) [level, name] = [3, 'payoff'];
    parts.push({ start: scene.start, end: scene.end, energy: level, name, scene, set: false });
    for (const key of [scene.id, scene.label, String(i)]) {
      if (key !== undefined && energy[key] !== undefined) Object.assign(parts.at(-1), { energy: Number(energy[key]), set: true });
    }
  });
  if (parts.length === 0) parts.push({ start: 0, end: video.duration, energy: 2, name: 'main', scene: null, set: false });
  // the music builds to the last part before the outro
  const last = parts.findLast((part) => part.name !== 'outro');
  if (parts.length >= 3 && last && !last.set && last.energy === 2) Object.assign(last, { energy: 3, name: 'climax' });
  return parts.map(({ set: _set, ...part }) => part);
}

/**
 * A tempo in [min, max] BPM and a start (`offset`, seconds) whose beats come closest to `times` (the
 * video's cuts, by default the scene changes): a cut on a beat feels made for the music. `snap`: beats
 * (1) or bars (4) to aim for.
 */
export function fitTempo(timesOrVideo, { min = 100, max = 128, snap = 1, step = 0.25 } = {}) {
  const times = Array.isArray(timesOrVideo) ? timesOrVideo : timesOrVideo.cuts.filter((cut) => !cut.jump).map((cut) => cut.t);
  if (times.length === 0) return { bpm: Math.round((min + max) / 2), offset: 0, error: 0 };
  let best = { bpm: min, offset: 0, error: Infinity };
  for (let bpm = min; bpm <= max + 1e-9; bpm += step) {
    const period = (60 / bpm) * snap;
    // the offset that best fits the first cut, tried for each cut in turn
    for (const anchor of times) {
      const offset = ((anchor % period) + period) % period;
      let error = 0;
      for (const t of times) {
        const phase = (((t - offset) % period) + period) % period;
        const miss = Math.min(phase, period - phase);
        error += miss * miss;
      }
      if (error < best.error - 1e-12) best = { bpm: Math.round(bpm * 100) / 100, offset, error };
    }
  }
  return { bpm: best.bpm, offset: best.offset, error: Math.sqrt(best.error / times.length) };
}

// ---- the song: the grid and the buses ---------------------------------------------------------------

/** A reverb's impulse: decorrelated noise in each ear, decaying over `seconds`, darker as it goes. */
function impulse(ctx, seconds, { brightness = 0.5, seed = 7 } = {}) {
  const length = Math.round(seconds * ctx.sampleRate);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const random = seeded(seed + c * 101);
    const data = buffer.getChannelData(c);
    let low = 0;
    for (let i = 0; i < length; i++) {
      const x = i / length;
      // a one-pole low-pass that closes as the tail goes on
      const k = 0.15 + brightness * 0.8 * (1 - x);
      low += k * (random() * 2 - 1 - low);
      data[i] = low * Math.pow(1 - x, 2.4) * (i < ctx.sampleRate * 0.004 ? i / (ctx.sampleRate * 0.004) : 1);
    }
  }
  return buffer;
}

/**
 * A song on the video: a tempo grid from `offset` (seconds), a key, and buses into the music stem
 * (`audio.music`) through a glue compressor: `drums`, `bass`, `keys`, `pads`, `lead`, each with
 * sends to a shared reverb and delay. `song.duck(bus, times)` pumps a bus on the kicks.
 */
export function song(audio, { bpm = 120, offset = 0, key = 'C', mode = 'minor', swing = 0, reverb = 2.4, brightness = 0.5, delay = 0.75 } = {}) {
  const ctx = audio.context;
  const beat = 60 / bpm;
  const glue = made(ctx, ctx.createDynamicsCompressor());
  glue.threshold.value = -12;
  glue.knee.value = 10;
  glue.ratio.value = 1.8;
  glue.attack.value = 0.012;
  glue.release.value = 0.18;
  // a limiter after the glue: the music's peaks stay near -3 dBFS
  const limit = made(ctx, ctx.createDynamicsCompressor());
  limit.threshold.value = -4;
  limit.knee.value = 0;
  limit.ratio.value = 20;
  limit.attack.value = 0.001;
  limit.release.value = 0.08;
  // the compressors make up the gain they take; the level is set after them (about -14 LUFS when full)
  const master = amp(ctx, 0.8);
  master.connect(glue).connect(limit).connect(amp(ctx, 0.6)).connect(audio.music);

  const verb = made(ctx, ctx.createConvolver());
  verb.buffer = impulse(ctx, reverb, { brightness });
  const verbIn = amp(ctx, 1);
  const verbHigh = filter(ctx, 'highpass', 220);
  verbIn.connect(verbHigh).connect(verb).connect(amp(ctx, 0.5)).connect(master);

  // a ping-pong delay of `delay` beats, filtered so its repeats sit back
  const delayIn = amp(ctx, 1);
  const left = made(ctx, ctx.createDelay(4));
  const right = made(ctx, ctx.createDelay(4));
  left.delayTime.value = right.delayTime.value = beat * delay;
  const feedback = amp(ctx, 0.38);
  const tone = filter(ctx, 'lowpass', 3200);
  const merge = made(ctx, ctx.createChannelMerger(2));
  delayIn.connect(tone).connect(left);
  left.connect(right);
  right.connect(feedback).connect(left);
  left.connect(merge, 0, 0);
  right.connect(merge, 0, 1);
  merge.connect(amp(ctx, 0.45)).connect(master);

  const s = {
    audio,
    context: ctx,
    bpm,
    beat,
    bar: beat * 4,
    offset,
    key,
    mode,
    swing,
    scale: scale(key, mode),
    master,
    reverb: verbIn,
    delay: delayIn,
    random: audio.random,
    at: audio.at,
    /** Seconds of bar `bar`, beat `b` (fractions for sixteenths: 0.25), with the swing on the off sixteenths. */
    time(bar, b = 0) {
      const whole = bar * 4 + b;
      const sixteenth = Math.round(whole * 4);
      const off = Math.abs(whole * 4 - sixteenth) < 1e-6 && sixteenth % 2 === 1 ? swing * beat * 0.25 : 0;
      return offset + whole * beat + off;
    },
    /** The bar playing at `t` (a fraction inside it). */
    barAt(t) {
      return (t - offset) / (beat * 4);
    },
    /** Each bar that starts in [from, to): its number and its time. */
    bars(from, to) {
      const out = [];
      for (let b = Math.ceil(this.barAt(from) - 1e-6); this.time(b) < to - 1e-6; b++) out.push({ bar: b, t: this.time(b) });
      return out;
    },
    /**
     * A bus into the master: its level, pan, sends (0–1), and filters. A `name` makes it a stem of
     * the music, its level set in the editor (`audio.level`): its sends go with it.
     */
    bus({ name, gain = 1, pan = 0, reverb: wet = 0.15, delay: echo = 0, lowpass, highpass } = {}) {
      const input = amp(ctx, 1);
      let last = input;
      if (highpass) last = last.connect(filter(ctx, 'highpass', highpass));
      if (lowpass) last = last.connect(filter(ctx, 'lowpass', lowpass));
      const level = amp(ctx, gain * (name && audio.level ? audio.level(name) : 1));
      const duck = amp(ctx, 1);
      last.connect(duck).connect(level);
      const out = pan ? level.connect(panner(ctx, pan)) : level;
      out.connect(master);
      if (wet > 0) level.connect(amp(ctx, wet)).connect(verbIn);
      if (echo > 0) level.connect(amp(ctx, echo)).connect(delayIn);
      return { input, level, duck };
    },
    /** Pumps a bus: down by `depth` at each time, back over `release` seconds (sidechain to the kick). */
    duck(bus, times, { depth = 0.6, release = 0.18 } = {}) {
      for (const t of times) {
        bus.duck.gain.setValueAtTime(1 - depth, t);
        bus.duck.gain.setTargetAtTime(1, t + 0.01, release / 3);
      }
    },
  };
  s.drums = s.bus({ name: 'drums', gain: 0.9, reverb: 0.08 });
  s.bassBus = s.bus({ name: 'bass', gain: 0.8, reverb: 0 });
  s.keys = s.bus({ name: 'keys', gain: 0.7, reverb: 0.25, delay: 0.12 });
  s.pads = s.bus({ name: 'pads', gain: 0.55, reverb: 0.4, highpass: 140 });
  s.lead = s.bus({ name: 'lead', gain: 0.6, reverb: 0.25, delay: 0.2 });
  return s;
}

const destinationOf = (s, bus, fallback) => (bus ? bus.input ?? bus : (s[fallback]?.input ?? s.master));
/** How long before a note its nodes are made. */
const LEAD = 0.05;

// ---- drums ------------------------------------------------------------------------------------------

/** A kick: a sine that drops from `punch` × 160 Hz to `tone`, a click on top, a little drive. */
export function kick(s, { tone = 48, punch = 1, decay = 0.42, click = 0.5, drive = 0.25, gain = 1, bus } = {}) {
  const ctx = s.context;
  const out = destinationOf(s, bus, 'drums');
  return {
    hit(t, velocity = 1) {
      s.at(t - LEAD, () => {
        const body = osc(ctx, 'sine', tone);
        body.frequency.setValueAtTime(tone * 3.4 * punch, t);
        body.frequency.exponentialRampToValueAtTime(tone, t + 0.07);
        const env = amp(ctx, 0);
        env.gain.setValueAtTime(0.0001, t);
        env.gain.linearRampToValueAtTime(velocity * gain, t + 0.003);
        env.gain.setTargetAtTime(0.0001, t + 0.03, decay / 4);
        const shape = saturator(ctx, drive);
        body.connect(env).connect(shape).connect(out);
        body.start(t);
        body.stop(t + decay * 2);
        if (click > 0) {
          const n = noise(ctx, t, t + 0.03);
          const hp = filter(ctx, 'highpass', 2500);
          const ce = amp(ctx, 0);
          ce.gain.setValueAtTime(click * velocity * gain * 0.5, t);
          ce.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
          n.connect(hp).connect(ce).connect(out);
        }
      });
    },
  };
}

/** A snare: a short tone and bright noise. `snap`: how much noise. */
export function snare(s, { tone = 190, snap = 0.8, decay = 0.18, gain = 0.8, bus } = {}) {
  const ctx = s.context;
  const out = destinationOf(s, bus, 'drums');
  return {
    hit(t, velocity = 1) {
      s.at(t - LEAD, () => {
        const body = osc(ctx, 'triangle', tone * 1.3);
        body.frequency.setValueAtTime(tone * 1.3, t);
        body.frequency.exponentialRampToValueAtTime(tone, t + 0.03);
        const be = amp(ctx, 0);
        be.gain.setValueAtTime(0.0001, t);
        be.gain.linearRampToValueAtTime(velocity * gain * 0.7, t + 0.002);
        be.gain.setTargetAtTime(0.0001, t + 0.01, 0.03);
        body.connect(be).connect(out);
        body.start(t);
        body.stop(t + 0.3);
        const n = noise(ctx, t, t + decay * 2.5);
        const bp = filter(ctx, 'bandpass', 3200, 0.6);
        const hp = filter(ctx, 'highpass', 900);
        const ne = amp(ctx, 0);
        ne.gain.setValueAtTime(0.0001, t);
        ne.gain.linearRampToValueAtTime(velocity * gain * snap, t + 0.002);
        ne.gain.setTargetAtTime(0.0001, t + 0.01, decay / 4);
        n.connect(bp).connect(hp).connect(ne).connect(out);
        if (s.reverb) ne.connect(amp(ctx, 0.15)).connect(s.reverb);
      });
    },
  };
}

/** A clap: three quick bursts of noise and a tail. */
export function clap(s, { tone = 1200, decay = 0.22, gain = 0.8, spread = 0.011, bus } = {}) {
  const ctx = s.context;
  const out = destinationOf(s, bus, 'drums');
  return {
    hit(t, velocity = 1) {
      s.at(t - LEAD, () => {
        const n = noise(ctx, t, t + decay * 3);
        const bp = filter(ctx, 'bandpass', tone, 1.2);
        const hp = filter(ctx, 'highpass', 600);
        const env = amp(ctx, 0);
        const g = velocity * gain;
        env.gain.setValueAtTime(0.0001, t);
        for (let k = 0; k < 3; k++) {
          const at = t + k * spread;
          env.gain.setValueAtTime(g, at);
          env.gain.setTargetAtTime(0.0001, at + 0.001, 0.004);
        }
        env.gain.setValueAtTime(g * 0.8, t + 3 * spread);
        env.gain.setTargetAtTime(0.0001, t + 3 * spread + 0.002, decay / 4);
        n.connect(bp).connect(hp).connect(env).connect(out);
        if (s.reverb) env.connect(amp(ctx, 0.3)).connect(s.reverb);
      });
    },
  };
}

const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];
/** A hi-hat: six square waves at metallic ratios, band-passed high. `open`: a longer one. */
export function hat(s, { tone = 1, decay = 0.045, openDecay = 0.32, gain = 0.32, pan = 0.15, bus } = {}) {
  const ctx = s.context;
  const out = destinationOf(s, bus, 'drums');
  return {
    hit(t, velocity = 1, { open = false } = {}) {
      s.at(t - LEAD, () => {
        const length = open ? openDecay : decay;
        const n = noise(ctx, t, t + length * 2.5);
        const ring = filter(ctx, 'peaking', 9000 * tone, 4);
        ring.gain.value = 9;
        const hp = filter(ctx, 'highpass', 7200 * tone, 0.9);
        const env = amp(ctx, 0);
        env.gain.setValueAtTime(0.0001, t);
        env.gain.linearRampToValueAtTime(velocity * gain * 0.8, t + 0.001);
        env.gain.setTargetAtTime(0.0001, t + 0.002, length / 4);
        n.connect(hp).connect(ring).connect(env).connect(panner(ctx, pan)).connect(out);
      });
    },
  };
}

/** A shaker: soft noise, high, a slow front. */
export function shaker(s, { decay = 0.07, gain = 0.18, pan = -0.25, bus } = {}) {
  const ctx = s.context;
  const out = destinationOf(s, bus, 'drums');
  return {
    hit(t, velocity = 1) {
      s.at(t - LEAD, () => {
        const n = noise(ctx, t, t + decay * 4);
        const bp = filter(ctx, 'bandpass', 6500, 1.4);
        const env = amp(ctx, 0);
        env.gain.setValueAtTime(0.0001, t);
        env.gain.linearRampToValueAtTime(velocity * gain, t + decay * 0.35);
        env.gain.setTargetAtTime(0.0001, t + decay * 0.4, decay / 3);
        n.connect(bp).connect(env).connect(panner(ctx, pan)).connect(out);
      });
    },
  };
}

/** A tom: a sine that falls a little, `pitch` its note. */
export function tom(s, { pitch = 'A2', decay = 0.5, gain = 0.8, pan = 0, bus } = {}) {
  const ctx = s.context;
  const out = destinationOf(s, bus, 'drums');
  return {
    hit(t, velocity = 1, note = pitch) {
      s.at(t - LEAD, () => {
        const f = hz(note);
        const body = osc(ctx, 'sine', f);
        body.frequency.setValueAtTime(f * 1.6, t);
        body.frequency.exponentialRampToValueAtTime(f, t + 0.12);
        const env = amp(ctx, 0);
        env.gain.setValueAtTime(0.0001, t);
        env.gain.linearRampToValueAtTime(velocity * gain, t + 0.003);
        env.gain.setTargetAtTime(0.0001, t + 0.02, decay / 4);
        body.connect(env).connect(saturator(ctx, 0.3)).connect(panner(ctx, pan)).connect(out);
        if (s.reverb) env.connect(amp(ctx, 0.25)).connect(s.reverb);
        body.start(t);
        body.stop(t + decay * 2);
      });
    },
  };
}

/** A rim shot: a short knock. */
export function rim(s, { gain = 0.4, pan = 0.2, bus } = {}) {
  const ctx = s.context;
  const out = destinationOf(s, bus, 'drums');
  return {
    hit(t, velocity = 1) {
      s.at(t - LEAD, () => {
        const env = amp(ctx, 0);
        env.gain.setValueAtTime(velocity * gain, t);
        env.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
        for (const f of [1720, 460]) {
          const o = osc(ctx, 'triangle', f);
          o.connect(env);
          o.start(t);
          o.stop(t + 0.05);
        }
        env.connect(filter(ctx, 'bandpass', 1700, 2)).connect(panner(ctx, pan)).connect(out);
      });
    },
  };
}

/** A crash cymbal: bright noise and metal, a long tail. */
export function crash(s, { decay = 1.8, gain = 0.28, pan = -0.2, bus } = {}) {
  const ctx = s.context;
  const out = destinationOf(s, bus, 'drums');
  return {
    hit(t, velocity = 1) {
      s.at(t - LEAD, () => {
        const n = noise(ctx, t, t + decay * 2);
        const hp = filter(ctx, 'highpass', 5200);
        const peak = filter(ctx, 'peaking', 8500);
        peak.gain.value = 6;
        const env = amp(ctx, 0);
        env.gain.setValueAtTime(0.0001, t);
        env.gain.linearRampToValueAtTime(velocity * gain, t + 0.004);
        env.gain.setTargetAtTime(0.0001, t + 0.02, decay / 4);
        n.connect(hp).connect(peak).connect(env).connect(panner(ctx, pan)).connect(out);
        if (s.reverb) env.connect(amp(ctx, 0.3)).connect(s.reverb);
      });
    },
  };
}

/** A ride: metal with a bell, softer than a crash. */
export function ride(s, { decay = 0.6, gain = 0.16, pan = 0.3, bus } = {}) {
  const ctx = s.context;
  const out = destinationOf(s, bus, 'drums');
  return {
    hit(t, velocity = 1) {
      s.at(t - LEAD, () => {
        const sum = amp(ctx, 0.3);
        for (const f of METAL) {
          const o = osc(ctx, 'square', f * 1.9);
          o.connect(sum);
          o.start(t);
          o.stop(t + decay * 3);
        }
        const bp = filter(ctx, 'bandpass', 6500, 1.6);
        const env = amp(ctx, 0);
        env.gain.setValueAtTime(0.0001, t);
        env.gain.linearRampToValueAtTime(velocity * gain, t + 0.002);
        env.gain.setTargetAtTime(0.0001, t + 0.01, decay / 4);
        sum.connect(bp).connect(env).connect(panner(ctx, pan)).connect(out);
      });
    },
  };
}

// ---- tonal ------------------------------------------------------------------------------------------

const notesOf = (note) => (Array.isArray(note) ? note.map(midi) : [midi(note)]);

/** A bass: a saw (or `wave`) with a sine an octave down, through a low-pass that opens on each note, a little drive. */
export function bass(s, { wave = 'sawtooth', cutoff = 520, resonance = 3, envelope: amount = 3, decay = 0.22, sub = 0.5, drive = 0.3, gain = 0.38, release = 0.06, bus } = {}) {
  const ctx = s.context;
  const out = destinationOf(s, bus, 'bassBus');
  return {
    play(t, note, seconds = s.beat / 2, { velocity = 1 } = {}) {
      s.at(t - LEAD, () => {
        const f = hz(notesOf(note)[0]);
        const lp = filter(ctx, 'lowpass', cutoff, resonance);
        lp.frequency.setValueAtTime(cutoff * (1 + amount * velocity), t);
        lp.frequency.setTargetAtTime(cutoff, t + 0.005, decay / 3);
        const env = amp(ctx, 0);
        env.gain.setValueAtTime(0.0001, t);
        env.gain.linearRampToValueAtTime(velocity * gain, t + 0.004);
        env.gain.setValueAtTime(velocity * gain, t + Math.max(0.01, seconds - release));
        env.gain.setTargetAtTime(0.0001, t + Math.max(0.01, seconds - release), release / 3);
        const main = osc(ctx, wave, f);
        main.connect(lp);
        const low = osc(ctx, 'sine', f / 2);
        const lowGain = amp(ctx, sub);
        low.connect(lowGain).connect(env);
        lp.connect(saturator(ctx, drive)).connect(env).connect(out);
        for (const o of [main, low]) {
          o.start(t);
          o.stop(t + seconds + release * 3);
        }
      });
    },
  };
}

/** A sub: a plain sine, felt more than heard. */
export function sub(s, { gain = 0.5, attack = 0.01, release = 0.12, bus } = {}) {
  const ctx = s.context;
  const out = destinationOf(s, bus, 'bassBus');
  return {
    play(t, note, seconds = s.beat, { velocity = 1 } = {}) {
      s.at(t - LEAD, () => {
        const o = osc(ctx, 'sine', hz(notesOf(note)[0]));
        const env = amp(ctx, 0);
        envelope(env.gain, t, { attack, decay: 0.1, sustain: 1, release, peak: velocity * gain, end: t + seconds });
        o.connect(env).connect(out);
        o.start(t);
        o.stop(t + seconds + release * 4);
      });
    },
  };
}

/** A pad: `voices` detuned saws a note, spread across the stereo field, a slow filter. */
export function pad(s, { wave = 'sawtooth', voices = 3, detune = 14, cutoff = 1500, attack = 0.8, release = 1.4, width = 0.8, gain = 0.12, motion = 0.25, bus } = {}) {
  const ctx = s.context;
  const out = destinationOf(s, bus, 'pads');
  return {
    play(t, notes, seconds = s.bar, { velocity = 1, brightness = 1 } = {}) {
      s.at(t - LEAD, () => {
        const lp = filter(ctx, 'lowpass', cutoff * brightness, 0.9);
        // the filter breathes over the chord
        lp.frequency.setValueAtTime(cutoff * brightness * (1 - motion), t);
        lp.frequency.linearRampToValueAtTime(cutoff * brightness, t + Math.min(seconds, attack * 2));
        lp.frequency.linearRampToValueAtTime(cutoff * brightness * (1 - motion * 0.6), t + seconds + release);
        const env = amp(ctx, 0);
        const list = notesOf(notes);
        // as loud with any number of voices and notes
        const level = (velocity * gain * 2) / Math.sqrt(voices * list.length);
        envelope(env.gain, t, { attack, decay: 0.5, sustain: 1, release, peak: level, end: t + seconds });
        lp.connect(env).connect(out);
        list.forEach((n, k) => {
          for (let v = 0; v < voices; v++) {
            const spread = voices === 1 ? 0 : v / (voices - 1) - 0.5;
            const o = osc(ctx, wave, hz(n));
            o.detune.value = spread * 2 * detune + (s.random() - 0.5) * 3;
            const p = panner(ctx, spread * 2 * width * (k % 2 ? -1 : 1));
            o.connect(p).connect(lp);
            o.start(t);
            o.stop(t + seconds + release * 2);
          }
        });
      });
    },
  };
}

/** A pluck: a bright saw and square that close fast; good for arpeggios. */
export function pluck(s, { wave = 'sawtooth', cutoff = 900, decay = 0.18, gain = 0.16, pan = 0, resonance = 2, bus } = {}) {
  const ctx = s.context;
  const out = destinationOf(s, bus, 'keys');
  return {
    play(t, notes, seconds = s.beat / 4, { velocity = 1, pan: at = pan } = {}) {
      s.at(t - LEAD, () => {
        const lp = filter(ctx, 'lowpass', cutoff, resonance);
        lp.frequency.setValueAtTime(cutoff * 7 * velocity, t);
        lp.frequency.setTargetAtTime(cutoff, t + 0.002, decay / 3);
        const env = amp(ctx, 0);
        env.gain.setValueAtTime(0.0001, t);
        env.gain.linearRampToValueAtTime(velocity * gain, t + 0.002);
        env.gain.setTargetAtTime(0.0001, t + 0.004, Math.max(decay, seconds) / 3);
        lp.connect(env).connect(panner(ctx, at)).connect(out);
        for (const n of notesOf(notes)) {
          for (const [type, level, cents] of [
            [wave, 1, -4],
            ['square', 0.5, 4],
          ]) {
            const o = osc(ctx, type, hz(n));
            o.detune.value = cents;
            const g = amp(ctx, level);
            o.connect(g).connect(lp);
            o.start(t);
            o.stop(t + Math.max(decay, seconds) * 2 + 0.03);
          }
        }
      });
    },
  };
}

/** Keys: an electric piano by FM (a tine and a bark that fade), soft and warm. `type`: 'epiano' | 'bell' | 'glass'. */
export function keys(s, { type = 'epiano', decay = 2.2, gain = 0.2, release = 0.25, tremolo = 0.15, bus } = {}) {
  const ctx = s.context;
  const out = destinationOf(s, bus, 'keys');
  const [ratio, index, tine] = type === 'bell' ? [3.5, 6, 0] : type === 'glass' ? [2, 3, 0.6] : [1, 2.2, 0.35];
  return {
    play(t, notes, seconds = s.beat, { velocity = 1 } = {}) {
      s.at(t - LEAD, () => {
        const env = amp(ctx, 0);
        const length = Math.min(seconds, decay);
        env.gain.setValueAtTime(0.0001, t);
        env.gain.linearRampToValueAtTime(velocity * gain, t + 0.003);
        env.gain.setTargetAtTime(velocity * gain * 0.3, t + 0.01, decay / 3);
        env.gain.setValueAtTime(velocity * gain * 0.3 * Math.exp(-3 * (length / decay)) + 0.0001, t + length);
        env.gain.setTargetAtTime(0.0001, t + length, release / 3);
        let last = env;
        if (tremolo > 0) {
          const trem = amp(ctx, 1 - tremolo / 2);
          const lfo = osc(ctx, 'sine', 4.5);
          const depth = amp(ctx, tremolo / 2);
          lfo.connect(depth).connect(trem.gain);
          lfo.start(t);
          lfo.stop(t + length + release * 3);
          env.connect(trem);
          last = trem;
        }
        last.connect(out);
        for (const n of notesOf(notes)) {
          const f = hz(n);
          const carrier = osc(ctx, 'sine', f);
          const modulator = osc(ctx, 'sine', f * ratio);
          const depth = amp(ctx, 0);
          depth.gain.setValueAtTime(f * index * velocity, t);
          depth.gain.setTargetAtTime(f * index * 0.15, t + 0.005, (type === 'bell' ? 1.2 : 0.35) / 3);
          modulator.connect(depth).connect(carrier.frequency);
          const voice = amp(ctx, 1 / Math.sqrt(notesOf(notes).length));
          carrier.connect(voice).connect(env);
          const nodes = [carrier, modulator];
          if (tine > 0) {
            const bright = osc(ctx, 'sine', f * 14);
            const bd = amp(ctx, 0);
            bd.gain.setValueAtTime(f * tine * velocity, t);
            bd.gain.setTargetAtTime(0, t + 0.002, 0.02);
            bright.connect(bd).connect(carrier.frequency);
            nodes.push(bright);
          }
          for (const o of nodes) {
            o.start(t);
            o.stop(t + length + release * 4);
          }
        }
      });
    },
  };
}

/** A bell: keys with a bell's ratio, ringing long. */
export const bell = (s, options = {}) => keys(s, { type: 'bell', decay: 3.5, gain: 0.12, tremolo: 0, ...options });

/** Strings: an ensemble of saws, slow in, a gentle vibrato. */
export function strings(s, { cutoff = 2400, attack = 0.5, release = 1.2, gain = 0.1, vibrato = 6, bus } = {}) {
  const ctx = s.context;
  const out = destinationOf(s, bus, 'pads');
  return {
    play(t, notes, seconds = s.bar, { velocity = 1 } = {}) {
      s.at(t - LEAD, () => {
        const lp = filter(ctx, 'lowpass', cutoff, 0.5);
        const env = amp(ctx, 0);
        envelope(env.gain, t, { attack, decay: 0.3, sustain: 1, release, peak: velocity * gain, end: t + seconds });
        lp.connect(env).connect(out);
        const lfo = osc(ctx, 'sine', 5.2);
        const depth = amp(ctx, vibrato);
        lfo.connect(depth);
        lfo.start(t);
        lfo.stop(t + seconds + release * 2);
        for (const n of notesOf(notes)) {
          for (const cents of [-11, -4, 4, 11]) {
            const o = osc(ctx, 'sawtooth', hz(n));
            o.detune.value = cents;
            depth.connect(o.detune);
            o.connect(panner(ctx, cents / 14)).connect(lp);
            o.start(t);
            o.stop(t + seconds + release * 2);
          }
        }
      });
    },
  };
}

/** A lead: one voice (a saw or a square) with a glide from the note before and a vibrato that comes in late. */
export function lead(s, { wave = 'square', cutoff = 2600, gain = 0.12, glide = 0.04, vibrato = 12, bus } = {}) {
  const ctx = s.context;
  const out = destinationOf(s, bus, 'lead');
  let previous;
  return {
    play(t, note, seconds = s.beat, { velocity = 1 } = {}) {
      const f = hz(notesOf(note)[0]);
      const from = previous;
      previous = f;
      s.at(t - LEAD, () => {
        const o = osc(ctx, wave, f);
        if (from && glide > 0) {
          o.frequency.setValueAtTime(from, t);
          o.frequency.exponentialRampToValueAtTime(f, t + glide);
        }
        const lfo = osc(ctx, 'sine', 5.5);
        const depth = amp(ctx, 0);
        depth.gain.setValueAtTime(0, t);
        depth.gain.linearRampToValueAtTime(vibrato, t + Math.max(0.05, seconds * 0.6));
        lfo.connect(depth).connect(o.detune);
        const lp = filter(ctx, 'lowpass', cutoff, 1);
        const env = amp(ctx, 0);
        envelope(env.gain, t, { attack: 0.01, decay: 0.2, sustain: 0.8, release: 0.12, peak: velocity * gain, end: t + seconds });
        o.connect(lp).connect(env).connect(out);
        for (const node of [o, lfo]) {
          node.start(t);
          node.stop(t + seconds + 0.6);
        }
      });
    },
  };
}

// ---- effects ----------------------------------------------------------------------------------------

const effectsReverbs = new WeakMap();
/** The effects bus's own reverb (effects stay on their stem, loud and clear under speech). */
function effectsReverb(audio) {
  let input = effectsReverbs.get(audio.context);
  if (!input) {
    const ctx = audio.context;
    input = amp(ctx, 1);
    const verb = made(ctx, ctx.createConvolver());
    verb.buffer = impulse(ctx, 2.8, { brightness: 0.6, seed: 31 });
    input.connect(filter(ctx, 'highpass', 180)).connect(verb).connect(amp(ctx, 0.6)).connect(audio.effects);
    effectsReverbs.set(ctx, input);
  }
  return input;
}

/** Where an effect goes: `destination`, else the effects bus; `audioOf` takes a song or the composition's audio. */
const audioOf = (target) => target.audio ?? target;
function routeEffect(target, options) {
  const audio = audioOf(target);
  return { audio, ctx: audio.context, out: options.destination ?? audio.effects, verb: options.reverb === 0 ? null : effectsReverb(audio), volume: options.volume ?? 1 };
}
const at = (target, t, fn) => audioOf(target).at(t - 3, fn);

/** Rising noise and a rising tone that end on `t` (a cut), over `length` seconds. */
function riser(target, t, options = {}) {
  const { length = 2, tone = true, height = 1 } = options;
  at(target, t - length, () => {
    const { ctx, out, verb, volume } = routeEffect(target, options);
    const start = Math.max(0, t - length);
    const n = noise(ctx, start, t + 0.05);
    const bp = filter(ctx, 'bandpass', 300, 2.2);
    bp.frequency.setValueAtTime(250, start);
    bp.frequency.exponentialRampToValueAtTime(7000 * height, t);
    const env = amp(ctx, 0);
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(0.32 * volume, t - 0.01);
    env.gain.linearRampToValueAtTime(0.0001, t + 0.03);
    n.connect(bp).connect(env).connect(out);
    if (verb) env.connect(amp(ctx, 0.35)).connect(verb);
    if (tone) {
      const o = osc(ctx, 'sawtooth', 110);
      o.frequency.setValueAtTime(110, start);
      o.frequency.exponentialRampToValueAtTime(880 * height, t);
      const lp = filter(ctx, 'lowpass', 400, 4);
      lp.frequency.setValueAtTime(400, start);
      lp.frequency.exponentialRampToValueAtTime(5000, t);
      const g = amp(ctx, 0);
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.12 * volume, t - 0.01);
      g.gain.linearRampToValueAtTime(0.0001, t + 0.03);
      o.connect(lp).connect(g).connect(out);
      o.start(start);
      o.stop(t + 0.1);
    }
  });
}

/** A hit on `t`: a deep boom, a crack, and a long tail. */
function impact(target, t, options = {}) {
  const { size = 1 } = options;
  at(target, t, () => {
    const { ctx, out, verb, volume } = routeEffect(target, options);
    const boom = osc(ctx, 'sine', 40);
    boom.frequency.setValueAtTime(110, t);
    boom.frequency.exponentialRampToValueAtTime(36, t + 0.25);
    const be = amp(ctx, 0);
    be.gain.setValueAtTime(0.0001, t);
    be.gain.linearRampToValueAtTime(0.5 * volume, t + 0.004);
    be.gain.setTargetAtTime(0.0001, t + 0.05, (0.6 * size) / 3);
    boom.connect(be).connect(saturator(ctx, 0.5)).connect(out);
    boom.start(t);
    boom.stop(t + 2.5 * size);
    const n = noise(ctx, t, t + 0.6);
    const lp = filter(ctx, 'lowpass', 5000);
    const ne = amp(ctx, 0);
    ne.gain.setValueAtTime(0.28 * volume, t);
    ne.gain.setTargetAtTime(0.0001, t + 0.005, 0.05);
    n.connect(lp).connect(ne).connect(out);
    if (verb) {
      be.connect(amp(ctx, 0.3)).connect(verb);
      ne.connect(amp(ctx, 0.8 * size)).connect(verb);
    }
  });
}

/** Air rushing past, loudest on `t`, from left to right (`direction` -1 for right to left). */
function whoosh(target, t, options = {}) {
  const { length = 0.8, direction = 1, height = 1 } = options;
  at(target, t - length / 2, () => {
    const { ctx, out, verb, volume } = routeEffect(target, options);
    const start = Math.max(0, t - length / 2);
    const end = t + length / 2;
    const n = noise(ctx, start, end + 0.05);
    const bp = filter(ctx, 'bandpass', 500, 1.6);
    bp.frequency.setValueAtTime(400 * height, start);
    bp.frequency.exponentialRampToValueAtTime(3800 * height, t);
    bp.frequency.exponentialRampToValueAtTime(700 * height, end);
    const env = amp(ctx, 0);
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(0.4 * volume, t);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    const p = panner(ctx, -0.7 * direction);
    p.pan.setValueAtTime(-0.7 * direction, start);
    p.pan.linearRampToValueAtTime(0.7 * direction, end);
    n.connect(bp).connect(env).connect(p).connect(out);
    if (verb) env.connect(amp(ctx, 0.25)).connect(verb);
  });
}

/** A short whoosh in that lands on `t`. */
const swooshIn = (target, t, options = {}) => whoosh(target, t - 0.12, { length: 0.3, height: 1.3, ...options });

/** Falling noise and a falling tone from `t`, over `length`. */
function downlifter(target, t, options = {}) {
  const { length = 1.6 } = options;
  at(target, t, () => {
    const { ctx, out, verb, volume } = routeEffect(target, options);
    const n = noise(ctx, t, t + length + 0.1);
    const bp = filter(ctx, 'bandpass', 6000, 2);
    bp.frequency.setValueAtTime(6000, t);
    bp.frequency.exponentialRampToValueAtTime(200, t + length);
    const env = amp(ctx, 0);
    env.gain.setValueAtTime(0.45 * volume, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + length);
    n.connect(bp).connect(env).connect(out);
    if (verb) env.connect(amp(ctx, 0.3)).connect(verb);
  });
}

/** A sub that drops from `t`: a falling sine you feel. */
function subDrop(target, t, options = {}) {
  const { length = 1.6 } = options;
  at(target, t, () => {
    const { ctx, out, volume } = routeEffect(target, options);
    const o = osc(ctx, 'sine', 90);
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(28, t + length);
    const env = amp(ctx, 0);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(0.55 * volume, t + 0.01);
    env.gain.setTargetAtTime(0.0001, t + length * 0.5, length / 4);
    o.connect(env).connect(out);
    o.start(t);
    o.stop(t + length * 1.5);
  });
}

/** A cinematic braam on `t`: low brass of detuned saws through an opening filter, driven. */
function braam(target, t, options = {}) {
  const { note = 'D1', length = 2.4 } = options;
  at(target, t, () => {
    const { ctx, out, verb, volume } = routeEffect(target, options);
    const lp = filter(ctx, 'lowpass', 150, 3);
    lp.frequency.setValueAtTime(150, t);
    lp.frequency.exponentialRampToValueAtTime(1800, t + 0.25);
    lp.frequency.setTargetAtTime(300, t + 0.4, length / 3);
    const env = amp(ctx, 0);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(0.35 * volume, t + 0.06);
    env.gain.setTargetAtTime(0.0001, t + length * 0.5, length / 4);
    lp.connect(saturator(ctx, 0.7)).connect(env).connect(out);
    if (verb) env.connect(amp(ctx, 0.5)).connect(verb);
    for (const [n, cents] of [
      [note, -12],
      [note, 9],
      [midi(note) + 12, -6],
      [midi(note) + 19, 5],
    ]) {
      const o = osc(ctx, 'sawtooth', hz(n));
      o.detune.value = cents;
      o.connect(lp);
      o.start(t);
      o.stop(t + length * 2);
    }
  });
}

/** A noise swell that ends on `t` (a cymbal played backwards). */
function reverseCymbal(target, t, options = {}) {
  const { length = 1.5 } = options;
  at(target, t - length, () => {
    const { ctx, out, volume } = routeEffect(target, options);
    const start = Math.max(0, t - length);
    const n = noise(ctx, start, t + 0.02);
    const hp = filter(ctx, 'highpass', 4000);
    const env = amp(ctx, 0);
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(0.35 * volume, t - 0.005);
    env.gain.linearRampToValueAtTime(0.0001, t + 0.01);
    n.connect(hp).connect(env).connect(panner(ctx, 0.2)).connect(out);
  });
}

/** A bubble pop: a sine that leaps up and falls. */
function pop(target, t, options = {}) {
  const { pitch = 1 } = options;
  at(target, t, () => {
    const { ctx, out, verb, volume } = routeEffect(target, options);
    const o = osc(ctx, 'sine', 400 * pitch);
    o.frequency.setValueAtTime(260 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(980 * pitch, t + 0.025);
    o.frequency.exponentialRampToValueAtTime(520 * pitch, t + 0.09);
    const env = amp(ctx, 0);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(0.45 * volume, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    o.connect(env).connect(out);
    if (verb) env.connect(amp(ctx, 0.12)).connect(verb);
    o.start(t);
    o.stop(t + 0.15);
  });
}

/** A UI click: a tiny tick of noise and a high knock. */
function click(target, t, options = {}) {
  at(target, t, () => {
    const { ctx, out, volume } = routeEffect(target, options);
    const n = noise(ctx, t, t + 0.02);
    const bp = filter(ctx, 'bandpass', 4200, 1.5);
    const env = amp(ctx, 0);
    env.gain.setValueAtTime(0.6 * volume, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
    n.connect(bp).connect(env).connect(out);
    const o = osc(ctx, 'square', 1900);
    const oe = amp(ctx, 0);
    oe.gain.setValueAtTime(0.06 * volume, t);
    oe.gain.exponentialRampToValueAtTime(0.0001, t + 0.008);
    o.connect(oe).connect(out);
    o.start(t);
    o.stop(t + 0.02);
  });
}

/** A soft tick (a counter, a step). */
function tick(target, t, options = {}) {
  at(target, t, () => {
    const { ctx, out, volume } = routeEffect(target, options);
    const o = osc(ctx, 'sine', 2300);
    const env = amp(ctx, 0);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(0.25 * volume, t + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    o.connect(env).connect(out);
    o.start(t);
    o.stop(t + 0.05);
  });
}

/** A bell-like ding (a notification, a done). */
function ding(target, t, options = {}) {
  const { note = 'E6' } = options;
  at(target, t, () => {
    const { ctx, out, verb, volume } = routeEffect(target, options);
    const f = hz(note);
    const env = amp(ctx, 0);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(0.32 * volume, t + 0.003);
    env.gain.setTargetAtTime(0.0001, t + 0.01, 0.35);
    env.connect(out);
    if (verb) env.connect(amp(ctx, 0.4)).connect(verb);
    for (const [ratio, level] of [
      [1, 1],
      [2.76, 0.35],
      [5.4, 0.12],
    ]) {
      const o = osc(ctx, 'sine', f * ratio);
      const g = amp(ctx, level);
      o.connect(g).connect(env);
      o.start(t);
      o.stop(t + 2);
    }
  });
}

/** Three bell notes up a chord: something appears. */
function chime(target, t, options = {}) {
  const { notes = ['C6', 'E6', 'G6'], gap = 0.07 } = options;
  notes.forEach((n, i) => ding(target, t + i * gap, { ...options, note: n, volume: (options.volume ?? 1) * (0.8 - i * 0.1) }));
}

/** Two bright notes up a fifth: it worked. */
function success(target, t, options = {}) {
  chime(target, t, { notes: ['G5', 'D6'], gap: 0.09, ...options });
}

/** Two dull notes down a semitone: it did not. */
function error(target, t, options = {}) {
  ['A3', 'G#3'].forEach((n, i) =>
    at(target, t, () => {
      const { ctx, out, volume } = routeEffect(target, options);
      const start = t + i * 0.13;
      const o = osc(ctx, 'square', hz(n));
      const lp = filter(ctx, 'lowpass', 1400);
      const env = amp(ctx, 0);
      env.gain.setValueAtTime(0.0001, start);
      env.gain.linearRampToValueAtTime(0.14 * volume, start + 0.005);
      env.gain.setTargetAtTime(0.0001, start + 0.08, 0.04);
      o.connect(lp).connect(env).connect(out);
      o.start(start);
      o.stop(start + 0.4);
    }),
  );
}

/** A chord that swells up to `t` and stops (a breath before a reveal). */
function swell(target, t, options = {}) {
  const { length = 2, notes = ['D3', 'A3', 'D4', 'F4'] } = options;
  at(target, t - length, () => {
    const { ctx, out, verb, volume } = routeEffect(target, options);
    const start = Math.max(0, t - length);
    const lp = filter(ctx, 'lowpass', 300, 1);
    lp.frequency.setValueAtTime(300, start);
    lp.frequency.exponentialRampToValueAtTime(4000, t);
    const env = amp(ctx, 0);
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(0.18 * volume, t - 0.02);
    env.gain.linearRampToValueAtTime(0.0001, t + 0.04);
    lp.connect(env).connect(out);
    if (verb) env.connect(amp(ctx, 0.4)).connect(verb);
    for (const n of notes) {
      for (const cents of [-8, 8]) {
        const o = osc(ctx, 'sawtooth', hz(n));
        o.detune.value = cents;
        o.connect(lp);
        o.start(start);
        o.stop(t + 0.1);
      }
    }
  });
}

/** A burst of keys typed fast, from `t`. */
function typeBurst(target, t, options = {}) {
  const { count = 9, rate = 13 } = options;
  const random = seeded(Math.round(t * 1000));
  let when = t;
  for (let i = 0; i < count; i++) {
    const start = when;
    at(target, start, () => {
      const { ctx, out, volume } = routeEffect(target, { ...options, reverb: 0 });
      const n = noise(ctx, start, start + 0.04);
      const bp = filter(ctx, 'bandpass', 2400 + random() * 1600, 1.8);
      const env = amp(ctx, 0);
      env.gain.setValueAtTime(0.35 * volume * (0.7 + random() * 0.3), start);
      env.gain.exponentialRampToValueAtTime(0.0001, start + 0.025);
      n.connect(bp).connect(env).connect(panner(ctx, (random() - 0.5) * 0.4)).connect(out);
    });
    when += (1 / rate) * (0.7 + random() * 0.6);
  }
}

/** A digital stutter on `t`: short bursts of a square and noise. */
function glitch(target, t, options = {}) {
  const { length = 0.25 } = options;
  const random = seeded(Math.round(t * 997));
  at(target, t, () => {
    const { ctx, out, volume } = routeEffect(target, { ...options, reverb: 0 });
    const env = amp(ctx, 0);
    env.gain.setValueAtTime(0.0001, t);
    for (let x = t; x < t + length; x += 0.028) {
      env.gain.setValueAtTime(random() < 0.6 ? 0.22 * volume : 0.0001, x);
    }
    env.gain.setValueAtTime(0.0001, t + length);
    const o = osc(ctx, 'square', 180 + random() * 600);
    const n = noise(ctx, t, t + length + 0.02);
    const mix = amp(ctx, 0.5);
    o.connect(mix);
    n.connect(mix);
    mix.connect(filter(ctx, 'bandpass', 1800, 0.8)).connect(env).connect(out);
    o.start(t);
    o.stop(t + length + 0.02);
  });
}

/** The effects, each at a moment `t` of the video: `fx.riser(audio, t, { length })`. A song works in place of `audio`. */
export const fx = { riser, impact, whoosh, swooshIn, downlifter, subDrop, braam, reverseCymbal, pop, click, tick, ding, chime, success, error, swell, typeBurst, glitch };

/**
 * The built-in sounds a project's `sounds` (and `cuttle sound add`) can name, with what each is. A
 * sound that has a length starts before its moment so that it ends on it (a riser), or is centred on
 * it (a whoosh).
 */
export const SOUND_LIST = [
  ['whoosh', 'air rushing past, loudest on its moment, left to right'],
  ['swoosh-in', 'a short whoosh that lands on its moment'],
  ['riser', 'rising noise and tone for 2 s that end on its moment (a cut, a reveal)'],
  ['impact', 'a deep boom and a crack with a long tail'],
  ['downlifter', 'falling noise from its moment'],
  ['sub-drop', 'a falling sub you feel more than hear'],
  ['braam', 'a cinematic low brass hit'],
  ['reverse-cymbal', 'a cymbal swell that ends on its moment'],
  ['swell', 'a chord that swells up to its moment'],
  ['pop', 'a bubble pop (something appears)'],
  ['click', 'a UI click'],
  ['tick', 'a soft tick (a counter, a step)'],
  ['ding', 'a bell-like ding (a notification)'],
  ['chime', 'three bell notes up a chord'],
  ['success', 'two bright notes up: it worked'],
  ['error', 'two dull notes down: it did not'],
  ['type-burst', 'a burst of keys typed fast'],
  ['glitch', 'a digital stutter'],
];
const BY_NAME = {
  whoosh,
  'swoosh-in': swooshIn,
  riser,
  impact,
  downlifter,
  'sub-drop': subDrop,
  braam,
  'reverse-cymbal': reverseCymbal,
  swell,
  pop,
  click,
  tick,
  ding,
  chime,
  success,
  error,
  'type-burst': typeBurst,
  glitch,
};
/** The built-in sounds by name, as the runtime plays a project's `sounds`: (audio, t, { volume, destination }). */
export const SOUNDS = Object.fromEntries(Object.entries(BY_NAME).map(([name, play]) => [name, (audio, t, options) => play(audio, t, options)]));
