// The background's actions in the editor: another preset (what it reads kept), colours read off the
// take or the brand's logo, the desktop's wallpaper; each one step to undo.
import { isColouredBackground, switchBackground, type BackgroundPreset } from '@cuttle/project';
import { BACKGROUND_NAMES } from '../../shared/names';
import { bridge } from '../bridge';
import { edit, toast } from './doc';
import { documentProject } from './session';

/** How soft the wallpaper is made when the image has no softness yet: it sits behind the window. */
export const WALLPAPER_BLUR = 0.6;

const setBackground = (value: Record<string, unknown>, label: string) => edit([{ type: 'look', path: ['background'], value }], label);

/** Another preset (an image is chosen with `chooseImage`), keeping what it reads. */
export function switchTo(preset: Exclude<BackgroundPreset, 'image'>): void {
  const current = documentProject()?.look.background;
  if (current) setBackground(switchBackground(current, preset), `Background: ${BACKGROUND_NAMES[preset]}`);
}

/** The colours of the take's screen or of the brand's logo: a gradient, unless the background takes colours already. */
export async function colorsFrom(from: 'take' | 'logo'): Promise<void> {
  const project = documentProject();
  if (!project) return;
  const result = await bridge.invoke('background:palette', { from, ...(from === 'logo' && project.theme.logo && { logo: project.theme.logo }) });
  if ('problem' in result) return toast(result.problem, { tone: 'warning' });
  const current = documentProject()?.look.background ?? project.look.background;
  const preset = isColouredBackground(current.preset) ? current.preset : 'gradient';
  setBackground({ ...switchBackground(current, preset), colors: result.colors }, from === 'take' ? 'Background: colours of the take' : 'Background: colours of the logo');
}

/** The desktop's wallpaper behind the window, softened (as soft as the image was, if it was). */
export async function wallpaperBehind(): Promise<void> {
  const result = await bridge.invoke('background:wallpaper');
  if ('problem' in result) return toast(result.problem, { tone: 'warning' });
  const current = documentProject()?.look.background;
  const image = current?.preset === 'image' ? current : undefined;
  setBackground({ preset: 'image', image: result.path, blur: image?.blur ?? WALLPAPER_BLUR, ...(image?.dim !== undefined && { dim: image.dim }) }, 'Background: your wallpaper');
}
