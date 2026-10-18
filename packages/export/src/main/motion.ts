// A motion item's page, rendered frame by frame (see docs/superpowers/spikes/2026-10-17-p5-virtual-clock.md):
// a hidden offscreen window, sandboxed, that reaches only the project's files (`cuttle-motion:`)
// and no network; the page's clock is virtual (`motionRuntime`, injected before its scripts), and
// each frame is the paint whose marker pixel names it. Frames come out as premultiplied RGBA, the
// page's transparency kept, the same on every render. The motion kit (Three.js, lottie-web, fonts,
// Cuttle's helpers) is served at cuttle-motion://kit/, and every page of the project gets an
// import map for its bare names (`three`, `cuttle`).
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { KIT_FOLDER, withImportMap } from '@cuttle/motion-kit';
import { BrowserWindow, screen, session, type NativeImage, type Session } from 'electron';
import { motionRuntime, type MotionInit, type MotionView, type PageSound } from '../motion/runtime';

export const MOTION_SCHEME = 'cuttle-motion';

/** The scheme's privileges, for the one `protocol.registerSchemesAsPrivileged` call each app makes before it is ready. */
export const MOTION_SCHEME_PRIVILEGES: Electron.CustomScheme = {
  scheme: MOTION_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
};

/** Longest wait for one frame, and for the page to load (its fonts, images and `cuttle.ready`), in ms. */
export const FRAME_TIMEOUT_MS = 5_000;
export const LOAD_TIMEOUT_MS = 30_000;
/** A frame whose paint has not come in this long is drawn again (ms). */
const REDRAW_MS = 400;
/** At most this many console lines are kept per page. */
export const MAX_LOG_LINES = 200;

/** A page's frame: premultiplied RGBA, top row first. */
export interface MotionFrame {
  width: number;
  height: number;
  data: Uint8Array;
}

/** What went wrong in a page, and what it logged. */
export interface MotionReport {
  errors: string[];
  console: string[];
}

export interface MotionPageOptions {
  /** The page (an HTML file inside `root`). */
  file: string;
  /** The project's folder: the only files the page reaches. */
  root: string;
  init: MotionInit;
  /** Let the page reach https: (off unless the item allows it). */
  network?: boolean;
  frameTimeout?: number;
  loadTimeout?: number;
  /** The motion kit's folder (default: next to this bundle). */
  kitDir?: string;
  /** Motion blur: each frame the average of `samples` moments over `shutter` of a frame, centred on it. */
  motionBlur?: { samples: number; shutter: number };
  /** The size frames come out at (the editor's preview): the page is laid out and drawn at its own size, then scaled. */
  frameSize?: { width: number; height: number };
}

/** The motion kit next to the bundle that contains this code (each build copies it there). */
export function defaultKitDir(): string {
  return fileURLToPath(new URL(`./${KIT_FOLDER}/`, import.meta.url));
}

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain',
};

/** The page's rules: its own files, data and blob URLs, inline code; https only when the item allows it. */
function contentPolicy(network: boolean): string {
  const own = `${MOTION_SCHEME}: data: blob:${network ? ' https:' : ''}`;
  return [
    `default-src ${own} 'unsafe-inline' 'unsafe-eval'`,
    `connect-src ${own}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/** Whether `path` lies inside `base` (both absolute). */
function inside(base: string, path: string): boolean {
  const rel = relative(base, path);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** The frames a transition page is drawing from, by `<page id>/from` and `/to`: served at cuttle-motion://frames/. */
const handed = new Map<string, MotionFrame>();

let sessions = 0;
/**
 * Sessions no page uses, by project folder, network switch and kit. Electron keeps every session for the
 * app's life, so the app's many exports take them from here, emptied, instead of making new ones.
 */
const idle = new Map<string, Session[]>();
const poolKey = (root: string, network: boolean, kitDir: string) => `${resolve(root)}|${network}|${resolve(kitDir)}`;

/** A session of its own for one page: its files from `root` and the kit's, no permissions, no network unless asked. */
export function takeSession(root: string, network: boolean, kitDir: string): Session {
  return idle.get(poolKey(root, network, kitDir))?.pop() ?? pageSession(root, network, kitDir);
}

/** A page is done with `ses`: what the page stored is wiped, and the next page may take it. */
export function giveBack(ses: Session, root: string, network: boolean, kitDir: string): void {
  void ses
    .clearStorageData()
    .catch(() => {})
    .then(() => {
      const key = poolKey(root, network, kitDir);
      idle.set(key, [...(idle.get(key) ?? []), ses]);
    });
}

function pageSession(root: string, network: boolean, kitDir: string): Session {
  const ses = session.fromPartition(`cuttle-motion-${process.pid}-${++sessions}`, { cache: false });
  const bases: Record<string, string> = { project: resolve(root), kit: resolve(kitDir) };
  const policy = contentPolicy(network);
  ses.protocol.handle(MOTION_SCHEME, async (request) => {
    const url = new URL(request.url);
    // a transition's two frames, as raw RGBA at the page's size
    if (url.host === 'frames') {
      const frame = handed.get(decodeURIComponent(url.pathname).replace(/^\/+/, ''));
      if (!frame) return new Response('not found', { status: 404 });
      return new Response(frame.data as Uint8Array<ArrayBuffer>, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Security-Policy': policy, 'Cache-Control': 'no-store' } });
    }
    const base = bases[url.host];
    const path = base === undefined ? undefined : resolve(base, decodeURIComponent(url.pathname).replace(/^\/+/, ''));
    if (base === undefined || path === undefined || !inside(base, path)) return new Response('not found', { status: 404 });
    try {
      const type = TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
      const headers = { 'Content-Type': type, 'Content-Security-Policy': policy, 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' };
      // a part of a file (the take's frames, a video the page plays): streamed from where it is asked
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get('range') ?? '');
      if (range) {
        const size = (await stat(path)).size;
        const start = Number(range[1]);
        const end = Math.min(range[2] ? Number(range[2]) : size - 1, size - 1);
        if (start > end) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
        const part = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream<Uint8Array>;
        return new Response(part, { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) } });
      }
      const bytes = await readFile(path);
      // the project's pages get the kit's import map; the kit's files are served as they are
      const body = url.host === 'project' && type === 'text/html' ? withImportMap(bytes.toString('utf8')) : bytes;
      return new Response(body, { headers });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on('will-download', (event) => event.preventDefault());
  // the page's own files, data and blob URLs; the network only when the item allows it
  ses.webRequest.onBeforeRequest((details, callback) => {
    const scheme = details.url.slice(0, details.url.indexOf(':'));
    const allowed = scheme === MOTION_SCHEME || scheme === 'data' || scheme === 'blob' || scheme === 'devtools' || (network && scheme === 'https');
    callback({ cancel: !allowed });
  });
  return ses;
}

/** The page's URL in its session. */
export const pageUrl = (root: string, file: string): string =>
  `${MOTION_SCHEME}://project/${relative(resolve(root), resolve(file)).split(sep).map(encodeURIComponent).join('/')}`;

/** BGRA (Chromium's bitmap) to RGBA in place (`data` owns its buffer); both premultiplied. */
function toRgba(data: Uint8Array): Uint8Array {
  const pixels = new Uint32Array(data.buffer, data.byteOffset, data.byteLength / 4);
  for (let i = 0; i < pixels.length; i++) {
    const p = pixels[i]!;
    pixels[i] = (p & 0xff00ff00) | ((p & 0xff) << 16) | ((p >>> 16) & 0xff);
  }
  return data;
}

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** One motion item's page, open. `frame(n)` draws its frame `n` (n / fps seconds into it); frames only go forward. */
export class MotionPage {
  /** The frame drawn last; -1 before the first. */
  private drawn = -1;
  private last: MotionFrame | undefined;
  private latest: NativeImage | undefined;
  private waiting: (() => void) | undefined;
  private readonly logs: string[] = [];
  /** Names this page's handed frames. */
  private readonly id = randomUUID();
  /** Paints so far, and how many of them were empty (to say why a frame never showed). */
  private paints = 0;
  private emptyPaints = 0;
  private failure: string | undefined;

  private constructor(
    private readonly win: BrowserWindow,
    private readonly options: MotionPageOptions,
    private readonly ses: Session,
  ) {
    const contents = win.webContents;
    contents.on('paint', (_event, _dirty, image) => {
      this.paints++;
      // an invalidate answers at once with an empty paint; the frame comes after it
      if (image.isEmpty()) {
        this.emptyPaints++;
        return;
      }
      this.latest = image;
      this.waiting?.();
    });
    contents.on('console-message', ({ level, message, lineNumber, sourceId }) => {
      // Electron's own advice to apps that are not packaged yet, not the page's
      if (this.logs.length >= MAX_LOG_LINES || message.startsWith('%cElectron Security Warning')) return;
      const where = sourceId ? ` (${sourceId.replace(/^.*\//, '')}:${lineNumber})` : '';
      this.logs.push(`${level}: ${message}${where}`);
    });
    contents.on('render-process-gone', (_event, details) => {
      this.failure = `the motion page's renderer stopped (${details.reason})`;
      this.waiting?.();
    });
  }

  private static kitOf(options: MotionPageOptions): string {
    return options.kitDir ?? defaultKitDir();
  }

  static async open(options: MotionPageOptions): Promise<MotionPage> {
    const { width, height } = options.init;
    const ses = takeSession(options.root, options.network === true, MotionPage.kitOf(options));
    // On the primary display: Windows puts a new window on the display of the window in front, and a
    // display of another scale sizes it a pixel or two off (seen with three displays of three scales).
    const origin = screen.getPrimaryDisplay().workArea;
    const win = new BrowserWindow({
      show: false,
      x: origin.x,
      y: origin.y,
      // a few rows more than the page: the frame marker sits below it (Electron rounds small heights up)
      width,
      height: height + 4,
      transparent: true,
      frame: false,
      backgroundColor: '#00000000',
      useContentSize: true,
      enableLargerThanScreen: true,
      webPreferences: {
        offscreen: true,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        spellcheck: false,
        session: ses,
      },
    });
    // A new window is kept inside the screen's work area (a 9:16 page is taller than most screens);
    // a resize afterwards is not, and the paint follows the window.
    win.setContentSize(width, height + 4);
    // and kept at that size should anything resize it
    let corrections = 0;
    win.on('resize', () => {
      const [w, h] = win.getContentSize();
      if ((w !== width || h !== height + 4) && corrections++ < 3) win.setContentSize(width, height + 4);
    });
    const contents = win.webContents;
    contents.setFrameRate(240);
    contents.setAudioMuted(true);
    // WebRTC could reach out without a request the session sees
    contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event) => event.preventDefault());
    const page = new MotionPage(win, options, ses);
    const loadTimeout = options.loadTimeout ?? LOAD_TIMEOUT_MS;
    try {
      // CDP answers only once the window has loaded something
      await win.loadURL('about:blank');
      const cdp = contents.debugger;
      cdp.attach('1.3');
      await cdp.sendCommand('Page.enable');
      // one CSS pixel is one pixel of the frame, whatever the display's scale
      await cdp.sendCommand('Emulation.setDeviceMetricsOverride', { width, height: height + 4, deviceScaleFactor: 1, mobile: false });
      await cdp.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `(${motionRuntime.toString()})(${JSON.stringify(options.init)});` });
      await page.timed(win.loadURL(pageUrl(options.root, options.file)), loadTimeout, 'to load');
      await page.timed(contents.executeJavaScript('window.__cuttleReady()'), loadTimeout, 'to get ready');
    } catch (error) {
      const report = await page.report().catch(() => undefined);
      page.close();
      const errors = report?.errors.length ? `\n${report.errors.join('\n')}` : '';
      throw new Error(`${(error as Error).message}${errors}`, { cause: error });
    }
    return page;
  }

  private timed<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`the motion page took more than ${ms / 1000} s ${what}`)), ms);
    });
    return Promise.race([promise, late]).finally(() => clearTimeout(timer));
  }

  /** The frame drawn last (-1 before the first). */
  get position(): number {
    return this.drawn;
  }

  /** Whether the latest paint shows draw `draw`: its marker pixel (BGRA), `scale` image pixels a CSS pixel. */
  private shows(draw: number): boolean {
    const marker = this.marker();
    return marker !== undefined && marker[2] === (draw & 255) && marker[1] === ((draw >> 8) & 255) && marker[0] === 200;
  }

  /** The latest paint's marker pixel (BGRA), or undefined when it has none where the marker goes. */
  private marker(): Uint8Array | undefined {
    const image = this.latest;
    if (!image) return undefined;
    const { width, height } = image.getSize();
    const scale = width / this.options.init.width;
    const row = Math.floor((this.options.init.height + 1) * scale);
    if (row >= height || width < 2) return undefined;
    const at = (row * width + Math.floor(scale)) * 4;
    return image.toBitmap().subarray(at, at + 4);
  }

  /** What the page painted, for an error: how often since `since`, and what its last paint shows. */
  private paintReport(since: { paints: number; empty: number }): string {
    const paints = this.paints - since.paints;
    const empty = this.emptyPaints - since.empty;
    const image = this.latest;
    const last = image ? `the last ${image.getSize().width}×${image.getSize().height}` : 'none before';
    const marker = this.marker();
    const shows = marker ? `, its marker ${marker[2]! + 256 * marker[1]!} (blue ${marker[0]})` : image ? ', without the marker' : '';
    const [cw, ch] = this.win.getContentSize();
    return `${paints} paint${paints === 1 ? '' : 's'} since the draw, ${empty} empty; ${last}${shows}; the window ${cw}×${ch}`;
  }

  /**
   * Frame `n` of the page: its clock moves to n / fps seconds (`view`: an overlay's view of the take),
   * and the paint that shows it comes back; with motion blur, the average of the paints while the
   * shutter is open around it.
   */
  async frame(n: number, view?: MotionView, between?: { from: MotionFrame; to: MotionFrame }): Promise<MotionFrame> {
    if (!Number.isInteger(n) || n < 0) throw new Error(`a motion frame is a whole number from 0, not ${n}`);
    if (n < this.drawn) throw new Error(`the motion page is past frame ${n} (it drew ${this.drawn}); open it again to go back`);
    if (n === this.drawn && this.last) return this.last;
    if (this.failure) throw new Error(this.failure);
    const { fps } = this.options.init;
    const blur = this.options.motionBlur;
    // a transition's two frames: the page fetches them before it draws
    if (between) {
      handed.set(`${this.id}/from`, between.from);
      handed.set(`${this.id}/to`, between.to);
    }
    let frame: MotionFrame;
    if (!blur) frame = await this.paint((n * 1000) / fps, view, n, between !== undefined);
    else {
      // the moments centred on the frame (never before 0): a frame's last comes before the next frame's first
      const moments = Array.from({ length: blur.samples }, (_, k) => Math.max(0, ((n + ((k + 0.5) / blur.samples - 0.5) * blur.shutter) * 1000) / fps));
      const { width, height } = this.size;
      const sum = new Uint32Array(width * height * 4);
      for (const ms of moments) {
        const { data } = await this.paint(ms, view, n);
        for (let i = 0; i < data.length; i++) sum[i] = sum[i]! + data[i]!;
      }
      const data = new Uint8Array(sum.length);
      for (let i = 0; i < sum.length; i++) data[i] = Math.round(sum[i]! / moments.length);
      frame = { width, height, data };
    }
    this.drawn = n;
    this.last = frame;
    return frame;
  }

  /** The page drawn at `ms` on its clock, from the paint whose marker shows that draw. */
  private async paint(at: number, view: MotionView | undefined, n: number, between = false): Promise<MotionFrame> {
    const { init } = this.options;
    const ms = this.options.frameTimeout ?? FRAME_TIMEOUT_MS;
    const frames = between ? { from: `${MOTION_SCHEME}://frames/${this.id}/from`, to: `${MOTION_SCHEME}://frames/${this.id}/to` } : undefined;
    const script = `window.__cuttleDraw(${at}${view || frames ? `, ${JSON.stringify(view ?? null)}` : ''}${frames ? `, ${JSON.stringify(frames)}` : ''})`;
    const drawn = () => this.timed(this.win.webContents.executeJavaScript(script) as Promise<number>, ms, `to draw frame ${n}`);
    let draw = await drawn();
    const deadline = Date.now() + ms;
    const since = { paints: this.paints, empty: this.emptyPaints };
    let asked = false;
    let redrawAt = Date.now() + REDRAW_MS;
    while (!this.shows(draw)) {
      if (this.failure) throw new Error(this.failure);
      if (Date.now() > deadline) throw new Error(`the motion page's frame ${n} was never painted (draw ${draw}: ${this.paintReport(since)})`);
      // Now and then a draw never reaches the paints: they go on showing the page as it was, and
      // asking for a paint repaints that. The same moment drawn again (a new marker) gets through.
      // A page drawn from its time looks the same; one counting its frames sees one more.
      if (Date.now() > redrawAt) {
        draw = await drawn();
        redrawAt = Date.now() + REDRAW_MS;
        asked = false;
        continue;
      }
      const painted = new Promise<void>((done) => (this.waiting = done));
      if (!asked) this.win.webContents.invalidate();
      asked = true;
      await Promise.race([painted, pause(50)]);
      this.waiting = undefined;
    }
    const { width } = this.latest!.getSize();
    const size = this.size;
    // the page without the marker rows below it, at a display scale the override did not reach too
    let image = this.latest!.crop({ x: 0, y: 0, width, height: Math.round((init.height * width) / init.width) });
    // brought to its size (drawn larger), or to a preview's
    if (width !== size.width) image = image.resize({ width: size.width, height: size.height, quality: this.options.frameSize ? 'good' : 'best' });
    return { width: size.width, height: size.height, data: toRgba(new Uint8Array(image.toBitmap())) };
  }

  /** The size frames come out at. */
  private get size(): { width: number; height: number } {
    return this.options.frameSize ?? { width: this.options.init.width, height: this.options.init.height };
  }

  /** The sounds the page asked for so far (`cuttle.sound`). */
  async sounds(): Promise<PageSound[]> {
    if (this.win.isDestroyed()) return [];
    return ((await this.win.webContents.executeJavaScript('window.__cuttleSounds ?? []').catch(() => [])) as PageSound[]).filter(
      (sound) => typeof sound?.sound === 'string' && typeof sound.volume === 'number' && (typeof sound.at === 'number' || typeof sound.video === 'number'),
    );
  }

  /** What went wrong in the page so far (uncaught errors and rejections), and its console. */
  async report(): Promise<MotionReport> {
    const errors = this.win.isDestroyed() ? [] : ((await this.win.webContents.executeJavaScript('window.__cuttleErrors ?? []').catch(() => [])) as string[]);
    return { errors: [...(this.failure ? [this.failure] : []), ...errors], console: [...this.logs] };
  }

  close(): void {
    handed.delete(`${this.id}/from`);
    handed.delete(`${this.id}/to`);
    if (this.win.isDestroyed()) return;
    this.win.destroy();
    giveBack(this.ses, this.options.root, this.options.network === true, MotionPage.kitOf(this.options));
  }
}
