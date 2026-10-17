// Main-process API (Electron). Bundle it with Vite: the packages ship TypeScript source.
export { exportProject, type ExportOptions, type ExportResult, type ExportStats } from './main/export';
export { ExportError } from './errors';
export { EXPORT_FORMATS, isExportFormat, type ExportFormat } from './formats';
export type { EncoderPreference, ExportErrorCode } from './job';
export { renderStills, stillName, type StillsOptions, type StillsResult } from './main/stills';
