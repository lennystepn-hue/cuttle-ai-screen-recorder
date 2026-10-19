// Windows APIs through koffi: monitors in ddagrab order, windows, pointer position and shape, the
// caret, the content area of a window, and the dialogs and menus over the desktop.
import type { CursorShape, WindowKind } from '@cuttle/project';
import type { Bounds, Monitor, WindowInfo } from './types';

export interface Win32 {
  /** Outputs of the default adapter, in the order of ffmpeg ddagrab's `output_idx`. */
  monitors(): Monitor[];
  /** Visible top-level windows with a title on one of the monitors, front to back; not this process's own. */
  windows(): WindowInfo[];
  /** The pointer in physical desktop pixels, like the input hook's events. */
  cursorPosition(): { x: number; y: number };
  /** Brings a window (`WindowInfo.id`) to the front; false when it is gone or Windows refused. */
  focus(id: number): boolean;
  cursorShape(): CursorShape;
  /**
   * The system caret of a thread (the foreground's when 0) in physical desktop pixels, at least 1 px
   * each way; undefined where the app keeps none (many draw their own).
   */
  caret(thread?: number): { x: number; y: number; width: number; height: number } | undefined;
  /** The foreground window: its id and its frame (without the invisible resize border). */
  foreground(): { id: number; bounds: Bounds } | undefined;
  /**
   * A window's content area: its largest render widget (Chromium browsers and Electron apps draw the
   * page in one), visible unless `hidden` counts too; undefined without one.
   */
  contentArea(id: number, hidden?: boolean): Bounds | undefined;
  /** A process's executable's name (`node.exe`); '' when it cannot be read. */
  processName(pid: number): string;
  /** The dialogs, menus and notifications on the desktop now (not this process's own). */
  popups(): { id: number; kind: WindowKind; bounds: Bounds }[];
  /**
   * Timers of this process to the millisecond (`timeBeginPeriod(1)`; Windows' default is 15.6 ms),
   * for frames written 30 times a second; the function it returns ends that.
   */
  fineTimers(): () => void;
}

/** Chromium and Electron draw a page in a child window of this class: its rect is the page's. */
export const RENDER_WIDGET = 'Chrome_RenderWidgetHostHWND';

/** The shell's own windows: notifications (toasts) and the notification centre, among its flyouts. */
const SHELL_HOST = 'shellexperiencehost.exe';

/**
 * What a top-level window is, by its class: `#32770` a dialog, `#32768` a menu, and a Chromium popup
 * that has an owner a dialog when it is at least 320 × 200, else a menu (a dropdown, a tooltip). The
 * shell's `Windows.UI.Core.CoreWindow`s (`process`: ShellExperienceHost.exe) are notifications: the
 * toasts and the notification centre (its other flyouts are masked with them, which is safe).
 */
export function windowKind(className: string, owned: boolean, bounds: Bounds, process = ''): WindowKind | undefined {
  if (className === 'Windows.UI.Core.CoreWindow' && process.toLowerCase() === SHELL_HOST) return 'notification';
  if (className === '#32770') return 'dialog';
  if (className === '#32768') return 'menu';
  if (className === 'Chrome_WidgetWin_1' && owned) return bounds.width >= 320 && bounds.height >= 200 ? 'dialog' : 'menu';
  return undefined;
}

let loaded: Promise<Win32> | undefined;

/** Loads the bindings once and makes the process per-monitor DPI aware, so coordinates are physical pixels. */
export function loadWin32(): Promise<Win32> {
  loaded ??= create().catch((error: unknown) => {
    loaded = undefined; // the next call tries again
    throw error;
  });
  return loaded;
}

// DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2; fails harmlessly when already set (Electron sets it).
const PER_MONITOR_AWARE_V2 = -4;
const MDT_EFFECTIVE_DPI = 0;
const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x80;
const DWMWA_EXTENDED_FRAME_BOUNDS = 9;
const DWMWA_CLOAKED = 14;
const MONITOR_DEFAULTTONULL = 0;
/** The desktop (Progman, WorkerW) and the taskbars pass the other filters, but are no window to record. */
export const SHELL_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd']);
// IID_IDXGIFactory1 {770aae78-f26f-4dba-a829-253c83d1b387}
const IID_IDXGIFactory1 = { Data1: 0x770aae78, Data2: 0xf26f, Data3: 0x4dba, Data4: [0xa8, 0x29, 0x25, 0x3c, 0x83, 0xd1, 0xb3, 0x87] };
/** System cursor ids (`IDC_*`) and the shape each stands for; anything else is drawn as `arrow`. */
const SYSTEM_CURSORS: [number, CursorShape][] = [
  [32512, 'arrow'],
  [32513, 'text'],
  [32514, 'wait'],
  [32515, 'crosshair'],
  [32646, 'move'],
  [32648, 'not-allowed'],
  [32649, 'pointer'],
  [32650, 'wait'], // IDC_APPSTARTING, the arrow with an hourglass
];

interface OutputDesc {
  DeviceName: number[];
  DesktopCoordinates: { left: number; top: number; right: number; bottom: number };
  Monitor: unknown;
}

async function create(): Promise<Win32> {
  const { default: koffi } = await import('koffi');
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');
  const dxgi = koffi.load('dxgi.dll');
  const shcore = koffi.load('shcore.dll');
  const dwmapi = koffi.load('dwmapi.dll');
  const winmm = koffi.load('winmm.dll');

  // Type names are process-wide and can be defined once, but this module may load more than once in
  // a process (test files, two copies in a bundle), so every load gets its own prefix. Anonymous
  // types are no way out: koffi 3.3 gave a struct and a callback the same internal name, and a
  // pointer to the struct then came back as the callback pointer.
  const prefix = `cuttle${process.hrtime.bigint()}`;
  const typeName = (type: string) => `${prefix}_${type}`;
  const GUID = koffi.struct(typeName('GUID'), { Data1: 'uint32', Data2: 'uint16', Data3: 'uint16', Data4: koffi.array('uint8', 8) });
  const RECT = koffi.struct(typeName('RECT'), { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
  const POINT = koffi.struct(typeName('POINT'), { x: 'int32', y: 'int32' });
  const CURSORINFO = koffi.struct(typeName('CURSORINFO'), { cbSize: 'uint32', flags: 'uint32', hCursor: 'void *', ptScreenPos: POINT });
  const GUITHREADINFO = koffi.struct(typeName('GUITHREADINFO'), {
    cbSize: 'uint32',
    flags: 'uint32',
    hwndActive: 'void *',
    hwndFocus: 'void *',
    hwndCapture: 'void *',
    hwndMenuOwner: 'void *',
    hwndMoveSize: 'void *',
    hwndCaret: 'void *',
    rcCaret: RECT,
  });
  const DXGI_OUTPUT_DESC = koffi.struct(typeName('DXGI_OUTPUT_DESC'), {
    DeviceName: koffi.array('uint16', 32),
    DesktopCoordinates: RECT,
    AttachedToDesktop: 'int32',
    Rotation: 'uint32',
    Monitor: 'void *',
  });
  const WNDENUMPROC = koffi.proto('__stdcall', typeName('WNDENUMPROC'), 'int', ['void *', 'intptr_t']);
  const GW_OWNER = 4;

  const SetProcessDpiAwarenessContext = user32.func('__stdcall', 'SetProcessDpiAwarenessContext', 'int', ['intptr_t']);
  // Physical pixels whatever the process's DPI awareness (GetCursorPos would be logical in a process
  // that was already made system-aware).
  const GetPhysicalCursorPos = user32.func('__stdcall', 'GetPhysicalCursorPos', 'int', [koffi.out(koffi.pointer(POINT))]);
  const GetCursorInfo = user32.func('__stdcall', 'GetCursorInfo', 'int', [koffi.inout(koffi.pointer(CURSORINFO))]);
  const GetGUIThreadInfo = user32.func('__stdcall', 'GetGUIThreadInfo', 'int', ['uint32', koffi.inout(koffi.pointer(GUITHREADINFO))]);
  const ClientToScreen = user32.func('__stdcall', 'ClientToScreen', 'int', ['void *', koffi.inout(koffi.pointer(POINT))]);
  const GetForegroundWindow = user32.func('__stdcall', 'GetForegroundWindow', 'void *', []);
  const EnumChildWindows = user32.func('__stdcall', 'EnumChildWindows', 'int', ['intptr_t', koffi.pointer(WNDENUMPROC), 'intptr_t']);
  const GetWindowRect = user32.func('__stdcall', 'GetWindowRect', 'int', ['void *', koffi.out(koffi.pointer(RECT))]);
  const GetWindow = user32.func('__stdcall', 'GetWindow', 'void *', ['void *', 'uint32']);
  const LoadCursorW = user32.func('__stdcall', 'LoadCursorW', 'void *', ['void *', 'uintptr_t']);
  const EnumWindows = user32.func('__stdcall', 'EnumWindows', 'int', [koffi.pointer(WNDENUMPROC), 'intptr_t']);
  const IsWindowVisible = user32.func('__stdcall', 'IsWindowVisible', 'int', ['void *']);
  const IsIconic = user32.func('__stdcall', 'IsIconic', 'int', ['void *']);
  const GetWindowLongPtrW = user32.func('__stdcall', 'GetWindowLongPtrW', 'intptr_t', ['void *', 'int']);
  const GetWindowTextLengthW = user32.func('__stdcall', 'GetWindowTextLengthW', 'int', ['void *']);
  const GetWindowTextW = user32.func('__stdcall', 'GetWindowTextW', 'int', ['void *', 'void *', 'int']);
  const GetWindowThreadProcessId = user32.func('__stdcall', 'GetWindowThreadProcessId', 'uint32', ['void *', koffi.out(koffi.pointer('uint32'))]);
  const GetClassNameW = user32.func('__stdcall', 'GetClassNameW', 'int', ['void *', 'void *', 'int']);
  // A window id (the HWND's address) goes in as an integer.
  const SetForegroundWindow = user32.func('__stdcall', 'SetForegroundWindow', 'int', ['intptr_t']);
  const IsWindow = user32.func('__stdcall', 'IsWindow', 'int', ['intptr_t']);
  const MonitorFromWindow = user32.func('__stdcall', 'MonitorFromWindow', 'void *', ['void *', 'uint32']);
  const GetConsoleWindow = kernel32.func('__stdcall', 'GetConsoleWindow', 'void *', []);
  const GetConsoleTitleW = kernel32.func('__stdcall', 'GetConsoleTitleW', 'uint32', ['void *', 'uint32']);
  const OpenProcess = kernel32.func('__stdcall', 'OpenProcess', 'void *', ['uint32', 'int', 'uint32']);
  const QueryFullProcessImageNameW = kernel32.func('__stdcall', 'QueryFullProcessImageNameW', 'int', ['void *', 'uint32', 'void *', koffi.inout(koffi.pointer('uint32'))]);
  const CloseHandle = kernel32.func('__stdcall', 'CloseHandle', 'int', ['void *']);
  const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
  const DwmGetWindowAttribute = dwmapi.func('__stdcall', 'DwmGetWindowAttribute', 'long', ['void *', 'uint32', 'void *', 'uint32']);
  const GetDpiForMonitor = shcore.func('__stdcall', 'GetDpiForMonitor', 'long', ['void *', 'int', koffi.out(koffi.pointer('uint32')), koffi.out(koffi.pointer('uint32'))]);
  const timeBeginPeriod = winmm.func('__stdcall', 'timeBeginPeriod', 'uint32', ['uint32']);
  const timeEndPeriod = winmm.func('__stdcall', 'timeEndPeriod', 'uint32', ['uint32']);
  const CreateDXGIFactory1 = dxgi.func('__stdcall', 'CreateDXGIFactory1', 'long', [koffi.pointer(GUID), koffi.out(koffi.pointer('void *'))]);

  // COM methods by vtable slot: IUnknown::Release 2, IDXGIFactory1::EnumAdapters1 12,
  // IDXGIAdapter::EnumOutputs 7, IDXGIOutput::GetDesc 7.
  const Release = koffi.proto('__stdcall', typeName('Release'), 'uint32', ['void *']);
  const EnumAdapters1 = koffi.proto('__stdcall', typeName('EnumAdapters1'), 'long', ['void *', 'uint32', koffi.out(koffi.pointer('void *'))]);
  const EnumOutputs = koffi.proto('__stdcall', typeName('EnumOutputs'), 'long', ['void *', 'uint32', koffi.out(koffi.pointer('void *'))]);
  const GetDesc = koffi.proto('__stdcall', typeName('GetDesc'), 'long', ['void *', koffi.out(koffi.pointer(DXGI_OUTPUT_DESC))]);
  const pointerSize = koffi.sizeof('void *');
  const call = (object: unknown, slot: number, proto: unknown, ...args: unknown[]) => {
    const vtable = koffi.decode(object, 'void *');
    const method = koffi.decode(vtable, slot * pointerSize, 'void *');
    return koffi.call(method, proto as never, object, ...args) as number;
  };
  const release = (object: unknown) => {
    if (object) call(object, 2, Release);
  };

  SetProcessDpiAwarenessContext(PER_MONITOR_AWARE_V2);
  const cursorShapes = new Map(SYSTEM_CURSORS.map(([id, shape]) => [koffi.address(LoadCursorW(null, id)), shape]));
  const ownConsole = koffi.address(GetConsoleWindow());

  /** The monitors with their HMONITOR, which places windows on them. */
  const outputs = (): { monitor: Monitor; handle: bigint }[] => {
    const result: { monitor: Monitor; handle: bigint }[] = [];
    const factory: unknown[] = [null];
    const adapter: unknown[] = [null];
    if (CreateDXGIFactory1(IID_IDXGIFactory1, factory) < 0) return result;
    try {
      if (call(factory[0], 12, EnumAdapters1, 0, adapter) < 0) return result;
      for (let index = 0; ; index++) {
        const output: unknown[] = [null];
        if (call(adapter[0], 7, EnumOutputs, index, output) < 0) break;
        const desc = {} as OutputDesc;
        try {
          if (call(output[0], 7, GetDesc, desc) < 0) continue;
        } finally {
          release(output[0]);
        }
        const { left, top, right, bottom } = desc.DesktopCoordinates;
        const dpiX = [96];
        const dpiY = [96];
        GetDpiForMonitor(desc.Monitor, MDT_EFFECTIVE_DPI, dpiX, dpiY);
        const name = String.fromCharCode(...desc.DeviceName.filter((code) => code !== 0)).replace(/^\\\\\.\\/, ''); // \\.\DISPLAY1 → DISPLAY1
        const monitor = {
          index,
          name,
          bounds: { x: left, y: top, width: right - left, height: bottom - top },
          scale: (dpiX[0] ?? 96) / 96,
          primary: left === 0 && top === 0, // the primary monitor's top-left is the desktop origin
        };
        result.push({ monitor, handle: koffi.address(desc.Monitor) });
      }
      return result;
    } finally {
      release(adapter[0]);
      release(factory[0]);
    }
  };

  /** The console's title: Windows Terminal shows it on a window of its own process, which the pid check misses. */
  const consoleTitle = (): string | undefined => {
    const buffer = Buffer.alloc(2048);
    const length = GetConsoleTitleW(buffer, 1024);
    return length > 0 ? buffer.toString('utf16le', 0, length * 2) : undefined;
  };

  const windows = (): WindowInfo[] => {
    const monitorOf = new Map(outputs().map(({ monitor, handle }) => [handle, monitor.index]));
    const ownTitle = consoleTitle();
    const found: WindowInfo[] = [];
    const rect = Buffer.alloc(16);
    const cloaked = Buffer.alloc(4);
    const visit = koffi.register((hwnd: unknown) => {
      if (!IsWindowVisible(hwnd) || IsIconic(hwnd)) return 1;
      if ((Number(GetWindowLongPtrW(hwnd, GWL_EXSTYLE)) & WS_EX_TOOLWINDOW) !== 0) return 1;
      // The recorder's own console (cmd.exe titles it with the command line) and windows; see also ownTitle.
      const pid = [0];
      GetWindowThreadProcessId(hwnd, pid);
      if (pid[0] === process.pid || (ownConsole !== 0n && koffi.address(hwnd) === ownConsole)) return 1;
      const classBuffer = Buffer.alloc(512);
      const className = classBuffer.toString('utf16le', 0, GetClassNameW(hwnd, classBuffer, 256) * 2);
      if (SHELL_CLASSES.has(className)) return 1;
      // Cloaked: on another virtual desktop, or a suspended UWP app that is "visible" but not shown.
      if (DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, cloaked, 4) >= 0 && cloaked.readUInt32LE(0) !== 0) return 1;
      const length = GetWindowTextLengthW(hwnd);
      if (length === 0) return 1;
      const text = Buffer.alloc((length + 1) * 2);
      const title = text.toString('utf16le', 0, GetWindowTextW(hwnd, text, length + 1) * 2);
      // The monitor that holds most of the window.
      const monitor = monitorOf.get(koffi.address(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONULL)));
      if (title === '' || title === ownTitle || monitor === undefined) return 1;
      if (DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, rect, 16) < 0) return 1;
      const [left, top, right, bottom] = [0, 4, 8, 12].map((offset) => rect.readInt32LE(offset)) as [number, number, number, number];
      if (right - left < 2 || bottom - top < 2) return 1;
      // A window handle has 32 significant bits (64-bit Windows sign-extends it): the id is those, unsigned.
      found.push({ id: Number(BigInt.asUintN(32, koffi.address(hwnd))), pid: pid[0]!, className, title, bounds: { x: left, y: top, width: right - left, height: bottom - top }, monitor });
      return 1;
    }, koffi.pointer(WNDENUMPROC));
    try {
      EnumWindows(visit, 0);
    } finally {
      koffi.unregister(visit);
    }
    return found;
  };

  const point = { x: 0, y: 0 };
  const info = { cbSize: koffi.sizeof(CURSORINFO), flags: 0, hCursor: null as unknown, ptScreenPos: { x: 0, y: 0 } };
  const rect = () => ({ left: 0, top: 0, right: 0, bottom: 0 });
  /** A process's executable's name (`ShellExperienceHost.exe`), kept per process id; '' when it cannot be read. */
  const processNames = new Map<number, string>();
  const processName = (pid: number): string => {
    let name = processNames.get(pid);
    if (name !== undefined) return name;
    name = '';
    const handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
    if (handle) {
      try {
        const buffer = Buffer.alloc(1040);
        const size = [520];
        if (QueryFullProcessImageNameW(handle, 0, buffer, size)) name = buffer.toString('utf16le', 0, size[0]! * 2).split('\\').pop() ?? '';
      } finally {
        CloseHandle(handle);
      }
    }
    if (processNames.size > 500) processNames.clear();
    processNames.set(pid, name);
    return name;
  };
  /** A window id (32 bits, unsigned) as the handle Windows takes. */
  const handleOf = (id: number) => (id >= 2 ** 31 ? id - 2 ** 32 : id);
  const idOf = (hwnd: unknown) => Number(BigInt.asUintN(32, koffi.address(hwnd)));
  const className = (hwnd: unknown) => {
    const buffer = Buffer.alloc(512);
    return buffer.toString('utf16le', 0, GetClassNameW(hwnd, buffer, 256) * 2);
  };
  /** A window's frame without the invisible resize border. */
  const frame = (hwnd: unknown): Bounds | undefined => {
    const bounds = Buffer.alloc(16);
    if (DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, bounds, 16) < 0) return undefined;
    const [left, top, right, bottom] = [0, 4, 8, 12].map((offset) => bounds.readInt32LE(offset)) as [number, number, number, number];
    return { x: left, y: top, width: right - left, height: bottom - top };
  };
  return {
    monitors: () => outputs().map(({ monitor }) => monitor),
    windows,
    cursorPosition() {
      GetPhysicalCursorPos(point);
      return { x: point.x, y: point.y };
    },
    focus(id) {
      const handle = id >= 2 ** 31 ? id - 2 ** 32 : id;
      return IsWindow(handle) !== 0 && SetForegroundWindow(handle) !== 0;
    },
    cursorShape() {
      if (!GetCursorInfo(info) || info.hCursor === null) return 'arrow';
      return cursorShapes.get(koffi.address(info.hCursor)) ?? 'arrow';
    },
    processName,
    foreground() {
      const hwnd = GetForegroundWindow();
      const bounds = hwnd ? frame(hwnd) : undefined;
      return hwnd && bounds ? { id: idOf(hwnd), bounds } : undefined;
    },
    contentArea(id, hidden = false) {
      let best: Bounds | undefined;
      const visit = koffi.register((hwnd: unknown) => {
        if ((!hidden && !IsWindowVisible(hwnd)) || className(hwnd) !== RENDER_WIDGET) return 1;
        const box = rect();
        if (!GetWindowRect(hwnd, box)) return 1;
        const area = { x: box.left, y: box.top, width: box.right - box.left, height: box.bottom - box.top };
        if (area.width > 50 && area.height > 50 && area.width * area.height > (best ? best.width * best.height : 0)) best = area;
        return 1;
      }, koffi.pointer(WNDENUMPROC));
      try {
        EnumChildWindows(handleOf(id), visit, 0);
      } finally {
        koffi.unregister(visit);
      }
      return best;
    },
    popups() {
      const found: { id: number; kind: WindowKind; bounds: Bounds }[] = [];
      const cloaked = Buffer.alloc(4);
      const visit = koffi.register((hwnd: unknown) => {
        if (!IsWindowVisible(hwnd) || IsIconic(hwnd)) return 1;
        const pid = [0];
        GetWindowThreadProcessId(hwnd, pid);
        if (pid[0] === process.pid) return 1;
        if (DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, cloaked, 4) >= 0 && cloaked.readUInt32LE(0) !== 0) return 1;
        const bounds = frame(hwnd);
        const kindOf = className(hwnd);
        const kind = bounds && windowKind(kindOf, GetWindow(hwnd, GW_OWNER) !== null, bounds, kindOf === 'Windows.UI.Core.CoreWindow' ? processName(pid[0]!) : '');
        if (bounds && kind && bounds.width >= 2 && bounds.height >= 2) found.push({ id: idOf(hwnd), kind, bounds });
        return 1;
      }, koffi.pointer(WNDENUMPROC));
      try {
        EnumWindows(visit, 0);
      } finally {
        koffi.unregister(visit);
      }
      return found;
    },
    fineTimers() {
      const begun = timeBeginPeriod(1) === 0;
      let ended = false;
      return () => {
        if (begun && !ended) timeEndPeriod(1);
        ended = true;
      };
    },
    caret(thread = 0) {
      const gui = { cbSize: koffi.sizeof(GUITHREADINFO), flags: 0, hwndActive: null, hwndFocus: null, hwndCapture: null, hwndMenuOwner: null, hwndMoveSize: null, hwndCaret: null as unknown, rcCaret: rect() };
      if (!GetGUIThreadInfo(thread, gui) || !gui.hwndCaret) return undefined;
      // the caret's rect is in its window's client pixels
      const corner = { x: gui.rcCaret.left, y: gui.rcCaret.top };
      if (!ClientToScreen(gui.hwndCaret, corner)) return undefined;
      return { x: corner.x, y: corner.y, width: Math.max(1, gui.rcCaret.right - gui.rcCaret.left), height: Math.max(1, gui.rcCaret.bottom - gui.rcCaret.top) };
    },
  };
}
