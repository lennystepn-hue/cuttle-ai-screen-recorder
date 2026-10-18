import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { BRAND_VERSION, parseBrandKitJson, type BrandKit, type CuttleProject } from '@cuttle/project';
import { CoreError } from './errors';
import type { ProjectFile } from './project-file';

/** A kit's file in its folder. */
export const BRAND_FILE = 'brand.json';
/** The folder in a project that a kit's files are copied into (and a logo the person picks). */
export const PROJECT_BRAND_DIR = 'brand';

/**
 * The folder the brand kits are kept in, one folder each: `CUTTLE_BRANDS_DIR` when set, else the
 * user's app data (`%APPDATA%\Cuttle\brands` on Windows, `~/Library/Application Support/Cuttle/brands`
 * on macOS, `$XDG_CONFIG_HOME/cuttle/brands` elsewhere).
 */
export function brandsDir(): string {
  if (process.env.CUTTLE_BRANDS_DIR) return process.env.CUTTLE_BRANDS_DIR;
  if (process.platform === 'win32') return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Cuttle', 'brands');
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Cuttle', 'brands');
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'cuttle', 'brands');
}

/** A kit's folder name: its name in lower-case letters, digits and dashes ("Acme Café" is `acme-cafe`). */
export function brandSlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  return slug || 'brand';
}

/** A saved kit: what it holds, and where. */
export interface Brand {
  kit: BrandKit;
  /** Its folder name (`brandSlug` of its name). */
  slug: string;
  dir: string;
  /** Its logo and background image as files on disk. */
  logo?: string;
  image?: string;
}

const toBrand = (kit: BrandKit, dir: string, slug: string): Brand => ({
  kit,
  slug,
  dir,
  ...(kit.theme.logo && { logo: join(dir, kit.theme.logo) }),
  ...(kit.look.background.image && { image: join(dir, kit.look.background.image) }),
});

const issuesText = (issues: readonly { path: string; message: string }[]) => issues.map((issue) => `  ${issue.path}: ${issue.message}`).join('\n');

/** Every kit in the folder, by name; folders without a readable, valid `brand.json` are left out. */
export async function listBrands(root = brandsDir()): Promise<Brand[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const brands: Brand[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const dir = join(root, entry.name);
    const text = await readFile(join(dir, BRAND_FILE), 'utf8').catch(() => undefined);
    const parsed = text === undefined ? undefined : parseBrandKitJson(text);
    if (parsed?.ok) brands.push(toBrand(parsed.kit, dir, entry.name));
  }
  return brands.sort((a, b) => a.kit.name.localeCompare(b.kit.name));
}

/** The kit of a name (its slug's folder). */
export async function findBrand(name: string, root = brandsDir()): Promise<Brand> {
  const slug = brandSlug(name);
  const dir = join(root, slug);
  const path = join(dir, BRAND_FILE);
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new CoreError('missing-file', `no brand kit "${name}" in ${root} ("cuttle brand list" lists them)`);
    throw new CoreError('missing-file', `cannot read ${path}: ${(error as Error).message}`, { cause: error });
  }
  const parsed = parseBrandKitJson(text);
  if (!parsed.ok) throw new CoreError('invalid-project', `${path} is not a valid brand kit:\n${issuesText(parsed.issues)}`);
  return toBrand(parsed.kit, dir, slug);
}

const isFile = (path: string) => stat(path).then((info) => info.isFile(), () => false);

/**
 * Saves a project's brand as a kit, replacing a kit of the same name: its theme, its background,
 * its frame's style and its cursor's style and colour, with copies of its logo and background image.
 */
export async function saveBrand(projectDir: string, project: CuttleProject, name: string, root = brandsDir()): Promise<Brand> {
  const trimmed = name.trim();
  if (!trimmed) throw new CoreError('usage', 'a brand kit needs a name');
  if (trimmed.length > 80) throw new CoreError('usage', 'a brand kit\'s name is 80 characters at most');
  const slug = brandSlug(trimmed);
  const files: { source: string; name: string }[] = [];
  const keep = (path: string, stem: string): string => {
    const file = `${stem}${extname(path).toLowerCase()}`;
    files.push({ source: resolve(projectDir, path), name: file });
    return file;
  };
  const { kit: _kit, logo, ...theme } = project.theme;
  const { image, ...background } = project.look.background;
  const kit: BrandKit = {
    version: BRAND_VERSION,
    name: trimmed,
    theme: { ...theme, ...(logo && { logo: keep(logo, 'logo') }) },
    look: {
      background: background.preset === 'image' && image ? { ...background, image: keep(image, 'background') } : background,
      frame: { style: project.look.frame.style },
      cursor: { style: project.look.cursor.style, color: project.look.cursor.color },
    },
  };
  for (const file of files) {
    if (!(await isFile(file.source))) throw new CoreError('missing-file', `${file.source} is not there: the brand's ${file.name.startsWith('logo') ? 'logo' : 'background image'} must be a file in the project`);
  }
  await mkdir(root, { recursive: true });
  // the kit is written beside its folder, then put in its place (a kit is never half written)
  const temp = join(root, `.${slug}-${randomUUID()}`);
  await mkdir(temp);
  try {
    for (const file of files) await copyFile(file.source, join(temp, file.name));
    await writeFile(join(temp, BRAND_FILE), `${JSON.stringify(kit, null, 2)}\n`);
    const dir = join(root, slug);
    await rm(dir, { recursive: true, force: true });
    await rename(temp, dir);
    return toBrand(kit, dir, slug);
  } catch (error) {
    await rm(temp, { recursive: true, force: true });
    throw error;
  }
}

/** Removes a kit. */
export async function removeBrand(name: string, root = brandsDir()): Promise<Brand> {
  const brand = await findBrand(name, root);
  await rm(brand.dir, { recursive: true, force: true });
  return brand;
}

/**
 * Copies a kit's file into the project's `brand/` folder as `<stem><ext>`: the file there already
 * when it has the same bytes, else the next free `<stem>-2<ext>`… (a file applied before is never
 * overwritten, so undoing an apply in the editor finds its own logo). Returns its project path.
 */
async function copyIntoProject(projectDir: string, source: string, stem: string): Promise<string> {
  let bytes: Buffer;
  try {
    bytes = await readFile(source);
  } catch (error) {
    throw new CoreError('missing-file', `cannot read the brand kit's ${source}: ${(error as Error).message}`, { cause: error });
  }
  const folder = join(projectDir, PROJECT_BRAND_DIR);
  await mkdir(folder, { recursive: true });
  const ext = extname(source).toLowerCase();
  for (let n = 1; ; n++) {
    const name = `${stem}${n === 1 ? '' : `-${n}`}${ext}`;
    const target = join(folder, name);
    const existing = await readFile(target).catch(() => undefined);
    if (existing?.equals(bytes)) return `${PROJECT_BRAND_DIR}/${name}`;
    if (existing) continue;
    await writeFile(target, bytes, { flag: 'wx' });
    return `${PROJECT_BRAND_DIR}/${name}`;
  }
}

/** What applying a kit sets in a project, its files copied into the project first. */
export interface BrandFields {
  /** The whole theme, with the kit's name (`kit`). */
  theme: CuttleProject['theme'];
  /** `look.background` as a whole. */
  background: CuttleProject['look']['background'];
  frame: { style: CuttleProject['look']['frame']['style'] };
  cursor: { style: CuttleProject['look']['cursor']['style']; color: string };
}

/** Copies a kit's logo and background image into the project and returns what applying it sets. */
export async function brandFields(brand: Brand, projectDir: string): Promise<BrandFields> {
  const { logo: _logo, ...theme } = brand.kit.theme;
  const { image: _image, ...background } = brand.kit.look.background;
  return {
    theme: { ...theme, ...(brand.logo && { logo: await copyIntoProject(projectDir, brand.logo, `${brand.slug}-logo`) }), kit: brand.kit.name },
    background: { ...background, ...(brand.image && { image: await copyIntoProject(projectDir, brand.image, `${brand.slug}-background`) }) },
    frame: { ...brand.kit.look.frame },
    cursor: { ...brand.kit.look.cursor },
  };
}

/**
 * Applies a kit to a project file (`file.raw`, for the caller to write): the theme is replaced, the
 * look's background is set, and its frame's style and cursor's style and colour; the rest stays.
 */
export async function applyBrand(file: ProjectFile, name: string, root = brandsDir()): Promise<{ brand: Brand; fields: BrandFields }> {
  const brand = await findBrand(name, root);
  const fields = await brandFields(brand, file.dir);
  const object = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {});
  const look = object(file.raw.look);
  file.raw.theme = fields.theme;
  file.raw.look = { ...look, background: fields.background, frame: { ...object(look.frame), ...fields.frame }, cursor: { ...object(look.cursor), ...fields.cursor } };
  return { brand, fields };
}
