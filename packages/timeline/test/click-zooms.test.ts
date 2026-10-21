import { describe, expect, it } from 'vitest';
import type { InputEvent } from '@cuttle/project';
import { clickZooms, minZoomWidth, shownClicks, zoomRectFor } from '../src/click-zooms';

const screen = { width: 1920, height: 1080 };
const click = (t: number, x: number, y: number, button: 'left' | 'right' = 'left'): InputEvent => ({ t, type: 'click', x, y, button });
const whole = [{ from: 0, to: 60, speed: 1, start: 0 }];

describe('zooms on clicks', () => {
  it('zooms in on one click: from just before it, around it, in the screen’s shape', () => {
    const [zoom, ...rest] = clickZooms([click(10, 960, 540)], whole, screen);
    expect(rest).toEqual([]);
    expect(zoom).toMatchObject({ at: 9.3, duration: 2.7, clicks: 1 });
    // at least 45 % of the width, centred on the click, 16:9
    expect(zoom!.rect).toEqual([528, 297, 864, 486]);
  });

  it('follows a burst of clicks in one spot with one zoom that lasts until the last', () => {
    const zooms = clickZooms([click(10, 400, 300), click(11, 450, 320), click(12.5, 520, 360), click(14, 480, 340)], whole, screen);
    expect(zooms).toHaveLength(1);
    expect(zooms[0]).toMatchObject({ at: 9.3, duration: 6.7, clicks: 4 });
    const [x, y, width, height] = zooms[0]!.rect;
    for (const [cx, cy] of [[400, 300], [520, 360]]) {
      expect(cx! >= x && cx! <= x + width && cy! >= y && cy! <= y + height).toBe(true);
    }
  });

  it('moves along to clicks elsewhere soon after, and starts another zoom once the work rests a while', () => {
    const zooms = clickZooms([click(10, 200, 200), click(11, 1700, 900), click(20, 1700, 900)], whole, screen);
    // the click at 11 s is elsewhere: the first zoom moves there in time for it; the one at 20 s gets its own
    expect(zooms.map((zoom) => zoom.at)).toEqual([9.3, 19.3]);
    expect(zooms[0]!.moves).toHaveLength(1);
    expect(zooms[0]!.moves![0]!.at).toBe(10.3);
    expect(zooms[0]!.clicks).toBe(2);
    expect(zooms[1]!.moves).toBeUndefined();
  });

  it('follows the work across the screen: every click is in view when it happens', () => {
    // first in the middle, then 4 s later far right (once too soon for a zoom of its own), then lower left
    const clicks = [click(10, 960, 540), click(14, 1750, 300), click(17, 300, 900)];
    const [zoom, ...rest] = clickZooms(clicks, whole, screen);
    expect(rest).toEqual([]);
    expect(zoom!.moves!.map((move) => move.at)).toEqual([13.3, 16.3]);
    expect(zoom!.at + zoom!.duration).toBeCloseTo(19, 6);
    // the view the zoom shows at each click holds it (each move is there 0.2 s before its click)
    const views = [zoom!.rect, ...zoom!.moves!.map((move) => move.rect)];
    clicks.forEach((each, index) => {
      const [x, y, width, height] = views[index]!;
      expect(each.type === 'click' && each.x >= x && each.x <= x + width && each.y >= y && each.y <= y + height).toBe(true);
    });
  });

  it('keeps zooms out of waiting that is sped up, away from cuts, and off right clicks', () => {
    const clips = [
      { from: 0, to: 10, speed: 1, start: 0 },
      { from: 10, to: 40, speed: 8, start: 10 },
      { from: 40, to: 60, speed: 1, start: 13.75 },
    ];
    expect(clickZooms([click(20, 500, 500), click(30, 500, 500, 'right')], clips, screen)).toEqual([]);
    // a click right after a cut: the zoom starts a second into the clip
    expect(clickZooms([click(40.2, 500, 500)], clips, screen)[0]!.at).toBe(41);
    // a clip too short to zoom in and out without touching a cut
    expect(clickZooms([click(5, 500, 500)], [{ from: 4, to: 7, speed: 1, start: 0 }], screen)).toEqual([]);
  });

  it('makes one zoom of neighbours that show nearly the same spot', () => {
    // 3.2 s apart (not one cluster), the same spot: the second zoom would start 0.5 s after the first ends
    const zooms = clickZooms([click(10, 800, 500), click(13.2, 820, 510)], whole, screen);
    expect(zooms).toHaveLength(1);
    expect(zooms[0]).toMatchObject({ at: 9.3, clicks: 2 });
    expect(zooms[0]!.duration).toBeCloseTo(5.9, 6);
  });

  it('follows two clicks far apart at once with one zoom that moves, and never zooms over another zoom', () => {
    // clicks spread over most of the screen within 3 s: two clusters (too wide for one), one zoom moving between them
    const apart = clickZooms([click(10, 100, 100), click(10.5, 1800, 1000)], whole, screen);
    expect(apart).toHaveLength(1);
    expect(apart[0]!.moves).toHaveLength(1);
    expect(clickZooms([click(10, 960, 540)], whole, screen, [{ at: 9, duration: 4 }])).toEqual([]);
  });

  it('spaces zooms out as the video shows them: scenes moved out of source order, the zooms already there', () => {
    // the second half of the take plays first: the clicks at 9 s and 3 s are 6 output seconds apart
    const moved = [
      { from: 6, to: 12, speed: 1, start: 0 },
      { from: 0, to: 6, speed: 1, start: 6 },
    ];
    expect(clickZooms([click(3, 500, 500), click(9, 500, 500)], moved, screen).map((zoom) => zoom.at)).toEqual([8.3, 2.3]);
    // a zoom already there starting 2.7 output seconds after: no click zoom just before it
    expect(clickZooms([click(10, 960, 540)], whole, screen, [{ at: 12, duration: 3 }])).toEqual([]);
  });

  it('times a zoom in output seconds: at 2× it covers twice the source', () => {
    const [zoom] = clickZooms([click(20, 960, 540)], [{ from: 0, to: 60, speed: 2, start: 0 }], screen);
    expect(zoom).toMatchObject({ at: 18.6, duration: 5.4 });
  });

  it('leaves clicks under a zoom there to it, and ends the zoom before it the moment that one starts', () => {
    // the click at 32.5 s is under the answer zoom: the three before it keep their zoom, cut short at 31.5 s
    const answer = [{ at: 31.5, duration: 4 }];
    const zooms = clickZooms([click(25, 500, 500), click(27.5, 520, 510), click(30.5, 540, 500), click(32.5, 520, 500)], whole, screen, answer);
    expect(zooms).toEqual([expect.objectContaining({ at: 24.3, duration: 7.2, clicks: 3 })]);
    expect([shownClicks([click(25, 0, 0), click(32.5, 0, 0), click(70, 0, 0)], whole), shownClicks([click(25, 0, 0), click(32.5, 0, 0)], whole, answer)]).toEqual([2, 1]);
  });

  it('merges neighbours only while their clicks still fit one zoom, and moves along past that', () => {
    // two clicks 600 px apart, then a third 180 px past the right one: nearly the same spot, but too wide together
    const zooms = clickZooms([click(10, 100, 540), click(11, 700, 540), click(14.3, 880, 540)], whole, screen);
    expect(zooms.map((zoom) => [zoom.clicks, zoom.moves?.length ?? 0])).toEqual([[3, 1]]);
  });

  it('starts a chain at a later station when its start is too near another zoom\'s: the work after is still followed', () => {
    // a zoom there from 0 to 3 s; clicks at 4 s top left, then soon after at 7.5 s bottom right
    const events = [click(4, 200, 200), click(7.5, 1600, 850)];
    // alone, one zoom starts at 3.3 s and moves on at 6.8 s
    expect(clickZooms(events, whole, screen).map((zoom) => [zoom.at, zoom.moves?.length ?? 0])).toEqual([[3.3, 1]]);
    // 3.3 s is too near the start of the zoom there (0 s): it starts at the bottom right instead of not at all
    const [zoom, ...rest] = clickZooms(events, whole, screen, [{ at: 0, duration: 3 }]);
    expect(rest).toEqual([]);
    expect(zoom).toMatchObject({ at: 6.8, clicks: 1, rect: zoomRectFor({ left: 1600, top: 850, right: 1600, bottom: 850 }, screen) });
    expect(zoom).not.toHaveProperty('moves');
  });

  it('keeps a zoom on the screen at its edge', () => {
    expect(zoomRectFor({ left: 1900, top: 1070, right: 1910, bottom: 1075 }, screen)).toEqual([1056, 594, 864, 486]);
  });

  it('shows as much of the interface on a scaled display as on a 1920-pixel screen at 100 %', () => {
    // a take that says no scale, and a 1920-pixel screen at 100 %: 45 % of the width, as before
    expect(minZoomWidth(screen)).toBe(864);
    expect(minZoomWidth({ ...screen, scale: 1 })).toBe(864);
    // a Retina Mac (1440 × 900 points): 860 points, not 45 % of its 1440 (2.2× deeper into its larger interface)
    const retina = { width: 2880, height: 1800, scale: 2 };
    expect(minZoomWidth(retina)).toBe(1720);
    expect(zoomRectFor({ left: 1400, top: 900, right: 1410, bottom: 905 }, retina)).toEqual([545, 365, 1720, 1075]);
    // a laptop at 150 % (1280 points across): 860 points would be 1290 pixels, a zoom of 1.49×, so
    // 1.5× instead; a share of it scales the points along (the answer's 35 %)
    expect(minZoomWidth({ width: 1920, height: 1080, scale: 1.5 })).toBe(1280);
    expect(minZoomWidth({ width: 1920, height: 1080, scale: 1.5 }, 0.35)).toBeCloseTo(1003.3, 1);
    // a window on a Retina display narrower than 860 points × 1.5: still 1.5× deep
    expect(minZoomWidth({ width: 1968, height: 1332, scale: 2 })).toBe(1312);
    expect(minZoomWidth({ width: 1200, height: 800, scale: 2 })).toBe(800);
  });

  it('holds still while the clicks it follows stay in the middle of its view', () => {
    // 4.5 s apart: a zoom each, too far apart to merge, near enough to follow; the second click is
    // 150 px below the first, well inside the view: no move (it used to nod down and up)
    const [zoom, ...rest] = clickZooms([click(10, 960, 300), click(14.5, 1000, 450), click(19, 940, 320)], whole, screen);
    expect(rest).toEqual([]);
    expect(zoom).toMatchObject({ at: 9.3, clicks: 3, rect: zoomRectFor({ left: 960, top: 300, right: 960, bottom: 300 }, screen) });
    expect(zoom).not.toHaveProperty('moves');
    expect(zoom!.at + zoom!.duration).toBeCloseTo(21, 6);
  });

  it('moves for a click near the edge of its view, but not where the screen ends', () => {
    // 350 px right of the first click: outside the middle 70 % of the 864-pixel view
    expect(clickZooms([click(10, 960, 540), click(14.5, 1310, 540)], whole, screen)[0]!.moves).toHaveLength(1);
    // at the right edge the view cannot go further right: no move
    expect(clickZooms([click(10, 1850, 540), click(14.5, 1912, 540)], whole, screen)[0]).not.toHaveProperty('moves');
  });
});
