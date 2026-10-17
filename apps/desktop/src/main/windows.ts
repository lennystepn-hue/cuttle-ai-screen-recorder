import { join, resolve } from 'node:path';
import { BrowserWindow, Menu, dialog, screen, session, shell, type Session, type WebContents } from 'electron';
import { PROJECT_FILE } from '@cuttle/core';
import type { ExportEnd } from '../shared/ipc';
import { isInside } from '../shared/media-path';
import { ExportRun } from './export-service';
import { bindRequests, send } from './ipc';
import { ProjectMedia } from './media-service';
import { lockProject, openProjectFile, projectInfo } from './project';
import { APP_ORIGIN, assetPath, bundlePath, serveApp, serveMedia } from './protocols';
import { addRecent, loadSettings, updateSettings } from './settings';

/** Windows are never shown (the end-to-end check drives them hidden). */
export const HIDDEN = process.env.CUTTLE_HIDDEN === '1';

const BACKGROUND = '#0c0c0f';

/** No permissions (camera, mic, notifications …), no downloads, no navigation, no new windows. */
function lockDown(ses: Session): void {
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on('will-download', (event) => event.preventDefault());
}

function guard(contents: WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event) => event.preventDefault());
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

const webPreferences = (preload: string, ses: Session) => ({
  preload: bundlePath('preload', preload),
  session: ses,
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  spellcheck: false,
  // The player keeps its own clock; a hidden window (the check) must keep rendering too.
  backgroundThrottling: false,
});

interface Editor {
  window: BrowserWindow;
  media: ProjectMedia;
  release: () => Promise<void>;
  run?: ExportRun;
}

const editors = new Map<string, Editor>();
const key = (dir: string) => (process.platform === 'win32' ? resolve(dir).toLowerCase() : resolve(dir));
let partitions = 0;

/** Opens the project in `dir` in an editor window (or brings its window to the front). Throws a readable error. */
export async function openEditor(projectDir: string): Promise<BrowserWindow> {
  const dir = resolve(projectDir);
  const existing = editors.get(key(dir));
  if (existing && !existing.window.isDestroyed()) {
    if (!HIDDEN) existing.window.show();
    existing.window.focus();
    return existing.window;
  }
  const file = await openProjectFile(dir);
  const release = await lockProject(dir);
  const ses = session.fromPartition(`editor-${++partitions}`);
  lockDown(ses);
  serveApp(ses, bundlePath('renderer'));
  serveMedia(ses, dir);

  const area = screen.getPrimaryDisplay().workArea;
  const window = new BrowserWindow({
    width: Math.min(1600, area.width),
    height: Math.min(1000, area.height),
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: `${file.dir.split(/[\\/]/).at(-1)} · Cuttle`,
    backgroundColor: BACKGROUND,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: BACKGROUND, symbolColor: '#9a9aa5', height: 40 },
    icon: assetPath('icon.png'),
    webPreferences: webPreferences('editor.cjs', ses),
  });
  guard(window.webContents);
  const media = new ProjectMedia(dir, file.project, (state) => send(window.webContents, 'media:state', state));
  const editor: Editor = { window, media, release };
  editors.set(key(dir), editor);

  bindRequests(window.webContents, 'editor', {
    'project:info': () => projectInfo(file),
    'project:reveal': (path) => {
      const target = resolve(dir, path ?? PROJECT_FILE);
      if (!isInside(target, dir, process.platform)) throw new Error('only files inside the project can be shown');
      shell.showItemInFolder(target);
    },
    'media:state': () => media.current(),
    'export:start': ({ formats, encoder }) => {
      if (editor.run) throw new Error('an export is already running');
      const run = new ExportRun(dir, formats, encoder, (progress) => send(window.webContents, 'export:progress', progress));
      editor.run = run;
      void run.done.then((end: ExportEnd) => {
        editor.run = undefined;
        send(window.webContents, 'export:end', end);
      });
      return { out: join(dir, 'out') };
    },
    'export:cancel': () => editor.run?.cancel(),
  });

  window.on('closed', () => {
    editors.delete(key(dir));
    media.dispose();
    editor.run?.cancel();
    void release();
  });
  window.once('ready-to-show', () => {
    if (!HIDDEN) window.show();
  });
  // The end-to-end check asks for a hook to drive the player (CUTTLE_CHECK=1) and for frames from
  // the take itself rather than the proxy (CUTTLE_NO_PROXY=1), to compare them with the export's.
  const query = new URLSearchParams({ ...(process.env.CUTTLE_NO_PROXY === '1' && { proxy: 'off' }), ...(process.env.CUTTLE_CHECK === '1' && { check: '1' }) }).toString();
  await window.loadURL(`${APP_ORIGIN}/editor.html${query ? `?${query}` : ''}`);
  void media.start();
  void addRecent(dir);
  return window;
}

/** Opens a project, showing what went wrong in a dialog instead of throwing. */
export async function openEditorOrSay(dir: string): Promise<void> {
  try {
    await openEditor(dir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (HIDDEN) {
      console.error(`cannot open ${dir}: ${message}`);
      return;
    }
    await dialog.showMessageBox({ type: 'warning', title: 'Cuttle', message: `Cuttle cannot open ${dir}`, detail: message });
  }
}

/** Asks for a project folder and opens it. */
export async function chooseAndOpen(parent?: BrowserWindow): Promise<void> {
  const options = { title: 'Open a Cuttle project', properties: ['openDirectory'] as ('openDirectory')[], buttonLabel: 'Open' };
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
  if (!result.canceled && result.filePaths[0]) await openEditorOrSay(result.filePaths[0]);
}

let pill: BrowserWindow | undefined;
const PILL_SIZE = { width: 420, height: 64 };

/** The pill: a small launcher near the top of the primary display, kept out of every recording. */
export async function createPill(): Promise<BrowserWindow> {
  if (pill && !pill.isDestroyed()) return pill;
  const ses = session.fromPartition('pill');
  lockDown(ses);
  serveApp(ses, bundlePath('renderer'));
  const display = screen.getPrimaryDisplay();
  const saved = (await loadSettings()).pill[String(display.id)];
  const area = display.workArea;
  const window = new BrowserWindow({
    ...PILL_SIZE,
    x: saved?.x ?? Math.round(area.x + (area.width - PILL_SIZE.width) / 2),
    y: saved?.y ?? area.y + 24,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    title: 'Cuttle',
    webPreferences: webPreferences('pill.cjs', ses),
  });
  guard(window.webContents);
  window.setContentProtection(true);
  window.setAlwaysOnTop(true, 'floating');
  bindRequests(window.webContents, 'pill', {
    'pill:recent': async () => (await loadSettings()).recent,
    'pill:open': async (target) => {
      if (target) await openEditorOrSay(target.dir);
      else await chooseAndOpen();
    },
    'pill:hide': () => window.hide(),
    'pill:menu': async () => {
      const recent = (await loadSettings()).recent;
      Menu.buildFromTemplate([
        ...(recent.length === 0
          ? [{ label: 'No recent projects', enabled: false }]
          : recent.map((entry) => ({ label: entry.name, sublabel: entry.dir, click: () => void openEditorOrSay(entry.dir) }))),
        { type: 'separator' },
        { label: 'Open folder…', click: () => void chooseAndOpen() },
      ]).popup({ window });
    },
  });
  window.on('moved', () => {
    const [x, y] = window.getPosition();
    const on = screen.getDisplayMatching(window.getBounds());
    void updateSettings((settings) => {
      settings.pill[String(on.id)] = { x: x!, y: y! };
    });
  });
  window.on('show', () => void loadSettings().then((settings) => send(window.webContents, 'pill:recent', settings.recent)));
  window.on('closed', () => (pill = undefined));
  await window.loadURL(`${APP_ORIGIN}/pill.html`);
  pill = window;
  return window;
}

export async function showPill(): Promise<void> {
  const window = await createPill();
  if (!HIDDEN) window.showInactive();
}
