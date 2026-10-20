// macOS APIs through koffi: displays in avfoundation's order, windows (and the dialogs, menus and
// notifications over them, and a browser's page in one), the pointer, focus, the mouse and the
// keyboard (an event tap) and the privacy permissions (screen recording, input monitoring, camera and
// microphone).
//
// macOS works in points; a take is in the display's backing pixels (2880×1800 for a 1440×900 point
// Retina display). The recorder's desktop pixels on macOS: a display's top-left corner is its point
// origin times the largest backing scale of all displays (so no two displays overlap however their
// scales differ), and a point on it lies `scale` pixels apart from the next. `toPixels` maps a point,
// as the input hook and CoreGraphics report it, onto the display that holds it.
import type { CursorShape, WindowKind } from '@cuttle/project';
import { OWN_PIDS } from './own-process';
import type { Bounds, Monitor, WindowInfo } from './types';

export interface Darwin {
  /** Active displays, in the order of CGGetActiveDisplayList: avfoundation's "Capture screen <index>". */
  monitors(): Monitor[];
  /** Normal on-screen windows with a size, front to back; not Cuttle's own (`own-process.ts`). */
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
  /** Seconds on the host clock (mach time since startup, as avfoundation stamps captures) as wall-clock seconds. */
  hostToWall(seconds: number): number;
  /** The pointer's shape now, from the system cursor's hotspot and size (anything unknown is the arrow). */
  cursorShape(): CursorShape;
  /**
   * Where text is typed in the front app, in desktop pixels, through the Accessibility API: the
   * selection's bounds, or the right edge of the character before the insertion point (macOS gives
   * an empty range no bounds). Undefined without the Accessibility permission or where an app does
   * not tell (most browsers and Electron apps).
   */
  caret(): { x: number; y: number; width: number; height: number } | undefined;
  /**
   * Watches the mouse and, with `keys`, the keyboard: a listen-only event tap, serviced from this
   * thread every few milliseconds (libuiohook's tap needs the process's main dispatch queue, which
   * Node does not run). Undefined when macOS does not allow a tap. Without Input Monitoring recent
   * macOS (27) makes the tap and sends it nothing, not even the mouse's events.
   */
  watchInput(keys: boolean, onEvent: (event: TapEvent) => void): { stop(): void } | undefined;
  /** Camera or microphone access: AVAuthorizationStatus. */
  mediaAccess(kind: 'camera' | 'mic'): 'not-determined' | 'restricted' | 'denied' | 'authorized';
  /** The front window (not Cuttle's own): its id and its frame, in desktop pixels. */
  foreground(): { id: number; bounds: Bounds } | undefined;
  /**
   * A window's page (a browser's, through the Accessibility API): Safari's and Firefox's web area,
   * or below a Chromium browser's toolbar (it shows no web area to the API). Looked for a few
   * milliseconds at a time and kept for the window as it is: undefined until found, and for other
   * windows and without the Accessibility permission. `hidden` is Windows' (a page not shown).
   */
  contentArea(id: number, hidden?: boolean): Bounds | undefined;
  /**
   * The dialogs, menus and notifications on the desktop now (not Cuttle's own), in desktop
   * pixels (see `macPopups`). A notification is each banner the Notification Center shows (through
   * the Accessibility API, once it holds still), or without that permission the right side of its
   * display, where banners and the centre open.
   */
  popups(): { id: number; kind: WindowKind; bounds: Bounds }[];
}

/** A window as CGWindowList gives it, in points: front to back, on the screen. */
export interface ListedWindow {
  id: number;
  pid: number;
  layer: number;
  points: { x: number; y: number; width: number; height: number };
  /** Its app's bundle identifier ('' when it has none). */
  bundle: string;
}

/** CGWindowLevel values: ordinary windows, modal panels (alerts, save panels), pop-up menus. */
export const LEVEL = { normal: 0, modalPanel: 8, popUpMenu: 101 };
/** The app that shows notifications: banners and the notification centre. */
export const NOTIFICATION_CENTER = 'com.apple.notificationcenterui';
/** Points a sheet's centre may lie off its window's (macOS centres them). */
const SHEET_SLACK = 2;

/**
 * What the windows over the desktop are, of `windows` (front to back, not Cuttle's own): a modal
 * panel (an alert, a save panel) or a sheet (a smaller window of the same app centred inside the
 * window right behind it) a dialog, a pop-up menu a menu, and the Notification Center's windows
 * above the desktop a notification (where its banners are is asked of the Accessibility API). Pure.
 */
export function macPopups(windows: readonly ListedWindow[]): { window: ListedWindow; kind: WindowKind }[] {
  const found: { window: ListedWindow; kind: WindowKind }[] = [];
  windows.forEach((window, index) => {
    if (window.bundle === NOTIFICATION_CENTER) {
      if (window.layer > LEVEL.normal) found.push({ window, kind: 'notification' });
      return;
    }
    if (window.layer === LEVEL.modalPanel) return void found.push({ window, kind: 'dialog' });
    if (window.layer === LEVEL.popUpMenu) return void found.push({ window, kind: 'menu' });
    if (window.layer !== LEVEL.normal) return;
    const behind = windows.slice(index + 1).find((other) => other.layer === LEVEL.normal);
    if (behind && isSheet(window.points, behind.points) && behind.pid === window.pid) found.push({ window, kind: 'dialog' });
  });
  return found;
}

/** Whether `sheet` lies inside `window`, smaller, centred across it (as macOS puts a sheet). */
function isSheet(sheet: ListedWindow['points'], window: ListedWindow['points']): boolean {
  const inside = sheet.x >= window.x - 1 && sheet.y >= window.y - 1 && sheet.x + sheet.width <= window.x + window.width + 1 && sheet.y + sheet.height <= window.y + window.height + 1;
  const centre = Math.abs(sheet.x + sheet.width / 2 - (window.x + window.width / 2)) <= SHEET_SLACK;
  return inside && centre && sheet.width * sheet.height < 0.9 * window.width * window.height;
}

/** Chromium browsers: they show the Accessibility API no web area, only their toolbar. */
export const CHROMIUM_BROWSERS = new Set([
  'com.google.Chrome', 'com.google.Chrome.beta', 'com.google.Chrome.canary', 'org.chromium.Chromium', 'com.microsoft.edgemac',
  'com.brave.Browser', 'com.operasoftware.Opera', 'com.operasoftware.OperaGX', 'com.vivaldi.Vivaldi', 'company.thebrowser.Browser',
]);

/**
 * A window's page from what its accessibility tree showed, in points: a web area (inside the window),
 * or for a Chromium browser what lies below its toolbar; undefined for anything else. Pure.
 */
export function pageOf(window: ListedWindow['points'], found: { webArea?: ListedWindow['points']; toolbar?: ListedWindow['points'] }, chromium: boolean): ListedWindow['points'] | undefined {
  const clip = (rect: ListedWindow['points']) => {
    const x = Math.max(rect.x, window.x);
    const y = Math.max(rect.y, window.y);
    const width = Math.min(rect.x + rect.width, window.x + window.width) - x;
    const height = Math.min(rect.y + rect.height, window.y + window.height) - y;
    return width > 50 && height > 50 ? { x, y, width, height } : undefined;
  };
  if (found.webArea) return clip(found.webArea);
  if (found.toolbar && chromium) {
    const top = found.toolbar.y + found.toolbar.height;
    return clip({ x: window.x, y: top, width: window.width, height: window.y + window.height - top });
  }
  return undefined;
}

/**
 * An event from the tap: `time` in wall-clock seconds from the event's own timestamp (when macOS
 * took it, not when this thread got to it); positions in desktop pixels; keys by macOS virtual key code.
 */
export type TapEvent = { time: number } & (
  | { type: 'move'; x: number; y: number }
  | { type: 'down'; x: number; y: number; button: 'left' | 'right' | 'middle' }
  | { type: 'scroll'; x: number; y: number; dx: number; dy: number }
  | { type: 'key'; down: boolean; keycode: number; ctrl: boolean; shift: boolean; alt: boolean }
);

/**
 * The wall-clock seconds of an event's timestamp. CGEventTimestamp counts from startup, in
 * nanoseconds of the uptime clock or in mach ticks (`ticks` to nanoseconds); whichever puts the
 * event a moment ago is the one. Pure, for the tests: the clocks are read by the caller.
 */
export function eventWallTime(stamp: bigint, now: { wall: number; uptimeNs: bigint; machNs: bigint }, ticks: { numer: bigint; denom: bigint }): number {
  if (stamp === 0n) return now.wall;
  for (const ago of [now.uptimeNs - stamp, now.machNs - (stamp * ticks.numer) / ticks.denom]) {
    const seconds = Number(ago) / 1e9;
    if (seconds >= 0 && seconds < 5) return now.wall - seconds;
  }
  return now.wall;
}

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
/** A window's page is looked for this long at each look (ms)… */
const SEARCH_MS = 40;
/** …in at most this many elements of its accessibility tree. */
const SEARCH_ELEMENTS = 400;
/** The roles a page or a toolbar may be inside (lists, tables and controls are not walked). */
const CONTAINERS = new Set(['AXWindow', 'AXGroup', 'AXSplitGroup', 'AXScrollArea', 'AXTabGroup', 'AXLayoutArea', 'AXUnknown']);
/** Without the Accessibility permission a notification is masked this wide on the right of its display (points). */
const NOTIFICATION_SIDE = 400;

/**
 * System cursors by hotspot and image size (points), as macOS 26 and 27 draw them: NSCursor's own
 * arrow and I-beam are not given to a process without an app, so they are measured; the others are
 * read from NSCursor at load as well. Not-allowed shares the arrow's and stays the arrow.
 */
export const CURSOR_SIGNATURES: [string, CursorShape][] = [
  ['5,5,28,40', 'arrow'],
  ['12,11,23,22', 'text'],
  ['12,8,32,32', 'pointer'],
  ['11,11,24,24', 'crosshair'],
  ['15,16,32,32', 'move'],
];

/** A cursor's signature: its hotspot and size, rounded. */
export const cursorSignature = (hot: { x: number; y: number }, size: { width: number; height: number }) =>
  [hot.x, hot.y, size.width, size.height].map(Math.round).join(',');

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
  const CGEventGetTimestamp = cg.func('CGEventGetTimestamp', 'uint64', ['void *']);
  const system = koffi.load('/usr/lib/libSystem.B.dylib');
  const mach_absolute_time = system.func('mach_absolute_time', 'uint64', []);
  const clock_gettime_nsec_np = system.func('clock_gettime_nsec_np', 'uint64', ['uint32']);
  const Timebase = koffi.struct(typeName('Timebase'), { numer: 'uint32', denom: 'uint32' });
  const mach_timebase_info = system.func('mach_timebase_info', 'int32', [koffi.out(koffi.pointer(Timebase))]);
  const timebase = { numer: 1, denom: 1 };
  mach_timebase_info(timebase);
  const ticks = { numer: BigInt(timebase.numer), denom: BigInt(timebase.denom || 1) };
  const CLOCK_UPTIME_RAW = 8;
  const eventTime = (event: unknown) =>
    eventWallTime(
      BigInt(CGEventGetTimestamp(event) as number | bigint),
      { wall: Date.now() / 1000, uptimeNs: BigInt(clock_gettime_nsec_np(CLOCK_UPTIME_RAW) as number | bigint), machNs: (BigInt(mach_absolute_time() as number | bigint) * ticks.numer) / ticks.denom },
      ticks,
    );

  // The Accessibility API (HIServices, in ApplicationServices): the front app's focused text
  const CFRange = koffi.struct(typeName('CFRange'), { location: 'long', length: 'long' });
  const AXIsProcessTrusted = services.func('AXIsProcessTrusted', 'bool', []);
  const AXUIElementCreateApplication = services.func('AXUIElementCreateApplication', 'void *', ['int32']);
  const AXUIElementSetMessagingTimeout = services.func('AXUIElementSetMessagingTimeout', 'int32', ['void *', 'float']);
  const AXUIElementCopyAttributeValue = services.func('AXUIElementCopyAttributeValue', 'int32', ['void *', 'void *', koffi.out(koffi.pointer('void *'))]);
  const AXUIElementCopyParameterizedAttributeValue = services.func('AXUIElementCopyParameterizedAttributeValue', 'int32', ['void *', 'void *', 'void *', koffi.out(koffi.pointer('void *'))]);
  const AXValueCreate = services.func('AXValueCreate', 'void *', ['uint32', koffi.pointer(CFRange)]);
  const AXValueGetRect = services.func('AXValueGetValue', 'bool', ['void *', 'uint32', koffi.out(koffi.pointer(CGRect))]);
  const AXValueGetRange = services.func('AXValueGetValue', 'bool', ['void *', 'uint32', koffi.out(koffi.pointer(CFRange))]);
  const AXValueGetPoint = services.func('AXValueGetValue', 'bool', ['void *', 'uint32', koffi.out(koffi.pointer(CGPoint))]);
  const AXValueGetSize = services.func('AXValueGetValue', 'bool', ['void *', 'uint32', koffi.out(koffi.pointer(CGSize))]);
  const AX_POINT = 1;
  const AX_SIZE = 2;
  const AX_RECT = 3;
  const AX_RANGE = 4;

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
  const sendObject = objc.func('objc_msgSend', 'void *', ['void *', 'void *']);
  const sendPoint = objc.func('objc_msgSend', CGPoint, ['void *', 'void *']);
  const sendSize = objc.func('objc_msgSend', CGSize, ['void *', 'void *']);
  const objc_autoreleasePoolPush = objc.func('objc_autoreleasePoolPush', 'void *', []);
  const objc_autoreleasePoolPop = objc.func('objc_autoreleasePoolPop', 'void', ['void *']);
  const sendWithObject = objc.func('objc_msgSend', 'long', ['void *', 'void *', 'void *']);
  const sendString = objc.func('objc_msgSend', 'str', ['void *', 'void *']);

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
        if (OWN_PIDS.has(pid)) continue;
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

  /** An app's bundle identifier by its pid ('' for none), kept: every look at the windows asks. */
  const bundles = new Map<number, string>();
  const bundleOf = (pid: number): string => {
    let bundle = bundles.get(pid);
    if (bundle !== undefined) return bundle;
    const pool = objc_autoreleasePoolPush();
    try {
      const app = sendWithPid(objc_getClass('NSRunningApplication'), sel_registerName('runningApplicationWithProcessIdentifier:'), pid);
      const id = app ? sendObject(app, sel_registerName('bundleIdentifier')) : null;
      bundle = id ? ((sendString(id, sel_registerName('UTF8String')) as string | null) ?? '') : '';
    } finally {
      objc_autoreleasePoolPop(pool);
    }
    if (bundles.size > 500) bundles.clear();
    bundles.set(pid, bundle);
    return bundle;
  };

  /** The windows on the screen at every level above the desktop, front to back, in points; not Cuttle's own. */
  const listed = (): ListedWindow[] => {
    const array = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, 0);
    if (!array) return [];
    const found: ListedWindow[] = [];
    try {
      const rect = { origin: { x: 0, y: 0 }, size: { width: 0, height: 0 } };
      for (let i = 0; i < Number(CFArrayGetCount(array)); i++) {
        const info = CFArrayGetValueAtIndex(array, i);
        if ((doubleOf(CFDictionaryGetValue(info, KEYS.alpha)) ?? 1) <= 0) continue;
        const pid = integerOf(CFDictionaryGetValue(info, KEYS.pid)) ?? 0;
        const id = integerOf(CFDictionaryGetValue(info, KEYS.number));
        const bounds = CFDictionaryGetValue(info, KEYS.bounds);
        if (OWN_PIDS.has(pid) || id === undefined || !bounds || !CGRectMakeWithDictionaryRepresentation(bounds, rect)) continue;
        if (rect.size.width < 2 || rect.size.height < 2) continue;
        const layer = integerOf(CFDictionaryGetValue(info, KEYS.layer)) ?? 0;
        found.push({ id, pid, layer, points: { x: rect.origin.x, y: rect.origin.y, width: rect.size.width, height: rect.size.height }, bundle: bundleOf(pid) });
      }
    } finally {
      CFRelease(array);
    }
    return found;
  };

  /** A rect in points as desktop pixels, on the display that holds most of it (undefined on none). */
  const rectToPixels = (points: ListedWindow['points'], list = displays()): Bounds | undefined => {
    const display = displayOf(list, points);
    if (!display) return undefined;
    const map = pixelMapper(list);
    const topLeft = map.toPixels(points.x, points.y, display);
    const bottomRight = map.toPixels(points.x + points.width, points.y + points.height, display);
    return { x: topLeft.x, y: topLeft.y, width: bottomRight.x - topLeft.x, height: bottomRight.y - topLeft.y };
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

  // The pointer's shape: the system cursor's signature looked up among the known ones. Each read runs
  // in an autorelease pool of its own: the cursor and its image would otherwise pile up in a process
  // without a run loop to drain them.
  const NSCursor = objc_getClass('NSCursor');
  const signatureOf = (cursor: unknown) =>
    cursorSignature(sendPoint(cursor, sel_registerName('hotSpot')) as { x: number; y: number }, sendSize(sendObject(cursor, sel_registerName('image')), sel_registerName('size')) as { width: number; height: number });
  const shapes = new Map<string, CursorShape>();
  {
    const pool = objc_autoreleasePoolPush();
    try {
      for (const [name, shape] of [['crosshairCursor', 'crosshair'], ['openHandCursor', 'move'], ['closedHandCursor', 'move'], ['pointingHandCursor', 'pointer'], ['IBeamCursor', 'text']] as const) {
        const cursor = sendObject(NSCursor, sel_registerName(name));
        if (cursor) shapes.set(signatureOf(cursor), shape);
      }
    } finally {
      objc_autoreleasePoolPop(pool);
    }
    for (const [signature, shape] of CURSOR_SIGNATURES) shapes.set(signature, shape);
  }
  const cursorShape = (): CursorShape => {
    const pool = objc_autoreleasePoolPush();
    try {
      const cursor = sendObject(NSCursor, sel_registerName('currentSystemCursor'));
      return cursor ? (shapes.get(signatureOf(cursor)) ?? 'arrow') : 'arrow';
    } catch {
      return 'arrow';
    } finally {
      objc_autoreleasePoolPop(pool);
    }
  };
  const AX = { focused: cfString('AXFocusedUIElement'), range: cfString('AXSelectedTextRange'), bounds: cfString('AXBoundsForRange') };

  /** The app in front: the owner of the frontmost ordinary window (the system-wide element's focus often cannot be read). */
  const frontPid = (): number | undefined => {
    const array = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, 0);
    if (!array) return undefined;
    try {
      for (let i = 0; i < Number(CFArrayGetCount(array)); i++) {
        const info = CFArrayGetValueAtIndex(array, i);
        const pid = integerOf(CFDictionaryGetValue(info, KEYS.pid));
        if (integerOf(CFDictionaryGetValue(info, KEYS.layer)) === 0 && pid !== undefined && !OWN_PIDS.has(pid)) return pid;
      }
      return undefined;
    } finally {
      CFRelease(array);
    }
  };

  /** The bounds (points) of a range of the focused text, or undefined. */
  const boundsOf = (element: unknown, range: unknown) => {
    const value: unknown[] = [null];
    if (AXUIElementCopyParameterizedAttributeValue(element, AX.bounds, range, value) !== 0 || !value[0]) return undefined;
    try {
      const rect = { origin: { x: 0, y: 0 }, size: { width: 0, height: 0 } };
      return AXValueGetRect(value[0], AX_RECT, rect) && rect.size.height > 0 ? rect : undefined;
    } finally {
      CFRelease(value[0]);
    }
  };

  /** The caret in points: the selection's bounds, or a line at the right edge of the character before it. */
  const caretPoints = () => {
    if (!AXIsProcessTrusted()) return undefined;
    const pid = frontPid();
    const app = pid === undefined ? undefined : AXUIElementCreateApplication(pid);
    if (!app) return undefined;
    // an app that hangs must not hold up the recorder for long
    AXUIElementSetMessagingTimeout(app, 0.25);
    const focused: unknown[] = [null];
    const selected: unknown[] = [null];
    try {
      if (AXUIElementCopyAttributeValue(app, AX.focused, focused) !== 0 || !focused[0]) return undefined;
      if (AXUIElementCopyAttributeValue(focused[0], AX.range, selected) !== 0 || !selected[0]) return undefined;
      const range = { location: 0, length: 0 };
      if (!AXValueGetRange(selected[0], AX_RANGE, range)) return undefined;
      if (range.length > 0) return boundsOf(focused[0], selected[0]);
      const before = AXValueCreate(AX_RANGE, { location: Math.max(0, range.location - 1), length: 1 });
      if (!before) return undefined;
      try {
        const char = boundsOf(focused[0], before);
        if (!char) return undefined;
        const x = range.location > 0 ? char.origin.x + char.size.width : char.origin.x;
        return { origin: { x, y: char.origin.y }, size: { width: 0, height: char.size.height } };
      } finally {
        CFRelease(before);
      }
    } finally {
      for (const ref of [selected[0], focused[0], app]) if (ref) CFRelease(ref);
    }
  };
  // The accessibility trees of other apps: what is copied out is released by whoever copied it.
  const AXT = {
    windows: cfString('AXWindows'), focusedWindow: cfString('AXFocusedWindow'), children: cfString('AXChildren'), role: cfString('AXRole'),
    subrole: cfString('AXSubrole'), position: cfString('AXPosition'), size: cfString('AXSize'),
  };
  /** An attribute's value, copied (the caller releases it), or undefined. */
  const copied = (element: unknown, name: unknown): unknown => {
    const value: unknown[] = [null];
    return AXUIElementCopyAttributeValue(element, name, value) === 0 && value[0] ? value[0] : undefined;
  };
  const textOf = (element: unknown, name: unknown): string => {
    const value = copied(element, name);
    if (!value) return '';
    try {
      return stringOf(value) ?? '';
    } finally {
      CFRelease(value);
    }
  };
  /** An element's frame in points (global, as CoreGraphics gives windows'), or undefined. */
  const frameOf = (element: unknown): ListedWindow['points'] | undefined => {
    const position = copied(element, AXT.position);
    const size = copied(element, AXT.size);
    try {
      const point = { x: 0, y: 0 };
      const extent = { width: 0, height: 0 };
      if (!position || !size || !AXValueGetPoint(position, AX_POINT, point) || !AXValueGetSize(size, AX_SIZE, extent)) return undefined;
      return { x: point.x, y: point.y, width: extent.width, height: extent.height };
    } finally {
      if (position) CFRelease(position);
      if (size) CFRelease(size);
    }
  };
  /** The elements of a CFArray (they live as long as the array). */
  const elementsOf = (array: unknown): unknown[] => Array.from({ length: Number(CFArrayGetCount(array)) }, (_, i) => CFArrayGetValueAtIndex(array, i));
  /** Whether two frames are one window's (an accessibility window and a listed one). */
  const near = (a: ListedWindow['points'], b: ListedWindow['points']) => Math.abs(a.x - b.x) <= 2 && Math.abs(a.y - b.y) <= 2 && Math.abs(a.width - b.width) <= 2 && Math.abs(a.height - b.height) <= 2;
  /** An app's accessibility element, answering within `timeout` seconds or not at all. */
  const appElement = (pid: number, timeout: number): unknown => {
    const app = AXUIElementCreateApplication(pid);
    if (app) AXUIElementSetMessagingTimeout(app, timeout);
    return app;
  };

  /**
   * Where the Notification Center (`pid`) shows banners now, in points: its elements whose subrole
   * says so (AXNotificationCenterBanner, …), not what is inside them. Undefined without the
   * Accessibility permission.
   */
  const bannersOf = (pid: number): ListedWindow['points'][] | undefined => {
    if (!AXIsProcessTrusted()) return undefined;
    const app = appElement(pid, 0.1);
    if (!app) return undefined;
    const owned: unknown[] = [app];
    const found: ListedWindow['points'][] = [];
    try {
      const windows = copied(app, AXT.windows);
      if (!windows) return found;
      owned.push(windows);
      let level = elementsOf(windows);
      let visited = 0;
      for (let depth = 0; depth < 8 && level.length > 0 && visited < 80; depth++) {
        const next: unknown[] = [];
        for (const element of level) {
          if (++visited > 80) break;
          if (textOf(element, AXT.subrole).startsWith('AXNotificationCenter')) {
            const frame = frameOf(element);
            if (frame && frame.width > 20 && frame.height > 20) found.push(frame);
            continue;
          }
          const children = copied(element, AXT.children);
          if (!children) continue;
          owned.push(children);
          next.push(...elementsOf(children));
        }
        level = next;
      }
    } finally {
      for (const ref of owned) CFRelease(ref);
    }
    return found;
  };

  // Notifications: a banner counts once it held still for two looks (it slides in); one id per place.
  let lastBanners = new Set<string>();
  let bannerless = 0;
  /** Whether the centre showed a banner since it came up: once it did, a look without one is its fading out. */
  let showedBanner = false;
  const bannerIds = new Map<string, number>();
  /** Banner ids lie above any window number. */
  const BANNER_IDS = 2_000_000_000;
  const notificationPopups = (centre: ListedWindow[], list: Display[]): { id: number; kind: WindowKind; bounds: Bounds }[] => {
    if (centre.length === 0) {
      lastBanners = new Set();
      bannerless = 0;
      showedBanner = false;
      return [];
    }
    const banners = bannersOf(centre[0]!.pid);
    // without the permission, or when the centre shows something without banners: the right side of
    // its display, where banners and the notification centre open
    const side = () =>
      centre.flatMap((window) => {
        const width = Math.min(window.points.width, NOTIFICATION_SIDE);
        const bounds = rectToPixels({ x: window.points.x + window.points.width - width, y: window.points.y, width, height: window.points.height }, list);
        return bounds ? [{ id: window.id, kind: 'notification' as const, bounds }] : [];
      });
    if (!banners) return side();
    if (banners.length === 0) return ++bannerless >= 2 && !showedBanner ? side() : [];
    bannerless = 0;
    showedBanner = true;
    const keyOf = (rect: ListedWindow['points']) => [rect.x, rect.y, rect.width, rect.height].map(Math.round).join(',');
    const now = new Set(banners.map(keyOf));
    const settled = banners.filter((banner) => lastBanners.has(keyOf(banner)));
    lastBanners = now;
    if (bannerIds.size > 200) bannerIds.clear();
    return settled.flatMap((banner) => {
      const key = keyOf(banner);
      if (!bannerIds.has(key)) bannerIds.set(key, BANNER_IDS + bannerIds.size);
      const bounds = rectToPixels(banner, list);
      return bounds ? [{ id: bannerIds.get(key)!, kind: 'notification' as const, bounds }] : [];
    });
  };

  // A window's page: its accessibility tree walked breadth first, a few milliseconds at each look,
  // for the window as it is (its number and frame); what is copied is released once it is done.
  type Search = { key: string; window: ListedWindow; queue: unknown[]; owned: unknown[]; visited: number; webArea?: ListedWindow['points']; toolbar?: ListedWindow['points']; done: boolean; page?: ListedWindow['points'] };
  let search: Search | undefined;
  const finish = (current: Search) => {
    current.done = true;
    current.page = pageOf(current.window.points, current, CHROMIUM_BROWSERS.has(current.window.bundle));
    for (const ref of current.owned) CFRelease(ref);
    current.owned = [];
    current.queue = [];
  };
  const startSearch = (window: ListedWindow, key: string): Search => {
    const current: Search = { key, window, queue: [], owned: [], visited: 0, done: false };
    const app = appElement(window.pid, 0.1);
    if (!app) return (finish(current), current);
    current.owned.push(app);
    const windows = copied(app, AXT.windows);
    if (windows) {
      current.owned.push(windows);
      // the accessibility window with the window's frame
      const match = elementsOf(windows).find((element) => {
        const frame = frameOf(element);
        return frame !== undefined && near(frame, window.points);
      });
      if (match) current.queue.push(match);
    }
    if (current.queue.length === 0) finish(current);
    return current;
  };
  const stepSearch = (current: Search) => {
    const until = performance.now() + SEARCH_MS;
    const chromium = CHROMIUM_BROWSERS.has(current.window.bundle);
    while (current.queue.length > 0 && performance.now() < until && current.visited < SEARCH_ELEMENTS) {
      const element = current.queue.shift();
      current.visited++;
      const role = textOf(element, AXT.role);
      if (role === 'AXWebArea') {
        current.webArea = frameOf(element);
        if (current.webArea) return finish(current);
        continue;
      }
      if (role === 'AXToolbar' && !current.toolbar) {
        current.toolbar = frameOf(element);
        if (chromium && current.toolbar) return finish(current);
        continue;
      }
      if (!CONTAINERS.has(role)) continue;
      const children = copied(element, AXT.children);
      if (!children) continue;
      current.owned.push(children);
      current.queue.push(...elementsOf(children));
    }
    if (current.queue.length === 0 || current.visited >= SEARCH_ELEMENTS) finish(current);
  };

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
        const time = eventTime(event);
        if (type === EVENT.keyDown || type === EVENT.keyUp) {
          if (type === EVENT.keyDown && Number(CGEventGetIntegerValueField(event, FIELD.keyAutorepeat)) !== 0) return event;
          const flags = BigInt(CGEventGetFlags(event) as number | bigint);
          onEvent({
            time,
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
          if (dx !== 0 || dy !== 0) onEvent({ time, type: 'scroll', ...at, dx, dy });
        } else if (type === EVENT.leftDown || type === EVENT.rightDown || type === EVENT.otherDown) {
          const button = type === EVENT.leftDown ? 'left' : type === EVENT.rightDown ? 'right' : Number(CGEventGetIntegerValueField(event, FIELD.buttonNumber)) === 2 ? 'middle' : undefined;
          if (button) onEvent({ time, type: 'down', ...at, button });
        } else {
          onEvent({ time, type: 'move', ...at });
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
    cursorShape,
    hostToWall(seconds) {
      const hostNow = Number((BigInt(mach_absolute_time() as number | bigint) * ticks.numer) / ticks.denom) / 1e9;
      return Date.now() / 1000 - (hostNow - seconds);
    },
    caret() {
      const rect = caretPoints();
      if (!rect) return undefined;
      const topLeft = toPixels(rect.origin);
      const bottomRight = toPixels({ x: rect.origin.x + rect.size.width, y: rect.origin.y + rect.size.height });
      return { ...topLeft, width: Math.max(1, bottomRight.x - topLeft.x), height: Math.max(1, bottomRight.y - topLeft.y) };
    },
    watchInput,
    mediaAccess(kind) {
      const status = Number(sendWithObject(objc_getClass('AVCaptureDevice'), sel_registerName('authorizationStatusForMediaType:'), mediaTypes[kind]));
      return AUTHORIZATION[status] ?? 'not-determined';
    },
    foreground() {
      const windows = listed().filter((window) => window.layer === LEVEL.normal);
      // the front app's focused window (an app's small panels may lie in front of it), else its front one
      let front = windows[0];
      if (front && AXIsProcessTrusted()) {
        const app = appElement(front.pid, 0.1);
        const focused = app && copied(app, AXT.focusedWindow);
        const frame = focused ? frameOf(focused) : undefined;
        if (focused) CFRelease(focused);
        if (app) CFRelease(app);
        front = (frame && windows.find((window) => window.pid === front!.pid && near(window.points, frame))) || front;
      }
      const bounds = front && rectToPixels(front.points);
      return front && bounds ? { id: front.id, bounds } : undefined;
    },
    contentArea(id) {
      const window = listed().find((candidate) => candidate.id === id && candidate.layer === LEVEL.normal);
      if (!window || !AXIsProcessTrusted()) return undefined;
      const key = `${id}:${[window.points.x, window.points.y, window.points.width, window.points.height].map(Math.round).join(',')}`;
      if (search?.key !== key) {
        if (search && !search.done) finish(search);
        search = startSearch(window, key);
      }
      if (!search.done) stepSearch(search);
      return search.page && rectToPixels(search.page);
    },
    popups() {
      const list = displays();
      const found: { id: number; kind: WindowKind; bounds: Bounds }[] = [];
      const centre: ListedWindow[] = [];
      for (const { window, kind } of macPopups(listed())) {
        if (kind === 'notification') {
          centre.push(window);
          continue;
        }
        const bounds = rectToPixels(window.points, list);
        if (bounds) found.push({ id: window.id, kind, bounds });
      }
      return [...found, ...notificationPopups(centre, list)];
    },
  };
}
