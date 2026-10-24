import { describe, expect, it } from 'vitest';
import { DRAWER, ISLAND, drawerNext, drawerPlace, drawerZone, islandRect, springAt, springEasing, type DrawerDisplay, type DrawerInput, type DrawerState } from '../src/shared/drawer';

// a MacBook with a notch, and a display beside it without one (its menu bar 25 points high)
const laptop: DrawerDisplay = { id: 1, bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 38, width: 1512, height: 944 }, notch: { width: 200, height: 38 } };
const monitor: DrawerDisplay = { id: 2, bounds: { x: 1512, y: 0, width: 1920, height: 1080 }, workArea: { x: 1512, y: 25, width: 1920, height: 1055 } };
const displays = [laptop, monitor];
const SIZE = { width: 440, height: 64 };
const place = (display: DrawerDisplay) => drawerPlace(display, SIZE, true).window;

/** The drawer after the pointer was at each of `steps` (`[ms, x, y]`, a button held with `down`). */
function run(steps: [number, number, number, ('down' | 'keep')?][], from: DrawerState = { phase: 'closed' }) {
  let state = from;
  const actions: string[] = [];
  for (const [now, x, y, flag] of steps) {
    const input: DrawerInput = { now, pointer: { x, y }, buttons: flag === 'down', displays, keep: flag === 'keep' };
    const next = drawerNext(state, input, place);
    state = next.state;
    if (next.action) actions.push(next.action === 'close' ? 'close' : `open ${next.action.open.id}`);
  }
  return { state, actions };
}

describe('the drawer at the top centre', () => {
  it('opens from the notch, or from the middle of the top edge where there is none', () => {
    expect(drawerZone(laptop)).toEqual({ x: 656, y: 0, width: 200, height: 38 });
    expect(drawerZone(monitor)).toEqual({ x: 1512 + 860, y: 0, width: 200, height: DRAWER.zoneDepth });
    // over the notch: at the top of the screen, the notch's height above the drawer
    expect(drawerPlace(laptop, SIZE, true)).toEqual({ window: { x: 536, y: 0, width: 440, height: 38 + 64 }, origin: 'notch' });
    // without one: under the menu bar on a Mac, under a taskbar at the top on Windows
    expect(drawerPlace(monitor, SIZE, true)).toEqual({ window: { x: 1512 + 740, y: 25, width: 440, height: 64 }, origin: 'bar' });
    expect(drawerPlace(monitor, SIZE, false).origin).toBe('edge');
  });

  it('opens once the pointer rests on the zone, not when it passes over it or a button is held', () => {
    expect(run([[0, 756, 0], [100, 756, 1], [260, 760, 0]]).actions).toEqual(['open 1']);
    // on the way to a tab: gone again before the dwell
    expect(run([[0, 756, 0], [100, 756, 60], [400, 756, 60]]).actions).toEqual([]);
    // a window dragged to the top
    expect(run([[0, 756, 0, 'down'], [300, 756, 0, 'down'], [600, 756, 0, 'down']]).actions).toEqual([]);
    // the other display's middle, past the notch's width there is nothing
    expect(run([[0, 1512 + 960, 0], [300, 1512 + 960, 1]]).actions).toEqual(['open 2']);
    expect(run([[0, 400, 0], [300, 400, 0]]).actions).toEqual([]);
  });

  it('stays open while the pointer is on it or near it, and closes a moment after it left', () => {
    const open: DrawerState = { phase: 'open', display: 1, window: place(laptop) };
    expect(run([[0, 700, 80], [500, 980, 95], [1000, 700, 40]], open).actions).toEqual([]);
    // gone: closed after closeMs, not before
    expect(run([[0, 700, 400], [DRAWER.closeMs - 50, 700, 400]], open).actions).toEqual([]);
    expect(run([[0, 700, 400], [DRAWER.closeMs + 10, 700, 400]], open).actions).toEqual(['close']);
    // back on it in time: it stays
    expect(run([[0, 700, 400], [300, 700, 60], [1500, 700, 60]], open).state.phase).toBe('open');
    // its menu is open: it waits
    expect(run([[0, 700, 400, 'keep'], [2000, 700, 400, 'keep']], open).actions).toEqual([]);
  });

  it('stays a while when the tray or the start showed it, wherever the pointer is', () => {
    const shown: DrawerState = { phase: 'open', display: 1, window: place(laptop), until: 1000 + DRAWER.shownMs };
    expect(run([[1000, 700, 500], [1000 + DRAWER.shownMs - 100, 700, 500]], shown).actions).toEqual([]);
    expect(run([[1000 + DRAWER.shownMs, 700, 500], [1000 + DRAWER.shownMs + DRAWER.closeMs + 10, 700, 500]], shown).actions).toEqual(['close']);
  });
});

describe("the HUD's island during a take at the top edge", () => {
  it('sits beside the notch on both sides, or as a small pill under the menu bar', () => {
    expect(islandRect(laptop)).toEqual({ x: 656 - ISLAND.beside, y: 0, width: 200 + 2 * ISLAND.beside, height: 38 });
    expect(islandRect(monitor)).toEqual({ x: 1512 + Math.round((1920 - ISLAND.width) / 2), y: 25 + ISLAND.gap, width: ISLAND.width, height: ISLAND.height });
  });

  it('opens the HUD when the pointer rests on the island, and keeps it open while it is on the HUD', () => {
    const hud = (display: DrawerDisplay) => drawerPlace(display, { width: 552, height: 64 }, true).window;
    const step = (state: DrawerState, now: number, x: number, y: number) => drawerNext(state, { now, pointer: { x, y }, buttons: false, displays: [monitor], keep: false }, hud, islandRect);
    const island = islandRect(monitor);
    const resting = step({ phase: 'closed' }, 0, island.x + 10, island.y + 10);
    const opened = step(resting.state, DRAWER.dwellMs + 10, island.x + 10, island.y + 10);
    expect(opened.action).toEqual({ open: monitor });
    // the island is not the top edge's strip: resting on the edge above it opens nothing
    expect(step(step({ phase: 'closed' }, 0, island.x + 10, 0).state, 300, island.x + 10, 0).action).toBeUndefined();
    // on the HUD's buttons, past the island: it stays
    expect(step(opened.state, 1500, hud(monitor).x + 500, hud(monitor).y + 40).state.phase).toBe('open');
  });
});

describe("the drawer's spring", () => {
  it('goes a little past the end and settles there', () => {
    const curve = Array.from({ length: 101 }, (_, i) => springAt(i / 100, 0.7));
    expect(curve[0]).toBe(0);
    expect(Math.max(...curve)).toBeGreaterThan(1.03);
    expect(Math.max(...curve)).toBeLessThan(1.06);
    expect(Math.abs(curve[100]! - 1)).toBeLessThan(0.005);
    // without bounce it never passes the end
    expect(Math.max(...Array.from({ length: 101 }, (_, i) => springAt(i / 100, 1)))).toBeLessThanOrEqual(1);
    const easing = springEasing();
    expect(easing).toMatch(/^linear\(0, [\d., ]+, 1\)$/);
    expect(easing.split(',')).toHaveLength(49);
  });
});
