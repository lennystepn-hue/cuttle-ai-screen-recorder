// The editor's output view: the export's engine drawing the export's timeline into a canvas, played
// with the mic as the clock (video follows the audio and drops frames rather than drifting) and
// scrubbed one frame at a time.
import { createRenderer, type DrawnText, type EngineAssets, type FrameSources, type Renderer } from '@cuttle/engine';
import { planStills } from '@cuttle/export/frame-plan';
import { voiceLineKey, type CuttleProject } from '@cuttle/project';
import { translatedWords, createTimeline, crossfadeHalf, narrationCues, narrationWords, pageTransition, sceneSpans, type CaptionWord, type RenderState, type Timeline } from '@cuttle/timeline';
import { speechSpans } from '@cuttle/export/music-duck';
import { AudioSchedule, NarrationSchedule, systemLevel } from './audio';
import { TypingSchedule } from './typing-audio';
import { FrameGrabber, KeyFrames, PlaybackFrames, type HeldFrame, type PlaybackVideo } from './frames';
import { watermarkFile, type EditorMedia, type VideoSource } from './media';
import { MotionFrames } from './motion';
import { SoundtrackSchedule, type Soundtrack } from './soundtrack';

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
/** A pause this long after a seek before the transitions' frames are made for playing (ms): scrubbing goes first. */
const WARM_DELAY_MS = 400;
/** The sizes motion frames are drawn at, as parts of the output: the smallest that fills the player on screen. */
const MOTION_SCALES = [1 / 4, 1 / 3, 3 / 8, 1 / 2, 2 / 3, 3 / 4, 1];

/** What playback did, for the check: frames drawn, decoder restarts at the clock (frames dropped), typing clicks scheduled, the clock. */
export interface PlaybackStats {
  drawn: number;
  /** Frames drawn by a transition's page (made while paused), not crossfaded. */
  transitions: number;
  restarts: number;
  clicks: number;
  /** The clock's output time (where the sound is), while playing. */
  clock: number;
  /** Motion frames that came while playing, how long one took (ms, a running mean), and the transition frames made. */
  motion?: { frames: number; took: number; made: number };
  /** The soundtrack's buffers started in this run (music and effects; again after a new render came). */
  soundtrack?: number;
}

export interface PlayerOptions {
  canvas: HTMLCanvasElement;
  media: EditorMedia;
  assets: EngineAssets;
  /** The project as shown (the editor may preview another output format than the file's). */
  project: CuttleProject;
  onChange: (state: PlayerState) => void;
  /** Motion frames at the output's size, whatever the player's on screen (the check compares them with the export's). */
  fullSizeMotion?: boolean;
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
  /**
   * Where the seek under way goes (output seconds, as asked): a new version of the project that comes
   * meanwhile shows that time, not the one still on screen (an item added, then the playhead moved to it).
   */
  private seeking: number | undefined;
  private playToken = 0;
  private context: AudioContext | undefined;
  private audio: AudioSchedule | undefined;
  /** The narration's lines while playing. */
  private narration: NarrationSchedule | undefined;
  /** The computer's sound while playing, and its level (its volume and the duck under speech). */
  private system: { schedule: AudioSchedule; level: GainNode } | undefined;
  /** The typing sounds while playing (also without a mic). */
  private typing: TypingSchedule | undefined;
  /** The music and sounds rendered for the project, and their playback while playing. */
  private soundtrack: Soundtrack | undefined;
  private sound: SoundtrackSchedule | undefined;
  private soundStarts = 0;
  /** The run under way: output time `from` plays at context time `contextStart`. */
  private runMap: { from: number; contextStart: number } | undefined;
  private disposed = false;
  private readonly playback: PlaybackStats = { drawn: 0, transitions: 0, restarts: 0, clicks: 0, clock: 0 };
  private clockNow: (() => number) | undefined;
  private readonly motion: MotionFrames;
  private readonly fullSizeMotion: boolean;
  /** The frames of the seek on screen, kept while its motion frames come (it is drawn again with them). */
  private parked: HeldFrame[] = [];

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
    this.fullSizeMotion = options.fullSizeMotion ?? false;
    this.motion = new MotionFrames(this.project, this.media.screen.size, () => this.motionSize());
  }

  /** The size motion frames are drawn at: the output's part that fills the player on screen. */
  private motionSize(): { width: number; height: number } {
    const { width, height } = this.project.output;
    const shown = this.canvas.clientWidth * (window.devicePixelRatio || 1);
    const scale = this.fullSizeMotion ? 1 : (MOTION_SCALES.find((part) => width * part >= shown * 0.95) ?? 1);
    return { width: Math.max(8, Math.round(width * scale)), height: Math.max(8, Math.round(height * scale)) };
  }

  /** Frames across motion scene `sceneIndex` for its block on the timeline, `height` px high (undefined: not now). */
  motionStrip(sceneIndex: number, height: number) {
    return this.motion.strip(this.timeline.spans, sceneIndex, height);
  }

  /** The project's files changed (a motion page edited): its frames are drawn anew. */
  motionFilesChanged(): void {
    this.motion.filesChanged();
    if (!this.state.playing) void this.seek(this.seeking ?? this.state.t);
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
    return {
      ...this.playback,
      clicks: this.typing?.scheduled ?? this.playback.clicks,
      clock: this.clockNow?.() ?? this.state.t,
      motion: this.motion.stats(),
      soundtrack: this.soundStarts,
    };
  }

  /** The soundtrack to play (a new render of the music comes in while playing: it takes over at once). */
  setSoundtrack(track: Soundtrack | undefined): void {
    if (track === this.soundtrack) return;
    this.soundtrack = track;
    if (!this.state.playing || !this.context || !this.runMap) return;
    this.sound?.stop();
    const contextStart = this.context.currentTime + 0.05;
    this.sound = track ? this.startSound(this.context, track, this.runMap.from + (contextStart - this.runMap.contextStart), contextStart) : undefined;
  }

  private startSound(context: AudioContext, track: Soundtrack, from: number, contextStart: number): SoundtrackSchedule {
    const schedule = new SoundtrackSchedule(context, track, this.project, from, contextStart);
    this.soundStarts += schedule.started;
    return schedule;
  }

  private makeTimeline(): Timeline {
    const narration = this.narrationWords();
    return createTimeline(this.project, {
      screenSize: this.media.screen.size,
      ...(this.media.cursor && { cursor: this.media.cursor }),
      ...(this.media.shortcuts && { shortcuts: this.media.shortcuts }),
      ...(this.media.transcript && { transcript: this.media.transcript.words }),
      ...(this.media.translation && this.project.captions.language === this.media.translation.language && { translated: translatedWords(this.media.translation.sentences) }),
      ...(narration.length > 0 && { narration }),
    });
  }

  /** The narration's spoken words where they play (output seconds), for the captions and the duck. */
  private narrationWords(): CaptionWord[] {
    const spans = sceneSpans(this.project.scenes, this.project.cuts);
    return narrationWords(narrationCues(this.project, spans).cues, (cue) => this.media.narration.get(voiceLineKey(this.project.voiceover, cue.line))?.words);
  }

  private makeRenderer(): Renderer {
    this.drawnBackground = this.media.backgroundImage;
    this.drawnWatermark = this.watermark();
    return createRenderer(this.canvas, this.project, {
      assets: this.assets,
      screenSize: this.media.screen.size,
      ...(this.media.backgroundImage && { backgroundImage: this.media.backgroundImage }),
      ...(this.drawnWatermark && { watermarkImage: this.drawnWatermark }),
    });
  }

  /** The watermark's image for this version of the project: none when it is off or shows another file. */
  private watermark(): ImageBitmap | undefined {
    const mark = watermarkFile(this.project);
    return mark && this.media.watermarkPath === mark ? this.media.watermarkImage : undefined;
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
    // the brand too: a watermark shows its logo or its name
    const look = (value: CuttleProject) => JSON.stringify([value.look, value.output, value.theme]);
    const background = this.media.backgroundImage;
    const previous = this.project;
    this.project = project;
    const renew = look(project) !== look(previous) || background !== this.drawnBackground || this.watermark() !== this.drawnWatermark;
    this.motion.setProject(project);
    this.timeline = this.makeTimeline();
    // the title bar and the transport show the length: they learn it changed with the state
    this.set({ duration: this.timeline.duration });
    if (renew) {
      this.renderer.dispose();
      this.renderer = this.makeRenderer();
    } else this.renderer.setScenes(project.scenes);
    if (this.media.webcam && !this.webcamGrabber) this.webcamGrabber = new FrameGrabber(this.media.webcam);
    void this.seek(Math.min(this.seeking ?? this.state.t, this.timeline.duration));
    if (playing) this.play();
  }

  /** The background image the renderer was made with. */
  private drawnBackground: ImageBitmap | undefined;
  /** The watermark's image the renderer was made with. */
  private drawnWatermark: ImageBitmap | undefined;

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
    else void this.seek(this.seeking ?? this.state.t);
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

  /** Closes the frames a seek kept for drawing again. */
  private unpark(): void {
    for (const frame of this.parked) frame.close();
    this.parked = [];
  }

  /**
   * Shows the frame at output time `t` (paused); a newer seek wins over one still decoding. Motion
   * shows at once with the nearest frame the player has, and the frame is drawn again once the exact
   * ones came.
   */
  async seek(t: number): Promise<void> {
    if (this.disposed) return;
    if (this.state.playing) this.pause();
    const token = ++this.seekToken;
    this.unpark();
    this.seeking = t;
    const time = Math.max(0, Math.min(t, this.duration));
    const frame = this.frameOf(time);
    const state = this.timeline.frameAt(frame / this.fps);
    let held: HeldFrame[] = [];
    try {
      const gathered = await this.gather(state, token, held);
      if (!gathered || token !== this.seekToken || this.disposed) return;
      const sources = gathered;
      const needs = this.motion.needs(this.timeline.spans, state);
      const exact = this.motion.fill(needs, sources);
      const between = this.motion.fillTransition(state, sources);
      this.seeking = undefined;
      if (this.draw(state, sources)) this.set({ t: time, source: this.sourceOf(state), error: undefined });
      if (exact && between) return void this.warm(token);
      // the exact motion frames and the transition's, then this frame again with them (its video frames are kept until then)
      this.parked = held;
      held = [];
      if (!exact) {
        const changed = await this.motion.exact(needs, sources);
        if (token !== this.seekToken || this.disposed || this.state.playing) return;
        if (changed) this.draw(state, sources);
      }
      if (!between) {
        // its page draws from the two layers as they are now (the motion frames in them exact)
        const made = await this.motion.transition(state, () => this.renderer.layerPixels(state, sources), 'seek').catch(() => undefined);
        if (token !== this.seekToken || this.disposed || this.state.playing) return;
        if (made && this.motion.fillTransition(state, sources)) this.draw(state, sources);
      }
      this.unpark();
      void this.warm(token);
    } catch (error) {
      if (token === this.seekToken && !this.disposed) {
        this.seeking = undefined;
        this.set({ t: time, error: frameError(error) });
      }
    } finally {
      for (const frame of held) frame.close();
    }
  }

  /**
   * The video and still frames of a paused frame's layers; the video frames go into `held` (the caller
   * closes them). Undefined when a newer seek came meanwhile.
   */
  private async gather(state: RenderState, token: number, held: HeldFrame[]): Promise<FrameSources | undefined> {
    const sources: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map(), motion: new Map(), overlays: new Map(), transitions: new Map() };
    const stills = this.stillsByIndex();
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
        return undefined;
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
            return undefined;
          }
          if (frameOfWebcam) {
            held.push(frameOfWebcam);
            sources.webcams.set(layer.index, frameOfWebcam.frame);
          }
        }
      }
    }
    return sources;
  }

  /** The output frames that show a transition page. */
  private transitionFrames(): number[] {
    const frames: number[] = [];
    const spans = this.timeline.spans;
    const look = this.project.look.transition;
    for (let i = 1; i < spans.length; i++) {
      const [before, into] = [spans[i - 1]!, spans[i]!];
      if (!pageTransition(before, into, look)) continue;
      const half = crossfadeHalf(before, into, look);
      for (let frame = Math.ceil((into.start - half) * this.fps - 1e-6); frame / this.fps < into.start + half - 1e-9; frame++) frames.push(frame);
    }
    return frames;
  }

  /**
   * While paused, a moment after a seek: makes the frames of the transitions for playing, one after
   * the other (a seek, a play or an edit stops it; the next seek starts it again where it is needed).
   */
  private async warm(token: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, WARM_DELAY_MS));
    for (const at of this.transitionFrames()) {
      if (token !== this.seekToken || this.state.playing || this.disposed) return;
      const state = this.timeline.frameAt(at / this.fps);
      if (this.motion.hasTransition(state)) continue;
      const held: HeldFrame[] = [];
      try {
        const sources = await this.gather(state, token, held);
        if (!sources || token !== this.seekToken || this.state.playing) return;
        const needs = this.motion.needs(this.timeline.spans, state);
        if (!this.motion.fill(needs, sources)) await this.motion.exact(needs, sources);
        if (token !== this.seekToken || this.state.playing || this.disposed) return;
        await this.motion.transition(state, () => this.renderer.layerPixels(state, sources), 'play');
      } catch {
        return; // the item's status says what went wrong
      } finally {
        for (const frame of held) frame.close();
      }
    }
  }

  /** Plays from the playhead (from the start when it is at the end). */
  play(): void {
    if (this.disposed || this.state.playing || !(this.duration > 0)) return;
    const from = this.state.t >= this.duration - 1 / this.fps ? 0 : this.state.t;
    this.seekToken++;
    this.seeking = undefined;
    this.unpark();
    const token = ++this.playToken;
    this.context ??= new AudioContext({ latencyHint: 'playback' });
    void this.context.resume();
    this.set({ playing: true, t: from, error: undefined });
    void this.run(token, from);
  }

  /** Stops the computer's sound and the narration (the mic, the typing and the soundtrack stop on their own). */
  private stopLayers(): void {
    this.system?.schedule.stop();
    this.system?.level.disconnect();
    this.system = undefined;
    this.narration?.stop();
    this.narration = undefined;
  }

  pause(): void {
    if (!this.state.playing) return;
    this.playToken++;
    this.audio?.stop();
    this.audio = undefined;
    this.stopLayers();
    this.typing?.stop();
    this.typing = undefined;
    this.sound?.stop();
    this.sound = undefined;
    this.runMap = undefined;
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
    this.playback.transitions = 0;
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
    const needsAt = (frame: number) => this.motion.needs(this.timeline.spans, this.timeline.frameAt(frame / fps));
    this.motion.startPlaying();
    try {
      if (this.media.mic) this.audio = new AudioSchedule(context, this.media.mic, this.project, this.timeline.spans, from, contextStart);
      this.narration = new NarrationSchedule(context, this.project, this.timeline.spans, (key) => this.media.narration.has(key), from, contextStart);
      if (this.media.system && this.project.look.audio.system) {
        // down under speech: the take's words and the narration's
        const speech = speechSpans(this.project, this.media.transcript?.words ?? [], this.timeline.spans, this.narrationWords());
        const level = systemLevel(context, this.project, speech, from, this.duration, contextStart);
        this.system = { schedule: new AudioSchedule(context, this.media.system, this.project, this.timeline.spans, from, contextStart, level), level };
      }
      this.typing = new TypingSchedule(context, this.project, this.timeline.spans, this.media.events, from, contextStart);
      this.runMap = { from, contextStart };
      this.soundStarts = 0;
      if (this.soundtrack) this.sound = this.startSound(context, this.soundtrack, from, contextStart);
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
          if (sources) {
            // the motion frames that have come, and the next ones asked for
            sources.motion.clear();
            sources.overlays.clear();
            this.motion.stream(this.motion.needs(this.timeline.spans, state), frame, fps, last, sources, needsAt);
          }
          // a transition plays as its page drew it while paused, else as a crossfade
          const paged = sources !== undefined && state.transition !== undefined && this.motion.fillTransition(state, sources);
          if (sources && this.draw(state, sources)) {
            this.playback.drawn++;
            if (paged) this.playback.transitions++;
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
        this.stopLayers();
        this.typing?.stop();
        this.typing = undefined;
        this.sound?.stop();
        this.sound = undefined;
        this.runMap = undefined;
        void context.suspend();
        this.set({ playing: false, t: Math.min(this.state.t, this.duration) });
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.pause();
    this.unpark();
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
