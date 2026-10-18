import { readFile, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { imagePalette, importWallpaper, keepInProject, readProjectFile, takePalette, writeProjectFile, type ProjectFile } from '@cuttle/core';
import { BACKGROUND_PRESETS, isColouredBackground, switchBackground, type BackgroundPreset } from '@cuttle/project';
import { CliError } from '../errors';
import type { Output } from '../output';

/** How soft a wallpaper is made when nothing says otherwise: it sits behind the window. */
const WALLPAPER_BLUR = 0.6;

export interface BackgroundArgs {
  colors?: string;
  from?: string;
  angle?: number;
  radial?: boolean;
  linear?: boolean;
  color?: string;
  image?: string;
  wallpaper?: boolean;
  blur?: number;
  dim?: number;
}

const isFile = (path: string) => stat(path).then((info) => info.isFile(), () => false);

/** An image as a project path: one inside the project as it is, one outside copied into images/. */
async function projectImage(file: ProjectFile, given: string): Promise<string> {
  const path = resolve(given);
  if (!(await isFile(path))) throw new CliError('missing-file', `no image at ${given}`);
  const rel = relative(file.dir, path);
  if (rel && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)) return rel.split(sep).join('/');
  const stem = basename(path, extname(path)).replace(/[^\w.-]+/g, '-') || 'image';
  return keepInProject(file.dir, await readFile(path), 'images', stem, extname(path).toLowerCase());
}

/** The colours of the take, the brand's logo, or an image file. */
async function paletteFrom(file: ProjectFile, from: string): Promise<string[]> {
  if (from === 'take') {
    const screen = resolve(file.dir, file.project.sources.screen);
    if (!(await isFile(screen))) throw new CliError('missing-file', `the take's screen recording is not there (${file.project.sources.screen}): record a take, or name an image`);
    return takePalette(screen);
  }
  if (from === 'logo') {
    if (!file.project.theme.logo) throw new CliError('usage', 'the project has no logo (theme.logo): set one, or name an image');
    return imagePalette(resolve(file.dir, file.project.theme.logo));
  }
  if (!(await isFile(resolve(from)))) throw new CliError('missing-file', `--from ${from}: not "take", "logo" or an image file`);
  return imagePalette(resolve(from));
}

/**
 * `cuttle background [preset]`: the background behind the window. A preset by name, a gradient of
 * colours given or read off the product (`--from take|logo|<image>`), an image or the desktop's
 * wallpaper, softened (`--blur`) and darkened (`--dim`). Options without a preset choose one: colours
 * a gradient (unless the background takes colours already), an image or the wallpaper the image.
 */
export async function backgroundCommand(projectDir: string, preset: string | undefined, args: BackgroundArgs, output: Output): Promise<{ background: Record<string, unknown> }> {
  if (preset !== undefined && !(BACKGROUND_PRESETS as readonly string[]).includes(preset)) {
    throw new CliError('usage', `no background "${preset}" (${BACKGROUND_PRESETS.join(', ')})`);
  }
  if (args.radial && args.linear) throw new CliError('usage', '--radial and --linear together');
  if (args.image && args.wallpaper) throw new CliError('usage', '--image and --wallpaper together');
  if (args.colors && args.from) throw new CliError('usage', '--colors and --from together');
  const file = await readProjectFile(projectDir);
  const current = file.project.look.background;
  const target = (preset ??
    (args.image || args.wallpaper ? 'image' : args.color ? 'solid' : (args.colors || args.from) && !isColouredBackground(current.preset) ? 'gradient' : current.preset)) as BackgroundPreset;
  // the fields the new preset reads stay (a gradient's colours become the flow's)
  const background = switchBackground(current, target);
  if (args.color !== undefined) background.color = args.color;
  if (args.colors !== undefined) background.colors = args.colors.split(',').map((color) => color.trim());
  if (args.from !== undefined) background.colors = await paletteFrom(file, args.from);
  if (args.angle !== undefined) background.angle = args.angle;
  if (args.radial) background.kind = 'radial';
  if (args.linear) delete background.kind;
  if (args.image !== undefined) background.image = await projectImage(file, args.image);
  if (args.wallpaper) {
    background.image = await importWallpaper(file.dir);
    background.blur ??= WALLPAPER_BLUR;
  }
  if (args.blur !== undefined) background.blur = args.blur;
  if (args.dim !== undefined) background.dim = args.dim;
  const look = file.raw.look && typeof file.raw.look === 'object' ? (file.raw.look as Record<string, unknown>) : {};
  file.raw.look = { ...look, background };
  await writeProjectFile(file, 'background');
  output.result({ background }, () => `the background: ${JSON.stringify(background)}`);
  return { background };
}
