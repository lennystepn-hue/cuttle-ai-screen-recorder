// A video's sound, rendered by a page: the music page Claude wrote (or the kit's blank page, for the
// project's sounds alone) in a hidden offscreen window, sandboxed like a motion page (the project's
// files and the kit, no network). The page renders the whole video's length in an
// OfflineAudioContext (`musicRuntime`), and its two stems, music and effects, are read out as
// interleaved stereo float32.
import { KIT_ORIGIN } from '@cuttle/motion-kit';
import { BrowserWindow, screen } from 'electron';
import { musicRuntime, type MusicInit, type MusicRenderResult } from '../music/runtime';
import { MAX_LOG_LINES, defaultKitDir, giveBack, pageUrl, takeSession, type MotionReport } from './motion';

/** Longest wait for the page to load (its samples, `cuttle.ready`), in ms. */
export const MUSIC_LOAD_TIMEOUT_MS = 30_000;
/** Longest render: this much, plus two seconds for each second of video (ms). */
const RENDER_BASE_MS = 30_000;
/** Frames read out at a time: ten seconds. */
const CHUNK_SECONDS = 10;
/** The kit's page for a video with sounds and no music page. */
export const BLANK_MUSIC_PAGE = `${KIT_ORIGIN}/blank.html`;

export interface MusicPageOptions {
  /** The music page (an HTML file inside `root`); without one, the kit's blank page (the sounds alone). */
  file?: string;
  /** The project's folder: the only files the page reaches. */
  root: string;
  init: Omit<MusicInit, 'kit'>;
  network?: boolean;
  kitDir?: string;
  loadTimeout?: number;
  renderTimeout?: number;
}

/** A rendered soundtrack: each stem interleaved stereo (L, R, L, R…) at `rate`. */
export interface MusicStems {
  rate: number;
  music: Float32Array;
  effects: Float32Array;
  result: MusicRenderResult;
  report: MotionReport;
}

export class MusicPage {
  private readonly logs: string[] = [];
  private failure: string | undefined;

  private constructor(
    private readonly win: BrowserWindow,
    private readonly options: MusicPageOptions,
    private readonly release: () => void,
  ) {
    const contents = win.webContents;
    contents.on('console-message', ({ level, message, lineNumber, sourceId }) => {
      if (this.logs.length >= MAX_LOG_LINES || message.startsWith('%cElectron Security Warning')) return;
      const where = sourceId ? ` (${sourceId.replace(/^.*\//, '')}:${lineNumber})` : '';
      this.logs.push(`${level}: ${message}${where}`);
    });
    contents.on('render-process-gone', (_event, details) => {
      this.failure = `the music page's renderer stopped (${details.reason})`;
    });
  }

  static async open(options: MusicPageOptions): Promise<MusicPage> {
    const kitDir = options.kitDir ?? defaultKitDir();
    const network = options.network === true;
    const ses = takeSession(options.root, network, kitDir);
    const origin = screen.getPrimaryDisplay().workArea;
    const win = new BrowserWindow({
      show: false,
      x: origin.x,
      y: origin.y,
      width: 64,
      height: 64,
      frame: false,
      webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false, session: ses },
    });
    const contents = win.webContents;
    contents.setAudioMuted(true);
    contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event) => event.preventDefault());
    const page = new MusicPage(win, options, () => giveBack(ses, options.root, network, kitDir));
    const loadTimeout = options.loadTimeout ?? MUSIC_LOAD_TIMEOUT_MS;
    const init: MusicInit = { ...options.init, kit: `${KIT_ORIGIN}/sound.js` };
    try {
      await win.loadURL('about:blank');
      const cdp = contents.debugger;
      cdp.attach('1.3');
      await cdp.sendCommand('Page.enable');
      await cdp.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `(${musicRuntime.toString()})(${JSON.stringify(init)});` });
      const url = options.file ? pageUrl(options.root, options.file) : BLANK_MUSIC_PAGE;
      await page.timed(win.loadURL(url), loadTimeout, 'to load');
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
      timer = setTimeout(() => reject(new Error(`the music page took more than ${Math.round(ms / 1000)} s ${what}`)), ms);
    });
    return Promise.race([promise, late]).finally(() => clearTimeout(timer));
  }

  /** Composes and renders the whole video's sound. */
  async render(): Promise<MusicRenderResult> {
    if (this.failure) throw new Error(this.failure);
    const ms = this.options.renderTimeout ?? RENDER_BASE_MS + this.options.init.duration * 2000;
    return this.timed(this.win.webContents.executeJavaScript('window.__cuttleCompose()') as Promise<MusicRenderResult>, ms, 'to render');
  }

  /** A stem, interleaved stereo float32, read in chunks. */
  async stem(which: 'music' | 'effects', length: number): Promise<Float32Array> {
    const out = new Float32Array(length * 2);
    const chunk = this.options.init.rate * CHUNK_SECONDS;
    for (let from = 0; from < length; from += chunk) {
      const text = (await this.win.webContents.executeJavaScript(`window.__cuttleStem(${JSON.stringify(which)}, ${from}, ${from + chunk})`)) as string;
      const bytes = Buffer.from(text, 'base64');
      out.set(new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4), from * 2);
    }
    return out;
  }

  /** What went wrong in the page (uncaught errors and rejections), and its console. */
  async report(): Promise<MotionReport> {
    const errors = this.win.isDestroyed() ? [] : ((await this.win.webContents.executeJavaScript('window.__cuttleErrors ?? []').catch(() => [])) as string[]);
    return { errors: [...(this.failure ? [this.failure] : []), ...errors], console: [...this.logs] };
  }

  close(): void {
    if (this.win.isDestroyed()) return;
    this.win.destroy();
    this.release();
  }
}

/** Opens the page, renders, reads both stems out, and closes it. */
export async function renderMusic(options: MusicPageOptions): Promise<MusicStems> {
  const page = await MusicPage.open(options);
  try {
    const result = await page.render();
    const music = await page.stem('music', result.length);
    const effects = await page.stem('effects', result.length);
    const report = await page.report();
    return { rate: options.init.rate, music, effects, result, report };
  } catch (error) {
    const report = await page.report().catch(() => undefined);
    const errors = report?.errors.length ? `\n${report.errors.join('\n')}` : '';
    throw new Error(`${(error as Error).message}${errors}`, { cause: error });
  } finally {
    page.close();
  }
}


