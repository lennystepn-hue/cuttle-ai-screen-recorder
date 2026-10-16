// Windows APIs through koffi: monitors in ddagrab order, windows, pointer position and shape.
import type { CursorShape } from '@cuttle/project';
import type { Monitor, WindowInfo } from './types';

export interface Win32 {
  /** Outputs of the default adapter, in the order of ffmpeg ddagrab's `output_idx`. */
  monitors(): Monitor[];
  /** Visible top-level windows with a title on one of the monitors, front to back. */
  windows(): WindowInfo[];
  cursorPosition(): { x: number; y: number };
  cursorShape(): CursorShape;
}

let loaded: Promise<Win32> | undefined;

/** Loads the bindings once and makes the process per-monitor DPI aware, so coordinates are physical pixels. */
export function loadWin32(): Promise<Win32> {
  loaded ??= create();
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
  const dxgi = koffi.load('dxgi.dll');
  const shcore = koffi.load('shcore.dll');
  const dwmapi = koffi.load('dwmapi.dll');

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
  const DXGI_OUTPUT_DESC = koffi.struct(typeName('DXGI_OUTPUT_DESC'), {
    DeviceName: koffi.array('uint16', 32),
    DesktopCoordinates: RECT,
    AttachedToDesktop: 'int32',
    Rotation: 'uint32',
    Monitor: 'void *',
  });
  const WNDENUMPROC = koffi.proto('__stdcall', typeName('WNDENUMPROC'), 'int', ['void *', 'intptr_t']);

  const SetProcessDpiAwarenessContext = user32.func('__stdcall', 'SetProcessDpiAwarenessContext', 'int', ['intptr_t']);
  const GetCursorPos = user32.func('__stdcall', 'GetCursorPos', 'int', [koffi.out(koffi.pointer(POINT))]);
  const GetCursorInfo = user32.func('__stdcall', 'GetCursorInfo', 'int', [koffi.inout(koffi.pointer(CURSORINFO))]);
  const LoadCursorW = user32.func('__stdcall', 'LoadCursorW', 'void *', ['void *', 'uintptr_t']);
  const EnumWindows = user32.func('__stdcall', 'EnumWindows', 'int', [koffi.pointer(WNDENUMPROC), 'intptr_t']);
  const IsWindowVisible = user32.func('__stdcall', 'IsWindowVisible', 'int', ['void *']);
  const IsIconic = user32.func('__stdcall', 'IsIconic', 'int', ['void *']);
  const GetWindowLongPtrW = user32.func('__stdcall', 'GetWindowLongPtrW', 'intptr_t', ['void *', 'int']);
  const GetWindowTextLengthW = user32.func('__stdcall', 'GetWindowTextLengthW', 'int', ['void *']);
  const GetWindowTextW = user32.func('__stdcall', 'GetWindowTextW', 'int', ['void *', 'void *', 'int']);
  const MonitorFromWindow = user32.func('__stdcall', 'MonitorFromWindow', 'void *', ['void *', 'uint32']);
  const DwmGetWindowAttribute = dwmapi.func('__stdcall', 'DwmGetWindowAttribute', 'long', ['void *', 'uint32', 'void *', 'uint32']);
  const GetDpiForMonitor = shcore.func('__stdcall', 'GetDpiForMonitor', 'long', ['void *', 'int', koffi.out(koffi.pointer('uint32')), koffi.out(koffi.pointer('uint32'))]);
  const CreateDXGIFactory1 = dxgi.func('__stdcall', 'CreateDXGIFactory1', 'long', [koffi.pointer(GUID), koffi.out(koffi.pointer('void *'))]);

  // COM methods by vtable slot: IUnknown::Release 2, IDXGIFactory1::EnumAdapters1 12,
  // IDXGIAdapter::EnumOutputs 7, IDXGIOutput::GetDesc 7.
  const Release = koffi.proto('__stdcall', typeName('Release'), 'uint32', ['void *']);
  const EnumAdapters1 = koffi.proto('__stdcall', typeName('EnumAdapters1'), 'long', ['void *', 'uint32', koffi.out(koffi.pointer('void *'))]);
  const EnumOutputs = koffi.proto('__stdcall', typeName('EnumOutputs'), 'long', ['void *', 'uint32', koffi.out(koffi.pointer('void *'))]);
  const GetDesc = koffi.proto('__stdcall', typeName('GetDesc'), 'long', ['void *', koffi.out(koffi.pointer(DXGI_OUTPUT_DESC))]);
  const call = (object: unknown, slot: number, proto: unknown, ...args: unknown[]) => {
    const vtable = koffi.decode(object, 'void *');
    const method = koffi.decode(vtable, slot * 8, 'void *');
    return koffi.call(method, proto as never, object, ...args) as number;
  };

  SetProcessDpiAwarenessContext(PER_MONITOR_AWARE_V2);
  const cursorShapes = new Map(SYSTEM_CURSORS.map(([id, shape]) => [koffi.address(LoadCursorW(null, id)), shape]));

  /** The monitors with their HMONITOR, which places windows on them. */
  const outputs = (): { monitor: Monitor; handle: bigint }[] => {
    const factory: unknown[] = [null];
    if (CreateDXGIFactory1(IID_IDXGIFactory1, factory) < 0) return [];
    const adapter: unknown[] = [null];
    const result: { monitor: Monitor; handle: bigint }[] = [];
    if (call(factory[0], 12, EnumAdapters1, 0, adapter) >= 0) {
      for (let index = 0; ; index++) {
        const output: unknown[] = [null];
        if (call(adapter[0], 7, EnumOutputs, index, output) < 0) break;
        const desc = {} as OutputDesc;
        call(output[0], 7, GetDesc, desc);
        call(output[0], 2, Release);
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
      call(adapter[0], 2, Release);
    }
    call(factory[0], 2, Release);
    return result;
  };

  const windows = (): WindowInfo[] => {
    const monitorOf = new Map(outputs().map(({ monitor, handle }) => [handle, monitor.index]));
    const found: WindowInfo[] = [];
    const rect = Buffer.alloc(16);
    const cloaked = Buffer.alloc(4);
    const visit = koffi.register((hwnd: unknown) => {
      if (!IsWindowVisible(hwnd) || IsIconic(hwnd)) return 1;
      if ((Number(GetWindowLongPtrW(hwnd, GWL_EXSTYLE)) & WS_EX_TOOLWINDOW) !== 0) return 1;
      // Cloaked: on another virtual desktop, or a suspended UWP app that is "visible" but not shown.
      if (DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, cloaked, 4) >= 0 && cloaked.readUInt32LE(0) !== 0) return 1;
      const length = GetWindowTextLengthW(hwnd);
      if (length === 0) return 1;
      const text = Buffer.alloc((length + 1) * 2);
      const title = text.toString('utf16le', 0, GetWindowTextW(hwnd, text, length + 1) * 2);
      const monitor = monitorOf.get(koffi.address(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONULL)));
      if (title === '' || monitor === undefined) return 1;
      if (DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, rect, 16) < 0) return 1;
      const [left, top, right, bottom] = [0, 4, 8, 12].map((offset) => rect.readInt32LE(offset)) as [number, number, number, number];
      if (right - left < 2 || bottom - top < 2) return 1;
      found.push({ title, bounds: { x: left, y: top, width: right - left, height: bottom - top }, monitor });
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
  return {
    monitors: () => outputs().map(({ monitor }) => monitor),
    windows,
    cursorPosition() {
      GetCursorPos(point);
      return { x: point.x, y: point.y };
    },
    cursorShape() {
      if (!GetCursorInfo(info) || info.hCursor === null) return 'arrow';
      return cursorShapes.get(koffi.address(info.hCursor)) ?? 'arrow';
    },
  };
}
