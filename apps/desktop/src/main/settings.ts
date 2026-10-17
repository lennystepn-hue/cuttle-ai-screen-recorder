import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { app } from 'electron';
import { z } from 'zod';

const RECENT_MAX = 10;

const SettingsSchema = z.object({
  recent: z.array(z.object({ dir: z.string(), name: z.string(), opened: z.number() })).catch([]).default([]),
  /** Where the pill sits, per display (DIP), keyed by the display's id. */
  pill: z.record(z.string(), z.object({ x: z.number(), y: z.number() })).catch({}).default({}),
  /** New recordings go into a new folder here. */
  projectsFolder: z
    .string()
    .min(1)
    .catch(() => join(app.getPath('home'), 'Cuttle'))
    .default(() => join(app.getPath('home'), 'Cuttle')),
  /** Seconds of countdown before a recording starts. */
  countdown: z.union([z.literal(0), z.literal(3), z.literal(5)]).catch(3).default(3),
  /** Projects whose take was written while the app quit: cut by suggest when they open next. */
  uncut: z.array(z.string()).catch([]).default([]),
  /** The picker bar's choices, kept between recordings. */
  record: z
    .object({ camera: z.string().optional(), mic: z.string().optional(), stop: z.enum(['none', 'claude', 'idle']).default('none'), claudeFolder: z.string().optional() })
    .catch({ stop: 'none' as const })
    .default({ stop: 'none' as const }),
});

export type Settings = z.output<typeof SettingsSchema>;

const file = () => join(app.getPath('userData'), 'settings.json');

let cached: Settings | undefined;

/** The settings in the user's app data folder; defaults for a missing or broken file. */
export async function loadSettings(): Promise<Settings> {
  if (cached) return cached;
  let raw: unknown = {};
  try {
    raw = JSON.parse(await readFile(file(), 'utf8'));
  } catch {
    raw = {};
  }
  const parsed = SettingsSchema.safeParse(raw);
  cached = parsed.success ? parsed.data : SettingsSchema.parse({});
  return cached;
}

let writing = Promise.resolve();
const listeners = new Set<(settings: Settings) => void>();

/** Calls `listener` after every change of the settings. */
export function onSettingsChange(listener: (settings: Settings) => void): void {
  listeners.add(listener);
}

/** Changes the settings and writes them (one write at a time, temp file and rename). */
export async function updateSettings(change: (settings: Settings) => void): Promise<Settings> {
  const settings = await loadSettings();
  change(settings);
  const text = `${JSON.stringify(settings, null, 2)}\n`;
  writing = writing.then(async () => {
    await mkdir(dirname(file()), { recursive: true });
    await writeFile(`${file()}.part`, text);
    await rename(`${file()}.part`, file());
  }).catch(() => {});
  await writing;
  for (const listener of listeners) listener(settings);
  return settings;
}

/** Puts a project at the top of the recent list. */
export function addRecent(dir: string): Promise<Settings> {
  return updateSettings((settings) => {
    const key = process.platform === 'win32' ? dir.toLowerCase() : dir;
    settings.recent = [
      { dir, name: basename(dir), opened: Date.now() },
      ...settings.recent.filter((entry) => (process.platform === 'win32' ? entry.dir.toLowerCase() : entry.dir) !== key),
    ].slice(0, RECENT_MAX);
  });
}
