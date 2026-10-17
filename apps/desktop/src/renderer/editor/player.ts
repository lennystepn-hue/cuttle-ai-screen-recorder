// The editor's output view: the export's engine drawing the export's timeline into a canvas, played
// with the mic as the clock (video follows the audio and drops frames rather than drifting) and
// scrubbed one frame at a time.
import { createRenderer, type DrawnText, type EngineAssets, type FrameSources, type Renderer } from '@cuttle/engine';
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
  /** The video's length in output seconds, as the timeline the player shows has it. */
  duration?: number;
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
  private webcamGrabber: FrameGrabber | undefined;
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

  /** How many clips show at output time `t` (more than one inside a crossfade). */
  clipsAt(t: number): number {
    return this.timeline.frameAt(Math.max(0, Math.min(t, this.duration - 1e-6))).layers.filter((layer) => layer.kind === 'clip').length;
  }

  /** The video track playback and scrubbing read now (the proxy once it is made), for the source view. */
  get screenSource(): VideoSource {
    return this.screen;
  }

  /** The captions the frame on the canvas shows, with their boxes in output pixels (to click one on the video). */
  drawnTexts(): readonly DrawnText[] {
    return this.renderer.drawnTexts();
  }

  current(): PlayerState {
    return this.state;
  }

  /** Playback counters since the last play, and the clock's time while playing. */
  stats(): PlaybackStats {
    return { ...this.playback, clock: this.clockNow?.() ?? this.state.t };
  }

  private makeTimeline(): Timeline {
    return createTimeline(this.project, {
      screenSize: this.media.screen.size,
      ...(this.media.cursor && { cursor: this.media.cursor }),
      ...(this.media.transcript && { transcript: this.media.transcript.words }),
    });
  }

  private makeRenderer(): Renderer {
    this.drawnBackground = this.media.backgroundImage;
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

  /**
   * Shows another version of the project (an edit, another output format) and keeps the playhead:
   * the timeline anew, the renderer only when the look, the output or an image it draws changed.
   * `media` may have gained images, the webcam or the mic for it (`ensureMedia`).
   */
  update(project: CuttleProject, options: { redrawOnly?: boolean } = {}): void {
    if (project === this.project && !options.redrawOnly) return;
    const playing = this.state.playing;
    this.pause();
    const look = (value: CuttleProject) => JSON.stringify([value.look, value.output]);
    const background = this.media.backgroundImage;
    const renew = look(project) !== look(this.project) || background !== this.drawnBackground;
    this.project = project;
    this.timeline = this.makeTimeline();
    // the title bar and the transport show the length: they learn it changed with the state
    this.set({ duration: this.timeline.duration });
    if (renew) {
      this.renderer.dispose();
      this.renderer = this.makeRenderer();
    } else this.renderer.setScenes(project.scenes);
    if (this.media.webcam && !this.webcamGrabber) this.webcamGrabber = new FrameGrabber(this.media.webcam);
    void this.seek(Math.min(this.state.t, this.timeline.duration));
    if (playing) this.play();
  }

  /** The background image the renderer was made with. */
  private drawnBackground: ImageBitmap | undefined;

  /** The still images of the timeline's scenes, by scene index (`media` keeps them by path). */
  private stillsByIndex(): Map<number, ImageBitmap> {
    const stills = new Map<number, ImageBitmap>();
    this.timeline.spans.forEach((span, index) => {
      if (span.scene.type !== 'still') return;
      const image = this.media.stills.get(span.scene.image);
      if (image) stills.set(index, image);
    });
    return stills;
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
    const stills = this.stillsByIndex();
    try {
      for (const layer of state.layers) {
        if (layer.kind === 'still') {
          const image = stills.get(layer.index);
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
    } catch (error) {
      if (token === this.seekToken && !this.disposed) this.set({ t: time, error: frameError(error) });
    } finally {
      for (const frame of held) frame.close();
    }
  }

  /** Plays from the playhead (from the start when it is at the end). */
  play(): void {
    if (this.disposed || this.state.playing || !(this.duration > 0)) return;
    const from = this.state.t >= this.duration - 1 / this.fps ? 0 : this.state.t;
    this.seekToken++;
    const token = ++this.playToken;
    this.context ??= new AudioContext({ latencyHint: 'playback' });
    void this.context.resume();
    this.set({ playing: true, t: from, error: undefined });
    void this.run(token, from);
  }

  pause(): void {
    if (!this.state.playing) return;
    this.playToken++;
    this.audio?.stop();
    this.audio = undefined;
    // A running context keeps the audio device busy (and the laptop awake) for nothing.
    void this.context?.suspend();
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
    // The clock: output time = from + (the context time being heard − contextStart).
    const contextStart = context.currentTime + 0.12;
    const clock = () => from + Math.max(0, heardTime(context) - contextStart);
    this.clockNow = clock;
    this.playback.drawn = 0;
    this.playback.restarts = 0;

    const video: PlaybackVideo = {
      screen: this.screen,
      ...(this.keyFrames && { keyFrames: this.keyFrames }),
      ...(this.media.webcam && { webcam: this.media.webcam }),
    };
    const speedOf = (sceneIndex: number) => {
      const scene = this.timeline.spans.find((span) => span.sceneIndex === sceneIndex)?.scene;
      return scene?.type === 'clip' ? scene.speed : 1;
    };
    const open = (frame: number) => {
      const frames = Array.from({ length: last - frame + 1 }, (_, i) => frame + i);
      return new PlaybackFrames(planStills(this.timeline, fps, frames), video, this.stillsByIndex(), LOOKAHEAD_FRAMES);
    };
    let frames: PlaybackFrames | undefined;
    let shown = startFrame - 1;
    try {
      if (this.media.mic) this.audio = new AudioSchedule(context, this.media.mic, this.project, this.timeline.spans, from, contextStart);
      frames = open(startFrame);
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
    } catch (error) {
      if (token === this.playToken && !this.disposed) this.set({ error: frameError(error) });
    } finally {
      await frames?.close();
      if (token === this.playToken) {
        this.clockNow = undefined;
        this.audio?.stop();
        this.audio = undefined;
        void context.suspend();
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

/** A frame that could not be decoded or drawn, said for people. */
function frameError(error: unknown): string {
  return `This part of the video cannot be shown: ${error instanceof Error ? error.message : String(error)}`;
}

/**
 * The AudioContext time the speakers play now. The context renders ahead of what is heard by its
 * output latency (60–80 ms here, 150–250 ms over Bluetooth), so the picture follows this, not
 * `currentTime`. The output timestamp is taken once per rendered block; it is moved on by the time
 * since, at most 0.1 s (more means the sound stalled, and the picture waits for it).
 */
function heardTime(context: AudioContext): number {
  if (context.state === 'running') {
    const { contextTime, performanceTime } = context.getOutputTimestamp();
    if (contextTime !== undefined && performanceTime !== undefined && performanceTime > 0) {
      return contextTime + Math.min(0.1, Math.max(0, (performance.now() - performanceTime) / 1000));
    }
  }
  return context.currentTime - context.baseLatency - (context.outputLatency || 0);
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
