// The drawer at the top centre (#171, `shared/drawer.ts`): with the settings' "In the top edge" the
// pill waits out of sight, and the pointer resting on the middle of a display's top edge brings it
// out. The pointer is read ten times a second (no permission needed), the notches and a held mouse
// button through the recorder's platform code. The pill's window is placed and shown here; its page
// animates the drawer opening and closing (`pill:drawer`) and the window goes once it has closed.
import { screen, type BrowserWindow } from 'electron';
import { topEdge } from '@cuttle/recorder';
import { DRAWER, drawerNext, drawerPlace, type DrawerDisplay, type DrawerState } from '../shared/drawer';
import { CHECK, HIDDEN, TEST_BACKEND } from './check';
import { send } from './ipc';

export interface DrawerHost {
  /** The pill's window, made when it is first needed. */
  window(): Promise<BrowserWindow>;
  /** The open drawer's size without a notch: the pill and its shadow's margin. */
  size(): { width: number; height: number };
  /** A picker or a take is under way: the drawer stays shut. */
  busy(): boolean;
}

/** What the check gives in place of the pointer, a held button and the main display's notch. */
export interface CheckDrawer {
  pointer?: { x: number; y: number };
  buttons?: boolean;
  notch?: { width: number; height: number };
}
const checkDrawer = () => (CHECK ? (globalThis as { __drawerCheck?: CheckDrawer }).__drawerCheck : undefined);

const TICK_MS = 100;
let host: DrawerHost | undefined;
let state: DrawerState = { phase: 'closed' };
let timer: ReturnType<typeof setInterval> | undefined;
let hiding: ReturnType<typeof setTimeout> | undefined;
/** The drawer's own menu is open: it does not close meanwhile. */
let keep = false;
let edge: Awaited<ReturnType<typeof topEdge>> | undefined;
let notches: { display: number; width: number; height: number }[] = [];
let watchingDisplays = false;

function displays(): DrawerDisplay[] {
  const fake = checkDrawer()?.notch;
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((display) => {
    const notch = fake && display.id === primary ? fake : notches.find((candidate) => candidate.display === display.id);
    return { id: display.id, bounds: display.bounds, workArea: display.workArea, ...(notch && { notch: { width: notch.width, height: notch.height } }) };
  });
}

const placeOn = (display: DrawerDisplay) => drawerPlace(display, host!.size(), process.platform === 'darwin');

async function open(display: DrawerDisplay, until?: number): Promise<void> {
  if (!host) return;
  clearTimeout(hiding);
  const window = await host.window();
  const { window: bounds, origin } = placeOn(display);
  window.setBounds(bounds);
  send(window.webContents, 'pill:drawer', { open: true, origin, ...(display.notch && { notch: display.notch }) });
  if (!HIDDEN && !window.isVisible()) window.showInactive();
  state = { phase: 'open', display: display.id, window: bounds, ...(until !== undefined && { until }) };
}

async function close(): Promise<void> {
  state = { phase: 'closed' };
  keep = false;
  if (!host) return;
  const window = await host.window();
  send(window.webContents, 'pill:drawer', { open: false });
  clearTimeout(hiding);
  // gone once its page has played the closing
  hiding = setTimeout(() => state.phase === 'closed' && !window.isDestroyed() && window.hide(), DRAWER.closeAnimMs + 60);
}

function tick(): void {
  if (!host || !edge) return;
  if (host.busy()) {
    if (state.phase !== 'closed') void close();
    return;
  }
  const fake = checkDrawer();
  const input = { now: Date.now(), pointer: fake?.pointer ?? screen.getCursorScreenPoint(), buttons: fake?.buttons ?? edge.mouseButtonDown(), displays: displays(), keep };
  const next = drawerNext(state, input, (display) => placeOn(display).window);
  state = next.state;
  if (next.action === 'close') void close();
  else if (next.action) void open(next.action.open);
}

/** The notches again, when a display comes, goes or changes (a lid opened, a resolution picked). */
function watchDisplays(): void {
  if (watchingDisplays) return;
  watchingDisplays = true;
  const refresh = () => (notches = edge?.notches() ?? []);
  screen.on('display-added', refresh);
  screen.on('display-removed', refresh);
  screen.on('display-metrics-changed', refresh);
}

/** The drawer watches the top edge: the pill waits there. */
export async function startDrawer(drawerHost: DrawerHost): Promise<void> {
  host = drawerHost;
  edge ??= await topEdge({ backend: TEST_BACKEND ? 'test' : undefined });
  notches = edge.notches();
  watchDisplays();
  timer ??= setInterval(tick, TICK_MS);
}

/** The drawer stops watching (the pill waits elsewhere now) and closes. */
export function stopDrawer(): void {
  clearInterval(timer);
  timer = undefined;
  if (state.phase !== 'closed') void close();
}

/** Shows the drawer on the display under the pointer for a while (the tray's "Show Cuttle", the app's start). */
export async function showDrawer(drawerHost: DrawerHost): Promise<void> {
  await startDrawer(drawerHost);
  if (drawerHost.busy()) return;
  const pointer = checkDrawer()?.pointer ?? screen.getCursorScreenPoint();
  const on = screen.getDisplayNearestPoint(pointer);
  const display = displays().find((candidate) => candidate.id === on.id);
  if (display) await open(display, Date.now() + DRAWER.shownMs);
}

/** Closes the drawer now (Esc, a choice made in it). */
export function closeDrawer(): void {
  if (state.phase !== 'closed') void close();
}

/** Its menu opens (it stays open meanwhile) or closes. */
export function keepDrawer(open: boolean): void {
  keep = open;
}

/** Whether the drawer watches the top edge now. */
export const drawerWatching = (): boolean => timer !== undefined;
