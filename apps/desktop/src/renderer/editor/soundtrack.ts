// The music and sounds in the preview: the soundtrack the main process rendered for the project (the
// export's own render of the music page and the sounds), played from the playhead on the
// AudioContext the video follows: the music at its volume and down under speech, as the export
// mixes it, the effects at theirs.
import { duckEnvelope } from '@cuttle/export/music-duck';
import type { CuttleProject } from '@cuttle/project';
import type { SoundtrackAnswer } from '../../shared/ipc';

/** A rendered soundtrack, as the main process sends it. */
export type Soundtrack = Exclude<SoundtrackAnswer, null>;

/** The duck's gain is set this often (seconds): its ramps last a quarter second and more. */
const DUCK_STEP = 0.05;

const made = new WeakMap<Soundtrack, { context: AudioContext; music: AudioBuffer; effects: AudioBuffer }>();

/** The stems as buffers of `context` (made once per soundtrack). */
function buffersOf(context: AudioContext, track: Soundtrack): { music: AudioBuffer; effects: AudioBuffer } {
  const kept = made.get(track);
  if (kept && kept.context === context) return kept;
  const buffer = (stem: Float32Array) => {
    const frames = stem.length / 2;
    const out = context.createBuffer(2, Math.max(1, frames), track.rate);
    const left = out.getChannelData(0);
    const right = out.getChannelData(1);
    for (let i = 0; i < frames; i++) {
      left[i] = stem[i * 2]!;
      right[i] = stem[i * 2 + 1]!;
    }
    return out;
  };
  const buffers = { context, music: buffer(track.music), effects: buffer(track.effects) };
  made.set(track, buffers);
  return buffers;
}

/** Whether the project has music or sounds that play. */
export function hasSoundtrack(project: CuttleProject): boolean {
  return project.look.audio.enabled && ((project.music?.enabled ?? false) || (project.look.audio.effects && project.sounds.some((sound) => sound.enabled)));
}

/**
 * Plays a soundtrack from output time `from`; `contextStart` is the AudioContext time at which output
 * time `from` plays. Levels come from `project` (the music's volume and duck, the effects' volume).
 */
export class SoundtrackSchedule {
  private readonly nodes: AudioNode[] = [];
  private readonly sources: AudioBufferSourceNode[] = [];
  /** Started buffers (the check reads it). */
  started = 0;

  constructor(context: AudioContext, track: Soundtrack, project: CuttleProject, from: number, contextStart: number) {
    const { audio } = project.look;
    if (!audio.enabled) return;
    const { music, effects } = buffersOf(context, track);
    // a start the clock already passed begins that much further in
    const start = Math.max(context.currentTime, contextStart);
    const offset = from + (start - contextStart);
    if (offset >= music.duration) return;
    const play = (buffer: AudioBuffer, level: number): GainNode => {
      const source = context.createBufferSource();
      source.buffer = buffer;
      const gain = context.createGain();
      gain.gain.value = level;
      source.connect(gain).connect(context.destination);
      source.start(start, offset);
      this.sources.push(source);
      this.nodes.push(source, gain);
      this.started++;
      return gain;
    };
    const tune = project.music?.enabled ? project.music : undefined;
    if (tune && tune.volume > 0) {
      const gain = play(music, tune.volume);
      // the duck as a curve of gains from the playhead to the end, as the export's envelope has it
      const envelope = duckEnvelope(track.speech, tune.duck);
      const steps = Math.ceil((music.duration - offset) / DUCK_STEP) + 1;
      if (track.speech.length > 0 && tune.duck > 0 && steps > 1) {
        const curve = new Float32Array(steps);
        for (let i = 0; i < steps; i++) curve[i] = tune.volume * envelope(offset + i * DUCK_STEP);
        gain.gain.setValueCurveAtTime(curve, start, (steps - 1) * DUCK_STEP);
      }
    }
    if (audio.effects && audio.effectsVolume > 0) play(effects, audio.effectsVolume);
  }

  stop(): void {
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
