import type { FrameSources } from '@cuttle/engine';
import type { CuttleProject } from '@cuttle/project';
import type { RenderState, SceneSpan } from '@cuttle/timeline';
import type { FramePlan, OverlayPlan, ScenePlan } from '../frame-plan';
import type { MotionFrameRequest, MotionPixels } from '../job';
import { motionNeeds, type MotionNeed } from '../motion/requests';
import type { MotionView } from '../motion/runtime';
import { host, PageError } from './host';
import { loadImage } from './images';
import type { VideoFile } from './media';
import { TrackReader } from './track-reader';

export interface SceneMedia {
  /** The screen recording; absent in a project without clips. */
  screen?: VideoFile;
  /** `offset`: seconds the webcam started after the screen; webcam time = source time − offset. */
  webcam?: VideoFile & { offset: number };
  /** Scene index → image path of a still scene. */
  stills: Readonly<Record<number, string>>;
  maxTextureSize: number;
}

/** What motion items need besides the media: the project and its spans, and the timeline's frames. */
export interface MotionContext {
  project: CuttleProject;
  spans: readonly SceneSpan[];
  /** The timeline's state on output frame `frame`. */
  stateAt(frame: number): RenderState;
  /** Ask for each item's next frame while the current one is drawn and encoded (a video; not stills, whose frames jump). */
  ahead: boolean;
}

interface OpenScene {
  plan: ScenePlan;
  screen?: TrackReader;
  webcam?: TrackReader;
  still?: Promise<ImageBitmap>;
  motion?: MotionSource;
}

/** The message of an error the main process threw, without Electron's "Error invoking remote method …" in front. */
const remoteMessage = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '');

/**
 * One showing of a motion item: its frames, drawn by the main process in the order they are asked
 * for. A frame may be asked for ahead of time (its first as it opens, the next while one is drawn).
 */
class MotionSource {
  private readonly asked = new Map<number, Promise<MotionPixels>>();

  constructor(private readonly request: Omit<MotionFrameRequest, 'frame' | 'view'>) {}

  private ask(frame: number, view: MotionView | undefined): Promise<MotionPixels> {
    return host()
      .motionFrame({ ...this.request, frame, ...(view && { view }) })
      .catch((error: unknown) => {
        throw new PageError('render', remoteMessage(error));
      });
  }

  /** Asks for frame `n` now, for later (once). */
  ahead(n: number, view: MotionView | undefined): void {
    if (this.asked.has(n)) return;
    const frame = this.ask(n, view);
    frame.catch(() => {}); // awaited when it shows
    this.asked.set(n, frame);
  }

  /** Frame `n` of the showing (n / fps seconds into it), with this frame's view of the take. */
  frame(n: number, view: MotionView | undefined): Promise<MotionPixels> {
    const frame = this.asked.get(n) ?? this.ask(n, view);
    for (const key of this.asked.keys()) if (key <= n) this.asked.delete(key);
    return frame;
  }

  done(): void {
    host().motionDone(this.request.key);
  }
}

/**
 * Opens each scene's decoders (or its still image) `lookahead` frames before it first shows, so
 * decoding runs ahead in the background, and closes them after its last frame. Hands the renderer
 * the frames for every visible layer.
 */
export class SceneSources {
  private readonly open = new Map<number, OpenScene>();
  private readonly pending: ScenePlan[];
  /** Motion overlays' showings, by `ActiveOverlay.key`. */
  private readonly overlays = new Map<string, { plan: OverlayPlan; source: MotionSource }>();
  private readonly pendingOverlays: OverlayPlan[];
  /** The last frame of the video (or of the stills). */
  private readonly lastFrame: number;
  private readonly sources: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map(), motion: new Map(), overlays: new Map(), transitions: new Map() };
  /** The transition pages' showings now open, by `ActiveTransition.key`. */
  private readonly transitions = new Set<string>();

  constructor(
    plan: FramePlan,
    private readonly media: SceneMedia,
    private readonly lookahead: number,
    private readonly motion: MotionContext,
  ) {
    this.pending = [...plan.scenes];
    this.pendingOverlays = [...plan.overlays].sort((a, b) => a.firstFrame - b.firstFrame);
    this.lastFrame = Math.max(0, ...plan.scenes.map((scene) => scene.lastFrame));
  }

  /** The open showing a motion frame comes from. */
  private sourceOf(need: MotionNeed): MotionSource | undefined {
    return need.request.kind === 'scene' ? this.open.get(need.request.index)?.motion : this.overlays.get(need.request.key.slice('overlay:'.length))?.source;
  }

  /** Asks each motion item on output frame `frame` for that frame, ahead of time. */
  private askAhead(frame: number): void {
    for (const need of motionNeeds(this.motion.project, this.motion.spans, this.motion.stateAt(frame), this.screenSize)) {
      this.sourceOf(need)?.ahead(need.request.frame, need.request.view);
    }
  }

  private screenTime(sourceTime: number): number {
    return Math.max(sourceTime, this.media.screen?.start ?? 0);
  }

  /** The screen recording's size; the output's in a project without one. */
  private get screenSize(): { width: number; height: number } {
    return this.media.screen?.size ?? { width: this.motion.project.output.width, height: this.motion.project.output.height };
  }

  /** Webcam time for a source time, or undefined where the webcam track has no frame. */
  private webcamTime(sourceTime: number): number | undefined {
    const webcam = this.media.webcam;
    if (!webcam) return undefined;
    const time = sourceTime - webcam.offset;
    return time >= webcam.start && time < webcam.end ? time : undefined;
  }

  private openScene(plan: ScenePlan): OpenScene {
    const { screen, webcam } = this.media;
    if (plan.kind === 'clip') {
      if (!screen) throw new Error(`scene ${plan.index} is a clip, but there is no screen recording`);
      const screenTimes = [...new Set(plan.sourceTimes.map((t) => this.screenTime(t)))];
      const webcamTimes = plan.sourceTimes.map((t) => this.webcamTime(t)).filter((t): t is number => t !== undefined);
      return {
        plan,
        screen: new TrackReader(screen.track, screenTimes, screen.decoder),
        webcam: webcam && webcamTimes.length > 0 ? new TrackReader(webcam.track, webcamTimes, webcam.decoder) : undefined,
      };
    }
    if (plan.kind === 'still') {
      const path = this.media.stills[plan.index];
      if (path === undefined) throw new Error(`no image path for still scene ${plan.index}`);
      const still = loadImage(path, this.media.maxTextureSize, `the image of scene ${plan.index}`);
      still.catch(() => {}); // awaited when the scene shows; avoid an unhandled rejection before that
      return { plan, still };
    }
    if (plan.kind === 'motion') {
      const scene = this.motion.project.scenes[plan.index];
      const span = this.motion.spans.find((candidate) => candidate.sceneIndex === plan.index);
      const duration = scene?.type === 'motion' ? scene.duration : 0;
      const request = { key: `scene:${plan.index}`, kind: 'scene' as const, index: plan.index, start: span?.start ?? 0, duration, screen: this.screenSize };
      return { plan, motion: new MotionSource(request) };
    }
    return { plan };
  }

  /** Frames for every layer of `state`, which is output frame `frame`. */
  async sourcesFor(frame: number, state: RenderState): Promise<FrameSources> {
    const opened = new Set<number>();
    while (this.pending.length > 0 && this.pending[0]!.firstFrame <= frame + this.lookahead) {
      const plan = this.pending.shift()!;
      this.open.set(plan.index, this.openScene(plan));
      if (plan.kind === 'motion') opened.add(plan.firstFrame);
    }
    while (this.pendingOverlays.length > 0 && this.pendingOverlays[0]!.firstFrame <= frame + this.lookahead) {
      const plan = this.pendingOverlays.shift()!;
      const request = { key: `overlay:${plan.key}`, kind: 'overlay' as const, index: plan.index, start: plan.start, duration: plan.duration, screen: this.screenSize };
      this.overlays.set(plan.key, { plan, source: new MotionSource(request) });
      opened.add(plan.firstFrame);
    }
    // a motion item's page opens and draws its first frame while the frames before it are made
    for (const first of opened) if (first > frame) this.askAhead(first);
    const { screens, webcams, stills, motion, overlays, transitions } = this.sources;
    screens.clear();
    webcams.clear();
    stills.clear();
    motion.clear();
    overlays.clear();
    transitions!.clear();
    for (const layer of state.layers) {
      // decoders are opened per scene (`plan.index`), frames are handed over per layer
      const scene = this.open.get(layer.sceneIndex);
      if (!scene) throw new Error(`scene ${layer.sceneIndex} shows on frame ${frame}, outside its planned frames`);
      if (layer.sourceTime !== undefined && scene.screen) {
        const screenFrame = await scene.screen.frameAt(this.screenTime(layer.sourceTime));
        if (!screenFrame) {
          throw new PageError(
            'invalid-media',
            `the screen recording has no frame at ${layer.sourceTime.toFixed(3)} s (scenes[${layer.sceneIndex}]); the file may be cut off, end the scene earlier`,
          );
        }
        screens.set(layer.index, screenFrame);
        const webcamTime = this.webcamTime(layer.sourceTime);
        const webcamFrame = webcamTime === undefined ? undefined : await scene.webcam?.frameAt(webcamTime);
        if (webcamFrame) webcams.set(layer.index, webcamFrame);
      } else if (scene.still) {
        stills.set(layer.index, await scene.still);
      }
    }
    for (const need of motionNeeds(this.motion.project, this.motion.spans, state, this.screenSize)) {
      const source = this.sourceOf(need);
      if (!source) throw new Error(`${need.request.kind === 'scene' ? 'scenes' : 'overlays'}[${need.request.index}] shows on frame ${frame}, outside its planned frames`);
      const pixels = await source.frame(need.request.frame, need.request.view);
      if (need.target.kind === 'scene') motion.set(need.target.layer, pixels);
      else overlays.set(need.target.key, pixels);
    }
    // the pages draw the next frame while this one is drawn and encoded
    if (this.motion.ahead && frame < this.lastFrame) this.askAhead(frame + 1);
    return this.sources;
  }

  /**
   * The frame of the transition page that draws `state` (none without one), drawn in the main
   * process from the two layers, which `layers` reads from the renderer; a transition page that no
   * longer shows closes.
   */
  async transition(state: RenderState, layers: () => [MotionPixels, MotionPixels]): Promise<void> {
    const active = state.transition;
    for (const key of this.transitions) {
      if (key === active?.key) continue;
      this.transitions.delete(key);
      host().motionDone(key);
    }
    if (!active) return;
    const [from, to] = layers();
    this.transitions.add(active.key);
    const request: MotionFrameRequest = {
      key: active.key,
      kind: 'transition',
      index: active.sceneIndex,
      frame: Math.round(active.local * this.motion.project.output.fps),
      start: active.start,
      duration: active.duration,
      screen: this.screenSize,
      between: { from, to },
    };
    const pixels = await host()
      .motionFrame(request)
      .catch((error: unknown) => {
        throw new PageError('render', remoteMessage(error));
      });
    this.sources.transitions!.set(active.key, pixels);
  }

  /** Closes the scenes whose last frame was `frame`. */
  async release(frame: number): Promise<void> {
    for (const [index, scene] of this.open) {
      if (scene.plan.lastFrame > frame) continue;
      this.open.delete(index);
      await closeScene(scene);
    }
    for (const [key, overlay] of this.overlays) {
      if (overlay.plan.lastFrame > frame) continue;
      this.overlays.delete(key);
      overlay.source.done();
    }
  }

  async close(): Promise<void> {
    const scenes = [...this.open.values()];
    this.open.clear();
    for (const overlay of this.overlays.values()) overlay.source.done();
    this.overlays.clear();
    for (const key of this.transitions) host().motionDone(key);
    this.transitions.clear();
    await Promise.allSettled(scenes.map(closeScene));
  }
}

async function closeScene(scene: OpenScene): Promise<void> {
  await scene.screen?.close();
  await scene.webcam?.close();
  if (scene.still) (await scene.still.catch(() => undefined))?.close();
  scene.motion?.done();
}
