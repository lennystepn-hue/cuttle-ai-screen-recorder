import { describe, expect, it } from 'vitest';
import {
  captureSourceFor,
  dragRect,
  barPlacement,
  bubblePlacement,
  bubbleSize,
  hudPosition,
  hudWarning,
  labelPlacement,
  matchMediaDevice,
  monitorAt,
  prompterPosition,
  recordingFailure,
  scriptForTake,
  stepsFromText,
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

  it('keeps a region drawn to the edge of a display whose DIP size is not whole inside its pixels', () => {
    // 2560×1440 at 150 % is 1706.67×960 DIP; the picker's edge rounds up to 1707
    const odd: PickerDisplay = { ...primary, bounds: { x: 0, y: 0, width: 1707, height: 960 }, scaleFactor: 1.5 };
    expect(toDisplayPixels({ x: 102, y: 100, width: 1605, height: 400 }, odd)).toEqual({ x: 153, y: 150, width: 2407, height: 600 });
  });

  it('finds the monitor that shows a display by its centre, whatever the rounding of its edges', () => {
    const monitors = [
      { index: 0, bounds: { x: 0, y: 0, width: 2560, height: 1440 } },
      { index: 1, bounds: { x: 2560, y: 0, width: 1920, height: 1080 } },
    ];
    // the display's DIP bounds converted back come out a pixel larger (2561 wide)
    expect(monitorAt(monitors, { x: 1280, y: 720 })?.index).toBe(0);
    expect(monitorAt(monitors, { x: 3520, y: 540 })?.index).toBe(1);
    expect(monitorAt(monitors, { x: 9000, y: 0 })).toBeUndefined();
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

  it('puts the HUD on the recorded display, where the person looks: the top centre, else the bottom, outside what is recorded when it fits', () => {
    const size = { width: 360, height: 60 };
    const displays = [primary, second];
    expect(hudPosition(displays, 2, { x: 2300, y: 600, width: 400, height: 300 }, size)).toEqual({ x: 2048 + 780, y: 419 });
    // a window at the top of the display: the bottom
    expect(hudPosition(displays, 1, { x: 700, y: 0, width: 600, height: 400 }, size)).toEqual({ x: 844, y: 1104 - 72 });
    // the whole display, with another one beside it: still the top of the recorded one (on another
    // display the HUD went unseen; it is never in the video anyway)
    expect(hudPosition(displays, 1, primary.bounds, size)).toEqual({ x: 844, y: 12 });
    expect(hudPosition(displays, 2, second.bounds, size)).toEqual({ x: 2048 + 780, y: 419 });
    // one display, all of it recorded: the top
    expect(hudPosition([primary], 1, primary.bounds, size)).toEqual({ x: 844, y: 12 });
  });

  it('says what went wrong in a few plain words, with the details apart', () => {
    expect(hudWarning('the microphone "Headset (Jabra)" records silence: it may be muted, or blocked').text).toBe('Mic is silent: muted?');
    expect(hudWarning('the webcam had not started when the recording was stopped; it is left out of the take').text).toBe('No camera in this take');
    const failed = recordingFailure('the webcam capture stopped unexpectedly (ffmpeg exit code 0): Side data:\n[libx264 @ 0x1] kb/s:374.97\n(what was recorded is in takes/1)');
    expect(failed.text).toBe('The camera stopped sending video (unplugged, or taken by another app).');
    expect(failed.detail).toContain('kb/s:374.97');
    expect(recordingFailure('the recorder stopped unexpectedly (exit code 3); the capture was ended').text).toBe('the recorder stopped unexpectedly (exit code 3); the capture was ended');
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

describe('the picker’s layout', () => {
  const area = { x: 0, y: 0, width: 2048, height: 1104 };
  const bar = { width: 1000, height: 52 };
  it('puts the bar below the target, else above it, else inside near its top, centred and inside the work area', () => {
    expect(barPlacement({ x: 100, y: 100, width: 600, height: 400 }, area, bar, true)).toEqual({ x: 16, y: 516, where: 'below' });
    expect(barPlacement({ x: 600, y: 500, width: 800, height: 580 }, area, bar, true)).toEqual({ x: 500, y: 396, where: 'above' });
    expect(barPlacement({ x: 0, y: 0, width: 2048, height: 1104 }, area, bar, false)).toEqual({ x: 524, y: 52, where: 'inside' });
  });

  it('keeps the label on the display, inside the target when there is no room above', () => {
    expect(labelPlacement({ x: 1900, y: 200, width: 148, height: 100 }, area, { width: 300 })).toEqual({ x: 1732, y: 164, above: true });
    expect(labelPlacement({ x: 0, y: 10, width: 400, height: 300 }, area, { width: 200 })).toEqual({ x: 16, y: 18, above: false });
  });

  it('starts inside a whole display below the macOS menu bar, so the hint above the bar stays clear of it', () => {
    const mac = { x: 0, y: 30, width: 1440, height: 808 };
    const display = { x: 0, y: 0, width: 1440, height: 900 };
    expect(barPlacement(display, mac, { width: 780, height: 52 }, false)).toEqual({ x: 330, y: 82, where: 'inside' });
    expect(labelPlacement(display, mac, { width: 430 })).toEqual({ x: 16, y: 38, above: false });
  });

  it('sizes the camera bubble to the target', () => {
    expect([bubbleSize({ x: 0, y: 0, width: 200, height: 90 }), bubbleSize({ x: 0, y: 0, width: 640, height: 360 }), bubbleSize({ x: 0, y: 0, width: 2048, height: 1104 })]).toEqual([48, 65, 120]);
  });

  it('puts the camera bubble in the bottom left of the target, above the bar only when the bar is inside its lower half', () => {
    const display = { x: 0, y: 0, width: 2048, height: 1104 };
    // a whole display: the bar is inside near the top, the bubble stays at the bottom
    expect(bubblePlacement(display, 120, { y: 52, where: 'inside' }, 8)).toEqual({ left: 16, top: 968 });
    // the bar inside the lower half (a label above): the bubble sits above it
    expect(bubblePlacement({ x: 100, y: 500, width: 800, height: 604 }, 108, { y: 900, where: 'inside' }, 508)).toEqual({ left: 116, top: 776 });
    // a bar below or above leaves the bubble alone; a short target keeps it under the label inside
    expect(bubblePlacement({ x: 0, y: 0, width: 300, height: 90 }, 48, { y: 106, where: 'below' }, 44)).toEqual({ left: 16, top: 44 });
  });
});

describe('the script', () => {
  const area = { x: 0, y: 0, width: 2048, height: 1104 };
  const size = { width: 512, height: 180 };

  it('puts the prompter right under the HUD at the top, right over it at the bottom, inside the work area', () => {
    expect(prompterPosition({ x: 768, y: 12, width: 512, height: 64 }, area, size)).toEqual({ x: 768, y: 66, below: true });
    expect(prompterPosition({ x: 768, y: 1028, width: 512, height: 64 }, area, size)).toEqual({ x: 768, y: 858, below: false });
    // a HUD dragged to the edge: the prompter stays on the display
    expect(prompterPosition({ x: 1700, y: 12, width: 512, height: 64 }, area, size).x).toBe(2048 - 512);
  });

  it('makes steps of a pasted list: one per line, numbers and bullets dropped, indented lines as the note', () => {
    const text = '1. Open the settings\r\n   The gear, top right.\r\n   Say it is one click.\n\n- Turn on dark mode\n* Export the video\n• ' + 'x'.repeat(90);
    expect(stepsFromText(text, 80)).toEqual([
      { title: 'Open the settings', note: 'The gear, top right.\nSay it is one click.' },
      { title: 'Turn on dark mode' },
      { title: 'Export the video' },
      { title: 'x'.repeat(80) },
    ]);
    // an indented first line has no step to belong to: it is a step
    expect(stepsFromText('  Just this', 80)).toEqual([{ title: 'Just this' }]);
  });

  it('records with the steps that have a title, each with an id no other item of the project has', () => {
    const typed = [
      { id: 'step1', title: ' Open the settings ', note: '  ' },
      { id: 'step2', title: '' },
      { id: 'z1', title: 'Turn on dark mode', note: ' The switch. ' },
      { id: 'step1', title: 'Export' },
    ];
    expect(scriptForTake(typed, new Set(['z1', 's1']))).toEqual([
      { id: 'step1', title: 'Open the settings' },
      { id: 'step2', title: 'Turn on dark mode', note: 'The switch.' },
      { id: 'step3', title: 'Export' },
    ]);
  });
});
