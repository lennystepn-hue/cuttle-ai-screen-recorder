import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from 'electron';

/**
 * The app's own copy of the CLI: in a packaged app outside the archive (Node runs it, and it loads
 * the native modules unpacked beside it), else the repository's build ("pnpm cli:build"), found
 * from this bundle in apps/desktop/dist/main.
 */
export function cliEntry(): string {
  return app.isPackaged ? join(process.resourcesPath, 'app.asar.unpacked', 'cli', 'cuttle.mjs') : fileURLToPath(new URL('../../../cli/dist/cuttle.mjs', import.meta.url));
}
