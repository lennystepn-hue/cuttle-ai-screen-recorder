// Captions from the take's transcript: its words in output seconds (only where a clip shows them at
// 1×), the person's fixes applied, grouped into cues of one or two lines that the video shows one at
// a time. Pure: the engine draws the cue of a frame, the export writes them as SRT and VTT.
import type { CaptionFix, CaptionStyle } from '@cuttle/project';
import type { SceneSpan } from './time';

/** A word in source seconds, as transcript.json has it. */
export interface SpokenWord {
  t: number;
  end: number;
  text: string;
}

/** A word as the captions show it, in output seconds. */
export interface CaptionWord {
  t: number;
  end: number;
  text: string;
}

/** What the video shows from `start` to `end` (output seconds): one or two lines of words. */
export interface CaptionCue {
  start: number;
  end: number;
  lines: CaptionWord[][];
}

/** The cue of a frame, and the word being spoken in it (its index, counted over the lines). */
export interface ActiveCaption {
  cue: CaptionCue;
  current?: number;
}

export const CAPTION_RULES = {
  /** A gap this long (output seconds) between words starts a new cue. */
  pause: 0.6,
  /** Most characters on a line of `subtitle` and `karaoke` (two lines a cue). */
  lineChars: 42,
  /** `bold` shows at most this many words, and characters, at a time. */
  boldWords: 3,
  boldChars: 18,
  /** A cue stays this long after its last word ends, unless the next one starts. */
  hold: 0.6,
  /** A cue shows at least this long, unless the next one starts. */
  minSeconds: 0.8,
};

/**
 * The words with the person's fixes: the words spoken in a fix's [at, end) read as its text, one
 * word from `at` to `end`; a fix with no text takes them out.
 */
export function applyCaptionFixes(words: readonly SpokenWord[], fixes: readonly CaptionFix[]): SpokenWord[] {
  if (fixes.length === 0) return words.map((word) => ({ ...word }));
  const fixed = words.filter((word) => !fixes.some((fix) => word.t >= fix.at && word.t < fix.end)).map((word) => ({ ...word }));
  for (const fix of fixes) if (fix.text.trim() !== '') fixed.push({ t: fix.at, end: fix.end, text: fix.text.trim() });
  return fixed.sort((a, b) => a.t - b.t);
}

/** A sentence ends after a word ending in one of these, or at a pause this long (seconds), or at this many words. */
const SENTENCE_END = /[.!?…。！？]["')\]]*$/;
const SENTENCE_PAUSE = 0.8;
const SENTENCE_WORDS = 24;

/**
 * The transcript's sentences (source seconds), each from its first word's start to its last word's
 * end: what a translation is written for, sentence by sentence on the original's timing.
 */
export function sentencesOf(words: readonly SpokenWord[]): { at: number; end: number; text: string }[] {
  const sentences: { at: number; end: number; text: string }[] = [];
  let current: SpokenWord[] = [];
  const close = () => {
    if (current.length === 0) return;
    sentences.push({ at: current[0]!.t, end: current.at(-1)!.end, text: current.map((word) => word.text).join(' ') });
    current = [];
  };
  for (const word of [...words].sort((a, b) => a.t - b.t)) {
    const last = current.at(-1);
    if (last && (word.t - last.end >= SENTENCE_PAUSE || current.length >= SENTENCE_WORDS)) close();
    current.push(word);
    if (SENTENCE_END.test(word.text)) close();
  }
  close();
  return sentences;
}

/**
 * A translation's words, each sentence's spread over the time its original took, by their length:
 * what the captions show in that language (the karaoke's word follows its share of the sentence).
 * Sentences left untranslated are left out.
 */
export function translatedWords(sentences: readonly { at: number; end: number; text: string }[]): SpokenWord[] {
  const words: SpokenWord[] = [];
  for (const sentence of sentences) {
    const parts = sentence.text.split(/\s+/).filter((part) => part !== '');
    if (parts.length === 0) continue;
    const total = parts.reduce((sum, part) => sum + [...part].length + 1, 0);
    const length = Math.max(0, sentence.end - sentence.at);
    let t = sentence.at;
    for (const part of parts) {
      const share = (([...part].length + 1) / total) * length;
      words.push({ t, end: t + share, text: part });
      t += share;
    }
  }
  return words;
}

/**
 * The words in output seconds: each word whose start a clip shows at 1× (a sped-up clip's speech is
 * not captioned), once per time it is shown, its end kept inside its clip's piece.
 */
export function captionWords(words: readonly SpokenWord[], spans: readonly SceneSpan[]): CaptionWord[] {
  const shown: CaptionWord[] = [];
  for (const span of spans) {
    const scene = span.scene;
    if (scene.type !== 'clip' || scene.speed !== 1) continue;
    for (const word of words) {
      if (word.t < scene.from || word.t >= scene.to) continue;
      const t = span.start + (word.t - scene.from);
      const end = span.start + (Math.min(word.end, scene.to) - scene.from);
      shown.push({ t: round(t), end: round(Math.max(t, Math.min(end, span.end))), text: word.text });
    }
  }
  return shown.sort((a, b) => a.t - b.t);
}

const round = (seconds: number) => Math.round(seconds * 1e6) / 1e6;
const chars = (words: readonly CaptionWord[]) => words.reduce((sum, word) => sum + word.text.length, 0) + Math.max(0, words.length - 1);
const endsSentence = (text: string) => /[.!?…]["'’”)\]]*$/.test(text);

/** Whether the words fit on two lines of at most `max` characters. */
function fitsTwoLines(words: readonly CaptionWord[], max: number): boolean {
  for (let k = 0; k <= words.length; k++) if (chars(words.slice(0, k)) <= max && chars(words.slice(k)) <= max) return true;
  return false;
}

/** Two lines of about the same length, each at most `max` characters where they can be. */
function balance(words: CaptionWord[], max: number): CaptionWord[][] {
  if (chars(words) <= max || words.length < 2) return [words];
  let best = 1;
  let bestLonger = Infinity;
  for (let k = 1; k < words.length; k++) {
    const first = chars(words.slice(0, k));
    const second = chars(words.slice(k));
    // splits that keep both lines short come first; among them, the most even
    const longer = Math.max(first, second) + (first > max || second > max ? 1000 : 0);
    if (longer < bestLonger) {
      bestLonger = longer;
      best = k;
    }
  }
  return [words.slice(0, best), words.slice(best)];
}

/**
 * The cues of `words` (output seconds, in order) for a style: a new cue at a pause, after a
 * sentence's end, or when the words would not fit (`subtitle` and `karaoke`: two lines; `bold`: a
 * few short words). A cue shows from its first word to `hold` after its last, or the next cue.
 */
export function captionCues(words: readonly CaptionWord[], style: CaptionStyle, rules = CAPTION_RULES): CaptionCue[] {
  const groups: CaptionWord[][] = [];
  let group: CaptionWord[] = [];
  const full = (next: CaptionWord) =>
    style === 'bold' ? group.length >= rules.boldWords || chars([...group, next]) > rules.boldChars : !fitsTwoLines([...group, next], rules.lineChars);
  for (const word of words) {
    const last = group.at(-1);
    if (last && (word.t - last.end >= rules.pause || endsSentence(last.text) || full(word))) {
      groups.push(group);
      group = [];
    }
    group.push(word);
  }
  if (group.length > 0) groups.push(group);
  return groups.map((cue, i) => {
    const start = cue[0]!.t;
    const next = groups[i + 1]?.[0]!.t ?? Infinity;
    const end = Math.min(next, Math.max(cue.at(-1)!.end + rules.hold, start + rules.minSeconds));
    return { start, end: round(end), lines: style === 'bold' ? [cue] : balance(cue, rules.lineChars) };
  });
}

/** The cue shown at `t` (output seconds), and the word spoken there: the last one that started. */
export function captionAt(cues: readonly CaptionCue[], t: number): ActiveCaption | undefined {
  let lo = 0;
  let hi = cues.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const cue = cues[mid]!;
    if (t < cue.start) hi = mid - 1;
    else if (t >= cue.end) lo = mid + 1;
    else {
      const words = cue.lines.flat();
      let current: number | undefined;
      words.forEach((word, index) => {
        if (word.t <= t) current = index;
      });
      return { cue, ...(current !== undefined && { current }) };
    }
  }
  return undefined;
}

const stamp = (seconds: number, separator: ',' | '.') => {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}${separator}${pad(ms % 1000, 3)}`;
};
const cueText = (cue: CaptionCue) => cue.lines.map((line) => line.map((word) => word.text).join(' ')).join('\n');

/** The cues as SubRip (`.srt`). */
export function toSrt(cues: readonly CaptionCue[]): string {
  return cues.map((cue, i) => `${i + 1}\n${stamp(cue.start, ',')} --> ${stamp(cue.end, ',')}\n${cueText(cue)}\n`).join('\n');
}

/** The cues as WebVTT (`.vtt`). */
export function toVtt(cues: readonly CaptionCue[]): string {
  return `WEBVTT\n\n${cues.map((cue) => `${stamp(cue.start, '.')} --> ${stamp(cue.end, '.')}\n${cueText(cue)}\n`).join('\n')}`;
}
