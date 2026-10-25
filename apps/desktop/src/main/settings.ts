import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from 'electron';
import { z } from 'zod';
import { HUD_PLACES, MOTIONS, PILL_PLACES, PRIVACY_WORD_MAX, PRIVACY_WORDS_MAX, SPEECH_LANGUAGES, SPEECH_MODEL_NAMES, type Motion, type SettingsView } from '../shared/ipc';

const RECENT_MAX = 10;

const SettingsSchema = z.object({
  recent: z.array(z.object({ dir: z.string(), name: z.string(), opened: z.number() })).catch([]).default([]),
  /** Where Cuttle waits: the pill on screen (where it was left), the drawer at the top centre, or only the menu bar. */
  pillPlace: z.enum(PILL_PLACES).catch('screen').default('screen'),
  /** Where the HUD is during a take: on screen by the recorded area, or at the top edge, collapsed into an island. */
  hudPlace: z.enum(HUD_PLACES).catch('screen').default('screen'),
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
  /** The first run was seen to its end (ffmpeg, the cuttle command and the skill). */
  welcomed: z.boolean().catch(false).default(false),
  /** Start with the computer (the OS's login item). */
  launchAtLogin: z.boolean().catch(false).default(false),
  /** Motion in the app's windows: the OS's "reduce motion" (system), or always reduced, or always full. */
  motion: z.enum(MOTIONS).catch('system').default('system'),
  /**
   * Transcribing a take after its cut: the speech model (`small` until the person picks), and the
   * language spoken. `live`: the HUD shows what the mic hears while a take records (off until switched on).
   */
  speech: z
    .object({
      model: z.enum(['off', ...SPEECH_MODEL_NAMES]).catch('small').default('small'),
      language: z.enum(SPEECH_LANGUAGES).catch('auto').default('auto'),
      live: z.boolean().catch(false).default(false),
    })
    .catch({ model: 'small' as const, language: 'auto' as const, live: false })
    .default({ model: 'small' as const, language: 'auto' as const, live: false }),
  /** The privacy step after a take's cut: read the screen's text (Windows' OCR, macOS's Vision) to mask what it showed, and the words always masked. */
  privacy: z
    .object({
      read: z.boolean().catch(true).default(true),
      words: z.array(z.string().trim().min(1).max(PRIVACY_WORD_MAX)).max(PRIVACY_WORDS_MAX).catch([]).default([]),
    })
    .catch({ read: true, words: [] })
    .default({ read: true, words: [] }),
  /** Check for a new version once a day and download it (updates.ts). */
  updates: z.boolean().catch(true).default(true),
  /**
   * The narration's voices: ElevenLabs' API key, encrypted with the system's keychain (Electron's
   * safeStorage: the Keychain on macOS, DPAPI on Windows), as base64; never in a project.
   */
  voice: z.object({ elevenLabsKey: z.string().optional() }).catch({}).default({}),
  /**
   * Screenshots: the folder each shot gets a folder of its own in; quick (framed in the last look,
   * copied, a toast to edit it) or straight into the screenshot editor; the last shot's look (its
   * shot.json without its image, scale and crop), which the next one takes; the picker's timer.
   */
  shots: z
    .object({
      folder: z
        .string()
        .min(1)
        .catch(() => join(app.getPath('pictures'), 'Cuttle'))
        .default(() => join(app.getPath('pictures'), 'Cuttle')),
      quick: z.boolean().catch(true).default(true),
      look: z.record(z.string(), z.unknown()).optional().catch(undefined),
      delay: z.union([z.literal(0), z.literal(3), z.literal(5), z.literal(10)]).catch(0).default(0),
    })
    .catch(() => ({ folder: join(app.getPath('pictures'), 'Cuttle'), quick: true, delay: 0 as const }))
    .default(() => ({ folder: join(app.getPath('pictures'), 'Cuttle'), quick: true, delay: 0 as const })),
  /** The picker bar's choices, kept between recordings (the camera and mic are the defaults in the settings). */
  record: z
    .object({
      camera: z.string().optional(),
      mic: z.string().optional(),
      systemAudio: z.boolean().optional(),
      stop: z.enum(['none', 'claude', 'idle']).default('none'),
      claudeFolder: z.string().optional(),
    })
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

/**
 * Replaces `to` with `from`. Windows refuses a rename over a file another program has open for a
 * moment (a reader, a scanner, OneDrive): it is tried again for about a second.
 */
async function replace(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await rename(from, to);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 12 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * attempt));
    }
  }
}
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
    await replace(`${file()}.part`, file());
  }).catch(() => {});
  await writing;
  for (const listener of listeners) listener(settings);
  return settings;
}

/**
 * The app's version: the packaged app's, else apps/desktop/package.json's (run from the repository,
 * Electron reports its own version).
 */
export function appVersion(): string {
  if (app.isPackaged) return app.getVersion();
  try {
    return (JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')) as { version: string }).version;
  } catch {
    return app.getVersion();
  }
}

/** How motion is set, once the settings were loaded (the windows get it when they are made). */
export const motionSetting = (): Motion => cached?.motion ?? 'system';

/** The settings as the settings window shows them. */
export async function settingsView(): Promise<SettingsView> {
  const settings = await loadSettings();
  return {
    projectsFolder: settings.projectsFolder,
    countdown: settings.countdown,
    ...(settings.record.camera !== undefined && { camera: settings.record.camera }),
    ...(settings.record.mic !== undefined && { mic: settings.record.mic }),
    launchAtLogin: settings.launchAtLogin,
    motion: settings.motion,
    pillPlace: settings.pillPlace,
    hudPlace: settings.hudPlace,
    speech: { ...settings.speech },
    privacy: { read: settings.privacy.read, words: [...settings.privacy.words] },
    recent: settings.recent,
    version: appVersion(),
    updates: settings.updates,
    shots: { folder: settings.shots.folder, quick: settings.shots.quick },
  };
}

/** The same folder, as Windows compares paths (case) and wherever it is written (separators, a trailing one). */
export const sameDir = (a: string, b: string) => {
  const key = (dir: string) => dir.replace(/[\\/]+$/, '').replace(/\\/g, '/');
  return process.platform === 'win32' ? key(a).toLowerCase() === key(b).toLowerCase() : key(a) === key(b);
};

/** Puts a project at the top of the recent list. */
export function addRecent(dir: string): Promise<Settings> {
  return updateSettings((settings) => {
    settings.recent = [{ dir, name: basename(dir), opened: Date.now() }, ...settings.recent.filter((entry) => !sameDir(entry.dir, dir))].slice(0, RECENT_MAX);
  });
}
