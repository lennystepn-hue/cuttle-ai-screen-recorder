import { describe, expect, it } from 'vitest';
import { CURSOR_SHAPES } from '@cuttle/project';
import { SHELL_CLASSES, loadWin32 } from '../src/win32';

/**
 * A caret of this thread in a window that is never shown (`WS_POPUP` without `WS_VISIBLE`): where
 * `GetGUIThreadInfo` finds it. Calls `check` with the thread's id, then cleans up.
 */
async function withCaret(window: { x: number; y: number }, caret: { x: number; y: number; width: number; height: number }, check: (thread: number) => void): Promise<void> {
  const { default: koffi } = await import('koffi');
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');
  const CreateWindowExW = user32.func('__stdcall', 'CreateWindowExW', 'void *', ['uint32', 'str16', 'str16', 'uint32', 'int', 'int', 'int', 'int', 'void *', 'void *', 'void *', 'void *']);
  const DestroyWindow = user32.func('__stdcall', 'DestroyWindow', 'int', ['void *']);
  const CreateCaret = user32.func('__stdcall', 'CreateCaret', 'int', ['void *', 'void *', 'int', 'int']);
  const SetCaretPos = user32.func('__stdcall', 'SetCaretPos', 'int', ['int', 'int']);
  const DestroyCaret = user32.func('__stdcall', 'DestroyCaret', 'int', []);
  const GetCurrentThreadId = kernel32.func('__stdcall', 'GetCurrentThreadId', 'uint32', []);
  const WS_POPUP = 0x80000000;
  const hwnd = CreateWindowExW(0, 'STATIC', 'cuttle caret check', WS_POPUP, window.x, window.y, 400, 200, null, null, null, null);
  expect(hwnd).not.toBeNull();
  try {
    expect(CreateCaret(hwnd, null, caret.width, caret.height)).not.toBe(0);
    SetCaretPos(caret.x, caret.y);
    check(GetCurrentThreadId());
  } finally {
    DestroyCaret();
    DestroyWindow(hwnd);
  }
}

describe.runIf(process.platform === 'win32')('win32', () => {
  it('loads once per module and reads the pointer', async () => {
    const win = await loadWin32();
    expect(await loadWin32()).toBe(win);
    const { x, y } = win.cursorPosition();
    expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true);
    expect(CURSOR_SHAPES).toContain(win.cursorShape());
  });

  it('puts the pointer on a monitor, in the same pixels as the monitor bounds', async () => {
    const win = await loadWin32();
    const monitors = win.monitors();
    if (monitors.length === 0) return; // a machine without a desktop session
    const { x, y } = win.cursorPosition();
    const inside = monitors.filter(({ bounds }) => x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height);
    expect(inside.length).toBe(1);
  });

  it('reads a thread\'s caret in desktop pixels, and none where there is none', async () => {
    const win = await loadWin32();
    await withCaret({ x: 120, y: 80 }, { x: 30, y: 44, width: 2, height: 18 }, (thread) => {
      expect(win.caret(thread)).toEqual({ x: 150, y: 124, width: 2, height: 18 });
    });
    // this thread has no caret any more
    const { default: koffi } = await import('koffi');
    const thread = koffi.load('kernel32.dll').func('__stdcall', 'GetCurrentThreadId', 'uint32', [])() as number;
    expect(win.caret(thread)).toBeUndefined();
  });

  it('lists windows with a title and a size on a listed monitor', async () => {
    const win = await loadWin32();
    const monitors = win.monitors();
    for (const window of win.windows()) {
      expect(window.title).not.toBe('');
      expect(Number.isSafeInteger(window.id) && window.id > 0).toBe(true);
      expect(Number.isInteger(window.pid)).toBe(true);
      expect(SHELL_CLASSES.has(window.className)).toBe(false);
      expect(window.bounds.width).toBeGreaterThanOrEqual(2);
      expect(monitors.some((monitor) => monitor.index === window.monitor)).toBe(true);
    }
  });
});
