// The narration's renders: each line's sound is kept in the project's voiceover/ folder under a key
// made of what it depends on (its voice and its text, or its file), so the same line is never spoken
// twice and a changed one is spoken anew. Pure, so the editor finds a line's sound as the export does.
import { z } from 'zod';
import { formatPath, type ProjectIssue } from './parse';
import type { Voice, VoiceLine, Voiceover } from './schema';

/** The folder of the project the renders are kept in. */
export const VOICEOVER_DIR = 'voiceover';
/** The render files' format version. */
export const VOICE_RENDER_VERSION = 1;

/**
 * `voiceover/<key>.json`, next to the line's sound `<key>.wav` (48 kHz, mono, 32-bit float): how
 * long it is, its words in seconds of the line (its subtitles), and who spoke it.
 */
export const VoiceRenderSchema = z.strictObject({
  version: z.literal(VOICE_RENDER_VERSION),
  seconds: z.number().nonnegative(),
  words: z.array(z.strictObject({ t: z.number().nonnegative(), end: z.number().nonnegative(), text: z.string() })),
  /** For people: the voice (`local de_DE-thorsten-medium`, `elevenlabs <id>`) or the file. */
  voice: z.string(),
  /** A file's line: the file's size and change time when it was read (a changed file is read again). */
  source: z.strictObject({ bytes: z.number().nonnegative(), mtimeMs: z.number() }).optional(),
});

export type VoiceRender = z.output<typeof VoiceRenderSchema>;

export type VoiceRenderParseResult = { ok: true; render: VoiceRender } | { ok: false; issues: ProjectIssue[] };

export function parseVoiceRender(text: string): VoiceRenderParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, issues: [{ path: '(root)', message: `not valid JSON: ${(error as Error).message}` }] };
  }
  const result = VoiceRenderSchema.safeParse(raw);
  if (result.success) return { ok: true, render: result.data };
  return { ok: false, issues: result.error.issues.map((issue) => ({ path: formatPath(issue.path), message: issue.message })) };
}

/** Whether a line is heard: on, and with its text or a file (an empty line is still being written). */
export function speaks(line: VoiceLine): boolean {
  return line.enabled && (line.file !== undefined || line.text.trim() !== '');
}

/** The voice that speaks a line: its own, else the narration's; none for a file's line. */
export function lineVoice(voiceover: Pick<Voiceover, 'voice'>, line: VoiceLine): Voice | undefined {
  return line.file !== undefined ? undefined : (line.voice ?? voiceover.voice);
}

/** FNV-1a, 64 bits, over the text's UTF-16 code units (low byte, then high), as 16 hex digits. */
function fnv64(text: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    for (const byte of [unit & 0xff, unit >> 8]) {
      hash ^= BigInt(byte);
      hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
    }
  }
  return hash.toString(16).padStart(16, '0');
}

/** A line's key: its voice (every setting that changes the sound) and its text, or its file and text. */
export function voiceLineKey(voiceover: Pick<Voiceover, 'voice'>, line: VoiceLine): string {
  const voice = lineVoice(voiceover, line);
  const what =
    line.file !== undefined
      ? { file: line.file.replaceAll('\\', '/'), text: line.text }
      : { provider: voice?.provider, id: voice?.id, speed: voice?.speed, model: voice?.model, stability: voice?.stability, similarity: voice?.similarity, style: voice?.style, text: line.text.trim() };
  return fnv64(JSON.stringify(what));
}

/** A line's render files, relative to the project. */
export function voiceRenderFiles(key: string): { sound: string; render: string } {
  return { sound: `${VOICEOVER_DIR}/${key}.wav`, render: `${VOICEOVER_DIR}/${key}.json` };
}
