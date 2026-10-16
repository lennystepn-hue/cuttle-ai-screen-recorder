import type { CuttleProject } from '@cuttle/project';

/** Output presets. The window frame and the content scale to fit; masks and zooms keep their source coordinates. */
export const EXPORT_FORMATS = {
  '16:9': { width: 1920, height: 1080 },
  '1:1': { width: 1080, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
} as const;

export type ExportFormat = keyof typeof EXPORT_FORMATS;

export function isExportFormat(value: string): value is ExportFormat {
  return Object.hasOwn(EXPORT_FORMATS, value);
}

/** The project with its output size set to `format`'s preset (fps unchanged); without a format, the project as it is. */
export function withFormat(project: CuttleProject, format: ExportFormat | undefined): CuttleProject {
  if (format === undefined) return project;
  return { ...project, output: { ...project.output, ...EXPORT_FORMATS[format] } };
}
