import type { ExportErrorCode, ExportHost, PageResult } from '../job';

declare global {
  interface Window {
    /** Set by the preload script. */
    cuttleHost: ExportHost;
    /** Set by the page; the main process calls `run()` once. */
    cuttleExport: { run(): Promise<PageResult> };
  }
}

export function host(): ExportHost {
  return window.cuttleHost;
}

/** A failure the page can name precisely; anything else counts as a render error. */
export class PageError extends Error {
  constructor(
    readonly code: ExportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PageError';
  }
}
