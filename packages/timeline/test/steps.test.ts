import { describe, expect, it } from 'vitest';
import type { InputEvent, Marker } from '@cuttle/project';
import { zoomRectFor } from '../src/click-zooms';
import { shownFrom, stepMoves, stepZooms } from '../src/steps';

const script = [
  { id: 'step1', title: 'Open the settings' },
  { id: 'step2', title: 'Turn on dark mode' },
  { id: 'step3', title: 'Export the video' },
];
const at = (...moves: [number, string][]): Marker[] => moves.map(([t, label]) => ({ t, kind: 'step', label }));
const screen = { width: 1920, height: 1080 };
const click = (t: number, x: number, y: number): InputEvent => ({ t, type: 'click', x, y, button: 'left' });
const caret = (t: number, x: number, y: number): InputEvent => ({ t, type: 'caret', rect: [x, y, 2, 20] });
const whole = [{ from: 0, to: 60, speed: 1, start: 0 }];

describe('stepMoves', () => {
  it('lists where the take reached each step, with its number; a slip, a step the script lost and a move to the step it is at are none', () => {
    const markers = at([0, 'step1'], [10, 'step2'], [20, 'step3'], [21, 'step2'], [22, 'step3'], [30, 'step9'], [31, 'step3'], [40, 'step2']);
    expect(stepMoves(script, markers).map((move) => [move.t, move.number, move.step.title])).toEqual([
      [0, 1, 'Open the settings'],
      [10, 2, 'Turn on dark mode'],
      [22, 3, 'Export the video'],
      [40, 2, 'Turn on dark mode'],
    ]);
    expect(stepMoves([], markers)).toEqual([]);
  });
});

describe('shownFrom', () => {
  it('is the second itself where a clip shows it, else where the clip after it begins', () => {
    const clips = [
      { from: 2, to: 10 },
      { from: 20, to: 30 },
    ];
    expect([shownFrom(clips, 5), shownFrom(clips, 0), shownFrom(clips, 12), shownFrom(clips, 31)]).toEqual([5, 2, 20, undefined]);
  });
});

describe('stepZooms', () => {
  it('zooms on where each step happens: its clicks and typing, from just before the first to after the last, before the next step', () => {
    const moves = stepMoves(script, at([0, 'step1'], [10, 'step2'], [20, 'step3']));
    const events = [click(2, 400, 300), click(3, 520, 360), caret(12, 1500, 800), caret(13, 1560, 800), click(30, 900, 500)];
    const zooms = stepZooms(moves, events, whole, screen);
    expect(zooms.map((zoom) => [zoom.at, zoom.duration, zoom.move.number])).toEqual([
      [1.4, 3.1, 1],
      [11.4, 3.1, 2],
    ]);
    expect(zooms[0]!.rect).toEqual(zoomRectFor({ left: 400, top: 300, right: 520, bottom: 360 }, screen));
    expect(zooms[1]!.rect).toEqual(zoomRectFor({ left: 1500, top: 800, right: 1562, bottom: 820 }, screen));
  });

  it('ends at the next step, waits for a step the video trims, and makes none without actions, sped up, or where another zoom is', () => {
    const moves = stepMoves(script, at([0, 'step1'], [5, 'step2'], [20, 'step3']));
    // step 1's click at 4.5 s: its zoom ends at step 2 (5 s), however short the tail
    expect(stepZooms(moves.slice(0, 2), [click(4.5, 900, 500)], whole, screen).map((zoom) => [zoom.at, zoom.duration])).toEqual([[3.9, 1.1]]);
    // the video starts at 2 s: step 1 is looked for from there
    expect(stepZooms(moves.slice(0, 1), [click(1, 900, 500), click(3, 900, 500)], [{ from: 2, to: 60, speed: 1, start: 0 }], screen).map((zoom) => zoom.at)).toEqual([2.4]);
    // sped up 8×: none; a zoom there already: none
    expect(stepZooms(moves.slice(0, 1), [click(2, 900, 500)], [{ from: 0, to: 60, speed: 8, start: 0 }], screen)).toEqual([]);
    expect(stepZooms(moves.slice(0, 1), [click(2, 900, 500)], whole, screen, [{ at: 1, duration: 2 }])).toEqual([]);
    expect(stepZooms(moves, [], whole, screen)).toEqual([]);
  });
});
