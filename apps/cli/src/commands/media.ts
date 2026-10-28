import { mkdir, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import {
  PROJECT_FILE,
  STOCK_SOURCES,
  addCredit,
  blocksCache,
  convertVideo,
  fetchBytes,
  readProjectFile,
  searchStock,
  stockCreditLine,
  stockItem,
  writeProjectFile,
  type Credit,
  type StockItem,
  type StockKind,
  type StockSource,
} from '@cuttle/core';
import { newId, usedIds } from '@cuttle/project';
import { existsSync } from 'node:fs';
import { CliError } from '../errors';
import type { Output } from '../output';
import { addMotionPage, saidMotionAdded, sceneAt, type MotionAddResult } from './motion';

// `cuttle media`: stock media for what a browser cannot draw (a city at night, people at work, a
// desk, nature), footage and photographs from Pexels and Pixabay and sound effects from Freesound,
// with the person's own free keys from the environment; each comes into the project with its author
// and licence in the credits. Footage is converted as `import` converts a take, and a page plays it.

export interface MediaSearchArgs {
  photo?: boolean;
  sound?: boolean;
  source?: string;
  orientation?: string;
  minDuration?: number;
  maxDuration?: number;
}

const listed = (item: StockItem) => ({
  name: item.id,
  title: item.title,
  ...(item.width && item.height && { size: `${item.width}×${item.height}` }),
  ...(item.duration !== undefined && { duration: item.duration }),
  author: item.author,
  license: item.license,
  ...(item.attribution && { attribution: true }),
  ...(item.nonCommercial && { nonCommercial: true }),
  ...(item.preview && { preview: item.preview }),
  page: item.page,
});

/** `cuttle media search <words>`: footage (or `--photo`, `--sound`) that shows these words, from the first service with a key. */
export async function mediaSearchCommand(words: string[], args: MediaSearchArgs, output: Output, signal: AbortSignal): Promise<{ kind: StockKind; items: ReturnType<typeof listed>[] }> {
  if (args.photo && args.sound) throw new CliError('usage', '--photo or --sound, not both');
  const kind: StockKind = args.photo ? 'photo' : args.sound ? 'sound' : 'video';
  if (args.source !== undefined && !(STOCK_SOURCES as readonly string[]).includes(args.source)) throw new CliError('usage', `--source ${args.source}: ${STOCK_SOURCES.join(', ')}`);
  if (args.orientation !== undefined && !['landscape', 'portrait', 'square'].includes(args.orientation)) throw new CliError('usage', `--orientation ${args.orientation}: landscape, portrait or square`);
  const items = await searchStock(
    words,
    {
      kind,
      ...(args.source && { source: args.source as StockSource }),
      ...(args.orientation && { orientation: args.orientation as 'landscape' | 'portrait' | 'square' }),
      ...(args.minDuration !== undefined && { minDuration: args.minDuration }),
      ...(args.maxDuration !== undefined && { maxDuration: args.maxDuration }),
    },
    signal,
  );
  const result = { kind, items: items.map(listed) };
  output.result(result, () =>
    items.length === 0
      ? `no ${kind} for "${words.join(' ')}": try other words (what is in the picture)`
      : [...items.map((item) => `${item.id.padEnd(26)} ${item.duration !== undefined ? `${item.duration} s  ` : ''}${item.title.slice(0, 60)} (${item.author}, ${item.license.split(' (')[0]})`), '', 'look at one: cuttle media show <name>; bring it in: cuttle media add <name> [--scene]'].join('\n'),
  );
  return result;
}

/** `cuttle media show <name>`: its preview picture (or a sound's preview), into preview/media/ in the project. */
export async function mediaShowCommand(projectDir: string, name: string, output: Output, signal: AbortSignal): Promise<{ item: ReturnType<typeof listed>; preview?: string }> {
  const item = await stockItem(name, 1920, signal);
  const folder = existsSync(join(projectDir, PROJECT_FILE)) ? join(projectDir, 'preview', 'media') : join(blocksCache(), 'media');
  let preview: string | undefined;
  if (item.preview) {
    const extension = item.kind === 'sound' ? '.mp3' : (/\.(jpe?g|png|webp)/i.exec(new URL(item.preview).pathname)?.[0] ?? '.jpg');
    preview = join(folder, `${item.id.replace(/:/g, '-')}${extension}`);
    await mkdir(folder, { recursive: true });
    await writeFile(preview, await fetchBytes(item.preview, signal));
  }
  const result = { item: listed(item), ...(preview && { preview }) };
  output.result(result, () => [`${item.id}: ${item.title} (${item.author})`, `${item.license}${item.attribution ? ': name the author' : ''}${item.nonCommercial ? ', not for commercial use' : ''}`, preview ? `preview: ${preview}` : 'no preview'].join('\n'));
  return result;
}

export interface MediaAddArgs {
  /** Put it in the video: footage as a page that plays it, a photo as a still scene. */
  scene?: boolean;
  first?: boolean;
  after?: string;
  duration?: number;
  /** The page's folder in motion/ (footage with --scene). */
  name?: string;
}

/** The page that plays footage from media/ on the video's clock: filling the frame or all of it, from a second of its own, a slow push. */
function footagePage(file: string, item: StockItem): string {
  const params = [
    { name: 'fit', label: 'Fit into the frame', type: 'select', default: 'cover', options: ['cover', 'contain'] },
    { name: 'start', label: 'From (seconds into the footage)', type: 'number', default: 0, min: 0, max: 600 },
    { name: 'speed', label: 'Speed', type: 'number', default: 1, min: 0.25, max: 2 },
    { name: 'push', label: 'Slow push (how much larger by its end)', type: 'number', default: 0.05, min: 0, max: 0.3 },
  ];
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${item.title.replace(/[<>&"]/g, '')}</title>
    <!-- Stock footage: ${file} (${stockCreditLine(item).replace(/--/g, '-')}), played frame by frame on the video's clock. -->
    <script type="application/json" id="cuttle-params">
      ${JSON.stringify(params)}
    </script>
    <style>
      html,
      body {
        margin: 0;
        height: 100%;
        overflow: hidden;
      }
      canvas {
        display: block;
        width: 100%;
        height: 100%;
      }
    </style>
  </head>
  <body>
    <canvas id="footage"></canvas>
    <script type="module">
      const { params, size, duration } = cuttle;
      const clip = cuttle.video('/${file}');
      const canvas = document.getElementById('footage');
      canvas.width = size.width;
      canvas.height = size.height;
      const g = canvas.getContext('2d');
      const start = Math.max(0, Number(params.start) || 0);
      const speed = Math.min(2, Math.max(0.25, Number(params.speed) || 1));
      const push = Math.min(0.3, Math.max(0, Number(params.push ?? 0.05)));
      cuttle.onFrame(async (t) => {
        const frame = await clip.frame(start + t * speed);
        const fit = params.fit === 'contain' ? Math.min : Math.max;
        const scale = fit(size.width / frame.width, size.height / frame.height) * (1 + (push * t) / duration);
        g.clearRect(0, 0, size.width, size.height);
        g.drawImage(frame, (size.width - frame.width * scale) / 2, (size.height - frame.height * scale) / 2, frame.width * scale, frame.height * scale);
        frame.close();
      });
    </script>
  </body>
</html>
`;
}

/**
 * `cuttle media add <name>`: footage into media/ (converted as `import` converts a take), a photo into
 * media/, a sound into sounds/, each with its author and licence in the credits; with `scene`, footage
 * as a page that plays it and a photo as a still scene that moves slowly, placed as `motion add` places one.
 */
export async function mediaAddCommand(projectDir: string, name: string, args: MediaAddArgs, output: Output, signal: AbortSignal): Promise<{ file: string; credit: Credit; added?: MotionAddResult | { scene: Record<string, unknown> } }> {
  const file = await readProjectFile(projectDir);
  const dir = file.dir;
  const longSide = Math.max(file.project.output.width, file.project.output.height);
  const item = await stockItem(name, longSide, signal);
  const stem = item.id.replace(/:/g, '-');
  let path: string;
  output.info(`bringing in ${item.id} (${item.title}) …`);
  if (item.kind === 'video') {
    path = `media/${stem}.mp4`;
    const part = join(dir, 'media', `.${stem}.download`);
    await mkdir(join(dir, 'media'), { recursive: true });
    try {
      await writeFile(part, await fetchBytes(item.file, signal));
      await convertVideo(part, join(dir, path), longSide);
    } finally {
      await rm(part, { force: true });
    }
  } else if (item.kind === 'photo') {
    path = `media/${stem}${/\.(png|webp)$/i.exec(new URL(item.file).pathname)?.[0].toLowerCase() ?? (extname(new URL(item.file).pathname).toLowerCase() || '.jpg')}`;
    await mkdir(join(dir, 'media'), { recursive: true });
    await writeFile(join(dir, path), await fetchBytes(item.file, signal));
  } else {
    path = `sounds/${stem}.mp3`;
    await mkdir(join(dir, 'sounds'), { recursive: true });
    await writeFile(join(dir, path), await fetchBytes(item.file, signal));
  }
  const credit: Credit = { path, title: item.title, source: stockCreditLine(item), url: item.page, license: item.license, author: item.author };
  await addCredit(dir, credit);

  let added: MotionAddResult | { scene: Record<string, unknown> } | undefined;
  let said = '';
  if (args.scene && item.kind === 'video') {
    const folder = (args.name ?? stem).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    await mkdir(join(dir, 'motion', folder), { recursive: true });
    await writeFile(join(dir, 'motion', folder, 'index.html'), footagePage(path, item));
    const placed = { ...(args.first && { first: true }), ...(args.after !== undefined && { after: args.after }), ...(args.duration !== undefined && { duration: args.duration }) };
    const result = await addMotionPage(dir, `motion/${folder}/index.html`, placed, Math.min(item.duration ?? 5, 5));
    added = result;
    said = saidMotionAdded(result, placed);
  } else if (args.scene && item.kind === 'photo') {
    const latest = await readProjectFile(dir);
    if (args.first && args.after !== undefined) throw new CliError('usage', '--first or --after, not both');
    const raw = ((latest.raw as { scenes?: Record<string, unknown>[] }).scenes ??= []);
    let at = args.first ? 0 : raw.length;
    if (args.after !== undefined) {
      const after = sceneAt(latest.project.scenes, args.after);
      if (after < 0) throw new CliError('usage', `--after ${args.after}: no scene with that id or place`);
      at = after + 1;
    }
    const scene = { type: 'still', id: newId('scenes', usedIds(latest.project)), label: item.title.slice(0, 60), image: path, duration: args.duration ?? 4, motion: 'kenburns' };
    raw.splice(at, 0, scene);
    await writeProjectFile(latest, 'media add');
    added = { scene };
    said = `added ${path} as a ${scene.duration} s still scene (${scene.id}), moving slowly`;
  } else if (args.scene) {
    throw new CliError('usage', 'a sound is no scene: put it at a moment with cuttle sound add');
  }
  const result = { file: path, credit, ...(added && { added }) };
  output.result(result, () =>
    [
      said || `${path}: ${item.kind === 'sound' ? `cuttle sound add ${path} --at <seconds>` : item.kind === 'video' ? `a page plays it with cuttle.video('/${path}'), or media add ${item.id} --scene` : `<img src="/${path}"> in a page, or media add ${item.id} --scene`}`,
      `credits: ${credit.source}, ${credit.license}`,
    ].join('\n'),
  );
  return result;
}
