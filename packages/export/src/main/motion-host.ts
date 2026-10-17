import { relative, sep } from 'node:path';
import type { CuttleProject, MotionOverlay, MotionScene } from '@cuttle/project';
import { CHANNELS, type MotionFrameRequest, type MotionPages } from '../job';
import { motionInit } from '../motion/init';
import { MotionPage, type MotionFrame, type MotionPageOptions } from './motion';

/** What one motion item's page said while it rendered: its errors and its console, every showing together. */
export interface MotionItemReport {
  /** `scenes[2]` or `overlays[0]`. */
  item: string;
  /** The page, relative to the project folder (`/` between folders). */
  src: string;
  errors: string[];
  console: string[];
}

interface Showing {
  page: Promise<MotionPage>;
  /** The page's work, one call at a time. */
  queue: Promise<unknown>;
  /** The frame asked for last, and the next one drawn ahead of time. */
  asked: number;
  ahead?: { frame: number; promise: Promise<MotionFrame> };
  /** The frame handed out last (the same frame again needs no drawing). */
  last?: { frame: number; data: MotionFrame };
  name: string;
  duration: number;
}

/**
 * The main process's side of a job's motion: opens a page for each showing of an item the export
 * page asks for, draws its frames in order (drawing the next one ahead while the export works on
 * the current one), opens it again for a frame before one it drew, and closes it when the showing
 * is over. Collects what the pages said.
 */
export class MotionHost {
  private readonly showings = new Map<string, Showing>();
  private readonly reports = new Map<string, MotionItemReport>();

  constructor(
    private readonly project: CuttleProject,
    private readonly pages: MotionPages,
    private readonly options: Pick<MotionPageOptions, 'frameTimeout' | 'loadTimeout'> = {},
  ) {}

  private item(request: MotionFrameRequest): { item: MotionScene | MotionOverlay; name: string; file: string } {
    const name = `${request.kind === 'scene' ? 'scenes' : 'overlays'}[${request.index}]`;
    const item = request.kind === 'scene' ? this.project.scenes[request.index] : this.project.overlays[request.index];
    const file = (request.kind === 'scene' ? this.pages.scenes : this.pages.overlays)[request.index];
    if (!item || ('type' in item && item.type !== 'motion') || file === undefined) throw new Error(`${name} is not a motion item`);
    return { item: item as MotionScene | MotionOverlay, name, file };
  }

  private open(request: MotionFrameRequest): Showing {
    const { item, name, file } = this.item(request);
    const report = this.reports.get(name) ?? { item: name, src: relative(this.pages.root, file).split(sep).join('/'), errors: [], console: [] };
    this.reports.set(name, report);
    const page = MotionPage.open({
      file,
      root: this.pages.root,
      init: motionInit(this.project, item, name, request.duration),
      network: item.network,
      ...this.options,
    });
    page.catch(() => {}); // awaited by the frame that asked for it
    const showing: Showing = { page, queue: page, asked: -1, name, duration: request.duration };
    this.showings.set(request.key, showing);
    return showing;
  }

  /** `job` on the showing's page, after the work it already has. */
  private run<T>(showing: Showing, job: (page: MotionPage) => Promise<T>): Promise<T> {
    const result = showing.queue.catch(() => {}).then(() => showing.page).then(job);
    showing.queue = result.catch(() => {});
    return result;
  }

  /** The frame the request asks for, drawn by its showing's page. */
  async frame(request: MotionFrameRequest): Promise<MotionFrame> {
    let showing = this.showings.get(request.key);
    if (showing?.last?.frame === request.frame) return showing.last.data;
    if (showing && request.frame < Math.max(showing.asked, showing.ahead?.frame ?? -1)) {
      // an earlier frame than the page drew: it starts again
      await this.done(request.key);
      showing = undefined;
    }
    showing ??= this.open(request);
    try {
      const ahead = showing.ahead?.frame === request.frame ? showing.ahead.promise : undefined;
      showing.ahead = undefined;
      const sequential = request.frame === showing.asked + 1;
      showing.asked = request.frame;
      const frame = await (ahead ?? this.run(showing, (page) => page.frame(request.frame)));
      showing.last = { frame: request.frame, data: frame };
      // playing on: the next frame is drawn while the export uses this one
      const next = request.frame + 1;
      if (sequential && next / this.project.output.fps < showing.duration) {
        const promise = this.run(showing, (page) => page.frame(next));
        promise.catch(() => {}); // a failure shows when that frame is asked for
        showing.ahead = { frame: next, promise };
      }
      return frame;
    } catch (error) {
      throw new Error(`${showing.name} (${this.reports.get(showing.name)?.src}): ${(error as Error).message}`, { cause: error });
    }
  }

  /** The showing is over: its page closes, and what it said is kept. */
  async done(key: string): Promise<void> {
    const showing = this.showings.get(key);
    if (!showing) return;
    this.showings.delete(key);
    const page = await showing.queue.then(() => showing.page).catch(() => undefined);
    if (!page) return;
    const said = await page.report().catch(() => undefined);
    page.close();
    const report = this.reports.get(showing.name);
    if (!said || !report) return;
    for (const error of said.errors) if (!report.errors.includes(error)) report.errors.push(error);
    for (const line of said.console) if (!report.console.includes(line)) report.console.push(line);
  }

  /** Closes every page; what each item's page said, in the order they first showed. */
  async close(): Promise<MotionItemReport[]> {
    await Promise.all([...this.showings.keys()].map((key) => this.done(key)));
    return [...this.reports.values()];
  }
}

/** Answers the export page's motion requests (on its window's `ipc`) with `host`; `alive` keeps the watchdog quiet while pages work. */
export function serveMotion(ipc: Electron.IpcMain, host: MotionHost | undefined, alive: () => void): void {
  ipc.handle(CHANNELS.motionFrame, async (_event, request: MotionFrameRequest) => {
    if (!host) throw new Error('the job has no motion items');
    alive();
    const frame = await host.frame(request);
    alive();
    return frame;
  });
  ipc.on(CHANNELS.motionDone, (_event, key: string) => void host?.done(key));
}

/** One line for each error a page reported (`scenes[2] (motion/intro/index.html): TypeError: …`). */
export function motionWarnings(reports: readonly MotionItemReport[]): string[] {
  return reports.flatMap((report) => report.errors.map((error) => `${report.item} (${report.src}): ${error}`));
}
