import { Menu, Tray, app, nativeImage, type MenuItemConstructorOptions } from 'electron';
import type { Settings } from './settings';

export interface TrayActions {
  showPill(): void;
  open(dir?: string): void;
  quit(): void;
}

/** The tray menu: show the pill, the recent projects, open a folder, quit. */
export function trayMenu(recent: Settings['recent'], actions: TrayActions): MenuItemConstructorOptions[] {
  return [
    { label: 'Show Cuttle', click: () => actions.showPill() },
    { type: 'separator' },
    ...(recent.length === 0
      ? [{ label: 'No recent projects', enabled: false }]
      : recent.map((entry) => ({ label: entry.name, sublabel: entry.dir, click: () => actions.open(entry.dir) }))),
    { type: 'separator' },
    { label: 'Open folder…', click: () => actions.open() },
    { type: 'separator' },
    { label: 'Quit Cuttle', click: () => actions.quit() },
  ];
}

let tray: Tray | undefined;

export function createTray(icon: string, recent: Settings['recent'], actions: TrayActions): Tray {
  tray?.destroy();
  tray = new Tray(nativeImage.createFromPath(icon));
  tray.setToolTip(`Cuttle ${app.getVersion()}`);
  tray.setContextMenu(Menu.buildFromTemplate(trayMenu(recent, actions)));
  tray.on('click', () => actions.showPill());
  return tray;
}

export function updateTray(recent: Settings['recent'], actions: TrayActions): void {
  tray?.setContextMenu(Menu.buildFromTemplate(trayMenu(recent, actions)));
}
