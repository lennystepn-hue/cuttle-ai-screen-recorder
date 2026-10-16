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

export async function startInput(platform: Platform, onInput: InputSink, onHotkey: HotkeySink): Promise<InputSource> {
  return platform === 'test' ? startTestInput(onInput) : startWindowsInput(onInput, onHotkey);
}

/** How often the pointer shape is read (Windows has no event for it). */
const SHAPE_POLL_MS = 1000 / 30;

async function startWindowsInput(onInput: InputSink, onHotkey: HotkeySink): Promise<InputSource> {
  const { loadWin32 } = await import('./win32');
  const win = await loadWin32(); // DPI awareness first: the hook then reports physical pixels
  const { uIOhook, UiohookKey, WheelDirection } = await import('uiohook-napi');
  const modifiers = new Set<number>([
    UiohookKey.Ctrl, UiohookKey.CtrlRight, UiohookKey.Shift, UiohookKey.ShiftRight,
    UiohookKey.Alt, UiohookKey.AltRight, UiohookKey.Meta, UiohookKey.MetaRight,
  ]);
  const hotkeys = new Map<number, HotkeyAction>([[UiohookKey.S, 'stop'], [UiohookKey.M, 'marker']]);
  const buttons = new Map<unknown, 'left' | 'right' | 'middle'>([[1, 'left'], [2, 'right'], [3, 'middle']]);

  uIOhook.on('mousemove', (event) => onInput({ type: 'move', time: now(), x: event.x, y: event.y }));
  uIOhook.on('mousedown', (event) => {
    const button = buttons.get(event.button);
    if (button) onInput({ type: 'click', time: now(), x: event.x, y: event.y, button });
  });
  uIOhook.on('wheel', (event) => {
    // Whole notches; positive is down (toward the user) and right. A touchpad's small deltas add up to 0 first.
    if (event.rotation === 0) return;
    const vertical = event.direction === WheelDirection.VERTICAL;
    onInput({ type: 'scroll', time: now(), x: event.x, y: event.y, dx: vertical ? 0 : event.rotation, dy: vertical ? event.rotation : 0 });
  });
  uIOhook.on('keydown', (event) => {
    if (modifiers.has(event.keycode)) return;
    const action = event.ctrlKey && event.shiftKey && event.altKey ? hotkeys.get(event.keycode) : undefined;
    if (action) onHotkey(action);
    else onInput({ type: 'key', time: now() });
  });
  uIOhook.start();

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
      uIOhook.stop();
      uIOhook.removeAllListeners();
    },
  };
}

/**
 * Synthetic input on the test monitor: the pointer circles its centre at 60 Hz; every second it
 * clicks, scrolls, types three keys and switches between the arrow and the text cursor.
 */
function startTestInput(onInput: InputSink): InputSource {
  const started = now();
  const position = (time: number) => {
    const angle = (time - started) * Math.PI;
    return { x: Math.round(640 + 200 * Math.cos(angle)), y: Math.round(360 + 200 * Math.sin(angle)) };
  };
  const timers = [
    setInterval(() => {
      const time = now();
      onInput({ type: 'move', time, ...position(time) });
    }, 1000 / 60),
    setInterval(() => {
      const time = now();
      onInput({ type: 'click', time, ...position(time), button: 'left' });
      onInput({ type: 'scroll', time, ...position(time), dx: 0, dy: 1 });
      onInput({ type: 'shape', time, shape: Math.round(time - started) % 2 === 0 ? 'arrow' : 'text' });
      for (let key = 0; key < 3; key++) onInput({ type: 'key', time });
    }, 1000),
  ];
  return {
    initial: (time) => [
      { type: 'move', time, ...position(time) },
      { type: 'shape', time, shape: 'arrow' },
    ],
    stop: () => timers.forEach(clearInterval),
  };
}
