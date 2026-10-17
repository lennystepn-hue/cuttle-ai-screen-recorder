// Electron's DIP and the recorder's desktop pixels. Windows: physical screen pixels, which Electron
// converts itself. macOS (Electron has no conversion there): a display's backing pixels, placed as the
// recorder's darwin.ts places them, which its monitors' bounds say; a DIP (a point) on a display is
// `scaleFactor` pixels from the next.
import { screen, type Display, type Rectangle } from 'electron';
import type { Monitor } from '@cuttle/recorder';
import { monitorAt } from '../shared/recording';

const mac = process.platform === 'darwin';

/** The recorder's monitors as last listed: macOS places the displays in pixels by them. */
let known: readonly Monitor[] = [];

export function setMonitors(monitors: readonly Monitor[]): void {
  known = monitors;
}

/** The recorder's monitor that shows a display (Windows: the one holding its centre; macOS: by its id). */
export function monitorOf(display: Display, monitors: readonly Monitor[] = known): Monitor | undefined {
  if (mac) return monitors.find((monitor) => monitor.displayId === display.id);
  return monitorAt(monitors, screen.dipToScreenPoint({ x: display.bounds.x + display.bounds.width / 2, y: display.bounds.y + display.bounds.height / 2 }));
}

/** A display's size in pixels: what a take of all of it is. */
export function displayPixels(display: Display): { width: number; height: number } {
  if (mac) return { width: Math.round(display.bounds.width * display.scaleFactor), height: Math.round(display.bounds.height * display.scaleFactor) };
  const physical = screen.dipToScreenRect(null, display.bounds);
  return { width: physical.width, height: physical.height };
}

/** A DIP rectangle in desktop pixels. */
export function toDesktopPixels(rect: Rectangle): Rectangle {
  if (!mac) return screen.dipToScreenRect(null, rect);
  const display = screen.getDisplayMatching(rect);
  const monitor = monitorOf(display);
  const origin = monitor?.bounds ?? display.bounds;
  const s = display.scaleFactor;
  const x = Math.round(origin.x + (rect.x - display.bounds.x) * s);
  const y = Math.round(origin.y + (rect.y - display.bounds.y) * s);
  return { x, y, width: Math.round(origin.x + (rect.x + rect.width - display.bounds.x) * s) - x, height: Math.round(origin.y + (rect.y + rect.height - display.bounds.y) * s) - y };
}

/** A rectangle in desktop pixels in DIP. */
export function toDip(rect: Rectangle): Rectangle {
  if (!mac) return screen.screenToDipRect(null, rect);
  const centre = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const monitor = monitorAt(known, centre);
  const display = monitor && screen.getAllDisplays().find((candidate) => candidate.id === monitor.displayId);
  if (!monitor || !display) return rect;
  const s = display.scaleFactor;
  return {
    x: display.bounds.x + (rect.x - monitor.bounds.x) / s,
    y: display.bounds.y + (rect.y - monitor.bounds.y) / s,
    width: rect.width / s,
    height: rect.height / s,
  };
}
