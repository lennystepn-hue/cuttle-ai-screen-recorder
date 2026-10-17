/**
 * Exit codes (spec): 0 ok, 1 usage or validation, 2 device or permission, 3 render; 130 when stopped
 * with Ctrl+C before anything was recorded or rendered.
 */
export const EXIT = { ok: 0, usage: 1, device: 2, render: 3, cancelled: 130 } as const;

/** Error codes of the recorder and the export, and the CLI's own, with their exit codes. */
const EXIT_CODES: Record<string, number> = {
  // CLI
  usage: EXIT.usage,
  'invalid-project': EXIT.usage,
  // @cuttle/recorder
  'invalid-options': EXIT.usage,
  'device-not-found': EXIT.device,
  'ffmpeg-missing': EXIT.device,
  capture: EXIT.device,
  'unsupported-platform': EXIT.device,
  cancelled: EXIT.cancelled,
  // @cuttle/export
  'missing-file': EXIT.usage,
  'invalid-media': EXIT.usage,
  render: EXIT.render,
  // @cuttle/core
  conflict: EXIT.usage,
};

/** A failure the CLI reports with a code and an exit code. */
export class CliError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CliError';
    this.code = code;
  }

  get exitCode(): number {
    return EXIT_CODES[this.code] ?? EXIT.usage;
  }
}

/** Whether `code` is one the CLI maps to an exit code. */
export function isKnownCode(code: string): boolean {
  return code in EXIT_CODES;
}

/** Any error as a CliError: errors with a known `code` keep it, anything else is an internal error. */
export function toCliError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  const code = typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : undefined;
  const message = error instanceof Error ? error.message : String(error);
  if (code !== undefined && code in EXIT_CODES) return new CliError(code, message, { cause: error });
  return new CliError('internal', message, { cause: error }); // the output adds the stack on stderr
}
