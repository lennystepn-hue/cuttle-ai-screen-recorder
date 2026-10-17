/** Why a project operation failed; the CLI maps the code to its exit code, the app shows the message. */
export type CoreErrorCode =
  | 'usage'
  | 'invalid-project'
  | 'missing-file'
  | 'invalid-media'
  | 'ffmpeg-missing'
  | 'conflict'
  /** No speech model is downloaded, or not the one asked for. */
  | 'model-missing'
  /** A model download failed (network, size, checksum). */
  | 'download'
  /** ffmpeg has no `whisper` filter (before 8.0, or a build without it). */
  | 'ffmpeg-old'
  | 'cancelled';

/** A failure of a project operation (reading a project, running ffmpeg, a take that cannot be used). */
export class CoreError extends Error {
  readonly code: CoreErrorCode;
  /** The file it is about, where there is one (a `conflict`'s cuttle.json). */
  readonly path?: string;

  constructor(code: CoreErrorCode, message: string, options?: ErrorOptions & { path?: string }) {
    super(message, options);
    this.name = 'CoreError';
    this.code = code;
    if (options?.path !== undefined) this.path = options.path;
  }
}
