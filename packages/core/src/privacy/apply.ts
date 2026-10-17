// The privacy masks applied to a project: made from the screen's text (screen-text.jsonl) and the
// person's words, merged with the masks there by the tag rules: Cuttle's privacy masks are made
// again, one the person switched off stays off, every other mask stays.
import { readFile } from 'node:fs/promises';
import { newId, parseScreenTextJsonl, usedIds, type CuttleProject, type Rect, type ScreenTextFrame } from '@cuttle/project';
import { privacyMasks, type PrivacyMask } from './masks';
import type { SecretKind } from './patterns';

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
};

export interface PrivacyMasksResult {
  masks: RawMask[];
  /** How many masks Cuttle made, and of which kinds. */
  made: number;
  kinds: Partial<Record<SecretKind, number>>;
  notes: string[];
}

const alike = (a: Rect, b: Rect) => {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  const inter = w > 0 && h > 0 ? w * h : 0;
  return inter / (a[2] * a[3] + b[2] * b[3] - inter) >= 0.5;
};

/**
 * The project's masks with the privacy masks of `frames` (the person's `words` masked too): those
 * of Cuttle's earlier run (`auto: "privacy"`) are made again; a new one that takes the place of one
 * switched off (half its time, its rect half alike) stays off; every other mask stays.
 */
export function withPrivacyMasks(
  raw: Record<string, unknown>,
  project: CuttleProject,
  frames: readonly ScreenTextFrame[],
  screen: { width: number; height: number; duration?: number },
  words: readonly string[] = project.privacy.words,
  taken = usedIds(raw),
): PrivacyMasksResult {
  const old = (raw.masks as RawMask[] | undefined) ?? [];
  const off = old.filter((mask) => mask.auto === 'privacy' && mask.enabled === false);
  const staysOff = (mask: PrivacyMask) =>
    off.some((other) => {
      const shared = Math.min(other.to, mask.to) - Math.max(other.from, mask.from);
      return shared >= 0.5 * Math.min(other.to - other.from, mask.to - mask.from) && alike(other.rect, mask.rect);
    });
  const made = privacyMasks(frames, words, screen, screen.duration);
  const fresh: RawMask[] = made.map((mask) => ({
    id: newId('masks', taken),
    label: mask.label,
    from: mask.from,
    to: mask.to,
    rect: mask.rect,
    ...(mask.moves && { moves: mask.moves }),
    style: 'fill',
    ...(staysOff(mask) && { enabled: false }),
    auto: 'privacy',
  }));
  const kept = old.filter((mask) => mask.auto !== 'privacy');
  const kinds: Partial<Record<SecretKind, number>> = {};
  for (const mask of made) kinds[mask.kind] = (kinds[mask.kind] ?? 0) + 1;
  const notes: string[] = [];
  if (made.length > 0) {
    const list = Object.entries(kinds).map(([kind, count]) => `${count} ${NAMES[kind as SecretKind][count === 1 ? 0 : 1]}`);
    const stayOff = fresh.filter((mask) => mask.enabled === false).length;
    notes.push(`masked ${made.length} private thing${made.length === 1 ? '' : 's'} the screen showed: ${list.join(', ')}${stayOff > 0 ? `; ${stayOff} stay off, as before` : ''}`);
  } else notes.push(`nothing private found in the screen's text (${frames.length} frame${frames.length === 1 ? '' : 's'} read)`);
  return { masks: [...kept, ...fresh].sort((a, b) => a.from - b.from), made: made.length, kinds, notes };
}
