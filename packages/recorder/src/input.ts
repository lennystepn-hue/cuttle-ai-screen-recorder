// Input sources: the global mouse and keyboard hook with the pointer shape (Windows), or synthetic
// input for the test backend. Both deliver wall-clock seconds and desktop pixels.
import type { Platform } from './sources';
import type { HotkeyAction, RawInput } from './types';

export interface InputSource {
  /** The pointer's position and shape now, stamped with `time`: the first events of the take. */
  initial(time: number): RawInput[];
  /** Stops delivering input; calling it again does nothing. */
  stop(): void;
}

export type InputSink = (input: RawInput) => void;
export type HotkeySink = (action: HotkeyAction) => void;

const now = () => Date.now() / 1000;

/** Ctrl+Shift+Alt+<key>: no app binds these, and AltGr+Shift+letter types nothing on common layouts. */
export const HOTKEYS: Record<HotkeyAction, string> = { stop: 'Ctrl+Shift+Alt+S', marker: 'Ctrl+Shift+Alt+M' };

export interface KeyEvent {
  keycode: number;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * Turns key presses into key counts and hotkeys. Modifier keys count for nothing; a hotkey's key is
 * not counted, and holding it down (auto-repeat) triggers it once.
 */
export function keyHandler(modifiers: ReadonlySet<number>, hotkeys: ReadonlyMap<number, HotkeyAction>, onInput: InputSink, onHotkey: HotkeySink) {
  const held = new Set<number>();
  return {
    down(event: KeyEvent): void {
      if (modifiers.has(event.keycode)) return;
      const action = event.ctrlKey && event.shiftKey && event.altKey ? hotkeys.get(event.keycode) : undefined;
      if (action === undefined) return onInput({ type: 'key', time: now() });
      if (held.has(event.keycode)) return;
      held.add(event.keycode);
      onHotkey(action);
    },
    up(event: KeyEvent): void {
      held.delete(event.keycode);
    },
  };
}

/**
 * A wheel event as a scroll in whole notches, positive down (toward the user) and right; undefined for
 * a touchpad's small deltas, which add up to a notch before they arrive.
 */
export function wheelInput(event: { x: number; y: number; rotation: number; direction: number }, vertical: number, time: number): RawInput | undefined {
  if (event.rotation === 0) return undefined;
  const isVertical = event.direction === vertical;
  return { type: 'scroll', time, x: event.x, y: event.y, dx: isVertical ? 0 : event.rotation, dy: isVertical ? event.rotation : 0 };
}

export async function startInput(platform: Platform, onInput: InputSink, onHotkey: HotkeySink): Promise<InputSource> {
  return platform === 'test' ? startTestInput(onInput) : startWindowsInput(onInput, onHotkey);
}

/** How often the pointer shape is read (Windows has no event for it). */
const SHAPE_POLL_MS = 1000 / 30;
/** uiohook is one hook per process: it runs while at least one input source uses it. */
let hookUsers = 0;

async function startWindowsInput(onInput: InputSink, onHotkey: HotkeySink): Promise<InputSource> {
  const { loadWin32 } = await import('./win32');
  const win = await loadWin32(); // DPI awareness first: the hook then reports physical pixels
  const { uIOhook, UiohookKey, WheelDirection } = await import('uiohook-napi');
  const modifiers = new Set<number>([
    UiohookKey.Ctrl, UiohookKey.CtrlRight, UiohookKey.Shift, UiohookKey.ShiftRight,
    UiohookKey.Alt, UiohookKey.AltRight, UiohookKey.Meta, UiohookKey.MetaRight,
  ]);
  const keys = keyHandler(modifiers, new Map<number, HotkeyAction>([[UiohookKey.S, 'stop'], [UiohookKey.M, 'marker']]), onInput, onHotkey);
  const buttons = new Map<unknown, 'left' | 'right' | 'middle'>([[1, 'left'], [2, 'right'], [3, 'middle']]);

  const onMove = (event: { x: number; y: number }) => onInput({ type: 'move', time: now(), x: event.x, y: event.y });
  const onDown = (event: { x: number; y: number; button: unknown }) => {
    const button = buttons.get(event.button);
    if (button) onInput({ type: 'click', time: now(), x: event.x, y: event.y, button });
  };
  const onWheel = (event: { x: number; y: number; rotation: number; direction: number }) => {
    const scroll = wheelInput(event, WheelDirection.VERTICAL, now());
    if (scroll) onInput(scroll);
  };
  const onKeyDown = (event: KeyEvent) => keys.down(event);
  const onKeyUp = (event: KeyEvent) => keys.up(event);
  const detach = () => {
    uIOhook.off('mousemove', onMove);
    uIOhook.off('mousedown', onDown);
    uIOhook.off('wheel', onWheel);
    uIOhook.off('keydown', onKeyDown);
    uIOhook.off('keyup', onKeyUp);
  };
  uIOhook.on('mousemove', onMove);
  uIOhook.on('mousedown', onDown);
  uIOhook.on('wheel', onWheel);
  uIOhook.on('keydown', onKeyDown);
  uIOhook.on('keyup', onKeyUp);
  try {
    if (hookUsers === 0) uIOhook.start();
  } catch (error) {
    detach();
    throw error;
  }
  hookUsers++;

  let shape = win.cursorShape();
  let stopped = false;
  const poll = setInterval(() => {
    const current = win.cursorShape();
    if (current === shape) return;
    shape = current;
    onInput({ type: 'shape', time: now(), shape });
  }, SHAPE_POLL_MS);

  return {
    initial(time) {
      const { x, y } = win.cursorPosition();
      return [
        { type: 'move', time, x, y },
        { type: 'shape', time, shape },
      ];
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(poll);
      detach();
      if (--hookUsers === 0) uIOhook.stop();
    },
  };
}

/** Seconds of synthetic input; afterwards a still test monitor counts as idle. */
const TEST_INPUT_SECONDS = 1.5;

/**
 * Synthetic input on the test monitor for its first 1.5 s: the pointer circles the centre at 60 Hz,
 * and after 1 s it clicks, scrolls, types three keys and switches to the text cursor.
 */
function startTestInput(onInput: InputSink): InputSource {
  const started = now();
  const position = (time: number) => {
    const angle = (time - started) * Math.PI;
    return { x: Math.round(640 + 200 * Math.cos(angle)), y: Math.round(360 + 200 * Math.sin(angle)) };
  };
  const moves = setInterval(() => {
    const time = now();
    onInput({ type: 'move', time, ...position(time) });
  }, 1000 / 60);
  const burst = setTimeout(() => {
    const time = now();
    onInput({ type: 'click', time, ...position(time), button: 'left' });
    onInput({ type: 'scroll', time, ...position(time), dx: 0, dy: 1 });
    onInput({ type: 'shape', time, shape: 'text' });
    for (let key = 0; key < 3; key++) onInput({ type: 'key', time });
  }, 1000);
  const end = setTimeout(() => clearInterval(moves), TEST_INPUT_SECONDS * 1000);
  return {
    initial: (time) => [
      { type: 'move', time, ...position(time) },
      { type: 'shape', time, shape: 'arrow' },
    ],
    stop() {
      clearInterval(moves);
      clearTimeout(burst);
      clearTimeout(end);
    },
  };
}
