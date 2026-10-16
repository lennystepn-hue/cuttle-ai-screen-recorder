import type { Look } from '@cuttle/project';
import type { SceneSpan } from '@cuttle/timeline';

/** Sample rate of the exported audio (AAC). */
export const AUDIO_SAMPLE_RATE = 48_000;
/** AAC bitrate of the exported audio, stereo. */
export const AUDIO_BITRATE = '160k';
/** Shortest fade at a cut, so hard cuts do not click. */
const MIN_FADE_SECONDS = 0.01;

/** One scene's stretch of the exported audio, in samples at `AUDIO_SAMPLE_RATE`. */
export interface AudioSegment {
  /** Length in output samples; segments are laid end to end. */
  samples: number;
  /** The mic stretch it plays, in samples of the mic lined up with the screen track; none means silence. */
  mic?: { from: number; to: number; speed: number };
  /** Fade lengths in output samples at the segment's start and end. */
  fadeIn: number;
  fadeOut: number;
}

export interface AudioPlanOptions {
  spans: readonly SceneSpan[];
  look: Pick<Look, 'audio' | 'transition'>;
  /** Whether a mic track is exported (the project has one and `look.audio.enabled`). */
  mic: boolean;
  /** Length of the exported video in seconds (frames / fps); the audio ends exactly there. */
  seconds: number;
}

const toSamples = (seconds: number): number => Math.round(seconds * AUDIO_SAMPLE_RATE);

/**
 * Cuts the audio into one segment per scene, on the same boundaries as the video. Clip scenes play
 * their stretch of the mic (sped up with the clip), unless the clip is sped up and
 * `look.audio.muteSpedUp` is set; still and card scenes are silent. The last segment runs to
 * `seconds`, which can be up to one frame past the timeline. Cuts fade out and in over half the
 * crossfade on each side (at least 10 ms), so the sound dips where the picture crossfades.
 */
export function planAudio({ spans, look, mic, seconds }: AudioPlanOptions): AudioSegment[] {
  const half = (a: SceneSpan, b: SceneSpan): number =>
    look.transition.enabled ? Math.min(look.transition.duration / 2, (a.end - a.start) / 2, (b.end - b.start) / 2) : 0;
  const total = toSamples(seconds);
  return spans.map((span, i) => {
    const start = i === 0 ? 0 : toSamples(span.start);
    const end = i === spans.length - 1 ? total : toSamples(span.end);
    const samples = Math.max(0, end - start);
    /** Fade at the cut between `a` and `b`; at the start and end of the video only the minimum. */
    const fadeAt = (a: SceneSpan | undefined, b: SceneSpan | undefined): number =>
      Math.min(Math.floor(samples / 2), toSamples(Math.max(MIN_FADE_SECONDS, a && b ? half(a, b) : 0)));
    const segment: AudioSegment = {
      samples,
      fadeIn: fadeAt(spans[i - 1], span),
      fadeOut: fadeAt(span, spans[i + 1]),
    };
    const scene = span.scene;
    const audible = mic && look.audio.enabled && scene.type === 'clip' && !(look.audio.muteSpedUp && scene.speed > 1);
    if (audible) segment.mic = { from: toSamples(scene.from), to: toSamples(scene.to), speed: scene.speed };
    return segment;
  });
}

/** `atempo` filters for `speed`; one filter covers 0.5 to 100, slower speeds need a chain. */
export function atempoChain(speed: number): string[] {
  if (!(speed > 0)) throw new Error(`atempoChain: speed must be positive, got ${speed}`);
  const chain: string[] = [];
  let rest = speed;
  while (rest < 0.5) {
    chain.push('atempo=0.5');
    rest /= 0.5;
  }
  if (Math.abs(rest - 1) > 1e-9) chain.push(`atempo=${rest}`);
  return chain;
}

/**
 * The ffmpeg `-filter_complex` graph that turns the mic (input `micInput`) into the export's audio,
 * labelled `[aout]`: 48 kHz stereo, exactly the sum of the segments' samples long. `micOffset` is
 * how many seconds after the screen track the mic started (negative: before); the mic is shifted
 * once so its time 0 is the screen track's time 0. Without mic segments the graph is silence only.
 */
export function audioFilterGraph(segments: readonly AudioSegment[], micOffset = 0, micInput = 1): string {
  const filters: string[] = [];
  const micSegments = segments.filter((segment) => segment.mic !== undefined).length;
  if (micSegments > 0) {
    const shift = toSamples(micOffset);
    const align =
      shift > 0 ? [`adelay=delays=${shift}S:all=1`] : shift < 0 ? [`atrim=start_sample=${-shift}`, 'asetpts=N/SR/TB'] : [];
    const outputs = Array.from({ length: micSegments }, (_, i) => `[m${i}]`).join('');
    filters.push(
      [`[${micInput}:a]aresample=${AUDIO_SAMPLE_RATE}`, 'aformat=sample_fmts=fltp:channel_layouts=mono', ...align, `asplit=${micSegments}${outputs}`].join(','),
    );
  }
  let micIndex = 0;
  segments.forEach((segment, i) => {
    const chain: string[] = [];
    if (segment.mic) {
      chain.push(
        `[m${micIndex++}]atrim=start_sample=${segment.mic.from}:end_sample=${segment.mic.to}`,
        'asetpts=N/SR/TB',
        ...atempoChain(segment.mic.speed),
        // Pads a mic that ends early (or started late); without input frames apad's timestamps are
        // unset, so they are rebuilt after the trim or concat fails ("Invalid data found").
        'apad',
        `atrim=end_sample=${segment.samples}`,
        'asetpts=N/SR/TB',
      );
      if (segment.fadeIn > 0) chain.push(`afade=t=in:ss=0:ns=${segment.fadeIn}`);
      if (segment.fadeOut > 0) chain.push(`afade=t=out:ss=${segment.samples - segment.fadeOut}:ns=${segment.fadeOut}`);
    } else {
      chain.push(`anullsrc=r=${AUDIO_SAMPLE_RATE}:cl=mono`, `atrim=end_sample=${segment.samples}`);
    }
    filters.push(`${chain.join(',')}[s${i}]`);
  });
  const inputs = segments.map((_, i) => `[s${i}]`).join('');
  filters.push(`${inputs}concat=n=${segments.length}:v=0:a=1,pan=stereo|c0=c0|c1=c0[aout]`);
  return filters.join(';');
}

export interface MuxArgsOptions {
  /** The video-only MP4 from the frame loop. */
  video: string;
  /** The mic file, when the graph uses it. */
  mic?: string;
  graph: string;
  out: string;
}

/** ffmpeg arguments that add the audio to the video without re-encoding it: AAC 48 kHz, moov at the front. */
export function muxArgs({ video, mic, graph, out }: MuxArgsOptions): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-y',
    '-i',
    video,
    ...(mic ? ['-i', mic] : []),
    '-filter_complex',
    graph,
    '-map',
    '0:v:0',
    '-map',
    '[aout]',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    AUDIO_BITRATE,
    '-ar',
    String(AUDIO_SAMPLE_RATE),
    '-movflags',
    '+faststart',
    '-f',
    'mp4',
    out,
  ];
}
