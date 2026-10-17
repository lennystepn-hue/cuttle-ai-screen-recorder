// The mic in the preview: decoded in chunks a few seconds ahead of the playhead and scheduled on the
// AudioContext, whose clock the video follows.
import { AudioBufferSink } from 'mediabunny';
import type { CuttleProject } from '@cuttle/project';
import { isContinuousCut, type SceneSpan } from '@cuttle/timeline';
import type { AudioSource } from './media';

/** Audio is scheduled this far ahead of the clock. */
const AHEAD_SECONDS = 2.5;
/** Short fades at the edges of each clip's sound, against clicks. */
const EDGE_FADE = 0.008;

/** Whether the export plays a clip's sound (`look.audio`: on, and sped-up clips muted unless asked). */
export function audible(project: CuttleProject, speed: number): boolean {
  return project.look.audio.enabled && !(project.look.audio.muteSpedUp && speed > 1);
}

/**
 * Plays the clips' sound from output time `from`: each audible clip's stretch of the mic, at the
 * clip's speed (the preview's pitch changes with it; the export keeps the pitch with atempo).
 * `contextStart` is the AudioContext time at which output time `from` plays.
 */
export class AudioSchedule {
  private readonly nodes = new Set<AudioScheduledSourceNode>();
  private stopped = false;
  private readonly done: Promise<void>;

  constructor(
    private readonly context: AudioContext,
    private readonly mic: AudioSource,
    private readonly project: CuttleProject,
    private readonly spans: readonly SceneSpan[],
    private readonly from: number,
    private readonly contextStart: number,
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
      gain.connect(this.context.destination);
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
        node.onended = () => this.nodes.delete(node);
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
    }
    this.nodes.clear();
  }

  finished(): Promise<void> {
    return this.done;
  }
}
