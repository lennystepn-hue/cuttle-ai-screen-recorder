import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { app, BrowserWindow, dialog, Menu, screen, session, shell, type Session, type WebContents } from 'electron';
import { PROJECT_FILE, backupFile, writeProjectFile, type ProjectFile } from '@cuttle/core';
import { parseProject } from '@cuttle/project';
import { plainIssue } from '../shared/format';
import type { Event, Events, ExportEnd, ProjectFileEvent, ProjectStatus } from '../shared/ipc';
import { isInside } from '../shared/media-path';
import { takeKey } from '../shared/take';
import { CHECK, CHECK_IMAGE, HIDDEN } from './check';
import { ExportRun, exportPath } from './export-service';
import { bindRequests, send } from './ipc';
import { ProjectMedia } from './media-service';
import { EditorMotion } from './motion-service';
import { LockedError, lockProject, openProjectFile, projectInfo } from './project';
import { importImage, ProjectFileWatch } from './project-watch';
import { APP_ORIGIN, assetPath, bundlePath, serveApp, serveMedia } from './protocols';
import { cutIfPending, recut, startPicking, takesBusy, undoRestart } from './recording';
import { deletableTakes, sizeText, trashName } from '../shared/takes';
import { addRecent, loadSettings, motionSetting, updateSettings } from './settings';
import { openSettings } from './settings-window';
import { fitProjectLength } from './length';
import { maskPrivacy } from './privacy';
import { transcribeProject } from './speech';

const BACKGROUND = '#0c0c0f';
const TITLE_BAR_HEIGHT = 44;
/** The traffic lights' height on macOS: centred in the title bar by `trafficLightPosition`. */
const TRAFFIC_LIGHTS_HEIGHT = 14;

/**
 * The page draws the title bar: Windows draws its buttons over its right end in the app's colours,
 * macOS its traffic lights over its left end, centred in it (the page leaves room on that side).
 */
export function titleBar(height: number) {
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: BACKGROUND, symbolColor: '#9a9aa5', height },
    trafficLightPosition: { x: 16, y: Math.round((height - TRAFFIC_LIGHTS_HEIGHT) / 2) },
  } as const;
}
/** The person's version that a save conflict could not carry over (the editor offers it back). */
const DRAFT_FILE = 'cuttle.json.draft';

/**
 * Shows a window the person asked for, in front. macOS does not bring an app forward by itself: one
 * started from a terminal or by the CLI opened its windows behind the app in front.
 */
export function bringToFront(window: BrowserWindow): void {
  if (HIDDEN) return;
  if (process.platform === 'darwin') app.focus({ steal: true });
  window.show();
  window.focus();
}

/** No permissions (camera, mic, notifications …), no downloads. */
export function lockDown(ses: Session): void {
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on('will-download', (event) => event.preventDefault());
}

/** No navigation, no new windows, no webviews. */
export function guard(contents: WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event) => event.preventDefault());
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

export const webPreferences = (preload: string, ses: Session) => ({
  preload: bundlePath('preload', preload),
  // how motion is set when the window is made (`app:motion` changes it later)
  additionalArguments: [`--cuttle-motion=${motionSetting()}`],
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
  /** Its webContents, kept: a closed window's `webContents` getter throws. */
  contents: WebContents;
  media: ProjectMedia;
  /** The preview of its motion scenes and overlays. */
  motion: EditorMotion;
  /** cuttle.json on disk: the editor's saves and the changes others make. */
  watch: ProjectFileWatch;
  release: () => Promise<void>;
  run?: ExportRun;
  /** What the main process is doing to the project, shown in the title bar. */
  status?: ProjectStatus;
}

/** Open editors and editors being opened, by the project folder's real path (junction and case aliases are one project). */
const editors = new Map<string, Editor>();
const opening = new Map<string, Promise<BrowserWindow>>();
const keyOf = (real: string) => (process.platform === 'win32' || process.platform === 'darwin' ? real.toLowerCase() : real);

/** One session per project (by its real path): reopening it reuses the session and its handlers. */
function projectSession(real: string): Session {
  const ses = session.fromPartition(`editor-${createHash('sha256').update(keyOf(real)).digest('hex').slice(0, 16)}`);
  lockDown(ses);
  serveApp(ses, bundlePath('renderer'));
  return ses;
}

/** Opens the project in `dir` in an editor window, or brings its window to the front. Throws a readable error. */
export async function openEditor(projectDir: string, options: { force?: boolean } = {}): Promise<BrowserWindow> {
  const real = await realpath(resolve(projectDir)).catch(() => resolve(projectDir));
  const key = keyOf(real);
  const existing = editors.get(key);
  if (existing && !existing.window.isDestroyed()) {
    if (existing.window.isMinimized()) existing.window.restore();
    bringToFront(existing.window);
    return existing.window;
  }
  const pending = opening.get(key);
  if (pending) return pending;
  const open = createEditor(real, key, options.force ?? false).finally(() => opening.delete(key));
  opening.set(key, open);
  return open;
}

async function createEditor(dir: string, key: string, force: boolean): Promise<BrowserWindow> {
  const file = await openProjectFile(dir);
  const release = await lockProject(dir, { force });
  // The file as found is kept once, before the editor changes anything (`.bak`, rotated as the CLI does).
  await backupFile(join(dir, PROJECT_FILE)).catch(() => undefined);
  try {
    const window = await editorWindow(dir, key, file, release);
    void cutIfPending(dir);
    return window;
  } catch (error) {
    // A window that failed to load is not left open (and invisible), nor the project locked.
    const editor = editors.get(key);
    if (editor) {
      editors.delete(key);
      editor.media.dispose();
      editor.motion.dispose();
      if (!editor.window.isDestroyed()) editor.window.destroy();
    }
    await release();
    throw error;
  }
}

async function editorWindow(dir: string, key: string, file: ProjectFile, release: () => Promise<void>): Promise<BrowserWindow> {
  const ses = projectSession(dir);
  await serveMedia(ses, dir);

  const area = screen.getPrimaryDisplay().workArea;
  const window = new BrowserWindow({
    width: Math.min(1600, area.width),
    height: Math.min(1000, area.height),
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: `${basename(dir)} · Cuttle`,
    backgroundColor: BACKGROUND,
    ...titleBar(TITLE_BAR_HEIGHT),
    icon: assetPath('icon.png'),
    webPreferences: webPreferences('editor.cjs', ses),
  });
  const contents = window.webContents;
  guard(contents);
  const motion = new EditorMotion(dir, {
    status: (statuses) => send(contents, 'motion:status', statuses),
    changed: (files) => send(contents, 'motion:changed', { files }),
  });
  const editor: Editor = { window, contents, media: newMedia(file.project), motion, release, watch: new ProjectFileWatch(dir, (event) => onFileChange(event)) };
  editors.set(key, editor);
  function newMedia(project: ProjectFile['project']): ProjectMedia {
    return new ProjectMedia(dir, project, (state) => send(contents, 'media:state', state));
  }
  // Another take (Back to take, a recording from the CLI): the proxy, thumbnails and peaks are made for it.
  function onFileChange(event: ProjectFileEvent): void {
    if ('raw' in event) {
      const parsed = parseProject(event.raw);
      if (parsed.ok && takeKey(parsed.project.sources) !== takeKey(editor.media.sources)) {
        editor.media.dispose();
        editor.media = newMedia(parsed.project);
        void editor.media.start();
      }
    }
    send(contents, 'project:file', event);
  }
  const media = { current: () => editor.media.current(), start: () => editor.media.start() };

  bindRequests(contents, 'editor', {
    // Read again on every request: the file may have changed since the window opened.
    'project:info': async () => projectInfo(await openProjectFile(dir)),
    'project:reveal': (path) => {
      const target = resolve(dir, path ?? PROJECT_FILE);
      if (!isInside(target, dir, process.platform)) throw new Error('only files inside the project can be shown');
      shell.showItemInFolder(target);
    },
    'media:state': () => media.current(),
    'media:retry': () => void media.start(),
    'export:targets': async (formats) =>
      Promise.all(
        formats.map(async (format) => {
          const out = exportPath(dir, format);
          const info = await stat(out).catch(() => undefined);
          return { format, out, ...(info?.isFile() && { modified: info.mtimeMs }) };
        }),
      ),
    'export:start': ({ formats, encoder, captions, subtitles }) => {
      if (editor.run) throw new Error('an export is already running');
      const settings = { encoder, ...(captions !== undefined && { captions }), ...(subtitles && { subtitles }) };
      const run = new ExportRun(dir, formats, settings, (progress) => send(contents, 'export:progress', progress));
      editor.run = run;
      void run.done.then((end: ExportEnd) => {
        editor.run = undefined;
        send(contents, 'export:end', end);
      });
      return { out: join(dir, 'out') };
    },
    'export:cancel': () => editor.run?.cancel(),
    'project:record': () => void startPicking(dir),
    'project:takes': () => takesMenu(dir, window),
    'project:cut': () => void recut(dir),
    'project:transcribe': () => transcribeProject(dir, true),
    'project:read-screen': () => maskPrivacy(dir, true),
    'project:fit-length': ({ seconds }) => fitProjectLength(dir, seconds),
    'project:undo-restart': (discarded) => void undoRestart(dir, discarded),
    'app:settings': (page) => void openSettings({ page }),
    'project:save': ({ raw, base }) => editor.watch.save(raw, base),
    'project:draft': ({ raw }) => writeFile(join(dir, DRAFT_FILE), `${JSON.stringify(raw, null, 2)}\n`),
    // contents.reload() from here is not a navigation the page started (guard() refuses those)
    'project:reload': () => contents.reload(),
    'project:closed': () => closeNow(),
    'motion:project': ({ version, raw }) => motion.project(version, raw),
    'motion:frame': ({ version, request, width, height, mode, have }) => motion.frame(version, request, { width, height }, mode, have),
    'motion:strip': ({ version, request, frames, width, height, have }) => motion.strip(version, request, frames, { width, height }, have),
    'motion:params': (src) => motion.params(src),
    'motion:statuses': () => motion.statuses(),
    'motion:reload': (item) => motion.reload(item),
    'motion:add-template': async (template) => ({ src: await motion.addTemplate(template) }),
    'project:import-image': async ({ purpose }) => {
      const chosen =
        CHECK_IMAGE ??
        (
          await dialog.showOpenDialog(window, {
            title: purpose === 'still' ? 'An image for the page' : 'A background image',
            properties: ['openFile'],
            filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
          })
        ).filePaths[0];
      return chosen ? { path: await importImage(dir, chosen) } : undefined;
    },
  });
  editor.watch.start(file.hash);
  contents.on('did-finish-load', () => send(contents, 'project:status', editor.status ?? {}));

  // Closing waits until the page has written its last edits (a field being typed in too); what it
  // cannot write it keeps in cuttle.json.draft. A page that does not answer in 4 s is closed anyway.
  let mayClose = false;
  let asked: ReturnType<typeof setTimeout> | undefined;
  function closeNow(): void {
    mayClose = true;
    clearTimeout(asked);
    if (window.isDestroyed()) return;
    window.close();
    // a quit waited for this window: it goes on
    if (quitting) app.quit();
  }
  window.on('close', (event) => {
    if (mayClose || contents.isCrashed()) return;
    event.preventDefault();
    if (asked) return;
    asked = setTimeout(closeNow, 4000);
    send(contents, 'project:closing', {});
  });
  window.on('closed', () => {
    if (editors.get(key) === editor) editors.delete(key);
    editor.watch.close();
    editor.media.dispose();
    editor.motion.dispose();
    editor.run?.cancel();
    void release();
    // Closing the last editor returns to the pill (not while an editor is reopened on a new take).
    if (editors.size === 0 && opening.size === 0 && reopening === 0 && !quitting) void showPill();
  });
  window.once('ready-to-show', () => bringToFront(window));
  // The end-to-end check asks for a hook to drive the player (CUTTLE_CHECK=1) and for frames from
  // the take itself rather than the proxy (CUTTLE_NO_PROXY=1), to compare them with the export's.
  const query = new URLSearchParams({
    ...(CHECK && process.env.CUTTLE_NO_PROXY === '1' && { proxy: 'off' }),
    ...(CHECK && process.env.CUTTLE_CHECK === '1' && { check: '1' }),
  }).toString();
  await window.loadURL(`${APP_ORIGIN}/editor.html${query ? `?${query}` : ''}`);
  void media.start();
  void addRecent(dir);
  return window;
}

/** The open editor of a project folder (by its real path), if there is one. */
async function editorOf(dir: string): Promise<Editor | undefined> {
  const real = await realpath(resolve(dir)).catch(() => resolve(dir));
  return editors.get(keyOf(real));
}

/** The next outside change of the project comes from the app's own suggest ("Cuttle's cut"). */
export async function expectSuggest(dir: string, expecting: boolean): Promise<void> {
  const editor = await editorOf(dir);
  if (editor) editor.watch.origin = expecting ? 'suggest' : 'outside';
}

/** The next outside change of the project comes from the app's own speech edits ("Cuttle's speech edits"). */
export async function expectSpeech(dir: string, expecting: boolean): Promise<void> {
  const editor = await editorOf(dir);
  if (editor) editor.watch.origin = expecting ? 'speech' : 'outside';
}

/** The next outside change of the project comes from the app's own privacy masks ("Cuttle's privacy masks"). */
export async function expectPrivacy(dir: string, expecting: boolean): Promise<void> {
  const editor = await editorOf(dir);
  if (!editor) return;
  // the cut's write may still wait for the watcher's look: it keeps its own origin
  if (expecting) await editor.watch.settle();
  editor.watch.origin = expecting ? 'privacy' : 'outside';
}

/** The next outside change of the project comes from the app's own length fit ("Cuttle's length fit"). */
export async function expectLength(dir: string, expecting: boolean): Promise<void> {
  const editor = await editorOf(dir);
  if (!editor) return;
  // a change still waiting for the watcher's look keeps its own origin
  if (expecting) await editor.watch.settle();
  editor.watch.origin = expecting ? 'length' : 'outside';
}

/** The window of a project's open editor, if there is one. */
export async function editorWindowOf(dir: string): Promise<BrowserWindow | undefined> {
  const editor = await editorOf(dir);
  return editor && !editor.window.isDestroyed() ? editor.window : undefined;
}

/** Shows what the main process does to a project (`undefined`: nothing) in its editor's title bar. */
/** Sends an event to the project's editor, when one is open. */
export async function sendToEditor<E extends Event>(dir: string, channel: E, payload: Events[E]): Promise<void> {
  const editor = await editorOf(dir);
  if (editor && !editor.window.isDestroyed()) send(editor.contents, channel, payload);
}

export async function setEditorStatus(dir: string, status: ProjectStatus | undefined): Promise<void> {
  const editor = await editorOf(dir);
  if (!editor) return;
  editor.status = status;
  send(editor.contents, 'project:status', status ?? {});
}

/**
 * Shows the project in an editor again after its take or its cut changed: `reload` reloads the
 * page (the same take, new scenes); otherwise the window is opened anew (a new take needs new media).
 */
export async function reopenEditor(dir: string, options: { reload?: boolean } = {}): Promise<void> {
  const editor = await editorOf(dir);
  reopening++;
  try {
    if (editor && !editor.window.isDestroyed()) {
      if (options.reload) {
        editor.contents.reload();
        bringToFront(editor.window);
        return;
      }
      const closed = new Promise<void>((done) => editor.window.once('closed', () => done()));
      editor.window.destroy();
      await closed;
      await editor.release();
    }
    await openEditorOrSay(dir);
  } finally {
    reopening--;
  }
}

/** Editors being reopened on a new take: their close does not bring the pill back. */
let reopening = 0;

/** The take folder a project uses now (`takes/<n>/screen.mp4` → n). */
const currentTake = (file: { raw: Record<string, unknown> }): string | undefined => /^takes\/(\d+)\//.exec(String((file.raw.sources as { screen?: unknown }).screen ?? '').replaceAll('\\', '/'))?.[1];

/** The takes a project can go back to (`takes/<n>/cuttle.json`, kept when it recorded again), as a menu. */
async function takesMenu(dir: string, window: BrowserWindow): Promise<void> {
  const current = currentTake(await openProjectFile(dir));
  const names = await readdir(join(dir, 'takes')).catch(() => [] as string[]);
  const kept = names
    .filter((name) => /^\d+$/.test(name) && name !== current && existsSync(join(dir, 'takes', name, PROJECT_FILE)))
    .sort((a, b) => Number(b) - Number(a));
  // takes a restart put aside: brought back as the next take (the newest first)
  const aside = await readdir(join(dir, 'takes', '.discarded'), { withFileTypes: true }).catch(() => []);
  const putAside = (
    await Promise.all(
      aside
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => ({ name: entry.name, at: (await stat(join(dir, 'takes', '.discarded', entry.name)).catch(() => undefined))?.mtimeMs ?? 0 })),
    )
  ).sort((a, b) => b.at - a.at);
  const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  // every take but the one in use may go, with its size: what deleting it frees
  const deletable = await Promise.all(
    [
      ...deletableTakes(names, current).map((take) => ({ rel: `takes/${take}`, label: `Take ${take}` })),
      ...putAside.map((take) => ({ rel: `takes/.discarded/${take.name}`, label: `The take put aside at ${time(take.at)}` })),
    ].map(async (take) => ({ ...take, bytes: await folderBytes(join(dir, take.rel)) })),
  );
  const busy = takesBusy(dir);
  Menu.buildFromTemplate([
    { label: `Take ${current ?? '?'} (now)`, enabled: false },
    ...(kept.length === 0
      ? [{ label: 'No earlier take to go back to', enabled: false }]
      : kept.map((take) => ({ label: `Back to take ${take}`, click: () => void backToTake(dir, take) }))),
    ...(putAside.length > 0
      ? [
          { type: 'separator' as const },
          { label: 'Put aside by a restart', enabled: false },
          ...putAside.map((take) => ({ label: `Use the take from ${time(take.at)}`, click: () => void undoRestart(dir, ['takes', '.discarded', take.name].join('/')) })),
        ]
      : []),
    ...(deletable.length > 0
      ? [
          { type: 'separator' as const },
          {
            label: 'Delete a take',
            enabled: !busy,
            submenu: deletable.map((take) => ({ label: `${take.label} · ${sizeText(take.bytes)}…`, click: () => void deleteTake(dir, take.rel, take.label, take.bytes) })),
          },
        ]
      : []),
    { type: 'separator' },
    { label: 'Record a new take…', click: () => void startPicking(dir) },
  ]).popup({ window });
}

/** A folder's size in bytes, its files' sizes added up (0 when it cannot be read). */
async function folderBytes(path: string): Promise<number> {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const child = join(path, entry.name);
      if (entry.isDirectory()) return folderBytes(child);
      return (await stat(child).catch(() => undefined))?.size ?? 0;
    }),
  );
  return sizes.reduce((sum, size) => sum + size, 0);
}

/**
 * Deletes a take folder (`takes/<n>`, or one a restart put aside) after the person confirmed it: it
 * goes to the Trash (Recycle Bin on Windows), never away for good. Never the take the project uses
 * now, nor while a take is recorded into the project or cut for it. The check confirms without a
 * dialog and deletes for good (no check fills the Trash). Returns whether it was deleted.
 */
export async function deleteTake(dir: string, rel: string, label: string, bytes: number): Promise<boolean> {
  const say = (message: string) => (HIDDEN ? console.error(message) : void dialog.showMessageBox({ type: 'warning', title: 'Cuttle', message }));
  if (takesBusy(dir)) {
    say('Cuttle is recording or cutting a take of this project: delete takes once it is done.');
    return false;
  }
  const current = currentTake(await openProjectFile(dir).catch(() => ({ raw: {} })));
  if (current !== undefined && rel === `takes/${current}`) {
    say(`Take ${current} is the one this project uses: it cannot be deleted.`);
    return false;
  }
  const trash = trashName(process.platform);
  if (!HIDDEN) {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: 'Cuttle',
      message: `Delete ${label.charAt(0).toLowerCase()}${label.slice(1)}?`,
      detail: `${sizeText(bytes)} in ${rel} go to the ${trash}. The take this project uses now stays.`,
      buttons: ['Cancel', `Move to the ${trash}`],
      defaultId: 0,
      cancelId: 0,
    });
    if (response !== 1) return false;
  }
  try {
    const path = join(dir, ...rel.split('/'));
    if (CHECK) await rm(path, { recursive: true, force: true });
    else await shell.trashItem(path);
    return true;
  } catch (error) {
    say(`Cuttle could not delete ${label.toLowerCase()}: ${(error as Error).message}`);
    return false;
  }
}

// The check deletes takes as the menu does (a native menu cannot be clicked from a page).
if (CHECK) (globalThis as { __deleteTake?: typeof deleteTake }).__deleteTake = deleteTake;

/** Makes an earlier take the project's again, with the edit it had; the current one stays restorable. */
async function backToTake(dir: string, take: string): Promise<void> {
  try {
    const file = await openProjectFile(dir);
    const current = currentTake(file);
    if (current) await copyFile(join(dir, PROJECT_FILE), join(dir, 'takes', current, PROJECT_FILE));
    const kept = JSON.parse(await readFile(join(dir, 'takes', take, PROJECT_FILE), 'utf8')) as Record<string, unknown>;
    await writeProjectFile({ ...file, raw: kept }, 'back to take', { backup: true });
  } catch (error) {
    if (!HIDDEN) void dialog.showMessageBox({ type: 'warning', title: 'Cuttle', message: `Cuttle cannot go back to take ${take}`, detail: (error as Error).message });
    return;
  }
  await reopenEditor(dir);
}

/** One sentence for people from an error's message: the first line. */
const firstLine = (message: string) => message.split('\n')[0]!;

/** Opens a project, saying in a dialog what went wrong instead of throwing (with "Open anyway" for a lock held elsewhere). */
export async function openEditorOrSay(dir: string, options: { force?: boolean } = {}): Promise<void> {
  try {
    await openEditor(dir, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (HIDDEN) {
      console.error(`cannot open ${dir}: ${message}`);
      return;
    }
    const name = basename(resolve(dir));
    if (error instanceof LockedError) {
      const { response } = await dialog.showMessageBox({
        type: 'warning',
        title: 'Cuttle',
        message: `${name} is open in Cuttle on ${error.host}`,
        detail: 'Editing it in two places at once can lose changes. Open it here only if it is not open there any more.',
        buttons: ['Cancel', 'Open anyway'],
        defaultId: 0,
        cancelId: 0,
      });
      if (response === 1) await openEditorOrSay(dir, { force: true });
      return;
    }
    const issues = message.split('\n').slice(1).map((line) => plainIssue(line.trim())).filter(Boolean);
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: 'Cuttle',
      message: `${name} can't be opened`,
      detail: issues.length > 0 ? `cuttle.json has ${issues.length === 1 ? 'a mistake' : `${issues.length} mistakes`}:\n${issues.join('\n')}` : firstLine(message),
      buttons: ['OK', 'Show the folder'],
      defaultId: 0,
      cancelId: 0,
    });
    if (response === 1) shell.showItemInFolder(join(resolve(dir), PROJECT_FILE));
  }
}

/** Asks for a project folder and opens it. */
export async function chooseAndOpen(parent?: BrowserWindow): Promise<void> {
  const options = { title: 'Open a Cuttle project', properties: ['openDirectory'] as 'openDirectory'[], buttonLabel: 'Open' };
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
  if (!result.canceled && result.filePaths[0]) await openEditorOrSay(result.filePaths[0]);
}

/** A recent project for a menu: its name, and its parent folder to tell same-named projects apart. */
export const recentLabel = (entry: { dir: string; name: string }) => `${entry.name} — ${basename(dirname(entry.dir))}`;

let pill: BrowserWindow | undefined;
let quitting = false;
app.on('before-quit', () => (quitting = true));
const PILL_SIZE = { width: 420, height: 64 };

/** The pill's place on the display under the pointer: where it was left there (kept on screen), else the top centre. */
async function pillPosition(): Promise<{ x: number; y: number }> {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area = display.workArea;
  const saved = (await loadSettings()).pill[String(display.id)];
  const x = saved?.x ?? Math.round(area.x + (area.width - PILL_SIZE.width) / 2);
  const y = saved?.y ?? area.y + 24;
  return {
    x: Math.min(Math.max(x, area.x), area.x + area.width - PILL_SIZE.width),
    y: Math.min(Math.max(y, area.y), area.y + area.height - PILL_SIZE.height),
  };
}

/** The pill: a small launcher near the top of the screen, kept out of every recording. Closing it hides it. */
export async function createPill(): Promise<BrowserWindow> {
  if (pill && !pill.isDestroyed()) return pill;
  const ses = session.fromPartition('pill');
  lockDown(ses);
  serveApp(ses, bundlePath('renderer'));
  const window = new BrowserWindow({
    ...PILL_SIZE,
    ...(await pillPosition()),
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
  const contents = window.webContents;
  guard(contents);
  window.setContentProtection(true);
  window.setAlwaysOnTop(true, 'floating');
  bindRequests(contents, 'pill', {
    'pill:recent': async () => (await loadSettings()).recent,
    'pill:open': async (target) => {
      if (target) await openEditorOrSay(target.dir);
      else await chooseAndOpen();
    },
    'pill:hide': () => window.hide(),
    'pill:record': () => void startPicking(undefined, { fromPill: true }),
    'pill:menu': async () => {
      const recent = (await loadSettings()).recent;
      Menu.buildFromTemplate([
        ...(recent.length === 0
          ? [{ label: 'No recent projects', enabled: false }]
          : recent.map((entry) => ({ label: recentLabel(entry), toolTip: entry.dir, click: () => void openEditorOrSay(entry.dir) }))),
        { type: 'separator' },
        { label: 'Open folder…', click: () => void chooseAndOpen() },
        { label: 'Settings…', click: () => void openSettings() },
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
  // Alt+F4 hides it; the tray and the hotkey bring it back.
  window.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    window.hide();
  });
  window.on('show', () => void loadSettings().then((settings) => send(contents, 'pill:recent', settings.recent)));
  window.on('closed', () => (pill = undefined));
  await window.loadURL(`${APP_ORIGIN}/pill.html`);
  pill = window;
  return window;
}

/** Hides the pill: a recording is picked from it (it is not to be in the video). */
export function hidePill(): void {
  if (pill && !pill.isDestroyed()) pill.hide();
}

export async function showPill(): Promise<void> {
  const window = await createPill();
  const { x, y } = await pillPosition();
  window.setPosition(x, y);
  if (!HIDDEN) window.showInactive();
}
