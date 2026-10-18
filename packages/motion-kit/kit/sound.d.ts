// Types of Cuttle's sound kit (sound.js), served with it at cuttle-motion://kit/sound.d.ts.

/** A note: a MIDI number (62) or a name ('D4', 'F#3', 'Bb2'; without an octave, octave 4). */
export type Note = number | string;

/** The video as its music sees it (`cuttle.video`), in output seconds. */
export interface Video {
  duration: number;
  fps: number;
  scenes: { index: number; id?: string; label?: string; type: 'clip' | 'still' | 'card' | 'motion'; start: number; end: number; speed?: number; from?: number; to?: number; src?: string }[];
  cuts: { t: number; scene: number; jump: boolean }[];
  clicks: number[];
  keys: number[];
  words: { t: number; end: number; text: string }[];
  speech: { start: number; end: number }[];
  markers: { t: number; kind: string; label?: string }[];
  zooms: { start: number; end: number; label?: string }[];
}

/** What a composition gets from `cuttle.music(compose)`. */
export interface Audio {
  context: OfflineAudioContext;
  /** The music's bus: lowered under speech by the export. */
  music: GainNode;
  /** The effects' bus: never lowered. */
  effects: GainNode;
  video: Video;
  params: Record<string, unknown>;
  duration: number;
  /** Runs `fn` shortly before the render reaches `t`: make a note's nodes there, not up front. */
  at(t: number, fn: () => void): void;
  random(): number;
}

export interface Bus {
  input: GainNode;
  level: GainNode;
  duck: GainNode;
}

export interface Song {
  audio: Audio;
  context: OfflineAudioContext;
  bpm: number;
  /** Seconds of a beat, and of a bar (four beats). */
  beat: number;
  bar: number;
  /** Where bar 0 starts (seconds). */
  offset: number;
  key: string;
  mode: keyof typeof SCALES;
  swing: number;
  scale: Scale;
  master: GainNode;
  reverb: GainNode;
  delay: GainNode;
  drums: Bus;
  bassBus: Bus;
  keys: Bus;
  pads: Bus;
  lead: Bus;
  random(): number;
  at(t: number, fn: () => void): void;
  /** Seconds of bar `bar`, beat `beat` (0.25 a sixteenth), with the swing. */
  time(bar: number, beat?: number): number;
  barAt(t: number): number;
  bars(from: number, to: number): { bar: number; t: number }[];
  bus(options?: { gain?: number; pan?: number; reverb?: number; delay?: number; lowpass?: number; highpass?: number }): Bus;
  duck(bus: Bus, times: number[], options?: { depth?: number; release?: number }): void;
}

export interface Scale {
  root: number;
  mode: string;
  steps: number[];
  degree(n: number, octave?: number): number;
  notes(octave?: number): number[];
}

export interface Drum {
  hit(t: number, velocity?: number, options?: { open?: boolean }): void;
}
export interface Tom {
  hit(t: number, velocity?: number, note?: Note): void;
}
export interface Instrument {
  play(t: number, note: Note | Note[], seconds?: number, options?: { velocity?: number; brightness?: number; pan?: number }): void;
}

type BusOption = { bus?: Bus | AudioNode };

export function song(audio: Audio, options?: { bpm?: number; offset?: number; key?: string; mode?: keyof typeof SCALES; swing?: number; reverb?: number; brightness?: number; delay?: number }): Song;

export function kick(s: Song, options?: { tone?: number; punch?: number; decay?: number; click?: number; drive?: number; gain?: number } & BusOption): Drum;
export function snare(s: Song, options?: { tone?: number; snap?: number; decay?: number; gain?: number } & BusOption): Drum;
export function clap(s: Song, options?: { tone?: number; decay?: number; gain?: number; spread?: number } & BusOption): Drum;
export function hat(s: Song, options?: { tone?: number; decay?: number; openDecay?: number; gain?: number; pan?: number } & BusOption): Drum;
export function shaker(s: Song, options?: { decay?: number; gain?: number; pan?: number } & BusOption): Drum;
export function tom(s: Song, options?: { pitch?: Note; decay?: number; gain?: number; pan?: number } & BusOption): Tom;
export function rim(s: Song, options?: { gain?: number; pan?: number } & BusOption): Drum;
export function crash(s: Song, options?: { decay?: number; gain?: number; pan?: number } & BusOption): Drum;
export function ride(s: Song, options?: { decay?: number; gain?: number; pan?: number } & BusOption): Drum;

export function bass(s: Song, options?: { wave?: OscillatorType; cutoff?: number; resonance?: number; envelope?: number; decay?: number; sub?: number; drive?: number; gain?: number; release?: number } & BusOption): Instrument;
export function sub(s: Song, options?: { gain?: number; attack?: number; release?: number } & BusOption): Instrument;
export function pad(s: Song, options?: { wave?: OscillatorType; voices?: number; detune?: number; cutoff?: number; attack?: number; release?: number; width?: number; gain?: number; motion?: number } & BusOption): Instrument;
export function pluck(s: Song, options?: { wave?: OscillatorType; cutoff?: number; decay?: number; gain?: number; pan?: number; resonance?: number } & BusOption): Instrument;
export function keys(s: Song, options?: { type?: 'epiano' | 'bell' | 'glass'; decay?: number; gain?: number; release?: number; tremolo?: number } & BusOption): Instrument;
export function bell(s: Song, options?: { decay?: number; gain?: number; release?: number } & BusOption): Instrument;
export function strings(s: Song, options?: { cutoff?: number; attack?: number; release?: number; gain?: number; vibrato?: number } & BusOption): Instrument;
export function lead(s: Song, options?: { wave?: OscillatorType; cutoff?: number; gain?: number; glide?: number; vibrato?: number } & BusOption): Instrument;

type Target = Audio | Song;
type EffectOptions = { volume?: number; destination?: AudioNode; reverb?: 0 };
export const fx: {
  riser(target: Target, t: number, options?: EffectOptions & { length?: number; tone?: boolean; height?: number }): void;
  impact(target: Target, t: number, options?: EffectOptions & { size?: number }): void;
  whoosh(target: Target, t: number, options?: EffectOptions & { length?: number; direction?: 1 | -1; height?: number }): void;
  swooshIn(target: Target, t: number, options?: EffectOptions): void;
  downlifter(target: Target, t: number, options?: EffectOptions & { length?: number }): void;
  subDrop(target: Target, t: number, options?: EffectOptions & { length?: number }): void;
  braam(target: Target, t: number, options?: EffectOptions & { note?: Note; length?: number }): void;
  reverseCymbal(target: Target, t: number, options?: EffectOptions & { length?: number }): void;
  pop(target: Target, t: number, options?: EffectOptions & { pitch?: number }): void;
  click(target: Target, t: number, options?: EffectOptions): void;
  tick(target: Target, t: number, options?: EffectOptions): void;
  ding(target: Target, t: number, options?: EffectOptions & { note?: Note }): void;
  chime(target: Target, t: number, options?: EffectOptions & { notes?: Note[]; gap?: number }): void;
  success(target: Target, t: number, options?: EffectOptions): void;
  error(target: Target, t: number, options?: EffectOptions): void;
  swell(target: Target, t: number, options?: EffectOptions & { length?: number; notes?: Note[] }): void;
  typeBurst(target: Target, t: number, options?: EffectOptions & { count?: number; rate?: number }): void;
  glitch(target: Target, t: number, options?: EffectOptions & { length?: number }): void;
};
/** The built-in sounds of a project's `sounds`: [name, what it is]. */
export const SOUND_LIST: [name: string, description: string][];
export const SOUNDS: Record<string, (audio: Audio, t: number, options: { volume: number; destination: AudioNode }) => void>;

export function midi(note: Note): number;
export function hz(note: Note): number;
export const SCALES: Record<'major' | 'minor' | 'dorian' | 'phrygian' | 'lydian' | 'mixolydian' | 'harmonicMinor' | 'pentatonic' | 'minorPentatonic' | 'blues', number[]>;
export function scale(key?: string, mode?: keyof typeof SCALES): Scale;
export function chord(symbol: string, octave?: number): number[];
export function progression(key: string, mode: keyof typeof SCALES, numerals: string, octave?: number): number[][];
export function voiceLead(chords: number[][], options?: { low?: Note; high?: Note }): number[][];
export function steps(pattern: string): number[];
export function euclid(hits: number, count: number, rotate?: number): number[];
export function arp(notes: number[], options?: { pattern?: 'up' | 'down' | 'updown' | 'random'; octaves?: number; random?: () => number }): number[];

export interface Section {
  start: number;
  end: number;
  /** 0 quiet … 3 full. */
  energy: number;
  name: 'intro' | 'outro' | 'interlude' | 'main' | 'drive' | 'payoff' | 'climax';
  scene: Video['scenes'][number] | null;
}
export function sections(video: Video, options?: { energy?: Record<string, number> }): Section[];
export function fitTempo(timesOrVideo: number[] | Video, options?: { min?: number; max?: number; snap?: number; step?: number }): { bpm: number; offset: number; error: number };
