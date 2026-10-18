// Windows' wallpaper (see wallpaper.ts): the registry's (read only), else the copy Windows keeps.
import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const isFile = (path: string) => stat(path).then((info) => info.isFile(), () => false);

/** The wallpaper's path in the output of `reg query "HKCU\Control Panel\Desktop" /v WallPaper`. */
export function parseRegWallpaper(stdout: string): string | undefined {
  const match = /^\s*WallPaper\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/im.exec(stdout);
  return match?.[1]?.trim() || undefined;
}

/** Windows: the registry's wallpaper, else the copy Windows keeps of it (a slideshow's, or one set from a photo). */
export async function windowsWallpaper(): Promise<string | undefined> {
  const named = await run('reg', ['query', 'HKCU\\Control Panel\\Desktop', '/v', 'WallPaper'], { windowsHide: true }).then(
    ({ stdout }) => parseRegWallpaper(stdout),
    () => undefined,
  );
  if (named && (await isFile(named))) return named;
  const copy = join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper');
  return process.env.APPDATA && (await isFile(copy)) ? copy : undefined;
}
