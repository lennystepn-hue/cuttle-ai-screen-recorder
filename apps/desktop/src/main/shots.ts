// Screenshots from the app: each display frozen as it was when the shot was asked for (the pickers
// draw over that picture, so an open menu stays in it), the pick taken into a folder of its own in
// the library (Pictures/Cuttle), then framed in the last look and copied, with a toast to edit it
// (quick), or opened in the screenshot editor, which draws the shot itself (the engine's drawShot)
// and keeps its shot.json and shot.png as it goes.
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { app, BrowserWindow, clipboard, ClipboardItem, dialog, nativeImage, screen, session, shell, type Rectangle } from 'electron';
import { imagePalette, imageSize, importWallpaper, keepInProject, listBrands, listShotStyles, lookFrom, lookInto, newShotFolder, pngScale, redactShot, saveShotStyle, shotBrand, shotStyleFor } from '@cuttle/core';
import { renderShot } from '@cuttle/export';
import { SHOT_FILE, SHOT_VERSION, parseShot, parseShotJson } from '@cuttle/project';
import type { ShotDelay, ShotEntry, ShotLookAnswer, ShotView } from '../shared/ipc';
import type { PickedTarget, PickerDisplay } from '../shared/recording';
import { CHECK, CHECK_IMAGE, HIDDEN } from './check';
import { bindRequests, send } from './ipc';
import { APP_ORIGIN, assetPath, bundlePath, serveApp } from './protocols';
import { recorderHost } from './recorder-host';
import { loadSettings, replaceFile, updateSettings } from './settings';
import { bringToFront, guard, lockDown, titleBar, webPreferences } from './windows';

/** The shot's picture as taken, and its last render, in its folder. */
const SOURCE = 'source.png';
const RENDER = 'shot.png';
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
 * its region; after a timer, the screen as it is then. Answers what comes next, once the picture is
 * in its folder: framed in the last look and copied (quick), or opened in the editor. Says nothing
 * itself: a failure is thrown.
 */
export async function takePicked(target: PickedTarget, display: PickerDisplay, delay: ShotDelay): Promise<() => Promise<void>> {
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
  await writeShot(folder, scale, settings.shots.look);
  return () => (settings.shots.quick ? quickShot(folder, display) : openShotEditor(folder));
}

/** A shot's shot.json for its source.png: the last shot's look, when it still makes a shot. */
async function writeShot(folder: string, scale: number, look: Record<string, unknown> | undefined): Promise<void> {
  const base = { version: SHOT_VERSION, source: SOURCE, ...(scale !== 1 && { scale }) };
  // the images the look names (a background, a logo) come along into the shot's folder
  const withLook = { ...(look ? await lookInto(look, folder) : {}), ...base };
  await writeJson(join(folder, SHOT_FILE), parseShot(withLook).ok ? withLook : base);
}

/**
 * A picture as a new shot of the library (a screenshot a take took, a frame of the video), in the
 * last look, opened in the screenshot editor. Its scale comes from its PNG's resolution.
 */
export async function openAsShot(image: string, given?: number): Promise<void> {
  const scale = given ?? pngScale(await readFile(image)) ?? 1;
  const settings = await loadSettings();
  const folder = newShotFolder(settings.shots.folder);
  await mkdir(folder, { recursive: true });
  await copyFile(image, join(folder, SOURCE));
  await writeShot(folder, scale, settings.shots.look);
  await openShotEditor(folder);
}

/** Puts a PNG into the clipboard as an image other apps paste; the check keeps it instead (the person's clipboard stays theirs). */
export async function copyImage(png: Uint8Array): Promise<void> {
  if (CHECK) {
    (globalThis as { __copiedImage?: Uint8Array }).__copiedImage = png;
    return;
  }
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })]);
}

/** Each write's own temporary file: two at once (a change and a copy) never rename the same one. */
let writes = 0;
const tempOf = (file: string) => `${file}.${process.pid}.${++writes}.tmp`;

/** Writes a file whole: a temporary file renamed over it (a reader never sees half), Windows' refusals waited out. */
async function writeWhole(file: string, data: string | Uint8Array): Promise<void> {
  const temp = tempOf(file);
  await writeFile(temp, data);
  await replaceFile(temp, file).catch(async (error: unknown) => {
    await rm(temp, { force: true });
    throw error;
  });
}

const writeJson = (file: string, value: unknown) => writeWhole(file, `${JSON.stringify(value, null, 2)}\n`);

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
/** Starts a new screenshot (the pickers) and resolves once it is taken or cancelled; set by the recording module, which owns them. */
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
  const watermarkImage = await bytesOf(dir, parsed.shot.watermark?.image);
  return { dir, name: basename(dir), raw, image: new Uint8Array(await readFile(source)), ...(backgroundImage && { backgroundImage }), ...(watermarkImage && { watermarkImage }) };
}

/** The bytes of an image a shot names (from its folder), when it is there. */
async function bytesOf(dir: string, image: string | undefined): Promise<Uint8Array | undefined> {
  const path = image ? resolve(dir, image) : undefined;
  return path && existsSync(path) ? new Uint8Array(await readFile(path)) : undefined;
}

/** A look for the editor (a brand kit's, a style's) with the bytes of the images it names. */
async function lookAnswer(dir: string, fields: Record<string, unknown>): Promise<ShotLookAnswer> {
  const image = (key: 'background' | 'watermark') => {
    const value = (fields[key] as Record<string, unknown> | undefined)?.image;
    return typeof value === 'string' ? value : undefined;
  };
  const [backgroundImage, watermarkImage] = await Promise.all([bytesOf(dir, image('background')), bytesOf(dir, image('watermark'))]);
  return { fields, ...(backgroundImage && { backgroundImage }), ...(watermarkImage && { watermarkImage }) };
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
  const render = () => join(current.dir, RENDER);
  /**
   * The shot's writes one after another, in the order they were asked for: one that waits for a
   * file (Windows) never lands over a later one, which would put an older look back.
   */
  let writing: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(write: () => Promise<T>): Promise<T> => {
    const done = writing.then(write);
    writing = done.catch(() => {});
    return done;
  };
  /** Writes a render as the shot's shot.png. */
  const keep = (bytes: Uint8Array) => {
    const file = render();
    return inTurn(() => writeWhole(file, bytes));
  };
  bindRequests(contents, 'shot', {
    'shot:view': () => viewOf(current.dir),
    'shot:change': ({ raw }) => {
      // the shot it was asked for, though another opens meanwhile
      const dir = current.dir;
      return inTurn(async () => {
        const before = (await viewOf(dir)).raw;
        // the shot keeps its own image; a background image stays inside its folder
        const next: Record<string, unknown> = { ...raw, version: SHOT_VERSION, source: before.source };
        for (const key of ['background', 'watermark'] as const) {
          const image = (next[key] as Record<string, unknown> | undefined)?.image;
          if (typeof image === 'string' && !inside(dir, image)) return { issues: [`${key}.image: not an image of this shot`] };
        }
        const parsed = parseShot(next);
        if (!parsed.ok) return { issues: parsed.issues.map((issue) => `${issue.path}: ${issue.message}`) };
        await writeJson(join(dir, SHOT_FILE), next);
        // the next shot takes this look
        await updateSettings((settings) => {
          settings.shots.look = lookFrom(next, dir);
        });
        return {};
      });
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
    'shot:redact': async () => {
      const raw = (await viewOf(current.dir)).raw;
      const source = resolve(current.dir, String(raw.source));
      const size = imageSize(await readFile(source));
      if (!size) throw new Error('the size of the shot\'s image cannot be read');
      return { masks: await redactShot(source, size, (await loadSettings()).privacy.words) };
    },
    'shot:brands': async () => (await listBrands()).map((brand) => brand.kit.name),
    'shot:brand': async ({ name }) => {
      const kit = await shotBrand(name, current.dir);
      return lookAnswer(current.dir, { background: kit.background, frame: kit.frame, font: kit.font, ...(kit.watermark && { watermark: kit.watermark }) });
    },
    'shot:styles': async () => Object.keys(await listShotStyles()),
    'shot:style': async ({ name }) => lookAnswer(current.dir, await shotStyleFor(name, current.dir)),
    'shot:style-save': async ({ name }) => saveShotStyle(name, (await viewOf(current.dir)).raw, undefined, current.dir),
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
  // shown once its page is there; a window closed meanwhile never stalls the one who opened it
  window.once('ready-to-show', () => bringToFront(window));
  void window.loadURL(`${APP_ORIGIN}/shot.html`).catch(() => {});
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
