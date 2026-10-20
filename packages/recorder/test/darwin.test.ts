import { describe, expect, it } from 'vitest';
import { CURSOR_SIGNATURES, cursorSignature, displayOf, eventWallTime, frontWindow, LEVEL, macPopups, NOTIFICATION_CENTER, pageOf, pixelMapper, type ListedWindow } from '../src/darwin';

// A 1440×900 point Retina display (2880×1800 pixels) with a 1920×1080 display at 1× to its right,
// and one at 2× above it.
const retina = { id: 1, points: { x: 0, y: 0, width: 1440, height: 900 }, scale: 2 };
const external = { id: 2, points: { x: 1440, y: 100, width: 1920, height: 1080 }, scale: 1 };
const above = { id: 3, points: { x: 0, y: -1080, width: 1920, height: 1080 }, scale: 2 };

describe('pixelMapper', () => {
  it('maps points on a Retina display to its backing pixels', () => {
    const map = pixelMapper([retina]);
    expect(map.origin(retina)).toEqual({ x: 0, y: 0 });
    expect(map.toPixels(720.5, 450.25)).toEqual({ x: 1441, y: 901 });
  });

  it('places every display at its point origin times the largest scale, so none overlaps another', () => {
    const map = pixelMapper([retina, external, above]);
    expect(map.origin(external)).toEqual({ x: 2880, y: 200 });
    expect(map.origin(above)).toEqual({ x: 0, y: -2160 });
    // a point on the 1× display moves one pixel per point there, starting at its origin
    expect(map.toPixels(1440 + 10, 100 + 20)).toEqual({ x: 2890, y: 220 });
    // the Retina display's last point stays left of the external display's first pixel
    expect(map.toPixels(1439, 10).x).toBeLessThan(2880);
  });

  it('maps a point off every display onto the nearest one', () => {
    expect(pixelMapper([retina]).toPixels(-5, 10)).toEqual({ x: -10, y: 20 });
  });
});

describe('displayOf', () => {
  it('finds the display that holds most of a window', () => {
    expect(displayOf([retina, external], { x: 1300, y: 200, width: 400, height: 300 })).toBe(external);
    expect(displayOf([retina, external], { x: 1000, y: 200, width: 400, height: 300 })).toBe(retina);
    expect(displayOf([retina], { x: 5000, y: 5000, width: 10, height: 10 })).toBeUndefined();
  });
});

describe('eventWallTime', () => {
  // an M1's mach ticks: 125/3 ns each
  const ticks = { numer: 125n, denom: 3n };
  const now = { wall: 1_000_000, uptimeNs: 500_000_000_000n, machNs: 500_000_000_000n };

  it('reads a timestamp in nanoseconds of the uptime clock', () => {
    expect(eventWallTime(now.uptimeNs - 40_000_000n, now, ticks)).toBeCloseTo(now.wall - 0.04, 6);
  });

  it('reads a timestamp in mach ticks', () => {
    const stamp = ((now.machNs - 150_000_000n) * ticks.denom) / ticks.numer;
    expect(eventWallTime(stamp, now, ticks)).toBeCloseTo(now.wall - 0.15, 4);
  });

  it('takes the wall clock for an event without a timestamp or one that fits neither clock', () => {
    expect(eventWallTime(0n, now, ticks)).toBe(now.wall);
    expect(eventWallTime(now.uptimeNs + 1_000_000_000n, now, ticks)).toBe(now.wall);
  });
});

describe('cursor signatures', () => {
  it('names a cursor by its hotspot and size, rounded', () => {
    expect(cursorSignature({ x: 12.2, y: 10.6 }, { width: 23, height: 22.4 })).toBe('12,11,23,22');
    const shapes = new Map(CURSOR_SIGNATURES);
    expect(shapes.get(cursorSignature({ x: 5, y: 5 }, { width: 28, height: 40 }))).toBe('arrow');
    expect(shapes.get(cursorSignature({ x: 12, y: 11 }, { width: 23, height: 22 }))).toBe('text');
    expect(new Set(CURSOR_SIGNATURES.map(([signature]) => signature)).size).toBe(CURSOR_SIGNATURES.length);
  });
});

// windows as the probes on macOS 27 listed them (points, front to back)
const listed = (id: number, pid: number, layer: number, [x, y, width, height]: [number, number, number, number], bundle = 'com.apple.TextEdit'): ListedWindow => ({ id, pid, layer, points: { x, y, width, height }, bundle });

describe('macPopups', () => {
  it('takes modal panels (an alert, a save panel) for dialogs and pop-up menus for menus', () => {
    const windows = [listed(1, 50, LEVEL.modalPanel, [510, 199, 420, 132], 'com.apple.ScriptEditor.id.osascript'), listed(2, 60, LEVEL.popUpMenu, [300, 100, 220, 180]), listed(3, 70, LEVEL.normal, [0, 30, 1440, 808])];
    expect(macPopups(windows).map(({ window, kind }) => [window.id, kind])).toEqual([
      [1, 'dialog'],
      [2, 'menu'],
    ]);
  });

  it('takes a sheet for a dialog: smaller, centred inside the window of its app right behind it', () => {
    // TextEdit's save sheet over its document
    const sheet = listed(3053, 86403, 0, [261, 228, 404, 218]);
    const document = listed(3049, 86403, 0, [170, 93, 586, 488]);
    expect(macPopups([sheet, document]).map(({ window, kind }) => [window.id, kind])).toEqual([[3053, 'dialog']]);
    // not centred (a palette), another app's, or as large as the window: none
    expect(macPopups([listed(4, 86403, 0, [180, 100, 200, 200]), document])).toEqual([]);
    expect(macPopups([{ ...sheet, pid: 1 }, document])).toEqual([]);
    expect(macPopups([listed(5, 86403, 0, [171, 94, 584, 486]), document])).toEqual([]);
  });

  it('takes the Notification Center over the screen for a notification, not its widgets on the desktop', () => {
    const banner = listed(16, 853, 21, [0, 0, 1440, 900], NOTIFICATION_CENTER);
    const widget = listed(19, 853, -2147483601, [188, 38, 180, 180], NOTIFICATION_CENTER);
    expect(macPopups([banner, widget]).map(({ window, kind }) => [window.id, kind])).toEqual([[16, 'notification']]);
  });
});

describe('frontWindow', () => {
  // the Claude app's window, picked for a window take, and the 66×20 point window it shows over its
  // buttons while that window is captured (as CGWindowList gave them on macOS 27)
  const claude = listed(11048, 55179, 0, [149, 37, 1200, 800]);
  const buttons = listed(12307, 55179, 0, [155, 43, 66, 20]);

  it("takes a small window of the front app inside another of its windows for that window", () => {
    expect(frontWindow([buttons, claude, listed(1039, 1889, 0, [0, 30, 1440, 808])])?.id).toBe(11048);
    // a sheet over its document, too
    expect(frontWindow([listed(3053, 86403, 0, [261, 228, 404, 218]), listed(3049, 86403, 0, [170, 93, 586, 488])])?.id).toBe(3049);
  });

  it("keeps the first window when it is another app's, or as large as the window around it", () => {
    expect(frontWindow([{ ...buttons, pid: 1 }, claude])?.id).toBe(12307);
    expect(frontWindow([listed(7, 55179, 0, [160, 50, 1100, 760]), claude])?.id).toBe(7);
    expect(frontWindow([claude])?.id).toBe(11048);
    expect(frontWindow([])).toBeUndefined();
  });
});

describe('pageOf', () => {
  const window = { x: 0, y: 30, width: 1440, height: 808 };
  it("takes a web area (Safari's, Firefox's), inside the window", () => {
    expect(pageOf(window, { webArea: { x: 0, y: 110, width: 1440, height: 760 } }, false)).toEqual({ x: 0, y: 110, width: 1440, height: 728 });
  });

  it("takes what lies below a Chromium browser's toolbar, and nothing for other apps", () => {
    // Opera: its toolbar at 56,74 1380×36
    const toolbar = { x: 56, y: 74, width: 1380, height: 36 };
    expect(pageOf(window, { toolbar }, true)).toEqual({ x: 0, y: 110, width: 1440, height: 728 });
    expect(pageOf(window, { toolbar }, false)).toBeUndefined();
    expect(pageOf(window, {}, true)).toBeUndefined();
  });
});
