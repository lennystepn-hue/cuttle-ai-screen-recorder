// macOS APIs through koffi: displays in avfoundation's order, windows, the pointer, focus, the mouse
// and the keyboard (an event tap) and the privacy permissions (screen recording, input monitoring,
// camera and microphone).
//
// macOS works in points; a take is in the display's backing pixels (2880×1800 for a 1440×900 point
// Retina display). The recorder's desktop pixels on macOS: a display's top-left corner is its point
// origin times the largest backing scale of all displays (so no two displays overlap however their
// scales differ), and a point on it lies `scale` pixels apart from the next. `toPixels` maps a point,
// as the input hook and CoreGraphics report it, onto the display that holds it.
import type { Monitor, WindowInfo } from './types';

export interface Darwin {
  /** Active displays, in the order of CGGetActiveDisplayList: avfoundation's "Capture screen <index>". */
  monitors(): Monitor[];
  /** Normal on-screen windows with a size, front to back; not this process's own. */
  windows(): WindowInfo[];
  /** The pointer in desktop pixels. */
  cursorPosition(): { x: number; y: number };
  /** A point (global display coordinates, as CoreGraphics and the input hook give them) in desktop pixels. */
  toPixels(point: { x: number; y: number }): { x: number; y: number };
  /** Brings the app that owns a window (`WindowInfo.id`) to the front; false when it is gone or macOS refused. */
  focus(id: number): boolean;
  /** Whether this process (the app it belongs to) may record the screen. */
  screenAccess(): boolean;
  /** Asks for screen recording (macOS shows its prompt once, then points to System Settings). */
  requestScreenAccess(): void;
  /** Whether this process may watch the keyboard (Input Monitoring); the first call asks macOS for it. */
  keyboardAccess(): boolean;
  /**
   * Watches the mouse and, with `keys`, the keyboard: a listen-only event tap, serviced from this
   * thread every few milliseconds (libuiohook's tap needs the process's main dispatch queue, which
   * Node does not run). Undefined when macOS does not allow a tap.
   */
  watchInput(keys: boolean, onEvent: (event: TapEvent) => void): { stop(): void } | undefined;
  /** Camera or microphone access: AVAuthorizationStatus. */
  mediaAccess(kind: 'camera' | 'mic'): 'not-determined' | 'restricted' | 'denied' | 'authorized';
}

/** An event from the tap: positions in desktop pixels; keys by macOS virtual key code. */
export type TapEvent =
  | { type: 'move'; x: number; y: number }
  | { type: 'down'; x: number; y: number; button: 'left' | 'right' | 'middle' }
  | { type: 'scroll'; x: number; y: number; dx: number; dy: number }
  | { type: 'key'; down: boolean; keycode: number; ctrl: boolean; shift: boolean; alt: boolean };

interface Display {
  id: number;
  /** Global point coordinates. */
  points: { x: number; y: number; width: number; height: number };
  scale: number;
}

let loaded: Promise<Darwin> | undefined;

/** Loads the bindings once. */
export function loadDarwin(): Promise<Darwin> {
  loaded ??= create().catch((error: unknown) => {
    loaded = undefined; // the next call tries again
    throw error;
  });
  return loaded;
}

const FRAMEWORKS = '/System/Library/Frameworks';
const kCGWindowListOptionOnScreenOnly = 1;
const kCGWindowListExcludeDesktopElements = 16;
const kCFStringEncodingUTF8 = 0x08000100;
const kCFNumberSInt64Type = 4;
const kCFNumberDoubleType = 13;
/** NSApplicationActivateAllWindows | NSApplicationActivateIgnoringOtherApps */
const ACTIVATE_OPTIONS = 1 | 2;
/** AVMediaTypeVideo and AVMediaTypeAudio: NSStrings with these values. */
const MEDIA_TYPES = { camera: 'vide', mic: 'soun' } as const;
const AUTHORIZATION = ['not-determined', 'restricted', 'denied', 'authorized'] as const;
/** CGEventType values the tap listens to. */
const EVENT = {
  leftDown: 1, rightDown: 3, moved: 5, leftDragged: 6, rightDragged: 7, keyDown: 10, keyUp: 11,
  scroll: 22, otherDown: 25, otherDragged: 27, disabledByTimeout: 0xfffffffe, disabledByUserInput: 0xffffffff,
};
const MOUSE_EVENTS = [EVENT.leftDown, EVENT.rightDown, EVENT.moved, EVENT.leftDragged, EVENT.rightDragged, EVENT.scroll, EVENT.otherDown, EVENT.otherDragged];
const KEY_EVENTS = [EVENT.keyDown, EVENT.keyUp];
/** CGEventField values. */
const FIELD = { buttonNumber: 3, keyAutorepeat: 8, keycode: 9, scrollY: 11, scrollX: 12 };
const FLAG = { shift: 0x20000n, control: 0x40000n, alternate: 0x80000n };
/** How often the tap's run loop source is serviced. */
const TAP_POLL_MS = 8;

/** Maps points to desktop pixels on the displays (see the file's comment); pure, for the tests. */
export function pixelMapper(displays: readonly Display[]) {
  const unit = Math.max(1, ...displays.map((display) => display.scale));
  const holding = (x: number, y: number) =>
    displays.find(({ points }) => x >= points.x && x < points.x + points.width && y >= points.y && y < points.y + points.height) ??
    // off every display (a point at an edge): the nearest one
    [...displays].sort((a, b) => distance(a.points, x, y) - distance(b.points, x, y))[0];
  return {
    origin: (display: Display) => ({ x: Math.round(display.points.x * unit), y: Math.round(display.points.y * unit) }),
    toPixels(x: number, y: number, on?: Display) {
      const display = on ?? holding(x, y);
      if (!display) return { x: Math.round(x), y: Math.round(y) };
      return {
        x: Math.round(display.points.x * unit + (x - display.points.x) * display.scale),
        y: Math.round(display.points.y * unit + (y - display.points.y) * display.scale),
      };
    },
  };
}

function distance(rect: Display['points'], x: number, y: number): number {
  const dx = Math.max(rect.x - x, 0, x - (rect.x + rect.width));
  const dy = Math.max(rect.y - y, 0, y - (rect.y + rect.height));
  return dx * dx + dy * dy;
}

/** The display that holds most of a rectangle (points), or undefined when it is on none. */
export function displayOf<T extends Pick<Display, 'points'>>(displays: readonly T[], rect: Display['points']): T | undefined {
  let best: T | undefined;
  let most = 0;
  for (const display of displays) {
    const { points } = display;
    const width = Math.min(rect.x + rect.width, points.x + points.width) - Math.max(rect.x, points.x);
    const height = Math.min(rect.y + rect.height, points.y + points.height) - Math.max(rect.y, points.y);
    const area = Math.max(width, 0) * Math.max(height, 0);
    if (area > most) {
      most = area;
      best = display;
    }
  }
  return best;
}

async function create(): Promise<Darwin> {
  const { default: koffi } = await import('koffi');
  const cg = koffi.load(`${FRAMEWORKS}/CoreGraphics.framework/CoreGraphics`);
  const cf = koffi.load(`${FRAMEWORKS}/CoreFoundation.framework/CoreFoundation`);
  const services = koffi.load(`${FRAMEWORKS}/ApplicationServices.framework/ApplicationServices`);
  // AppKit (NSRunningApplication) and AVFoundation (AVCaptureDevice) register their classes when loaded.
  koffi.load(`${FRAMEWORKS}/AppKit.framework/AppKit`);
  koffi.load(`${FRAMEWORKS}/AVFoundation.framework/AVFoundation`);
  const objc = koffi.load('/usr/lib/libobjc.A.dylib');

  // Type names are process-wide; this module may load more than once in a process (see win32.ts).
  const prefix = `cuttle${process.hrtime.bigint()}`;
  const typeName = (type: string) => `${prefix}_${type}`;
  const CGPoint = koffi.struct(typeName('CGPoint'), { x: 'double', y: 'double' });
  const CGSize = koffi.struct(typeName('CGSize'), { width: 'double', height: 'double' });
  const CGRect = koffi.struct(typeName('CGRect'), { origin: CGPoint, size: CGSize });

  const CGGetActiveDisplayList = cg.func('CGGetActiveDisplayList', 'int32', ['uint32', koffi.out(koffi.pointer('uint32')), koffi.out(koffi.pointer('uint32'))]);
  const CGDisplayBounds = cg.func('CGDisplayBounds', CGRect, ['uint32']);
  const CGMainDisplayID = cg.func('CGMainDisplayID', 'uint32', []);
  const CGDisplayIsBuiltin = cg.func('CGDisplayIsBuiltin', 'bool', ['uint32']);
  const CGDisplayCopyDisplayMode = cg.func('CGDisplayCopyDisplayMode', 'void *', ['uint32']);
  const CGDisplayModeGetPixelWidth = cg.func('CGDisplayModeGetPixelWidth', 'size_t', ['void *']);
  const CGDisplayModeGetPixelHeight = cg.func('CGDisplayModeGetPixelHeight', 'size_t', ['void *']);
  const CGDisplayModeRelease = cg.func('CGDisplayModeRelease', 'void', ['void *']);
  const CGEventCreate = cg.func('CGEventCreate', 'void *', ['void *']);
  const CGEventGetLocation = cg.func('CGEventGetLocation', CGPoint, ['void *']);
  const CGWindowListCopyWindowInfo = cg.func('CGWindowListCopyWindowInfo', 'void *', ['uint32', 'uint32']);
  const CGRectMakeWithDictionaryRepresentation = cg.func('CGRectMakeWithDictionaryRepresentation', 'bool', ['void *', koffi.out(koffi.pointer(CGRect))]);
  const CGPreflightScreenCaptureAccess = cg.func('CGPreflightScreenCaptureAccess', 'bool', []);
  const CGRequestScreenCaptureAccess = cg.func('CGRequestScreenCaptureAccess', 'bool', []);
  const CGPreflightListenEventAccess = cg.func('CGPreflightListenEventAccess', 'bool', []);
  const CGRequestListenEventAccess = cg.func('CGRequestListenEventAccess', 'bool', []);
  const CGEventTapCallBack = koffi.proto(typeName('CGEventTapCallBack'), 'void *', ['void *', 'uint32', 'void *', 'void *']);
  const CGEventTapCreate = cg.func('CGEventTapCreate', 'void *', ['uint32', 'uint32', 'uint32', 'uint64', koffi.pointer(CGEventTapCallBack), 'void *']);
  const CGEventTapEnable = cg.func('CGEventTapEnable', 'void', ['void *', 'bool']);
  const CGEventGetIntegerValueField = cg.func('CGEventGetIntegerValueField', 'int64', ['void *', 'uint32']);
  const CGEventGetFlags = cg.func('CGEventGetFlags', 'uint64', ['void *']);
  const CFMachPortCreateRunLoopSource = cf.func('CFMachPortCreateRunLoopSource', 'void *', ['void *', 'void *', 'long']);
  const CFMachPortInvalidate = cf.func('CFMachPortInvalidate', 'void', ['void *']);
  const CFRunLoopGetCurrent = cf.func('CFRunLoopGetCurrent', 'void *', []);
  const CFRunLoopAddSource = cf.func('CFRunLoopAddSource', 'void', ['void *', 'void *', 'void *']);
  const CFRunLoopRemoveSource = cf.func('CFRunLoopRemoveSource', 'void', ['void *', 'void *', 'void *']);
  const CFRunLoopRunInMode = cf.func('CFRunLoopRunInMode', 'int32', ['void *', 'double', 'bool']);
  void services; // ApplicationServices is loaded for the frameworks it brings along

  const CFRelease = cf.func('CFRelease', 'void', ['void *']);
  const CFArrayGetCount = cf.func('CFArrayGetCount', 'long', ['void *']);
  const CFArrayGetValueAtIndex = cf.func('CFArrayGetValueAtIndex', 'void *', ['void *', 'long']);
  const CFDictionaryGetValue = cf.func('CFDictionaryGetValue', 'void *', ['void *', 'void *']);
  const CFStringCreateWithCString = cf.func('CFStringCreateWithCString', 'void *', ['void *', 'str', 'uint32']);
  const CFStringGetLength = cf.func('CFStringGetLength', 'long', ['void *']);
  const CFStringGetCString = cf.func('CFStringGetCString', 'bool', ['void *', 'void *', 'long', 'uint32']);
  const CFNumberGetValue = cf.func('CFNumberGetValue', 'bool', ['void *', 'long', 'void *']);

  const objc_getClass = objc.func('objc_getClass', 'void *', ['str']);
  const sel_registerName = objc.func('sel_registerName', 'void *', ['str']);
  // objc_msgSend takes the method's own signature: one declaration per signature used.
  const sendWithPid = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'int32']);
  const sendActivate = objc.func('objc_msgSend', 'bool', ['void *', 'void *', 'uint64']);
  const sendWithObject = objc.func('objc_msgSend', 'long', ['void *', 'void *', 'void *']);

  /** A CFString that lives as long as the process (keys and constants). */
  const cfString = (text: string) => CFStringCreateWithCString(null, text, kCFStringEncodingUTF8);
  const KEYS = {
    number: cfString('kCGWindowNumber'),
    pid: cfString('kCGWindowOwnerPID'),
    owner: cfString('kCGWindowOwnerName'),
    name: cfString('kCGWindowName'),
    bounds: cfString('kCGWindowBounds'),
    layer: cfString('kCGWindowLayer'),
    alpha: cfString('kCGWindowAlpha'),
  };
  const stringOf = (ref: unknown): string | undefined => {
    if (!ref) return undefined;
    const size = Number(CFStringGetLength(ref)) * 4 + 1;
    const buffer = Buffer.alloc(size);
    return CFStringGetCString(ref, buffer, size, kCFStringEncodingUTF8) ? buffer.toString('utf8', 0, buffer.indexOf(0)) : undefined;
  };
  const integerOf = (ref: unknown): number | undefined => {
    if (!ref) return undefined;
    const out = Buffer.alloc(8);
    return CFNumberGetValue(ref, kCFNumberSInt64Type, out) ? Number(out.readBigInt64LE(0)) : undefined;
  };
  const doubleOf = (ref: unknown): number | undefined => {
    if (!ref) return undefined;
    const out = Buffer.alloc(8);
    return CFNumberGetValue(ref, kCFNumberDoubleType, out) ? out.readDoubleLE(0) : undefined;
  };

  const displays = (): Display[] => {
    const ids = new Uint32Array(32);
    const count = [0];
    if (CGGetActiveDisplayList(ids.length, ids, count) !== 0) return [];
    const result: Display[] = [];
    for (let index = 0; index < (count[0] ?? 0); index++) {
      const id = ids[index]!;
      const bounds = CGDisplayBounds(id) as { origin: { x: number; y: number }; size: { width: number; height: number } };
      const mode = CGDisplayCopyDisplayMode(id);
      const pixelWidth = mode ? Number(CGDisplayModeGetPixelWidth(mode)) : bounds.size.width;
      if (mode) CGDisplayModeRelease(mode);
      result.push({ id, points: { x: bounds.origin.x, y: bounds.origin.y, width: bounds.size.width, height: bounds.size.height }, scale: pixelWidth / bounds.size.width || 1 });
    }
    return result;
  };

  const monitorsOf = (list: Display[]): Monitor[] => {
    const map = pixelMapper(list);
    const main = CGMainDisplayID();
    let external = 0;
    return list.map((display, index) => {
      const mode = CGDisplayCopyDisplayMode(display.id);
      const width = mode ? Number(CGDisplayModeGetPixelWidth(mode)) : Math.round(display.points.width * display.scale);
      const height = mode ? Number(CGDisplayModeGetPixelHeight(mode)) : Math.round(display.points.height * display.scale);
      if (mode) CGDisplayModeRelease(mode);
      const builtin = CGDisplayIsBuiltin(display.id);
      return {
        index,
        name: builtin ? 'Built-in Display' : `Display ${++external}`,
        bounds: { ...map.origin(display), width, height },
        scale: display.scale,
        primary: display.id === main,
        displayId: display.id,
      };
    });
  };

  const windows = (): WindowInfo[] => {
    const list = displays();
    const map = pixelMapper(list);
    const array = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, 0);
    if (!array) return [];
    const found: WindowInfo[] = [];
    try {
      const count = Number(CFArrayGetCount(array));
      const rect = { origin: { x: 0, y: 0 }, size: { width: 0, height: 0 } };
      for (let i = 0; i < count; i++) {
        const info = CFArrayGetValueAtIndex(array, i);
        // layer 0: ordinary windows (the menu bar, the Dock, menus and overlays are on others)
        if (integerOf(CFDictionaryGetValue(info, KEYS.layer)) !== 0) continue;
        if ((doubleOf(CFDictionaryGetValue(info, KEYS.alpha)) ?? 1) <= 0) continue;
        const pid = integerOf(CFDictionaryGetValue(info, KEYS.pid)) ?? 0;
        if (pid === process.pid) continue;
        const id = integerOf(CFDictionaryGetValue(info, KEYS.number));
        const bounds = CFDictionaryGetValue(info, KEYS.bounds);
        if (id === undefined || !bounds || !CGRectMakeWithDictionaryRepresentation(bounds, rect)) continue;
        const points = { x: rect.origin.x, y: rect.origin.y, width: rect.size.width, height: rect.size.height };
        if (points.width < 2 || points.height < 2) continue;
        const owner = stringOf(CFDictionaryGetValue(info, KEYS.owner)) ?? '';
        // the title only with the screen recording permission; the app's name stands in for it
        const title = stringOf(CFDictionaryGetValue(info, KEYS.name)) || owner;
        const display = displayOf(list, points);
        if (title === '' || !display) continue;
        const topLeft = map.toPixels(points.x, points.y, display);
        const bottomRight = map.toPixels(points.x + points.width, points.y + points.height, display);
        found.push({
          id,
          pid,
          className: owner,
          title,
          bounds: { x: topLeft.x, y: topLeft.y, width: bottomRight.x - topLeft.x, height: bottomRight.y - topLeft.y },
          monitor: list.indexOf(display),
        });
      }
    } finally {
      CFRelease(array);
    }
    return found;
  };

  const pointer = () => {
    const event = CGEventCreate(null);
    if (!event) return { x: 0, y: 0 };
    try {
      return CGEventGetLocation(event) as { x: number; y: number };
    } finally {
      CFRelease(event);
    }
  };

  // The displays change rarely; the input hook maps every move, so the mapper is kept for a second.
  let mapper: { map: ReturnType<typeof pixelMapper>; at: number } | undefined;
  const toPixels = ({ x, y }: { x: number; y: number }) => {
    if (!mapper || Date.now() - mapper.at > 1000) mapper = { map: pixelMapper(displays()), at: Date.now() };
    return mapper.map.toPixels(x, y);
  };

  const mediaTypes = { camera: cfString(MEDIA_TYPES.camera), mic: cfString(MEDIA_TYPES.mic) };
  // A mode is matched by its name, so an equal string stands for the kCFRunLoopDefaultMode constant.
  const defaultMode = cfString('kCFRunLoopDefaultMode');

  const watchInput = (keys: boolean, onEvent: (event: TapEvent) => void) => {
    const mask = [...MOUSE_EVENTS, ...(keys ? KEY_EVENTS : [])].reduce((bits, type) => bits | (1n << BigInt(type)), 0n);
    let port: unknown;
    const callback = koffi.register((_proxy: unknown, type: number, event: unknown) => {
      try {
        if (type === EVENT.disabledByTimeout || type === EVENT.disabledByUserInput) {
          if (port) CGEventTapEnable(port, true);
          return event;
        }
        if (type === EVENT.keyDown || type === EVENT.keyUp) {
          if (type === EVENT.keyDown && Number(CGEventGetIntegerValueField(event, FIELD.keyAutorepeat)) !== 0) return event;
          const flags = BigInt(CGEventGetFlags(event) as number | bigint);
          onEvent({
            type: 'key',
            down: type === EVENT.keyDown,
            keycode: Number(CGEventGetIntegerValueField(event, FIELD.keycode)),
            ctrl: (flags & FLAG.control) !== 0n,
            shift: (flags & FLAG.shift) !== 0n,
            alt: (flags & FLAG.alternate) !== 0n,
          });
          return event;
        }
        const at = toPixels(CGEventGetLocation(event) as { x: number; y: number });
        if (type === EVENT.scroll) {
          const dy = -Number(CGEventGetIntegerValueField(event, FIELD.scrollY));
          const dx = -Number(CGEventGetIntegerValueField(event, FIELD.scrollX));
          if (dx !== 0 || dy !== 0) onEvent({ type: 'scroll', ...at, dx, dy });
        } else if (type === EVENT.leftDown || type === EVENT.rightDown || type === EVENT.otherDown) {
          const button = type === EVENT.leftDown ? 'left' : type === EVENT.rightDown ? 'right' : Number(CGEventGetIntegerValueField(event, FIELD.buttonNumber)) === 2 ? 'middle' : undefined;
          if (button) onEvent({ type: 'down', ...at, button });
        } else {
          onEvent({ type: 'move', ...at });
        }
      } catch {
        // an event must never throw into the tap
      }
      return event;
    }, koffi.pointer(CGEventTapCallBack));
    // the session's events, inserted at the head, listen-only: nothing is held up or changed
    port = CGEventTapCreate(1, 0, 1, mask, callback, null);
    if (!port) {
      koffi.unregister(callback);
      return undefined;
    }
    const source = CFMachPortCreateRunLoopSource(null, port, 0);
    const loop = CFRunLoopGetCurrent();
    CFRunLoopAddSource(loop, source, defaultMode);
    CGEventTapEnable(port, true);
    const poll = setInterval(() => CFRunLoopRunInMode(defaultMode, 0, false), TAP_POLL_MS);
    let stopped = false;
    return {
      stop() {
        if (stopped) return;
        stopped = true;
        clearInterval(poll);
        CGEventTapEnable(port, false);
        CFRunLoopRemoveSource(loop, source, defaultMode);
        CFMachPortInvalidate(port);
        CFRelease(source);
        CFRelease(port);
        koffi.unregister(callback);
      },
    };
  };
  return {
    monitors: () => monitorsOf(displays()),
    windows,
    cursorPosition: () => toPixels(pointer()),
    toPixels,
    focus(id) {
      const window = windows().find((candidate) => candidate.id === id);
      if (!window) return false;
      const app = sendWithPid(objc_getClass('NSRunningApplication'), sel_registerName('runningApplicationWithProcessIdentifier:'), window.pid);
      return app ? sendActivate(app, sel_registerName('activateWithOptions:'), ACTIVATE_OPTIONS) : false;
    },
    screenAccess: () => CGPreflightScreenCaptureAccess(),
    requestScreenAccess: () => void CGRequestScreenCaptureAccess(),
    keyboardAccess: () => CGPreflightListenEventAccess() || (CGRequestListenEventAccess(), false),
    watchInput,
    mediaAccess(kind) {
      const status = Number(sendWithObject(objc_getClass('AVCaptureDevice'), sel_registerName('authorizationStatusForMediaType:'), mediaTypes[kind]));
      return AUTHORIZATION[status] ?? 'not-determined';
    },
  };
}
