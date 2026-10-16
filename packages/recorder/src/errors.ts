export type RecorderErrorCode = 'invalid-options' | 'device-not-found' | 'ffmpeg-missing' | 'capture' | 'unsupported-platform' | 'cancelled';

/**
 * A recording failure with a cause the caller can act on. Suggested CLI exit codes (spec: 1 usage or
 * validation, 2 device or permission): `invalid-options` → 1; `device-not-found`, `ffmpeg-missing`,
 * `capture` (a capture process failed) and `unsupported-platform` → 2; `cancelled` (stopped during the
 * countdown, nothing recorded) → 130, like Ctrl+C.
 */
export class RecorderError extends Error {
  readonly code: RecorderErrorCode;

  constructor(code: RecorderErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RecorderError';
    this.code = code;
  }
}
