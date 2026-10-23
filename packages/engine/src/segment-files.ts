// The segmenter's files as URLs of the bundle that imports this (Vite emits them next to it): for a
// page built as an app (the editor) or a test. The export page reads them from its folder instead.
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import model from '../assets/selfie_segmenter_landscape.tflite?url';
import type { SegmenterFiles } from './segment';

export const SEGMENTER_FILES: SegmenterFiles = { wasmLoaderPath, wasmBinaryPath, model };
