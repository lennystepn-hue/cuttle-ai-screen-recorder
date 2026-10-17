import { basename } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CURSOR_SHAPES } from '@cuttle/project';
import { RENDER_WIDGET, SHELL_CLASSES, loadWin32, windowKind } from '../src/win32';

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

  it('finds a window\'s content area: its largest render widget', async () => {
    const win = await loadWin32();
    const { default: koffi } = await import('koffi');
    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');
    const prefix = `check${process.hrtime.bigint()}`;
    const WNDPROC = koffi.proto('__stdcall', `${prefix}_WNDPROC`, 'intptr_t', ['void *', 'uint32', 'uintptr_t', 'intptr_t']);
    const WNDCLASSW = koffi.struct(`${prefix}_WNDCLASSW`, {
      style: 'uint32',
      lpfnWndProc: koffi.pointer(WNDPROC),
      cbClsExtra: 'int',
      cbWndExtra: 'int',
      hInstance: 'void *',
      hIcon: 'void *',
      hCursor: 'void *',
      hbrBackground: 'void *',
      lpszMenuName: 'str16',
      lpszClassName: 'str16',
    });
    const DefWindowProcW = user32.func('__stdcall', 'DefWindowProcW', 'intptr_t', ['void *', 'uint32', 'uintptr_t', 'intptr_t']);
    const RegisterClassW = user32.func('__stdcall', 'RegisterClassW', 'uint16', [koffi.pointer(WNDCLASSW)]);
    const UnregisterClassW = user32.func('__stdcall', 'UnregisterClassW', 'int', ['str16', 'void *']);
    const CreateWindowExW = user32.func('__stdcall', 'CreateWindowExW', 'void *', ['uint32', 'str16', 'str16', 'uint32', 'int', 'int', 'int', 'int', 'void *', 'void *', 'void *', 'void *']);
    const DestroyWindow = user32.func('__stdcall', 'DestroyWindow', 'int', ['void *']);
    const GetModuleHandleW = kernel32.func('__stdcall', 'GetModuleHandleW', 'void *', ['void *']);
    const instance = GetModuleHandleW(null);
    const proc = koffi.register((hwnd: unknown, message: number, wParam: number, lParam: number) => DefWindowProcW(hwnd, message, wParam, lParam), koffi.pointer(WNDPROC));
    const [WS_POPUP, WS_CHILD] = [0x80000000, 0x40000000];
    // a parent that is never shown, with two render widgets (a page and a small panel) and a sibling of another class
    expect(RegisterClassW({ style: 0, lpfnWndProc: proc, cbClsExtra: 0, cbWndExtra: 0, hInstance: instance, hIcon: null, hCursor: null, hbrBackground: null, lpszMenuName: null, lpszClassName: RENDER_WIDGET })).not.toBe(0);
    const parent = CreateWindowExW(0, 'STATIC', 'cuttle area check', WS_POPUP, 100, 100, 900, 700, null, null, null, null);
    try {
      for (const [x, y, w, h, kind] of [[10, 60, 860, 600, RENDER_WIDGET], [10, 0, 120, 60, RENDER_WIDGET], [10, 0, 880, 50, 'STATIC']] as const) {
        expect(CreateWindowExW(0, kind, '', WS_CHILD, x, y, w, h, parent, null, instance, null)).not.toBeNull();
      }
      const id = Number(BigInt.asUintN(32, koffi.address(parent)));
      expect(win.contentArea(id, true)).toEqual({ x: 110, y: 160, width: 860, height: 600 });
      // as the recorder looks: only what is shown
      expect(win.contentArea(id)).toBeUndefined();
    } finally {
      DestroyWindow(parent);
      UnregisterClassW(RENDER_WIDGET, instance);
      koffi.unregister(proc);
    }
  });

  it('knows a dialog and a menu by their class, and lists those on the desktop', async () => {
    const box = (width: number, height: number) => ({ x: 0, y: 0, width, height });
    expect(windowKind('#32770', true, box(400, 200))).toBe('dialog');
    expect(windowKind('#32768', false, box(200, 300))).toBe('menu');
    // a Chromium popup: a dialog when large, a dropdown or tooltip when small; a main window is none
    expect(windowKind('Chrome_WidgetWin_1', true, box(480, 320))).toBe('dialog');
    expect(windowKind('Chrome_WidgetWin_1', true, box(240, 400))).toBe('menu');
    expect(windowKind('Chrome_WidgetWin_1', false, box(1600, 900))).toBeUndefined();
    expect(windowKind('Notepad', false, box(800, 600))).toBeUndefined();
    // the shell's toasts and notification centre; another app's CoreWindow is none
    expect(windowKind('Windows.UI.Core.CoreWindow', false, box(364, 120), 'ShellExperienceHost.exe')).toBe('notification');
    expect(windowKind('Windows.UI.Core.CoreWindow', false, box(800, 600), 'SearchHost.exe')).toBeUndefined();
    const win = await loadWin32();
    expect(win.processName(process.pid).toLowerCase()).toBe(basename(process.execPath).toLowerCase());
    for (const popup of win.popups()) {
      expect(['dialog', 'menu', 'notification']).toContain(popup.kind);
      expect(popup.bounds.width).toBeGreaterThanOrEqual(2);
    }
    const front = win.foreground();
    if (front) expect(front.id).toBeGreaterThan(0);
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
