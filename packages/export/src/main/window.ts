import { join } from 'node:path';
import { BrowserWindow } from 'electron';

export interface ExportWindow {
  win: BrowserWindow;
  /**
   * Rejects when the page's renderer process dies or the window is closed from outside (a pending
   * executeJavaScript would never settle).
   */
  gone: Promise<never>;
}

/**
 * A hidden, sandboxed window for the export page. Loaded from a file (a secure context, which
 * WebCodecs needs; a data: URL is not). It renders on the real GPU unless the app switched
 * hardware acceleration off.
 */
export async function openExportWindow(pageDir: string): Promise<ExportWindow> {
  const win = new BrowserWindow({
    show: false,
    width: 640,
    height: 360,
    webPreferences: {
      preload: join(pageDir, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Long exports must not be slowed down by timer throttling of hidden pages.
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  // Page warnings and errors go to stderr; stdout stays free for machine-readable output.
  win.webContents.on('console-message', (event) => {
    if (event.level === 'warning' || event.level === 'error') console.error(`[export page] ${event.message}`);
  });
  const gone = new Promise<never>((_, reject) => {
    win.webContents.on('render-process-gone', (_event, details) => {
      reject(new Error(`the export page's renderer is gone: ${details.reason} (exit code ${details.exitCode})`));
    });
    // An app that closes all its windows (or destroys this one) would otherwise leave the export hanging.
    win.once('closed', () => reject(new Error('the export window was closed before the export finished')));
  });
  gone.catch(() => {}); // observed by the caller through Promise.race; avoid an unhandled rejection otherwise
  try {
    await win.loadFile(join(pageDir, 'index.html'));
  } catch (error) {
    win.destroy();
    throw error;
  }
  return { win, gone };
}
