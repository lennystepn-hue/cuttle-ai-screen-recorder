// The brand kits in the editor: applied as one step to undo (the main process copies their files
// into the project first), saved from the page's version of the project, and removed.
import type { BrandView } from '../../shared/ipc';
import { bridge } from '../bridge';
import { edit, toast } from './doc';
import { documentProject, store } from './session';

/** Applies a saved kit: its theme, background, frame style and cursor, one step to undo. */
export async function applyBrandKit(name: string): Promise<void> {
  const applied = await bridge.invoke('brand:apply', name);
  if ('problem' in applied) return toast(applied.problem, { tone: 'warning' });
  edit(
    [
      { type: 'theme', fields: applied.theme, replace: true },
      { type: 'look', path: ['background'], value: applied.background },
      { type: 'look', path: ['frame', 'style'], value: applied.frame.style },
      { type: 'look', path: ['cursor', 'style'], value: applied.cursor.style },
      { type: 'look', path: ['cursor', 'color'], value: applied.cursor.color },
    ],
    `Brand: ${name}`,
  );
}

/** The kits after a change, or undefined when it could not be made (a toast says why). */
function kitsAfter(result: { brands: BrandView[] } | { problem: string }): BrandView[] | undefined {
  if (!('problem' in result)) return result.brands;
  toast(result.problem, { tone: 'warning' });
  return undefined;
}

/** Saves the project's brand as a kit (a kit of that name is replaced); the project then wears it. */
export async function saveBrandKit(name: string): Promise<BrandView[] | undefined> {
  const raw = store.get().doc?.raw;
  if (!raw) return undefined;
  const brands = kitsAfter(await bridge.invoke('brand:save', { name, raw }));
  if (!brands) return undefined;
  if (documentProject()?.theme.kit !== name) edit([{ type: 'theme', fields: { kit: name } }], `Saved as kit: ${name}`);
  toast(`Saved the brand kit “${name}”: apply it to any project from here.`);
  return brands;
}

/** Removes a kit; projects keep what it set. */
export async function removeBrandKit(name: string): Promise<BrandView[] | undefined> {
  const brands = kitsAfter(await bridge.invoke('brand:remove', name));
  if (brands) toast(`Removed the brand kit “${name}”. Projects keep what it set.`);
  return brands;
}
