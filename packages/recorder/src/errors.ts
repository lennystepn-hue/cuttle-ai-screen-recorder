export type RecorderErrorCode = 'invalid-options' | 'device-not-found' | 'ffmpeg-missing' | 'capture' | 'permission-denied' | 'unsupported-platform' | 'cancelled';

/**
 * A recording failure with a cause the caller can act on. Suggested CLI exit codes (spec: 1 usage or
 * validation, 2 device or permission): `invalid-options` → 1; `device-not-found`, `ffmpeg-missing`,
 * `capture` (a capture process, a file write or a native module failed; once the take folder exists
 * the message names it), `permission-denied` (macOS: the screen, the camera or the microphone is not
 * allowed for the app the recorder runs in; the message says where to allow it) and
 * `unsupported-platform` → 2; `cancelled` (stopped before the
 * screen track started; no take folder is left) → 130, like Ctrl+C.
 */
export class RecorderError extends Error {
  readonly code: RecorderErrorCode;

  constructor(code: RecorderErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RecorderError';
    this.code = code;
  }
}
