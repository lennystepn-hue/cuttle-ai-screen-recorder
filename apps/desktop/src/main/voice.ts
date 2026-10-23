// The narration in the app: the voices on this computer (downloaded once into the models folder the
// CLI shares), ElevenLabs' API key (encrypted with the system's keychain, never in a project), and
// the lines spoken into a project's voiceover/ folder by the media worker.
import { LOCAL_VOICES, downloadVoice, localVoice, readProjectFile, readRender, voiceInstalled } from '@cuttle/core';
import { parseProject, speaks, voiceLineKey } from '@cuttle/project';
import { safeStorage } from 'electron';
import type { VoiceReport } from '../shared/media-jobs';
import type { VoiceState } from '../shared/ipc';
import { mediaWorker } from './media-service';
import { loadSettings, updateSettings } from './settings';

/** The voices on this computer and whether each is downloaded, and whether ElevenLabs has a key. */
export async function voiceState(): Promise<VoiceState> {
  const { voice } = await loadSettings();
  return {
    local: LOCAL_VOICES.map((each) => ({ name: each.name, label: each.label, language: each.language, bytes: each.bytes, installed: voiceInstalled(each.name) })),
    elevenLabs: voice.elevenLabsKey !== undefined || Boolean(process.env.ELEVENLABS_API_KEY),
    downloading: [...downloads.keys()],
  };
}

const downloads = new Map<string, Promise<void>>();

/** Downloads a voice (once; a second request waits for the first). */
export function downloadAppVoice(name: string): Promise<void> {
  localVoice(name);
  const running = downloads.get(name);
  if (running) return running;
  const download = downloadVoice(name)
    .then(() => undefined)
    .finally(() => downloads.delete(name));
  downloads.set(name, download);
  return download;
}

/** Keeps ElevenLabs' API key, encrypted (`null`: forgets it). */
export async function storeElevenLabsKey(key: string | null): Promise<void> {
  if (key !== null && !safeStorage.isEncryptionAvailable()) throw new Error("this computer's keychain is not available: set ELEVENLABS_API_KEY instead");
  const stored = key === null || key.trim() === '' ? undefined : safeStorage.encryptString(key.trim()).toString('base64');
  await updateSettings((settings) => {
    if (stored === undefined) delete settings.voice.elevenLabsKey;
    else settings.voice.elevenLabsKey = stored;
  });
}

/** ElevenLabs' API key: the one kept (decrypted), else ELEVENLABS_API_KEY; undefined without either. */
async function elevenLabsKeyNow(): Promise<string | undefined> {
  const { voice } = await loadSettings();
  if (voice.elevenLabsKey !== undefined) {
    try {
      return safeStorage.decryptString(Buffer.from(voice.elevenLabsKey, 'base64'));
    } catch {
      // kept by another user or computer: ask again
    }
  }
  return process.env.ELEVENLABS_API_KEY || undefined;
}

/** How many of a project's enabled lines are not spoken yet (none while its audio is off). */
async function unspoken(dir: string, raw?: unknown): Promise<number> {
  const parsed = raw === undefined ? undefined : parseProject(raw);
  const project = parsed?.ok ? parsed.project : (await readProjectFile(dir)).project;
  if (!project.look.audio.enabled) return 0;
  let count = 0;
  for (const line of project.voiceover.lines) if (speaks(line) && !(await readRender(dir, voiceLineKey(project.voiceover, line)))) count++;
  return count;
}

/**
 * Speaks a project's lines not spoken yet (`project`: cuttle.json as the editor has it, else as
 * saved), in the media worker; without such lines it does not wait for the worker at all.
 */
export async function speakNarration(dir: string, project?: unknown, onProgress: (progress: number) => void = () => {}): Promise<VoiceReport> {
  if ((await unspoken(dir, project)) === 0) return { spoken: 0, lines: 0 };
  const elevenLabsKey = await elevenLabsKeyNow();
  const result = await mediaWorker.run<VoiceReport>({ job: 'voice', input: dir, output: '', ...(project !== undefined && { project }), ...(elevenLabsKey && { elevenLabsKey }) }, onProgress).promise;
  return result ?? { spoken: 0, lines: 0 };
}
