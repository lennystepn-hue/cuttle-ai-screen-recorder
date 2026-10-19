// A window for the real window-take check, that no one sees: all of it on the primary monitor, but
// inside the taskbar's strip, under the taskbar. It is never activated and has no taskbar button (an
// owner that is never shown). It paints itself red, green and blue in turn, 10 times a second.
// Prints {"id":…,"bounds":…} once it is there; "close" on stdin closes the window; the end of stdin
// ends the process. Refuses to start (exit 2) where the taskbar is not at the bottom.
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const gdi32 = koffi.load('gdi32.dll');
const MSG = koffi.struct('MSG', { hwnd: 'void *', message: 'uint32', wParam: 'uintptr_t', lParam: 'intptr_t', time: 'uint32', x: 'int32', y: 'int32', priv: 'uint32' });
const POINT = koffi.struct('POINT', { x: 'int32', y: 'int32' });
const RECT = koffi.struct('RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
const MONITORINFO = koffi.struct('MONITORINFO', { cbSize: 'uint32', rcMonitor: RECT, rcWork: RECT, dwFlags: 'uint32' });
const SetProcessDpiAwarenessContext = user32.func('__stdcall', 'SetProcessDpiAwarenessContext', 'int', ['intptr_t']);
const CreateWindowExW = user32.func('__stdcall', 'CreateWindowExW', 'void *', ['uint32', 'str16', 'str16', 'uint32', 'int', 'int', 'int', 'int', 'void *', 'void *', 'void *', 'void *']);
const DestroyWindow = user32.func('__stdcall', 'DestroyWindow', 'int', ['void *']);
const PeekMessageW = user32.func('__stdcall', 'PeekMessageW', 'int', [koffi.out(koffi.pointer(MSG)), 'void *', 'uint32', 'uint32', 'uint32']);
const TranslateMessage = user32.func('__stdcall', 'TranslateMessage', 'int', [koffi.pointer(MSG)]);
const DispatchMessageW = user32.func('__stdcall', 'DispatchMessageW', 'intptr_t', [koffi.pointer(MSG)]);
const MonitorFromPoint = user32.func('__stdcall', 'MonitorFromPoint', 'void *', [POINT, 'uint32']);
const GetMonitorInfoW = user32.func('__stdcall', 'GetMonitorInfoW', 'int', ['void *', koffi.inout(koffi.pointer(MONITORINFO))]);
const GetDC = user32.func('__stdcall', 'GetDC', 'void *', ['void *']);
const ReleaseDC = user32.func('__stdcall', 'ReleaseDC', 'int', ['void *', 'void *']);
const FillRect = user32.func('__stdcall', 'FillRect', 'int', ['void *', koffi.pointer(RECT), 'void *']);
const CreateSolidBrush = gdi32.func('__stdcall', 'CreateSolidBrush', 'void *', ['uint32']);

SetProcessDpiAwarenessContext(-4); // per-monitor aware: physical pixels, as the recorder's
const WS_POPUP = 0x80000000;
const WS_VISIBLE = 0x10000000;
const WS_EX_NOACTIVATE = 0x08000000;
const WS_EX_TRANSPARENT = 0x20; // clicks go through it
const MONITOR_DEFAULTTOPRIMARY = 1;

const info = { cbSize: koffi.sizeof(MONITORINFO), rcMonitor: {}, rcWork: {}, dwFlags: 0 };
GetMonitorInfoW(MonitorFromPoint({ x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY), info);
const strip = info.rcMonitor.bottom - info.rcWork.bottom;
if (strip < 20) {
  process.stderr.write('the taskbar is not at the bottom of the primary monitor: the window would show\n');
  process.exit(2);
}
const owner = CreateWindowExW(0, 'STATIC', '', WS_POPUP, 0, 0, 1, 1, null, null, null, null);
const bounds = { x: info.rcMonitor.left + 100, y: info.rcWork.bottom + 4, width: 640, height: strip - 8 };
const hwnd = CreateWindowExW(WS_EX_NOACTIVATE | WS_EX_TRANSPARENT, 'STATIC', 'Cuttle window check', WS_POPUP | WS_VISIBLE, bounds.x, bounds.y, bounds.width, bounds.height, owner, null, null, null);
const brushes = [0x0000ff, 0x00ff00, 0xff0000].map((bgr) => CreateSolidBrush(bgr));
let open = true;
let n = 0;
const paint = setInterval(() => {
  if (!open) return;
  const dc = GetDC(hwnd);
  FillRect(dc, { left: 0, top: 0, right: bounds.width, bottom: bounds.height }, brushes[n++ % 3]);
  ReleaseDC(hwnd, dc);
}, 100);
const pump = setInterval(() => {
  const msg = {};
  while (PeekMessageW(msg, null, 0, 0, 1)) {
    TranslateMessage(msg);
    DispatchMessageW(msg);
  }
}, 10);
process.stdout.write(`${JSON.stringify({ id: Number(BigInt.asUintN(32, koffi.address(hwnd))), bounds })}\n`);
process.stdin.setEncoding('utf8');
process.stdin.on('data', (text) => {
  if (!text.includes('close') || !open) return;
  open = false;
  DestroyWindow(hwnd);
  process.stdout.write('closed\n');
});
process.stdin.on('end', () => {
  clearInterval(paint);
  clearInterval(pump);
  if (open) DestroyWindow(hwnd);
  DestroyWindow(owner);
  process.exit(0);
});
