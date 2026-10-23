/// <reference path="./sherpa-onnx.d.ts" />
// A local voice speaking a line: sherpa-onnx runs the Piper voice on this computer's processor, and
// nothing leaves it. A voice is loaded once per process (about a second) and kept for the next lines.
import type { OfflineTts } from 'sherpa-onnx-node';
import { CoreError } from '../errors';
import { localVoice, voiceFiles, voiceInstalled } from './voices';

const loaded = new Map<string, Promise<OfflineTts>>();

/** sherpa-onnx's Node addon, loaded when a voice first speaks (a native module: the CLI and the app keep it outside their bundles). */
async function engine(): Promise<typeof import('sherpa-onnx-node')> {
  try {
    // CommonJS: its exports are the default export, and named ones where Node finds them
    const module = await import('sherpa-onnx-node');
    return module.default ?? module;
  } catch (error) {
    throw new CoreError('voice', `the local voices cannot run here: sherpa-onnx-node did not load (${(error as Error).message})`, { cause: error });
  }
}

/** `text` spoken by the local voice `name` at `speed`: mono samples at the voice's own rate. */
export async function speakLocal(name: string, text: string, speed: number): Promise<{ samples: Float32Array; rate: number }> {
  localVoice(name);
  if (!voiceInstalled(name)) throw new CoreError('voice-missing', `the voice "${name}" is not downloaded: run "cuttle voice download ${name}"`);
  let tts = loaded.get(name);
  if (!tts) {
    const files = voiceFiles(name);
    const { OfflineTts } = await engine();
    tts = OfflineTts.createAsync({ model: { vits: { model: files.model, tokens: files.tokens, dataDir: files.data }, numThreads: 2, provider: 'cpu' }, maxNumSentences: 1 });
    loaded.set(name, tts);
    tts.catch(() => loaded.delete(name));
  }
  try {
    const audio = await (await tts).generateAsync({ text, sid: 0, speed });
    return { samples: audio.samples, rate: audio.sampleRate };
  } catch (error) {
    throw new CoreError('voice', `the voice "${name}" could not speak the line: ${(error as Error).message}`, { cause: error });
  }
}
