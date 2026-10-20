// Retakes: the person slipped, pressed the mistake key (a `retake` marker), said "nochmal" or just
// began the sentence again, and did the bit again. The slip is cut: from the last pause before it to
// just after the key or the cue, or to just before the sentence begun again.
// Pure: the inputs are the markers, the transcript (or the mic's speech stretches) and the input
// events, in source seconds.
import { fillerLexicon, normWord, type InputEvent, type Marker, type TranscriptWord } from '@cuttle/project';
import type { Span } from '../suggest/spans';

export const RETAKE_RULES = {
  /** A gap in the speech this long is a pause … */
  pause: 0.7,
  /** … when nothing was clicked, typed or scrolled in its last this many seconds. */
  restingInput: 0.5,
  /** A pause is looked for at most this far back; without one, the cut starts this far back. */
  lookBack: 20,
  fallback: 5,
  /** Kept of the pause before the slip. */
  keepBefore: 0.15,
  /** The cut ends this long after the key or the spoken cue. */
  after: 0.15,
  /** A spoken cue starts a phrase: a pause this long comes before it ("…die Art. Nochmal."). */
  cuePause: 0.3,
  /** It counts when what follows (within this long) repeats the start of the slip … */
  repeatWindow: 4,
  /** … word for word, this many words or the whole slip … */
  repeatMatch: 2,
  /** … which began at most these many words before the cue. */
  repeatWords: 12,
  /**
   * A phrase begun again without a cue: the next phrase repeats it word for word from its start,
   * all of it (at least this many words) …
   */
  restartWords: 2,
  /** … or this many words or more of it. */
  restartMatch: 3,
};

/** The spoken cues for "once more", as normalised words in a row (the longest that fits wins). */
const CUES: readonly (readonly string[])[] = [
  ['nochmal'],
  ['nochmals'],
  ['noch', 'mal'],
  ['noch', 'einmal'],
  ['nochmal', 'von', 'vorne'],
  ['noch', 'mal', 'von', 'vorne'],
  ['noch', 'einmal', 'von', 'vorne'],
  ['again'],
  ['one', 'more', 'time'],
  ['let', 'me', 'redo', 'that'],
  ['again', 'from', 'the', 'top'],
];

/** Words that may stand around a cue ("Sorry, nochmal. Äh, die App …"): skipped when the slip and the repeat are compared. */
const AROUND_CUES: ReadonlySet<string> = new Set([...fillerLexicon('auto'), 'sorry', 'okay', 'ok', 'oops', 'hoppla', 'mist', 'nee', 'nein', 'no', 'also', 'so']);

export interface RetakeCut {
  from: number;
  to: number;
  auto: 'retake';
  label: string;
}

export interface RetakeInput {
  markers: readonly Marker[];
  /** The transcript's words, when there is one. */
  words?: readonly TranscriptWord[];
  /** Where someone speaks (the words, or the mic's loud stretches); the gaps between them are the pauses. */
  speech: readonly Span[];
  events: readonly InputEvent[];
  /** The clips' source stretches: a cut never crosses one's edge. */
  clips: readonly Span[];
}

const ms = (seconds: number) => Math.round(seconds * 1000) / 1000;

export interface SpokenCue {
  at: number;
  end: number;
  text: string;
  /** Where the slip it takes back began: the first of the words before it that is said again. */
  slip: number;
}

/**
 * The spoken cues that take a slip back: a cue that starts a phrase (after a pause), followed by the
 * slip said again, word for word from its start ("Die App erkennt die Art. Nochmal. Die App erkennt
 * die Art und misst …"). "Click it again" in a sentence is no cue.
 */
export function spokenCues(words: readonly TranscriptWord[], rules = RETAKE_RULES): SpokenCue[] {
  const normal = words.map((word) => normWord(word.text));
  const found: SpokenCue[] = [];
  for (let i = 0; i < words.length; i++) {
    const cue = CUES.filter((phrase) => phrase.every((part, k) => normal[i + k] === part)).sort((a, b) => b.length - a.length)[0];
    if (!cue) continue;
    const last = words[i + cue.length - 1]!;
    // the slip ends at `p` (before a "sorry" or an "äh"), with a pause there
    let p = i;
    while (p > 0 && AROUND_CUES.has(normal[p - 1]!)) p--;
    if (p === 0 || words[p]!.t - words[p - 1]!.end < rules.cuePause) continue;
    // the repeat starts at `a`, after the cue (and an "äh")
    let a = i + cue.length;
    while (a < words.length && AROUND_CUES.has(normal[a]!)) a++;
    const repeat = normal.slice(a).filter((_, k) => words[a + k]!.t <= last.end + rules.repeatWindow);
    // where the slip began: the word before the cue from which the repeat matches longest
    let best: { at: number; length: number } | undefined;
    for (let j = Math.max(0, p - rules.repeatWords); j < p; j++) {
      let length = 0;
      while (j + length < p && length < repeat.length && normal[j + length] === repeat[length]) length++;
      const counts = length >= rules.repeatMatch || (length > 0 && j + length === p);
      if (counts && length >= (best?.length ?? 0)) best = { at: j, length };
    }
    if (!best) continue;
    const text = words
      .slice(i, i + cue.length)
      .map((word) => word.text.replace(/[^\p{L}\p{N}]+$/u, ''))
      .join(' ');
    found.push({ at: words[i]!.t, end: last.end, text, slip: words[best.at]!.t });
    i += cue.length - 1;
  }
  return found;
}

/** A phrase broken off and begun again without a cue. */
export interface Restart {
  /** Where it begins again: the first word said again. */
  at: number;
  /** Where the broken phrase began. */
  slip: number;
  /** The broken phrase's words. */
  text: string;
}

/**
 * The phrases begun again without a cue ("Dann klickt ihr auf … Dann klickt ihr auf Exportieren"): a
 * phrase starts after a pause of `cuePause` (or with the take, or where a phrase began again), and
 * the next one repeats it word for word from its start: all of it, `restartWords` words or more, or
 * `restartMatch` words or more of it. No pause is asked for between the two: whisper often puts the
 * broken phrase's last word right against the new start.
 */
export function restarts(words: readonly TranscriptWord[], rules = RETAKE_RULES): Restart[] {
  const normal = words.map((word) => normWord(word.text));
  const found: Restart[] = [];
  let again = -1;
  for (let i = 0; i < words.length; i++) {
    if (i > 0 && i !== again && words[i]!.t - words[i - 1]!.end < rules.cuePause) continue;
    for (let j = i + 1; j < words.length && j - i <= rules.repeatWords; j++) {
      if (normal[j] !== normal[i]) continue;
      let length = 0;
      while (i + length < j && j + length < words.length && normal[i + length] === normal[j + length]) length++;
      if ((i + length === j && length >= rules.restartWords) || length >= rules.restartMatch) {
        const text = words
          .slice(i, j)
          .map((word) => word.text.replace(/[^\p{L}\p{N}]+$/u, ''))
          .join(' ');
        found.push({ at: words[j]!.t, slip: words[i]!.t, text });
        // the new start is a phrase's start: it may be broken off and begun again too
        again = j;
        i = j - 1;
        break;
      }
    }
  }
  return found;
}

/**
 * Where the slip before `back` began: the end of the last pause in the speech (a gap of `pause` or
 * more, with no click, key or scroll in its last `restingInput`), at most `lookBack` back; else
 * `fallback` back. Never before `floor` (the clip's start).
 */
function slipStart(back: number, input: RetakeInput, floor: number, rules: typeof RETAKE_RULES): number {
  const speech = [...input.speech].filter((span) => span.from < back).sort((a, b) => a.from - b.from);
  const acts = input.events.filter((event) => event.type === 'click' || event.type === 'keys' || event.type === 'scroll').map((event) => event.t);
  for (let k = speech.length - 1; k >= 0; k--) {
    const gapEnd = speech[k]!.from;
    if (gapEnd < back - rules.lookBack || gapEnd < floor) break;
    const gapStart = k > 0 ? speech[k - 1]!.to : floor;
    if (gapEnd - gapStart < rules.pause && k > 0) continue;
    if (acts.some((t) => t > gapEnd - rules.restingInput && t <= gapEnd)) continue;
    return Math.max(floor, gapEnd - rules.keepBefore);
  }
  return Math.max(floor, back - rules.fallback);
}

/**
 * The retakes: one cut per mistake key (a `retake` marker), per spoken cue that is followed by a
 * repeat and per phrase begun again without a cue, from the last pause before the slip to `after`
 * past the key or the cue (to `keepBefore` before a phrase begun again), inside the clip it lies in.
 * Cuts that overlap become one.
 */
export function retakeCuts(input: RetakeInput, rules = RETAKE_RULES): RetakeCut[] {
  // `back`: where to look back from for the pause before the slip (a cue's: the slip's first word)
  const slips: { at: number; back: number; to: number; label: string }[] = [
    ...input.markers.filter((marker) => marker.kind === 'retake').map((marker) => ({ at: marker.t, back: marker.t, to: marker.t + rules.after, label: 'Retake' })),
    ...(input.words ? spokenCues(input.words, rules).map((cue) => ({ at: cue.at, back: cue.slip + 0.001, to: cue.end + rules.after, label: `Retake: “${cue.text}”` })) : []),
    ...(input.words ? restarts(input.words, rules).map((restart) => ({ at: restart.at, back: restart.slip + 0.001, to: restart.at - rules.keepBefore, label: `Restart: “${restart.text}”` })) : []),
  ];
  const cuts: RetakeCut[] = [];
  for (const slip of slips.sort((a, b) => a.at - b.at)) {
    const clip = input.clips.find((span) => span.from <= slip.at && slip.at < span.to);
    if (!clip) continue;
    const from = slipStart(slip.back, input, clip.from, rules);
    const to = Math.min(clip.to, slip.to);
    if (!(to > from)) continue;
    const last = cuts.at(-1);
    if (last && from <= last.to) {
      last.to = Math.max(last.to, ms(to));
      continue;
    }
    cuts.push({ from: ms(from), to: ms(to), auto: 'retake', label: slip.label });
  }
  return cuts;
}
