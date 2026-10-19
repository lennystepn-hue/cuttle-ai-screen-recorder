// The settings window, which is also the first run ("Welcome": ffmpeg, the cuttle command and the
// skill, then the pill). One at a time: asking again brings it forward.
import { existsSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import { hostname } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { app, BrowserWindow, clipboard, dialog, session, shell } from 'electron';
import { editorLockOf } from '@cuttle/core';
import type { Motion, SettingsPage, SettingsView } from '../shared/ipc';
import { CHECK, HIDDEN } from './check';
import { bindRequests, send } from './ipc';
import { APP_ORIGIN, assetPath, bundlePath, serveApp } from './protocols';
import { keyOf, listCamerasAndMics, recordingRuns } from './recording';
import { loadSettings, sameDir, settingsView, updateSettings } from './settings';
import { cancelSpeechDownload, downloadSpeechModel, onSpeechStatus, removeSpeechModel, speechStatus } from './speech';
import { installTools, skillFolder, toolsStatus } from './tools';
import { installUpdate, openReleases, updates } from './updates';
import { bringToFront, guard, lockDown, openEditorOrSay, showPill, titleBar, webPreferences } from './windows';

const BACKGROUND = '#0c0c0f';
/** As the editor's, so Windows' buttons are the same in both. */
const TITLE_BAR_HEIGHT = 44;
/** A sidebar and a page that scrolls; the first run fits without (Done stays in sight). */
const SIZE = { width: 820, height: 620 };
const WELCOME_SIZE = { width: 640, height: 640 };

let current: BrowserWindow | undefined;
/** The window while it closes: asked again meanwhile, a new one opens once it is gone (it would show nothing). */
let closing: Promise<void> | undefined;

/** Characters Windows does not take in a folder name. */
const BAD_NAME = /[<>:"/\\|?*\u0000-\u001f]|^\.+$/;
/** Names Windows keeps for devices. */
const RESERVED_NAME = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

/** The folder a recent entry names: only folders on the list are acted on, never one a page made up. */
async function recentDir(dir: string): Promise<string> {
  const entry = (await loadSettings()).recent.find((candidate) => sameDir(candidate.dir, dir));
  if (!entry) throw new Error('that project is not in the recent list');
  return entry.dir;
}

/** The settings as the window shows them, with which recent projects are open in Cuttle now. */
async function viewNow(): Promise<SettingsView> {
  const view = await settingsView();
  const recent = await Promise.all(
    view.recent.map(async (entry) => {
      const lock = await editorLockOf(entry.dir).catch(() => undefined);
      return lock ? { ...entry, open: lock.host === hostname() ? 'here' : lock.host } : entry;
    }),
  );
  return { ...view, recent };
}

/** Shows the settings window (`welcome`: the first run; `page`: at that page), or brings it forward. */
export async function openSettings(options: { welcome?: boolean; page?: SettingsPage } = {}): Promise<BrowserWindow> {
  if (closing) await closing;
  if (current && !current.isDestroyed()) {
    if (options.page) send(current.webContents, 'settings:page', options.page);
    bringToFront(current);
    return current;
  }
  const ses = session.fromPartition('settings');
  lockDown(ses);
  serveApp(ses, bundlePath('renderer'));
  const window = new BrowserWindow({
    ...(options.welcome ? WELCOME_SIZE : SIZE),
    minWidth: options.welcome ? 560 : 720,
    minHeight: options.welcome ? 600 : 480,
    show: false,
    backgroundColor: BACKGROUND,
    title: options.welcome ? 'Welcome to Cuttle' : 'Cuttle settings',
    ...titleBar(TITLE_BAR_HEIGHT),
    icon: assetPath('icon.png'),
    maximizable: false,
    fullscreenable: false,
    webPreferences: webPreferences('settings.cjs', ses),
  });
  const contents = window.webContents;
  guard(contents);
  const changed = (view: SettingsView) => {
    send(contents, 'settings:changed', view);
    return view;
  };

  bindRequests(contents, 'settings', {
    'settings:get': () => viewNow(),
    'settings:set': async (change) => {
      await updateSettings((settings) => {
        if (change.countdown !== undefined) settings.countdown = change.countdown;
        if (change.camera !== undefined) settings.record.camera = change.camera ?? undefined;
        if (change.mic !== undefined) settings.record.mic = change.mic ?? undefined;
        if (change.launchAtLogin !== undefined) settings.launchAtLogin = change.launchAtLogin;
        if (change.motion !== undefined) settings.motion = change.motion;
        if (change.speechModel !== undefined) settings.speech.model = change.speechModel;
        if (change.speechLanguage !== undefined) settings.speech.language = change.speechLanguage;
        if (change.speechLive !== undefined) settings.speech.live = change.speechLive;
        if (change.privacyRead !== undefined) settings.privacy.read = change.privacyRead;
        // each word once, as it was first written
        if (change.privacyWords !== undefined) settings.privacy.words = change.privacyWords.filter((word, k, all) => all.findIndex((other) => other.toLowerCase() === word.toLowerCase()) === k);
        if (change.updates !== undefined) settings.updates = change.updates;
      });
      if (change.launchAtLogin !== undefined) applyLoginItem(change.launchAtLogin);
      if (change.motion !== undefined) broadcastMotion(change.motion);
      return changed(await viewNow());
    },
    'settings:choose-folder': async () => {
      const chosen = CHECK
        ? process.env.CUTTLE_CHECK_FOLDER
        : (
            await dialog.showOpenDialog(window, {
              title: 'Where new recordings go',
              defaultPath: (await loadSettings()).projectsFolder,
              properties: ['openDirectory', 'createDirectory'],
            })
          ).filePaths[0];
      if (chosen) {
        await updateSettings((settings) => {
          settings.projectsFolder = chosen;
        });
      }
      return changed(await viewNow());
    },
    'settings:devices': () => listCamerasAndMics(),
    'settings:welcomed': async () => {
      await updateSettings((settings) => {
        settings.welcomed = true;
      });
      window.close();
      await showPill();
    },
    'tools:status': () => toolsStatus(),
    'tools:check': () => toolsStatus(),
    'tools:install': () => installTools(),
    'tools:copy': (text) => clipboard.writeText(text),
    'tools:reveal': () => shell.showItemInFolder(skillFolder()),
    'recent:open': async (dir) => openEditorOrSay(await recentDir(dir)),
    'recent:reveal': async (dir) => shell.showItemInFolder(await recentDir(dir)),
    'recent:forget': async (dir) => {
      const known = await recentDir(dir);
      await updateSettings((settings) => {
        settings.recent = settings.recent.filter((entry) => !sameDir(entry.dir, known));
      });
      return changed(await viewNow());
    },
    'recent:rename': async ({ dir, name }) => {
      const known = await recentDir(dir);
      const answer = await renameProject(known, name);
      if ('dir' in answer) changed(await viewNow());
      return answer;
    },
    'speech:status': () => speechStatus(),
    'speech:download': (name) => downloadSpeechModel(name),
    'speech:cancel': () => cancelSpeechDownload(),
    'speech:remove': (name) => removeSpeechModel(name),
    'updates:status': () => updates().status(),
    'updates:check': () => updates().check(),
    'updates:download': () => updates().download(),
    'updates:install': () => installUpdate(),
    'updates:releases': () => openReleases(),
  });
  // a check or a download goes on while the window is closed; an open one follows it
  const offUpdates = updates().onStatus((status) => {
    if (!contents.isDestroyed()) send(contents, 'updates:status', status);
  });
  window.on('closed', offUpdates);
  // a download goes on while the window is closed; an open one follows it
  const offSpeech = onSpeechStatus((status) => {
    if (!contents.isDestroyed()) send(contents, 'speech:status', status);
  });
  window.on('closed', offSpeech);
  // the first run counts as seen once it was closed, however
  if (options.welcome) {
    window.on('closed', () => {
      void loadSettings().then((settings) => {
        if (settings.welcomed) return;
        void updateSettings((latest) => {
          latest.welcomed = true;
        }).then(() => showPill());
      });
    });
  }
  window.on('closed', () => {
    if (current === window) current = undefined;
  });
  window.on('close', () => {
    if (current === window) closing ??= new Promise((resolve) => window.once('closed', () => resolve()));
  });
  window.on('closed', () => {
    closing = undefined;
  });
  // which projects are open changes while the window is away
  window.on('focus', () => void viewNow().then(changed));
  window.once('ready-to-show', () => bringToFront(window));
  current = window;
  await window.loadURL(`${APP_ORIGIN}/settings.html${options.welcome ? '#welcome' : options.page ? `#${options.page}` : ''}`);
  return window;
}

/**
 * Renames a project's folder (in the same parent folder), and its entries in the settings. Not
 * while it is open in Cuttle (here or on another computer) or while a recording runs.
 */
export async function renameProject(dir: string, name: string): Promise<{ dir: string } | { problem: string }> {
  const clean = name.trim();
  if (RESERVED_NAME.test(clean)) return { problem: `Windows keeps "${clean}" for itself. Pick another name.` };
  if (BAD_NAME.test(clean) || clean.endsWith('.') || clean.endsWith(' ')) return { problem: 'A folder name cannot have \\ / : * ? " < > | in it, or end in a dot or a space.' };
  if (clean === basename(dir)) return { dir };
  if (recordingRuns()) return { problem: 'Cuttle is recording. Rename the project after the stop.' };
  const lock = await editorLockOf(dir);
  if (lock) return { problem: lock.host === hostname() ? 'The project is open in Cuttle. Close its editor first.' : `The project is open in Cuttle on ${lock.host}. Close it there first.` };
  const target = join(dirname(dir), clean);
  // a name that differs only in case is the same folder on Windows: renamed in place
  if (existsSync(target) && !sameDir(target, dir)) return { problem: `There is already a folder named "${clean}" there.` };
  try {
    await rename(dir, target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { problem: code === 'EBUSY' || code === 'EPERM' || code === 'EACCES' ? 'A program is using a file in the project (a player, a terminal there?). Close it and try again.' : (error as Error).message };
  }
  await updateSettings((settings) => {
    settings.recent = settings.recent.map((entry) => (sameDir(entry.dir, dir) ? { ...entry, dir: target, name: clean } : entry));
    // `uncut` holds keys as recording.ts makes them (real path, case folded on Windows)
    settings.uncut = settings.uncut.map((entry) => (entry === keyOf(dir) || sameDir(entry, dir) ? keyOf(target) : entry));
  });
  return { dir: target };
}

/** Starts with the computer, or not (the check never registers a login item: it keeps what was asked). */
export function applyLoginItem(open: boolean): void {
  if (CHECK) {
    (globalThis as { __loginItem?: boolean }).__loginItem = open;
    return;
  }
  // run from the repository (pnpm app), Electron needs the main script as an argument
  app.setLoginItemSettings({ openAtLogin: open, ...(!app.isPackaged && { path: process.execPath, args: [resolve(process.argv[1] ?? app.getAppPath())] }) });
}

/** Tells every window how motion is set now. */
function broadcastMotion(motion: Motion): void {
  for (const window of BrowserWindow.getAllWindows()) send(window.webContents, 'app:motion', motion);
}
