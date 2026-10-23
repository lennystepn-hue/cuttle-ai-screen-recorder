// Frames of the screen and webcam tracks for the player: single frames for scrubbing (the latest
// request wins) and decoders running ahead of the playhead for playback.
import { EncodedPacketSink, VideoSampleSink } from 'mediabunny';
import { TrackReader } from '@cuttle/export/track-reader';
import type { FramePlan, ScenePlan } from '@cuttle/export/frame-plan';
import type { FrameSources } from '@cuttle/engine';
import type { RenderState } from '@cuttle/timeline';
import type { VideoSource } from './media';

/** Above this speed, playback from the proxy shows its key frames only (every 0.5 s of the take). */
export const KEYFRAMES_ONLY_ABOVE = 6;

/** A frame for the engine, closed after it was drawn. */
export interface HeldFrame {
  frame: VideoFrame;
  close(): void;
}

/**
 * One frame at a time from a video, for scrubbing: while one decode runs, newer requests replace
 * each other, and only the newest is decoded next; older callers get `undefined`. A decode error
 * rejects the newest request (an older one's is not news: the newer request decodes next).
 */
export class FrameGrabber {
  private readonly sink: VideoSampleSink;
  private running: Promise<void> | undefined;
  private queued: { time: number; resolve: (frame: HeldFrame | undefined) => void; reject: (error: unknown) => void } | undefined;

  constructor(readonly source: VideoSource) {
    this.sink = new VideoSampleSink(source.track, source.decoder);
  }

  grab(time: number): Promise<HeldFrame | undefined> {
    return new Promise((resolve, reject) => {
      this.queued?.resolve(undefined);
      this.queued = { time, resolve, reject };
      if (!this.running) this.running = this.drain();
    });
  }

  private async drain(): Promise<void> {
    while (this.queued) {
      const { time, resolve, reject } = this.queued;
      this.queued = undefined;
      let frame: VideoFrame | undefined;
      try {
        const sample = await this.sink.getSample(Math.max(time, this.source.start));
        if (sample) {
          try {
            frame = sample.toVideoFrame();
          } finally {
            sample.close();
          }
        }
      } catch (error) {
        if (this.queued) resolve(undefined);
        else reject(error);
        continue;
      }
      if (!frame) resolve(undefined);
      // A newer request came in while this one decoded: hand it nothing, the newer one draws.
      else if (this.queued) {
        frame.close();
        resolve(undefined);
      } else {
        const held = frame;
        resolve({ frame: held, close: () => held.close() });
      }
    }
    this.running = undefined;
  }
}

/** The key frames of a video (the proxy has one every 0.5 s), looked up from its sample table. */
export class KeyFrames {
  private readonly sink: EncodedPacketSink;
  private readonly cache = new Map<number, number>();

  constructor(private readonly source: VideoSource) {
    this.sink = new EncodedPacketSink(source.track);
  }

  /** The timestamp of the key frame at or before `time`. */
  async at(time: number): Promise<number> {
    const key = Math.round(time * 1000);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const packet = await this.sink.getKeyPacket(Math.max(time, this.source.start), { metadataOnly: true });
    const found = packet ? packet.timestamp : time;
    this.cache.set(key, found);
    return found;
  }
}

export interface PlaybackVideo {
  /** None without a take: no clip shows one. */
  screen?: VideoSource;
  /** The proxy's key frames, when the screen is the proxy: speeds above 6× show only those. */
  keyFrames?: KeyFrames;
  webcam?: VideoSource & { offset: number };
}

interface OpenScene {
  plan: ScenePlan;
  screen?: TrackReader;
  webcam?: TrackReader;
  /** Planned source time → the screen time to read (a key frame above 6×). */
  screenTimes?: Map<number, number>;
}

/**
 * Decoders for playing from a frame on, as the export runs them: each scene's readers open
 * `lookahead` frames before it shows and decode its planned times in the background; they close
 * after its last frame.
 */
export class PlaybackFrames {
  private readonly open = new Map<number, OpenScene>();
  private readonly pending: ScenePlan[];
  private readonly sources: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map(), motion: new Map(), overlays: new Map() };

  constructor(
    plan: FramePlan,
    private readonly video: PlaybackVideo,
    private readonly stills: ReadonlyMap<number, ImageBitmap>,
    private readonly lookahead: number,
  ) {
    this.pending = [...plan.scenes].sort((a, b) => a.firstFrame - b.firstFrame);
  }

  private webcamTime(sourceTime: number): number | undefined {
    const webcam = this.video.webcam;
    if (!webcam) return undefined;
    const time = sourceTime - webcam.offset;
    return time >= webcam.start && time < webcam.end ? time : undefined;
  }

  private async openScene(plan: ScenePlan, speed: number): Promise<OpenScene> {
    const { screen, keyFrames, webcam } = this.video;
    if (plan.kind !== 'clip' || !screen) return { plan };
    const screenTimes = new Map<number, number>();
    for (const time of plan.sourceTimes) {
      const clamped = Math.max(time, screen.start);
      screenTimes.set(time, keyFrames && speed > KEYFRAMES_ONLY_ABOVE ? await keyFrames.at(clamped) : clamped);
    }
    const times = [...new Set(screenTimes.values())].sort((a, b) => a - b);
    const webcamTimes = plan.sourceTimes.map((t) => this.webcamTime(t)).filter((t): t is number => t !== undefined);
    return {
      plan,
      screenTimes,
      screen: new TrackReader(screen.track, times, screen.decoder),
      webcam: webcam && webcamTimes.length > 0 ? new TrackReader(webcam.track, webcamTimes, webcam.decoder) : undefined,
    };
  }

  /** The frames of every layer of `state`, output frame `frame`; `speedOf` gives a scene's speed. */
  async sourcesFor(frame: number, state: RenderState, speedOf: (index: number) => number): Promise<FrameSources | undefined> {
    while (this.pending.length > 0 && this.pending[0]!.firstFrame <= frame + this.lookahead) {
      const plan = this.pending.shift()!;
      this.open.set(plan.index, await this.openScene(plan, speedOf(plan.index)));
    }
    const { screens, webcams, stills } = this.sources;
    screens.clear();
    webcams.clear();
    stills.clear();
    for (const layer of state.layers) {
      if (layer.kind === 'still') {
        const image = this.stills.get(layer.index);
        if (!image) return undefined;
        stills.set(layer.index, image);
        continue;
      }
      // a clip without a take (cuttle.json edited by hand) shows nothing of it
      if (layer.kind !== 'clip' || layer.sourceTime === undefined || !this.video.screen) continue;
      // decoders are opened per scene (`plan.index`), frames are handed over per layer
      const scene = this.open.get(layer.sceneIndex);
      const time = scene?.screenTimes?.get(layer.sourceTime);
      if (!scene?.screen || time === undefined) return undefined;
      const screenFrame = await scene.screen.frameAt(time);
      if (!screenFrame) return undefined;
      screens.set(layer.index, screenFrame);
      const webcamTime = this.webcamTime(layer.sourceTime);
      const webcamFrame = webcamTime === undefined ? undefined : await scene.webcam?.frameAt(webcamTime);
      if (webcamFrame) webcams.set(layer.index, webcamFrame);
    }
    return this.sources;
  }

  /** Closes the scenes whose last frame was `frame` or earlier. */
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
    this.pending.length = 0;
    await Promise.allSettled(scenes.map(closeScene));
  }
}

async function closeScene(scene: OpenScene): Promise<void> {
  await scene.screen?.close();
  await scene.webcam?.close();
}
