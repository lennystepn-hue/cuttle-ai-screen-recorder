// The typing sounds in the preview: the export's clicks (`typingClicks`, `clickSamples`), each
// scheduled on the AudioContext a moment before the clock reaches it.
import type { CuttleProject, InputEvent } from '@cuttle/project';
import { TYPING_RULES, clickSamples, typingClicks, type SceneSpan, type TypingClick } from '@cuttle/timeline';

/** Clicks are scheduled this far ahead of the clock. */
const AHEAD_SECONDS = 1;

/**
 * Plays the typing sounds from output time `from` on; `contextStart` is the AudioContext time at
 * which output time `from` plays. Without key counts, or with the sounds off, it plays nothing.
 */
export class TypingSchedule {
  private readonly nodes = new Set<AudioBufferSourceNode>();
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly master: GainNode;
  private stopped = false;
  /** Clicks scheduled so far (the check reads it). */
  scheduled = 0;

  constructor(
    private readonly context: AudioContext,
    project: CuttleProject,
    spans: readonly SceneSpan[],
    events: readonly InputEvent[],
    private readonly from: number,
    private readonly contextStart: number,
  ) {
    this.master = context.createGain();
    this.master.gain.value = TYPING_RULES.level * project.look.audio.typingVolume;
    this.master.connect(context.destination);
    void this.run(typingClicks(spans, events, project.look.audio).filter((click) => click.at >= from));
  }

  /** The AudioContext time at which output time `t` plays. */
  private when(t: number): number {
    return this.contextStart + (t - this.from);
  }

  /** A click's sound at the context's rate, made once per click. */
  private buffer(click: TypingClick): AudioBuffer {
    const key = `${click.variant}:${click.wide}`;
    let buffer = this.buffers.get(key);
    if (!buffer) {
      const samples = clickSamples(click.variant, click.wide, this.context.sampleRate);
      buffer = this.context.createBuffer(1, samples.length, this.context.sampleRate);
      buffer.getChannelData(0).set(samples);
      this.buffers.set(key, buffer);
    }
    return buffer;
  }

  private async run(clicks: readonly TypingClick[]): Promise<void> {
    for (const click of clicks) {
      while (!this.stopped && this.when(click.at) - this.context.currentTime > AHEAD_SECONDS) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (this.stopped) return;
      const at = this.when(click.at);
      // one the clock already passed stays silent
      if (at < this.context.currentTime) continue;
      const gain = this.context.createGain();
      gain.gain.value = click.gain;
      gain.connect(this.master);
      const node = this.context.createBufferSource();
      node.buffer = this.buffer(click);
      node.connect(gain);
      node.start(at);
      this.scheduled++;
      this.nodes.add(node);
      node.onended = () => {
        this.nodes.delete(node);
        node.disconnect();
        gain.disconnect();
      };
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
    this.master.disconnect();
  }
}
