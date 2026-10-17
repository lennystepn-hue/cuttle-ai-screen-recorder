// The Cuttle app's main process: one instance, a tray icon and the pill; editors per project.
// `--open <folder>` (also from a second launch) opens a project. The end-to-end check passes
// --cuttle-check with CUTTLE_HIDDEN=1 (no window is shown); CUTTLE_USER_DATA moves the settings.
import { resolve } from 'node:path';
import { app, globalShortcut, Menu, session } from 'electron';
import { HIDDEN } from './check';
import { mediaWorker } from './media-service';
import { recorderHost } from './recorder-host';
import { startPicking } from './recording';
import { assetPath, registerSchemes } from './protocols';
import { loadSettings, onSettingsChange } from './settings';
import { createTray, updateTray, type TrayActions } from './tray';
import { chooseAndOpen, createPill, lockDown, openEditorOrSay, showPill } from './windows';

app.setName('Cuttle');
if (process.env.CUTTLE_USER_DATA) app.setPath('userData', resolve(process.env.CUTTLE_USER_DATA));

/** The folder after `--open` in `argv`, if any, resolved against the folder that launch ran in. */
function openArgument(argv: readonly string[], cwd: string): string | undefined {
  const at = argv.indexOf('--open');
  const dir = at >= 0 ? argv[at + 1] : undefined;
  return dir === undefined ? undefined : resolve(cwd, dir);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  registerSchemes();
  Menu.setApplicationMenu(null);

  const actions: TrayActions = {
    record: () => void startPicking(),
    showPill: () => void showPill(),
    open: (dir) => void (dir ? openEditorOrSay(dir) : chooseAndOpen()),
    quit: () => app.quit(),
  };

  app.on('second-instance', (_event, argv, workingDirectory) => {
    const dir = openArgument(argv, workingDirectory);
    if (dir) void openEditorOrSay(dir);
    else void showPill();
  });

  // The app lives in the tray: closing the last editor does not quit it.
  app.on('window-all-closed', () => {});
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    mediaWorker.stop();
    recorderHost.quit();
  });

  void app.whenReady().then(async () => {
    // The default session (the export's hidden window uses it) grants nothing either.
    lockDown(session.defaultSession);
    const settings = await loadSettings();
    if (!HIDDEN) createTray(assetPath(process.platform === 'win32' ? 'tray.png' : 'tray@2x.png'), settings.recent, actions);
    await createPill();
    // A new recording from anywhere (the recorder's own keys stop it and set markers).
    if (!HIDDEN) globalShortcut.register('Control+Shift+Alt+R', () => void startPicking());
    const dir = openArgument(process.argv, process.cwd());
    if (dir) await openEditorOrSay(dir);
    else await showPill();
    onSettingsChange((latest) => updateTray(latest.recent, actions));
  });
}
