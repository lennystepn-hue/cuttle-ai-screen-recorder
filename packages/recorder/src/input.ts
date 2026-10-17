// Input sources: the global mouse and keyboard hook with the pointer shape (Windows), an event tap
// (macOS), or synthetic input for the test backend. All deliver wall-clock seconds and desktop pixels.
import type { Platform } from './sources';
import type { HotkeyAction, RawInput } from './types';

export interface InputSource {
  /** The pointer's position and shape now, stamped with `time`: the first events of the take. */
  initial(time: number): RawInput[];
  /** Stops delivering input; calling it again does nothing. */
  stop(): void;
  /** Why input is not logged (macOS without the Input Monitoring permission): the take warns. */
  warning?: string;
}

export type InputSink = (input: RawInput) => void;
export type HotkeySink = (action: HotkeyAction) => void;

const now = () => Date.now() / 1000;

/** Ctrl+Shift+Alt+<key>: no app binds these, and AltGr+Shift+letter types nothing on common layouts. */
export const HOTKEYS: Record<HotkeyAction, string> = { stop: 'Ctrl+Shift+Alt+S', marker: 'Ctrl+Shift+Alt+M', pause: 'Ctrl+Shift+Alt+P', retake: 'Ctrl+Shift+Alt+X' };

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
  if (platform === 'test') return startTestInput(onInput);
  return platform === 'macos' ? startMacInput(onInput, onHotkey) : startWindowsInput(onInput, onHotkey);
}

/** How often the pointer shape is read (Windows has no event for it). */
const SHAPE_POLL_MS = 1000 / 30;
/** The caret is read every this many shape reads (5 a second)… */
const CARET_EVERY = 6;
/** …while keys were typed in the last this many seconds. */
const CARET_AFTER_KEYS = 1;

type Caret = { x: number; y: number; width: number; height: number };

/** The window and its popups are looked at every this many shape reads (about 4 times a second)… */
const WINDOWS_EVERY = 8;
/** …and the content area every this many (once a second), or at once when the window moved. */
const AREA_EVERY = 30;
/** A content area that moved less than this (px) has not moved. */
const AREA_SLACK = 2;

type Watched = Pick<import('./win32').Win32, 'foreground' | 'contentArea' | 'popups'>;

/**
 * The window shown and what opens over it: called on every shape read, it passes on the foreground
 * window's content area when it changes (`area`, null for none), and each dialog or menu that opens
 * or closes (`window`).
 */
export function windowWatch(win: Watched, onInput: InputSink): (time: number) => void {
  let reads = -1;
  let shown: { id: number; bounds: Caret } | undefined;
  let area: Caret | null | undefined;
  let open = new Map<number, ReturnType<Watched['popups']>[number]>();
  const same = (a: Caret | null | undefined, b: Caret | null) =>
    a === b || (!!a && !!b && Math.abs(a.x - b.x) <= AREA_SLACK && Math.abs(a.y - b.y) <= AREA_SLACK && Math.abs(a.width - b.width) <= AREA_SLACK && Math.abs(a.height - b.height) <= AREA_SLACK);
  return (time) => {
    reads++;
    if (reads % WINDOWS_EVERY !== 0) return;
    const now = new Map(win.popups().map((popup) => [popup.id, popup]));
    for (const [id, popup] of now) if (!open.has(id)) onInput({ type: 'window', time, id, kind: popup.kind, rect: popup.bounds, open: true });
    for (const [id, popup] of open) if (!now.has(id)) onInput({ type: 'window', time, id, kind: popup.kind, rect: popup.bounds, open: false });
    open = now;
    const front = win.foreground();
    const moved = front?.id !== shown?.id || !same(front?.bounds, shown?.bounds ?? null);
    shown = front;
    if (!moved && reads % AREA_EVERY !== 0) return;
    const next = (front && win.contentArea(front.id)) ?? null;
    if (area !== undefined && same(area, next)) return;
    area = next;
    onInput({ type: 'area', time, rect: next });
  };
}

/**
 * Where text is typed, while it is: called on every shape read, it reads the caret every
 * `CARET_EVERY`th time while a key came in the last `CARET_AFTER_KEYS` seconds, and passes it on
 * when it moved.
 */
export function caretWatch(read: () => Caret | undefined, onInput: InputSink): (time: number, typedAt: number) => void {
  let reads = 0;
  let last = '';
  return (time, typedAt) => {
    if (++reads % CARET_EVERY !== 0 || time - typedAt > CARET_AFTER_KEYS) return;
    const caret = read();
    const key = caret ? `${caret.x},${caret.y},${caret.width},${caret.height}` : '';
    if (!caret || key === last) return;
    last = key;
    onInput({ type: 'caret', time, ...caret });
  };
}
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
  const keys = keyHandler(modifiers, new Map<number, HotkeyAction>([[UiohookKey.S, 'stop'], [UiohookKey.M, 'marker'], [UiohookKey.P, 'pause'], [UiohookKey.X, 'retake']]), onInput, onHotkey);
  const buttons = new Map<unknown, 'left' | 'right' | 'middle'>([[1, 'left'], [2, 'right'], [3, 'middle']]);
  let shape = win.cursorShape(); // before the hook starts: nothing to undo if it throws

  const onMove = (event: { x: number; y: number }) => onInput({ type: 'move', time: now(), x: event.x, y: event.y });
  const onDown = (event: { x: number; y: number; button: unknown }) => {
    const button = buttons.get(event.button);
    if (button) onInput({ type: 'click', time: now(), x: event.x, y: event.y, button });
  };
  const onWheel = (event: { x: number; y: number; rotation: number; direction: number }) => {
    const scroll = wheelInput(event, WheelDirection.VERTICAL, now());
    if (scroll) onInput(scroll);
  };
  let typedAt = -Infinity;
  const onKeyDown = (event: KeyEvent) => {
    typedAt = now();
    keys.down(event);
  };
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

  let stopped = false;
  const caret = caretWatch(() => win.caret(), onInput);
  const windows = windowWatch(win, onInput);
  const poll = setInterval(() => {
    const current = win.cursorShape();
    if (current !== shape) {
      shape = current;
      onInput({ type: 'shape', time: now(), shape });
    }
    caret(now(), typedAt);
    windows(now());
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

/** macOS virtual key codes of the hotkeys' letters (kVK_ANSI_S, _M, _P, _X). */
const MAC_HOTKEYS = new Map<number, HotkeyAction>([[0x01, 'stop'], [0x2e, 'marker'], [0x23, 'pause'], [0x07, 'retake']]);
const WHERE_INPUT_MONITORING = 'allow the app that runs Cuttle (your terminal, or Cuttle) under System Settings > Privacy & Security > Input Monitoring';

/**
 * macOS: an event tap of darwin.ts (see there why not uiohook) in desktop pixels, each event at its
 * own timestamp (a caret read or a busy moment of this thread does not shift it); the pointer's
 * shape read as on Windows. Without Input Monitoring only the mouse is logged (no key counts, no
 * hotkeys, no caret); the caret also needs the Accessibility permission (without it, zooms on
 * typing follow what the screen changes).
 */
async function startMacInput(onInput: InputSink, onHotkey: HotkeySink): Promise<InputSource> {
  const { loadDarwin } = await import('./darwin');
  const mac = await loadDarwin();
  const keyboard = mac.keyboardAccess();
  // modifier keys come as flag changes, not as key presses: none to leave out
  const keys = keyHandler(new Set(), MAC_HOTKEYS, onInput, onHotkey);
  let typedAt = -Infinity;
  const tap = mac.watchInput(keyboard, (event) => {
    const { time } = event;
    if (event.type === 'key') {
      const key = { keycode: event.keycode, ctrlKey: event.ctrl, shiftKey: event.shift, altKey: event.alt };
      if (event.down) typedAt = time;
      return event.down ? keys.down(key) : keys.up(key);
    }
    if (event.type === 'move') return onInput({ type: 'move', time, x: event.x, y: event.y });
    if (event.type === 'down') return onInput({ type: 'click', time, x: event.x, y: event.y, button: event.button });
    onInput({ type: 'scroll', time, x: event.x, y: event.y, dx: event.dx, dy: event.dy });
  });
  const warning = !tap
    ? `the mouse and the keyboard are not logged (no clicks, no zooms on them, no hotkeys): ${WHERE_INPUT_MONITORING}`
    : !keyboard
      ? `the keyboard is not logged (no typing activity, no hotkeys): ${WHERE_INPUT_MONITORING}`
      : undefined;
  // the pointer's shape and the caret, read as on Windows (the caret a few times a second while keys come)
  const caret = caretWatch(() => mac.caret(), onInput);
  let shape = mac.cursorShape();
  const poll = tap
    ? setInterval(() => {
        const current = mac.cursorShape();
        if (current !== shape) {
          shape = current;
          onInput({ type: 'shape', time: now(), shape });
        }
        if (keyboard) caret(now(), typedAt);
      }, SHAPE_POLL_MS)
    : undefined;
  return {
    initial: (time) => [{ type: 'move', time, ...mac.cursorPosition() }, { type: 'shape', time, shape }],
    stop: () => {
      clearInterval(poll);
      tap?.stop();
    },
    ...(warning && { warning }),
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
