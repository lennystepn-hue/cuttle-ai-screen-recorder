import type { FrameSources } from '@cuttle/engine';
import type { RenderState } from '@cuttle/timeline';
import type { FramePlan, ScenePlan } from '../frame-plan';
import { PageError } from './host';
import { loadImage } from './images';
import type { VideoFile } from './media';
import { TrackReader } from './track-reader';

export interface SceneMedia {
  screen: VideoFile;
  /** `offset`: seconds the webcam started after the screen; webcam time = source time − offset. */
  webcam?: VideoFile & { offset: number };
  /** Scene index → image path of a still scene. */
  stills: Readonly<Record<number, string>>;
  maxTextureSize: number;
}

interface OpenScene {
  plan: ScenePlan;
  screen?: TrackReader;
  webcam?: TrackReader;
  still?: Promise<ImageBitmap>;
}

/**
 * Opens each scene's decoders (or its still image) `lookahead` frames before it first shows, so
 * decoding runs ahead in the background, and closes them after its last frame. Hands the renderer
 * the frames for every visible layer.
 */
export class SceneSources {
  private readonly open = new Map<number, OpenScene>();
  private readonly pending: ScenePlan[];
  private readonly sources: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map() };

  constructor(
    plan: FramePlan,
    private readonly media: SceneMedia,
    private readonly lookahead: number,
  ) {
    this.pending = [...plan.scenes];
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
    return { plan };
  }

  /** Frames for every layer of `state`, which is output frame `frame`. */
  async sourcesFor(frame: number, state: RenderState): Promise<FrameSources> {
    while (this.pending.length > 0 && this.pending[0]!.firstFrame <= frame + this.lookahead) {
      const plan = this.pending.shift()!;
      this.open.set(plan.index, this.openScene(plan));
    }
    const { screens, webcams, stills } = this.sources;
    screens.clear();
    webcams.clear();
    stills.clear();
    for (const layer of state.layers) {
      const scene = this.open.get(layer.index);
      if (!scene) throw new Error(`scene ${layer.index} shows on frame ${frame}, outside its planned frames`);
      if (layer.sourceTime !== undefined && scene.screen) {
        const screenFrame = await scene.screen.frameAt(this.screenTime(layer.sourceTime));
        if (!screenFrame) {
          throw new PageError(
            'invalid-media',
            `the screen recording has no frame at ${layer.sourceTime.toFixed(3)} s (scenes[${layer.index}]); the file may be cut off, end the scene earlier`,
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
    return this.sources;
  }

  /** Closes the scenes whose last frame was `frame`. */
  async release(frame: number): Promise<void> {
    for (const [index, scene] of this.open) {
      if (scene.plan.lastFrame > frame) continue;
      this.open.delete(index);
      await closeScene(scene);
    }
  }

  async close(): Promise<void> {
    const scenes = [...this.open.values()];
    this.open.clear();
    await Promise.allSettled(scenes.map(closeScene));
  }
}

async function closeScene(scene: OpenScene): Promise<void> {
  await scene.screen?.close();
  await scene.webcam?.close();
  if (scene.still) (await scene.still.catch(() => undefined))?.close();
}
