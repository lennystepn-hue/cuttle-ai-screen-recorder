// Updates from the project's GitHub releases (electron-updater): checked a little after the start
// and once a day while the setting says so, or with the settings' Check now; downloaded in the
// background, installed when Cuttle quits or at once with Restart and update (not while a take
// records). Only the packaged app updates: package.mjs puts its feed in its resources
// (app-update.yml, scripts/releases.mjs). The end-to-end check gives a feed of its own
// (CUTTLE_UPDATE_FEED) and downloads only when asked; without one it never looks.
import { app, shell } from 'electron';
import electronUpdater from 'electron-updater';
import { CHECK } from './check';
import { recordingRuns } from './recording';
import { appVersion, loadSettings, onSettingsChange } from './settings';
import { createUpdates, type Updates } from './update-state';

/** The releases' page, which the settings link to (the repository of package.json, as scripts/releases.mjs reads it). */
export const RELEASES_PAGE = 'https://github.com/lennystepn-hue/cuttle-ai-screen-recorder/releases';
/** The first check waits this long after the start (it is no reason to start slower), then one a day. */
const FIRST_CHECK_MS = 30_000;
const EVERY_MS = 24 * 60 * 60 * 1000;

let service: Updates | undefined;

/** The app's updates (made once). */
export function updates(): Updates {
  if (service) return service;
  const feed = CHECK ? process.env.CUTTLE_UPDATE_FEED || undefined : undefined;
  const supported = CHECK ? feed !== undefined : app.isPackaged;
  const { autoUpdater } = electronUpdater;
  autoUpdater.logger = null;
  autoUpdater.autoDownload = !CHECK;
  autoUpdater.autoInstallOnAppQuit = true;
  if (feed) {
    autoUpdater.forceDevUpdateConfig = true;
    autoUpdater.setFeedURL({ provider: 'generic', url: feed });
  }
  service = createUpdates(autoUpdater, { version: appVersion(), supported, autoDownload: autoUpdater.autoDownload });
  return service;
}

/** Checks a little after the start and then once a day, while the setting says so. */
export async function startUpdates(): Promise<void> {
  const service = updates();
  if (!service.status().supported) return;
  let auto = (await loadSettings()).updates;
  onSettingsChange((settings) => {
    auto = settings.updates;
  });
  const look = () => {
    if (auto) void service.check();
  };
  setTimeout(look, FIRST_CHECK_MS);
  setInterval(look, EVERY_MS);
}

/** Restart and update: not while a take records (it is installed when Cuttle quits after it). */
export function installUpdate(): { problem?: string } {
  if (recordingRuns()) return { problem: 'Cuttle is recording. It updates after the stop, when it quits.' };
  return updates().install() ? {} : { problem: 'No update is ready yet.' };
}

/** The releases page, where every version can be downloaded by hand (the check opens no browser). */
export function openReleases(): Promise<void> {
  if (CHECK) {
    (globalThis as { __openedReleases?: number }).__openedReleases = ((globalThis as { __openedReleases?: number }).__openedReleases ?? 0) + 1;
    return Promise.resolve();
  }
  return shell.openExternal(RELEASES_PAGE);
}
