// The Cuttle app's main process: one instance, a tray icon and the pill; editors per project.
// `--open <folder>` (also from a second launch) opens a project, `--settings` the settings; the
// first plain start shows the first run. The end-to-end check passes --cuttle-check with
// CUTTLE_HIDDEN=1 (no window is shown); CUTTLE_USER_DATA moves the settings.
import { resolve } from 'node:path';
import { app, globalShortcut, Menu, session } from 'electron';
import { HIDDEN } from './check';
import { mediaWorker } from './media-service';
import { recorderHost } from './recorder-host';
import { startPicking, stopForQuit, recordingRuns } from './recording';
import { assetPath, registerSchemes } from './protocols';
import { loadSettings, onSettingsChange } from './settings';
import { openSettings } from './settings-window';
import { findFfmpeg } from './tools';
import { createTray, updateTray, type TrayActions } from './tray';
import { startUpdates } from './updates';
import { launchOf, type Launch } from './launch';
import { chooseAndOpen, createPill, lockDown, openEditorOrSay, showPill } from './windows';

app.setName('Cuttle');
if (process.env.CUTTLE_USER_DATA) app.setPath('userData', resolve(process.env.CUTTLE_USER_DATA));

/** A quit waits this long for a recording to be written into its project, then quits anyway. */
const QUIT_WAIT_MS = 60_000;

const launched = launchOf(process.argv, process.cwd());

// a second launch hands the running app what it was asked (its argv arrives reordered)
if (!app.requestSingleInstanceLock(launched)) {
  app.quit();
} else {
  registerSchemes();
  // macOS keeps a menu for its own keys (Copy, Paste, Hide, Quit, Close); the editor handles Undo itself.
  Menu.setApplicationMenu(
    process.platform === 'darwin'
      ? Menu.buildFromTemplate([
          {
            role: 'appMenu',
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { label: 'Settings…', accelerator: 'Command+,', click: () => void openSettings() },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
          { label: 'Edit', submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
          { role: 'windowMenu' },
        ])
      : null,
  );

  const actions: TrayActions = {
    record: () => void startPicking(),
    showPill: () => void showPill(),
    open: (dir) => void (dir ? openEditorOrSay(dir) : chooseAndOpen()),
    settings: () => void openSettings(),
    quit: () => app.quit(),
  };

  app.on('second-instance', (_event, argv, workingDirectory, additionalData) => {
    const launch: Launch = { ...launchOf(argv, workingDirectory), ...(additionalData as Launch | null) };
    if (launch.open) void openEditorOrSay(launch.open);
    else if (launch.settings) void openSettings();
    else void showPill();
  });

  // The app lives in the tray: closing the last editor does not quit it.
  app.on('window-all-closed', () => {});
  // Quitting while a take records stops it and writes it into its project first: every quit until
  // then waits (a second Quit from the tray too), unless the recorder does not answer for a minute.
  let stopping: Promise<void> | undefined;
  let quitNow = false;
  app.on('before-quit', (event) => {
    if (quitNow || !recordingRuns()) return;
    event.preventDefault();
    stopping ??= Promise.race([stopForQuit(), new Promise<void>((resolve) => setTimeout(resolve, QUIT_WAIT_MS))]).finally(() => {
      quitNow = true;
      app.quit();
    });
  });
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    mediaWorker.stop();
    recorderHost.quit();
  });

  // macOS: a click on the Dock icon when no window is in sight shows the pill (the app's home)
  app.on('activate', (_event, hasVisibleWindows) => {
    if (app.isReady() && !hasVisibleWindows && !HIDDEN) void showPill();
  });

  void app.whenReady().then(async () => {
    // The default session (the export's hidden window uses it) grants nothing either.
    lockDown(session.defaultSession);
    const settings = await loadSettings();
    // macOS: the Dock shows the app's icon also when it runs from the repository (Electron's own otherwise),
    // and the menu bar a template image, which it tints for light and dark menu bars
    if (process.platform === 'darwin') app.dock?.setIcon(assetPath('icon-mac.png'));
    const trayIcon = process.platform === 'win32' ? 'tray.png' : process.platform === 'darwin' ? 'trayTemplate.png' : 'tray@2x.png';
    if (!HIDDEN) createTray(assetPath(trayIcon), settings.recent, actions);
    await createPill();
    // A new recording from anywhere (the recorder's own keys stop it and set markers).
    if (!HIDDEN) globalShortcut.register('Control+Shift+Alt+R', () => void startPicking());
    if (launched.open) await openEditorOrSay(launched.open);
    else if (launched.settings) await openSettings();
    // the first plain start welcomes (ffmpeg, the cuttle command and the skill), then the pill
    else if (!settings.welcomed) await openSettings({ welcome: true });
    else await showPill();
    // ffmpeg where the OS has it now (installed since the last login, say): the helpers start with it
    void findFfmpeg().catch(() => undefined);
    // a newer version from GitHub's releases, a little after the start and once a day (the packaged app)
    void startUpdates();
    onSettingsChange((latest) => updateTray(latest.recent, actions));
  });
}
