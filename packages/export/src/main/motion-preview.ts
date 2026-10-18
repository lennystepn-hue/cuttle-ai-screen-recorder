// The editor's motion: frames of the motion scenes and overlays of the project as the editor shows
// it, drawn by the same pages as the export (`MotionPage`, the same init and the same view of the
// take), scaled to the preview's size. A page stays open while the editor shows its item, and the
// item being scrubbed gets a spare page loaded beside it, so going back (a page only goes forward)
// does not wait for a load. Frames are kept, the least recently used dropped first. A change to the
// project's files reloads the pages: Claude edits a page, the editor shows it.
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { KIT_FONTS } from '@cuttle/motion-kit';
import { parseProject, type CuttleProject, type MotionOverlay, type MotionScene } from '@cuttle/project';
import { sceneSpans } from '@cuttle/timeline';
import type { MotionFrameRequest, MotionPixels } from '../job';
import { motionInit } from '../motion/init';
import { declaredParams, paramDefaults, type ParamDeclaration } from '../motion/params';
import type { TakeData } from '../motion/runtime';
import { takeData, type TakeInputs } from '../motion/take';
import { MotionPage, type MotionPageOptions } from './motion';
import { motionTake } from './sources';

/** What an item's page is doing in the preview, and what it said. */
export interface MotionStatus {
  /** `scenes[2]` or `overlays[0]`. */
  item: string;
  /** The page, as the item names it. */
  src: string;
  /** `loading` while its page opens, `ready` once it drew, `failed` when it could not load or draw. */
  state: 'loading' | 'ready' | 'failed';
  /** Why it failed, said for people. */
  failure?: string;
  /** What the page threw, and its console (the newest page's). */
  errors: string[];
  console: string[];
}

export interface MotionPreviewOptions extends Pick<MotionPageOptions, 'kitDir' | 'frameTimeout' | 'loadTimeout'> {
  /** Items shown at once whose pages stay open (the least recently shown closes first). */
  maxShowings?: number;
  /** Bytes of frames kept. */
  cacheBytes?: number;
  /** A showing nobody asked for in this long closes (ms). */
  idleMs?: number;
  /** The statuses changed. */
  onStatus?: (statuses: MotionStatus[]) => void;
}

/** How a frame is asked for: `seek` while paused (the item gets a spare page for going back), `play` while playing. */
export type PreviewMode = 'seek' | 'play';

const DEFAULT_MAX_SHOWINGS = 3;
const DEFAULT_CACHE_BYTES = 192 * 1024 * 1024;
const DEFAULT_IDLE_MS = 60_000;
/** A spare page not needed for this long closes: scrubbing is over (ms). */
const SPARE_IDLE_MS = 15_000;
/** The preview waits less for a page than the export: a page that hangs shows as failed sooner. */
const PREVIEW_LOAD_TIMEOUT_MS = 15_000;
/** An item edited again within this long opens no page for the edit before (ms). */
const SETTLE_MS = 150;

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

interface Waiting {
  request: MotionFrameRequest;
  mode: PreviewMode;
  cacheKey: string;
  resolve: (frame: MotionPixels | null) => void;
  reject: (error: Error) => void;
}

interface Showing {
  key: string;
  identity: string;
  item: string;
  file: string;
  options: MotionPageOptions;
  page?: Promise<MotionPage>;
  /** A second page loaded beside it, for a frame before the page's. */
  spare?: Promise<MotionPage>;
  busy: boolean;
  /** The frame being drawn: the pages close after it. */
  drawing?: Promise<unknown>;
  waiting?: Waiting;
  used: number;
  /** Why its page could not load or draw: asked again, it fails the same until the files change. */
  failure?: string;
  /** A report is due (after a frame). */
  reportTimer?: ReturnType<typeof setTimeout>;
}

/** A version of the project, read once a frame of it is asked for. */
interface Version {
  number: number;
  raw: Record<string, unknown>;
  project?: CuttleProject;
}

/** Frames by key, the least recently used dropped once they pass a size. */
class FrameCache {
  private readonly frames = new Map<string, MotionPixels>();
  private bytes = 0;

  constructor(private readonly limit: number) {}

  get(key: string): MotionPixels | undefined {
    const frame = this.frames.get(key);
    if (!frame) return undefined;
    this.frames.delete(key);
    this.frames.set(key, frame);
    return frame;
  }

  set(key: string, frame: MotionPixels): void {
    if (frame.data.byteLength > this.limit) return;
    const old = this.frames.get(key);
    if (old) this.bytes -= old.data.byteLength;
    this.frames.delete(key);
    this.frames.set(key, frame);
    this.bytes += frame.data.byteLength;
    for (const [oldest, dropped] of this.frames) {
      if (this.bytes <= this.limit) break;
      this.frames.delete(oldest);
      this.bytes -= dropped.data.byteLength;
    }
  }

  clear(): void {
    this.frames.clear();
    this.bytes = 0;
  }
}

/** Whether `path` lies inside `base` (both absolute). */
function inside(base: string, path: string): boolean {
  const rel = relative(base, path);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class MotionPreview {
  private version: Version | undefined;
  /** Counts the changes to the project's files: a page of an older count is reloaded. */
  private files = 0;
  private takeInputs: { key: string; inputs: Promise<TakeInputs> } | undefined;
  /**
   * The take as pages see it, for the parts of the project it is made from (`key`), numbered: a take
   * that comes out the same keeps its number, and the pages keep theirs.
   */
  private takeSeen: { key: string; text: string; data: TakeData | null; id: number } | undefined;
  private readonly declared = new Map<string, Promise<{ params: ParamDeclaration[]; issues: string[] }>>();
  private readonly showings = new Map<string, Showing>();
  private readonly cache: FrameCache;
  private readonly identities = new Map<string, number>();
  private lastIdentity = 0;
  /** A showing whose item was just edited opens its page from then on (ms since the epoch). */
  private readonly settleUntil = new Map<string, number>();
  /** The timeline's strips, drawn one after the other; the newest asked for each item. */
  private strips: Promise<unknown> = Promise.resolve();
  private readonly stripTokens = new Map<string, number>();
  private readonly statuses = new Map<string, MotionStatus>();
  private readonly idle: ReturnType<typeof setInterval>;
  private closed = false;

  constructor(
    private readonly projectDir: string,
    private readonly options: MotionPreviewOptions = {},
  ) {
    this.cache = new FrameCache(options.cacheBytes ?? DEFAULT_CACHE_BYTES);
    const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
    this.idle = setInterval(() => {
      const now = Date.now();
      for (const showing of this.showings.values()) {
        if (showing.busy) continue;
        if (now - showing.used > idleMs) this.retire(showing);
        else if (showing.spare && now - showing.used > Math.min(SPARE_IDLE_MS, idleMs)) {
          const spare = showing.spare;
          showing.spare = undefined;
          void spare.then(
            (page) => page.close(),
            () => {},
          );
        }
      }
    }, Math.min(5_000, idleMs));
    this.idle.unref?.();
  }

  /** The project as the editor shows it now (`raw`: a project as `parseProject` reads it); frames are asked for by its number. */
  setProject(number: number, raw: Record<string, unknown>): void {
    this.version = { number, raw };
  }

  /** The version `number`, read (once), or undefined when it is not the newest or does not read. */
  private current(number: number): Version | undefined {
    const version = this.version;
    if (!version || version.number !== number) return undefined;
    if (!version.project) {
      const parsed = parseProject(version.raw);
      if (!parsed.ok) throw new Error(`the project does not read: ${parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`);
      version.project = parsed.project;
    }
    return version;
  }

  /** The project's files changed: every page loads again (with the page's new params), and the frames drawn before are dropped. */
  filesChanged(): void {
    this.files++;
    this.declared.clear();
    this.takeInputs = undefined;
    this.cache.clear();
    for (const showing of this.showings.values()) showing.failure = undefined;
  }

  /** Loads the pages of one item again (its spare too), as after a change to its files. */
  reload(item: string): void {
    for (const showing of this.showings.values()) if (showing.item === item) this.retire(showing);
    this.files++;
    this.cache.clear();
  }

  /** The params a page declares (read again after its files change), and what is wrong with the declaration. */
  params(src: string): Promise<{ params: ParamDeclaration[]; issues: string[] }> {
    return this.declaration(this.pageFile(src, 'the page'));
  }

  private declaration(file: string): Promise<{ params: ParamDeclaration[]; issues: string[] }> {
    let declared = this.declared.get(file);
    if (!declared) {
      declared = readFile(file, 'utf8').then(
        (html) => declaredParams(html),
        (error: NodeJS.ErrnoException) => ({ params: [], issues: [error.code === 'ENOENT' ? 'the page is missing' : describe(error)] }),
      );
      this.declared.set(file, declared);
    }
    return declared;
  }

  /** A page's path, checked: a file inside the project folder (the only files a page reaches). */
  private pageFile(src: string, name: string): string {
    const root = resolve(this.projectDir);
    const file = resolve(root, src);
    if (!inside(root, file)) throw new Error(`${name} must be a file in the project folder, not ${src}`);
    return file;
  }

  /**
   * The take as the pages see it (its files are read once until they change). It is made again only
   * when what it is made from changed: an edit elsewhere (a caption dragged) costs nothing.
   */
  private async take(project: CuttleProject, screen: { width: number; height: number }): Promise<{ data: TakeData | null; id: number }> {
    const files = JSON.stringify([project.sources.events, project.sources.transcript, project.sources.markers]);
    if (this.takeInputs?.key !== files) this.takeInputs = { key: files, inputs: motionTake(this.projectDir, project) };
    const inputs = this.takeInputs.inputs;
    const clips = sceneSpans(project.scenes, project.cuts).flatMap((span) => (span.scene.type === 'clip' ? [[span.start, span.end, span.scene.from, span.scene.to, span.scene.speed]] : []));
    const { zooms, masks, captions, look } = project;
    const key = JSON.stringify([files, this.files, screen, clips, zooms, masks, captions.fixes, look.cursor.smoothing]);
    const seen = this.takeSeen;
    if (seen?.key === key) return seen;
    // a video without clips shows nothing of a take
    const data = clips.length > 0 ? takeData(project, await inputs, screen, null) : null;
    // another request made it meanwhile
    if (this.takeSeen !== seen) return this.take(project, screen);
    const text = JSON.stringify(data);
    this.takeSeen = { key, text, data, id: seen && seen.text === text ? seen.id : (seen?.id ?? 0) + 1 };
    return this.takeSeen;
  }

  /** The page options of a request's showing, and its identity: the same identity draws the same frames. */
  private async describeShowing(version: Version, request: MotionFrameRequest, size: { width: number; height: number }) {
    const project = version.project!;
    const name = `${request.kind === 'scene' ? 'scenes' : 'overlays'}[${request.index}]`;
    const item = request.kind === 'scene' ? project.scenes[request.index] : project.overlays[request.index];
    if (!item || ('type' in item && item.type !== 'motion')) throw new Error(`${name} is not a motion item`);
    const motion = item as MotionScene | MotionOverlay;
    const file = this.pageFile(motion.src, `${name}.src`);
    const [declared, take] = await Promise.all([this.declaration(file), this.take(project, request.screen)]);
    const window = 'type' in motion ? null : { from: motion.at, to: motion.at + motion.duration };
    const init = motionInit(project, motion, name, { start: request.start, duration: request.duration }, {
      take: take.data && { ...take.data, window },
      fonts: [...KIT_FONTS],
      defaults: paramDefaults(declared.params),
    });
    const { take: _take, ...rest } = init;
    const identity = JSON.stringify([file, this.files, take.id, window, motion.network, motion.motionBlur ?? null, size, rest]);
    const options: MotionPageOptions = {
      file,
      root: resolve(this.projectDir),
      init,
      network: motion.network,
      ...(motion.motionBlur && { motionBlur: motion.motionBlur }),
      ...((size.width !== init.width || size.height !== init.height) && { frameSize: size }),
      ...(this.options.kitDir && { kitDir: this.options.kitDir }),
      ...(this.options.frameTimeout && { frameTimeout: this.options.frameTimeout }),
      loadTimeout: this.options.loadTimeout ?? PREVIEW_LOAD_TIMEOUT_MS,
    };
    return { name, src: motion.src, file, identity, options, issues: declared.issues };
  }

  /** A number for each identity, never used twice (a caller keeps it to ask whether its frame is still right). */
  private identityId(identity: string): number {
    let id = this.identities.get(identity);
    if (id === undefined) {
      // a long session makes many: the old ones are forgotten, with their frames
      if (this.identities.size >= 2000) {
        this.identities.clear();
        this.cache.clear();
      }
      id = ++this.lastIdentity;
      this.identities.set(identity, id);
    }
    return id;
  }

  /**
   * The frame a request of version `number` asks for, at `size` (at most the output's), and the number
   * of what draws it: frames of one number are the same. `have`: the number of the caller's own copy of
   * this frame (and view); when it is still right the answer has no pixels. Null when the request is no
   * longer wanted: an older version, or a newer request for the same showing came first.
   */
  async frame(
    number: number,
    request: MotionFrameRequest,
    size: { width: number; height: number },
    options: { mode?: PreviewMode; have?: number } = {},
  ): Promise<{ id: number; pixels?: MotionPixels } | null> {
    if (this.closed) return null;
    const version = this.current(number);
    if (!version) return null;
    const shown = await this.describeShowing(version, request, size);
    if (this.version !== version || this.closed) return null;
    const id = this.identityId(shown.identity);
    let showing = this.showings.get(request.key);
    if (showing && showing.identity !== shown.identity) {
      this.retire(showing);
      showing = undefined;
      // an edit in progress (a drag, typing) makes a new page each time: it opens once the edits rest
      this.settleUntil.set(request.key, Date.now() + SETTLE_MS);
    }
    if (options.have === id) {
      if (showing) showing.used = Date.now();
      return { id };
    }
    const cacheKey = `${id}|${request.frame}|${request.view ? JSON.stringify(request.view) : ''}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      if (showing) showing.used = Date.now();
      return { id, pixels: cached };
    }
    if (!showing) {
      this.makeRoom();
      showing = { key: request.key, identity: shown.identity, item: shown.name, file: shown.file, options: shown.options, busy: false, used: Date.now() };
      this.showings.set(request.key, showing);
      this.setStatus(shown.name, { item: shown.name, src: shown.src, state: 'loading', errors: [...shown.issues], console: [] });
    }
    showing.used = Date.now();
    if (showing.failure) throw new Error(showing.failure);
    const target = showing;
    const pixels = await new Promise<MotionPixels | null>((resolve, reject) => {
      // a request still waiting is no longer wanted: the newest one is drawn next
      target.waiting?.resolve(null);
      target.waiting = { request, mode: options.mode ?? 'seek', cacheKey, resolve, reject };
      if (!target.busy) void this.pump(target);
    });
    return pixels && { id, pixels };
  }

  /**
   * Frames across an item for its block on the timeline (`frames`, ascending), at `size`: drawn by a
   * page of their own, one strip after the other, and kept with the other frames. `have`: the number
   * of the caller's strip; when it is still right the answer has no pixels. Null when it is no longer
   * wanted (an older version, a newer strip for the same item).
   */
  async strip(
    number: number,
    request: MotionFrameRequest,
    frames: readonly number[],
    size: { width: number; height: number },
    have?: number,
  ): Promise<{ id: number; frames?: MotionPixels[] } | null> {
    if (this.closed) return null;
    const version = this.current(number);
    if (!version) return null;
    const shown = await this.describeShowing(version, request, size);
    if (this.version !== version || this.closed) return null;
    const id = this.identityId(shown.identity);
    if (have === id) return { id };
    const cacheKey = (frame: number) => `${id}|${frame}|`;
    const cached = frames.map((frame) => this.cache.get(cacheKey(frame)));
    if (cached.every((frame) => frame !== undefined)) return { id, frames: cached as MotionPixels[] };
    const token = (this.stripTokens.get(request.key) ?? 0) + 1;
    this.stripTokens.set(request.key, token);
    const wanted = () => this.stripTokens.get(request.key) === token && !this.closed;
    const job = this.strips.then(async (): Promise<{ id: number; frames?: MotionPixels[] } | null> => {
      if (!wanted()) return null;
      const page = await MotionPage.open(shown.options);
      try {
        const drawn = new Map<number, MotionPixels>();
        for (const frame of [...frames].sort((a, b) => a - b)) {
          if (!wanted()) return null;
          const pixels = await page.frame(frame);
          this.cache.set(cacheKey(frame), pixels);
          drawn.set(frame, pixels);
        }
        return { id, frames: frames.map((frame) => drawn.get(frame)!) };
      } finally {
        page.close();
      }
    });
    this.strips = job.catch(() => null);
    return job;
  }

  /** Draws the showing's waiting requests, one at a time. */
  private async pump(showing: Showing): Promise<void> {
    showing.busy = true;
    const live = () => this.showings.get(showing.key) === showing;
    try {
      while (showing.waiting) {
        const { request, mode, cacheKey, resolve, reject } = showing.waiting;
        showing.waiting = undefined;
        const settle = (this.settleUntil.get(showing.key) ?? 0) - Date.now();
        if (settle > 0 && !showing.page) {
          await pause(settle);
          // edited again meanwhile, or asked for another frame: that one is drawn
          if (!live() || showing.waiting) {
            resolve(null);
            continue;
          }
        }
        if (!live()) {
          resolve(null);
          continue;
        }
        const drawing = (async () => {
          const page = await this.pageFor(showing, request.frame);
          return page.frame(request.frame, request.view);
        })();
        showing.drawing = drawing.catch(() => {});
        try {
          const frame = await drawing;
          this.cache.set(cacheKey, frame);
          if (!live()) {
            resolve(frame);
            continue;
          }
          this.ready(showing);
          resolve(frame);
          // the item being scrubbed gets a spare page for going back
          if (mode === 'seek' && !showing.spare) showing.spare = this.openPage(showing);
        } catch (error) {
          // a showing put away meanwhile (its pages closed under it) is no failure of the page
          if (!live()) {
            resolve(null);
            continue;
          }
          const message = describe(error);
          showing.failure = message;
          this.fail(showing, message);
          reject(new Error(`${showing.item} (${relative(this.projectDir, showing.file).split(sep).join('/')}): ${message}`));
        }
      }
    } finally {
      showing.busy = false;
      showing.drawing = undefined;
    }
  }

  /** The page that draws frame `frame` next: the open one, else its spare (going back), else a new one. */
  private async pageFor(showing: Showing, frame: number): Promise<MotionPage> {
    const open = showing.page ? await showing.page.catch(() => undefined) : undefined;
    if (open && frame >= open.position) return open;
    if (open) {
      void this.collect(showing, open).then(() => open.close());
      showing.page = undefined;
    }
    if (showing.spare) {
      showing.page = showing.spare;
      showing.spare = undefined;
    } else showing.page = this.openPage(showing);
    return showing.page;
  }

  private openPage(showing: Showing): Promise<MotionPage> {
    const page = MotionPage.open(showing.options);
    page.catch(() => {}); // awaited where it is used
    return page;
  }

  /** Room for one more showing: the least recently shown one closes. */
  private makeRoom(): void {
    const max = this.options.maxShowings ?? DEFAULT_MAX_SHOWINGS;
    const open = [...this.showings.values()].sort((a, b) => a.used - b.used);
    while (open.length >= max) {
      const oldest = open.find((showing) => !showing.busy) ?? open[0]!;
      open.splice(open.indexOf(oldest), 1);
      this.retire(oldest);
    }
  }

  /** The showing is over: its pages close (what the open one said is kept), a request waiting gets null. */
  private retire(showing: Showing): void {
    if (this.showings.get(showing.key) === showing) this.showings.delete(showing.key);
    showing.waiting?.resolve(null);
    showing.waiting = undefined;
    clearTimeout(showing.reportTimer);
    const page = showing.page;
    const spare = showing.spare;
    showing.page = showing.spare = undefined;
    // after the frame being drawn
    const after = showing.drawing ?? Promise.resolve();
    void after.then(() =>
      page?.then(
        async (open) => {
          await this.collect(showing, open);
          open.close();
        },
        () => {},
      ),
    );
    void spare?.then(
      (open) => open.close(),
      () => {},
    );
  }

  private ready(showing: Showing): void {
    const status = this.statuses.get(showing.item);
    if (status && status.state !== 'ready') this.setStatus(showing.item, { ...status, state: 'ready', failure: undefined });
    // what the page said, a moment after it drew (not after every frame)
    if (!showing.reportTimer) {
      showing.reportTimer = setTimeout(() => {
        showing.reportTimer = undefined;
        void showing.page?.then((page) => this.collect(showing, page)).catch(() => {});
      }, 400);
    }
  }

  private fail(showing: Showing, message: string): void {
    const status = this.statuses.get(showing.item);
    if (status) this.setStatus(showing.item, { ...status, state: 'failed', failure: message });
  }

  /** What a page said so far, into its item's status. */
  private async collect(showing: Showing, page: MotionPage): Promise<void> {
    const said = await page.report().catch(() => undefined);
    const status = this.statuses.get(showing.item);
    if (!said || !status || this.closed) return;
    const errors = [...new Set([...status.errors, ...said.errors])];
    const lines = said.console;
    if (errors.length === status.errors.length && lines.length === status.console.length && lines.every((line, i) => line === status.console[i])) return;
    this.setStatus(showing.item, { ...status, errors, console: lines });
  }

  private setStatus(item: string, status: MotionStatus): void {
    this.statuses.set(item, status);
    this.options.onStatus?.(this.currentStatuses());
  }

  /** What each item's page is doing and said, in the order they first showed. */
  currentStatuses(): MotionStatus[] {
    return [...this.statuses.values()];
  }

  /** Closes every page. */
  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.idle);
    const showings = [...this.showings.values()];
    for (const showing of showings) this.retire(showing);
    this.cache.clear();
  }
}
