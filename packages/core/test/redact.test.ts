import { describe, expect, it } from 'vitest';
import type { ScreenTextFrame, ScreenTextLine } from '@cuttle/project';
import { privacyMasks } from '../src/privacy/masks';
import { redactFrames } from '../src/privacy/redact';

/** A line of text at (x, y): each character 10 px wide and 20 px high, words one character apart. */
function line(text: string, x: number, y: number): ScreenTextLine {
  let at = x;
  const words = text.split(' ').map((word) => {
    const rect: [number, number, number, number] = [at, y, word.length * 10, 20];
    at += (word.length + 1) * 10;
    return { text: word, rect };
  });
  return { text, rect: [x, y, at - x - 10, 20], words };
}
const frame = (t: number, ...lines: ScreenTextLine[]): ScreenTextFrame => ({ t, lines });
const screen = { width: 1920, height: 1080 };

// put together here, so no key-like text stands in the source
const KEY = 'sk-ant-api03-' + 'AbCdEf1234567890GhIjKlMn';
const RANDOM = 'wJ7r' + 'Xu9tnF2EMk/K7MDq5NG/bP3xRfi8CYk0p4LKQ1zH';
const WORDS = ['Lena Müller'];
const lines = (y: number) => [
  line(`ANTHROPIC_API_KEY=${KEY}`, 100, y),
  line('Signed in as lena.mueller@example.com', 100, 200),
  line('Thanks, Lena Müller', 100, 300),
  line(`| prod | ${RANDOM} |`, 100, 400),
  line('Release 2026-10-19, build 4.2.1', 100, 500),
];
// the key scrolls up at 2 s; all of it is gone at 2.5 s
const FRAMES = [frame(1, ...lines(100)), frame(1.5, ...lines(100)), frame(2, ...lines(60)), frame(2.5), frame(3), frame(4)];

describe('redactFrames', () => {
  it('marks each private thing word for word, keeps the rest, and the masks are the same', () => {
    const { frames, redacted } = redactFrames(FRAMES, WORDS);
    const kept = JSON.stringify(frames);
    for (const secret of [KEY, 'lena.mueller@example.com', 'Lena', 'Müller', RANDOM]) expect(kept, secret).not.toContain(secret);
    expect(kept).toContain('Signed in as');
    expect(kept).toContain('Release 2026-10-19, build 4.2.1');
    // 3 frames: the key, the email, the two words, the random string
    expect(redacted).toBe(3 * 5);
    expect(privacyMasks(frames, WORDS, screen)).toEqual(privacyMasks(FRAMES, WORDS, screen));
    expect(privacyMasks(frames, WORDS, screen).map((mask) => mask.label)).toEqual(['Key', 'Email address', 'Always masked', 'Random-looking string']);
  });

  it('gives the same text one mark in a file, other texts other marks, of letters only; the line reads as its words', () => {
    const { frames } = redactFrames(FRAMES, WORDS);
    const word = (t: number, line: number, index: number) => frames.find((one) => one.t === t)!.lines[line]!.words[index]!.text;
    // the key in a NAME=value line: found by two rules, a mark of each
    expect(word(1, 0, 0)).toMatch(/^⟦key-[a-z]{8}\+value-[a-z]{8}⟧$/);
    // the key moved: the same mark
    expect(word(2, 0, 0)).toBe(word(1, 0, 0));
    expect(word(1, 1, 3)).toMatch(/^⟦email-[a-z]{8}⟧$/);
    expect(word(1, 2, 1)).toBe(word(1, 2, 2));
    expect(word(1, 2, 1)).toMatch(/^⟦word-[a-z]{8}⟧$/);
    expect(new Set([word(1, 0, 0), word(1, 1, 3), word(1, 2, 1), word(1, 3, 2)]).size).toBe(4);
    const signed = frames[0]!.lines[1]!;
    expect(signed.text).toBe(signed.words.map((one) => one.text).join(' '));
  });

  it('leaves frames marked already as they are, and a new file gets new ids', () => {
    const salt = Buffer.alloc(16, 1);
    const once = redactFrames(FRAMES, WORDS, salt).frames;
    expect(redactFrames(once, WORDS)).toEqual({ frames: once, redacted: 0 });
    const other = redactFrames(FRAMES, WORDS, Buffer.alloc(16, 2)).frames;
    expect(other[0]!.lines[0]!.words[0]!.text).not.toBe(once[0]!.lines[0]!.words[0]!.text);
  });

  // a token that scrolls up 15 px a frame, as Vision reads it on a Mac: a slip in its prefix in two
  // frames (only the NAME= rule finds it there), another slip in one (found by its prefix still)
  const TOKEN = 'ghp_' + '1234567890abcdefghijklmnop';
  const SLIPPED = 'qhq_' + '1234567890abcdefghijklmnop';
  const NEARLY = 'ghp_' + '1234567890abcdefghijk1mnop';
  const scrolling = [TOKEN, NEARLY, SLIPPED, SLIPPED, TOKEN, TOKEN].map((token, k) =>
    frame(0.5 * k, line('Signed in as lena.mueller@example.com', 80, 80), line(`export GITHUB_TOKEN=${token}`, 80, 420 - 15 * k), line('Thanks, Lena Müller', 80, 640)),
  );

  it('makes the masks the text made where the OCR read a scrolling key with slips, and marks each private thing with one id', () => {
    const { frames } = redactFrames(scrolling, WORDS);
    expect(JSON.stringify(frames)).not.toContain('1234567890');
    expect(privacyMasks(frames, WORDS, screen)).toEqual(privacyMasks(scrolling, WORDS, screen));
    // the token's line: one key and one value, the same in every frame its prefix was read
    const marks = frames.map((one) => one.lines[1]!.words[1]!.text);
    expect(marks[0]).toBe(marks[1]);
    expect(marks[2]).toBe(marks[3]);
    expect(marks[2]).toBe(`⟦${marks[0]!.split('+')[1]}`);
    // and so again from the kept text: nothing changes
    expect(redactFrames(frames, WORDS).redacted).toBe(0);
  });

  it('keeps the ids an older version gave (each slip its own), and marks what it left', () => {
    // as the version before marked it: each text its own id
    const older = scrolling.map((one, k) => ({
      ...one,
      lines: one.lines.map((each, l) => (l === 1 ? line(`export ⟦${k === 2 || k === 3 ? 'value-mmmmmmmm' : k === 1 ? 'key-nnnnnnnn' : 'key-kkkkkkkk'}⟧`, 80, 420 - 15 * k) : each)),
    }));
    const once = redactFrames(older, WORDS);
    expect(once.redacted).toBeGreaterThan(0);
    // the address and the name were left (the line marked before stays as it was)
    expect(once.frames.map((one) => one.lines[1]!.words[1]!.text)).toEqual(older.map((one) => one.lines[1]!.words[1]!.text));
    expect(JSON.stringify(once.frames)).not.toContain('lena.mueller');
    expect(privacyMasks(once.frames, WORDS, screen)).toEqual(privacyMasks(older, WORDS, screen));
    expect(redactFrames(once.frames, WORDS).redacted).toBe(0);
  });
});
