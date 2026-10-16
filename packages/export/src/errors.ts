import type { ExportErrorCode } from './job';

/**
 * An export failure with a cause the caller can act on. Suggested CLI exit codes (spec: 1 usage or
 * validation, 2 device or permission, 3 render): `invalid-project`, `missing-file` and
 * `invalid-media` → 1, `ffmpeg-missing` → 2, `render` → 3.
 */
export class ExportError extends Error {
  readonly code: ExportErrorCode;

  constructor(code: ExportErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ExportError';
    this.code = code;
  }
}
