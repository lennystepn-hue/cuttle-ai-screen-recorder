// How the Node CLI and its Electron process talk: the request is one base64 JSON argument; the
// answer and a cancel go over Node's IPC channel (Electron's main process reads no stdin on
// Windows, and the console's Ctrl+C does not reach it). Pure: both sides import it.

export type ElectronRequest =
  | { command: 'render'; projectDir: string; out: string; format?: string; encoder?: string }
  | { command: 'preview'; projectDir: string; outDir: string; times: number[]; format?: string; sheet?: { columns?: number } }
  | { command: 'capture-page'; target: string; out: string; width: number; height: number; fullPage: boolean; waitMs: number };

export type ElectronResponse = { ok: true; result: unknown } | { ok: false; error: { code: string; message: string } };

/** Electron → CLI. */
export interface ResponseMessage {
  type: 'response';
  response: ElectronResponse;
}

/** CLI → Electron: stop the job and clean up (Ctrl+C). */
export interface CancelMessage {
  type: 'cancel';
}

export function encodeRequest(request: ElectronRequest): string {
  return Buffer.from(JSON.stringify(request), 'utf8').toString('base64');
}

export function decodeRequest(argument: string): ElectronRequest {
  return JSON.parse(Buffer.from(argument, 'base64').toString('utf8')) as ElectronRequest;
}
