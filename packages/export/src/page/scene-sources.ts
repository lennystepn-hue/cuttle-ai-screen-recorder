import type { FrameSources } from '@cuttle/engine';
import type { Scene } from '@cuttle/project';
import type { RenderState } from '@cuttle/timeline';
import type { FramePlan, OverlayPlan, ScenePlan } from '../frame-plan';
import type { MotionFrameRequest, MotionPixels } from '../job';
import { host, PageError } from './host';
import { loadImage } from './images';
import type { VideoFile } from './media';
import { TrackReader } from './track-reader';

export interface SceneMedia {
  screen: VideoFile;
  /** `offset`: seconds the webcam started after the screen; webcam time = source time − offset. */
  webcam?: VideoFile & { offset: number };
  /** Scene index → image path of a still scene. */
  stills: Readonly<Record<number, string>>;
  /** The project's scenes (a motion scene's duration). */
  scenes: readonly Scene[];
  maxTextureSize: number;
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

/** One showing of a motion item: its frames, drawn by the main process; the first one is asked for as it opens. */
class MotionSource {
  private first: Promise<MotionPixels> | undefined;

  constructor(private readonly request: Omit<MotionFrameRequest, 'frame'>) {
    this.first = this.ask(0);
    this.first.catch(() => {}); // awaited when the item shows
  }

  private ask(frame: number): Promise<MotionPixels> {
    return host()
      .motionFrame({ ...this.request, frame })
      .catch((error: unknown) => {
        throw new PageError('render', remoteMessage(error));
      });
  }

  /** Frame `n` of the showing (n / fps seconds into it). */
  frame(n: number): Promise<MotionPixels> {
    const first = n === 0 ? this.first : undefined;
    this.first = undefined;
    return first ?? this.ask(n);
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
  private readonly fps: number;
  private readonly sources: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map(), motion: new Map(), overlays: new Map() };

  constructor(
    plan: FramePlan,
    private readonly media: SceneMedia,
    private readonly lookahead: number,
  ) {
    this.pending = [...plan.scenes];
    this.pendingOverlays = [...plan.overlays].sort((a, b) => a.firstFrame - b.firstFrame);
    this.fps = plan.fps;
  }

  private screenTime(sourceTime: number): number {
    return Math.max(sourceTime, this.media.screen.start);
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
      const scene = this.media.scenes[plan.index];
      const duration = scene?.type === 'motion' ? scene.duration : 0;
      return { plan, motion: new MotionSource({ key: `scene:${plan.index}`, kind: 'scene', index: plan.index, duration }) };
    }
    return { plan };
  }

  /** Frames for every layer of `state`, which is output frame `frame`. */
  async sourcesFor(frame: number, state: RenderState): Promise<FrameSources> {
    while (this.pending.length > 0 && this.pending[0]!.firstFrame <= frame + this.lookahead) {
      const plan = this.pending.shift()!;
      this.open.set(plan.index, this.openScene(plan));
    }
    while (this.pendingOverlays.length > 0 && this.pendingOverlays[0]!.firstFrame <= frame + this.lookahead) {
      const plan = this.pendingOverlays.shift()!;
      const source = new MotionSource({ key: `overlay:${plan.key}`, kind: 'overlay', index: plan.index, duration: plan.duration });
      this.overlays.set(plan.key, { plan, source });
    }
    const { screens, webcams, stills, motion, overlays } = this.sources;
    screens.clear();
    webcams.clear();
    stills.clear();
    motion.clear();
    overlays.clear();
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
      } else if (scene.motion) {
        motion.set(layer.index, await scene.motion.frame(Math.round(layer.local * this.fps)));
      }
      for (const overlay of layer.overlays) {
        const open = this.overlays.get(overlay.key);
        if (!open) throw new Error(`overlays[${overlay.index}] shows on frame ${frame}, outside its planned frames`);
        overlays.set(overlay.key, await open.source.frame(Math.round(overlay.local * this.fps)));
      }
    }
    return this.sources;
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
    await Promise.allSettled(scenes.map(closeScene));
  }
}

async function closeScene(scene: OpenScene): Promise<void> {
  await scene.screen?.close();
  await scene.webcam?.close();
  if (scene.still) (await scene.still.catch(() => undefined))?.close();
  scene.motion?.done();
}
