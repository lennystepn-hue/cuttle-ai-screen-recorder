// The brand kits for the editor's Look tab: listed, saved from the project as the page has it,
// applied (their files copied into the project; the page makes the edit) and removed.
import { brandFields, brandsDir, CoreError, findBrand, listBrands, removeBrand, saveBrand, type Brand } from '@cuttle/core';
import { parseProject } from '@cuttle/project';
import type { BrandApplied, BrandView } from '../shared/ipc';
import { CHECK } from './check';

/** The kits' folder; the check keeps them in a folder of its own, never the user's. */
function root(): string {
  if (CHECK && !process.env.CUTTLE_BRANDS_DIR) throw new Error('the check sets no CUTTLE_BRANDS_DIR');
  return brandsDir();
}

const view = ({ kit }: Brand): BrandView => ({
  name: kit.name,
  accent: kit.theme.accent ?? kit.look.cursor.color,
  background: { preset: kit.look.background.preset, ...(kit.look.background.color && { color: kit.look.background.color }) },
  font: kit.theme.font,
});

/** A failure the person can act on, as the page shows it. */
const problem = (error: unknown): { problem: string } => {
  if (error instanceof CoreError) return { problem: error.message };
  throw error;
};

export const brandViews = async (): Promise<BrandView[]> => (await listBrands(root())).map(view);

export async function saveProjectBrand(dir: string, name: string, raw: Record<string, unknown>): Promise<{ brands: BrandView[] } | { problem: string }> {
  const parsed = parseProject(raw);
  if (!parsed.ok) return { problem: 'the project is not valid right now' };
  try {
    await saveBrand(dir, parsed.project, name, root());
    return { brands: await brandViews() };
  } catch (error) {
    return problem(error);
  }
}

export async function applyProjectBrand(dir: string, name: string): Promise<BrandApplied | { problem: string }> {
  try {
    return await brandFields(await findBrand(name, root()), dir);
  } catch (error) {
    return problem(error);
  }
}

export async function removeProjectBrand(name: string): Promise<{ brands: BrandView[] } | { problem: string }> {
  try {
    await removeBrand(name, root());
    return { brands: await brandViews() };
  } catch (error) {
    return problem(error);
  }
}
