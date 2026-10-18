// Main-process API (Electron). Bundle it with Vite: the packages ship TypeScript source.
export { SUBTITLE_FORMATS, exportProject, subtitlePath, type ExportOptions, type ExportResult, type ExportStats, type SubtitleFormat } from './main/export';
export { ExportError } from './errors';
export { EXPORT_FORMATS, isExportFormat, type ExportFormat } from './formats';
export type { EncoderPreference, ExportErrorCode } from './job';
export { renderStills, stillName, type StillsOptions, type StillsResult } from './main/stills';
export { MOTION_SCHEME_PRIVILEGES } from './main/motion';
export type { MotionItemReport } from './main/motion-host';
export { MotionPreview, type MotionPreviewOptions, type MotionStatus, type PreviewMode } from './main/motion-preview';
export type { MotionFrameRequest, MotionPixels } from './job';
