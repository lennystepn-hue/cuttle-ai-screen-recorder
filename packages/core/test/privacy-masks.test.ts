import { describe, expect, it } from 'vitest';
import type { ScreenTextFrame, ScreenTextLine } from '@cuttle/project';
import { privacyMasks } from '../src/privacy/masks';

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

describe('privacyMasks', () => {
  it('masks a secret from half a second before its first sight until a frame read shows it gone, padded', () => {
    const email = line('mail: lena@example.com', 100, 200);
    const frames = [frame(1, email), frame(1.5, email), frame(2, email), frame(2.5), frame(3), frame(4)];
    expect(privacyMasks(frames, [], screen)).toEqual([{ from: 0.5, to: 2.5, rect: [154, 194, 172, 32], kind: 'email', label: 'Email address' }]);
  });

  it('keeps one mask over frames the OCR missed it in, and starts a new one when it was gone 2.5 s', () => {
    const email = line('lena@example.com', 100, 200);
    // missed at 1.5 s; gone from 2.5 s (four frames, 3 s); back at 8 s, and on screen until the take ends
    const frames = [frame(1, email), frame(1.5), frame(2, email), frame(2.5), frame(3), frame(4), frame(5), frame(8, email)];
    expect(privacyMasks(frames, [], screen, 12).map((mask) => [mask.from, mask.to])).toEqual([
      [0.5, 2.5],
      [7.5, 12],
    ]);
  });

  it('lasts until a frame read shows it gone: the picture did not change before', () => {
    const email = line('lena@example.com', 100, 200);
    expect(privacyMasks([frame(1, email), frame(7), frame(7.5)], [], screen).map((mask) => [mask.from, mask.to])).toEqual([[0.5, 7]]);
  });

  it('holds still text whose box the OCR drew a little larger in one frame (Vision): one place, grown to hold both', () => {
    const still = line('lena@example.com', 100, 200);
    // read 8 px higher and 10 px taller once, as Vision's boxes jitter around text that stays
    const taller: ScreenTextLine = { ...still, words: still.words.map((word) => ({ ...word, rect: [word.rect[0], word.rect[1] - 8, word.rect[2], word.rect[3] + 10] })) };
    const frames = [frame(1, still), frame(1.5, taller), frame(2, still), frame(2.5), frame(3), frame(4)];
    expect(privacyMasks(frames, [], screen)).toEqual([{ from: 0.5, to: 2.5, rect: [94, 186, 172, 42], kind: 'email', label: 'Email address' }]);
  });

  it('follows text that scrolls: where it was last seen before it moved, then each place it went', () => {
    const key = (y: number) => line('ghp_1234567890abcdefghijklmnop', 100, y);
    const frames = [frame(1, key(300)), frame(1.5, key(300)), frame(2, key(250)), frame(2.5, key(200)), frame(3), frame(3.5)];
    expect(privacyMasks(frames, [], screen)).toEqual([
      {
        from: 0.5,
        to: 3,
        rect: [94, 294, 312, 32],
        moves: [
          { at: 1.5, rect: [94, 294, 312, 32] },
          { at: 2, rect: [94, 244, 312, 32] },
          { at: 2.5, rect: [94, 194, 312, 32] },
        ],
        kind: 'key',
        label: 'Key',
      },
    ]);
  });

  it('makes one mask of a key in a NAME=value line, named for the key, and masks the person\'s words', () => {
    const frames = [frame(1, line('GITHUB_TOKEN=ghp_1234567890abcdefghijklmnop', 100, 400), line('Thanks, Lena Müller', 100, 500)), frame(1.5), frame(2)];
    const masks = privacyMasks(frames, ['Lena Müller'], screen);
    expect(masks.map((mask) => [mask.label, mask.rect])).toEqual([
      ['Key', [94, 394, 442, 32]],
      ['Always masked', [174, 494, 122, 32]],
    ]);
  });
});
