import { describe, expect, it } from 'vitest';
import type { InputEvent } from '@cuttle/project';
import type { ClipSpan } from '@cuttle/timeline';
import { keyBursts, screenStretches, typingZooms, type ScreenChange, type TypingInput } from '../src/suggest/typing';

const keys = (from: number, to: number, step = 0.5): InputEvent[] => {
  const events: InputEvent[] = [];
  for (let t = from; t < to - 1e-9; t += step) events.push({ t: Math.round(t * 1000) / 1000, type: 'keys', count: 2 });
  return events;
};
/** The caret moving right along a line, 50 px every half second from `x` at `from`. */
const typedLine = (from: number, count: number, x: number, y: number): InputEvent[] =>
  Array.from({ length: count }, (_, k) => ({ t: Math.round((from + 0.5 * k) * 1000) / 1000, type: 'caret', rect: [x + 50 * k, y, 2, 20] }));
const clip = (from: number, to: number, speed = 1, start = from): ClipSpan => ({ from, to, speed, start });
// a 1000×500 screen: the view is 450×225, the middle 60 % of it 270×135
const screen = { width: 1000, height: 500 };
const input = (over: Partial<TypingInput>): TypingInput => ({ events: [], clips: [clip(0, 30)], screen, avoid: [], changes: [], ...over });

describe('keyBursts', () => {
  it('makes one burst of keys with pauses under 1.5 s, joins bursts 3 s apart, and drops short ones', () => {
    const clips = [clip(0, 60)];
    expect(keyBursts([...keys(2, 5), ...keys(6.5, 8)], clips)).toEqual([{ clip: 0, from: 2, to: 8 }]);
    // 5 s apart: two bursts; 1 s of typing: none
    expect(keyBursts([...keys(2, 5), ...keys(10, 12), ...keys(20, 21)], clips)).toEqual([
      { clip: 0, from: 2, to: 5 },
      { clip: 0, from: 10, to: 12 },
    ]);
  });

  it('keeps bursts inside their clip, and leaves out sped-up waiting', () => {
    expect(keyBursts(keys(2, 8), [clip(0, 4), clip(4, 20)])).toEqual([
      { clip: 0, from: 2, to: 4 },
      { clip: 1, from: 4, to: 8 },
    ]);
    expect(keyBursts(keys(2, 8), [clip(0, 20, 4)])).toEqual([]);
  });
});

describe('typingZooms', () => {
  it('follows the caret: lead room to the right, and a move once the text leaves the middle', () => {
    // typing from 10 to 15 s; the caret's middle goes from x 101 to 551 on the line at y 250
    const events = [...keys(10, 15), ...typedLine(10.2, 10, 100, 240)];
    // the first second (x 101 to 201, middle 151) sits 35 % into the view: x 151 − 157.5 → 0 (the screen's edge)
    // at 13.2 s the caret (401) has left the middle (225 ± 135): the view moves so it is 35 % in again
    expect(typingZooms(input({ events }))).toEqual([
      { at: 9.3, duration: 7.7, rect: [0, 138, 450, 225], moves: [{ at: 13.2, rect: [244, 138, 450, 225] }], follows: 'caret' },
    ]);
  });

  it('shows as much of the interface on a scaled display: 860 points across at least, but 1.5× deep', () => {
    const events = [...keys(10, 15), ...typedLine(10.2, 10, 100, 240)];
    // at 2 pixels a point the 1000-pixel screen is 500 points across, less than 860: a view of two
    // thirds of it (1.5×), where a view of all of it would be no zoom
    expect(typingZooms(input({ events, screen: { ...screen, scale: 2 } }))[0]?.rect.slice(2)).toEqual([667, 333]);
    // a 3000-pixel screen at 2 (1500 points): 1720 pixels, not 45 % of 3000
    const wide = { width: 3000, height: 1500, scale: 2 };
    const [zoom] = typingZooms(input({ events, screen: wide }));
    expect(zoom?.rect.slice(2)).toEqual([1720, 860]);
  });

  it('goes back left and down for the next line, at most one move in 0.8 s', () => {
    const events = [...keys(10, 17), ...typedLine(10.2, 10, 100, 240), { t: 15.1, type: 'caret', rect: [100, 290, 2, 20] }, { t: 15.4, type: 'caret', rect: [150, 290, 2, 20] }] as InputEvent[];
    const [zoom] = typingZooms(input({ events }));
    expect(zoom?.moves).toEqual([
      { at: 13.2, rect: [244, 138, 450, 225] },
      // x 101 is left of the middle: the view goes back to the screen's edge, and centres on y 300
      { at: 15.1, rect: [0, 188, 450, 225] },
    ]);
  });

  it('follows what the screen changes where there is no caret, and leaves out a scroll', () => {
    const changes: ScreenChange[] = [
      ...Array.from({ length: 10 }, (_, k) => ({ t: 10.5 + 0.5 * k, box: { x: 80 + 50 * k, y: 240, width: 40, height: 20 } })),
      { t: 12.5, box: { x: 0, y: 0, width: 1000, height: 500 } },
    ];
    const [zoom] = typingZooms(input({ events: keys(10, 15), changes }));
    expect(zoom).toMatchObject({ at: 9.3, follows: 'screen', rect: [0, 138, 450, 225] });
    // the change's middle (x 100 + 50 k) leaves the middle at 13.5 s (x 400)
    expect(zoom?.moves).toEqual([{ at: 13.5, rect: [243, 138, 450, 225] }]);
  });

  it('makes none without anything to follow, over another zoom, near another zoom start, or in sped-up waiting', () => {
    expect(typingZooms(input({ events: keys(10, 15) }))).toEqual([]);
    const events = [...keys(10, 15), ...typedLine(10.2, 10, 100, 240)];
    expect(typingZooms(input({ events, avoid: [{ at: 8, duration: 4 }] }))).toEqual([]);
    expect(typingZooms(input({ events, avoid: [{ at: 5, duration: 1 }] }))).toEqual([]);
    expect(typingZooms(input({ events, clips: [clip(0, 30, 4)] }))).toEqual([]);
    // a zoom after it: the typing zoom ends where it starts
    expect(typingZooms(input({ events, avoid: [{ at: 15.5, duration: 3 }] }))[0]).toMatchObject({ at: 9.3, duration: 6.2 });
  });

  it('reads the screen only around bursts without a caret on it', () => {
    const offScreen: InputEvent = { t: 21, type: 'caret', rect: [-400, 240, 2, 20] };
    const events = [...keys(10, 15), ...typedLine(10.2, 10, 100, 240), ...keys(20, 23), offScreen];
    expect(screenStretches(events, [clip(0, 30)], screen)).toEqual([{ from: 19.5, to: 23.5 }]);
  });
});
