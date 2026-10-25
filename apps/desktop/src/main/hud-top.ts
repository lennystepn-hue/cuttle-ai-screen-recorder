// The HUD at the top edge during a take (#171, step 3): with the settings' "At the top edge" the
// HUD's window sits at the top centre of the recorded display, collapsed into an island (beside the
// notch, or a small pill under the menu bar's middle) with the red dot, the mic's level and the
// time. The pointer resting on the island opens the whole HUD (and the prompter under it) on the
// drawer's spring; a moment after it left the HUD and the prompter, it collapses again. Collapsed,
// the window lets the clicks through to what lies under it, and only the island is a dead zone of
// the input log.
import { screen, type BrowserWindow, type Rectangle } from 'electron';
import { drawerNext, drawerPlace, islandRect, DRAWER, type DrawerDisplay, type DrawerOrigin, type DrawerState, type Rect } from '../shared/drawer';
import { buttonHeld, drawerDisplays, pointerNow, watchTopEdge } from './drawer';
import { send } from './ipc';

const TICK_MS = 100;

/** Where the HUD goes at the top edge of a display (DIP): its window open, and where it comes from. */
export async function hudTopPlace(displayId: number, size: { width: number; height: number }): Promise<{ display: DrawerDisplay; window: Rect; origin: DrawerOrigin }> {
  await watchTopEdge();
  const display =
    drawerDisplays().find((candidate) => candidate.id === displayId) ??
    (() => {
      const nearest = screen.getPrimaryDisplay();
      return { id: nearest.id, bounds: nearest.bounds, workArea: nearest.workArea };
    })();
  const { window, origin } = drawerPlace(display, size, process.platform === 'darwin');
  return { display, window, origin };
}

export interface HudAtTop {
  /** The HUD is open (or closing a moment after the pointer left it). */
  readonly open: boolean;
  /** Where the input log takes no clicks: the island, or the open HUD's window. */
  zones(): Rectangle[];
  stop(): void;
}

const inside = (rect: Rectangle, point: { x: number; y: number }, slack: number) => point.x >= rect.x - slack && point.x < rect.x + rect.width + slack && point.y >= rect.y - slack && point.y < rect.y + rect.height + slack;

/**
 * Keeps the HUD at the top edge: collapsed until the pointer rests on its island, open while the
 * pointer is on it or on `prompter`, collapsed again after. `changed` hears each change (the
 * prompter shows with it, the dead zones follow it). Starts collapsed; its page gets `hud:top`.
 */
export function hudAtTop(hud: BrowserWindow, place: { display: DrawerDisplay; window: Rect; origin: DrawerOrigin }, prompter: () => BrowserWindow | undefined, changed: (open: boolean) => void): HudAtTop {
  const { display, window, origin } = place;
  let state: DrawerState = { phase: 'closed' };
  const show = (open: boolean) => {
    if (hud.isDestroyed()) return;
    send(hud.webContents, 'hud:top', { open, origin, ...(display.notch && { notch: display.notch }) });
    // collapsed it lets the clicks through to what lies under it; open, its buttons take them
    if (open) hud.setIgnoreMouseEvents(false);
    else hud.setIgnoreMouseEvents(true, { forward: true });
    changed(open);
  };
  show(false);
  const timer = setInterval(() => {
    const pointer = pointerNow();
    const beside = prompter();
    const keep = beside !== undefined && !beside.isDestroyed() && beside.isVisible() && inside(beside.getBounds(), pointer, DRAWER.slack);
    const next = drawerNext(state, { now: Date.now(), pointer, buttons: buttonHeld(), displays: [display], keep }, () => window, islandRect);
    state = next.state;
    if (next.action === 'close') show(false);
    else if (next.action) show(true);
  }, TICK_MS);
  return {
    get open() {
      return state.phase === 'open' || state.phase === 'leaving';
    },
    zones() {
      return state.phase === 'open' || state.phase === 'leaving' ? [window] : [islandRect(display)];
    },
    stop: () => clearInterval(timer),
  };
}
