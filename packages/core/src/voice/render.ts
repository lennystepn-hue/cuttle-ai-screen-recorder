// The narration's lines as sound: each enabled line spoken by its voice (a local one, ElevenLabs'),
// or its file converted, into the project's voiceover/ folder under its key (voiceLineKey), as
// 48 kHz mono float WAV with a JSON of its length and words. A line already there is not spoken
// again; the export and the editor read what this wrote.
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { VOICEOVER_DIR, VOICE_RENDER_VERSION, lineVoice, speaks, parseVoiceRender, voiceLineKey, voiceRenderFiles, type CuttleProject, type VoiceLine, type VoiceRender } from '@cuttle/project';
import { CoreError } from '../errors';
import { runFfmpeg } from '../ffmpeg';
import { elevenLabsKey, speakElevenLabs } from './elevenlabs';
import { speakLocal } from './local';
import { spokenWords } from './words';

/** The renders' sample rate: the export's. */
export const VOICE_RATE = 48_000;

export interface VoiceoverOptions {
  /** ElevenLabs' API key, for lines in its voices (else ELEVENLABS_API_KEY). */
  elevenLabsKey?: string;
  signal?: AbortSignal;
  /** Called before each line that is spoken (not for one already there). */
  onLine?: (line: VoiceLine, index: number, done: number, total: number) => void;
}

/** A line as sound: its key, its files (relative to the project), and what the render says. */
export interface RenderedLine {
  index: number;
  key: string;
  sound: string;
  render: VoiceRender;
  /** Spoken (or converted) now, not found from before. */
  fresh: boolean;
}

/** The WAV's settings every render has. */
const WAV = ['-ar', String(VOICE_RATE), '-ac', '1', '-c:a', 'pcm_f32le', '-f', 'wav'];

/** The render of `key` when it is there and whole; undefined otherwise. */
export async function readRender(projectDir: string, key: string): Promise<VoiceRender | undefined> {
  const files = voiceRenderFiles(key);
  if (!existsSync(join(projectDir, files.sound))) return undefined;
  const text = await readFile(join(projectDir, files.render), 'utf8').catch(() => undefined);
  const parsed = text === undefined ? undefined : parseVoiceRender(text);
  return parsed?.ok ? parsed.render : undefined;
}

/** The sound's length in seconds, from ffmpeg's reading of it. */
async function soundSeconds(path: string): Promise<number> {
  const { stderr } = await runFfmpeg(['-i', path, '-map', '0:a:0', '-f', 'null', '-']);
  const time = [...stderr.matchAll(/time=(\d+):(\d\d):(\d\d(?:\.\d+)?)/g)].at(-1);
  return time ? Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]) : 0;
}

/** Speaks (or converts) one line into its files; returns its render. */
async function renderLine(projectDir: string, project: CuttleProject, line: VoiceLine, key: string, options: VoiceoverOptions): Promise<VoiceRender> {
  const files = voiceRenderFiles(key);
  const sound = join(projectDir, files.sound);
  const part = `${sound}.part.wav`;
  await mkdir(join(projectDir, VOICEOVER_DIR), { recursive: true });
  try {
    let words: VoiceRender['words'] | undefined;
    let voice: string;
    let source: VoiceRender['source'];
    if (line.file !== undefined) {
      const path = isAbsolute(line.file) ? line.file : resolve(projectDir, line.file);
      const info = await stat(path).catch(() => undefined);
      if (!info) throw new CoreError('missing-file', `the narration's file ${line.file} is missing`);
      await runFfmpeg(['-y', '-i', path, '-map', '0:a:0', ...WAV, part]);
      voice = `file ${line.file}`;
      source = { bytes: info.size, mtimeMs: Math.round(info.mtimeMs) };
    } else {
      const chosen = lineVoice(project.voiceover, line);
      if (!chosen) throw new CoreError('usage', 'a line needs a voice: its own, or voiceover.voice');
      voice = `${chosen.provider} ${chosen.id}`;
      if (chosen.provider === 'local') {
        const spoken = await speakLocal(chosen.id, line.text.trim(), chosen.speed);
        const raw = `${sound}.part.f32`;
        await writeFile(raw, Buffer.from(spoken.samples.buffer, spoken.samples.byteOffset, spoken.samples.byteLength));
        try {
          await runFfmpeg(['-y', '-f', 'f32le', '-ar', String(spoken.rate), '-ac', '1', '-i', raw, ...WAV, part]);
        } finally {
          await rm(raw, { force: true });
        }
      } else {
        const spoken = await speakElevenLabs(chosen, line.text.trim(), elevenLabsKey(options.elevenLabsKey), options.signal);
        const mp3 = `${sound}.part.mp3`;
        await writeFile(mp3, spoken.mp3);
        try {
          await runFfmpeg(['-y', '-i', mp3, ...WAV, part]);
        } finally {
          await rm(mp3, { force: true });
        }
        if (spoken.words.length > 0) words = spoken.words;
      }
    }
    const seconds = await soundSeconds(part);
    const render: VoiceRender = {
      version: VOICE_RENDER_VERSION,
      seconds: Math.round(seconds * 1000) / 1000,
      words: words ?? (await spokenWords(part, line.text, seconds, options.signal)),
      voice,
      ...(source && { source }),
    };
    await rm(sound, { force: true });
    await rename(part, sound);
    await writeFile(join(projectDir, files.render), `${JSON.stringify(render, null, 2)}\n`);
    return render;
  } finally {
    await rm(part, { force: true }).catch(() => {});
  }
}

/** Whether a file's line has to be read again: its file changed since its render. */
async function fileChanged(projectDir: string, line: VoiceLine, render: VoiceRender): Promise<boolean> {
  if (line.file === undefined) return false;
  const info = await stat(isAbsolute(line.file) ? line.file : resolve(projectDir, line.file)).catch(() => undefined);
  return !info || !render.source || info.size !== render.source.bytes || Math.round(info.mtimeMs) !== render.source.mtimeMs;
}

/**
 * Every line of the narration that speaks (on, with text or a file) as sound: those already rendered are read, the others spoken
 * (in the order of the lines). Fails on the first line that cannot be spoken, keeping the ones done.
 */
export async function renderVoiceover(projectDir: string, project: CuttleProject, options: VoiceoverOptions = {}): Promise<RenderedLine[]> {
  const lines = project.voiceover.lines.map((line, index) => ({ line, index })).filter(({ line }) => speaks(line));
  const results: RenderedLine[] = [];
  const missing: { line: VoiceLine; index: number; key: string }[] = [];
  for (const { line, index } of lines) {
    const key = voiceLineKey(project.voiceover, line);
    const render = await readRender(projectDir, key);
    if (render && !(await fileChanged(projectDir, line, render))) results.push({ index, key, sound: voiceRenderFiles(key).sound, render, fresh: false });
    else missing.push({ line, index, key });
  }
  for (const [done, { line, index, key }] of missing.entries()) {
    if (options.signal?.aborted) throw new CoreError('cancelled', 'the narration was cancelled');
    options.onLine?.(line, index, done, missing.length);
    const render = await renderLine(projectDir, project, line, key, options);
    results.push({ index, key, sound: voiceRenderFiles(key).sound, render, fresh: true });
  }
  return results.sort((a, b) => a.index - b.index);
}
