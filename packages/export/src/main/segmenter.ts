// The webcam's segmenter for the export page: MediaPipe's loader script and WebAssembly and the model,
// copied beside the page by its build (vite.page.config.ts), read by the page through its host.
import { join } from 'node:path';
import { showsCamera, type CuttleProject } from '@cuttle/project';
import type { SegmenterPaths } from '../job';
import { SEGMENTER_DIR, SEGMENTER_FILE_NAMES } from '../segmenter-files';

/** The segmenter's files beside the page in `pageDir`, when the project shows the camera with a background other than the room. */
export function segmenterPaths(project: CuttleProject, pageDir: string): SegmenterPaths | undefined {
  if (!showsCamera(project) || (project.look.webcam.background ?? 'keep') === 'keep') return undefined;
  const dir = join(pageDir, SEGMENTER_DIR);
  return { loader: join(dir, SEGMENTER_FILE_NAMES.loader), wasm: join(dir, SEGMENTER_FILE_NAMES.wasm), model: join(dir, SEGMENTER_FILE_NAMES.model) };
}
