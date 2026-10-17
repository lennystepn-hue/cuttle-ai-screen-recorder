import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserWindow } from 'electron';

export interface CaptureOptions {
  /** An http(s) URL or a local file. */
  target: string;
  /** PNG to write. */
  out: string;
  /** Viewport in CSS pixels; the PNG has these pixels (device scale 1). */
  width: number;
  height: number;
  /** The whole page (for a scrolling still) instead of the viewport. */
  fullPage: boolean;
  /** Time after the page loaded, for fonts, maps and animations. */
  waitMs: number;
}

export interface CaptureResult {
  file: string;
  width: number;
  height: number;
}

/** Chromium cannot capture taller pictures in one go; longer pages are cut here. */
export const MAX_PAGE_HEIGHT = 16_384;
const LOAD_TIMEOUT_MS = 30_000;
const CAPTURE_TIMEOUT_MS = 20_000;

export class CaptureError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CaptureError';
  }
}

/**
 * A page as a PNG. The window renders offscreen: a hidden on-screen window paints a still page only
 * once, and a screenshot then waits for a frame that never comes. The size comes from a
 * device-metrics override at scale 1 and a clip, not from the window, whose pixels depend on the
 * display's scale.
 */
export async function capturePage(options: CaptureOptions): Promise<CaptureResult> {
  const url = /^https?:\/\//i.test(options.target) ? options.target : fileUrl(options.target);
  const win = new BrowserWindow({
    show: false,
    width: options.width,
    height: options.height,
    useContentSize: true,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  try {
    await withTimeout(win.loadURL(url), LOAD_TIMEOUT_MS, `${options.target} did not load within ${LOAD_TIMEOUT_MS / 1000} s`).catch((error: Error) => {
      throw error instanceof CaptureError ? error : new CaptureError('invalid-media', `cannot load ${options.target}: ${error.message}`);
    });
    await new Promise((done) => setTimeout(done, options.waitMs));
    const debug = win.webContents.debugger;
    debug.attach('1.3');
    const viewport = (height: number) =>
      debug.sendCommand('Emulation.setDeviceMetricsOverride', { width: options.width, height, deviceScaleFactor: 1, mobile: false });
    await viewport(options.height);
    let height = options.height;
    if (options.fullPage) {
      const scrollHeight = (await win.webContents.executeJavaScript('Math.ceil(document.documentElement.scrollHeight)')) as number;
      height = Math.min(MAX_PAGE_HEIGHT, Math.max(options.height, scrollHeight));
      await viewport(height);
    }
    await new Promise((done) => setTimeout(done, 300)); // layout and paint at the final size
    const shot = (await withTimeout(
      debug.sendCommand('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: options.width, height, scale: 1 } }),
      CAPTURE_TIMEOUT_MS,
      `the capture of ${options.target} did not finish within ${CAPTURE_TIMEOUT_MS / 1000} s`,
    )) as { data: string };
    await mkdir(dirname(options.out), { recursive: true });
    await writeFile(options.out, Buffer.from(shot.data, 'base64'));
    return { file: options.out, width: options.width, height };
  } finally {
    win.destroy();
  }
}

function fileUrl(target: string): string {
  const path = resolve(target);
  if (!existsSync(path)) throw new CaptureError('usage', `${path} does not exist (give a file or an http(s) URL)`);
  return pathToFileURL(path).href;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new CaptureError('invalid-media', message)), ms)));
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
