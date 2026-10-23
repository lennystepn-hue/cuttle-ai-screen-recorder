// The person in a webcam frame, for what shows behind them (`look.webcam.background`): MediaPipe's
// selfie segmenter, its landscape model for video calls (256 × 144, 250 KB, Apache 2.0), run on the
// CPU in WebAssembly: about 4 ms a frame, and the editor and the export find the same person in the
// same frame (the GPU took longer here, the frame handed over first). Everything is bundled
// (the model, MediaPipe's WebAssembly): nothing is downloaded. The files come from the page: the
// editor's bundle has them as URLs (`segment-files.ts`), the export page reads them from its folder.
import { ImageSegmenter } from '@mediapipe/tasks-vision';

/** MediaPipe's WebAssembly (its loader script and its binary, as URLs) and the model (a URL or its bytes). */
export interface SegmenterFiles {
  wasmLoaderPath: string;
  wasmBinaryPath: string;
  model: string | Uint8Array;
}

/** Where the person is: 0 the room … 255 the person, `width` × `height` over the whole frame (the model's 256 × 144), top row first. */
export interface PersonMask {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Finds the person in a frame (synchronous, a few ms); undefined when the model gives nothing. */
export type Segmenter = (frame: TexImageSource) => PersonMask | undefined;

/** The landscape model's input. */
const MODEL_SIZE = { width: 256, height: 144 } as const;

let loading: Promise<Segmenter> | undefined;

/** The segmenter, loaded once (the model and the WebAssembly) and shared. */
export function loadSegmenter(files: SegmenterFiles): Promise<Segmenter> {
  loading ??= (async () => {
    let model = files.model;
    if (typeof model === 'string') {
      const response = await fetch(model);
      if (!response.ok) throw new Error(`the webcam's segmentation model did not load (${response.status})`);
      model = new Uint8Array(await response.arrayBuffer());
    }
    const { wasmLoaderPath, wasmBinaryPath } = files;
    const segmenter = await ImageSegmenter.createFromOptions(
      { wasmLoaderPath, wasmBinaryPath },
      { baseOptions: { modelAssetBuffer: model, delegate: 'CPU' }, runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false },
    );
    // the frame at the model's own size first: the model sees no more, and its mask comes out that small
    const small = new OffscreenCanvas(MODEL_SIZE.width, MODEL_SIZE.height);
    const draw = small.getContext('2d')!;
    return (frame: TexImageSource): PersonMask | undefined => {
      draw.drawImage(frame as CanvasImageSource, 0, 0, MODEL_SIZE.width, MODEL_SIZE.height);
      const result = segmenter.segment(small);
      try {
        // the model has one label, the person (a model with the room as its first label: the last is the person)
        const mask = result.confidenceMasks?.at(-1);
        if (!mask) return undefined;
        const values = mask.getAsFloat32Array();
        const data = new Uint8Array(values.length);
        for (let i = 0; i < values.length; i++) data[i] = Math.round(Math.min(1, Math.max(0, values[i]!)) * 255);
        return { width: mask.width, height: mask.height, data };
      } finally {
        result.close();
      }
    };
  })().catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
}
