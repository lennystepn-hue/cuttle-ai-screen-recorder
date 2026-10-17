// The speech models: whisper.cpp's ggml files, downloaded once when the person asks, checked by
// size and SHA-256, and kept in one folder for the app and the CLI.
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { CoreError } from '../errors';

export const MODEL_NAMES = ['base', 'small', 'large-v3-turbo-q5_0'] as const;
export type ModelName = (typeof MODEL_NAMES)[number];

export interface SpeechModel {
  name: ModelName;
  /** What the settings call it. */
  label: 'Fast' | 'Good' | 'Best';
  bytes: number;
  sha256: string;
  /** About this many seconds of speech per second of work (the spike's machine, GPU on). */
  realtime: number;
  note: string;
}

/** The models, fastest first; `small` is the default. Sizes and hashes from the files' Git LFS pointers. */
export const SPEECH_MODELS: readonly SpeechModel[] = [
  {
    name: 'base',
    label: 'Fast',
    bytes: 147_951_465,
    sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe',
    realtime: 20,
    note: 'good for English, weak for German',
  },
  {
    name: 'small',
    label: 'Good',
    bytes: 487_601_967,
    sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b',
    realtime: 5,
    note: 'German and English, about 5× real time',
  },
  {
    name: 'large-v3-turbo-q5_0',
    label: 'Best',
    bytes: 574_041_195,
    sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
    realtime: 2.6,
    note: 'the most accurate, about 2.6× real time',
  },
];

export const DEFAULT_MODEL: ModelName = 'small';

export function speechModel(name: string): SpeechModel {
  const model = SPEECH_MODELS.find((entry) => entry.name === name);
  if (!model) throw new CoreError('usage', `unknown speech model "${name}" (one of ${MODEL_NAMES.join(', ')})`);
  return model;
}

/**
 * Where a model is downloaded from: whisper.cpp's models on Hugging Face, or `CUTTLE_MODELS_URL`
 * (a folder URL ending in `/`, for the app's checks). The pinned size and SHA-256 hold either way.
 */
export const modelUrl = (name: ModelName) => `${process.env.CUTTLE_MODELS_URL || 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/'}ggml-${name}.bin`;

/**
 * The folder the models are kept in: `CUTTLE_MODELS_DIR` when set, else the user's local app data
 * (Windows: `%LOCALAPPDATA%\Cuttle\models`; macOS: `~/Library/Application Support/Cuttle/models`;
 * elsewhere `$XDG_DATA_HOME/cuttle/models`). The app and the CLI share it.
 */
export function modelsDir(): string {
  if (process.env.CUTTLE_MODELS_DIR) return process.env.CUTTLE_MODELS_DIR;
  if (process.platform === 'win32') return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Cuttle', 'models');
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Cuttle', 'models');
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'cuttle', 'models');
}

export const modelPath = (name: ModelName) => join(modelsDir(), `ggml-${name}.bin`);

/** Whether a model's file is there at its full size (the hash was checked when it was downloaded). */
export async function modelInstalled(name: ModelName): Promise<boolean> {
  try {
    return (await stat(modelPath(name))).size === speechModel(name).bytes;
  } catch {
    return false;
  }
}

export async function installedModels(): Promise<ModelName[]> {
  const present = await Promise.all(MODEL_NAMES.map((name) => modelInstalled(name)));
  return MODEL_NAMES.filter((_, i) => present[i]);
}

/**
 * The model to transcribe with: `wanted` when it is installed (an error when not), else the
 * default when installed, else the most accurate one installed; undefined when there is none.
 */
export async function chooseModel(wanted?: string): Promise<ModelName | undefined> {
  if (wanted !== undefined) {
    const { name } = speechModel(wanted);
    if (!(await modelInstalled(name))) throw new CoreError('model-missing', `the speech model "${name}" is not downloaded: run "cuttle models download ${name}"`);
    return name;
  }
  const installed = await installedModels();
  if (installed.includes(DEFAULT_MODEL)) return DEFAULT_MODEL;
  return installed.at(-1);
}

export interface DownloadOptions {
  onProgress?: (received: number, total: number) => void;
  signal?: AbortSignal;
}

/** Downloads a model into `modelsDir()`, checking its size and SHA-256; a model already there is kept. */
export async function downloadModel(name: ModelName, options: DownloadOptions = {}): Promise<string> {
  const model = speechModel(name);
  const path = modelPath(name);
  if (await modelInstalled(name)) return path;
  await downloadFile(modelUrl(name), path, { bytes: model.bytes, sha256: model.sha256 }, options);
  return path;
}

/**
 * Downloads `url` to `path` through `<path>.part`, renamed only once the size and SHA-256 match:
 * a broken or cancelled download never passes for a model.
 */
export async function downloadFile(url: string, path: string, expect: { bytes: number; sha256: string }, options: DownloadOptions = {}): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const part = `${path}.part`;
  try {
    let response: Response;
    try {
      response = await fetch(url, { redirect: 'follow', ...(options.signal && { signal: options.signal }) });
    } catch (error) {
      if (options.signal?.aborted) throw cancelled();
      throw new CoreError('download', `the download from ${url} failed: ${(error as Error).message}`);
    }
    if (!response.ok || !response.body) throw new CoreError('download', `the download from ${url} failed: HTTP ${response.status}`);
    const hash = createHash('sha256');
    const out = createWriteStream(part);
    let received = 0;
    try {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        if (received > expect.bytes) throw new CoreError('download', `the download from ${url} is larger than the ${expect.bytes} bytes expected`);
        hash.update(value);
        if (!out.write(value)) await new Promise<void>((resolve) => out.once('drain', () => resolve()));
        options.onProgress?.(received, expect.bytes);
      }
    } catch (error) {
      if (options.signal?.aborted) throw cancelled();
      throw error instanceof CoreError ? error : new CoreError('download', `the download from ${url} broke off: ${(error as Error).message}`);
    } finally {
      await new Promise<void>((resolve, reject) => out.end((error?: Error | null) => (error ? reject(error) : resolve())));
    }
    if (received !== expect.bytes) throw new CoreError('download', `the download from ${url} ended at ${received} of ${expect.bytes} bytes`);
    if (hash.digest('hex') !== expect.sha256) throw new CoreError('download', `the download from ${url} does not match its checksum`);
    await rename(part, path);
  } catch (error) {
    await rm(part, { force: true }).catch(() => {});
    throw error;
  }
}

const cancelled = () => new CoreError('cancelled', 'the download was cancelled');

/** Removes a downloaded model. */
export async function removeModel(name: ModelName): Promise<void> {
  await rm(modelPath(speechModel(name).name), { force: true });
}
