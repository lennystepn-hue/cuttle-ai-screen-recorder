// Where the export page's build puts the webcam's segmenter (its folder beside the page, the files'
// names), for the build (vite.page.config.ts) and the main process alike: no imports.
export const SEGMENTER_DIR = 'segment';
export const SEGMENTER_FILE_NAMES = { loader: 'vision_wasm_internal.js', wasm: 'vision_wasm_internal.wasm', model: 'selfie_segmenter_landscape.tflite' } as const;
