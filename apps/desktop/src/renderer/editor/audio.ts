// The take's sound in the preview (the mic, the computer's sound): decoded in chunks a few seconds
// ahead of the playhead and scheduled on the AudioContext, whose clock the video follows; and the
// narration's spoken lines, each decoded whole.
import { AudioBufferSink } from 'mediabunny';
import { duckEnvelope } from '@cuttle/export/music-duck';
import { voiceLineKey, voiceRenderFiles, type CuttleProject } from '@cuttle/project';
import { isContinuousCut, narrationCues, type SceneSpan } from '@cuttle/timeline';
import { mediaUrl, type AudioSource } from './media';

/** Audio is scheduled this far ahead of the clock. */
const AHEAD_SECONDS = 2.5;
/** Short fades at the edges of each clip's sound, against clicks. */
const EDGE_FADE = 0.008;

/** Whether the export plays a clip's sound (`look.audio`: on, and sped-up clips muted unless asked). */
export function audible(project: CuttleProject, speed: number): boolean {
  return project.look.audio.enabled && !(project.look.audio.muteSpedUp && speed > 1);
}

/**
 * Plays the clips' sound from output time `from`: each audible clip's stretch of a track of the take
 * (`mic`: the mic, or the computer's sound), at the clip's speed (the preview's pitch changes with it;
 * the export keeps the pitch with atempo), into `output`. `contextStart` is the AudioContext time at
 * which output time `from` plays.
 */
export class AudioSchedule {
  private readonly nodes = new Set<AudioScheduledSourceNode>();
  private readonly gains = new Set<GainNode>();
  private stopped = false;
  private readonly done: Promise<void>;

  constructor(
    private readonly context: AudioContext,
    private readonly mic: AudioSource,
    private readonly project: CuttleProject,
    private readonly spans: readonly SceneSpan[],
    private readonly from: number,
    private readonly contextStart: number,
    private readonly output: AudioNode = context.destination,
  ) {
    this.done = this.run().catch(() => {});
  }

  /** The AudioContext time at which output time `t` plays. */
  private when(t: number): number {
    return this.contextStart + (t - this.from);
  }

  private async waitUntil(contextTime: number): Promise<void> {
    while (!this.stopped && contextTime - this.context.currentTime > AHEAD_SECONDS) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /** Whether the sound runs on from span `a` into span `b` (a continuous cut, both heard at one speed): no fade there. */
  private runsOn(a: SceneSpan | undefined, b: SceneSpan | undefined): boolean {
    if (!a || !b || a.scene.type !== 'clip' || b.scene.type !== 'clip' || !isContinuousCut(a.scene, b.scene)) return false;
    return a.scene.speed === b.scene.speed && audible(this.project, a.scene.speed);
  }

  private async run(): Promise<void> {
    for (const [i, span] of this.spans.entries()) {
      if (this.stopped) return;
      const scene = span.scene;
      if (span.end <= this.from || scene.type !== 'clip' || !audible(this.project, scene.speed)) continue;
      const outStart = Math.max(span.start, this.from);
      await this.waitUntil(this.when(outStart));
      if (this.stopped) return;
      // Mic seconds of this clip's stretch from outStart on.
      const sourceStart = scene.from + (outStart - span.start) * scene.speed;
      const micStart = sourceStart - this.mic.offset;
      const micEnd = scene.to - this.mic.offset;
      if (micEnd <= 0) continue;
      const gain = this.context.createGain();
      gain.connect(this.output);
      this.gains.add(gain);
      const fadeIn = this.when(outStart);
      const fadeOut = this.when(span.end);
      const start = Math.max(this.context.currentTime, fadeIn);
      const fadesIn = outStart > span.start || !this.runsOn(this.spans[i - 1], span);
      gain.gain.setValueAtTime(fadesIn ? 0 : 1, start);
      if (fadesIn) gain.gain.linearRampToValueAtTime(1, start + EDGE_FADE);
      if (!this.runsOn(span, this.spans[i + 1])) {
        gain.gain.setValueAtTime(1, Math.max(start + EDGE_FADE, fadeOut - EDGE_FADE));
        gain.gain.linearRampToValueAtTime(0, fadeOut);
      }
      const sink = new AudioBufferSink(this.mic.track);
      for await (const { buffer, timestamp, duration } of sink.buffers(Math.max(0, micStart), micEnd)) {
        if (this.stopped) return;
        // This buffer's mic seconds, cut to the clip's stretch.
        const playFrom = Math.max(timestamp, micStart);
        const playTo = Math.min(timestamp + duration, micEnd);
        if (playTo <= playFrom) continue;
        const out = span.start + (playFrom + this.mic.offset - scene.from) / scene.speed;
        const at = this.when(out);
        await this.waitUntil(at);
        if (this.stopped) return;
        const node = this.context.createBufferSource();
        node.buffer = buffer;
        node.playbackRate.value = scene.speed;
        node.connect(gain);
        const now = this.context.currentTime;
        // A chunk whose start already passed plays from where the clock is.
        const late = Math.max(0, now - at) * scene.speed;
        const offset = playFrom - timestamp + late;
        const length = playTo - playFrom - late;
        if (length <= 0) continue;
        node.start(Math.max(now, at), offset, length);
        this.nodes.add(node);
        node.onended = () => {
          this.nodes.delete(node);
          node.disconnect();
        };
      }
    }
  }

  stop(): void {
    this.stopped = true;
    for (const node of this.nodes) {
      try {
        node.stop();
      } catch {
        // never started
      }
      node.disconnect();
    }
    this.nodes.clear();
    for (const gain of this.gains) gain.disconnect();
    this.gains.clear();
  }

  finished(): Promise<void> {
    return this.done;
  }
}

/** The duck's gain is set this often (seconds): its ramps last a quarter second and more. */
const DUCK_STEP = 0.05;

/**
 * The computer's sound's level from output time `from` to `end`, as the export mixes it: its volume,
 * and down under `speech` by `look.audio.systemDuck`. Connected to the destination; the caller
 * plays the track into it and disconnects it.
 */
export function systemLevel(context: AudioContext, project: CuttleProject, speech: readonly { start: number; end: number }[], from: number, end: number, contextStart: number): GainNode {
  const { systemVolume, systemDuck } = project.look.audio;
  const gain = context.createGain();
  gain.gain.value = systemVolume;
  gain.connect(context.destination);
  const start = Math.max(context.currentTime, contextStart);
  const offset = from + (start - contextStart);
  const steps = Math.ceil((end - offset) / DUCK_STEP) + 1;
  if (speech.length > 0 && systemDuck > 0 && steps > 1) {
    const envelope = duckEnvelope(speech, systemDuck);
    const curve = new Float32Array(steps);
    for (let i = 0; i < steps; i++) curve[i] = systemVolume * envelope(offset + i * DUCK_STEP);
    gain.gain.setValueCurveAtTime(curve, start, (steps - 1) * DUCK_STEP);
  }
  return gain;
}

/** The narration's sounds decoded for an AudioContext, by their key (a key's sound never changes). */
const decodedLines = new WeakMap<AudioContext, Map<string, Promise<AudioBuffer | undefined>>>();

/** A spoken line's sound as a buffer of `context`, decoded once; undefined when it cannot be read. */
function lineBuffer(context: AudioContext, key: string): Promise<AudioBuffer | undefined> {
  let byKey = decodedLines.get(context);
  if (!byKey) decodedLines.set(context, (byKey = new Map()));
  let buffer = byKey.get(key);
  if (!buffer) {
    buffer = fetch(mediaUrl(voiceRenderFiles(key).sound))
      .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then((bytes) => context.decodeAudioData(bytes))
      .catch(() => undefined);
    byKey.set(key, buffer);
    // one that could not be read is tried again next time
    void buffer.then((decoded) => decoded ?? byKey.delete(key));
  }
  return buffer;
}

/**
 * Plays the narration from output time `from`: each spoken line (`spoken` has its key) where it
 * plays on the video, at its and the narration's volume, from where the clock is when it already began.
 */
export class NarrationSchedule {
  private readonly nodes: AudioNode[] = [];
  private readonly sources: AudioBufferSourceNode[] = [];
  private stopped = false;

  constructor(context: AudioContext, project: CuttleProject, spans: readonly SceneSpan[], spoken: (key: string) => boolean, from: number, contextStart: number) {
    if (!project.look.audio.enabled) return;
    for (const cue of narrationCues(project, spans).cues) {
      const key = voiceLineKey(project.voiceover, cue.line);
      if (!spoken(key)) continue;
      void lineBuffer(context, key).then((buffer) => {
        if (!buffer || this.stopped || cue.at + buffer.duration <= from) return;
        const at = contextStart + (cue.at - from);
        const start = Math.max(context.currentTime, at);
        const offset = start - at;
        if (offset >= buffer.duration) return;
        const source = context.createBufferSource();
        source.buffer = buffer;
        const gain = context.createGain();
        gain.gain.value = cue.line.volume * project.voiceover.volume;
        source.connect(gain).connect(context.destination);
        source.start(start, offset);
        this.sources.push(source);
        this.nodes.push(source, gain);
      });
    }
  }

  stop(): void {
    this.stopped = true;
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // not started yet
      }
    }
    for (const node of this.nodes) node.disconnect();
    this.sources.length = 0;
    this.nodes.length = 0;
  }
}
