// An editor's music and sounds: the soundtrack the export would mix (the music page Claude wrote,
// rendered as long as the video, the project's sounds and those its motion pages ask for), rendered
// again a moment after each edit and each change to their files, so the editor plays what the export makes.
import { createHash } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { motionPages, motionSoundCues, motionTake, planSoundtrack, renderSoundtrack, type MusicStems, type PageSoundCache } from '@cuttle/export';
import { declaredParams } from '@cuttle/export/motion-params';
import { MUSIC_TEMPLATES } from '@cuttle/motion-kit';
import { copyTemplate } from '@cuttle/motion-kit/files';
import { parseProject } from '@cuttle/project';
import type { MotionParams, SoundStatusView, SoundtrackAnswer } from '../shared/ipc';

/** An edit waits this long for the next before the soundtrack renders (a drag, typing a param). */
const SETTLE_MS = 450;
/** The music lane's waveform: this many peaks a second. */
export const MUSIC_PEAKS_RATE = 50;

const inside = (base: string, path: string) => {
  const rel = relative(base, path);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

/** The louder ear's peaks of a stem at `MUSIC_PEAKS_RATE` a second, 0–255, scaled by `gain`. */
export function stemPeaks(stem: Float32Array, rate: number, gain = 1): Uint8Array {
  const frames = stem.length / 2;
  const step = rate / MUSIC_PEAKS_RATE;
  const out = new Uint8Array(Math.ceil(frames / step));
  for (let column = 0; column < out.length; column++) {
    let peak = 0;
    const end = Math.min(frames, Math.round((column + 1) * step));
    for (let i = Math.round(column * step); i < end; i++) peak = Math.max(peak, Math.abs(stem[i * 2]!), Math.abs(stem[i * 2 + 1]!));
    out[column] = Math.min(255, Math.round(peak * gain * 255));
  }
  return out;
}

export class EditorSound {
  private raw: { version: number; raw: Record<string, unknown> } | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private again = false;
  /** Changes to the music's files and Reloads: part of what a render is kept by. */
  private changes = 0;
  /** What each motion page asked for (`cuttle.sound`), until a file in `motion/` changes. */
  private readonly pageSounds: PageSoundCache = new Map();
  private pageChanges = 0;
  private current: { key: string; stems: MusicStems; speech: { start: number; end: number }[] } | undefined;
  private status: SoundStatusView = { state: 'none', errors: [], console: [], skipped: [] };
  private watcher: FSWatcher | undefined;
  private disposed = false;

  constructor(
    private readonly dir: string,
    private readonly events: { status: (status: SoundStatusView) => void },
  ) {}

  /** The project as the editor shows it: its soundtrack renders a moment later. */
  project(version: number, raw: Record<string, unknown>): void {
    this.raw = { version, raw };
    this.schedule();
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.render(), SETTLE_MS);
  }

  private setStatus(status: SoundStatusView): void {
    this.status = status;
    if (!this.disposed) this.events.status(status);
  }

  private async render(): Promise<void> {
    if (this.running) {
      this.again = true;
      return;
    }
    const shown = this.raw;
    if (!shown || this.disposed) return;
    this.running = true;
    try {
      const parsed = parseProject(shown.raw);
      if (!parsed.ok) return;
      const project = parsed.project;
      const take = await motionTake(this.dir, project);
      // a page that is missing shows in the motion preview; the others' sounds play
      const pages = await motionPages(this.dir, project).catch(() => undefined);
      const asked = await motionSoundCues(project, pages, take, { cache: this.pageSounds, changes: this.pageChanges });
      // where they play, for the Sound lane
      const pageSounds = asked.items.flatMap((item) => item.cues.map((cue) => ({ at: cue.at, sound: cue.sound, item: item.name })));
      const plan = await planSoundtrack(this.dir, project, take, asked.cues).catch((error: Error) => {
        this.setStatus({ state: 'failed', version: shown.version, failure: error.message, errors: [], console: [], skipped: [] });
        return null;
      });
      if (plan === null) return;
      plan?.skipped.push(...asked.errors);
      // watched also while nothing plays: a page that starts to ask for sounds is heard at once
      if (plan || pages) this.watchFiles();
      if (!plan) {
        this.current = undefined;
        this.setStatus({ state: 'none', version: shown.version, errors: [], console: [], skipped: asked.errors });
        return;
      }
      const key = createHash('sha256').update(JSON.stringify({ plan, changes: this.changes })).digest('hex').slice(0, 24);
      if (this.current?.key === key) {
        this.setStatus({ ...this.status, version: shown.version, pageSounds });
        return;
      }
      this.setStatus({ ...this.status, state: 'rendering', version: shown.version, pageSounds });
      try {
        const stems = await renderSoundtrack(this.dir, plan);
        if (this.disposed) return;
        this.current = { key, stems, speech: plan.video.speech };
        const { result, report } = stems;
        this.setStatus({
          state: 'ready',
          version: shown.version,
          key,
          info: result.info ?? null,
          renderMs: result.renderMs,
          errors: report.errors,
          console: report.console,
          skipped: result.skipped,
          pageSounds,
        });
      } catch (error) {
        this.setStatus({ state: 'failed', version: shown.version, failure: (error as Error).message, errors: [], console: [], skipped: [], pageSounds });
      }
    } finally {
      this.running = false;
      if (this.again) {
        this.again = false;
        this.schedule();
      }
    }
  }

  /** The soundtrack rendered last, when it is still `key`: the stems, their peaks for the lane, and the speech the music goes down for. */
  soundtrack(key: string): SoundtrackAnswer {
    const current = this.current;
    if (!current || current.key !== key) return null;
    const { stems } = current;
    return { key, rate: stems.rate, music: stems.music, effects: stems.effects, peaks: stemPeaks(stems.music, stems.rate), speech: current.speech };
  }

  currentStatus(): SoundStatusView {
    return this.status;
  }

  /** The params the music page declares. */
  async params(src: string): Promise<MotionParams> {
    const path = resolve(this.dir, src);
    if (!inside(this.dir, path)) throw new Error('only pages inside the project can be read');
    return declaredParams(await readFile(path, 'utf8'));
  }

  /** Copies a music template into `music/<name>/`: the page's path in the project. */
  async addTemplate(template: string): Promise<string> {
    if (!MUSIC_TEMPLATES.some((candidate) => candidate.name === template)) throw new Error(`no music template "${template}"`);
    return copyTemplate(this.dir, `music-${template}`, template, import.meta.url, 'music');
  }

  /** Renders the music again (Reload in the inspector). */
  reload(): void {
    this.changes++;
    this.schedule();
  }

  /** Watches the project's folder for changes to the music's pages, the sounds' files and the motion pages. */
  private watchFiles(): void {
    if (this.watcher) return;
    try {
      this.watcher = watch(this.dir, { recursive: true }, (_event, name) => {
        if (!name) return;
        const top = name.split(/[\\/]/)[0];
        if (top === 'motion') {
          // a page may now ask for other sounds: asked again, and the music rendered only if they changed
          this.pageChanges++;
          this.pageSounds.clear();
        } else if (top === 'music' || top === 'sounds') this.changes++;
        else return;
        this.schedule();
      });
      this.watcher.on('error', () => {
        this.watcher?.close();
        this.watcher = undefined;
      });
    } catch {
      // a folder that cannot be watched: an edited page plays after Reload
    }
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    this.watcher?.close();
    this.watcher = undefined;
    this.current = undefined;
  }
}
