// The speech edits: filler words and long pauses cut out where the picture rests. Pure: the inputs
// are the transcript, the screen's still stretches and the input events, in source seconds.
import { SHORT_SPELLINGS, fillerLexicon, newId, normWord, type InputEvent, type TranscriptWord } from '@cuttle/project';
import { gaps, union, type Span } from '../suggest/spans';

export const SPEECH_EDIT_RULES = {
  /** Kept on both sides of a filler's cut, up to the words around it. */
  fillerPad: 0.05,
  /** A stretch the mic heard without a word counts as a filler when shorter than this. */
  soundMax: 0.8,
  /** A short spelling counts only alone between pauses this long (the take's edges count as pauses). */
  alonePause: 0.2,
  /** A gap between words at least this long is a pause … */
  pauseMin: 1,
  /** … and keeps this much after the word before it and before the word after it (0.4 s in all). */
  pauseKeep: 0.2,
  /** A pause's cut is made only when it removes at least this much. */
  pauseCutMin: 0.3,
  /** The picture must rest this long before and after a cut: no input, no change on screen. */
  rest: 0.2,
  /** The pointer moving less than this (source pixels) while the picture rests does not count. */
  pointerSlack: 12,
};

export interface SpeechCut {
  from: number;
  to: number;
  auto: 'filler' | 'pause';
  label: string;
}

export interface SpeechEditInput {
  words: readonly TranscriptWord[];
  /** Stretches the mic heard where no word was written. */
  sounds: readonly Span[];
  language: string;
  /** Where the screen did not change. */
  still: readonly Span[];
  events: readonly InputEvent[];
  /** The clips' source stretches at 1×: cuts are made only inside them. */
  clips: readonly Span[];
}

const ms = (seconds: number) => Math.round(seconds * 1000) / 1000;

/**
 * When the person acts, padded `rest` on both sides: clicks, keys, scrolls, and the pointer
 * moving (each time it is `pointerSlack` away from where it last was still).
 */
export function inputSpans(events: readonly InputEvent[], rules = SPEECH_EDIT_RULES): Span[] {
  const spans: Span[] = [];
  let anchor: { x: number; y: number } | undefined;
  for (const event of events) {
    if (event.type === 'shape') continue;
    if (event.type === 'move') {
      if (anchor && Math.hypot(event.x - anchor.x, event.y - anchor.y) <= rules.pointerSlack) continue;
      const first = anchor === undefined;
      anchor = { x: event.x, y: event.y };
      if (first) continue;
    }
    spans.push({ from: event.t - rules.rest, to: event.t + rules.rest });
  }
  return union(spans);
}

/** Where the picture rests: still on screen from `rest` before to `rest` after, and no input then (`inputSpans`). */
export function restingAt(span: Span, input: Pick<SpeechEditInput, 'still' | 'events'>, rules = SPEECH_EDIT_RULES, busy = inputSpans(input.events, rules)): boolean {
  const from = span.from - rules.rest;
  const to = span.to + rules.rest;
  if (!input.still.some((still) => still.from <= from && to <= still.to)) return false;
  return !busy.some((other) => other.from < span.to && span.from < other.to);
}

/** The filler words of a transcript: in the lexicon, or a short spelling alone between pauses. */
export function fillerWords(words: readonly TranscriptWord[], language: string, rules = SPEECH_EDIT_RULES): number[] {
  const lexicon = fillerLexicon(language);
  const found: number[] = [];
  words.forEach((word, n) => {
    const text = normWord(word.text);
    if (lexicon.has(text)) return void found.push(n);
    if (!SHORT_SPELLINGS.has(text)) return;
    const before = n === 0 ? Infinity : word.t - words[n - 1]!.end;
    const after = n === words.length - 1 ? Infinity : words[n + 1]!.t - word.end;
    if (before >= rules.alonePause && after >= rules.alonePause) found.push(n);
  });
  return found;
}

/** The clip a stretch lies in entirely, if any. */
const insideClip = (span: Span, clips: readonly Span[]) => clips.some((clip) => clip.from <= span.from && span.to <= clip.to);

/**
 * Cuts for filler words (the lexicon, whisper's short spellings) and for the short sounds the mic
 * heard without a word, each padded `fillerPad` up to the words around it, made only where the
 * picture rests and inside a 1× clip. Fillers in a row are one cut, made only when they stand alone
 * between pauses: inside running speech the word times are estimates, and a cut there would clip
 * the words around it.
 */
export function fillerCuts(input: SpeechEditInput, rules = SPEECH_EDIT_RULES): SpeechCut[] {
  const { words } = input;
  const found: { from: number; to: number; label: string }[] = [];
  const fillers = fillerWords(words, input.language, rules);
  for (let k = 0; k < fillers.length; ) {
    // a run of fillers in a row: words[first … last]
    const first = fillers[k]!;
    let last = first;
    while (fillers[k + 1] === last + 1) last = fillers[++k]!;
    k++;
    const before = first === 0 ? -Infinity : words[first - 1]!.end;
    const after = last === words.length - 1 ? Infinity : words[last + 1]!.t;
    if (words[first]!.t - before < rules.alonePause || after - words[last]!.end < rules.alonePause) continue;
    const label = words
      .slice(first, last + 1)
      .map((word) => word.text.replace(/[^\p{L}\p{N}]+$/u, ''))
      .filter((text, i, all) => all.indexOf(text) === i)
      .join(', ');
    found.push({ from: Math.max(before, words[first]!.t - rules.fillerPad, 0), to: Math.min(after, words[last]!.end + rules.fillerPad), label });
  }
  for (const sound of input.sounds) {
    if (sound.to - sound.from >= rules.soundMax) continue;
    const before = words.filter((word) => word.end <= sound.from).at(-1)?.end ?? 0;
    const after = words.find((word) => word.t >= sound.to)?.t ?? Infinity;
    found.push({ from: Math.max(before, sound.from - rules.fillerPad), to: Math.min(after, sound.to + rules.fillerPad), label: '' });
  }
  found.sort((a, b) => a.from - b.from);
  const merged: typeof found = [];
  for (const cut of found) {
    const last = merged.at(-1);
    if (last && cut.from <= last.to + 0.01) {
      last.to = Math.max(last.to, cut.to);
      if (cut.label && !last.label.split(', ').includes(cut.label)) last.label = last.label ? `${last.label}, ${cut.label}` : cut.label;
    } else merged.push({ ...cut });
  }
  const busy = inputSpans(input.events, rules);
  return merged
    .filter((cut) => cut.to - cut.from > 0.02 && insideClip(cut, input.clips) && restingAt(cut, input, rules, busy))
    .map((cut) => ({ from: ms(cut.from), to: ms(cut.to), auto: 'filler', label: cut.label ? `Filler: ${cut.label}` : 'Filler (a sound)' }));
}

/**
 * Cuts for pauses: a gap of at least `pauseMin` between words keeps `pauseKeep` after the word
 * before and before the word after; of the rest, each part where the picture rests is cut, when it
 * is at least `pauseCutMin` long and inside a 1× clip. A short sound in the pause goes with it; a
 * long one (music, a word whisper missed) stays.
 */
export function pauseCuts(input: SpeechEditInput, rules = SPEECH_EDIT_RULES): SpeechCut[] {
  const { words } = input;
  const cuts: SpeechCut[] = [];
  const busy = union([
    ...input.sounds.filter((sound) => sound.to - sound.from >= rules.soundMax).map((sound) => ({ from: sound.from - 0.1, to: sound.to + 0.1 })),
    ...inputSpans(input.events, rules),
  ]);
  for (let n = 1; n < words.length; n++) {
    const gap = words[n]!.t - words[n - 1]!.end;
    if (gap < rules.pauseMin) continue;
    const inner = { from: words[n - 1]!.end + rules.pauseKeep, to: words[n]!.t - rules.pauseKeep };
    for (const clip of input.clips) {
      const from = Math.max(inner.from, clip.from);
      const to = Math.min(inner.to, clip.to);
      if (to - from < rules.pauseCutMin) continue;
      for (const still of input.still) {
        // inside the still stretch, `rest` from its edges
        const a = Math.max(from, still.from + rules.rest);
        const b = Math.min(to, still.to - rules.rest);
        if (b - a < rules.pauseCutMin) continue;
        for (const part of gaps(busy, a, b)) {
          if (part.to - part.from < rules.pauseCutMin) continue;
          cuts.push({ from: ms(part.from), to: ms(part.to), auto: 'pause', label: `Pause: ${gap.toFixed(1)} s` });
        }
      }
    }
  }
  return cuts;
}

/** The speech edits, pauses first; a filler inside a pause's cut is already gone. */
export function speechCuts(input: SpeechEditInput, kinds: { fillers: boolean; pauses: boolean }, rules = SPEECH_EDIT_RULES): SpeechCut[] {
  const pauses = kinds.pauses ? pauseCuts(input, rules) : [];
  const fillers = kinds.fillers ? fillerCuts(input, rules).filter((cut) => !pauses.some((pause) => cut.from < pause.to && pause.from < cut.to)) : [];
  return [...pauses, ...fillers].sort((a, b) => a.from - b.from);
}

/** A cut as written to cuttle.json (kept ones as they were, with whatever fields they had). */
export interface RawCut {
  id?: string;
  label?: string;
  from: number;
  to: number;
  enabled?: boolean;
  auto?: string;
  [field: string]: unknown;
}

/**
 * The cuts after a rerun of `kinds`: the cuts of those kinds still tagged are replaced by `made`;
 * every other cut stays. A new cut overlapping a cut that stays is not made. A new cut that takes
 * the place of a replaced one of its kind (overlapping at least half of the shorter) keeps its id,
 * and stays off when the person had switched that one off; the others get unused ids from `taken`.
 */
export function mergeCuts(raw: readonly RawCut[], made: readonly SpeechCut[], kinds: readonly string[], taken: Set<string>): { cuts: RawCut[]; added: RawCut[]; kept: number } {
  const ours = (cut: RawCut) => cut.auto !== undefined && kinds.includes(cut.auto);
  const kept = raw.filter((cut) => !ours(cut));
  const replaced = raw.filter(ours);
  const overlap = (a: Span, b: Span) => Math.min(a.to, b.to) - Math.max(a.from, b.from);
  const reused = new Set<RawCut>();
  const added: RawCut[] = [];
  for (const cut of made) {
    if (kept.some((other) => overlap(cut, other) > 0)) continue;
    const before = replaced.find((other) => !reused.has(other) && other.auto === cut.auto && overlap(cut, other) >= 0.5 * Math.min(cut.to - cut.from, other.to - other.from));
    if (before) reused.add(before);
    const id = typeof before?.id === 'string' ? before.id : newId('cuts', taken);
    added.push({ id, label: cut.label, from: cut.from, to: cut.to, ...(before?.enabled === false && { enabled: false }), auto: cut.auto });
  }
  return { cuts: [...kept, ...added].sort((a, b) => a.from - b.from), added, kept: kept.length };
}
