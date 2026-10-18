// The desktop's wallpaper as a background (`cuttle background --wallpaper`, the Look tab's "Your
// wallpaper"): where each system keeps it. `CUTTLE_WALLPAPER` names a file instead (the checks
// never read the computer's own).
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { CoreError } from './errors';
import { keepInProject } from './keep-file';
import { macWallpaper } from './wallpaper-darwin';
import { windowsWallpaper } from './wallpaper-win32';

/** The wallpaper's file: `CUTTLE_WALLPAPER`, else the system's; none where it cannot be found. */
export async function wallpaperFile(): Promise<string | undefined> {
  if (process.env.CUTTLE_WALLPAPER) return process.env.CUTTLE_WALLPAPER;
  if (process.platform === 'win32') return windowsWallpaper();
  if (process.platform === 'darwin') return macWallpaper();
  return undefined;
}

/** An image's extension by its first bytes (Windows' copy of the wallpaper has none). */
function imageExtension(bytes: Buffer, path: string): string {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return '.jpg';
  if (bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return '.png';
  if (bytes.subarray(8, 12).toString('latin1') === 'WEBP') return '.webp';
  return extname(path).toLowerCase();
}

/** Copies the wallpaper into the project's `images/` as `wallpaper.<ext>`; returns its project path. */
export async function importWallpaper(projectDir: string): Promise<string> {
  const file = await wallpaperFile();
  if (!file) throw new CoreError('missing-file', 'no wallpaper was found on this computer: choose an image instead');
  let bytes: Buffer;
  try {
    bytes = await readFile(file);
  } catch (error) {
    throw new CoreError('missing-file', `cannot read the wallpaper ${file}: ${(error as Error).message}`, { cause: error });
  }
  const ext = imageExtension(bytes, file);
  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) throw new CoreError('invalid-media', `the wallpaper (${file}) is not a JPEG, PNG or WebP image: choose an image instead`);
  return keepInProject(projectDir, bytes, 'images', 'wallpaper', ext);
}
