// When each word of a spoken line is heard, for its subtitles and for the music to go down under it,
// where the voice does not say (a local voice, a file): the words share the line's sound by their
// letters, then each stretch of speech in it (between the pauses at commas and full stops) takes the
// run of words that fits it, as the mic's words are aligned (align.ts).
import { alignWords } from '../speech/align';
import { micLevels, speechStretches } from '../speech/levels';
import type { HeardWord } from '../speech/whisper';

const milli = (value: number) => Math.round(value * 1000) / 1000;

/** The words of `text` spread over `from` to `to` by their letters (and a letter's worth of space each). */
export function spreadWords(text: string, from: number, to: number): HeardWord[] {
  const parts = text.split(/\s+/).filter((part) => part !== '');
  const weights = parts.map((part) => part.length + 1);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let at = from;
  return parts.map((part, i) => {
    const length = ((to - from) * weights[i]!) / total;
    const word = { t: milli(at), end: milli(at + length), text: part };
    at += length;
    return word;
  });
}

/**
 * The words of `text` in the sound at `path` (seconds of the sound): spread over its speech, then
 * aligned to its stretches; spread over the whole sound where it has no clear stretches.
 */
export async function spokenWords(path: string, text: string, seconds: number, signal?: AbortSignal): Promise<HeardWord[]> {
  if (text.trim() === '') return [];
  const stretches = speechStretches(await micLevels(path, signal));
  if (stretches.length === 0) return spreadWords(text, 0, seconds);
  const guessed = spreadWords(text, stretches[0]!.from, stretches.at(-1)!.to);
  const aligned = alignWords(guessed, stretches);
  // every word was spoken: an alignment that leaves one out is not trusted
  return aligned.aligned && aligned.dropped.length === 0 ? aligned.words.map((word) => ({ t: milli(word.t), end: milli(word.end), text: word.text })) : guessed;
}
