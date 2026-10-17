import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { utilityProcess, type UtilityProcess } from 'electron';
import type { CuttleProject } from '@cuttle/project';
import type { MediaState } from '../shared/ipc';
import type { MediaJob, ThumbnailsMeta, WorkerReply } from '../shared/media-jobs';
import { PEAKS_RATE } from '../shared/media-jobs';
import { CACHE_DIR } from './project';
import { bundlePath } from './protocols';

const CACHE_FILE = 'media.json';
const CACHE_VERSION = 1;

/** Which source file a cached file was made from (by size and modification time). */
interface SourceKey {
  file: string;
  size: number;
  mtimeMs: number;
}

interface CacheEntry {
  source: SourceKey;
  meta?: ThumbnailsMeta;
}

interface Cache {
  version: number;
  proxy?: CacheEntry;
  thumbnails?: CacheEntry;
  peaks?: CacheEntry;
}

type Kind = 'proxy' | 'thumbnails' | 'peaks';
const OUTPUT: Record<Kind, string> = { proxy: 'proxy.mp4', thumbnails: 'thumbnails.jpg', peaks: 'peaks.bin' };

interface Job {
  job: MediaJob;
  onProgress: (progress: number) => void;
  resolve: (meta?: ThumbnailsMeta) => void;
  reject: (error: Error) => void;
}

/**
 * The one media worker of the app, started on first use. Jobs from every window wait in one queue
 * and run one at a time: two x264 encodes at once would only slow both down.
 */
class Worker {
  private process: UtilityProcess | undefined;
  private next = 1;
  private readonly pending = new Map<number, Job>();
  private readonly queue: { id: number; job: Job }[] = [];
  private running: number | undefined;

  private start(): UtilityProcess {
    if (this.process) return this.process;
    const child = utilityProcess.fork(bundlePath('main', 'media-worker.mjs'), [], { serviceName: 'Cuttle media', stdio: 'ignore' });
    child.on('message', (message: WorkerReply) => {
      const job = this.pending.get(message.id);
      if (!job) return;
      if ('progress' in message) return job.onProgress(message.progress);
      this.finish(message.id);
      if ('done' in message) job.resolve(message.meta);
      else job.reject(Object.assign(new Error(message.error), { cancelled: message.cancelled === true }));
    });
    child.on('exit', () => {
      this.process = undefined;
      this.running = undefined;
      for (const job of this.pending.values()) job.reject(new Error('the media worker stopped'));
      this.pending.clear();
      this.queue.length = 0;
    });
    this.process = child;
    return child;
  }

  private finish(id: number): void {
    this.pending.delete(id);
    if (this.running === id) this.running = undefined;
    this.pump();
  }

  private pump(): void {
    if (this.running !== undefined) return;
    // Peaks take seconds and the waveform is wanted at once: they go before a proxy's long encode.
    const peaks = this.queue.findIndex((entry) => entry.job.job.job === 'peaks');
    const [next] = this.queue.splice(Math.max(0, peaks), 1);
    if (!next) return;
    this.running = next.id;
    this.start().postMessage({ id: next.id, ...next.job.job });
  }

  run(media: MediaJob, onProgress: (progress: number) => void): { promise: Promise<ThumbnailsMeta | undefined>; cancel(): void } {
    const id = this.next++;
    const promise = new Promise<ThumbnailsMeta | undefined>((resolve, reject) => {
      const job = { job: media, onProgress, resolve, reject };
      this.pending.set(id, job);
      this.queue.push({ id, job });
    });
    this.pump();
    return {
      promise,
      cancel: () => {
        const queued = this.queue.findIndex((entry) => entry.id === id);
        if (queued >= 0) {
          this.queue.splice(queued, 1);
          this.pending.get(id)?.reject(Object.assign(new Error('cancelled'), { cancelled: true }));
          this.pending.delete(id);
        } else if (this.running === id) this.process?.postMessage({ id, cancel: true });
      },
    };
  }

  stop(): void {
    this.process?.kill();
  }
}

export const mediaWorker = new Worker();

/** Cuts a project's take with `suggest` (in the media worker); its hash-checked write never overwrites a newer save. */
export async function cutTake(dir: string): Promise<void> {
  await mediaWorker.run({ job: 'suggest', input: dir, output: '' }, () => {}).promise;
}

async function sourceKey(path: string, file: string): Promise<SourceKey | undefined> {
  try {
    const info = await stat(path);
    return info.isFile() && info.size > 0 ? { file, size: info.size, mtimeMs: info.mtimeMs } : undefined;
  } catch {
    return undefined;
  }
}

const sameSource = (a: SourceKey | undefined, b: SourceKey | undefined) => !!a && !!b && a.file === b.file && a.size === b.size && a.mtimeMs === b.mtimeMs;

/** Project-relative path with forward slashes, as the media protocol takes it. */
const projectPath = (dir: string, path: string) => relative(dir, path).split(sep).join('/');

/**
 * The editor's background media for one project: a proxy of the screen track, thumbnails (from the
 * proxy when it is there) and the mic's peaks, made once per take and kept in `.cuttle/`. Reports
 * its state on every change.
 */
export class ProjectMedia {
  private readonly state: MediaState = { seq: 0, proxy: { state: 'none' }, thumbnails: { state: 'none' }, peaks: { state: 'none' } };
  private readonly jobs: { cancel(): void }[] = [];
  private disposed = false;
  private cache: Cache = { version: CACHE_VERSION };

  constructor(
    private readonly dir: string,
    private readonly project: CuttleProject,
    private readonly onChange: (state: MediaState) => void,
  ) {}

  /** The sources the media are made from. */
  get sources(): CuttleProject['sources'] {
    return this.project.sources;
  }

  current(): MediaState {
    return structuredClone(this.state);
  }

  private cacheDir = () => join(this.dir, CACHE_DIR);

  private set<K extends Kind>(kind: K, value: MediaState[K]): void {
    if (this.disposed) return;
    this.state[kind] = value;
    this.state.seq++;
    this.onChange(this.current());
  }

  private async readCache(): Promise<void> {
    try {
      const cache = JSON.parse(await readFile(join(this.cacheDir(), CACHE_FILE), 'utf8')) as Cache;
      if (cache.version === CACHE_VERSION) this.cache = cache;
    } catch {
      this.cache = { version: CACHE_VERSION };
    }
  }

  private writing = Promise.resolve();

  /** Writes media.json, one write at a time. */
  private writeCache(): Promise<void> {
    this.writing = this.writing.then(() => this.writeCacheNow()).catch(() => {});
    return this.writing;
  }

  private async writeCacheNow(): Promise<void> {
    const path = join(this.cacheDir(), CACHE_FILE);
    await writeFile(`${path}.part`, `${JSON.stringify(this.cache, null, 2)}\n`);
    await rename(`${path}.part`, path);
  }

  private started: Promise<void> | undefined;

  /** Makes what is missing: the proxy, then the thumbnails from it; the peaks alongside. Again after a failure (retry). */
  start(): Promise<void> {
    if (this.started) return this.started;
    this.started = this.startNow().finally(() => (this.started = undefined));
    return this.started;
  }

  private async startNow(): Promise<void> {
    await mkdir(this.cacheDir(), { recursive: true });
    await this.readCache();
    const screen = resolve(this.dir, this.project.sources.screen);
    const screenKey = await sourceKey(screen, this.project.sources.screen);
    const mic = this.project.sources.mic === undefined ? undefined : resolve(this.dir, this.project.sources.mic);
    const micKey = mic === undefined ? undefined : await sourceKey(mic, this.project.sources.mic!);
    const peaks = mic && micKey ? this.peaks(mic, micKey) : Promise.resolve();
    await Promise.all([peaks, this.visual(screen, screenKey)]);
  }

  private async visual(screen: string, key: SourceKey | undefined): Promise<void> {
    if (!key) return;
    const proxy = await this.make('proxy', screen, key, (progress) => this.set('proxy', { state: 'working', progress }));
    if (proxy) this.set('proxy', { state: 'ready', path: projectPath(this.dir, proxy) });
    const input = proxy ?? screen;
    const thumbs = await this.make('thumbnails', input, key);
    const meta = this.cache.thumbnails?.meta;
    if (thumbs && meta) this.set('thumbnails', { state: 'ready', path: projectPath(this.dir, thumbs), ...meta });
  }

  private async peaks(mic: string, key: SourceKey): Promise<void> {
    const peaks = await this.make('peaks', mic, key);
    if (peaks) this.set('peaks', { state: 'ready', path: projectPath(this.dir, peaks), rate: PEAKS_RATE });
  }

  /** The cached file of `kind` for `key`, made first when it is missing or stale; undefined when making it failed. */
  private async make(kind: Kind, input: string, key: SourceKey, onProgress?: (progress: number) => void): Promise<string | undefined> {
    const output = join(this.cacheDir(), OUTPUT[kind]);
    const cached = this.cache[kind];
    if (cached && sameSource(cached.source, key) && (await sourceKey(output, OUTPUT[kind]))) return output;
    if (this.disposed) return undefined;
    this.set(kind, { state: 'working', ...(kind === 'proxy' && { progress: 0 }) } as MediaState[typeof kind]);
    const job = mediaWorker.run({ job: kind, input, output }, (progress) => onProgress?.(progress));
    this.jobs.push(job);
    try {
      const meta = await job.promise;
      this.cache[kind] = { source: key, ...(meta && { meta }) };
      await this.writeCache();
      return output;
    } catch (error) {
      if (!(error as { cancelled?: boolean }).cancelled) this.set(kind, { state: 'failed', message: (error as Error).message } as MediaState[typeof kind]);
      return undefined;
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const job of this.jobs) job.cancel();
  }
}
