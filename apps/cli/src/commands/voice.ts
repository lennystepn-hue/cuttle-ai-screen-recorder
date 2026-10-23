// `cuttle voice`: the narration. Voices on this computer (Piper's, downloaded once) or ElevenLabs' by
// their ID; lines of text at moments of the video, spoken into the project's voiceover/ folder.
import { stat } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { DEFAULT_VOICE, LOCAL_VOICES, downloadVoice, elevenLabsKey, elevenLabsVoices, localVoice, modelsDir, readProjectFile, removeVoice, renderVoiceover, voiceDir, voiceInstalled, writeProjectFile } from '@cuttle/core';
import { VOICE_LINE_MAX, newId, usedIds } from '@cuttle/project';
import { narrationCues } from '@cuttle/timeline';
import { CliError } from '../errors';
import type { Output } from '../output';
import { percentSteps } from './transcribe';

const megabytes = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;

/** `cuttle voice list`: the local voices and which are downloaded; with `elevenlabs`, the voices of the ElevenLabs account. */
export async function voiceListCommand(args: { elevenlabs?: boolean }, output: Output): Promise<unknown> {
  if (args.elevenlabs) {
    const voices = await elevenLabsVoices(elevenLabsKey());
    const result = { provider: 'elevenlabs', voices };
    output.result(result, () => [...voices.map((voice) => `${voice.id}  ${voice.name}${voice.description ? `  (${voice.description})` : ''}`), 'use one: cuttle voice use <id> --elevenlabs'].join('\n'));
    return result;
  }
  const result = {
    provider: 'local',
    dir: `${modelsDir()}${sep}voices`,
    voices: LOCAL_VOICES.map((voice) => ({ name: voice.name, label: voice.label, language: voice.language, bytes: voice.bytes, installed: voiceInstalled(voice.name), default: voice.name === DEFAULT_VOICE })),
  };
  output.result(result, () =>
    [
      ...result.voices.map((voice) => `${voice.installed ? '✓' : ' '} ${voice.name.padEnd(24)} ${voice.label.padEnd(9)} ${voice.language.padEnd(13)} ${megabytes(voice.bytes).padStart(6)}${voice.default ? ' (default)' : ''}`),
      `kept in ${result.dir}; ElevenLabs' voices: cuttle voice list --elevenlabs (needs ELEVENLABS_API_KEY)`,
    ].join('\n'),
  );
  return result;
}

/** `cuttle voice download <name>`: a local voice, once, checked by its size and checksum. */
export async function voiceDownloadCommand(name: string, output: Output, signal: AbortSignal): Promise<{ name: string; dir: string }> {
  const voice = localVoice(name);
  output.info(`downloading the voice ${voice.name} (${voice.label}, ${voice.language}, ${megabytes(voice.bytes)}) …`);
  const report = percentSteps((percent) => output.info(`downloading … ${percent} %`), 10);
  const dir = await downloadVoice(voice.name, { signal, onProgress: (received, total) => report(received / total) });
  const result = { name: voice.name, dir };
  output.result(result, () => `${voice.name} is ready (${dir})`);
  return result;
}

/** `cuttle voice remove <name>`: removes a downloaded voice. */
export async function voiceRemoveCommand(name: string, output: Output): Promise<{ name: string; removed: string }> {
  const voice = localVoice(name);
  await removeVoice(voice.name);
  const result = { name: voice.name, removed: voiceDir(voice.name) };
  output.result(result, () => `removed ${result.removed}`);
  return result;
}

export interface VoiceUseArgs {
  elevenlabs?: boolean;
  model?: string;
  speed?: number;
  stability?: number;
  similarity?: number;
  style?: number;
}

/** The voice the options describe, as cuttle.json writes it. */
function voiceOf(id: string, args: VoiceUseArgs): Record<string, unknown> {
  if (!args.elevenlabs) {
    localVoice(id);
    if (args.model !== undefined || args.stability !== undefined || args.similarity !== undefined || args.style !== undefined) {
      throw new CliError('usage', '--model, --stability, --similarity and --style are ElevenLabs\' settings: add --elevenlabs');
    }
  }
  return {
    provider: args.elevenlabs ? 'elevenlabs' : 'local',
    id,
    ...(args.speed !== undefined && { speed: args.speed }),
    ...(args.model !== undefined && { model: args.model }),
    ...(args.stability !== undefined && { stability: args.stability }),
    ...(args.similarity !== undefined && { similarity: args.similarity }),
    ...(args.style !== undefined && { style: args.style }),
  };
}

/** `cuttle voice use <id>`: the narration's voice, a local one by name or (`--elevenlabs`) ElevenLabs' by its voice ID. */
export async function voiceUseCommand(projectDir: string, id: string, args: VoiceUseArgs, output: Output): Promise<{ voice: Record<string, unknown> }> {
  const file = await readProjectFile(projectDir);
  const voice = voiceOf(id, args);
  file.raw.voiceover = { ...((file.raw.voiceover as Record<string, unknown> | undefined) ?? {}), voice };
  await writeProjectFile(file, 'voice use');
  const missing = !args.elevenlabs && !voiceInstalled(id);
  output.result({ voice }, () => `the narration speaks with ${args.elevenlabs ? `ElevenLabs' voice ${id}` : id}${missing ? `; download it: cuttle voice download ${id}` : ''}`);
  return { voice };
}

export interface VoiceAddArgs extends VoiceUseArgs {
  at: number;
  scene?: string;
  /** A voice for this line alone (else the narration's). */
  voice?: string;
  /** A recording made elsewhere, played instead of a voice (its text: what it says, for the subtitles). */
  file?: string;
  volume?: number;
  label?: string;
}

/** `cuttle voice add "<text>"`: a line of the narration at a moment of the video. */
export async function voiceAddCommand(projectDir: string, text: string, args: VoiceAddArgs, output: Output): Promise<{ line: Record<string, unknown> }> {
  const file = await readProjectFile(projectDir);
  if (text.length > VOICE_LINE_MAX) throw new CliError('usage', `a line holds at most ${VOICE_LINE_MAX} characters: split it`);
  if (text.trim() === '' && args.file === undefined) throw new CliError('usage', 'a line needs its text (or --file)');
  if (args.scene !== undefined && !file.project.scenes.some((scene) => scene.id === args.scene)) throw new CliError('usage', `--scene ${args.scene}: no scene has that id`);
  let recording: string | undefined;
  if (args.file !== undefined) {
    const path = resolve(file.dir, args.file);
    const rel = relative(file.dir, path);
    const isFile = await stat(path).then((info) => info.isFile(), () => false);
    if (!isFile || rel.startsWith('..')) throw new CliError('usage', `--file ${args.file}: not a file in the project`);
    if (!/\.(wav|mp3|m4a|ogg|flac|aac)$/i.test(path)) throw new CliError('usage', `--file ${args.file}: a recording is a WAV, MP3, M4A, OGG, FLAC or AAC`);
    recording = rel.split(sep).join('/');
  }
  const voiceover = (file.raw.voiceover as Record<string, unknown> | undefined) ?? {};
  if (recording === undefined && args.voice === undefined && voiceover.voice === undefined) {
    throw new CliError('usage', `the narration has no voice yet: cuttle voice use ${DEFAULT_VOICE} (cuttle voice list), or --voice for this line`);
  }
  const line: Record<string, unknown> = {
    id: newId('voiceover', usedIds(file.raw)),
    ...(args.label !== undefined && { label: args.label }),
    text,
    at: args.at,
    ...(args.scene !== undefined && { scene: args.scene }),
    ...(args.voice !== undefined && { voice: voiceOf(args.voice, args) }),
    ...(recording !== undefined && { file: recording }),
    ...(args.volume !== undefined && { volume: args.volume }),
  };
  file.raw.voiceover = { ...voiceover, lines: [...((voiceover.lines as unknown[] | undefined) ?? []), line] };
  await writeProjectFile(file, 'voice add');
  output.result({ line }, () => `added ${String(line.id)} ${args.scene ? `${args.at} s into ${args.scene}` : `at source ${args.at} s`}; speak it: cuttle voice render`);
  return { line };
}

/** `cuttle voice render`: speaks every line not spoken yet into voiceover/, and says where each plays and how long it is. */
export async function voiceRenderCommand(projectDir: string, output: Output, signal: AbortSignal): Promise<unknown> {
  const file = await readProjectFile(projectDir);
  const project = file.project;
  const rendered = await renderVoiceover(file.dir, project, {
    signal,
    onLine: (line, index, done, total) => output.info(`speaking ${line.id ?? `#${index + 1}`} (${done + 1} of ${total}) …`),
  });
  const { cues, left } = narrationCues(project);
  const at = new Map(cues.map((cue) => [cue.index, cue.at]));
  const lines = rendered.map((line) => {
    const item = project.voiceover.lines[line.index]!;
    return {
      ...(item.id !== undefined && { id: item.id }),
      index: line.index,
      sound: line.sound,
      seconds: line.render.seconds,
      words: line.render.words.length,
      spoken: line.fresh,
      ...(at.has(line.index) && { at: at.get(line.index) }),
    };
  });
  // a line that ends where the next begins would talk over it
  const overlaps = cues.flatMap((cue, i) => {
    const next = cues[i + 1];
    const seconds = rendered.find((line) => line.index === cue.index)?.render.seconds ?? 0;
    return next && cue.at + seconds > next.at + 0.05 ? [`${cue.line.id ?? `#${cue.index + 1}`} runs into ${next.line.id ?? `#${next.index + 1}`} by ${(cue.at + seconds - next.at).toFixed(1)} s`] : [];
  });
  const notes = [...left.map((index) => `${project.voiceover.lines[index]!.id ?? `#${index + 1}`} plays nowhere: no clip shows its second (or it starts after its scene ends)`), ...overlaps];
  const result = { lines, notes };
  output.result(result, () =>
    [
      ...lines.map((line) => `${line.id ?? `#${line.index + 1}`}  ${line.seconds.toFixed(1)} s, ${line.words} words${line.at !== undefined ? `, at ${line.at.toFixed(1)} s of the video` : ''}${line.spoken ? '' : ' (spoken before)'}`),
      ...notes.map((note) => `note: ${note}`),
    ].join('\n') || 'the narration has no lines: cuttle voice add "<text>" --at <seconds>',
  );
  return result;
}
