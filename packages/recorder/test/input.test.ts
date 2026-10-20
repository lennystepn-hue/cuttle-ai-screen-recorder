import { describe, expect, it } from 'vitest';
import { caretWatch, keyHandler, wheelInput, windowWatch } from '../src/input';
import type { HotkeyAction, RawInput } from '../src/types';

// Key codes as uiohook reports them: Ctrl 29, Shift 42, Alt 56, S 31, M 50, A 30.
const CTRL = 29;
const SHIFT = 42;
const ALT = 56;
const S = 31;
const M = 50;
const A = 30;

function keys() {
  const input: RawInput[] = [];
  const hotkeys: HotkeyAction[] = [];
  const handler = keyHandler(new Set([CTRL, SHIFT, ALT]), new Map<number, HotkeyAction>([[S, 'stop'], [M, 'marker']]), (event) => input.push(event), (action) => hotkeys.push(action));
  const all = { ctrlKey: true, shiftKey: true, altKey: true };
  const none = { ctrlKey: false, shiftKey: false, altKey: false };
  return { handler, input, hotkeys, all, none };
}

describe('keyHandler', () => {
  it('counts plain keys, not modifiers', () => {
    const { handler, input, none, all } = keys();
    handler.down({ keycode: A, ...none });
    handler.down({ keycode: CTRL, ...all });
    handler.down({ keycode: S, ...none }); // S without the modifiers is typing
    expect(input.map((event) => event.type)).toEqual(['key', 'key']);
  });

  it('turns Ctrl+Shift+Alt+S and +M into hotkeys that are not counted as keys', () => {
    const { handler, input, hotkeys, all } = keys();
    handler.down({ keycode: M, ...all });
    handler.up({ keycode: M, ...all });
    handler.down({ keycode: S, ...all });
    expect(hotkeys).toEqual(['marker', 'stop']);
    expect(input).toEqual([]);
  });

  it('triggers a held hotkey once until its key is released', () => {
    const { handler, hotkeys, all } = keys();
    for (let repeat = 0; repeat < 5; repeat++) handler.down({ keycode: M, ...all }); // auto-repeat
    handler.up({ keycode: M, ...all });
    handler.down({ keycode: M, ...all });
    expect(hotkeys).toEqual(['marker', 'marker']);
  });
});

describe('caretWatch', () => {
  it('reads the caret 5 times a second while keys come, and passes it on when it moved', () => {
    const seen: RawInput[] = [];
    let at = { x: 10, y: 20, width: 2, height: 18 };
    let reads = 0;
    const tick = caretWatch(() => (reads++, at), (input) => seen.push(input));
    // 30 reads a second: every 6th looks at the caret, while the last key is under a second old
    for (let i = 1; i <= 12; i++) tick(100 + i / 30, 100);
    expect(reads).toBe(2);
    expect(seen).toEqual([{ type: 'caret', time: 100 + 6 / 30, x: 10, y: 20, width: 2, height: 18 }]);
    at = { ...at, x: 30 };
    for (let i = 13; i <= 18; i++) tick(100 + i / 30, 100);
    expect(seen.at(-1)).toMatchObject({ x: 30 });
    // no key for over a second: no reads
    for (let i = 19; i <= 60; i++) tick(101.5 + i / 30, 100);
    expect(reads).toBe(3);
  });

  it('passes nothing where the app keeps no caret', () => {
    const seen: RawInput[] = [];
    const tick = caretWatch(() => undefined, (input) => seen.push(input));
    for (let i = 1; i <= 30; i++) tick(100 + i / 30, 100);
    expect(seen).toEqual([]);
  });
});

describe('windowWatch', () => {
  /** A desktop whose foreground window, content area and popups the test sets. */
  function desktop() {
    const state = {
      front: { id: 1, bounds: { x: 0, y: 0, width: 1000, height: 800 } } as { id: number; bounds: { x: number; y: number; width: number; height: number } } | undefined,
      area: { x: 10, y: 100, width: 980, height: 690 } as { x: number; y: number; width: number; height: number } | undefined,
      popups: [] as { id: number; kind: 'dialog' | 'menu'; bounds: { x: number; y: number; width: number; height: number } }[],
      areaReads: 0,
    };
    const win = {
      foreground: () => state.front,
      contentArea: () => (state.areaReads++, state.area),
      popups: () => state.popups,
    };
    return { state, win };
  }

  it('passes on the content area at once, when the window moves, and then once a second when it changed', () => {
    const { state, win } = desktop();
    const seen: RawInput[] = [];
    const tick = windowWatch(win, (input) => seen.push(input));
    let time = 0;
    const run = (reads: number) => {
      for (let i = 0; i < reads; i++) tick((time += 1 / 30));
    };
    run(1);
    expect(seen).toEqual([{ type: 'area', time: 1 / 30, rect: { x: 10, y: 100, width: 980, height: 690 } }]);
    // a second later, 1 px off: no change
    state.area = { x: 11, y: 100, width: 980, height: 690 };
    run(30);
    expect(seen).toHaveLength(1);
    // the window moves: the area is read at the next look at the windows
    state.front = { id: 1, bounds: { x: 200, y: 0, width: 1000, height: 800 } };
    state.area = { x: 210, y: 100, width: 980, height: 690 };
    run(8);
    expect(seen.at(-1)).toMatchObject({ type: 'area', rect: { x: 210 } });
    // a window without one: null
    state.front = { id: 2, bounds: { x: 0, y: 0, width: 500, height: 400 } };
    state.area = undefined;
    run(8);
    expect(seen.at(-1)).toMatchObject({ type: 'area', rect: null });
    expect(state.areaReads).toBeLessThan(8);
  });

  it("gives the content area as last read for a take's first events, also an area that stays", () => {
    const { state, win } = desktop();
    const watch = windowWatch(win, () => {});
    expect(watch.initial(0)).toEqual([]);
    // read before the take's first frame, and not passed on again while it stays
    watch(1 / 30);
    for (let i = 0; i < 60; i++) watch(1);
    expect(watch.initial(2)).toEqual([{ type: 'area', time: 2, rect: { x: 10, y: 100, width: 980, height: 690 } }]);
    // a window without one: none, so the take is not cropped from its picture
    state.front = { id: 2, bounds: { x: 0, y: 0, width: 500, height: 400 } };
    state.area = undefined;
    for (let i = 0; i < 8; i++) watch(3);
    expect(watch.initial(4)).toEqual([{ type: 'area', time: 4, rect: null }]);
  });

  it('passes on each dialog or menu as it opens and closes', () => {
    const { state, win } = desktop();
    const seen: RawInput[] = [];
    const tick = windowWatch(win, (input) => seen.push(input));
    const dialog = { id: 7, kind: 'dialog' as const, bounds: { x: 300, y: 200, width: 400, height: 300 } };
    tick(1);
    state.popups = [dialog];
    for (let i = 0; i < 8; i++) tick(2);
    state.popups = [];
    for (let i = 0; i < 8; i++) tick(3);
    expect(seen.filter((input) => input.type === 'window')).toEqual([
      { type: 'window', time: 2, id: 7, kind: 'dialog', rect: dialog.bounds, open: true },
      { type: 'window', time: 3, id: 7, kind: 'dialog', rect: dialog.bounds, open: false },
    ]);
  });
});

describe('wheelInput', () => {
  const VERTICAL = 3;
  const HORIZONTAL = 4;

  it('maps notches to dy or dx', () => {
    expect(wheelInput({ x: 5, y: 6, rotation: 2, direction: VERTICAL }, VERTICAL, 10)).toEqual({ type: 'scroll', time: 10, x: 5, y: 6, dx: 0, dy: 2 });
    expect(wheelInput({ x: 5, y: 6, rotation: -1, direction: HORIZONTAL }, VERTICAL, 10)).toEqual({ type: 'scroll', time: 10, x: 5, y: 6, dx: -1, dy: 0 });
  });

  it('skips a touchpad delta that is not a notch yet', () => {
    expect(wheelInput({ x: 5, y: 6, rotation: 0, direction: VERTICAL }, VERTICAL, 10)).toBeUndefined();
  });
});
