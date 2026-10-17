// Speech in the app: the models (download with progress and cancel, remove), and transcribing a
// take after its cut, in the media worker, then its filler words and pauses cut as one change.
import { dirname, join, relative, resolve, sep } from 'node:path';
import { CLEAN_MIC_FILE, CoreError, SPEECH_MODELS, TRANSCRIPT_FILE, downloadModel, hasWhisper, installedModels, modelInstalled, modelsDir, readProjectFile, removeModel } from '@cuttle/core';
import type { SpeechModelName, SpeechStatus } from '../shared/ipc';
import { mediaWorker } from './media-service';
import { loadSettings } from './settings';
import { expectSpeech, setEditorStatus } from './windows';

let download: { name: SpeechModelName; received: number; total: number; controller: AbortController; percent: number } | undefined;
let failure: SpeechStatus['failure'];
const listeners = new Set<(status: SpeechStatus) => void>();

/** Whether ffmpeg can transcribe, as last asked (undefined: no ffmpeg). */
let whisper: boolean | undefined;

/**
 * The models here, whether ffmpeg can transcribe, and the download under way or the one that
 * failed. `fresh`: ask ffmpeg again (the settings window asks when it opens; ffmpeg may have been
 * updated), else its last answer, as while a download moves on.
 */
export async function speechStatus(fresh = true): Promise<SpeechStatus> {
  const installed = await installedModels();
  if (fresh) whisper = await hasWhisper(true).catch(() => undefined);
  return {
    dir: modelsDir(),
    models: SPEECH_MODELS.map((model) => ({ name: model.name, label: model.label, bytes: model.bytes, note: model.note, installed: installed.includes(model.name) })),
    ...(whisper !== undefined && { whisper }),
    ...(download && { download: { name: download.name, received: download.received, total: download.total } }),
    ...(failure && { failure }),
  };
}

/** Calls `listener` whenever the models change or a download moves on (every whole percent). */
export function onSpeechStatus(listener: (status: SpeechStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const announce = async () => {
  if (listeners.size === 0) return;
  const status = await speechStatus(false);
  for (const listener of listeners) listener(status);
};

/** Downloads a model (one at a time), answering once it is there, failed or was cancelled. */
export async function downloadSpeechModel(name: SpeechModelName): Promise<SpeechStatus> {
  if (download) return speechStatus(false);
  const model = SPEECH_MODELS.find((entry) => entry.name === name)!;
  const controller = new AbortController();
  download = { name, received: 0, total: model.bytes, controller, percent: 0 };
  failure = undefined;
  void announce();
  try {
    await downloadModel(name, {
      signal: controller.signal,
      onProgress: (received, total) => {
        if (!download) return;
        download.received = received;
        download.total = total;
        const percent = Math.floor((received / total) * 100);
        if (percent !== download.percent) {
          download.percent = percent;
          void announce();
        }
      },
    });
  } catch (error) {
    if (!(error instanceof CoreError && error.code === 'cancelled')) failure = { name, message: (error as Error).message.split('\n')[0]! };
  } finally {
    download = undefined;
  }
  void announce();
  return speechStatus(false);
}

export function cancelSpeechDownload(): void {
  download?.controller.abort();
}

/** Removes a downloaded model (not the one being downloaded). */
export async function removeSpeechModel(name: SpeechModelName): Promise<SpeechStatus> {
  if (download?.name !== name) await removeModel(name);
  void announce();
  return speechStatus(false);
}

/** Projects being transcribed now (their folders, as given). */
const transcribing = new Set<string>();

/**
 * Transcribes the project's mic after its cut and cuts its filler words and pauses, when speech is
 * on in the settings, the take has a mic and no transcript yet, the model is downloaded and ffmpeg
 * can transcribe. The editor's title bar shows the progress, and the speech edits arrive as one
 * step to undo ("Cuttle's speech edits"). `asked`: the person asked for it (the Auto tab, Try again):
 * it runs again over a transcript there, and says why it cannot instead of staying quiet.
 */
export async function transcribeProject(dir: string, asked = false): Promise<{ started: true } | { problem: string; settings?: boolean }> {
  const quiet = (problem: string, settings?: boolean) => (asked ? { problem, ...(settings && { settings }) } : { problem });
  if (transcribing.has(dir)) return { started: true };
  const { speech } = await loadSettings();
  if (speech.model === 'off') return quiet('Speech is off in the settings.', true);
  const file = await readProjectFile(dir).catch(() => undefined);
  const mic = file?.project.sources.mic;
  if (!file || mic === undefined) return quiet('This take has no mic.');
  if (file.project.sources.transcript !== undefined && !asked) return { problem: 'already transcribed' };
  const model = SPEECH_MODELS.find((entry) => entry.name === speech.model)!;
  if (!(await modelInstalled(model.name))) return quiet(`Download the ${model.label} speech model in the settings first.`, true);
  if (!(await hasWhisper(true).catch(() => false))) return quiet('This ffmpeg cannot transcribe: it needs version 8 or later (winget upgrade Gyan.FFmpeg, or on macOS brew upgrade ffmpeg).', true);
  transcribing.add(dir);
  void (async () => {
    const status = (progress: number) => setEditorStatus(dir, { text: `Transcribing… ${Math.round(progress * 100)} %`, state: 'working' });
    try {
      await status(0);
      await mediaWorker.run({ job: 'transcribe', input: dir, output: '', model: model.name, language: speech.language }, (progress) => void status(progress)).promise;
      const take = (name: string) => relative(file.dir, join(dirname(resolve(file.dir, mic)), name)).split(sep).join('/');
      const transcript = take(TRANSCRIPT_FILE);
      await setEditorStatus(dir, { text: 'Cutting filler words and pauses…', state: 'working' });
      await expectSpeech(dir, true);
      try {
        await mediaWorker.run({ job: 'speech-edits', input: dir, output: '', transcript, cleanMic: take(CLEAN_MIC_FILE) }, () => {}).promise;
      } catch (error) {
        // nothing was written: the next outside change is someone else's
        await expectSpeech(dir, false);
        throw error;
      }
      await setEditorStatus(dir, undefined);
    } catch (error) {
      const cancelled = (error as { cancelled?: boolean }).cancelled === true;
      await setEditorStatus(dir, cancelled ? undefined : { text: `The speech could not be transcribed: ${(error as Error).message.split('\n')[0]}`, state: 'failed', retry: 'speech' });
    } finally {
      transcribing.delete(dir);
    }
  })();
  return { started: true };
}
