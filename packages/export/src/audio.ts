import type { Look } from '@cuttle/project';
import { crossfadeHalf, isContinuousCut, type SceneSpan } from '@cuttle/timeline';

/** Sample rate of the exported audio (AAC). */
export const AUDIO_SAMPLE_RATE = 48_000;
/** AAC bitrate of the exported audio, stereo. */
export const AUDIO_BITRATE = '160k';
/** Shortest fade at a cut, so hard cuts do not click. */
const MIN_FADE_SECONDS = 0.01;
/**
 * Silence (input samples) appended before `atempo`: it returns several hundred samples fewer than
 * (to − from) / speed and needs input past the end to flush, so the clip's sound reaches its
 * fade-out. Silence, not the mic after `to`: that would play sound from after the cut.
 */
const ATEMPO_FLUSH = 200_000;

/**
 * A stretch of the exported audio, in samples at `AUDIO_SAMPLE_RATE`: one scene, or a run of clips
 * joined by continuous cuts that the sound plays straight through (heard at one speed).
 */
export interface AudioSegment {
  /** Length in output samples; segments are laid end to end. */
  samples: number;
  /**
   * The mic stretch it plays, in samples of the mic lined up with the screen track; none means
   * silence. `content`: output samples the clip fills (at most `samples`); the rest of the segment
   * is padding up to the frame grid, after the fade-out.
   */
  mic?: { from: number; to: number; speed: number; content: number };
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
 * Cuts the audio into segments on the same boundaries as the video. Clip scenes play their stretch
 * of the mic (sped up with the clip), unless the clip is sped up and `look.audio.muteSpedUp` is
 * set; still and card scenes are silent. Clips joined by continuous cuts and heard at one speed
 * are one segment, so their sound runs on exactly as in one clip (one trim, one atempo). The last
 * segment runs to `seconds`, which can be up to one frame past the timeline. Cuts fade out and in
 * over half the crossfade on each side (at least 10 ms), so the sound dips where the picture
 * crossfades; at a continuous cut where the sound changes speed or stops, only the 10 ms that keep
 * it from clicking.
 */
export function planAudio({ spans, look, mic, seconds }: AudioPlanOptions): AudioSegment[] {
  /** The speed a span plays the mic at; undefined when it is silent. */
  const soundOf = (span: SceneSpan): number | undefined => {
    const scene = span.scene;
    const audible = mic && look.audio.enabled && scene.type === 'clip' && !(look.audio.muteSpedUp && scene.speed > 1);
    return audible && scene.type === 'clip' ? scene.speed : undefined;
  };
  const half = (a: SceneSpan, b: SceneSpan): number => crossfadeHalf(a, b, look.transition);
  // Runs of spans the sound plays straight through.
  const runs: SceneSpan[][] = [];
  for (const span of spans) {
    const run = runs.at(-1);
    const last = run?.at(-1);
    const speed = soundOf(span);
    if (run && last && speed !== undefined && soundOf(last) === speed && isContinuousCut(last.scene, span.scene)) run.push(span);
    else runs.push([span]);
  }
  const total = toSamples(seconds);
  return runs.map((run, i) => {
    const first = run[0]!;
    const last = run.at(-1)!;
    const start = i === 0 ? 0 : toSamples(first.start);
    const end = i === runs.length - 1 ? total : toSamples(last.end);
    const samples = Math.max(0, end - start);
    /** Fade at the cut between `a` and `b`; at the start and end of the video only the minimum. */
    const fadeAt = (a: SceneSpan | undefined, b: SceneSpan | undefined): number =>
      Math.min(Math.floor(samples / 2), toSamples(Math.max(MIN_FADE_SECONDS, a && b ? half(a, b) : 0)));
    const segment: AudioSegment = {
      samples,
      fadeIn: fadeAt(runs[i - 1]?.at(-1), first),
      fadeOut: fadeAt(last, runs[i + 1]?.[0]),
    };
    const speed = soundOf(first);
    if (speed !== undefined && first.scene.type === 'clip' && last.scene.type === 'clip') {
      const from = toSamples(first.scene.from);
      const to = toSamples(last.scene.to);
      segment.mic = { from, to, speed, content: Math.min(samples, Math.round((to - from) / speed)) };
    }
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
 * `typingInput`: the typing sounds' track (on the output timeline already), mixed in at its level.
 */
export function audioFilterGraph(segments: readonly AudioSegment[], micOffset = 0, micInput = 1, typingInput?: number): string {
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
      const { from, to, speed, content } = segment.mic;
      const tempo = atempoChain(speed);
      chain.push(`[m${micIndex++}]atrim=start_sample=${from}:end_sample=${to}`, 'asetpts=N/SR/TB');
      // atempo comes up short: feed it silence past the clip, then cut its output to the clip's length.
      if (tempo.length > 0) chain.push(`apad=pad_len=${ATEMPO_FLUSH}`, ...tempo, `atrim=end_sample=${content}`, 'asetpts=N/SR/TB');
      chain.push(
        // Pads a mic that ends early (or started late) and the last clip up to the frame grid;
        // without input frames apad's timestamps are unset, so they are rebuilt after the trim or
        // concat fails ("Invalid data found").
        'apad',
        `atrim=end_sample=${segment.samples}`,
        'asetpts=N/SR/TB',
      );
      // Both fades lie inside the clip's own sound: a fade-out in the padding would leave a click.
      const fadeIn = Math.min(segment.fadeIn, content);
      const fadeOut = Math.min(segment.fadeOut, content);
      if (fadeIn > 0) chain.push(`afade=t=in:ss=0:ns=${fadeIn}`);
      if (fadeOut > 0) chain.push(`afade=t=out:ss=${content - fadeOut}:ns=${fadeOut}`);
    } else {
      chain.push(`anullsrc=r=${AUDIO_SAMPLE_RATE}:cl=mono`, `atrim=end_sample=${segment.samples}`);
    }
    filters.push(`${chain.join(',')}[s${i}]`);
  });
  const inputs = segments.map((_, i) => `[s${i}]`).join('');
  if (typingInput === undefined) {
    filters.push(`${inputs}concat=n=${segments.length}:v=0:a=1,pan=stereo|c0=c0|c1=c0[aout]`);
    return filters.join(';');
  }
  const total = segments.reduce((sum, segment) => sum + segment.samples, 0);
  filters.push(
    `${inputs}concat=n=${segments.length}:v=0:a=1[base]`,
    [`[${typingInput}:a]aresample=${AUDIO_SAMPLE_RATE}`, 'aformat=sample_fmts=fltp:channel_layouts=mono', 'apad', `atrim=end_sample=${total}`, 'asetpts=N/SR/TB[keys]'].join(','),
    // added as they are: amix would otherwise halve both
    '[base][keys]amix=inputs=2:duration=first:normalize=0,pan=stereo|c0=c0|c1=c0[aout]',
  );
  return filters.join(';');
}

/**
 * Longest graph passed on the command line. Windows limits a command line to 32 767 characters,
 * which leaves room for about 150 audible clips next to the file paths; longer graphs go into a
 * file read with `-/filter_complex`, which needs ffmpeg 7 or later.
 */
export const INLINE_GRAPH_LIMIT = 30_000;

export interface MuxArgsOptions {
  /** The video-only MP4 from the frame loop. */
  video: string;
  /** The mic file, when the graph uses it. */
  mic?: string;
  /** The typing sounds' track, when the graph mixes it in (the input after the mic). */
  typing?: string;
  graph: string;
  /** A file holding `graph`, used instead of the inline graph when given. */
  graphFile?: string;
  out: string;
}

/** ffmpeg arguments that add the audio to the video without re-encoding it: AAC 48 kHz, moov at the front. */
export function muxArgs({ video, mic, typing, graph, graphFile, out }: MuxArgsOptions): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-y',
    '-i',
    video,
    ...(mic ? ['-i', mic] : []),
    ...(typing ? ['-i', typing] : []),
    ...(graphFile ? ['-/filter_complex', graphFile] : ['-filter_complex', graph]),
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
