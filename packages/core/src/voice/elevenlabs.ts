// ElevenLabs speaking a line: a voice by its ID (as their voice library shows it), with its model and
// settings, through their API, with the time of each character, from which the words' times come.
// The key comes from ELEVENLABS_API_KEY or the app's settings (kept with the system's keychain);
// it is never written into the project.
import type { Voice } from '@cuttle/project';
import { CoreError } from '../errors';
import type { HeardWord } from '../speech/whisper';

/** The API, or `CUTTLE_ELEVENLABS_URL` (for the checks: a local stand-in). */
const api = () => (process.env.CUTTLE_ELEVENLABS_URL || 'https://api.elevenlabs.io').replace(/\/$/, '');

/** The model a voice speaks with when it names none. */
export const ELEVENLABS_MODEL = 'eleven_multilingual_v2';

/** ElevenLabs' answer with timestamps: the audio, and when each character is spoken. */
interface Timed {
  audio_base64: string;
  alignment?: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] } | null;
}

/** The key: the one given, else ELEVENLABS_API_KEY. */
export function elevenLabsKey(given?: string): string {
  const key = given || process.env.ELEVENLABS_API_KEY;
  if (!key) throw new CoreError('voice-key', 'ElevenLabs needs an API key: set ELEVENLABS_API_KEY (or add it in the app, Settings > Speech)');
  return key;
}

/** What ElevenLabs said went wrong, from its JSON (`{ "detail": { "message" } }`) or its text. */
async function refusal(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  try {
    const body = JSON.parse(text) as { detail?: { message?: string } | string };
    const detail = typeof body.detail === 'string' ? body.detail : body.detail?.message;
    if (detail) return detail;
  } catch {
    // not JSON
  }
  return text.trim().slice(0, 300) || response.statusText;
}

/** The words in a line's characters and their times: runs of characters between spaces. */
export function wordsFromCharacters(alignment: NonNullable<Timed['alignment']>): HeardWord[] {
  const words: HeardWord[] = [];
  let word: HeardWord | undefined;
  alignment.characters.forEach((character, i) => {
    const start = alignment.character_start_times_seconds[i] ?? 0;
    const end = alignment.character_end_times_seconds[i] ?? start;
    if (/\s/.test(character)) {
      word = undefined;
      return;
    }
    if (!word) {
      word = { t: start, end, text: '' };
      words.push(word);
    }
    word.text += character;
    word.end = Math.max(word.end, end);
  });
  return words.map((each) => ({ t: Math.round(each.t * 1000) / 1000, end: Math.round(each.end * 1000) / 1000, text: each.text }));
}

/** `text` spoken by an ElevenLabs voice: its MP3 and its words (seconds of the line). */
export async function speakElevenLabs(voice: Voice, text: string, key: string, signal?: AbortSignal): Promise<{ mp3: Buffer; words: HeardWord[] }> {
  let response: Response;
  try {
    response = await fetch(`${api()}/v1/text-to-speech/${encodeURIComponent(voice.id)}/with-timestamps?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        text,
        model_id: voice.model ?? ELEVENLABS_MODEL,
        voice_settings: {
          stability: voice.stability ?? 0.5,
          similarity_boost: voice.similarity ?? 0.75,
          style: voice.style ?? 0,
          // ElevenLabs speaks from 0.7 to 1.2 times its pace
          speed: Math.min(1.2, Math.max(0.7, voice.speed)),
        },
      }),
      ...(signal && { signal }),
    });
  } catch (error) {
    if (signal?.aborted) throw new CoreError('cancelled', 'the narration was cancelled');
    throw new CoreError('voice', `ElevenLabs cannot be reached: ${(error as Error).message}`, { cause: error });
  }
  if (response.status === 401) throw new CoreError('voice-key', `ElevenLabs refused the API key: ${await refusal(response)}`);
  if (!response.ok) throw new CoreError('voice', `ElevenLabs did not speak the line (HTTP ${response.status}): ${await refusal(response)}`);
  const body = (await response.json()) as Timed;
  if (typeof body.audio_base64 !== 'string' || body.audio_base64 === '') throw new CoreError('voice', 'ElevenLabs answered without audio');
  return { mp3: Buffer.from(body.audio_base64, 'base64'), words: body.alignment ? wordsFromCharacters(body.alignment) : [] };
}

/** The voices of the account the key belongs to: its own and those it added from the library. */
export async function elevenLabsVoices(key: string): Promise<{ id: string; name: string; description?: string }[]> {
  let response: Response;
  try {
    response = await fetch(`${api()}/v1/voices`, { headers: { 'xi-api-key': key, accept: 'application/json' } });
  } catch (error) {
    throw new CoreError('voice', `ElevenLabs cannot be reached: ${(error as Error).message}`, { cause: error });
  }
  if (response.status === 401) throw new CoreError('voice-key', `ElevenLabs refused the API key: ${await refusal(response)}`);
  if (!response.ok) throw new CoreError('voice', `ElevenLabs did not list the voices (HTTP ${response.status}): ${await refusal(response)}`);
  const body = (await response.json()) as { voices?: { voice_id: string; name: string; description?: string | null; labels?: Record<string, string> }[] };
  return (body.voices ?? []).map((voice) => ({
    id: voice.voice_id,
    name: voice.name,
    ...((voice.description || voice.labels) && { description: voice.description || Object.values(voice.labels ?? {}).join(', ') }),
  }));
}
