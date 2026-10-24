// Screenshots from the app: each display frozen as it was when the shot was asked for (the pickers
// draw over that picture, so an open menu stays in it), the pick taken into a folder of its own in
// the library (Pictures/Cuttle), then framed in the last look and copied, with a toast to edit it
// (quick), or opened in the screenshot editor, which draws the shot itself (the engine's drawShot)
// and keeps its shot.json and shot.png as it goes.
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { app, BrowserWindow, clipboard, ClipboardItem, dialog, nativeImage, screen, session, shell, type Rectangle } from 'electron';
import { imagePalette, importWallpaper, keepInProject, newShotFolder } from '@cuttle/core';
import { renderShot } from '@cuttle/export';
import { SHOT_FILE, SHOT_VERSION, parseShot, parseShotJson } from '@cuttle/project';
import type { ShotDelay, ShotEntry, ShotView } from '../shared/ipc';
import type { PickedTarget, PickerDisplay } from '../shared/recording';
import { CHECK, CHECK_IMAGE, HIDDEN } from './check';
import { bindRequests, send } from './ipc';
import { APP_ORIGIN, assetPath, bundlePath, serveApp } from './protocols';
import { recorderHost } from './recorder-host';
import { loadSettings, updateSettings } from './settings';
import { bringToFront, guard, lockDown, titleBar, webPreferences } from './windows';

/** The shot's picture as taken, and its last render, in its folder. */
const SOURCE = 'source.png';
const RENDER = 'shot.png';
/** What a shot's look is not: its own image, scale and crop (the next shot keeps the rest). */
const NOT_LOOK = new Set(['version', 'source', 'scale', 'crop']);
/** The toast's window (its card and a margin for the shadow), and how long it stays unless pointed at. */
const TOAST_SIZE = { width: 340, height: 264 };
const TOAST_SECONDS = 6;
/** The library lists this many shots, newest first, with pictures this wide. */
const LIBRARY_MAX = 48;
const THUMB_WIDTH = 240;
const TITLE_BAR_HEIGHT = 40;

/** Each display's picture when the screenshot was asked for, by display id, in a temporary folder. */
let frozen: { dir: string; files: Map<number, string> } | undefined;

/** Takes a picture of each display before the pickers show (Cuttle's own windows left out); a display that fails shows live. */
export async function freezeDisplays(displays: readonly PickerDisplay[]): Promise<void> {
  await thawDisplays();
  const dir = await mkdtemp(join(tmpdir(), 'cuttle-frozen-'));
  const files = new Map<number, string>();
  await Promise.all(
    displays.map(async (display) => {
      if (display.monitor === undefined) return;
      const out = join(dir, `${display.id}.png`);
      const taken = await recorderHost.shot({ source: { kind: 'monitor', index: display.monitor }, out, hideWindowsOf: [process.pid] }).catch(() => undefined);
      if (taken) files.set(display.id, out);
    }),
  );
  frozen = { dir, files };
}

/** The frozen picture of a display (a PNG), for its picker. */
export async function frozenDisplay(display: number): Promise<Uint8Array | undefined> {
  const file = frozen?.files.get(display);
  return file ? new Uint8Array(await readFile(file)) : undefined;
}

/** Lets go of the frozen pictures. */
export async function thawDisplays(): Promise<void> {
  const dir = frozen?.dir;
  frozen = undefined;
  if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
}

/** A rect of the display (DIP, desktop coordinates) in its picture's pixels, kept inside it. */
function pixelRect(rect: Rectangle, display: PickerDisplay, size: { width: number; height: number }): Rectangle {
  const ratio = size.width / display.bounds.width;
  const x = Math.max(0, Math.round((rect.x - display.bounds.x) * ratio));
  const y = Math.max(0, Math.round((rect.y - display.bounds.y) * ratio));
  return { x, y, width: Math.max(1, Math.min(Math.round(rect.width * ratio), size.width - x)), height: Math.max(1, Math.min(Math.round(rect.height * ratio), size.height - y)) };
}

/**
 * Takes a pick into a new shot folder: a window by itself (as it is now), else the frozen display or
 * its region; after a timer, the screen as it is then. Then frames it in the last look and copies it
 * (quick) or opens it in the editor. Says nothing itself: a failure is thrown.
 */
export async function takePicked(target: PickedTarget, display: PickerDisplay, delay: ShotDelay): Promise<void> {
  const settings = await loadSettings();
  await updateSettings((next) => {
    next.shots.delay = delay;
  });
  const folder = newShotFolder(settings.shots.folder);
  await mkdir(folder, { recursive: true });
  const out = join(folder, SOURCE);
  const picture = delay === 0 ? frozen?.files.get(display.id) : undefined;
  let scale = display.scaleFactor;
  try {
    if (target.kind === 'window') {
      scale = (await recorderHost.shot({ source: { kind: 'window', id: target.window }, out, hideWindowsOf: [process.pid] })).scale;
    } else if (picture) {
      const image = nativeImage.createFromPath(picture);
      if (target.kind === 'screen') await copyFile(picture, out);
      else await writeFile(out, image.crop(pixelRect(target.rect, display, image.getSize())).toPNG());
    } else {
      if (display.monitor === undefined) throw new Error('the recorder does not know this display');
      const size = display.pixels;
      const source =
        target.kind === 'screen'
          ? ({ kind: 'monitor', index: display.monitor } as const)
          : (() => {
              const { x, y, width, height } = pixelRect(target.rect, display, size);
              return { kind: 'region' as const, monitor: display.monitor, rect: [x, y, width, height] as [number, number, number, number] };
            })();
      scale = (await recorderHost.shot({ source, out, hideWindowsOf: [process.pid] })).scale;
    }
  } catch (error) {
    await rm(folder, { recursive: true, force: true }).catch(() => {});
    throw error;
  } finally {
    await thawDisplays();
  }
  // the last shot's look, when it still makes a shot
  const base = { version: SHOT_VERSION, source: SOURCE, ...(scale !== 1 && { scale }) };
  const withLook = { ...(settings.shots.look ?? {}), ...base };
  const raw = parseShot(withLook).ok ? withLook : base;
  await writeJson(join(folder, SHOT_FILE), raw);
  if (settings.shots.quick) await quickShot(folder, display);
  else await openShotEditor(folder);
}

/** Puts a PNG into the clipboard as an image other apps paste; the check keeps it instead (the person's clipboard stays theirs). */
async function copyImage(png: Uint8Array): Promise<void> {
  if (CHECK) {
    (globalThis as { __copiedImage?: Uint8Array }).__copiedImage = png;
    return;
  }
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })]);
}

async function writeJson(file: string, value: unknown): Promise<void> {
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temp, file);
}

/** Frames a shot in its look (the export's renderer), copies it and shows the toast. */
async function quickShot(folder: string, display: PickerDisplay): Promise<void> {
  const parsed = parseShotJson(await readFile(join(folder, SHOT_FILE), 'utf8'));
  if (!parsed.ok) throw new Error(`${SHOT_FILE}: ${parsed.issues.map((issue) => issue.message).join('; ')}`);
  const drawn = await renderShot({ shot: parsed.shot, dir: folder, out: join(folder, RENDER), pageDir: bundlePath('main', 'export-page') });
  const png = await readFile(drawn.file);
  await copyImage(png);
  showToast(folder, nativeImage.createFromBuffer(png), display);
}

let toast: { window: BrowserWindow; folder: string; timer?: ReturnType<typeof setTimeout> } | undefined;

/** The toast: the framed shot, copied, with Edit and Show in folder, at the display's bottom right; it goes after a few seconds unless pointed at. */
function showToast(folder: string, image: Electron.NativeImage, display: PickerDisplay): void {
  closeToast();
  const area = screen.getAllDisplays().find((candidate) => candidate.id === display.id)?.workArea ?? screen.getPrimaryDisplay().workArea;
  const ses = session.fromPartition('toast');
  lockDown(ses);
  serveApp(ses, bundlePath('renderer'));
  const window = new BrowserWindow({
    ...TOAST_SIZE,
    x: area.x + area.width - TOAST_SIZE.width - 8,
    y: area.y + area.height - TOAST_SIZE.height - 8,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    title: 'Cuttle',
    webPreferences: webPreferences('toast.cjs', ses),
  });
  guard(window.webContents);
  window.setContentProtection(true);
  window.setAlwaysOnTop(true, 'floating');
  const current: NonNullable<typeof toast> = { window, folder };
  toast = current;
  const later = () => {
    if (current.timer) clearTimeout(current.timer);
    current.timer = setTimeout(() => toast === current && closeToast(), TOAST_SECONDS * 1000);
  };
  bindRequests(window.webContents, 'toast', {
    'toast:edit': async () => {
      closeToast();
      await openShotEditor(folder);
    },
    'toast:reveal': () => {
      shell.showItemInFolder(join(folder, RENDER));
      closeToast();
    },
    'toast:close': () => closeToast(),
    'toast:hover': (over) => {
      if (over && current.timer) clearTimeout(current.timer);
      else if (!over) later();
    },
  });
  const size = image.getSize();
  void window.loadURL(`${APP_ORIGIN}/toast.html`).then(() => {
    if (window.isDestroyed()) return;
    send(window.webContents, 'toast:show', { name: basename(folder), thumb: new Uint8Array(image.resize({ width: Math.min(size.width, 600) }).toPNG()), width: size.width, height: size.height, copied: true });
    if (!HIDDEN) window.showInactive();
    later();
  }, () => {});
}

function closeToast(): void {
  const current = toast;
  toast = undefined;
  if (current?.timer) clearTimeout(current.timer);
  if (current && !current.window.isDestroyed()) current.window.destroy();
}

/** The toast's folder while it shows (the check reads it). */
export const toastFolder = (): string | undefined => toast?.folder;

// ---------------------------------------------------------------------------------------------
// The screenshot editor

let editor: { window: BrowserWindow; dir: string } | undefined;
/** Starts a new screenshot (the pickers); set by the recording module, which owns them. */
let shoot: (() => Promise<void>) | undefined;
export function onNewShot(start: () => Promise<void>): void {
  shoot = start;
}

/** A path from the shot's folder that stays inside it, or undefined. */
function inside(dir: string, path: string): string | undefined {
  const full = resolve(dir, path);
  const rel = relative(dir, full);
  return rel && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel) ? full : undefined;
}

/** A shot's folder as the editor shows it: shot.json as written, its image and a background image's bytes. */
async function viewOf(dir: string): Promise<ShotView> {
  const text = await readFile(join(dir, SHOT_FILE), 'utf8');
  const parsed = parseShotJson(text);
  if (!parsed.ok) throw new Error(`${join(dir, SHOT_FILE)}: ${parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`);
  const raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as Record<string, unknown>;
  const source = isAbsolute(parsed.shot.source) ? parsed.shot.source : join(dir, parsed.shot.source);
  const background = parsed.shot.background.preset === 'image' && parsed.shot.background.image ? resolve(dir, parsed.shot.background.image) : undefined;
  const backgroundImage = background && existsSync(background) ? new Uint8Array(await readFile(background)) : undefined;
  return { dir, name: basename(dir), raw, image: new Uint8Array(await readFile(source)), ...(backgroundImage && { backgroundImage }) };
}

/** Shows a shot in the screenshot editor (one window, for one shot at a time). */
export async function openShotEditor(dir: string): Promise<void> {
  const view = await viewOf(dir);
  if (editor && !editor.window.isDestroyed()) {
    editor.dir = dir;
    send(editor.window.webContents, 'shot:show', view);
    bringToFront(editor.window);
    return;
  }
  const ses = session.fromPartition('shot');
  lockDown(ses);
  serveApp(ses, bundlePath('renderer'));
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 860,
    minHeight: 540,
    show: false,
    backgroundColor: '#0c0c0f',
    title: 'Cuttle screenshot',
    ...titleBar(TITLE_BAR_HEIGHT),
    icon: assetPath('icon.png'),
    webPreferences: webPreferences('shot.cjs', ses),
  });
  const contents = window.webContents;
  guard(contents);
  const current = { window, dir };
  editor = current;
  window.on('closed', () => {
    if (editor === current) editor = undefined;
  });
  const shotJson = () => join(current.dir, SHOT_FILE);
  const render = () => join(current.dir, RENDER);
  /** Writes a render as the shot's shot.png (temp file and rename, so a reader never sees half). */
  const keep = async (bytes: Uint8Array) => {
    const temp = `${render()}.${process.pid}.tmp`;
    await writeFile(temp, bytes);
    await rename(temp, render());
  };
  bindRequests(contents, 'shot', {
    'shot:view': () => viewOf(current.dir),
    'shot:change': async ({ raw }) => {
      const before = (await viewOf(current.dir)).raw;
      // the shot keeps its own image; a background image stays inside its folder
      const next: Record<string, unknown> = { ...raw, version: SHOT_VERSION, source: before.source };
      const background = next.background as Record<string, unknown> | undefined;
      if (background && typeof background.image === 'string' && !inside(current.dir, background.image)) return { issues: ['background.image: not an image of this shot'] };
      const parsed = parseShot(next);
      if (!parsed.ok) return { issues: parsed.issues.map((issue) => `${issue.path}: ${issue.message}`) };
      await writeJson(shotJson(), next);
      // the next shot takes this look
      await updateSettings((settings) => {
        settings.shots.look = Object.fromEntries(Object.entries(next).filter(([key]) => !NOT_LOOK.has(key)));
      });
      return {};
    },
    'shot:palette': async () => {
      const raw = (await viewOf(current.dir)).raw;
      return imagePalette(resolve(current.dir, String(raw.source)));
    },
    'shot:background-image': async (kind) => {
      let image: string;
      if (kind === 'wallpaper') image = await importWallpaper(current.dir);
      else {
        const chosen = CHECK
          ? CHECK_IMAGE
          : (await dialog.showOpenDialog(window, { title: 'An image behind the shot', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] })).filePaths[0];
        if (!chosen) return undefined;
        const ext = extname(chosen).toLowerCase();
        image = await keepInProject(current.dir, await readFile(chosen), 'images', basename(chosen, extname(chosen)).replace(/[^\w.-]+/g, '-') || 'background', ext);
      }
      return { image, bytes: new Uint8Array(await readFile(join(current.dir, image))) };
    },
    'shot:copy': async ({ png }) => {
      await keep(png);
      await copyImage(png);
    },
    'shot:save': async ({ data, format, as }) => {
      if (format === 'png') await keep(data);
      if (!as) return undefined;
      const extension = format === 'jpeg' ? 'jpg' : format;
      const chosen = CHECK
        ? join(current.dir, `saved.${extension}`)
        : (await dialog.showSaveDialog(window, { title: 'Save the screenshot', defaultPath: join(app.getPath('pictures'), `${basename(current.dir)}.${extension}`), filters: [{ name: format.toUpperCase(), extensions: [extension] }] })).filePath;
      if (!chosen) return undefined;
      await writeFile(chosen, data);
      return chosen;
    },
    'shot:drag': () => {
      if (!existsSync(render())) return;
      const icon = nativeImage.createFromPath(render());
      contents.startDrag({ file: render(), icon: icon.resize({ width: 160 }) });
    },
    'shot:reveal': () => shell.showItemInFolder(existsSync(render()) ? render() : current.dir),
    'shot:library': () => library(),
    'shot:open': async ({ dir }) => {
      const known = (await library()).some((entry) => entry.dir === dir);
      if (!known) throw new Error('not a shot of the library');
      current.dir = dir;
      send(contents, 'shot:show', await viewOf(dir));
    },
    'shot:new': async () => {
      // the editor steps aside: it is not in the shot, and the shot opens in it again
      window.hide();
      try {
        await shoot?.();
      } finally {
        if (!window.isDestroyed() && editor === current && !window.isVisible() && !HIDDEN) window.show();
      }
    },
  });
  await window.loadURL(`${APP_ORIGIN}/shot.html`);
  bringToFront(window);
}

/** The shots in the library folder, newest first, each with a small picture. */
async function library(): Promise<ShotEntry[]> {
  const folder = (await loadSettings()).shots.folder;
  const names = await readdir(folder).catch(() => [] as string[]);
  const shots: { dir: string; name: string; time: number }[] = [];
  for (const name of names) {
    const dir = join(folder, name);
    const info = await stat(join(dir, SHOT_FILE)).catch(() => undefined);
    if (info) shots.push({ dir, name, time: info.mtimeMs });
  }
  shots.sort((a, b) => b.time - a.time || b.name.localeCompare(a.name));
  return shots.slice(0, LIBRARY_MAX).map(({ dir, name }) => {
    const picture = [join(dir, RENDER), join(dir, SOURCE)].find((file) => existsSync(file));
    const image = picture ? nativeImage.createFromPath(picture) : undefined;
    const thumb = image && !image.isEmpty() ? new Uint8Array(image.resize({ width: THUMB_WIDTH }).toPNG()) : undefined;
    return { dir, name, ...(thumb && { thumb }) };
  });
}
