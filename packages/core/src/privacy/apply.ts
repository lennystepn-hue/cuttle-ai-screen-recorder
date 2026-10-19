// The privacy masks applied to a project: made from the screen's text (screen-text.jsonl), the
// person's words and the notifications the recorder saw, merged with the masks there by the tag
// rules: Cuttle's privacy and notification masks are made again, one the person switched off stays
// off, every other mask stays. The app runs this as steps of its own after the cut.
import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { newId, parseEventsJsonl, parseScreenTextJsonl, usedIds, type CuttleProject, type InputEvent, type Rect, type ScreenTextFrame } from '@cuttle/project';
import { CoreError } from '../errors';
import { readProjectFile, writeProjectFile } from '../project-file';
import { probeScreen } from '../suggest/media';
import { union } from '../suggest/spans';
import { privacyMasks, type PrivacyMask } from './masks';
import { notificationMasks } from './notifications';
import type { SecretKind } from './patterns';
import { SCREEN_TEXT_FILE, framesToRead, keepRedacted, readFrames, writeScreenText } from './read';

/** A mask as written to cuttle.json. */
export type RawMask = Record<string, unknown> & { from: number; to: number; rect: Rect; auto?: string; enabled?: boolean; label?: string };

/** The frames of a screen-text.jsonl; none when it cannot be read. */
export async function readScreenText(path: string): Promise<ScreenTextFrame[] | undefined> {
  const text = await readFile(path, 'utf8').catch(() => undefined);
  return text === undefined ? undefined : parseScreenTextJsonl(text).frames;
}

/** How many of each kind, for people: "2 email addresses, 1 key". */
const NAMES: Record<SecretKind, [string, string]> = {
  email: ['email address', 'email addresses'],
  key: ['key', 'keys'],
  token: ['token in a link', 'tokens in links'],
  value: ['secret value', 'secret values'],
  iban: ['IBAN', 'IBANs'],
  card: ['card number', 'card numbers'],
  phone: ['phone number', 'phone numbers'],
  word: ['word you always mask', 'words you always mask'],
  random: ['random-looking string', 'random-looking strings'],
};

export interface PrivacyInput {
  /** The screen's text: without it, the privacy masks there stay as they are. */
  frames?: readonly ScreenTextFrame[];
  /** The take's events (its notification windows): without them, the notification masks stay. */
  events?: readonly InputEvent[];
  /** The screen's size, and the take's length (where a mask ends that nothing showed gone). */
  screen: { width: number; height: number; duration?: number };
  /** The words to mask (default the project's `privacy.words`). */
  words?: readonly string[];
}

export interface PrivacyMasksResult {
  masks: RawMask[];
  /** How many privacy masks Cuttle made, and of which kinds; how many notification masks. */
  made: number;
  kinds: Partial<Record<SecretKind, number>>;
  notifications: number;
  notes: string[];
}

const alike = (a: Rect, b: Rect) => {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  const inter = w > 0 && h > 0 ? w * h : 0;
  return inter / (a[2] * a[3] + b[2] * b[3] - inter) >= 0.5;
};

/**
 * The project's masks with the privacy masks of `frames` (the words masked too) and the
 * notification masks of `events`. Cuttle's masks of a kind made here (`auto: "privacy"`,
 * `"notification"`) are made again; a new one that takes the place of one switched off (half its
 * time, its rect half alike) stays off; every other mask stays.
 */
export function withPrivacyMasks(raw: Record<string, unknown>, project: CuttleProject, input: PrivacyInput, taken = usedIds(raw)): PrivacyMasksResult {
  const old = (raw.masks as RawMask[] | undefined) ?? [];
  const { screen } = input;
  const staysOff = (auto: string, mask: { from: number; to: number; rect: Rect }) =>
    old.some((other) => {
      if (other.auto !== auto || other.enabled !== false) return false;
      const shared = Math.min(other.to, mask.to) - Math.max(other.from, mask.from);
      return shared >= 0.5 * Math.min(other.to - other.from, mask.to - mask.from) && alike(other.rect, mask.rect);
    });
  // A mask made the same as before keeps its id: a run that finds nothing new changes nothing.
  const reused = new Set<unknown>();
  const idFor = (auto: string, mask: { from: number; to: number; rect: Rect }) => {
    const same = old.find((other) => other.auto === auto && typeof other.id === 'string' && !reused.has(other.id) && other.from === mask.from && other.to === mask.to && other.rect.every((value, i) => value === mask.rect[i]));
    if (!same) return newId('masks', taken);
    reused.add(same.id);
    return same.id as string;
  };
  const made: PrivacyMask[] = input.frames ? privacyMasks(input.frames, input.words ?? project.privacy.words, screen, screen.duration) : [];
  const shown = input.events ? notificationMasks(input.events, screen, screen.duration) : [];
  const fresh: RawMask[] = [
    ...made.map((mask) => ({
      id: idFor('privacy', mask),
      label: mask.label,
      from: mask.from,
      to: mask.to,
      rect: mask.rect,
      ...(mask.moves && { moves: mask.moves }),
      style: 'fill',
      ...(staysOff('privacy', mask) && { enabled: false }),
      auto: 'privacy',
    })),
    ...shown.map((mask) => ({ id: idFor('notification', mask), label: 'Notification', from: mask.from, to: mask.to, rect: mask.rect, style: 'fill', ...(staysOff('notification', mask) && { enabled: false }), auto: 'notification' })),
  ];
  const replaced = new Set([...(input.frames ? ['privacy'] : []), ...(input.events ? ['notification'] : [])]);
  const kept = old.filter((mask) => mask.auto === undefined || !replaced.has(mask.auto));
  const kinds: Partial<Record<SecretKind, number>> = {};
  for (const mask of made) kinds[mask.kind] = (kinds[mask.kind] ?? 0) + 1;
  const notes: string[] = [];
  const stayOff = fresh.filter((mask) => mask.enabled === false).length;
  if (input.frames && made.length > 0) {
    const list = Object.entries(kinds).map(([kind, count]) => `${count} ${NAMES[kind as SecretKind][count === 1 ? 0 : 1]}`);
    notes.push(`masked ${made.length} private thing${made.length === 1 ? '' : 's'} the screen showed: ${list.join(', ')}`);
  } else if (input.frames) notes.push(`nothing private found in the screen's text (${input.frames.length} frame${input.frames.length === 1 ? '' : 's'} read)`);
  if (shown.length > 0) notes.push(`masked ${shown.length} notification${shown.length === 1 ? '' : 's'} while ${shown.length === 1 ? 'it was' : 'they were'} open`);
  if (stayOff > 0) notes.push(`${stayOff} mask${stayOff === 1 ? '' : 's'} you switched off stay${stayOff === 1 ? 's' : ''} off`);
  return { masks: [...kept, ...fresh].sort((a, b) => a.from - b.from), made: made.length, kinds, notifications: shown.length, notes };
}

/** The source stretches the project's clips show. */
const clipSpans = (project: CuttleProject) => union(project.scenes.flatMap((scene) => (scene.type === 'clip' ? [{ from: scene.from, to: scene.to }] : [])));

/**
 * Reads the screen's text inside the project's clips (`dir`: its folder) into its take's
 * screen-text.jsonl, not linked yet (`applyPrivacy` links it with the masks, in one write).
 * `onPreparing`: macOS takes long to prepare its text recognition (`readFrames`).
 */
export async function readScreenTake(dir: string, options: { onProgress?: (fraction: number) => void; onPreparing?: () => void; signal?: AbortSignal } = {}): Promise<{ path: string; frames: number; language: string }> {
  const file = await readProjectFile(dir);
  const screen = resolve(file.dir, file.project.sources.screen);
  const size = await probeScreen(screen);
  const times = await framesToRead(screen, clipSpans(file.project), size);
  const { frames, language } = await readFrames(screen, times, size, options);
  const path = join(dirname(screen), SCREEN_TEXT_FILE);
  writeScreenText(path, frames, file.project.privacy.words);
  return { path: relative(file.dir, path).split(sep).join('/'), frames: frames.length, language };
}

export interface PrivacyResult extends Omit<PrivacyMasksResult, 'masks'> {
  /** Whether cuttle.json was written (nothing changed: not written). */
  written: boolean;
}

/**
 * The privacy and notification masks of a project (`dir`: its folder), from the screen's text
 * (`link`, read by `readScreenTake`, linked as `sources.screenText` in the same write; else the one
 * linked) and the take's notifications. `words` are added to `privacy.words` (the app's "Always
 * mask"). Written only when something changed.
 */
export async function applyPrivacy(dir: string, options: { link?: string; words?: readonly string[] } = {}): Promise<PrivacyResult> {
  const file = await readProjectFile(dir);
  const { sources } = file.project;
  const linked = options.link ?? sources.screenText;
  const read = linked ? await readScreenText(resolve(file.dir, linked)) : undefined;
  if (options.link && !read) throw new CoreError('missing-file', `${options.link} cannot be read`);
  const text = sources.events ? await readFile(resolve(file.dir, sources.events), 'utf8').catch(() => undefined) : undefined;
  const events = text === undefined ? undefined : parseEventsJsonl(text).events;
  const size = await probeScreen(resolve(file.dir, sources.screen));
  const words = [...new Set([...file.project.privacy.words, ...(options.words ?? []).map((word) => word.trim()).filter(Boolean)])];
  // the file as it is kept: what an older version, or a word added since, left readable is marked now
  const frames = read && linked ? keepRedacted(resolve(file.dir, linked), read, words) : undefined;
  const result = withPrivacyMasks(file.raw, file.project, { ...(frames && { frames }), ...(events && { events }), screen: size, words });
  const { masks: _masks, ...counts } = result;
  const linking = options.link !== undefined && options.link !== sources.screenText;
  const wordsAdded = words.length > file.project.privacy.words.length;
  const before = JSON.stringify((file.raw.masks as unknown[] | undefined) ?? []);
  if (!linking && !wordsAdded && JSON.stringify(result.masks) === before) return { ...counts, written: false };
  file.raw.masks = result.masks;
  if (linking) file.raw.sources = { ...(file.raw.sources as object), screenText: options.link };
  if (wordsAdded) file.raw.privacy = { ...(file.raw.privacy as object), words };
  await writeProjectFile(file, 'the privacy masks');
  return { ...counts, written: true };
}
