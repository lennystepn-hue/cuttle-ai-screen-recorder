// The narration in an export: each enabled line's sound as `cuttle voice render` (or the app) left it
// in the project's voiceover/ folder, placed on the video (narrationCues) and mixed block by block
// into one WAV as long as the video, at the line's and the narration's volume; its words, in output
// seconds, for the captions and for the music and the computer's sound to go down under.
import { open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseVoiceRender, speaks, voiceLineKey, voiceRenderFiles, type CuttleProject, type VoiceRender } from '@cuttle/project';
import { narrationCues, narrationWords, type CaptionWord, type SceneSpan } from '@cuttle/timeline';
import { AUDIO_SAMPLE_RATE } from '../audio';
import { ExportError } from '../errors';
import { wavHeader } from './typing-track';

/** A rendered line of the narration: its sound (absolute path) and its render. */
export interface NarrationLine {
  index: number;
  sound: string;
  render: VoiceRender;
}

/** A line on the video: where it starts (output seconds), how loud, and its sound. */
export interface PlacedLine extends NarrationLine {
  at: number;
  volume: number;
}

/** Samples mixed at a time: 10 s. */
const BLOCK = AUDIO_SAMPLE_RATE * 10;

/**
 * The narration's enabled lines as rendered. A line not rendered yet (or rendered for another text
 * or voice) stops the export: its sound comes from `cuttle voice render`, which the app runs itself;
 * with `skipMissing` (stills, which only show its words) it is left out.
 */
export async function loadNarration(projectDir: string, project: CuttleProject, skipMissing = false): Promise<NarrationLine[]> {
  const lines: NarrationLine[] = [];
  const missing: number[] = [];
  for (const [index, line] of project.voiceover.lines.entries()) {
    if (!speaks(line)) continue;
    const files = voiceRenderFiles(voiceLineKey(project.voiceover, line));
    const text = await readFile(join(projectDir, files.render), 'utf8').catch(() => undefined);
    const parsed = text === undefined ? undefined : parseVoiceRender(text);
    if (!parsed?.ok) {
      missing.push(index);
      continue;
    }
    lines.push({ index, sound: join(projectDir, files.sound), render: parsed.render });
  }
  if (missing.length > 0 && !skipMissing) {
    const which = missing.map((index) => project.voiceover.lines[index]!.id ?? `#${index + 1}`).join(', ');
    throw new ExportError('missing-file', `the narration is not spoken yet (line ${which}): run "cuttle voice render" first`);
  }
  return lines;
}

/** The lines on the video (in order), the ones no clip shows left out, and their words in output seconds. */
export function placeNarration(project: CuttleProject, spans: readonly SceneSpan[], lines: readonly NarrationLine[]): { placed: PlacedLine[]; words: CaptionWord[]; left: number[] } {
  const byIndex = new Map(lines.map((line) => [line.index, line]));
  const { cues, left } = narrationCues(project, spans);
  const placed = cues.flatMap((cue) => {
    const line = byIndex.get(cue.index);
    return line ? [{ ...line, at: cue.at, volume: cue.line.volume * project.voiceover.volume }] : [];
  });
  const words = narrationWords(cues, (cue) => byIndex.get(cue.index)?.render.words);
  return { placed, words, left };
}

/** The samples of a render's sound (48 kHz mono 32-bit float WAV, as `cuttle voice render` writes it). */
export async function renderSamples(path: string): Promise<Float32Array> {
  const bytes = await readFile(path).catch((error: Error) => {
    throw new ExportError('missing-file', `the narration's sound ${path} cannot be read: ${error.message}`);
  });
  // the chunks after the 12-byte RIFF header: "fmt " says the format, "data" holds the samples
  let at = 12;
  let float = false;
  while (at + 8 <= bytes.length) {
    const id = bytes.toString('latin1', at, at + 4);
    const size = bytes.readUInt32LE(at + 4);
    if (id === 'fmt ') float = bytes.readUInt16LE(at + 8) === 3 && bytes.readUInt16LE(at + 10) === 1 && bytes.readUInt32LE(at + 12) === AUDIO_SAMPLE_RATE && bytes.readUInt16LE(at + 22) === 32;
    if (id === 'data') {
      if (!float) break;
      const length = Math.min(size, bytes.length - at - 8) >> 2;
      const samples = new Float32Array(length);
      for (let i = 0; i < length; i++) samples[i] = bytes.readFloatLE(at + 8 + i * 4);
      return samples;
    }
    at += 8 + size + (size & 1);
  }
  throw new ExportError('invalid-media', `the narration's sound ${path} is not 48 kHz mono float: run "cuttle voice render" again`);
}

/** Mixes the placed lines into a WAV `seconds` long at `path` (16-bit mono at the export's rate). */
export async function writeNarrationTrack(path: string, lines: readonly PlacedLine[], seconds: number): Promise<void> {
  const total = Math.round(seconds * AUDIO_SAMPLE_RATE);
  const sounds = await Promise.all(lines.map(async (line) => ({ start: Math.round(line.at * AUDIO_SAMPLE_RATE), volume: line.volume, samples: await renderSamples(line.sound) })));
  const file = await open(path, 'w');
  try {
    await file.write(wavHeader(total));
    for (let start = 0; start < total; start += BLOCK) {
      const block = new Float32Array(Math.min(BLOCK, total - start));
      for (const sound of sounds) {
        const from = Math.max(start, sound.start);
        const to = Math.min(start + block.length, sound.start + sound.samples.length);
        for (let i = from; i < to; i++) block[i - start]! += sound.samples[i - sound.start]! * sound.volume;
      }
      const bytes = Buffer.alloc(block.length * 2);
      for (let i = 0; i < block.length; i++) bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, block[i]!)) * 32767), i * 2);
      await file.write(bytes);
    }
  } finally {
    await file.close();
  }
}
