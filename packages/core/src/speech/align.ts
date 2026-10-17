// Word times from one whisper run (good text, coarse times) refined by the audio: each speech
// stretch takes, in order, the run of words whose letters fit its length at the take's speaking rate,
// near where whisper put them; inside a stretch the words share its length by their letters. In the
// spike this cut the median start error from about 500 ms to 35 to 76 ms.
import { normWord } from '@cuttle/project';
import type { Span } from '../suggest/spans';
import type { HeardWord } from './whisper';

export const ALIGN_RULES = {
  /** A stretch shorter than this may take no word, cheaply: a filler whisper left out, a cough, a click. */
  shortSound: 0.8,
  /** What an empty short stretch costs; a longer one costs twice its length. */
  shortSoundCost: 0.15,
  /** Words whisper put further than this (seconds) from a stretch never go into it. */
  band: 10,
  /**
   * What leaving a word out costs: a word heard where the mic was quiet (whisper makes up words
   * in silence, such as a closing "Vielen Dank.") fits no stretch and is dropped.
   */
  drop: 1.5,
  /**
   * What a likely filler costs in a stretch it shares with other words: a filler usually has a short
   * stretch of its own, and whisper often puts it a little early or late.
   */
  fillerShared: 0.3,
};

export interface Alignment {
  words: HeardWord[];
  /** The stretches that took no word. */
  sounds: Span[];
  /** Words left out: heard where no stretch could take them. */
  dropped: HeardWord[];
  /** False when the words could not be fitted at all (whisper's times are kept). */
  aligned: boolean;
}

const MAX_DROPPED = 40;
const letters = (word: HeardWord) => normWord(word.text).length + 1;
const middle = (word: HeardWord) => (word.t + word.end) / 2;

/**
 * Aligns `words` (whisper's, in order) to `stretches` (the mic's, in order, not overlapping) by
 * dynamic programming over (stretch, words placed so far). Cost of a stretch [a, b] taking words
 * i…j−1: how far their letters at the take's rate miss its length, plus how far whisper put them
 * outside it on average, plus `fillerShared` for each likely filler (`options.filler`) in a run of
 * several; a stretch may take none, and a word may be left out (`drop`). Words further
 * than `band` from a stretch are never placed in it, which keeps an hour-long take fast.
 */
export function alignWords(
  words: readonly HeardWord[],
  stretches: readonly Span[],
  options: { rules?: typeof ALIGN_RULES; filler?: (word: HeardWord) => boolean } = {},
): Alignment {
  const rules = options.rules ?? ALIGN_RULES;
  const filler = words.map((word) => options.filler?.(word) ?? false);
  const W = words.length;
  const S = stretches.length;
  const unchanged = (): Alignment => ({ words: words.map((word) => ({ ...word })), sounds: [], dropped: [], aligned: false });
  if (W === 0) return { words: [], sounds: stretches.map((span) => ({ ...span })), dropped: [], aligned: true };
  if (S === 0) return unchanged();
  const speechTotal = stretches.reduce((sum, span) => sum + (span.to - span.from), 0);
  const rate = speechTotal / words.reduce((sum, word) => sum + letters(word), 0);

  let state = new Float64Array(W + 1).fill(Infinity);
  state[0] = 0;
  let lo = 0;
  let hi = 0;
  /** Per layer (before stretch k; k = S after the last): states reached by leaving out the word before them. */
  const drops: { lo: number; marks: Uint8Array }[] = [];
  /** Per stretch: for each state after it, the state before it. */
  const back: { lo: number; from: Int32Array }[] = [];
  const leaveOut = () => {
    const marks = new Uint8Array(W + 1 - lo);
    // at most `MAX_DROPPED` words in a row past the states reached: a longer run is never cheaper
    const limit = Math.min(W, hi + MAX_DROPPED);
    for (let i = lo; i < limit; i++) {
      if (state[i]! + rules.drop < state[i + 1]!) {
        state[i + 1] = state[i]! + rules.drop;
        marks[i + 1 - lo] = 1;
        if (i + 1 > hi) hi = i + 1;
      }
    }
    drops.push({ lo, marks });
  };
  for (let k = 0; k < S; k++) {
    leaveOut();
    const { from: a, to: b } = stretches[k]!;
    const len = b - a;
    const cur = new Float64Array(W + 1).fill(Infinity);
    const from = new Int32Array(W + 1).fill(-1);
    const empty = len < rules.shortSound ? rules.shortSoundCost : len * 2;
    let nextLo = W + 1;
    let nextHi = -1;
    const relax = (i: number, j: number, cost: number) => {
      if (cost < cur[j]!) {
        cur[j] = cost;
        from[j] = i;
        if (j < nextLo) nextLo = j;
        if (j > nextHi) nextHi = j;
      }
    };
    for (let i = lo; i <= hi; i++) {
      const base = state[i]!;
      if (base === Infinity) continue;
      relax(i, i, base + empty);
      // A word whisper put far before this stretch is not placed in it (only left out).
      if (i < W && middle(words[i]!) < a - rules.band) continue;
      let chars = 0;
      let far = 0;
      let fillers = 0;
      for (let j = i + 1; j <= W; j++) {
        const word = words[j - 1]!;
        const mid = middle(word);
        if (mid > b + rules.band) break;
        chars += letters(word);
        far += mid < a ? a - mid : mid > b ? mid - b : 0;
        if (filler[j - 1]) fillers++;
        relax(i, j, base + Math.abs(len - chars * rate) + far / (j - i) + (j - i > 1 ? fillers * rules.fillerShared : 0));
        // Far more letters than fit: longer runs only cost more.
        if (chars * rate > len * 3 + 2) break;
      }
    }
    if (nextHi < 0) return unchanged();
    back.push({ lo: nextLo, from: from.slice(nextLo, nextHi + 1) });
    state = cur;
    lo = nextLo;
    hi = nextHi;
  }
  hi = W; // the words after the last stretch can only be left out
  leaveOut();
  if (state[W] === Infinity) return unchanged();

  const groups: [number, number][] = new Array(S);
  const dropped: HeardWord[] = [];
  for (let k = S, j = W; k >= 0; k--) {
    const layer = drops[k]!;
    while (j > layer.lo && layer.marks[j - layer.lo] === 1) {
      dropped.unshift({ ...words[j - 1]! });
      j--;
    }
    if (k === 0) break;
    const { lo: start, from } = back[k - 1]!;
    const i = from[j - start]!;
    groups[k - 1] = [i, j];
    j = i;
  }
  const aligned: HeardWord[] = [];
  const sounds: Span[] = [];
  groups.forEach(([i, j], k) => {
    const { from: a, to: b } = stretches[k]!;
    if (i === j) {
      sounds.push({ from: a, to: b });
      return;
    }
    const group = words.slice(i, j);
    const total = group.reduce((sum, word) => sum + letters(word), 0);
    let sum = 0;
    for (const word of group) {
      const t = a + ((b - a) * sum) / total;
      sum += letters(word);
      aligned.push({ text: word.text, t: round(t), end: round(a + ((b - a) * sum) / total) });
    }
  });
  return { words: aligned, sounds, dropped, aligned: true };
}

const round = (seconds: number) => Math.round(seconds * 1000) / 1000;

const GERMAN = new Set(['der', 'die', 'das', 'und', 'ist', 'nicht', 'ich', 'du', 'wir', 'mit', 'ein', 'eine', 'auf', 'für', 'zu', 'den', 'dem', 'es', 'sie', 'hier', 'jetzt', 'auch', 'noch', 'dann', 'wie', 'was', 'man', 'kann', 'sind']);
const ENGLISH = new Set(['the', 'and', 'is', 'to', 'of', 'a', 'you', 'it', 'that', 'in', 'this', 'with', 'for', 'we', 'i', 'on', 'can', 'are', 'here', 'now', 'just', 'so', 'what', 'how', 'be', 'have', 'an', 'not', 'your']);

/**
 * German, English or unknown (`auto`), by common short words: whisper's filter does not say which
 * language it heard. The filler words depend on it ("um" is a filler in English, a word in German).
 */
export function guessLanguage(words: readonly HeardWord[]): string {
  let de = 0;
  let en = 0;
  for (const word of words) {
    const text = normWord(word.text);
    if (GERMAN.has(text)) de++;
    if (ENGLISH.has(text)) en++;
  }
  if (de + en < 3) return 'auto';
  if (de >= 2 * en) return 'de';
  if (en >= 2 * de) return 'en';
  return 'auto';
}
