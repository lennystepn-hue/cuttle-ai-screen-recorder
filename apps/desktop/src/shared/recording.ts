// Messages between the main process and the recorder host (a utility process running `record()`),
// and the pure geometry of picking what to record.
import type { Bounds, CaptureSource, Devices, RecordOptions, RecorderEvent, StopOptions, Take } from '@cuttle/recorder';

/** What the main process asks of the host. */
export type HostRequest =
  | { type: 'devices'; id: number; media: boolean }
  | { type: 'start'; options: Omit<RecordOptions, 'onEvent'> }
  | { type: 'stop' }
  | { type: 'marker'; label?: string }
  | { type: 'retake' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'dead-zones'; zones: Bounds[] };

/** What the host answers and reports. */
export type HostReply =
  | { type: 'devices'; id: number; devices?: Devices; error?: string }
  | { type: 'event'; event: RecorderEvent }
  | { type: 'done'; take: Take }
  | { type: 'failed'; code: string; message: string };

/** A rectangle in DIP (Electron's coordinates). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A display as the picker sees it: its DIP bounds and work area, and the recorder's monitor index. */
export interface PickerDisplay {
  id: number;
  bounds: Rect;
  workArea: Rect;
  scaleFactor: number;
  /** `Monitor.index` of the recorder for this display; undefined when the recorder does not know it. */
  monitor?: number;
  /** Physical pixels (what the take will be). */
  pixels: { width: number; height: number };
  label: string;
}

/** A window under the picker, in DIP of the display it is on. */
export interface PickerWindow {
  id: number;
  title: string;
  className: string;
  bounds: Rect;
  /** Physical size: what a take of it will be. */
  pixels: { width: number; height: number };
}

/** What the person picked. */
export type PickedTarget =
  | { kind: 'screen'; display: number }
  | { kind: 'window'; display: number; window: number }
  | { kind: 'region'; display: number; rect: Rect };

/** The bar's choices, kept between recordings. */
export interface RecordChoices {
  camera?: string;
  mic?: string;
  stop: 'none' | 'claude' | 'idle';
  /** The folder Claude Code runs in, for `stop: 'claude'`. */
  claudeFolder?: string;
}

/** The first window whose bounds contain the point (front to back), or undefined: the display. */
export function windowAt(windows: readonly PickerWindow[], x: number, y: number): PickerWindow | undefined {
  return windows.find(({ bounds }) => x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height);
}

/** Every window under the point, front to back (Tab cycles them). */
export function windowsAt(windows: readonly PickerWindow[], x: number, y: number): PickerWindow[] {
  return windows.filter(({ bounds }) => x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height);
}

/** The rectangle two drag points span, clamped to `area` (a display's bounds, both in DIP). */
export function dragRect(from: { x: number; y: number }, to: { x: number; y: number }, area: Rect, keep16by9 = false): Rect {
  const clampX = (value: number) => Math.min(Math.max(value, area.x), area.x + area.width);
  const clampY = (value: number) => Math.min(Math.max(value, area.y), area.y + area.height);
  const x0 = clampX(from.x);
  const y0 = clampY(from.y);
  let x1 = clampX(to.x);
  let y1 = clampY(to.y);
  if (keep16by9) {
    const width = Math.abs(x1 - x0);
    const height = (width * 9) / 16;
    y1 = clampY(y0 + Math.sign(y1 - y0 || 1) * height);
    x1 = x0 + Math.sign(x1 - x0 || 1) * (Math.abs(y1 - y0) * 16) / 9;
  }
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
}

/**
 * A DIP rectangle on a display in physical pixels of that display (its top-left at 0, 0), whole
 * pixels, inside the display: a display of 2560 px at 150 % is 1706.67 DIP wide, so a region drawn
 * to its right edge would otherwise end at pixel 2561.
 */
export function toDisplayPixels(rect: Rect, display: Pick<PickerDisplay, 'bounds' | 'scaleFactor' | 'pixels'>): Rect {
  const s = display.scaleFactor;
  const clampX = (value: number) => Math.min(Math.max(value, 0), display.pixels.width);
  const clampY = (value: number) => Math.min(Math.max(value, 0), display.pixels.height);
  const x = clampX(Math.round((rect.x - display.bounds.x) * s));
  const y = clampY(Math.round((rect.y - display.bounds.y) * s));
  return { x, y, width: clampX(Math.round((rect.x + rect.width - display.bounds.x) * s)) - x, height: clampY(Math.round((rect.y + rect.height - display.bounds.y) * s)) - y };
}

/**
 * The recorder's monitor that shows a display: the one containing the display's centre (physical
 * pixels). Exact bounds would miss displays whose DIP size is not whole (2560 px at 150 %).
 */
export function monitorAt<T extends { bounds: Bounds }>(monitors: readonly T[], centre: { x: number; y: number }): T | undefined {
  return monitors.find(({ bounds }) => centre.x >= bounds.x && centre.x < bounds.x + bounds.width && centre.y >= bounds.y && centre.y < bounds.y + bounds.height);
}

/** The recorder's capture source for a pick. */
export function captureSourceFor(target: PickedTarget, display: PickerDisplay): CaptureSource {
  if (display.monitor === undefined) throw new Error(`the recorder does not know the display "${display.label}"`);
  switch (target.kind) {
    case 'screen':
      return { kind: 'monitor', index: display.monitor };
    case 'window':
      return { kind: 'window', id: target.window };
    case 'region': {
      const { x, y, width, height } = toDisplayPixels(target.rect, display);
      return { kind: 'region', monitor: display.monitor, rect: [x, y, width, height] };
    }
  }
}

/** The recorder's stop options for the bar's choice. */
export function stopOptionsFor(choices: RecordChoices): StopOptions {
  if (choices.stop === 'claude' && choices.claudeFolder) return { untilClaude: choices.claudeFolder };
  if (choices.stop === 'idle') return { untilIdleSeconds: 10 };
  return {};
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * Where the HUD goes: on the recorded display, where the person looks (on another display it went
 * unseen). The top centre of its work area, else the bottom centre when the top is in what is
 * recorded; the top centre when the target covers both (the HUD is never in the video: content
 * protection keeps it out of the capture, see the P2 spike). DIP.
 */
export function hudPosition(displays: readonly Pick<PickerDisplay, 'id' | 'workArea'>[], recorded: number, target: Rect, size: { width: number; height: number }): { x: number; y: number } {
  const at = (area: Rect, place: 'top' | 'bottom'): Rect => ({
    x: Math.round(area.x + (area.width - size.width) / 2),
    y: place === 'top' ? area.y + 12 : area.y + area.height - size.height - 12,
    ...size,
  });
  const own = displays.find((display) => display.id === recorded) ?? displays[0]!;
  const candidates = [at(own.workArea, 'top'), at(own.workArea, 'bottom')];
  const free = candidates.find((place) => !overlaps(place, target)) ?? candidates[0]!;
  return { x: free.x, y: free.y };
}

/** A recorder warning for the HUD: a few words, and the whole message for its tooltip. */
export function hudWarning(message: string): { text: string; detail: string } {
  const rules: [RegExp, (match: RegExpExecArray) => string][] = [
    [/^the microphone .* records silence/i, () => 'Mic is silent: muted?'],
    [/^markers\.json could not be written/i, () => 'Markers not saved yet'],
    [/^events\.jsonl could not be written/i, () => 'Input log stopped'],
    [/^the (\w+) had not started/i, (match) => `No ${match[1] === 'webcam' ? 'camera' : match[1]} in this take`],
  ];
  for (const [pattern, text] of rules) {
    const match = pattern.exec(message);
    if (match) return { text: text(match), detail: message };
  }
  return { text: message.length > 40 ? `${message.slice(0, 38)}…` : message, detail: message };
}

/**
 * A failed recording for people: one plain sentence for what the person can act on, and the
 * recorder's message (ffmpeg's last lines) as the details.
 */
export function recordingFailure(message: string): { text: string; detail: string } {
  const track = /the (screen|webcam|mic) capture stopped unexpectedly/i.exec(message)?.[1]?.toLowerCase();
  const text =
    track === 'webcam'
      ? 'The camera stopped sending video (unplugged, or taken by another app).'
      : track === 'mic'
        ? 'The microphone stopped (unplugged, or taken by another app).'
        : track === 'screen'
          ? 'The screen capture stopped.'
          : /not found|could not find|no such device/i.test(message)
            ? 'A camera or microphone could not be found.'
            : (message.split('\n')[0] ?? message).replace(/\s*\(ffmpeg[^)]*\)/i, '').slice(0, 200);
  const lines = message.split('\n').filter((line) => line.trim() !== '');
  return { text, detail: lines.slice(-8).join('\n') };
}

/**
 * The camera device among `getUserMedia`'s, for a DirectShow name from the recorder (often cut to 31
 * characters): the first label that starts with the name, ignoring case and a leading "Default - ".
 */
export function matchMediaDevice<T extends { label: string }>(name: string, devices: readonly T[]): T | undefined {
  const normal = (label: string) => label.replace(/^default\s*-\s*/i, '').trim().toLowerCase();
  const wanted = normal(name);
  return devices.find((device) => normal(device.label) === wanted) ?? devices.find((device) => wanted !== '' && normal(device.label).startsWith(wanted));
}

/**
 * Where the picker's bar goes (DIP, the display's top-left at 0, 0): below the target when it fits
 * in the work area, else above the target (and its label), else inside the target near its top;
 * centred on the target and inside the work area, so it never hides what is about to be recorded
 * when there is room elsewhere.
 */
export function barPlacement(target: Rect, area: Rect, bar: { width: number; height: number }, labelAbove: boolean): { x: number; y: number; where: 'below' | 'above' | 'inside' } {
  const gap = 16;
  const x = Math.min(Math.max(target.x + target.width / 2 - bar.width / 2, area.x + 16), Math.max(area.x + 16, area.x + area.width - 16 - bar.width));
  const below = target.y + target.height + gap;
  if (below + bar.height <= area.y + area.height - 8) return { x, y: below, where: 'below' };
  const above = target.y - (labelAbove ? 36 : 0) - gap - bar.height;
  if (above >= area.y + 8) return { x, y: above, where: 'above' };
  return { x, y: Math.min(Math.max(target.y + (labelAbove ? 16 : 52), area.y + 8), area.y + area.height - 8 - bar.height), where: 'inside' };
}

/** Where the target's label goes: above the target when there is room, else inside its top; never off the display. */
export function labelPlacement(target: Rect, area: Rect, label: { width: number }): { x: number; y: number; above: boolean } {
  const above = target.y - 36 >= area.y;
  const x = Math.min(Math.max(target.x, area.x + 16), Math.max(area.x + 16, area.x + area.width - 16 - label.width));
  return { x, y: above ? target.y - 36 : target.y + 8, above };
}

/** The camera bubble's size for a target: 18 % of its shorter side, 48 to 120 DIP. */
export const bubbleSize = (target: Rect) => Math.round(Math.min(120, Math.max(48, Math.min(target.width, target.height) * 0.18)));

/**
 * Where the camera's preview goes: inside the target's bottom left, where the look puts the camera
 * in the video; above the bar when the bar had to go inside the target's lower half; never above
 * `top` (below a label inside the target).
 */
export function bubblePlacement(target: Rect, size: number, bar: { y: number; where: 'below' | 'above' | 'inside' }, top: number): { left: number; top: number } {
  const barInLowerHalf = bar.where === 'inside' && bar.y > target.y + target.height / 2;
  const bottom = Math.min(target.y + target.height, barInLowerHalf ? bar.y : Infinity) - 16;
  return { left: target.x + 16, top: Math.max(top, bottom - size) };
}
