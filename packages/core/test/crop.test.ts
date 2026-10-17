import { describe, expect, it } from 'vitest';
import type { InputEvent, Rect } from '@cuttle/project';
import type { ClipSpan } from '@cuttle/timeline';
import { areaStretches, bandCrop, cropOf, cropPieces } from '../src/suggest/crop';
import { dialogZooms } from '../src/suggest/dialogs';

const screen = { width: 2560, height: 1440 };
const area = (t: number, rect: Rect | null): InputEvent => ({ t, type: 'area', rect });
const page: Rect = [65, 147, 2495, 1233];

describe('cropOf', () => {
  it('takes the part inside the screen, unless it is (nearly) all of it, too little, or elsewhere', () => {
    expect(cropOf(page, screen)).toEqual(page);
    expect(cropOf([60, 140, 2510, 1320], screen)).toEqual([60, 140, 2500, 1300]);
    expect(cropOf([0, 20, 2560, 1420], screen)).toBeUndefined();
    expect(cropOf([100, 100, 800, 600], screen)).toBeUndefined();
    // on the monitor to the left
    expect(cropOf([-1900, 100, 1800, 1000], screen)).toBeUndefined();
    expect(cropOf(null, screen)).toBeUndefined();
  });
});

describe('areaStretches', () => {
  it('holds the content area from the start, one within 8 px is the same, and a short one belongs to the stretch before', () => {
    const events = [area(0.4, page), area(3, [66, 149, 2493, 1231]), area(10, [700, 300, 1400, 900]), area(10.5, page), area(20, null)];
    expect(areaStretches(events, 30, screen)).toEqual([
      { from: 0, to: 20, rect: page },
      { from: 20, to: 30 },
    ]);
  });

  it('gives none without area events', () => {
    expect(areaStretches([{ t: 1, type: 'keys', count: 2 }], 30, screen)).toEqual([]);
  });
});

describe('cropPieces', () => {
  it('cuts a clip where the crop changes inside it, and gives a short piece to its neighbour', () => {
    const stretches = [{ from: 0, to: 12, rect: page }, { from: 12, to: 12.3 }, { from: 12.3, to: 30 }];
    const clips = [{ from: 2, to: 8, speed: 1 }, { from: 9, to: 25, speed: 4 }];
    expect(cropPieces(clips, stretches).map(({ clip, ...piece }) => [clip.speed, piece])).toEqual([
      [1, { from: 2, to: 8, rect: page }],
      [4, { from: 9, to: 12.3, rect: page }],
      [4, { from: 12.3, to: 25 }],
    ]);
    expect(cropPieces(clips, [])).toEqual(clips.map((clip) => ({ clip, from: clip.from, to: clip.to })));
  });
});

describe('bandCrop', () => {
  /** 64 rows × 128 columns: the middle changes, the edge bands not. */
  const bands = (top: number, bottom: number, left: number, right: number, middle = 0.2) => ({
    rows: Array.from({ length: 64 }, (_, y) => (y < top || y >= 64 - bottom ? 0.001 * middle : middle)),
    cols: Array.from({ length: 128 }, (_, x) => (x < left || x >= 128 - right ? 0.001 * middle : middle)),
    frames: 24,
  });

  it('leaves out the edges that hardly change while the middle does', () => {
    // a browser: tabs and bars at the top, a taskbar at the bottom, a side bar on the left
    expect(bandCrop(bands(7, 3, 3, 0), screen)).toEqual([60, 158, 2500, 1215]);
  });

  it('gives none when the middle hardly changes, when nothing is still, or when too little is left', () => {
    expect(bandCrop(bands(7, 3, 3, 0, 0.001), screen)).toBeUndefined();
    expect(bandCrop(bands(0, 0, 0, 0), screen)).toBeUndefined();
    expect(bandCrop(bands(25, 25, 0, 0), screen)).toBeUndefined();
  });
});

describe('dialogZooms', () => {
  const clips: ClipSpan[] = [{ from: 0, to: 20, speed: 1, start: 0 }, { from: 20, to: 40, speed: 8, start: 20 }];
  const dialog = (t: number, open: boolean, id = 5, rect: Rect = [900, 500, 760, 420]): InputEvent => ({ t, type: 'window', id, kind: 'dialog', rect, open });

  it('zooms on a dialog open a second or more, from just before it opens to just after it closes', () => {
    // padded by 15 % of its width, in the screen's shape: the dialog fills two thirds of the view
    expect(dialogZooms([dialog(5, true), dialog(9, false)], clips, screen)).toEqual([{ at: 4.7, duration: 4.6, rect: [704, 386, 1152, 648] }]);
  });

  it('leaves out a short one, a menu, one on another monitor, one in sped-up waiting, and one under another zoom', () => {
    expect(dialogZooms([dialog(5, true), dialog(5.5, false)], clips, screen)).toEqual([]);
    expect(dialogZooms([{ t: 5, type: 'window', id: 6, kind: 'menu', rect: [900, 500, 200, 300], open: true }], clips, screen)).toEqual([]);
    expect(dialogZooms([dialog(5, true, 7, [-1200, 500, 760, 420])], clips, screen)).toEqual([]);
    expect(dialogZooms([dialog(25, true), dialog(35, false)], clips, screen)).toEqual([]);
    expect(dialogZooms([dialog(5, true), dialog(9, false)], clips, screen, [{ at: 8, duration: 3 }])).toEqual([]);
  });

  it('lasts to its clip\'s end when it never closed', () => {
    expect(dialogZooms([dialog(17, true)], clips, screen)).toEqual([{ at: 16.7, duration: 3.3, rect: [704, 386, 1152, 648] }]);
  });
});
