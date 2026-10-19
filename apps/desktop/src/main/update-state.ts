// The app's updates as the settings show them, from an updater's events (electron-updater's
// AppUpdater, or a test's): a check, a new version found and downloaded, ready to install when
// Cuttle quits. Pure: the updater and the clock come in (updates.ts gives electron-updater's).
import type { UpdateStatus } from '../shared/ipc';

/** What this needs of electron-updater's AppUpdater. */
export interface Updater {
  on(event: string, listener: (...args: never[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export interface Updates {
  status(): UpdateStatus;
  /** Calls `listener` with every new status; returns the function that stops it. */
  onStatus(listener: (status: UpdateStatus) => void): () => void;
  /** Asks for a newer version (not while one is checked, downloaded or ready). */
  check(): Promise<UpdateStatus>;
  /** Downloads the version found (where the updater does not by itself). */
  download(): Promise<UpdateStatus>;
  /** Quits and installs the version downloaded; false when none is ready. */
  install(): boolean;
}

/**
 * What a failure says, for people: its first line, short. GitHub without a release yet, or whose
 * latest release has no file for this platform, is no failure: there is nothing newer.
 */
export function failureOf(error: unknown): { none: true } | { message: string } {
  const text = error instanceof Error ? error.message : String(error);
  if (/ensure a production release exists|Cannot find latest/i.test(text)) return { none: true };
  const line = text.split(/\r?\n/).find((part) => part.trim() !== '')?.trim() ?? 'unknown error';
  return { message: line.length > 160 ? `${line.slice(0, 157)}…` : line };
}

/**
 * The updates of an app at `version`; `supported`: whether it can update at all (the packaged app);
 * `autoDownload`: whether the updater downloads a version it found by itself.
 */
export function createUpdates(updater: Updater, base: { version: string; supported: boolean; autoDownload: boolean }, now: () => number = Date.now): Updates {
  const { version, supported, autoDownload } = base;
  let current: UpdateStatus = { version, supported, state: 'idle' };
  const listeners = new Set<(status: UpdateStatus) => void>();
  const set = (next: Omit<UpdateStatus, 'version' | 'supported'>) => {
    current = { version, supported, ...next };
    for (const listener of listeners) listener(current);
  };
  const failed = (error: unknown) => {
    const failure = failureOf(error);
    if ('none' in failure) set({ state: 'current', checked: now() });
    else set({ state: 'failed', failure: failure.message, ...(current.next !== undefined && { next: current.next }), ...(current.checked !== undefined && { checked: current.checked }) });
  };

  updater.on('update-available', (info: { version: string }) => set({ state: autoDownload ? 'downloading' : 'available', next: info.version, checked: now() }));
  updater.on('update-not-available', () => set({ state: 'current', checked: now() }));
  updater.on('download-progress', (progress: { transferred: number; total: number }) => {
    if (current.next !== undefined) set({ state: 'downloading', next: current.next, download: { received: progress.transferred, total: progress.total }, ...(current.checked !== undefined && { checked: current.checked }) });
  });
  updater.on('update-downloaded', (info: { version: string }) => set({ state: 'ready', next: info.version, ...(current.checked !== undefined && { checked: current.checked }) }));
  updater.on('error', (error: unknown) => failed(error));

  const busy = () => current.state === 'checking' || current.state === 'downloading' || current.state === 'ready';
  return {
    status: () => current,
    onStatus(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async check() {
      if (!supported || busy()) return current;
      set({ state: 'checking', ...(current.checked !== undefined && { checked: current.checked }) });
      // the updater says what it found (and a failure) as events; a rejection without one still counts
      await updater.checkForUpdates().catch((error: unknown) => {
        if (current.state === 'checking') failed(error);
      });
      if (current.state === 'checking') set({ state: 'current', checked: now() });
      return current;
    },
    async download() {
      if (!supported || current.next === undefined || (current.state !== 'available' && current.state !== 'failed')) return current;
      set({ state: 'downloading', next: current.next, ...(current.checked !== undefined && { checked: current.checked }) });
      await updater.downloadUpdate().catch((error: unknown) => {
        if (current.state === 'downloading') failed(error);
      });
      return current;
    },
    install() {
      if (current.state !== 'ready') return false;
      // silent on Windows (the installer shows nothing), Cuttle starts again when it is done
      updater.quitAndInstall(true, true);
      return true;
    },
  };
}
