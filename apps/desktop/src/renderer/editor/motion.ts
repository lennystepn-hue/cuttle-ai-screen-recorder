// The player's motion frames: the main process draws them with the export's pages, at the size the
// player shows. A few are kept per item, so a frame shows at once with the nearest kept one while
// the exact one comes (scrubbing, an edit), and playback asks ahead by as long as a frame takes.
import type { FrameSources, MotionPixels } from '@cuttle/engine';
import { motionNeeds, type MotionNeed } from '@cuttle/export/motion-requests';
import type { CuttleProject } from '@cuttle/project';
import type { RenderState, SceneSpan } from '@cuttle/timeline';
import { bridge } from '../bridge';

/** A frame kept: what drew it (`id`, the main process's number), which frame and view, and the version it was right for. */
interface Kept {
  version: number;
  id: number;
  frame: number;
  view: string;
  pixels: MotionPixels;
}

/** Frames kept per item. */
const KEEP = 8;
/** Requests on their way per showing while playing: one is drawn while the other travels. */
const IN_FLIGHT = 2;
/** Playback asks for a showing's first frame this long before it shows (s): its page opens in time. */
const WARM_SECONDS = 1.5;
/** At most this many frames ahead. */
const MAX_LEAD = 12;

const viewKey = (need: MotionNeed) => (need.request.view ? JSON.stringify(need.request.view) : '');

/** Frames across a motion scene for its block on the timeline: their frame numbers, and each as an image URL. */
export interface MotionStrip {
  frames: number[];
  urls: string[];
}

/** Frames a strip has: two a second, from 2 to 12. */
const stripCount = (seconds: number) => Math.min(12, Math.max(2, Math.round(seconds * 2)));

/** A frame (premultiplied RGBA) as an image URL. */
async function imageUrl(pixels: MotionPixels): Promise<string> {
  const data = new Uint8ClampedArray(pixels.data.length);
  for (let i = 0; i < data.length; i += 4) {
    const alpha = pixels.data[i + 3]!;
    const scale = alpha === 0 ? 0 : 255 / alpha;
    data[i] = pixels.data[i]! * scale;
    data[i + 1] = pixels.data[i + 1]! * scale;
    data[i + 2] = pixels.data[i + 2]! * scale;
    data[i + 3] = alpha;
  }
  const canvas = new OffscreenCanvas(pixels.width, pixels.height);
  canvas.getContext('2d')!.putImageData(new ImageData(data, pixels.width, pixels.height), 0, 0);
  return URL.createObjectURL(await canvas.convertToBlob({ type: 'image/png' }));
}

/** Whether the project has motion scenes, overlays or transitions (without, nothing is asked of the main process). */
export const hasMotion = (project: CuttleProject) =>
  project.overlays.length > 0 || project.scenes.some((scene) => scene.type === 'motion' || scene.transition?.enabled === true);

/** Transition frames kept (this version's, at the player's size): about two transitions of a second at 30 fps. */
const KEEP_BETWEEN = 72;

export class MotionFrames {
  private version = 0;
  private project: CuttleProject;
  private active: boolean;
  private readonly kept = new Map<string, Kept[]>();
  /** While playing: requests on their way and the last frame asked for, per showing; how long frames take (ms), per item. */
  private readonly flying = new Map<string, number>();
  private readonly asked = new Map<string, number>();
  private readonly took = new Map<string, number>();
  /** Showings that failed while playing: not asked again until the next play. */
  private readonly failed = new Set<string>();

  constructor(
    project: CuttleProject,
    private readonly screen: { width: number; height: number },
    /** The size frames are drawn at (the player's on screen, at most the output's). */
    private readonly size: () => { width: number; height: number },
    /** A frame could not be drawn (the item's status says why). */
    private readonly onError: (message: string) => void = () => {},
  ) {
    this.project = project;
    this.active = hasMotion(project);
    this.send();
  }

  /** Another version of the project: frames are asked for by its number. */
  setProject(project: CuttleProject): void {
    if (project === this.project) return;
    this.project = project;
    this.version++;
    this.active = hasMotion(project);
    this.send();
  }

  /** The project's files changed: the frames kept are not right any more (they still show until the new ones come). */
  filesChanged(): void {
    this.version++;
    this.send();
  }

  private send(): void {
    if (this.active) void bridge.invoke('motion:project', { version: this.version, raw: this.project as unknown as Record<string, unknown> }).catch(() => {});
  }

  /** The motion frames `state` shows. */
  needs(spans: readonly SceneSpan[], state: RenderState): MotionNeed[] {
    return this.active ? motionNeeds(this.project, spans, state, this.screen) : [];
  }

  /** The item a need draws: its frames are kept together (by id, else by page), across edits and its showings. */
  private itemKey(need: MotionNeed): string {
    const { kind, index } = need.request;
    const item = kind === 'scene' ? this.project.scenes[index] : this.project.overlays[index];
    const name = item && 'src' in item ? (item.id ?? item.src) : `#${index}`;
    return `${kind}:${name}`;
  }

  private keep(need: MotionNeed, kept: Kept, wanted?: number): void {
    const key = this.itemKey(need);
    let list = (this.kept.get(key) ?? []).filter((other) => !(other.frame === kept.frame && other.view === kept.view));
    list.push(kept);
    // while playing, frames behind the playhead go first (the newest of them still shows)
    if (wanted !== undefined) {
      const behind = list.filter((other) => other.frame < wanted).sort((a, b) => b.frame - a.frame);
      list = list.filter((other) => other.frame >= wanted || other === behind[0]);
    }
    while (list.length > KEEP) list.shift();
    this.kept.set(key, list);
  }

  /** The kept frame nearest to a need, and whether it is the exact one. */
  private nearest(need: MotionNeed): { kept: Kept; exact: boolean } | undefined {
    const list = this.kept.get(this.itemKey(need));
    if (!list?.length) return undefined;
    const view = viewKey(need);
    const { frame } = need.request;
    const exact = list.find((kept) => kept.version === this.version && kept.frame === frame && kept.view === view);
    if (exact) return { kept: exact, exact: true };
    // the closest frame, one before the wanted rather than after it
    let best = list[0]!;
    const distance = (kept: Kept) => Math.abs(kept.frame - frame) + (kept.frame > frame ? 0.5 : 0) + (kept.version === this.version ? 0 : 0.25);
    for (const kept of list) if (distance(kept) < distance(best)) best = kept;
    return { kept: best, exact: false };
  }

  /** Puts the nearest kept frame of each need into `sources`; true when each was the exact frame. */
  fill(needs: readonly MotionNeed[], sources: FrameSources): boolean {
    let exact = true;
    for (const need of needs) {
      const found = this.nearest(need);
      if (!found?.exact) exact = false;
      if (found) this.place(need, found.kept.pixels, sources);
    }
    return exact;
  }

  private place(need: MotionNeed, pixels: MotionPixels, sources: FrameSources): void {
    if (need.target.kind === 'scene') sources.motion.set(need.target.layer, pixels);
    else sources.overlays.set(need.target.key, pixels);
  }

  private ask(need: MotionNeed, mode: 'seek' | 'play', have?: number) {
    const { width, height } = this.size();
    return bridge.invoke('motion:frame', { version: this.version, request: need.request, width, height, mode, ...(have !== undefined && { have }) });
  }

  /**
   * The exact frames of `needs` (paused): asked for, kept and put into `sources`. True when one of
   * them differs from what `fill` put there; undefined when they are no longer wanted.
   */
  async exact(needs: readonly MotionNeed[], sources: FrameSources): Promise<boolean | undefined> {
    const version = this.version;
    const answers = await Promise.allSettled(
      needs.map(async (need) => {
        const before = this.nearest(need);
        // the copy of this very frame kept from an earlier version may still be right
        const same = before && before.kept.frame === need.request.frame && before.kept.view === viewKey(need) ? before.kept : undefined;
        const answer = await this.ask(need, 'seek', same?.id);
        if (!answer || version !== this.version) return undefined;
        const pixels = answer.pixels ?? (same && answer.id === same.id ? same.pixels : undefined);
        if (!pixels) return undefined;
        this.keep(need, { version, id: answer.id, frame: need.request.frame, view: viewKey(need), pixels });
        this.place(need, pixels, sources);
        return pixels !== before?.kept.pixels;
      }),
    );
    if (version !== this.version) return undefined;
    let changed = false;
    for (const answer of answers) {
      if (answer.status === 'rejected') this.onError((answer.reason as Error).message);
      else if (answer.value === undefined) {
        // superseded by a newer request: that one draws
        if (answers.every((other) => other.status === 'fulfilled' && other.value === undefined)) return undefined;
      } else if (answer.value) changed = true;
    }
    return changed;
  }

  /** The transitions' frames made for this version (`key@frame`), oldest first, and the version they are of. */
  private readonly between = new Map<string, MotionPixels>();
  private betweenVersion = -1;

  /** Where `state`'s transition frame is kept, or undefined without one. */
  private betweenKey(state: RenderState): string | undefined {
    const active = state.transition;
    if (!active) return undefined;
    if (this.betweenVersion !== this.version) {
      this.between.clear();
      this.betweenVersion = this.version;
    }
    return `${active.key}@${Math.round(active.local * this.project.output.fps)}`;
  }

  /** Whether `state`'s transition frame is made (true without a transition). */
  hasTransition(state: RenderState): boolean {
    const key = this.betweenKey(state);
    return key === undefined || this.between.has(key);
  }

  /**
   * Puts `state`'s transition frame into `sources` when it is made (the engine crossfades without);
   * true when it was there or the frame has no transition.
   */
  fillTransition(state: RenderState, sources: FrameSources): boolean {
    const key = this.betweenKey(state);
    sources.transitions?.clear();
    if (key === undefined) return true;
    const pixels = this.between.get(key);
    if (!pixels) return false;
    (sources.transitions ??= new Map()).set(state.transition!.key, pixels);
    return true;
  }

  /**
   * Makes `state`'s transition frame: the main process draws its page from the two layers (`layers`
   * reads them from the renderer). Kept for playing; undefined when it is no longer wanted.
   */
  async transition(state: RenderState, layers: () => [MotionPixels, MotionPixels], mode: 'seek' | 'play'): Promise<MotionPixels | undefined> {
    const key = this.betweenKey(state);
    const active = state.transition;
    if (key === undefined || !active || !this.active) return undefined;
    const kept = this.between.get(key);
    if (kept) return kept;
    const version = this.version;
    const [from, to] = layers();
    const { width, height } = this.size();
    const request = {
      key: active.key,
      kind: 'transition' as const,
      index: active.sceneIndex,
      frame: Math.round(active.local * this.project.output.fps),
      start: active.start,
      duration: active.duration,
      screen: this.screen,
      between: { from, to },
    };
    const answer = await bridge.invoke('motion:frame', { version, request, width, height, mode });
    if (!answer?.pixels || version !== this.version) return undefined;
    this.between.set(key, answer.pixels);
    while (this.between.size > KEEP_BETWEEN) this.between.delete(this.between.keys().next().value!);
    return answer.pixels;
  }

  /** Frames that came while playing (since it started), and how long one took (ms, a running mean of every item). */
  private received = 0;

  /** The motion frames that came while playing and how long one took, and the transition frames made for this version. */
  stats(): { frames: number; took: number; made: number } {
    const times = [...this.took.values()];
    const made = this.betweenVersion === this.version ? this.between.size : 0;
    return { frames: this.received, took: times.length > 0 ? Math.round(times.reduce((sum, time) => sum + time, 0) / times.length) : 0, made };
  }

  /** The strips of the scenes' blocks, by item, with the number of what drew them. */
  private readonly strips = new Map<string, { id: number; strip: MotionStrip }>();

  /**
   * Frames across motion scene `sceneIndex` for its block on the timeline, `height` px high: the strip
   * the editor has when it is still right, undefined when it cannot be drawn now.
   */
  async strip(spans: readonly SceneSpan[], sceneIndex: number, height: number): Promise<MotionStrip | undefined> {
    const scene = this.project.scenes[sceneIndex];
    const span = spans.find((candidate) => candidate.sceneIndex === sceneIndex);
    if (scene?.type !== 'motion' || !span) return undefined;
    const { fps, width: outWidth, height: outHeight } = this.project.output;
    const last = Math.max(0, Math.round(scene.duration * fps) - 1);
    const count = stripCount(scene.duration);
    const frames = [...new Set(Array.from({ length: count }, (_, k) => Math.min(last, Math.round(((k + 0.5) / count) * scene.duration * fps))))];
    const key = `scene:${scene.id ?? scene.src}`;
    const kept = this.strips.get(key);
    const same = kept && kept.strip.frames.join() === frames.join();
    const answer = await bridge.invoke('motion:strip', {
      version: this.version,
      request: { key: `strip:${key}`, kind: 'scene', index: sceneIndex, frame: 0, start: span.start, duration: scene.duration, screen: this.screen },
      frames,
      width: Math.max(8, Math.min(512, Math.round((height * outWidth) / outHeight))),
      height,
      ...(same && { have: kept.id }),
    });
    if (!answer) return undefined;
    if (!answer.frames) return kept?.strip;
    const strip = { frames, urls: await Promise.all(answer.frames.map(imageUrl)) };
    for (const url of kept?.strip.urls ?? []) URL.revokeObjectURL(url);
    this.strips.set(key, { id: answer.id, strip });
    return strip;
  }

  /** Playback starts: what failed before is asked again. */
  startPlaying(): void {
    this.received = 0;
    this.flying.clear();
    this.asked.clear();
    this.failed.clear();
    this.playhead.clear();
  }

  /**
   * While playing, output frame `frame`: puts the best kept frame of each need into `sources` and
   * asks for frames ahead (by as long as one takes), and for the first frames of showings coming up.
   * `needsAt(n)` gives the needs of output frame n.
   */
  stream(needs: readonly MotionNeed[], frame: number, fps: number, last: number, sources: FrameSources, needsAt: (frame: number) => MotionNeed[]): void {
    if (!this.active) return;
    for (const need of needs) {
      const item = this.itemKey(need);
      const wanted = need.request.frame;
      this.playhead.set(item, wanted);
      // the newest frame of this version up to the wanted one, else the nearest
      let best: Kept | undefined;
      for (const kept of this.kept.get(item) ?? []) if (kept.version === this.version && kept.frame <= wanted && (!best || kept.frame > best.frame)) best = kept;
      const pixels = best?.pixels ?? this.nearest(need)?.kept.pixels;
      if (pixels) this.place(need, pixels, sources);
      // ahead by as long as a frame of this item takes to come
      const lead = Math.min(MAX_LEAD, Math.max(1, Math.ceil(((this.took.get(item) ?? 60) / 1000) * fps) + 1));
      this.askAhead(need.request.key, Math.min(last, frame + lead), needsAt);
    }
    // showings that start soon: the frame they start with, so their page is open when they show
    const soon = Math.min(last, frame + Math.round(WARM_SECONDS * fps));
    if (soon <= frame) return;
    for (const need of needsAt(soon)) {
      if (this.asked.has(need.request.key)) continue;
      const starts = Math.round(need.request.start * fps);
      this.askAhead(need.request.key, Math.max(frame + 1, Math.min(starts, soon)), needsAt);
    }
  }

  /** The local frame each item shows while playing (frames before it are dropped as new ones come). */
  private readonly playhead = new Map<string, number>();

  /** Asks for showing `key`'s frame on output frame `at`, unless it asked for that one (or a later one) already or has no room. */
  private askAhead(key: string, at: number, needsAt: (frame: number) => MotionNeed[]): void {
    if (this.failed.has(key) || (this.flying.get(key) ?? 0) >= IN_FLIGHT) return;
    const need = needsAt(at).find((candidate) => candidate.request.key === key);
    if (!need || need.request.frame <= (this.asked.get(key) ?? -1)) return;
    this.asked.set(key, need.request.frame);
    this.flying.set(key, (this.flying.get(key) ?? 0) + 1);
    const version = this.version;
    const item = this.itemKey(need);
    const started = performance.now();
    const landed = () => this.flying.set(key, Math.max(0, (this.flying.get(key) ?? 1) - 1));
    this.ask(need, 'play').then(
      (answer) => {
        landed();
        if (!answer?.pixels || version !== this.version) return;
        const took = performance.now() - started;
        this.took.set(item, 0.7 * (this.took.get(item) ?? took) + 0.3 * took);
        this.received++;
        this.keep(need, { version, id: answer.id, frame: need.request.frame, view: viewKey(need), pixels: answer.pixels }, this.playhead.get(item));
      },
      (error: Error) => {
        landed();
        this.failed.add(key);
        this.onError(error.message);
      },
    );
  }
}
