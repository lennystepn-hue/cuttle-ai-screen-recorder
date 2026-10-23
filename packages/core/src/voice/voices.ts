// The voices that speak a narration on this computer: Piper's (neural, offline, about 21 MB each),
// as sherpa-onnx packs them with their pronunciation data, downloaded once into the models folder
// next to whisper's. Each archive's size and SHA-256 are pinned; it is unpacked with the system's
// tar (bsdtar on macOS and on Windows 10 and later, which read .tar.bz2).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { CoreError } from '../errors';
import { downloadFile, modelsDir, type DownloadOptions } from '../speech/models';

export interface LocalVoice {
  /** Its name in `voice.id` (`de_DE-thorsten-medium`). */
  name: string;
  /** For people: who speaks, and which language. */
  label: string;
  language: string;
  bytes: number;
  sha256: string;
}

/** The voices Cuttle offers, a woman's and a man's in each language where Piper has both. */
export const LOCAL_VOICES: readonly LocalVoice[] = [
  { name: 'en_US-amy-medium', label: 'Amy', language: 'English (US)', bytes: 21028122, sha256: 'bd23c0aa629eb3719448582f45ede49e8fa6a679061fed5eab16a6a6fd8e7e82' },
  { name: 'en_US-ryan-medium', label: 'Ryan', language: 'English (US)', bytes: 21083446, sha256: '376eb489d42e98cb49f0e13a633e8d88580bd247ed8aacc298a733210404f771' },
  { name: 'en_GB-alba-medium', label: 'Alba', language: 'English (UK)', bytes: 21104326, sha256: 'f7581d123ae977f64f3032bb247d4deeac8440e881d918d36fdd36d8f1030fb7' },
  { name: 'en_GB-alan-medium', label: 'Alan', language: 'English (UK)', bytes: 21103831, sha256: 'f0b2526c9600657141ccbbe412f6159dceedab5bab4ba4e8857d9443acb50de4' },
  { name: 'de_DE-thorsten-medium', label: 'Thorsten', language: 'German', bytes: 20949833, sha256: '07e240b7b9c1fc9211d5a69512f8cbe11b3286c2ed79c15c076ac6ed427fdf13' },
  { name: 'de_DE-kerstin-low', label: 'Kerstin', language: 'German', bytes: 21174728, sha256: 'bcd8039667940cf2efc939b844f4b33d0823096572fcc1a8caaa2faa77f3379c' },
  { name: 'fr_FR-siwis-medium', label: 'Siwis', language: 'French', bytes: 20914888, sha256: '3909cff9b3cfd4820c66aa13bf554315c82e34899c161f0b446ece372bc4b5ec' },
  { name: 'fr_FR-tom-medium', label: 'Tom', language: 'French', bytes: 21019617, sha256: 'b158f884eb4231b8dddd372c3dc506949630c992a8e48ca692a90323e8bb4e09' },
  { name: 'es_ES-davefx-medium', label: 'Davefx', language: 'Spanish', bytes: 21171632, sha256: '8bb8ac1cefb727caec9bd9c6c3185c673c8b42c53bd29bb25d5a7715dac37125' },
];

/** The voice for a language when none is named: the first of the list in it. */
export const DEFAULT_VOICE = 'en_US-amy-medium';

export function localVoice(name: string): LocalVoice {
  const voice = LOCAL_VOICES.find((candidate) => candidate.name === name);
  if (!voice) throw new CoreError('usage', `there is no local voice "${name}"; voices: ${LOCAL_VOICES.map((known) => known.name).join(', ')}`);
  return voice;
}

/**
 * Where a voice archive is downloaded from: sherpa-onnx's releases, or `CUTTLE_VOICES_URL` (a folder
 * URL ending in `/`, for the app's checks). The pinned size and SHA-256 hold either way.
 */
export const voiceUrl = (name: string) => `${process.env.CUTTLE_VOICES_URL || 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/'}${archiveName(name)}`;

const archiveName = (name: string) => `vits-piper-${name}-int8.tar.bz2`;

/** The folder of an installed voice: its model, tokens.txt and espeak-ng-data. */
export const voiceDir = (name: string) => join(modelsDir(), 'voices', name);

/** The files sherpa-onnx loads for a voice. */
export function voiceFiles(name: string): { model: string; tokens: string; data: string } {
  const dir = voiceDir(name);
  return { model: join(dir, `${name}.onnx`), tokens: join(dir, 'tokens.txt'), data: join(dir, 'espeak-ng-data') };
}

export function voiceInstalled(name: string): boolean {
  const files = voiceFiles(name);
  return existsSync(files.model) && existsSync(files.tokens) && existsSync(files.data);
}

/**
 * The system's tar: Windows' own bsdtar in System32 (a GNU tar from Git earlier on PATH reads
 * `C:\…` as a remote host), else tar from PATH.
 */
function tarCommand(): string {
  if (process.platform !== 'win32') return 'tar';
  const own = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  return existsSync(own) ? own : 'tar';
}

/** Unpacks a .tar.bz2 into `into` with the system's tar. */
export function untar(archive: string, into: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(tarCommand(), ['-xjf', archive, '-C', into], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let said = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => (said += chunk));
    child.on('error', (error) => reject(new CoreError('download', `the voice could not be unpacked (tar: ${error.message})`)));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new CoreError('download', `the voice could not be unpacked (tar exited with ${code}): ${said.trim()}`))));
  });
}

/**
 * Downloads a voice into `voiceDir(name)`, checking its size and SHA-256, and unpacks it there
 * (through a folder of its own, renamed once complete); a voice already there is kept.
 */
export async function downloadVoice(name: string, options: DownloadOptions = {}): Promise<string> {
  const voice = localVoice(name);
  const dir = voiceDir(name);
  if (voiceInstalled(name)) return dir;
  const voices = join(modelsDir(), 'voices');
  const archive = join(voices, archiveName(name));
  const unpacking = join(voices, `${name}.unpacking`);
  await mkdir(voices, { recursive: true });
  try {
    await downloadFile(voiceUrl(name), archive, { bytes: voice.bytes, sha256: voice.sha256 }, options);
    await rm(unpacking, { recursive: true, force: true });
    await mkdir(unpacking);
    await untar(archive, unpacking);
    // the archive holds one folder, vits-piper-<name>-int8
    const [inner] = await readdir(unpacking);
    if (!inner) throw new CoreError('download', `the archive of the voice "${name}" is empty`);
    await rm(dir, { recursive: true, force: true });
    await rename(join(unpacking, inner), dir);
    if (!voiceInstalled(name)) throw new CoreError('download', `the archive of the voice "${name}" lacks its model, tokens or pronunciation data`);
    return dir;
  } finally {
    await rm(archive, { force: true }).catch(() => {});
    await rm(unpacking, { recursive: true, force: true }).catch(() => {});
  }
}

/** Removes a downloaded voice. */
export async function removeVoice(name: string): Promise<void> {
  await rm(voiceDir(localVoice(name).name), { recursive: true, force: true });
}
