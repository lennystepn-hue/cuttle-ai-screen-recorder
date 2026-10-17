import { Menu, Tray, nativeImage, type MenuItemConstructorOptions } from 'electron';
import { appVersion, type Settings } from './settings';

/** A recent project in a menu: its name, and its parent folder to tell same-named projects apart. */
const label = (entry: { dir: string; name: string }) => `${entry.name} — ${entry.dir.split(/[\\/]/).at(-2) ?? ''}`;

export interface TrayActions {
  record(): void;
  showPill(): void;
  open(dir?: string): void;
  settings(): void;
  quit(): void;
}

/** The tray menu: a new recording, show the pill, the recent projects, open a folder, the settings, quit. */
export function trayMenu(recent: Settings['recent'], actions: TrayActions): MenuItemConstructorOptions[] {
  return [
    { label: 'New recording', accelerator: 'Control+Shift+Alt+R', click: () => actions.record() },
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

export function createTray(icon: string, recent: Settings['recent'], actions: TrayActions): Tray {
  tray?.destroy();
  tray = new Tray(nativeImage.createFromPath(icon));
  tray.setToolTip(`Cuttle ${appVersion()}`);
  tray.setContextMenu(Menu.buildFromTemplate(trayMenu(recent, actions)));
  tray.on('click', () => actions.showPill());
  return tray;
}

export function updateTray(recent: Settings['recent'], actions: TrayActions): void {
  tray?.setContextMenu(Menu.buildFromTemplate(trayMenu(recent, actions)));
}
