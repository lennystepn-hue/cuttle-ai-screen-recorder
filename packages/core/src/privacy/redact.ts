// The screen's text as it is kept (screen-text.jsonl): each word of a private thing found in it
// (patterns.ts) replaced by a mark of its kind and an id, ⟦key-qwhzbtrk⟧, or of each kind where two
// rules found it, ⟦key-qwhzbtrk+value-mdkeuxpa⟧. The id is the private thing's as the masks follow it
// from frame to frame (masks.ts, trackSecrets), also where the OCR read it a little differently, so
// the masks read from the kept text are the ones read from the text, and nothing private is left in it.
// Ids come from a keyed hash whose key is made for the file and never kept.
import { createHmac, randomBytes } from 'node:crypto';
import type { ScreenTextFrame } from '@cuttle/project';
import { trackSecrets, type Track } from './masks';
import { SPECIFIC, isMarkKey } from './patterns';

/**
 * The frames with each private thing marked (the person's `words` too); `redacted`: how many words
 * changed. A track that has a word marked already keeps that id, so a file marked before stays as it is.
 */
export function redactFrames(frames: readonly ScreenTextFrame[], words: readonly string[], salt: Buffer = randomBytes(16)): { frames: ScreenTextFrame[]; redacted: number } {
  const { found } = trackSecrets(frames, words);
  const ids = new Map<Track, string>();
  for (const { secret, track } of found) {
    if (!ids.has(track) && isMarkKey(secret.key)) ids.set(track, secret.key.slice(secret.key.indexOf('-') + 1));
  }
  const used = new Set(ids.values());
  let next = 0;
  const idOf = (track: Track) => {
    let id = ids.get(track);
    while (id === undefined || (!ids.has(track) && used.has(id))) {
      // eight letters: no digits, so no rule reads a number in a mark
      id = [...createHmac('sha256', salt).update(String(next++)).digest().subarray(0, 8)].map((byte) => String.fromCharCode(97 + (byte % 26))).join('');
    }
    if (!ids.has(track)) {
      ids.set(track, id);
      used.add(id);
    }
    return id;
  };
  // the parts of each word's mark: frame, line, word → kind-id
  const parts = new Map<string, Set<string>>();
  for (const { frame, line, secret, track } of found) {
    for (const word of secret.words) {
      const at = `${frame}:${line}:${word}`;
      const set = parts.get(at) ?? new Set<string>();
      set.add(`${secret.kind}-${idOf(track)}`);
      parts.set(at, set);
    }
  }
  const order = (part: string) => SPECIFIC.indexOf(part.slice(0, part.indexOf('-')) as (typeof SPECIFIC)[number]);
  let redacted = 0;
  const kept = frames.map((frame, f) => ({
    ...frame,
    lines: frame.lines.map((line, l) => {
      let changed = false;
      const marked = line.words.map((word, w) => {
        const set = parts.get(`${f}:${l}:${w}`);
        if (!set) return word;
        const text = `⟦${[...set].sort((a, b) => order(a) - order(b) || a.localeCompare(b)).join('+')}⟧`;
        if (text === word.text) return word;
        redacted++;
        changed = true;
        return { ...word, text };
      });
      return changed ? { ...line, text: marked.map((word) => word.text).join(' '), words: marked } : line;
    }),
  }));
  return { frames: kept, redacted };
}
