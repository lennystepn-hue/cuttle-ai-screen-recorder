import { Menu, Tray, nativeImage, type MenuItemConstructorOptions } from 'electron';
import { takeMenu, takeTitle, takeTooltip, type TakeActions, type TakeStatus } from '../shared/take-status';
import { CHECK } from './check';
import { appVersion, type Settings } from './settings';

/** A recent project in a menu: its name, and its parent folder to tell same-named projects apart. */
const label = (entry: { dir: string; name: string }) => `${entry.name} — ${entry.dir.split(/[\\/]/).at(-2) ?? ''}`;

export interface TrayActions {
  record(): void;
  shot(): void;
  showPill(): void;
  open(dir?: string): void;
  settings(): void;
  quit(): void;
}

/** The tray menu: a new recording, a screenshot, show the pill, the recent projects, open a folder, the settings, quit. */
export function trayMenu(recent: Settings['recent'], actions: TrayActions): MenuItemConstructorOptions[] {
  return [
    { label: 'New recording', accelerator: 'Control+Shift+Alt+R', click: () => actions.record() },
    { label: 'Screenshot', accelerator: 'Control+Shift+Alt+C', click: () => actions.shot() },
    { label: 'Show Cuttle', click: () => actions.showPill() },
    { type: 'separator' },
    ...(recent.length === 0
      ? [{ label: 'No recent projects', enabled: false }]
      : recent.map((entry) => ({ label: label(entry), toolTip: entry.dir, click: () => actions.open(entry.dir) }))),
    { type: 'separator' },
    { label: 'Open folder…', click: () => actions.open() },
    { label: 'Settings…', click: () => actions.settings() },
    { type: 'separator' },
    { label: 'Quit Cuttle', click: () => actions.quit() },
  ];
}

let tray: Tray | undefined;
/** The tray outside a take: its icon, the recent projects and what its menu does. */
let usual: { icon: string; recent: Settings['recent']; actions: TrayActions } | undefined;
/** The icon during a take (Windows: with a red dot; macOS keeps its template and says it in the title). */
let recordingIcon: string | undefined;
/** The take the tray shows while one runs. */
let take: { status: () => TakeStatus; actions: TakeActions; timer: ReturnType<typeof setInterval>; menu: string } | undefined;

export function createTray(icon: string, recording: string | undefined, recent: Settings['recent'], actions: TrayActions): Tray {
  tray?.destroy();
  usual = { icon, recent, actions };
  recordingIcon = recording;
  tray = new Tray(nativeImage.createFromPath(icon));
  tray.setToolTip(`Cuttle ${appVersion()}`);
  tray.setContextMenu(Menu.buildFromTemplate(trayMenu(recent, actions)));
  // Windows opens the menu on the right button: during a take the left one opens it too (macOS opens it on a click)
  tray.on('click', () => (take && process.platform === 'win32' ? tray?.popUpContextMenu() : actions.showPill()));
  return tray;
}

export function updateTray(recent: Settings['recent'], actions: TrayActions): void {
  usual = usual && { ...usual, recent, actions };
  if (!take) tray?.setContextMenu(Menu.buildFromTemplate(trayMenu(recent, actions)));
}

/**
 * Shows a take in the tray until the returned function ends it: its time beside the icon (macOS)
 * or in the tooltip, a recording icon on Windows, and the take's menu. `status` is read every
 * second and on `takeChanged()`.
 */
export function showTake(status: () => TakeStatus, actions: TakeActions): () => void {
  if (take) clearInterval(take.timer);
  const shown = { status, actions, timer: setInterval(() => showStatus(), 1000), menu: '' };
  take = shown;
  if (recordingIcon) tray?.setImage(nativeImage.createFromPath(recordingIcon));
  showStatus();
  return () => {
    if (take !== shown) return;
    clearInterval(shown.timer);
    take = undefined;
    if (process.platform === 'darwin') tray?.setTitle('');
    tray?.setToolTip(`Cuttle ${appVersion()}`);
    if (usual) {
      tray?.setImage(nativeImage.createFromPath(usual.icon));
      tray?.setContextMenu(Menu.buildFromTemplate(trayMenu(usual.recent, usual.actions)));
    }
    if (CHECK) delete (globalThis as { __trayTake?: unknown }).__trayTake;
  };
}

/** The take's state changed (a pause, a step): the tray says so at once. */
export function takeChanged(): void {
  showStatus();
}

/** What the check reads of the tray during a take (it has no tray), and clicks in its menu. */
export interface CheckTrayTake {
  title: string;
  tooltip: string;
  items: { label: string; enabled: boolean }[];
  click(label: string): void;
}

function showStatus(): void {
  if (!take) return;
  const status = take.status();
  const template = takeMenu(status, take.actions);
  // the menu only when what it offers changed: one set while it is open closes it
  const items = template.filter((item) => item.label !== undefined).map((item) => ({ label: item.label!, enabled: item.enabled !== false }));
  const menu = JSON.stringify(items);
  if (menu !== take.menu) {
    take.menu = menu;
    tray?.setContextMenu(Menu.buildFromTemplate(template));
  }
  const title = takeTitle(status);
  const tooltip = takeTooltip(status);
  if (process.platform === 'darwin') tray?.setTitle(title, { fontType: 'monospacedDigit' });
  tray?.setToolTip(tooltip);
  if (CHECK) {
    const click = (label: string) => (template.find((item) => item.label === label)?.click as (() => void) | undefined)?.();
    (globalThis as { __trayTake?: CheckTrayTake }).__trayTake = { title, tooltip, items, click };
  }
}
