// ffmpeg command lines for the three capture processes. Pure: the inputs come from sources.ts.
import { PCM_RATE } from './level';

export const FRAME_RATE = 30;

/** Every capture input stamps its packets with the wall clock, so take.json can line tracks up. */
const WALLCLOCK = ['-use_wallclock_as_timestamps', '1'];

/**
 * BT.709 matrix and tags (Chromium decodes untagged HD video as BT.709; ffmpeg converts RGB with
 * BT.601 by default). `setparams` replaces the sRGB transfer that ddagrab frames carry, which the
 * encoder flags alone do not override.
 */
export const VIDEO_CHAIN =
  'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv';

/** H.264 at high quality; a key frame every 2 s, so a fragment (one GOP) loses at most 2 s in a crash. */
export const VIDEO_CODEC = [
  '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18',
  '-force_key_frames', 'expr:gte(t,n_forced*2)',
  '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
];
const AUDIO_CODEC = ['-c:a', 'aac', '-b:a', '160k'];

/**
 * Fragmented MP4, so a killed ffmpeg leaves a readable file up to its last fragment. A video fragment
 * is one GOP (2 s). `-flush_packets 1` writes every packet through: without it a killed ffmpeg left
 * 28 bytes (no moov) of a still screen or of the mic, because its write buffer never filled.
 */
const FRAGMENTED_MP4 = ['-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-flush_packets', '1', '-f', 'mp4'];
/** Audio has no GOPs (`frag_keyframe` alone wrote no fragment at all): cut a fragment every second. */
const AUDIO_FRAGMENTS = ['-frag_duration', '1000000'];

/** Change below this (a blinking caret is ~1e-5 of the picture) counts as an unchanged screen. */
const IDLE_NOISE = '-60dB';
/** Digital silence: a muted or blocked microphone delivers zeros (−91 dB measured); room noise is far louder. */
const SILENCE_NOISE = '-80dB';
/** Seconds of digital silence before the mic counts as silent. */
export const SILENCE_SECONDS = 1;

/**
 * The screen track. With `idleSeconds`, a small grey copy of the picture runs through
 * `freezedetect`, which logs `lavfi.freezedetect.freeze_start` once nothing changed for that long.
 * `prefilter` comes first (macOS crops the captured display to a region or a window there).
 */
export function screenArgs(input: readonly string[], file: string, idleSeconds?: number, prefilter?: string): string[] {
  const source = prefilter === undefined ? '[0:v]' : `[0:v]${prefilter},`;
  const graph =
    idleSeconds === undefined
      ? `${source}${VIDEO_CHAIN}[out]`
      : `${source}split[rec][idle];[idle]scale=320:-2,format=gray,freezedetect=n=${IDLE_NOISE}:d=${idleSeconds},nullsink;[rec]${VIDEO_CHAIN}[out]`;
  return [...WALLCLOCK, ...input, '-filter_complex', graph, '-map', '[out]', ...VIDEO_CODEC, ...FRAGMENTED_MP4, '-y', file];
}

/**
 * `wallclock` false keeps the device's own timestamps (macOS: avfoundation stamps each buffer with
 * the time it was captured, on the host clock), which the recorder maps to the wall clock itself.
 */
export function webcamArgs(input: readonly string[], file: string, wallclock = true): string[] {
  return [...(wallclock ? WALLCLOCK : []), ...input, '-filter_complex', `[0:v]${VIDEO_CHAIN}[out]`, '-map', '[out]', ...VIDEO_CODEC, ...FRAGMENTED_MP4, '-y', file];
}

/**
 * The mic track, with `silencedetect` on a copy so a muted microphone can be reported, and its sound
 * as 16 kHz mono 16-bit samples on stdout, for its level while it records.
 */
export function micArgs(input: readonly string[], file: string, wallclock = true): string[] {
  const graph = `[0:a]asplit=3[rec][chk][pcm];[chk]silencedetect=n=${SILENCE_NOISE}:d=${SILENCE_SECONDS},anullsink;[rec]anull[out];[pcm]aresample=${PCM_RATE},aformat=sample_fmts=s16:channel_layouts=mono[raw]`;
  return [
    ...(wallclock ? WALLCLOCK : []),
    ...input,
    '-filter_complex',
    graph,
    '-map',
    '[out]',
    ...AUDIO_CODEC,
    ...AUDIO_FRAGMENTS,
    ...FRAGMENTED_MP4,
    '-y',
    file,
    '-map',
    '[raw]',
    '-f',
    's16le',
    '-flush_packets',
    '1',
    'pipe:1',
  ];
}

/** `[Parsed_freezedetect_3 @ …] lavfi.freezedetect.freeze_start: 0.973633` → 0.973633 */
export function freezeStart(line: string): number | undefined {
  const match = /lavfi\.freezedetect\.freeze_start: (\d+(?:\.\d+)?)/.exec(line);
  return match ? Number(match[1]) : undefined;
}

/** `[Parsed_freezedetect_3 @ …] lavfi.freezedetect.freeze_end: 2.5` → 2.5 */
export function freezeEnd(line: string): number | undefined {
  const match = /lavfi\.freezedetect\.freeze_end: (\d+(?:\.\d+)?)/.exec(line);
  return match ? Number(match[1]) : undefined;
}

/** `[Parsed_silencedetect_1 @ …] silence_start: 0.0180833` → 0.0180833 */
export function silenceStart(line: string): number | undefined {
  const match = /silence_start: (-?\d+(?:\.\d+)?)/.exec(line);
  return match ? Number(match[1]) : undefined;
}
