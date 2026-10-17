import { app } from 'electron';
import type { ElectronResponse, ResponseMessage } from './protocol';

/** Sends the answer to the CLI and exits once it is on its way. */
export function finish(response: ElectronResponse, exitCode = 0): void {
  if (!process.send) {
    process.stderr.write(`${JSON.stringify(response)}\n`); // started by hand, without the CLI
    app.exit(exitCode);
    return;
  }
  process.send({ type: 'response', response } satisfies ResponseMessage, () => app.exit(exitCode));
}

/** A failure as an answer; errors with a string `code` (ExportError, CaptureError) keep it. */
export function failure(error: unknown): ElectronResponse {
  const code = typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : 'render';
  return { ok: false, error: { code, message: error instanceof Error ? error.message : String(error) } };
}
