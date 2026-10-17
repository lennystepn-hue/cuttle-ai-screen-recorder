// Messages between the main process and the recorder host (a utility process running `record()`),
// and the pure geometry of picking what to record.
import type { Bounds, CaptureSource, Devices, RecordOptions, RecorderEvent, StopOptions, Take } from '@cuttle/recorder';

/** What the main process asks of the host. */
export type HostRequest =
  | { type: 'devices'; id: number; media: boolean }
  | { type: 'start'; options: Omit<RecordOptions, 'onEvent'> }
  | { type: 'stop' }
  | { type: 'marker'; label?: string }
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

/** A DIP rectangle on a display in physical pixels of that display (its top-left at 0, 0), whole pixels. */
export function toDisplayPixels(rect: Rect, display: Pick<PickerDisplay, 'bounds' | 'scaleFactor'>): Rect {
  const s = display.scaleFactor;
  const x = Math.round((rect.x - display.bounds.x) * s);
  const y = Math.round((rect.y - display.bounds.y) * s);
  return { x, y, width: Math.round((rect.x + rect.width - display.bounds.x) * s) - x, height: Math.round((rect.y + rect.height - display.bounds.y) * s) - y };
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

/**
 * Where the HUD goes: top centre of the display's work area, 12 DIP below its top edge, clamped
 * inside the work area. `size` is the HUD's size in DIP.
 */
export function hudPosition(display: Pick<PickerDisplay, 'workArea'>, size: { width: number; height: number }): { x: number; y: number } {
  const area = display.workArea;
  return { x: Math.round(area.x + (area.width - size.width) / 2), y: area.y + 12 };
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
