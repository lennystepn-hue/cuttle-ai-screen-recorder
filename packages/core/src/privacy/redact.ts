// The screen's text as it is kept (screen-text.jsonl): each private thing found in it (patterns.ts)
// replaced, word for word, by a mark of its kind and an id, ⟦key-qwhzbtrk⟧. The same text gets the
// same id in one file (a keyed hash whose key is made for that file and never kept), so the masks
// read from the file are the ones read from the text, and nothing private is left in it.
import { createHmac, randomBytes } from 'node:crypto';
import type { ScreenTextFrame } from '@cuttle/project';
import { SPECIFIC, isMark, secretWords, type SecretKind } from './patterns';

/**
 * The frames with each private thing marked (the person's `words` too); `redacted`: how many words
 * were marked now (a word that is a mark already stays as it is).
 */
export function redactFrames(frames: readonly ScreenTextFrame[], words: readonly string[], salt: Buffer = randomBytes(16)): { frames: ScreenTextFrame[]; redacted: number } {
  const ids = new Map<string, string>();
  const idOf = (key: string) => {
    let id = ids.get(key);
    if (id === undefined) {
      // eight letters: no digits, so no rule reads a number in a mark
      id = [...createHmac('sha256', salt).update(key).digest().subarray(0, 8)].map((byte) => String.fromCharCode(97 + (byte % 26))).join('');
      ids.set(key, id);
    }
    return id;
  };
  let redacted = 0;
  const kept = frames.map((frame) => ({
    ...frame,
    lines: frame.lines.map((line) => {
      // each word in a private thing gets the mark of the most specific kind it is in
      const marks = new Map<number, { kind: SecretKind; key: string }>();
      for (const secret of secretWords(line, words)) {
        for (const index of secret.words) {
          const before = marks.get(index);
          if (!before || SPECIFIC.indexOf(secret.kind) < SPECIFIC.indexOf(before.kind)) marks.set(index, secret);
        }
      }
      if (marks.size === 0) return line;
      const marked = line.words.map((word, index) => {
        const mark = marks.get(index);
        if (!mark || isMark(word.text)) return word;
        redacted++;
        return { ...word, text: `⟦${mark.kind}-${idOf(mark.key)}⟧` };
      });
      return { ...line, text: marked.map((word) => word.text).join(' '), words: marked };
    }),
  }));
  return { frames: kept, redacted };
}
