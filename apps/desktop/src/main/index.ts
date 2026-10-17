// The Cuttle app's main process: one instance, a tray icon and the pill; editors per project.
// `--open <folder>` (also from a second launch) opens a project. CUTTLE_HIDDEN=1 keeps every window
// hidden (the end-to-end check); CUTTLE_USER_DATA moves the settings.
import { resolve } from 'node:path';
import { app, Menu } from 'electron';
import { mediaWorker } from './media-service';
import { assetPath, registerSchemes } from './protocols';
import { loadSettings, onSettingsChange } from './settings';
import { createTray, updateTray, type TrayActions } from './tray';
import { HIDDEN, chooseAndOpen, createPill, openEditorOrSay, showPill } from './windows';

app.setName('Cuttle');
if (process.env.CUTTLE_USER_DATA) app.setPath('userData', resolve(process.env.CUTTLE_USER_DATA));

/** The folder after `--open` in `argv`, if any. */
function openArgument(argv: readonly string[]): string | undefined {
  const at = argv.indexOf('--open');
  return at >= 0 ? argv[at + 1] : undefined;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  registerSchemes();
  Menu.setApplicationMenu(null);

  const actions: TrayActions = {
    showPill: () => void showPill(),
    open: (dir) => void (dir ? openEditorOrSay(dir) : chooseAndOpen()),
    quit: () => app.quit(),
  };

  app.on('second-instance', (_event, argv) => {
    const dir = openArgument(argv);
    if (dir) void openEditorOrSay(dir);
    else void showPill();
  });

  // The app lives in the tray: closing the last editor does not quit it.
  app.on('window-all-closed', () => {});
  app.on('will-quit', () => mediaWorker.stop());

  void app.whenReady().then(async () => {
    const settings = await loadSettings();
    if (!HIDDEN) createTray(assetPath(process.platform === 'win32' ? 'tray.png' : 'tray@2x.png'), settings.recent, actions);
    await createPill();
    const dir = openArgument(process.argv);
    if (dir) await openEditorOrSay(dir);
    else await showPill();
    onSettingsChange((latest) => updateTray(latest.recent, actions));
  });
}
