import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserWindow, session, type Session } from 'electron';

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
/** Everything after loading, beyond the wait, must be done within this. */
const CAPTURE_TIMEOUT_MS = 20_000;
/** An in-memory session: no cookies or storage outlive the capture. */
const PARTITION = 'cuttle-capture';

export class CaptureError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CaptureError';
  }
}

let captureSession: Session | undefined;

/** The capture's session: every permission (camera, microphone, location, notifications …) and every download is refused. */
function lockedSession(): Session {
  if (captureSession) return captureSession;
  captureSession = session.fromPartition(PARTITION);
  captureSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  captureSession.setPermissionCheckHandler(() => false);
  captureSession.on('will-download', (event) => event.preventDefault());
  return captureSession;
}

/**
 * A page as a PNG. The window renders offscreen: a hidden on-screen window paints a still page only
 * once, and a screenshot then waits for a frame that never comes. The size comes from a
 * device-metrics override at scale 1 and a clip, not from the window, whose pixels depend on the
 * display's scale. A whole page is captured beyond the viewport, which keeps its height, so sections
 * sized in `vh` keep their size. `signal` cancels.
 */
export async function capturePage(options: CaptureOptions, signal: AbortSignal): Promise<CaptureResult> {
  const url = /^https?:\/\//i.test(options.target) ? options.target : fileUrl(options.target);
  const win = new BrowserWindow({
    show: false,
    width: options.width,
    height: options.height,
    useContentSize: true,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, session: lockedSession() },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  try {
    await guard(win.loadURL(url), signal, LOAD_TIMEOUT_MS, `${options.target} did not load within ${LOAD_TIMEOUT_MS / 1000} s`).catch((error: Error) => {
      throw error instanceof CaptureError ? error : new CaptureError('invalid-media', `cannot load ${options.target}: ${error.message}`);
    });
    const deadline = options.waitMs + CAPTURE_TIMEOUT_MS;
    const shot = await guard(screenshot(win, options), signal, deadline, `the capture of ${options.target} did not finish within ${deadline / 1000} s`);
    await mkdir(dirname(options.out), { recursive: true });
    await writeFile(options.out, shot.png);
    return { file: options.out, width: options.width, height: shot.height };
  } finally {
    win.destroy();
  }
}

/** Waits for the page, then takes the screenshot through the DevTools protocol. */
async function screenshot(win: BrowserWindow, options: CaptureOptions): Promise<{ png: Buffer; height: number }> {
  await new Promise((done) => setTimeout(done, options.waitMs));
  const debug = win.webContents.debugger;
  debug.attach('1.3');
  await debug.sendCommand('Emulation.setDeviceMetricsOverride', { width: options.width, height: options.height, deviceScaleFactor: 1, mobile: false });
  let height = options.height;
  if (options.fullPage) {
    const metrics = (await debug.sendCommand('Page.getLayoutMetrics')) as { cssContentSize?: { height?: number } };
    const content = Math.ceil(Number(metrics.cssContentSize?.height));
    height = Math.min(MAX_PAGE_HEIGHT, Math.max(options.height, Number.isFinite(content) ? content : options.height));
  }
  await new Promise((done) => setTimeout(done, 300)); // layout and paint at the final size
  const shot = (await debug.sendCommand('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: options.fullPage,
    clip: { x: 0, y: 0, width: options.width, height, scale: 1 },
  })) as { data: string };
  return { png: Buffer.from(shot.data, 'base64'), height };
}

function fileUrl(target: string): string {
  const path = resolve(target);
  if (!existsSync(path)) throw new CaptureError('usage', `${path} does not exist (give a file or an http(s) URL)`);
  return pathToFileURL(path).href;
}

/** `promise`, unless `signal` aborts first (code `cancelled`) or `ms` pass (code `invalid-media`). */
function guard<T>(promise: Promise<T>, signal: AbortSignal, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  let onAbort = (): void => {};
  const stop = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CaptureError('invalid-media', message)), ms);
    onAbort = () => reject(new CaptureError('cancelled', 'the capture was cancelled'));
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  return Promise.race([promise, stop]).finally(() => {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  });
}
