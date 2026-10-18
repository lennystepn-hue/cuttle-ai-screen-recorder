// The background's helpers for the editor: the colours of the take's screen or of the brand's
// logo, and the desktop's wallpaper copied into the project.
import { resolve } from 'node:path';
import { CoreError, imagePalette, importWallpaper, readProjectFile, takePalette } from '@cuttle/core';
import { isInside } from '../shared/media-path';
import { CHECK } from './check';

/** A failure the person can act on, as the page shows it. */
const problem = (error: unknown): { problem: string } => {
  if (error instanceof CoreError) return { problem: error.message };
  throw error;
};

/** The colours of the take's screen, or of the logo (the page's path to it, in the project). */
export async function backgroundPalette(dir: string, from: 'take' | 'logo', logo?: string): Promise<{ colors: string[] } | { problem: string }> {
  try {
    if (from === 'logo') {
      const path = logo === undefined ? undefined : resolve(dir, logo);
      if (!path || !isInside(path, dir, process.platform)) return { problem: 'The brand has no logo in the project: choose one under Brand first.' };
      return { colors: await imagePalette(path) };
    }
    const { project } = await readProjectFile(dir);
    return { colors: await takePalette(resolve(dir, project.sources.screen)) };
  } catch (error) {
    return problem(error);
  }
}

/** The desktop's wallpaper, copied into the project; the check gives one of its own (never this computer's). */
export async function projectWallpaper(dir: string): Promise<{ path: string } | { problem: string }> {
  if (CHECK && !process.env.CUTTLE_WALLPAPER) throw new Error('the check sets no CUTTLE_WALLPAPER');
  try {
    return { path: await importWallpaper(dir) };
  } catch (error) {
    return problem(error);
  }
}
