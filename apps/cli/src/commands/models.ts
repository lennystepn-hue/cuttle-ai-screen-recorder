import { DEFAULT_MODEL, SPEECH_MODELS, downloadModel, installedModels, modelPath, modelsDir, removeModel, speechModel, type ModelName } from '@cuttle/core';
import type { Output } from '../output';
import { percentSteps } from './transcribe';

const megabytes = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;

export interface ModelsList {
  dir: string;
  models: { name: ModelName; label: string; bytes: number; installed: boolean; default: boolean; note: string }[];
}

/** `cuttle models`: the speech models, which are downloaded, and where they are kept. */
export async function modelsListCommand(output: Output): Promise<ModelsList> {
  const installed = await installedModels();
  const result: ModelsList = {
    dir: modelsDir(),
    models: SPEECH_MODELS.map((model) => ({
      name: model.name,
      label: model.label,
      bytes: model.bytes,
      installed: installed.includes(model.name),
      default: model.name === DEFAULT_MODEL,
      note: model.note,
    })),
  };
  output.result(result, () =>
    [
      ...result.models.map((model) => `${model.installed ? '✓' : ' '} ${model.name.padEnd(20)} ${model.label.padEnd(5)} ${megabytes(model.bytes).padStart(7)}  ${model.note}${model.default ? ' (default)' : ''}`),
      `kept in ${result.dir}`,
      ...(installed.length === 0 ? [`download one: cuttle models download ${DEFAULT_MODEL}`] : []),
    ].join('\n'),
  );
  return result;
}

/** `cuttle models download <name>`: downloads a model once, checking its size and checksum. */
export async function modelsDownloadCommand(name: string, output: Output, signal: AbortSignal): Promise<{ name: ModelName; path: string; bytes: number }> {
  const model = speechModel(name);
  output.info(`downloading the ${model.name} model (${megabytes(model.bytes)}) into ${modelsDir()} …`);
  const report = percentSteps((percent) => output.info(`downloading … ${percent} %`), 5);
  const path = await downloadModel(model.name, { signal, onProgress: (received, total) => report(received / total) });
  const result = { name: model.name, path, bytes: model.bytes };
  output.result(result, () => `${model.name} is ready (${path})`);
  return result;
}

/** `cuttle models remove <name>`: removes a downloaded model. */
export async function modelsRemoveCommand(name: string, output: Output): Promise<{ name: ModelName; removed: string }> {
  const model = speechModel(name);
  await removeModel(model.name);
  const result = { name: model.name, removed: modelPath(model.name) };
  output.result(result, () => `removed ${result.removed}`);
  return result;
}
