// The video's own sound besides the mic: its music (a page Claude wrote, rendered as long as the
// video), the project's sounds, and the typing clicks, mixed into one stereo track on the video's
// timeline: the music lowered under speech, each part at its level. The export adds it to the mic.
import { open, readFile, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { CuttleProject } from '@cuttle/project';
import { mixTyping, type TypingClick } from '@cuttle/timeline';
import { AUDIO_SAMPLE_RATE } from '../audio';
import { ExportError } from '../errors';
import { motionSeed } from '../motion/init';
import { declaredParams } from '../motion/params';
import { soundCues, videoData, type VideoInputs } from '../music/video';
import type { SoundCue, VideoData } from '../music/runtime';
import { duckEnvelope } from '../music/duck';

export { DUCK_ATTACK, DUCK_RELEASE, duckEnvelope } from '../music/duck';
import { renderMusic, type MusicStems } from './music';
import { pageUrl } from './motion';

/** Samples mixed at a time: 10 s. */
const BLOCK = AUDIO_SAMPLE_RATE * 10;

const inside = (base: string, path: string) => {
  const rel = relative(base, path);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

/** A sound names a file (a path with an extension) rather than a built-in sound. */
export const isSoundFile = (sound: string): boolean => /[./\\]/.test(sound);

/** What the soundtrack is made of, before it is rendered. */
export interface SoundtrackPlan {
  video: VideoData;
  /** The music page (absolute), when the project has music that plays. */
  page?: string;
  params: Record<string, unknown>;
  network: boolean;
  seed: number;
  sounds: { at: number; sound: string; url?: string; volume: number }[];
  /** Sounds that cannot play (a file outside the project or missing). */
  skipped: string[];
}

/**
 * What the project's soundtrack holds: none when the audio is off, or when it has no music that plays
 * and no sounds (the typing clicks alone are mixed without a page). `pageSounds` are the sounds its
 * motion pages asked for, in output seconds (`motionSoundCues`); they play with the project's own.
 */
export async function planSoundtrack(
  projectDir: string,
  project: CuttleProject,
  inputs: VideoInputs,
  pageSounds: readonly SoundCue[] = [],
): Promise<SoundtrackPlan | undefined> {
  const { audio } = project.look;
  if (!audio.enabled) return undefined;
  const music = project.music?.enabled ? project.music : undefined;
  const sounds = audio.effects ? project.sounds.filter((sound) => sound.enabled) : [];
  const fromPages = audio.effects ? pageSounds : [];
  if (!music && sounds.length === 0 && fromPages.length === 0) return undefined;
  const root = resolve(projectDir);
  let params: Record<string, unknown> = {};
  let page: string | undefined;
  if (music) {
    page = resolve(root, music.src);
    if (!inside(root, page)) throw new ExportError('invalid-project', `music.src ${music.src} is outside the project folder`);
    const html = await readFile(page, 'utf8').catch(() => {
      throw new ExportError('missing-file', `no music page at ${music.src}`);
    });
    const defaults = Object.fromEntries(declaredParams(html).params.map((param) => [param.name, param.default]));
    params = { ...defaults, ...music.params };
  }
  const skipped: string[] = [];
  const cues: SoundtrackPlan['sounds'] = [];
  const asked = [...soundCues(project, sounds), ...fromPages].sort((a, b) => a.at - b.at);
  for (const cue of asked) {
    if (!isSoundFile(cue.sound)) {
      cues.push(cue);
      continue;
    }
    const path = resolve(root, cue.sound);
    const exists = inside(root, path) && (await stat(path).then((info) => info.isFile(), () => false));
    if (!exists) skipped.push(`${cue.sound}: not a file in the project`);
    else cues.push({ at: cue.at, sound: cue.sound, volume: cue.volume, url: pageUrl(root, path) });
  }
  return {
    video: videoData(project, inputs),
    ...(page && { page }),
    params,
    network: music?.network ?? false,
    seed: motionSeed(music?.src ?? 'sounds'),
    sounds: cues,
    skipped,
  };
}

/** Renders a planned soundtrack's music and sounds (the page in a hidden window). */
export async function renderSoundtrack(projectDir: string, plan: SoundtrackPlan, options: { kitDir?: string } = {}): Promise<MusicStems> {
  const stems = await renderMusic({
    ...(plan.page && { file: plan.page }),
    root: projectDir,
    network: plan.network,
    ...(options.kitDir && { kitDir: options.kitDir }),
    init: { duration: plan.video.duration, rate: AUDIO_SAMPLE_RATE, params: plan.params, seed: plan.seed, video: plan.video, sounds: plan.sounds },
  });
  stems.result.skipped.push(...plan.skipped);
  return stems;
}

/** A WAV header for `frames` frames of 32-bit float stereo at the export's rate. */
export function floatWavHeader(frames: number): Buffer {
  const bytes = frames * 8;
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + bytes, 4);
  head.write('WAVE', 8);
  head.write('fmt ', 12);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(3, 20); // IEEE float
  head.writeUInt16LE(2, 22);
  head.writeUInt32LE(AUDIO_SAMPLE_RATE, 24);
  head.writeUInt32LE(AUDIO_SAMPLE_RATE * 8, 28);
  head.writeUInt16LE(8, 32);
  head.writeUInt16LE(32, 34);
  head.write('data', 36);
  head.writeUInt32LE(bytes, 40);
  return head;
}

export interface SoundTrackParts {
  seconds: number;
  /** The rendered music and sounds, if any, with the music's level and duck. */
  stems?: MusicStems;
  music?: { volume: number; duck: number };
  speech?: readonly { start: number; end: number }[];
  effectsVolume: number;
  /** The typing clicks at their volume, if any. */
  typing?: { clicks: readonly TypingClick[]; volume: number };
}

/**
 * Writes the soundtrack (32-bit float stereo WAV, `seconds` long) at `path`, block by block: the music
 * at its volume and lowered under speech, the effects at theirs, the typing clicks in the middle.
 */
export async function writeSoundTrack(path: string, parts: SoundTrackParts): Promise<void> {
  const total = Math.round(parts.seconds * AUDIO_SAMPLE_RATE);
  const duck = duckEnvelope(parts.speech ?? [], parts.music?.duck ?? 0);
  const musicVolume = parts.music?.volume ?? 0;
  const file = await open(path, 'w');
  try {
    await file.write(floatWavHeader(total));
    for (let start = 0; start < total; start += BLOCK) {
      const n = Math.min(BLOCK, total - start);
      const mono = new Float32Array(n);
      if (parts.typing) mixTyping(parts.typing.clicks, parts.typing.volume, mono, start, AUDIO_SAMPLE_RATE);
      const out = new Float32Array(n * 2);
      const stems = parts.stems;
      const length = stems ? stems.music.length / 2 : 0;
      // the duck changes slowly: worked out every 64 samples
      let gain = 1;
      for (let i = 0; i < n; i++) {
        const frame = start + i;
        if (i % 64 === 0) gain = duck(frame / AUDIO_SAMPLE_RATE);
        let left = mono[i]!;
        let right = mono[i]!;
        if (stems && frame < length) {
          const m = musicVolume * gain;
          left += stems.music[frame * 2]! * m + stems.effects[frame * 2]! * parts.effectsVolume;
          right += stems.music[frame * 2 + 1]! * m + stems.effects[frame * 2 + 1]! * parts.effectsVolume;
        }
        out[i * 2] = left;
        out[i * 2 + 1] = right;
      }
      await file.write(Buffer.from(out.buffer, out.byteOffset, out.byteLength));
    }
  } finally {
    await file.close();
  }
}
