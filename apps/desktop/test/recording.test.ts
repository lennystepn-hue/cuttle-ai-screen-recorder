import { describe, expect, it } from 'vitest';
import {
  captureSourceFor,
  dragRect,
  hudPosition,
  matchMediaDevice,
  stopOptionsFor,
  toDisplayPixels,
  windowAt,
  windowsAt,
  type PickerDisplay,
  type PickerWindow,
} from '../src/shared/recording';

// The primary display of the spike machine: 2560×1440 pixels at 125 %, 2048×1152 DIP.
const primary: PickerDisplay = {
  id: 1,
  bounds: { x: 0, y: 0, width: 2048, height: 1152 },
  workArea: { x: 0, y: 0, width: 2048, height: 1104 },
  scaleFactor: 1.25,
  monitor: 0,
  pixels: { width: 2560, height: 1440 },
  label: 'Q24h-10',
};
// A second display to the right, 1920×1080 at 100 %.
const second: PickerDisplay = { ...primary, id: 2, bounds: { x: 2048, y: 407, width: 1920, height: 1080 }, workArea: { x: 2048, y: 407, width: 1920, height: 1040 }, scaleFactor: 1, monitor: 1 };

const window = (id: number, x: number, y: number, width: number, height: number): PickerWindow => ({
  id,
  title: `w${id}`,
  className: 'C',
  bounds: { x, y, width, height },
  pixels: { width: width * 1.25, height: height * 1.25 },
});

describe('hit testing', () => {
  const windows = [window(1, 100, 100, 400, 300), window(2, 300, 200, 600, 400), window(3, 0, 0, 2048, 1104)];
  it('takes the frontmost window under the point, and lists every one for Tab', () => {
    expect(windowAt(windows, 350, 250)?.id).toBe(1);
    expect(windowAt(windows, 800, 500)?.id).toBe(2);
    expect(windowAt(windows, 1500, 900)?.id).toBe(3);
    expect(windowAt(windows, 1500, 1110)).toBeUndefined();
    expect(windowsAt(windows, 350, 250).map((found) => found.id)).toEqual([1, 2, 3]);
    // right and bottom edges are outside
    expect(windowAt([window(1, 0, 0, 10, 10)], 10, 5)).toBeUndefined();
  });
});

describe('dragRect', () => {
  const area = primary.bounds;
  it('spans the two points in either direction, clamped to the display', () => {
    expect(dragRect({ x: 300, y: 200 }, { x: 100, y: 50 }, area)).toEqual({ x: 100, y: 50, width: 200, height: 150 });
    expect(dragRect({ x: 1900, y: 1000 }, { x: 2400, y: 1300 }, area)).toEqual({ x: 1900, y: 1000, width: 148, height: 152 });
  });

  it('keeps 16:9 when asked', () => {
    expect(dragRect({ x: 100, y: 100 }, { x: 420, y: 999 }, area, true)).toEqual({ x: 100, y: 100, width: 320, height: 180 });
    expect(dragRect({ x: 500, y: 500 }, { x: 180, y: 0 }, area, true)).toEqual({ x: 180, y: 320, width: 320, height: 180 });
  });
});

describe('from a pick to the recorder', () => {
  it('turns DIP on a scaled display into whole pixels of that display', () => {
    expect(toDisplayPixels({ x: 100.2, y: 80, width: 640.4, height: 360 }, primary)).toEqual({ x: 125, y: 100, width: 801, height: 450 });
    expect(toDisplayPixels({ x: 2148, y: 507, width: 640, height: 360 }, second)).toEqual({ x: 100, y: 100, width: 640, height: 360 });
  });

  it('records a screen by its monitor, a window by its id and a region in monitor pixels', () => {
    expect(captureSourceFor({ kind: 'screen', display: 2 }, second)).toEqual({ kind: 'monitor', index: 1 });
    expect(captureSourceFor({ kind: 'window', display: 1, window: 77 }, primary)).toEqual({ kind: 'window', id: 77 });
    expect(captureSourceFor({ kind: 'region', display: 1, rect: { x: 0, y: 0, width: 1024, height: 576 } }, primary)).toEqual({
      kind: 'region',
      monitor: 0,
      rect: [0, 0, 1280, 720],
    });
    expect(() => captureSourceFor({ kind: 'screen', display: 3 }, { ...primary, monitor: undefined })).toThrow('the recorder does not know the display "Q24h-10"');
  });

  it("stops on Claude's answer in the chosen folder, on an idle screen, or by hand", () => {
    expect(stopOptionsFor({ stop: 'claude', claudeFolder: 'C:\\demo' })).toEqual({ untilClaude: 'C:\\demo' });
    expect(stopOptionsFor({ stop: 'claude' })).toEqual({});
    expect(stopOptionsFor({ stop: 'idle' })).toEqual({ untilIdleSeconds: 10 });
    expect(stopOptionsFor({ stop: 'none' })).toEqual({});
  });

  it('puts the HUD at the top centre of the work area', () => {
    expect(hudPosition(second, { width: 360, height: 60 })).toEqual({ x: 2048 + 780, y: 419 });
  });
});

describe('matchMediaDevice', () => {
  const devices = [{ label: 'Default - Microphone Array (AMD Audio Device)' }, { label: 'Logitech BRIO Webcam (046d:085e)' }, { label: 'Logi C920' }];
  it("finds the browser's device for a DirectShow name, also one cut to 31 characters", () => {
    expect(matchMediaDevice('Microphone Array (AMD Audio Device)', devices)).toBe(devices[0]);
    expect(matchMediaDevice('Logitech BRIO Webcam (046d:085', devices)).toBe(devices[1]);
    expect(matchMediaDevice('logi c920', devices)).toBe(devices[2]);
    expect(matchMediaDevice('Elgato Facecam', devices)).toBeUndefined();
    expect(matchMediaDevice('', devices)).toBeUndefined();
  });
});
