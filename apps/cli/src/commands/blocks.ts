import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import {
  PROJECT_FILE,
  addCredit,
  adaptBlock,
  blockFiles,
  blockNamed,
  blocksCache,
  fetchBytes,
  fetchText,
  findBlocks,
  hyperframesCatalog,
  iconName,
  iconifyIcon,
  lottieInfo,
  lottiePage,
  lottieSeconds,
  readProjectFile,
  searchIconify,
  vendorPage,
  writeProjectFile,
  vendoredLicense,
  type BlockItem,
  type Credit,
} from '@cuttle/core';
import { CliError } from '../errors';
import type { Output } from '../output';
import { addMotionPage, saidMotionAdded, type MotionAddArgs, type MotionAddResult } from './motion';

// `cuttle blocks`: motion blocks, Lottie animations and icons from open collections, found by what
// they show, looked at before they are used, and brought into the project so they render offline
// and the same every time, with where they came from and their licences in credits.json and
// CREDITS.md. HyperFrames' registry for blocks (pages with a GSAP timeline), any Lottie JSON by its
// URL (LottieFiles' free animations: their page's "Lottie JSON" link), Iconify for icons.

export interface BlocksSearchArgs {
  /** `hyperframes` (blocks, the default) or `icons` (Iconify's). */
  source?: string;
  tag?: string;
  /** Read the registry again now, not the catalogue kept for a day. */
  refresh?: boolean;
}

/** A block as `search` lists it. */
const listed = (item: BlockItem) => ({ name: `hyperframes:${item.name}`, title: item.title, description: item.description, tags: item.tags, duration: item.duration, size: `${item.width}×${item.height}`, ...(item.poster && { poster: item.poster }) });

/** `cuttle blocks search <words>`: blocks (or icons) that show these words, best first. */
export async function blocksSearchCommand(words: string[], args: BlocksSearchArgs, output: Output, signal: AbortSignal): Promise<unknown> {
  const source = args.source ?? 'hyperframes';
  if (source === 'icons') {
    const icons = await searchIconify(words, 30, signal);
    const result = { source, icons: icons.map((icon) => ({ name: icon.name, set: icon.set.name, license: icon.set.license })) };
    output.result(result, () => [...result.icons.map((icon) => `${icon.name.padEnd(44)} ${icon.set} (${icon.license})`), '', 'bring one in: cuttle blocks add <name>, then /media/icons/<set>-<name>.svg in a page'].join('\n'));
    return result;
  }
  if (source !== 'hyperframes') throw new CliError('usage', `--source ${source}: hyperframes (blocks) or icons`);
  output.info('reading the catalogue of HyperFrames\' blocks …');
  const catalog = await hyperframesCatalog({ refresh: args.refresh ?? false, signal });
  const blocks = findBlocks(catalog.items, words, { ...(args.tag && { tag: args.tag }) }).map(listed);
  const result = { source, ref: catalog.ref, count: catalog.items.length, blocks };
  output.result(result, () =>
    blocks.length === 0
      ? `no block for "${words.join(' ')}" among ${catalog.items.length}: try another word (what it shows: chart, logo, glitch, carousel, terminal, map)`
      : [...blocks.map((block) => `${block.name.padEnd(36)}${block.duration} s  ${block.title}: ${block.description.slice(0, 90)}`), '', 'look at one: cuttle blocks show <name>; bring it in: cuttle blocks add <name>'].join('\n'),
  );
  return result;
}

/** `cuttle blocks show <name>`: a block's preview picture, to look at before it comes in. */
export async function blocksShowCommand(projectDir: string, name: string, output: Output, signal: AbortSignal): Promise<{ block: ReturnType<typeof listed>; poster?: string }> {
  const catalog = await hyperframesCatalog({ signal });
  const item = blockNamed(catalog, name);
  const folder = existsSync(join(projectDir, PROJECT_FILE)) ? join(projectDir, 'preview', 'blocks') : join(blocksCache(), 'previews');
  let poster: string | undefined;
  if (item.poster) {
    poster = join(folder, `${item.name}${/\.(jpe?g|webp)$/i.exec(item.poster)?.[0] ?? '.png'}`);
    await mkdir(folder, { recursive: true });
    await writeFile(poster, await fetchBytes(item.poster, signal));
  }
  const result = { block: listed(item), ...(poster && { poster }) };
  output.result(result, () => [`${item.title} (${item.duration} s, ${item.width}×${item.height}): ${item.description}`, `tags: ${item.tags.join(', ')}`, poster ? `preview: ${poster}` : 'no preview picture', ...(item.variables.length > 0 ? [`params: ${item.variables.map((variable) => variable.id).join(', ')}`] : [])].join('\n'));
  return result;
}

export interface BlocksAddArgs extends MotionAddArgs {
  /** Its folder in motion/ (default: from its name). */
  name?: string;
}

export interface BlocksAddResult {
  /** What came in: a page's `motion/<name>/index.html`, or an icon's file. */
  src: string;
  credit: Credit;
  /** The page's place in the video (a block or a Lottie animation). */
  added?: MotionAddResult;
  /** What its page loaded from the network, now in its folder. */
  vendored?: string[];
  /** Network URLs it still loads: the item loads them with `network` on. */
  left?: string[];
}

/** A folder in `motion/` for `name`, beside any folder of that name already there. */
async function freeFolder(projectDir: string, name: string): Promise<string> {
  const base = name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'block';
  for (let n = 1; ; n++) {
    const folder = n === 1 ? base : `${base}-${n}`;
    if (!(await stat(join(projectDir, 'motion', folder)).then(() => true, () => false))) return folder;
  }
}

/**
 * `cuttle blocks add <name or URL>`: a block of HyperFrames' (`hyperframes:<name>` or its name) or a
 * Lottie animation (a URL or a file of its JSON) as a motion page in `motion/<name>/`, what it loads
 * brought beside it, placed in the video as `motion add` places a page; or an icon of Iconify's
 * (`icons:<set>:<name>`) as `media/icons/<set>-<name>.svg`. Its source and licence go into the credits.
 */
export async function blocksAddCommand(projectDir: string, name: string, args: BlocksAddArgs, output: Output, signal: AbortSignal): Promise<BlocksAddResult> {
  const file = await readProjectFile(projectDir);
  const dir = file.dir;
  let result: BlocksAddResult;
  if (/^(icons|iconify):/.test(name)) {
    const { prefix, icon } = iconName(name);
    const fetched = await iconifyIcon(name, signal);
    const src = `media/icons/${prefix}-${icon}.svg`;
    await mkdir(join(dir, 'media', 'icons'), { recursive: true });
    await writeFile(join(dir, src), fetched.svg);
    const credit: Credit = { path: src, title: `${prefix}:${icon}`, source: `Iconify, the set ${fetched.set.name}`, url: fetched.set.licenseUrl ?? fetched.url, license: fetched.set.license, ...(fetched.set.author && { author: fetched.set.author }) };
    await addCredit(dir, credit);
    result = { src, credit };
    output.result(result, () => `${src}: ${credit.source}, ${credit.license}\nin a page: <img src="/${src}"> (or fetch it to colour its paths)`);
    return result;
  }
  if (/\.json(\?.*)?$/i.test(name)) {
    const from = /^https:/.test(name) ? name : resolve(name);
    const text = /^https:/.test(name) ? await fetchText(name, signal) : await readFile(from, 'utf8').catch(() => {
      throw new CliError('missing-file', `no Lottie file at ${from}`);
    });
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new CliError('invalid-project', `${from} is not JSON`);
    }
    const info = lottieInfo(json, from);
    const folder = await freeFolder(dir, args.name ?? info.nm ?? basename(new URL(/^https:/.test(name) ? name : `file://${from}`).pathname, '.json'));
    await mkdir(join(dir, 'motion', folder), { recursive: true });
    await writeFile(join(dir, 'motion', folder, 'animation.json'), text);
    await writeFile(join(dir, 'motion', folder, 'index.html'), lottiePage(info, from));
    const src = `motion/${folder}/index.html`;
    const added = await addMotionPage(dir, src, args, lottieSeconds(info));
    const credit: Credit = { path: `motion/${folder}/`, title: info.nm ?? folder, source: /lottiefiles|lottie\.host/.test(from) ? 'LottieFiles (a free animation: the Lottie Simple License; check its page)' : 'a Lottie animation', url: from, license: /lottiefiles|lottie\.host/.test(from) ? 'Lottie Simple License' : 'see its source' };
    await addCredit(dir, credit);
    result = { src, credit, added };
    output.result(result, () => `${saidMotionAdded(added, args)}\nfrom ${from} (${lottieSeconds(info)} s at ${info.fr} fps)\ncheck it: cuttle motion check ${src}`);
    return result;
  }
  // a block of HyperFrames'
  const catalog = await hyperframesCatalog({ signal });
  const item = blockNamed(catalog, name);
  const folder = await freeFolder(dir, args.name ?? item.name);
  const target = join(dir, 'motion', folder);
  output.info(`bringing in HyperFrames' block ${item.name} (${item.files.length} file(s)) and what it loads …`);
  try {
    const files = await blockFiles(catalog, item, signal);
    for (const { path, bytes } of files.slice(1)) {
      await mkdir(dirname(join(target, path)), { recursive: true });
      await writeFile(join(target, path), bytes);
    }
    const vendored = await vendorPage(new TextDecoder().decode(files[0]!.bytes), target, signal);
    await writeFile(join(target, 'index.html'), adaptBlock(vendored.html, item));
    const blockUrl = `https://github.com/heygen-com/hyperframes/tree/${catalog.ref}/registry/blocks/${item.name}`;
    await writeFile(join(target, 'block.json'), `${JSON.stringify({ source: 'hyperframes', name: item.name, title: item.title, ref: catalog.ref, url: blockUrl, license: 'Apache-2.0', vendored: vendored.brought, left: vendored.left }, null, 2)}\n`);
    const src = `motion/${folder}/index.html`;
    const added = await addMotionPage(dir, src, args, item.duration);
    if (vendored.left.length > 0) {
      // it still loads from the network: the item may, as its page asks
      const latest = await readProjectFile(dir);
      const list = added.kind === 'overlay' ? latest.project.overlays : latest.project.scenes;
      const placed = list.find((entry) => 'src' in entry && entry.src === src) as { network?: boolean } | undefined;
      if (placed) {
        placed.network = true;
        await writeProjectFile(latest, 'blocks add');
      }
      output.warn(`${item.name} still loads ${vendored.left.length} file(s) from the network (${vendored.left.slice(0, 3).join(', ')}): its item has network on`);
    }
    const credit: Credit = {
      path: `motion/${folder}/`,
      title: item.title,
      source: "HyperFrames' registry (heygen-com/hyperframes)",
      url: blockUrl,
      license: 'Apache-2.0',
      ...(vendored.brought.length > 0 && { vendored: vendored.brought.map((entry) => ({ url: entry.url, license: vendoredLicense(entry.url) })) }),
    };
    await addCredit(dir, credit);
    result = { src, credit, added, vendored: vendored.brought.map((entry) => entry.url), ...(vendored.left.length > 0 && { left: vendored.left }) };
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    throw error;
  }
  output.result(result, () =>
    [
      saidMotionAdded(result.added!, args),
      `${item.title}: ${item.description}`,
      `params: ${[...item.variables.map((variable) => variable.id), 'fit'].join(', ')}`,
      ...(result.vendored && result.vendored.length > 0 ? [`brought in what it loads: ${result.vendored.length} file(s) in motion/${folder}/vendor/`] : []),
      `credits: credits.json and CREDITS.md`,
      `check it: cuttle motion check ${result.src}`,
    ].join('\n'),
  );
  return result;
}
