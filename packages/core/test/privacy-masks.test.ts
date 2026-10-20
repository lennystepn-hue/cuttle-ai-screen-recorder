import { describe, expect, it } from 'vitest';
import type { ScreenTextFrame, ScreenTextLine } from '@cuttle/project';
import type { Stretch } from '../src/privacy/follow';
import { privacyMasks, trackName, trackSecrets } from '../src/privacy/masks';

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

  it('follows a key that scrolls through frames the OCR misread it in (a 0 read as @): one mask, the key', () => {
    const token = (y: number, text = 'ghp_1234567890abcdefghijklmnop') => line(`export GITHUB_TOKEN=${text}`, 100, y);
    const slip = 'ghp_123456789@abcdefghijklmnop';
    // read with the slip, the key's prefix is too short to be a key: only the NAME=value rule finds it there
    const frames = [frame(1, token(400)), frame(1.5, token(384)), frame(2, token(368, slip)), frame(2.5, token(352, slip)), frame(3, token(336)), frame(3.5, token(320)), frame(4), frame(5)];
    const masks = privacyMasks(frames, [], screen);
    expect(masks.map((mask) => [mask.kind, mask.from, mask.to])).toEqual([['key', 0.5, 4]]);
    // where it is drawn holds the text in every frame
    const at = (t: number) => masks[0]!.moves!.filter((move) => move.at <= t).at(-1)?.rect ?? masks[0]!.rect;
    for (const [t, y] of [[2, 368], [2.5, 352]] as const) {
      const next = masks[0]!.moves!.find((move) => move.at > t)?.rect;
      const top = Math.min(at(t)[1], next?.[1] ?? Infinity);
      expect(top, String(t)).toBeLessThanOrEqual(y);
    }
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

  it('makes a mask for each stretch a track was followed on screen, with a place where it moved and the last one before', () => {
    const key = (y: number) => line('ghp_1234567890abcdefghijklmnop', 100, y);
    const frames = [frame(1, key(300)), frame(1.5, key(300)), frame(2, key(200)), frame(2.5), frame(3), frame(6, key(500)), frame(6.5), frame(7)];
    const [track] = trackSecrets(frames, []).tracks;
    const at = (t: number, y: number) => ({ at: t, rect: [100, y, 300, 20] as [number, number, number, number] });
    // still from 1 s, up 50 px a frame from 1.9 s, out at the top at 2.2 s; in again at the bottom at 5.8 s
    const stretches: Stretch[] = [
      { from: 0.5, to: 2.2, places: [at(1, 300), at(1.5, 300), at(1.833, 300), at(1.867, 300), at(1.9, 250), at(1.933, 200), at(1.967, 200), at(2, 200), at(2.033, 150), at(2.067, 100), at(2.1, 50), at(2.133, 0)] },
      { from: 5.8, to: 7, places: [at(5.833, 1060), at(5.867, 1010), at(5.9, 500), at(6, 500)] },
    ];
    expect(privacyMasks(frames, [], screen, 10, undefined, new Map([[trackName(track!), stretches]]))).toEqual([
      {
        from: 0.5,
        to: 2.2,
        rect: [94, 294, 312, 32],
        // still until 1.867 s (its last place there kept), then a place in each frame it moved
        moves: [
          { at: 1.867, rect: [94, 294, 312, 32] },
          { at: 1.9, rect: [94, 244, 312, 32] },
          { at: 1.933, rect: [94, 194, 312, 32] },
          { at: 2, rect: [94, 194, 312, 32] },
          { at: 2.033, rect: [94, 144, 312, 32] },
          { at: 2.067, rect: [94, 94, 312, 32] },
          { at: 2.1, rect: [94, 44, 312, 32] },
          { at: 2.133, rect: [94, 0, 312, 26] },
        ],
        kind: 'key',
        label: 'Key',
      },
      { from: 5.8, to: 7, rect: [94, 1054, 312, 26], moves: [{ at: 5.867, rect: [94, 1004, 312, 32] }, { at: 5.9, rect: [94, 494, 312, 32] }], kind: 'key', label: 'Key' },
    ]);
  });

  it('leaves out a place the two around it hold within its room', () => {
    const frames = [frame(1, line('ghp_1234567890abcdefghijklmnop', 100, 300)), frame(2), frame(2.5)];
    const [track] = trackSecrets(frames, []).tracks;
    // a slow drift, 2 px a frame: a place every third frame (6 px)
    const places = Array.from({ length: 10 }, (_, k) => ({ at: Math.round((1 + k / 30) * 1000) / 1000, rect: [100, 300 - 2 * k, 300, 20] as [number, number, number, number] }));
    const [mask] = privacyMasks(frames, [], screen, 10, undefined, new Map([[trackName(track!), [{ from: 0.5, to: 2, places }]]]));
    expect(mask!.moves!.map((move) => [move.at, move.rect[1]])).toEqual([
      [1.1, 288],
      [1.2, 282],
      [1.3, 276],
    ]);
  });

  it('joins the masks of two rules over the same text where both show it, and grows neither where the other does not', () => {
    // a key from 1 s on, up 100 px at 2.9 s; its text read as a random-looking string only at 3 s
    const key = (y: number, text = 'ghp_1234567890abcdefghijklmnop') => line(`token ${text}`, 100, y);
    const frames = [frame(1, key(300)), frame(2, key(300)), frame(3, key(200, 'Zx9Kq2Lm7Np4Rt8Vw3Yb6Cd1Fg5Hj0')), frame(3.5), frame(4), frame(5)];
    const { tracks } = trackSecrets(frames, []);
    expect(tracks.map((track) => track.kind)).toEqual(['key', 'random']);
    const places = (t: number, y: number) => ({ at: t, rect: [160, y, 300, 20] as [number, number, number, number] });
    const followed = new Map<string, Stretch[]>([
      [trackName(tracks[0]!), [{ from: 0.5, to: 3.5, places: [places(1, 300), places(2.867, 300), places(2.9, 200)] }]],
      [trackName(tracks[1]!), [{ from: 2.9, to: 3.5, places: [places(2.9, 200)] }]],
    ]);
    expect(privacyMasks(frames, [], screen, Infinity, undefined, followed)).toEqual([
      { from: 0.5, to: 3.5, rect: [154, 294, 312, 32], moves: [{ at: 2.867, rect: [154, 294, 312, 32] }, { at: 2.9, rect: [154, 194, 312, 32] }], kind: 'key', label: 'Key' },
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
