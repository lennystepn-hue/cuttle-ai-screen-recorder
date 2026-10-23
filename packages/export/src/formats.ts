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

/** How large an export is: as its format is (`hd`, the presets' 1080 on the short side), or 4K (2160 on the short side). */
export const EXPORT_SIZES = ['hd', '4k'] as const;
export type ExportSize = (typeof EXPORT_SIZES)[number];
/** The frame rates an export may take instead of the project's (`output.fps`). */
export const EXPORT_FPS = [24, 25, 30, 50, 60] as const;
/** H.264 plays everywhere; HEVC makes smaller files at 4K, where a hardware encoder has it. */
export const EXPORT_CODECS = ['h264', 'hevc'] as const;
export type ExportCodec = (typeof EXPORT_CODECS)[number];

/** The short side of a 4K export. */
const UHD = 2160;

/** A width and height at `size`: as they are (`hd`), or at 4K (the short side 2160, both sides even). */
export function atSize<T extends { width: number; height: number }>(output: T, size: ExportSize = 'hd'): T {
  if (size === 'hd') return output;
  const scale = UHD / Math.min(output.width, output.height);
  const even = (value: number) => Math.round((value * scale) / 2) * 2;
  return { ...output, width: even(output.width), height: even(output.height) };
}

/**
 * The project with its output size set to `format`'s preset (none: the project's own), at 4K
 * (`size`) and at another frame rate (`fps`) when asked.
 */
export function withFormat(project: CuttleProject, format: ExportFormat | undefined, options: { size?: ExportSize; fps?: number } = {}): CuttleProject {
  let output = atSize(format === undefined ? project.output : { ...project.output, ...EXPORT_FORMATS[format] }, options.size);
  if (options.fps !== undefined) output = { ...output, fps: options.fps };
  return output === project.output ? project : { ...project, output };
}
