import { applyBrand, brandsDir, listBrands, readProjectFile, removeBrand, saveBrand, writeProjectFile, type Brand, type BrandFields } from '@cuttle/core';
import type { BrandKit } from '@cuttle/project';
import type { Output } from '../output';

/** A kit as the commands report it: what it holds, its folder and its files. */
export interface BrandEntry extends BrandKit {
  dir: string;
  logo?: string;
  image?: string;
}

const entry = (brand: Brand): BrandEntry => ({ ...brand.kit, dir: brand.dir, ...(brand.logo && { logo: brand.logo }), ...(brand.image && { image: brand.image }) });

/** One line for people: the name, the colours and the font. */
const line = (kit: BrandKit) => `${kit.name.padEnd(20)} ${kit.theme.accent ?? kit.look.cursor.color} ${kit.theme.font}${kit.theme.url ? `  ${kit.theme.url}` : ''}${kit.theme.logo ? '  (logo)' : ''}`;

/** `cuttle brand list`: the saved brand kits, and where they are kept. */
export async function brandListCommand(output: Output): Promise<{ dir: string; brands: BrandEntry[] }> {
  const result = { dir: brandsDir(), brands: (await listBrands()).map(entry) };
  output.result(result, () => [...result.brands.map(line), result.brands.length ? `kept in ${result.dir}` : `no brand kits yet (save one: cuttle brand save <name>)`].join('\n'));
  return result;
}

/** `cuttle brand save <name>`: the project's brand as a kit (replacing a kit of that name). */
export async function brandSaveCommand(projectDir: string, name: string, output: Output): Promise<{ brand: BrandEntry }> {
  const file = await readProjectFile(projectDir);
  const result = { brand: entry(await saveBrand(file.dir, file.project, name)) };
  output.result(result, () => `saved the brand kit "${result.brand.name}" (${result.brand.dir})`);
  return result;
}

/** `cuttle brand apply <name>`: a kit's theme, background, frame style and cursor in the project, its files copied into brand/. */
export async function brandApplyCommand(projectDir: string, name: string, output: Output): Promise<{ brand: string; backup?: string } & BrandFields> {
  const file = await readProjectFile(projectDir);
  const { brand, fields } = await applyBrand(file, name);
  // it replaces the theme and the look's brand parts: the project as it was stays as cuttle.json.bak
  const { backup } = await writeProjectFile(file, 'brand apply', { backup: true });
  const result = { brand: brand.kit.name, ...fields, ...(backup && { backup }) };
  output.result(result, () => `the project wears "${brand.kit.name}" now: its theme, background (${fields.background.preset}), frame (${fields.frame.style}) and cursor (${fields.cursor.style}, ${fields.cursor.color})`);
  return result;
}

/** `cuttle brand remove <name>`: removes a saved kit (projects keep what it set). */
export async function brandRemoveCommand(name: string, output: Output): Promise<{ removed: string; dir: string }> {
  const brand = await removeBrand(name);
  const result = { removed: brand.kit.name, dir: brand.dir };
  output.result(result, () => `removed the brand kit "${result.removed}" (projects keep what it set)`);
  return result;
}
