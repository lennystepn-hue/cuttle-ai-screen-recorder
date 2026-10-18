import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { applyBrand, brandSlug, brandsDir, findBrand, listBrands, removeBrand, saveBrand } from '../src/brands';
import { CoreError } from '../src/errors';
import { newProjectFile, readProjectFile, writeProjectFile } from '../src/project-file';

const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'cuttle-brands-'));
  dirs.push(dir);
  return dir;
};
const failure = (promise: Promise<unknown>) => promise.then(() => undefined, (error: unknown) => error);

/** A project with a branded theme, a logo and an image background. */
async function brandedProject() {
  const dir = temp();
  const file = newProjectFile(dir);
  mkdirSync(join(dir, 'brand'));
  writeFileSync(join(dir, 'brand', 'mark.PNG'), 'logo bytes');
  mkdirSync(join(dir, 'images'));
  writeFileSync(join(dir, 'images', 'wall.jpg'), 'wallpaper bytes');
  file.raw.theme = { name: 'Acme', url: 'acme.dev', logo: 'brand/mark.PNG', accent: '#3366FF', font: 'Space Grotesk', kit: 'Old' };
  file.raw.look = { background: { preset: 'image', image: 'images/wall.jpg' }, frame: { style: 'mac-light', title: 'acme · ~/demo' }, cursor: { style: 'ring', color: '#3366FF', size: 1.5 } };
  return (await writeProjectFile(file, 'init')).file;
}

describe('brand kits', () => {
  it('names a kit\'s folder by its name', () => {
    expect(brandSlug('Acme Café')).toBe('acme-cafe');
    expect(brandSlug('  ~~ ')).toBe('brand');
    expect(brandSlug('x'.repeat(60)).length).toBe(48);
  });

  it('keeps kits in CUTTLE_BRANDS_DIR when it is set', () => {
    const before = process.env.CUTTLE_BRANDS_DIR;
    process.env.CUTTLE_BRANDS_DIR = join(tmpdir(), 'somewhere');
    try {
      expect(brandsDir()).toBe(join(tmpdir(), 'somewhere'));
    } finally {
      if (before === undefined) delete process.env.CUTTLE_BRANDS_DIR;
      else process.env.CUTTLE_BRANDS_DIR = before;
    }
  });

  it('saves a project\'s brand with copies of its files, and lists it', async () => {
    const root = temp();
    const project = await brandedProject();
    const brand = await saveBrand(project.dir, project.project, ' Acme ', root);
    expect(brand.slug).toBe('acme');
    expect(readdirSync(brand.dir).sort()).toEqual(['background.jpg', 'brand.json', 'logo.png']);
    expect(JSON.parse(readFileSync(join(brand.dir, 'brand.json'), 'utf8'))).toEqual({
      version: 1,
      name: 'Acme',
      theme: { name: 'Acme', url: 'acme.dev', logo: 'logo.png', accent: '#3366FF', foreground: '#FFFFFF', font: 'Space Grotesk' },
      look: { background: { preset: 'image', image: 'background.jpg' }, frame: { style: 'mac-light' }, cursor: { style: 'ring', color: '#3366FF' } },
    });
    expect(readFileSync(brand.logo!, 'utf8')).toBe('logo bytes');
    // a folder without a valid brand.json, and a half-written one, are not kits
    mkdirSync(join(root, 'broken'));
    writeFileSync(join(root, 'broken', 'brand.json'), '{ "version": 1 }');
    mkdirSync(join(root, '.acme-1234'));
    expect((await listBrands(root)).map((entry) => entry.kit.name)).toEqual(['Acme']);
    expect(await listBrands(join(root, 'none'))).toEqual([]);
  });

  it('replaces a kit of the same name', async () => {
    const root = temp();
    const project = await brandedProject();
    await saveBrand(project.dir, project.project, 'Acme', root);
    const plain = { ...project.project, theme: { ...project.project.theme, logo: undefined }, look: { ...project.project.look, background: { preset: 'aurora' as const } } };
    const brand = await saveBrand(project.dir, plain, 'ACME', root);
    expect(readdirSync(brand.dir)).toEqual(['brand.json']);
    expect(brand.kit.name).toBe('ACME');
    expect(readdirSync(root)).toEqual(['acme']);
  });

  it('refuses a kit without a name or whose logo is missing', async () => {
    const root = temp();
    const project = await brandedProject();
    expect(await failure(saveBrand(project.dir, project.project, '  ', root))).toMatchObject({ code: 'usage' });
    rmSync(join(project.dir, 'brand', 'mark.PNG'));
    const error = await failure(saveBrand(project.dir, project.project, 'Acme', root));
    expect(error).toBeInstanceOf(CoreError);
    expect(error).toMatchObject({ code: 'missing-file' });
    expect(readdirSync(root)).toEqual([]);
  });

  it('applies a kit: the theme, the background, the frame\'s and cursor\'s styles, its files copied in', async () => {
    const root = temp();
    const source = await brandedProject();
    await saveBrand(source.dir, source.project, 'Acme', root);
    const dir = temp();
    const fresh = (await writeProjectFile(newProjectFile(dir), 'init')).file;
    fresh.raw.look = { frame: { title: 'mine', radius: 4 }, cursor: { size: 2 } };
    const { fields } = await applyBrand(fresh, 'acme', root);
    expect(fields.theme).toEqual({ name: 'Acme', url: 'acme.dev', accent: '#3366FF', foreground: '#FFFFFF', font: 'Space Grotesk', logo: 'brand/acme-logo.png', kit: 'Acme' });
    expect(fresh.raw.look).toEqual({
      background: { preset: 'image', image: 'brand/acme-background.jpg' },
      frame: { title: 'mine', radius: 4, style: 'mac-light' },
      cursor: { size: 2, style: 'ring', color: '#3366FF' },
    });
    await writeProjectFile(fresh, 'brand apply');
    const read = await readProjectFile(dir);
    expect(read.project.theme.kit).toBe('Acme');
    expect(readFileSync(join(dir, 'brand', 'acme-logo.png'), 'utf8')).toBe('logo bytes');
    // applied again: the same files; after the kit's logo changed: a new file, the old one kept
    await applyBrand(read, 'Acme', root);
    expect(readdirSync(join(dir, 'brand')).sort()).toEqual(['acme-background.jpg', 'acme-logo.png']);
    writeFileSync(join(root, 'acme', 'logo.png'), 'new logo');
    const again = await applyBrand(read, 'Acme', root);
    expect(again.fields.theme.logo).toBe('brand/acme-logo-2.png');
    expect(readFileSync(join(dir, 'brand', 'acme-logo.png'), 'utf8')).toBe('logo bytes');
  });

  it('says which kit is missing, and removes one', async () => {
    const root = temp();
    expect(await failure(findBrand('Nope', root))).toMatchObject({ code: 'missing-file', message: expect.stringContaining('no brand kit "Nope"') });
    const project = await brandedProject();
    await saveBrand(project.dir, project.project, 'Acme', root);
    await removeBrand('Acme', root);
    expect(readdirSync(root)).toEqual([]);
  });
});
