// Output formats in the editor: the presets, and the project's own size.
import { EXPORT_FORMATS, type ExportFormat } from '@cuttle/export/formats';
import type { ExportTarget } from '../../shared/ipc';

export const FORMATS = Object.keys(EXPORT_FORMATS) as ExportFormat[];

/** The preset whose size is the project's own output size, if one is. */
export function ownFormat(output: { width: number; height: number } | undefined): ExportFormat | undefined {
  return FORMATS.find((name) => output && EXPORT_FORMATS[name].width === output.width && EXPORT_FORMATS[name].height === output.height);
}

/** An export target for people: a preset's name, the project's own size as `640×360`. */
export function targetName(target: ExportTarget, output: { width: number; height: number } | undefined): string {
  return target === 'project' ? (output ? `${output.width}×${output.height}` : 'Project size') : target;
}
