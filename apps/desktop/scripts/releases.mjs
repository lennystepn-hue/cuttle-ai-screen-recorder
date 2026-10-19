// Where Cuttle's releases are: the GitHub repository of package.json's "repository"
// (github:<owner>/<repo>). The installers are published there, and the app's updates read them.
import { readFileSync } from 'node:fs';

const root = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
const match = /^github:([^/]+)\/(.+)$/.exec(root.repository ?? '');
if (!match) throw new Error(`package.json's repository is not github:<owner>/<repo>: ${root.repository}`);
export const RELEASES = { owner: match[1], repo: match[2] };

/**
 * The packaged app's update feed (electron-updater reads resources/app-update.yml): the GitHub
 * releases, the downloads kept in %LOCALAPPDATA%\\cuttle-updater (macOS: ~/Library/Caches/cuttle-updater),
 * where the installer keeps itself too.
 */
export const APP_UPDATE_YML = `provider: github\nowner: ${RELEASES.owner}\nrepo: ${RELEASES.repo}\nupdaterCacheDirName: cuttle-updater\n`;
