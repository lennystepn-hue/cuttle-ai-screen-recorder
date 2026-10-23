import type { Look } from '@cuttle/project';
import { crossfadeHalf, isContinuousCut, type SceneSpan } from '@cuttle/timeline';

/** Sample rate of the exported audio (AAC). */
export const AUDIO_SAMPLE_RATE = 48_000;
/** AAC bitrate of the exported audio, stereo. */
export const AUDIO_BITRATE = '160k';
/** Shortest fade at a cut, so hard cuts do not click. */
const MIN_FADE_SECONDS = 0.01;
/** The soundtrack's ceiling under the mic: about -1 dBFS. */
const LIMIT = 0.89;
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
   * The stretch of the take's sound it plays (the mic and the system audio), in samples of each
   * track lined up with the screen track; none means silence. `content`: output samples the clip
   * fills (at most `samples`); the rest of the segment is padding up to the frame grid, after the
   * fade-out.
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
  /** Whether the system audio is exported (`sources.system`, `look.audio.system`). */
  system?: boolean;
  /** Length of the exported video in seconds (frames / fps); the audio ends exactly there. */
  seconds: number;
}

const toSamples = (seconds: number): number => Math.round(seconds * AUDIO_SAMPLE_RATE);

/**
 * Cuts the audio into segments on the same boundaries as the video. Clip scenes play their stretch
 * of the take's sound, the mic and the system audio (sped up with the clip), unless the clip is sped up and `look.audio.muteSpedUp` is
 * set; still and card scenes are silent. Clips joined by continuous cuts and heard at one speed
 * are one segment, so their sound runs on exactly as in one clip (one trim, one atempo). The last
 * segment runs to `seconds`, which can be up to one frame past the timeline. Cuts fade out and in
 * over half the crossfade on each side (at least 10 ms), so the sound dips where the picture
 * crossfades; at a continuous cut where the sound changes speed or stops, only the 10 ms that keep
 * it from clicking.
 */
export function planAudio({ spans, look, mic, system = false, seconds }: AudioPlanOptions): AudioSegment[] {
  /** The speed a span plays the take's sound at; undefined when it is silent. */
  const soundOf = (span: SceneSpan): number | undefined => {
    const scene = span.scene;
    const audible = (mic || system) && look.audio.enabled && scene.type === 'clip' && !(look.audio.muteSpedUp && scene.speed > 1);
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

/** The tracks the export's audio is made from, by their input number in the mux command. */
export interface AudioInputs {
  /** The mic, and how many seconds after the screen track it started (negative: before). */
  mic?: { input: number; offset: number };
  /**
   * What the computer played, likewise, at `volume`, and lowered under speech by `duck` (its gain:
   * an ffmpeg expression of the output's time `t`, `duckExpression`).
   */
  system?: { input: number; offset: number; volume: number; duck?: string };
  /** The narration's track (on the output timeline already, at its levels), mixed with the voice. */
  narration?: number;
  /** The typing sounds' track (on the output timeline already), mixed in at its level. */
  typing?: number;
  /**
   * The soundtrack instead (stereo: the music, the sounds and the typing clicks), mixed with the
   * take's sound and then limited, so the sum cannot clip.
   */
  sound?: number;
}

/**
 * One track of the take, cut into the segments: shifted once so its time 0 is the screen track's,
 * split per audible segment, each stretch trimmed, sped up and faded like its clip; silence in the
 * others. Adds the filters to `filters` and returns the segments' labels (`[s0]`… for `out` "s").
 */
function trackChains(filters: string[], segments: readonly AudioSegment[], track: { input: number; offset: number } | undefined, split: string, out: string, layout: 'mono' | 'stereo'): string {
  const audible = track ? segments.filter((segment) => segment.mic !== undefined).length : 0;
  if (track && audible > 0) {
    const shift = toSamples(track.offset);
    const align =
      shift > 0 ? [`adelay=delays=${shift}S:all=1`] : shift < 0 ? [`atrim=start_sample=${-shift}`, 'asetpts=N/SR/TB'] : [];
    const outputs = Array.from({ length: audible }, (_, i) => `[${split}${i}]`).join('');
    filters.push(
      [`[${track.input}:a]aresample=${AUDIO_SAMPLE_RATE}`, `aformat=sample_fmts=fltp:channel_layouts=${layout}`, ...align, `asplit=${audible}${outputs}`].join(','),
    );
  }
  let index = 0;
  segments.forEach((segment, i) => {
    const chain: string[] = [];
    if (track && segment.mic) {
      const { from, to, speed, content } = segment.mic;
      const tempo = atempoChain(speed);
      chain.push(`[${split}${index++}]atrim=start_sample=${from}:end_sample=${to}`, 'asetpts=N/SR/TB');
      // atempo comes up short: feed it silence past the clip, then cut its output to the clip's length.
      if (tempo.length > 0) chain.push(`apad=pad_len=${ATEMPO_FLUSH}`, ...tempo, `atrim=end_sample=${content}`, 'asetpts=N/SR/TB');
      chain.push(
        // Pads a track that ends early (or started late) and the last clip up to the frame grid;
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
      chain.push(`anullsrc=r=${AUDIO_SAMPLE_RATE}:cl=${layout}`, `atrim=end_sample=${segment.samples}`);
    }
    filters.push(`${chain.join(',')}[${out}${i}]`);
  });
  return segments.map((_, i) => `[${out}${i}]`).join('');
}

/** Sums its inputs as they are, then keeps the sum below full scale (at four times the rate, so peaks between samples count). */
const LIMITED_MIX = (inputs: number) =>
  `amix=inputs=${inputs}:duration=first:normalize=0,aresample=${AUDIO_SAMPLE_RATE * 4},alimiter=limit=${LIMIT}:attack=1:release=60:level=false,aresample=${AUDIO_SAMPLE_RATE}[aout]`;

/**
 * The ffmpeg `-filter_complex` graph that turns the take's sound into the export's audio, labelled
 * `[aout]`: 48 kHz stereo, exactly the sum of the segments' samples long. Each track of the take
 * plays its stretch in each audible segment (`trackChains`); without a mic, the voice is silence.
 * The system audio, the typing sounds and the soundtrack are mixed in as `inputs` says.
 */
export function audioFilterGraph(segments: readonly AudioSegment[], inputs: AudioInputs = {}): string {
  const filters: string[] = [];
  const total = segments.reduce((sum, segment) => sum + segment.samples, 0);
  const n = segments.length;
  const voice = trackChains(filters, segments, inputs.mic, 'm', 's', 'mono');
  const soundtrack = (input: number) =>
    [`[${input}:a]aresample=${AUDIO_SAMPLE_RATE}`, 'aformat=sample_fmts=fltp:channel_layouts=stereo', 'apad', `atrim=end_sample=${total}`, 'asetpts=N/SR/TB[sound]'].join(',');
  const clicks = (input: number, then = '') =>
    [`[${input}:a]aresample=${AUDIO_SAMPLE_RATE}`, 'aformat=sample_fmts=fltp:channel_layouts=mono', 'apad', `atrim=end_sample=${total}`, `asetpts=N/SR/TB${then}[keys]`].join(',');
  if (inputs.system || inputs.narration !== undefined) {
    // everything the video plays, summed and limited
    const mix = ['[voice]'];
    const system = inputs.system && trackChains(filters, segments, inputs.system, 'y', 'z', 'stereo');
    filters.push(`${voice}concat=n=${n}:v=0:a=1,pan=stereo|c0=c0|c1=c0[voice]`);
    if (inputs.system && system) {
      const { volume, duck } = inputs.system;
      filters.push(`${system}concat=n=${n}:v=0:a=1,volume=${volume}${duck ? `,volume=eval=frame:volume='${duck}'` : ''}[system]`);
      mix.push('[system]');
    }
    if (inputs.narration !== undefined) {
      filters.push(
        [`[${inputs.narration}:a]aresample=${AUDIO_SAMPLE_RATE}`, 'aformat=sample_fmts=fltp:channel_layouts=mono', 'apad', `atrim=end_sample=${total}`, 'asetpts=N/SR/TB', 'pan=stereo|c0=c0|c1=c0[narration]'].join(','),
      );
      mix.push('[narration]');
    }
    if (inputs.sound !== undefined) {
      filters.push(soundtrack(inputs.sound));
      mix.push('[sound]');
    } else if (inputs.typing !== undefined) {
      filters.push(clicks(inputs.typing, ',pan=stereo|c0=c0|c1=c0'));
      mix.push('[keys]');
    }
    filters.push(`${mix.join('')}${LIMITED_MIX(mix.length)}`);
    return filters.join(';');
  }
  if (inputs.sound !== undefined) {
    filters.push(`${voice}concat=n=${n}:v=0:a=1,pan=stereo|c0=c0|c1=c0[voice]`, soundtrack(inputs.sound), `[voice][sound]${LIMITED_MIX(2)}`);
    return filters.join(';');
  }
  if (inputs.typing === undefined) {
    filters.push(`${voice}concat=n=${n}:v=0:a=1,pan=stereo|c0=c0|c1=c0[aout]`);
    return filters.join(';');
  }
  filters.push(
    `${voice}concat=n=${n}:v=0:a=1[base]`,
    clicks(inputs.typing),
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

export interface MixArgsOptions {
  /** The mic file, when the graph uses it. */
  mic?: string;
  /** The system audio's file, when the graph uses it (the input after the mic). */
  system?: string;
  /** The narration's track, when the graph mixes it in (the input after the system audio). */
  narration?: string;
  /** The typing sounds' track, when the graph mixes it in (the input after the mic and the system audio). */
  typing?: string;
  /** The soundtrack (music, sounds, typing), when the graph mixes it in (the input after the mic and the system audio). */
  sound?: string;
  graph: string;
  /** A file holding `graph`, used instead of the inline graph when given. */
  graphFile?: string;
  /** The WAV it writes. */
  out: string;
}

/**
 * ffmpeg arguments that mix the take's sound (`audioFilterGraph`) into one WAV of floats, the sound
 * of every format of the video, made while their frames render. The graph counts its inputs after
 * the video's: a tiny picture of nothing stands in for it. RF64 past 4 GB (hours).
 */
export function mixArgs({ mic, system, narration, typing, sound, graph, graphFile, out }: MixArgsOptions): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=s=16x16:d=1',
    ...(mic ? ['-i', mic] : []),
    ...(system ? ['-i', system] : []),
    ...(narration ? ['-i', narration] : []),
    ...(typing ? ['-i', typing] : []),
    ...(sound ? ['-i', sound] : []),
    ...(graphFile ? ['-/filter_complex', graphFile] : ['-filter_complex', graph]),
    '-map',
    '[aout]',
    '-c:a',
    'pcm_f32le',
    '-ar',
    String(AUDIO_SAMPLE_RATE),
    '-rf64',
    'auto',
    '-f',
    'wav',
    out,
  ];
}

export interface EncodeArgsOptions {
  /** The mix (`mixArgs`). */
  mix: string;
  /** Filters on the way (`masterFilter`: a platform's loudness). */
  master?: string;
  out: string;
}

/** ffmpeg arguments that encode the mix as the videos' sound, once for all of them: AAC 48 kHz in an M4A. */
export function encodeArgs({ mix, master, out }: EncodeArgsOptions): string[] {
  return ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-i', mix, '-map', '0:a:0', ...(master ? ['-af', master] : []), '-c:a', 'aac', '-b:a', AUDIO_BITRATE, '-ar', String(AUDIO_SAMPLE_RATE), '-f', 'mp4', out];
}

export interface MuxArgsOptions {
  /** The video-only MP4 from the frame loop. */
  video: string;
  /** The videos' sound (`encodeArgs`). */
  audio: string;
  /** The chapters as an ffmetadata file (the last input), when the video has any. */
  chapters?: string;
  out: string;
}

/** ffmpeg arguments that put the sound (and the chapters) beside the video, both as they are, the moov at the front. */
export function muxArgs({ video, audio, chapters, out }: MuxArgsOptions): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-y',
    '-i',
    video,
    '-i',
    audio,
    ...(chapters ? ['-i', chapters] : []),
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    ...(chapters ? ['-map_chapters', '2'] : []),
    '-c',
    'copy',
    '-movflags',
    '+faststart',
    '-f',
    'mp4',
    out,
  ];
}

/** The files a transparent video is written as: VP9 with alpha in WebM, or ProRes 4444 in MOV (for Final Cut, Premiere, Resolve). */
export type AlphaContainer = 'webm' | 'mov';

export interface AlphaMuxArgsOptions {
  /** The page's video: VP9 with alpha in WebM. */
  video: string;
  /** The mix (`mixArgs`), encoded here: Opus in WebM, PCM in MOV. */
  audio: string;
  /** Filters on the sound on its way in (`masterFilter`). */
  master?: string;
  chapters?: string;
  container: AlphaContainer;
  out: string;
}

/**
 * ffmpeg arguments that put the sound beside a transparent video: in WebM the video copied (its
 * alpha kept beside each frame) and the sound as Opus; in MOV the video decoded with libvpx (whose
 * decoder reads the alpha) and encoded as ProRes 4444 with 10-bit alpha, the sound as 16-bit PCM.
 */
export function alphaMuxArgs({ video, audio, master, chapters, container, out }: AlphaMuxArgsOptions): string[] {
  const mov = container === 'mov';
  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-y',
    ...(mov ? ['-c:v', 'libvpx-vp9'] : []),
    '-i',
    video,
    '-i',
    audio,
    ...(chapters ? ['-i', chapters] : []),
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    ...(master ? ['-af', master] : []),
    ...(chapters ? ['-map_chapters', '2'] : []),
    ...(mov ? ['-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-vendor', 'apl0', '-c:a', 'pcm_s16le'] : ['-c:v', 'copy', '-c:a', 'libopus', '-b:a', AUDIO_BITRATE]),
    '-ar',
    String(AUDIO_SAMPLE_RATE),
    '-f',
    mov ? 'mov' : 'webm',
    out,
  ];
}

/** dB the master limiter stays under its ceiling: the AAC encoder's overshoot on loud peaks. */
export const CODEC_HEADROOM = 0.5;

/**
 * The master stage for a platform's loudness: `gain` dB on the whole mix, then a limiter at four
 * times the rate (so peaks between samples count) that keeps the true peak under `ceiling` dBTP,
 * `CODEC_HEADROOM` lower than asked.
 */
export function masterFilter(gain: number, ceiling: number): string {
  const limit = 10 ** ((ceiling - CODEC_HEADROOM) / 20);
  return `volume=${gain.toFixed(2)}dB,aresample=${AUDIO_SAMPLE_RATE * 4},alimiter=limit=${limit.toFixed(4)}:attack=1:release=60:level=false,aresample=${AUDIO_SAMPLE_RATE}`;
}

/** ffmpeg arguments that play a file's sound through the EBU R128 meter and write nothing: its summary is on stderr (`parseMeter`). */
export const meterArgs = (file: string): string[] => ['-hide_banner', '-nostdin', '-nostats', '-i', file, '-map', '0:a:0', '-af', 'ebur128=peak=true', '-f', 'null', '-'];

/** The integrated loudness (LUFS) and true peak (dBTP) in the summary ffmpeg's `ebur128` meter prints last; null where it has none (silence). */
export function parseMeter(stderr: string): { lufs: number | null; truePeak: number | null } {
  const summary = stderr.slice(stderr.lastIndexOf('Summary:'));
  const lufs = /I:\s+(-?[\d.]+|-inf) LUFS/.exec(summary)?.[1];
  const peak = /True peak:\s+Peak:\s+(-?[\d.]+|-inf) dBFS/.exec(summary)?.[1];
  const value = (text: string | undefined) => (text === undefined || text === '-inf' || !summary.startsWith('Summary:') ? null : Number(text));
  return { lufs: value(lufs), truePeak: value(peak) };
}
