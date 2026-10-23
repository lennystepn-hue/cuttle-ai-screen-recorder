import { stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { readProjectFile, writeProjectFile } from '@cuttle/core';
import { BUILT_IN_SOUNDS, MUSIC_TEMPLATES, type MusicTemplate } from '@cuttle/motion-kit';
import { copyTemplate, MissingTemplateError } from '@cuttle/motion-kit/files';
import { newId, usedIds } from '@cuttle/project';
import { CliError } from '../errors';
import { runInElectron } from '../electron-runner';
import type { Output } from '../output';

const NAME = /^[a-z0-9][a-z0-9-]{0,47}$/;
const isInside = (dir: string, path: string): boolean => {
  const rel = relative(dir, path);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

/** `cuttle music templates`: the music pages `music new` copies. */
export async function musicTemplatesCommand(output: Output): Promise<{ templates: readonly MusicTemplate[] }> {
  const result = { templates: MUSIC_TEMPLATES };
  output.result(result, () => MUSIC_TEMPLATES.map((template) => `${template.name.padEnd(12)} ${template.description}`).join('\n'));
  return result;
}

export interface MusicNewResult {
  template: string;
  /** The page, from the project folder. */
  src: string;
  music: Record<string, unknown>;
}

/**
 * `cuttle music new <template>`: copies a music template into `music/<name>/` and makes it the
 * project's music (its level and duck stay when the project had music before).
 */
export async function musicNewCommand(projectDir: string, template: string, args: { name?: string }, output: Output): Promise<MusicNewResult> {
  if (!MUSIC_TEMPLATES.some((candidate) => candidate.name === template)) {
    throw new CliError('usage', `no music template "${template}" (${MUSIC_TEMPLATES.map((candidate) => candidate.name).join(', ')})`);
  }
  const name = args.name ?? template;
  if (!NAME.test(name)) throw new CliError('usage', `--name "${name}" must be lower-case letters, digits and dashes`);
  const file = await readProjectFile(projectDir);
  let src: string;
  try {
    src = await copyTemplate(file.dir, `music-${template}`, name, import.meta.url, 'music');
  } catch (error) {
    if (error instanceof MissingTemplateError) throw new CliError('missing-file', `${error.message}: build the CLI again`);
    throw error;
  }
  const before = (file.raw.music as Record<string, unknown> | undefined) ?? {};
  const music: Record<string, unknown> = { ...before, src, params: {}, enabled: true };
  file.raw.music = music;
  await writeProjectFile(file, 'music new');
  const result: MusicNewResult = { template, src, music };
  output.result(result, () => `the music is ${src} now (${template}); hear it with "cuttle music check"`);
  return result;
}

export interface MusicSetArgs {
  volume?: number;
  duck?: number;
  /** `name=value` pairs for the page's params ("" removes one). */
  param?: string[];
  /** `name=level` pairs for the music's stems (0 silent, 1 as composed, up to 2; "" as composed). */
  stem?: string[];
  on?: boolean;
  off?: boolean;
  src?: string;
}

/** A param's value from the command line: a number, true or false, null, else the text. */
function paramValue(text: string): string | number | boolean | null {
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null') return null;
  if (text.trim() !== '' && Number.isFinite(Number(text))) return Number(text);
  return text;
}

/** `cuttle music set`: the music's level, duck, params, page, or on and off. */
export async function musicSetCommand(projectDir: string, args: MusicSetArgs, output: Output): Promise<{ music: Record<string, unknown> }> {
  if (args.on && args.off) throw new CliError('usage', '--on and --off together');
  const file = await readProjectFile(projectDir);
  const music = { ...((file.raw.music as Record<string, unknown> | undefined) ?? {}) };
  if (args.src !== undefined) {
    const path = resolve(file.dir, args.src);
    if (!isInside(file.dir, path)) throw new CliError('usage', `${args.src} is not in the project folder`);
    if (!(await stat(path).then((info) => info.isFile(), () => false))) throw new CliError('missing-file', `no page at ${args.src}`);
    music.src = relative(file.dir, path).split(sep).join('/');
  }
  if (music.src === undefined) throw new CliError('invalid-project', 'the project has no music: add a page with "cuttle music new <template>" first');
  if (args.volume !== undefined) music.volume = args.volume;
  if (args.duck !== undefined) music.duck = args.duck;
  if (args.on) music.enabled = true;
  if (args.off) music.enabled = false;
  if (args.param?.length) {
    const params = { ...((music.params as Record<string, unknown> | undefined) ?? {}) };
    for (const pair of args.param) {
      const at = pair.indexOf('=');
      if (at <= 0) throw new CliError('usage', `--param ${pair}: write name=value`);
      const name = pair.slice(0, at);
      const value = pair.slice(at + 1);
      if (value === '') delete params[name];
      else params[name] = paramValue(value);
    }
    music.params = params;
  }
  if (args.stem?.length) {
    const stems = { ...((music.stems as Record<string, number> | undefined) ?? {}) };
    for (const pair of args.stem) {
      const at = pair.indexOf('=');
      const name = at > 0 ? pair.slice(0, at) : '';
      const text = pair.slice(at + 1);
      if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new CliError('usage', `--stem ${pair}: write name=level (drums=0.5), the name in lower case`);
      const level = Number(text);
      if (text !== '' && !(Number.isFinite(level) && level >= 0 && level <= 2)) throw new CliError('usage', `--stem ${pair}: a level from 0 (silent) to 2, 1 as composed`);
      // as composed: left out
      if (text === '' || level === 1) delete stems[name];
      else stems[name] = level;
    }
    if (Object.keys(stems).length > 0) music.stems = stems;
    else delete music.stems;
  }
  file.raw.music = music;
  await writeProjectFile(file, 'music set');
  output.result({ music }, () => `music: ${JSON.stringify(music)}`);
  return { music };
}

/** What `cuttle music check` reports (see @cuttle/export's checkMusic). */
export interface MusicCheckReport {
  out: string;
  sheet?: string;
  seconds: number;
  src?: string;
  info: { bpm?: number; key?: string; sections?: unknown[] } | null;
  /** The music's stems, whose levels `music set --stem` sets. */
  stems: string[];
  loudness: { lufs: number | null; truePeak: number | null };
  parts: { name: string; start: number; end: number; energy?: number; musicDb: number; effectsDb: number }[];
  cuts: { t: number; hit: boolean; riseDb: number }[];
  peaks: { music: number; effects: number };
  nodes: number;
  renderMs: number;
  skipped: string[];
  errors: string[];
  console: string[];
}

/**
 * `cuttle music check`: renders the music and sounds alone (no frames) into a WAV and a sheet, and
 * says what they came to: loudness, each part's level, the hits on the scene changes, the page's errors.
 */
export async function musicCheckCommand(projectDir: string, args: { src?: string; out?: string }, output: Output, signal: AbortSignal): Promise<MusicCheckReport> {
  const file = await readProjectFile(projectDir);
  let src: string | undefined;
  if (args.src !== undefined) {
    const path = resolve(file.dir, args.src);
    if (!isInside(file.dir, path)) throw new CliError('usage', `${args.src} is not in the project folder`);
    if (!(await stat(path).then((info) => info.isFile(), () => false))) throw new CliError('missing-file', `no page at ${args.src}`);
    src = relative(file.dir, path).split(sep).join('/');
  }
  const outDir = args.out ? resolve(args.out) : join(file.dir, 'preview');
  output.info('rendering the music and sounds …');
  const result = await runInElectron<MusicCheckReport>(
    { command: 'music', projectDir: file.dir, out: join(outDir, 'music.wav'), sheet: join(outDir, 'music.png'), ...(src && { src }), quiet: output.json },
    signal,
  );
  output.result(result, () =>
    [
      `${result.src ?? 'the sounds'}: ${result.seconds.toFixed(1)} s${result.info?.bpm ? `, ${result.info.bpm} BPM` : ''}${result.info?.key ? `, ${result.info.key}` : ''}`,
      `loudness ${result.loudness.lufs ?? '?'} LUFS, true peak ${result.loudness.truePeak ?? '?'} dBFS (music and sounds alone)`,
      ...(result.stems.length > 0 ? [`stems: ${result.stems.join(', ')} (music set --stem name=level)`] : []),
      ...result.parts.map((part) => `  ${part.start.toFixed(1).padStart(6)}–${part.end.toFixed(1).padEnd(6)} ${part.name.padEnd(12)} ${part.energy !== undefined ? `energy ${part.energy}  ` : ''}music ${part.musicDb} dB, effects ${part.effectsDb} dB`),
      `scene changes: ${result.cuts.filter((cut) => cut.hit).length} of ${result.cuts.length} hit${result.cuts.some((cut) => !cut.hit) ? ` (none at ${result.cuts.filter((cut) => !cut.hit).map((cut) => `${cut.t.toFixed(2)} s`).join(', ')})` : ''}`,
      `wav    ${result.out}`,
      ...(result.sheet ? [`sheet  ${result.sheet}`] : []),
      ...(result.skipped.length > 0 ? [`skipped:\n${result.skipped.map((line) => `  ${line}`).join('\n')}`] : []),
      result.errors.length > 0 ? `errors:\n${result.errors.map((line) => `  ${line}`).join('\n')}` : 'no errors',
      ...(result.console.length > 0 ? [`console:\n${result.console.map((line) => `  ${line}`).join('\n')}`] : []),
    ].join('\n'),
  );
  return result;
}

/** `cuttle sound list`: the built-in sounds. */
export async function soundListCommand(output: Output): Promise<{ sounds: { name: string; description: string }[] }> {
  const sounds = BUILT_IN_SOUNDS.map(([name, description]) => ({ name, description }));
  output.result({ sounds }, () => sounds.map((sound) => `${sound.name.padEnd(15)} ${sound.description}`).join('\n'));
  return { sounds };
}

export interface SoundAddArgs {
  /** Source seconds, or seconds into `scene`. */
  at: number;
  scene?: string;
  volume?: number;
  label?: string;
}

/**
 * `cuttle sound add <sound> --at <seconds>`: a built-in sound or a file of the project at a moment of
 * the take (source seconds: it plays wherever the video shows that moment), or `--scene <id>` seconds
 * into a scene.
 */
export async function soundAddCommand(projectDir: string, sound: string, args: SoundAddArgs, output: Output): Promise<{ sound: Record<string, unknown> }> {
  const file = await readProjectFile(projectDir);
  let name = sound;
  if (!BUILT_IN_SOUNDS.some(([builtIn]) => builtIn === sound)) {
    const path = resolve(file.dir, sound);
    const isFile = isInside(file.dir, path) && (await stat(path).then((info) => info.isFile(), () => false));
    if (!isFile) throw new CliError('usage', `"${sound}" is neither a built-in sound (cuttle sound list) nor a file in the project`);
    if (!/\.(wav|mp3|m4a|ogg|flac|aac)$/i.test(path)) throw new CliError('usage', `${sound}: a sound file is a WAV, MP3, M4A, OGG, FLAC or AAC`);
    name = relative(file.dir, path).split(sep).join('/');
  }
  if (args.scene !== undefined && !file.project.scenes.some((scene) => scene.id === args.scene)) {
    throw new CliError('usage', `--scene ${args.scene}: no scene has that id`);
  }
  const item: Record<string, unknown> = {
    id: newId('sounds', usedIds(file.project)),
    ...(args.label !== undefined && { label: args.label }),
    sound: name,
    at: args.at,
    ...(args.scene !== undefined && { scene: args.scene }),
    ...(args.volume !== undefined && { volume: args.volume }),
  };
  file.raw.sounds = [...((file.raw.sounds as unknown[] | undefined) ?? []), item];
  await writeProjectFile(file, 'sound add');
  output.result({ sound: item }, () => `added ${name} ${args.scene ? `${args.at} s into ${args.scene}` : `at source ${args.at} s`} (${String(item.id)})`);
  return { sound: item };
}
