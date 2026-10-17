// The editor's output view: the export's engine drawing the export's timeline into a canvas, played
// with the mic as the clock (video follows the audio and drops frames rather than drifting) and
// scrubbed one frame at a time.
import { createRenderer, type EngineAssets, type FrameSources, type Renderer } from '@cuttle/engine';
import { planStills } from '@cuttle/export/frame-plan';
import type { CuttleProject } from '@cuttle/project';
import { createTimeline, type RenderState, type Timeline } from '@cuttle/timeline';
import { AudioSchedule } from './audio';
import { FrameGrabber, KeyFrames, PlaybackFrames, type HeldFrame, type PlaybackVideo } from './frames';
import type { EditorMedia, VideoSource } from './media';

export interface PlayerState {
  /** Output seconds of the frame on screen. */
  t: number;
  playing: boolean;
  /** The source second of the most visible clip, when one shows. */
  source?: number;
  /** Set when a frame could not be drawn, said for people. */
  error?: string;
}

/** Frames the playback decoders open before a scene shows. */
const LOOKAHEAD_FRAMES = 20;
/** Playback this far behind the clock restarts its decoders at the clock (frames are dropped). */
const BEHIND_SECONDS = 0.5;

/** What playback did, for the check: frames drawn, decoder restarts at the clock (frames dropped), the clock. */
export interface PlaybackStats {
  drawn: number;
  restarts: number;
  /** The clock's output time (where the sound is), while playing. */
  clock: number;
}

export interface PlayerOptions {
  canvas: HTMLCanvasElement;
  media: EditorMedia;
  assets: EngineAssets;
  /** The project as shown (the editor may preview another output format than the file's). */
  project: CuttleProject;
  onChange: (state: PlayerState) => void;
}

export class Player {
  private project: CuttleProject;
  private timeline: Timeline;
  private renderer: Renderer;
  private readonly media: EditorMedia;
  private readonly canvas: HTMLCanvasElement;
  private readonly assets: EngineAssets;
  private readonly onChange: (state: PlayerState) => void;
  private state: PlayerState = { t: 0, playing: false };
  private screen: VideoSource;
  private keyFrames: KeyFrames | undefined;
  private screenGrabber: FrameGrabber;
  private readonly webcamGrabber: FrameGrabber | undefined;
  private seekToken = 0;
  private playToken = 0;
  private context: AudioContext | undefined;
  private audio: AudioSchedule | undefined;
  private disposed = false;
  private readonly playback: PlaybackStats = { drawn: 0, restarts: 0, clock: 0 };
  private clockNow: (() => number) | undefined;

  constructor(options: PlayerOptions) {
    this.media = options.media;
    this.canvas = options.canvas;
    this.assets = options.assets;
    this.onChange = options.onChange;
    this.project = options.project;
    this.screen = this.media.screen;
    this.screenGrabber = new FrameGrabber(this.screen);
    this.webcamGrabber = this.media.webcam ? new FrameGrabber(this.media.webcam) : undefined;
    this.timeline = this.makeTimeline();
    this.renderer = this.makeRenderer();
  }

  get duration(): number {
    return this.timeline.duration;
  }

  get fps(): number {
    return this.project.output.fps;
  }

  get spans() {
    return this.timeline.spans;
  }

  current(): PlayerState {
    return this.state;
  }

  /** Playback counters since the last play, and the clock's time while playing. */
  stats(): PlaybackStats {
    return { ...this.playback, clock: this.clockNow?.() ?? this.state.t };
  }

  private makeTimeline(): Timeline {
    return createTimeline(this.project, { screenSize: this.media.screen.size, ...(this.media.cursor && { cursor: this.media.cursor }) });
  }

  private makeRenderer(): Renderer {
    return createRenderer(this.canvas, this.project, {
      assets: this.assets,
      screenSize: this.media.screen.size,
      ...(this.media.backgroundImage && { backgroundImage: this.media.backgroundImage }),
    });
  }

  private set(change: Partial<PlayerState>): void {
    this.state = { ...this.state, ...change };
    this.onChange(this.state);
  }

  /** Shows another version of the project (another output format); keeps the playhead. */
  setProject(project: CuttleProject): void {
    const playing = this.state.playing;
    this.pause();
    this.renderer.dispose();
    this.project = project;
    this.timeline = this.makeTimeline();
    this.renderer = this.makeRenderer();
    void this.seek(Math.min(this.state.t, this.timeline.duration));
    if (playing) this.play();
  }

  /**
   * Plays and scrubs the proxy (720p, a key frame every 0.5 s) instead of the take. The engine
   * places the frame by the take's size, so a smaller frame shows the same picture.
   */
  useProxy(proxy: VideoSource): void {
    const playing = this.state.playing;
    this.pause();
    this.screen = proxy;
    this.keyFrames = new KeyFrames(proxy);
    this.screenGrabber = new FrameGrabber(proxy);
    if (playing) this.play();
    else void this.seek(this.state.t);
  }

  /** The output frame number of a time. */
  frameOf(t: number): number {
    return Math.max(0, Math.min(Math.floor(t * this.fps + 1e-6), Math.ceil(this.duration * this.fps - 1e-6) - 1));
  }

  private sourceOf(state: RenderState): number | undefined {
    const most = Math.max(...state.layers.map((layer) => layer.opacity));
    return state.layers.filter((layer) => layer.opacity >= most - 1e-9).at(-1)?.sourceTime;
  }

  private draw(state: RenderState, sources: FrameSources): boolean {
    try {
      this.renderer.render(state, sources);
      return true;
    } catch (error) {
      this.set({ error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  /** Shows the frame at output time `t` (paused); a newer seek wins over one still decoding. */
  async seek(t: number): Promise<void> {
    if (this.disposed) return;
    if (this.state.playing) this.pause();
    const token = ++this.seekToken;
    const time = Math.max(0, Math.min(t, this.duration));
    const frame = this.frameOf(time);
    const state = this.timeline.frameAt(frame / this.fps);
    const held: HeldFrame[] = [];
    const sources: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map() };
    try {
      for (const layer of state.layers) {
        if (layer.kind === 'still') {
          const image = this.media.stills.get(layer.index);
          if (image) sources.stills.set(layer.index, image);
          continue;
        }
        if (layer.kind !== 'clip' || layer.sourceTime === undefined) continue;
        const screen = await this.screenGrabber.grab(layer.sourceTime);
        if (!screen || token !== this.seekToken) {
          screen?.close();
          return;
        }
        held.push(screen);
        sources.screens.set(layer.index, screen.frame);
        const webcam = this.media.webcam;
        if (webcam && this.webcamGrabber) {
          const webcamTime = layer.sourceTime - webcam.offset;
          if (webcamTime >= webcam.start && webcamTime < webcam.end) {
            const frameOfWebcam = await this.webcamGrabber.grab(webcamTime);
            if (token !== this.seekToken) {
              frameOfWebcam?.close();
              return;
            }
            if (frameOfWebcam) {
              held.push(frameOfWebcam);
              sources.webcams.set(layer.index, frameOfWebcam.frame);
            }
          }
        }
      }
      if (token !== this.seekToken || this.disposed) return;
      if (this.draw(state, sources)) this.set({ t: time, source: this.sourceOf(state), error: undefined });
    } finally {
      for (const frame of held) frame.close();
    }
  }

  /** Plays from the playhead (from the start when it is at the end). */
  play(): void {
    if (this.disposed || this.state.playing) return;
    const from = this.state.t >= this.duration - 1 / this.fps ? 0 : this.state.t;
    this.seekToken++;
    const token = ++this.playToken;
    this.context ??= new AudioContext({ latencyHint: 'playback' });
    void this.context.resume();
    this.set({ playing: true, t: from });
    void this.run(token, from);
  }

  pause(): void {
    if (!this.state.playing) return;
    this.playToken++;
    this.audio?.stop();
    this.audio = undefined;
    this.set({ playing: false });
  }

  toggle(): void {
    if (this.state.playing) this.pause();
    else this.play();
  }

  /** One playback run from output time `from` until the end, a pause or a restart. */
  private async run(token: number, from: number): Promise<void> {
    const context = this.context!;
    const fps = this.fps;
    const last = this.frameOf(this.duration);
    let startFrame = this.frameOf(from);
    // The clock: output time = from + (context time − contextStart).
    const contextStart = context.currentTime + 0.12;
    const clock = () => from + Math.max(0, context.currentTime - contextStart);
    this.clockNow = clock;
    this.playback.drawn = 0;
    this.playback.restarts = 0;
    if (this.media.mic) this.audio = new AudioSchedule(context, this.media.mic, this.project, this.timeline.spans, from, contextStart);

    const video: PlaybackVideo = {
      screen: this.screen,
      ...(this.keyFrames && { keyFrames: this.keyFrames }),
      ...(this.media.webcam && { webcam: this.media.webcam }),
    };
    const speedOf = (index: number) => {
      const scene = this.timeline.spans[index]?.scene;
      return scene?.type === 'clip' ? scene.speed : 1;
    };
    const open = (frame: number) => {
      const frames = Array.from({ length: last - frame + 1 }, (_, i) => frame + i);
      return new PlaybackFrames(planStills(this.timeline, fps, frames), video, this.media.stills, LOOKAHEAD_FRAMES);
    };
    let frames = open(startFrame);
    let shown = startFrame - 1;
    try {
      while (token === this.playToken && !this.disposed) {
        const now = clock();
        if (now >= this.duration) break;
        const wanted = this.frameOf(now);
        if (wanted - shown > BEHIND_SECONDS * fps) {
          // Decoding fell behind: drop the frames in between and start again at the clock.
          await frames.close();
          this.playback.restarts++;
          startFrame = wanted;
          frames = open(startFrame);
          shown = wanted - 1;
        }
        if (wanted > shown) {
          const frame = Math.max(wanted, shown + 1);
          const state = this.timeline.frameAt(frame / fps);
          const sources = await frames.sourcesFor(frame, state, speedOf);
          if (token !== this.playToken || this.disposed) break;
          if (sources && this.draw(state, sources)) {
            this.playback.drawn++;
            this.set({ t: frame / fps, source: this.sourceOf(state) });
          }
          shown = frame;
          await frames.release(frame);
        }
        await nextTick();
      }
    } finally {
      await frames.close();
      if (token === this.playToken) {
        this.clockNow = undefined;
        this.audio?.stop();
        this.audio = undefined;
        this.set({ playing: false, t: Math.min(this.state.t, this.duration) });
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.pause();
    this.renderer.dispose();
    void this.context?.close();
  }
}

/**
 * The next animation frame, or a timer a little longer than a frame, whichever comes first: a window
 * that is hidden, or never shown (the check), may count as visible and still get no animation frames.
 */
function nextTick(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 20);
    requestAnimationFrame(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
