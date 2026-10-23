// The webcam's segmenter in the export page: its files read through the host (the page is a file,
// and fetch reads no file: URLs) and handed to MediaPipe as blob: URLs.
import { loadSegmenter, type Segmenter } from '@cuttle/engine';
import type { SegmenterPaths } from '../job';
import { host } from './host';

export async function pageSegmenter(paths: SegmenterPaths): Promise<Segmenter> {
  const read = async (path: string) => (await host().readFile(path)) as Uint8Array<ArrayBuffer>;
  const [loader, wasm, model] = await Promise.all([read(paths.loader), read(paths.wasm), read(paths.model)]);
  const url = (bytes: Uint8Array<ArrayBuffer>, type: string) => URL.createObjectURL(new Blob([bytes], { type }));
  return loadSegmenter({ wasmLoaderPath: url(loader, 'text/javascript'), wasmBinaryPath: url(wasm, 'application/wasm'), model });
}
