// The drawer at the top centre (#171): where the pill waits when the settings say "in the top edge".
// The pointer resting on the middle of a display's top edge opens it, out of the notch on a Mac
// that has one, from under the menu bar's middle on one that has none, from the top edge on
// Windows; it closes a moment after the pointer left it. Plain rects (DIP) and times: the main
// process gives the pointer, the displays and their notches.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A display as the drawer sees it; `notch`: the camera's notch, centred at the top (macOS). */
export interface DrawerDisplay {
  id: number;
  bounds: Rect;
  workArea: Rect;
  notch?: { width: number; height: number };
}

/** Where the drawer's shape grows from: the notch, the menu bar's middle (macOS), the top edge (Windows). */
export type DrawerOrigin = 'notch' | 'bar' | 'edge';

export const DRAWER = {
  /** How long the pointer rests on the top edge before the drawer opens. */
  dwellMs: 250,
  /** How long after the pointer left it the drawer closes. */
  closeMs: 600,
  /** How long it stays open after the tray or the app's start showed it, wherever the pointer is. */
  shownMs: 2500,
  /** The top edge's strip that opens it, without a notch: this wide, this deep. */
  zoneWidth: 200,
  zoneDepth: 3,
  /** Room around the drawer the pointer may stray into without closing it. */
  slack: 12,
  /** How long its opening and its closing take (the CSS's too). */
  openMs: 360,
  closeAnimMs: 200,
} as const;

const inside = (rect: Rect, x: number, y: number, slack = 0) => x >= rect.x - slack && x < rect.x + rect.width + slack && y >= rect.y - slack && y < rect.y + rect.height + slack;

/** The strip of a display's top edge the pointer rests on to open the drawer: the notch, or the edge's middle. */
export function drawerZone(display: DrawerDisplay): Rect {
  const width = display.notch?.width ?? DRAWER.zoneWidth;
  return { x: Math.round(display.bounds.x + (display.bounds.width - width) / 2), y: display.bounds.y, width, height: display.notch?.height ?? DRAWER.zoneDepth };
}

/**
 * The drawer's window on a display, `size` the open drawer without the notch: centred, at the top
 * of the screen over a notch (the notch's height above the drawer), else right under the menu bar
 * or a taskbar at the top. `mac`: macOS (no notch: the menu bar's middle), else the top edge.
 */
export function drawerPlace(display: DrawerDisplay, size: { width: number; height: number }, mac: boolean): { window: Rect; origin: DrawerOrigin } {
  const { bounds, workArea, notch } = display;
  const width = Math.min(bounds.width, Math.max(size.width, notch?.width ?? 0));
  const x = Math.round(bounds.x + (bounds.width - width) / 2);
  if (notch) return { window: { x, y: bounds.y, width, height: notch.height + size.height }, origin: 'notch' };
  return { window: { x, y: workArea.y, width, height: size.height }, origin: mac ? 'bar' : 'edge' };
}

export type DrawerState =
  | { phase: 'closed' }
  | { phase: 'arming'; display: number; since: number }
  /** `window`: where it is open; `until`: shown on purpose, it stays until then wherever the pointer is. */
  | { phase: 'open'; display: number; window: Rect; until?: number }
  | { phase: 'leaving'; display: number; window: Rect; since: number };

export interface DrawerInput {
  now: number;
  pointer: { x: number; y: number };
  /** A mouse button is held (a window dragged to the top, text selected): it never opens then. */
  buttons: boolean;
  displays: readonly DrawerDisplay[];
  /** Something of the drawer's is open (its menu): it does not close meanwhile. */
  keep: boolean;
}

/** The drawer one tick later: its state, and `open` (on a display, at a window) or `close` when it changes. */
export function drawerNext(state: DrawerState, input: DrawerInput, place: (display: DrawerDisplay) => Rect): { state: DrawerState; action?: { open: DrawerDisplay } | 'close' } {
  const { now, pointer } = input;
  const zoneOf = () => input.displays.find((display) => inside(drawerZone(display), pointer.x, pointer.y));
  switch (state.phase) {
    case 'closed': {
      const display = input.buttons ? undefined : zoneOf();
      return { state: display ? { phase: 'arming', display: display.id, since: now } : state };
    }
    case 'arming': {
      const display = input.buttons ? undefined : zoneOf();
      if (!display || display.id !== state.display) return { state: { phase: 'closed' } };
      if (now - state.since < DRAWER.dwellMs) return { state };
      return { state: { phase: 'open', display: display.id, window: place(display) }, action: { open: display } };
    }
    case 'open':
    case 'leaving': {
      const over = inside(state.window, pointer.x, pointer.y, DRAWER.slack) || inside(drawerZone(input.displays.find((display) => display.id === state.display) ?? { id: -1, bounds: state.window, workArea: state.window }), pointer.x, pointer.y);
      const held = input.keep || (state.phase === 'open' && state.until !== undefined && now < state.until);
      if (over || held) return { state: { phase: 'open', display: state.display, window: state.window } };
      if (state.phase === 'open') return { state: { phase: 'leaving', display: state.display, window: state.window, since: now } };
      if (now - state.since < DRAWER.closeMs) return { state };
      return { state: { phase: 'closed' }, action: 'close' };
    }
  }
}

/** Where a spring of this damping ratio is at `t` (0 to 1 of the animation), settled by its end. */
export function springAt(t: number, damping: number): number {
  // fast enough to settle within the animation: what is left at its end is under half a percent
  const omega = damping >= 1 ? 7.5 : 5.5 / damping;
  if (damping >= 1) return 1 - Math.exp(-omega * t) * (1 + omega * t);
  const damped = omega * Math.sqrt(1 - damping * damping);
  return 1 - Math.exp(-damping * omega * t) * (Math.cos(damped * t) + ((damping * omega) / damped) * Math.sin(damped * t));
}

/**
 * A spring as CSS `linear()` easing, sampled so the browser draws it at any refresh rate: at a
 * damping ratio of 0.7 it goes about 4.6 % past the end and settles back (the drawer's opening); 1
 * is a plain ease-out.
 */
export function springEasing(damping = 0.7, points = 48): string {
  const values: string[] = [];
  for (let i = 0; i <= points; i++) values.push(String(i === points ? 1 : Math.round(springAt(i / points, damping) * 1000) / 1000));
  return `linear(${values.join(', ')})`;
}
