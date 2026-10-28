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
  /** A narration's local voice is not downloaded. */
  | 'voice-missing'
  /** ElevenLabs is asked for and no API key is set (ELEVENLABS_API_KEY, or the app's settings). */
  | 'voice-key'
  /** A voice could not speak a line (the engine failed, ElevenLabs answered with an error). */
  | 'voice'
  /** Stock media is asked for and its service has no key (PEXELS_API_KEY, PIXABAY_API_KEY, FREESOUND_API_KEY), or refused it. */
  | 'media-key'
  /** ffmpeg has no `whisper` filter (before 8.0, or a build without it). */
  | 'ffmpeg-old'
  /** The screen's text cannot be read here (neither Windows nor macOS, PowerShell refused, no OCR language, no cuttle-capture). */
  | 'ocr-missing'
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
