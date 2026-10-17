// The privacy masks: each private thing the screen showed, masked from just before it was first seen
// to just after it was last seen, following it where it moved (text that scrolls). Pure.
import type { Rect, ScreenTextFrame, ZoomMove } from '@cuttle/project';
import { SECRET_LABELS, lineSecrets, type SecretKind } from './patterns';

export const MASK_RULES = {
  /** A mask starts this long before the first sight and ends this long after the last (source s). */
  margin: 0.5,
  /** Room around the text (px). */
  pad: 6,
  /** A secret moved when an edge of its rect moved more than this (px)… */
  moved: 4,
  /**
   * …unless the rect still overlaps where it was this much (intersection over union): that is the
   * OCR's box around still text drawn a little larger or smaller (Vision's do), and the mask grows
   * to hold both. Text that scrolls has moved on further between two frames read.
   */
  jitter: 0.6,
  /**
   * It was gone when this many frames read in a row lacked it, over at least `gone` seconds: the
   * OCR misses a line now and then (a token that scrolls was read in one frame of four).
   */
  missing: 2,
  gone: 2.5,
};

export interface PrivacyMask {
  from: number;
  to: number;
  rect: Rect;
  moves?: ZoomMove[];
  kind: SecretKind;
  label: string;
}

interface Sighting {
  t: number;
  rect: Rect;
}

/** The rect that holds both. */
const union = (a: Rect, b: Rect): Rect => {
  const left = Math.min(a[0], b[0]);
  const top = Math.min(a[1], b[1]);
  return [left, top, Math.max(a[0] + a[2], b[0] + b[2]) - left, Math.max(a[1] + a[3], b[1] + b[3]) - top];
};

const overlap = (a: Rect, b: Rect) => {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  const inter = w > 0 && h > 0 ? w * h : 0;
  return inter / (a[2] * a[3] + b[2] * b[3] - inter);
};

/**
 * The masks for what the frames read show of private things (`lineSecrets`), and of the person's
 * `words`. A secret is the same in the next frame when its text reads the same, or it is of the same
 * kind where it was; it moved when its rect did. `end`: the take's length (source seconds), where a
 * mask ends that no later frame showed gone.
 */
export function privacyMasks(frames: readonly ScreenTextFrame[], words: readonly string[], screen: { width: number; height: number }, end = Infinity, rules = MASK_RULES): PrivacyMask[] {
  type Group = { kind: SecretKind; key: string; sightings: Sighting[]; missed: number };
  const open: Group[] = [];
  const closed: Group[] = [];
  for (const frame of [...frames].sort((a, b) => a.t - b.t)) {
    const seen = new Set<Group>();
    const secrets = frame.lines.flatMap((line) => lineSecrets(line, words));
    for (const secret of secrets) {
      const group =
        open.find((candidate) => !seen.has(candidate) && candidate.key === secret.key) ??
        open.find((candidate) => !seen.has(candidate) && candidate.kind === secret.kind && overlap(candidate.sightings.at(-1)!.rect, secret.rect) >= 0.5);
      if (group) {
        if (group.sightings.at(-1)!.t !== frame.t) group.sightings.push({ t: frame.t, rect: secret.rect });
        group.missed = 0;
        seen.add(group);
        continue;
      }
      const fresh: Group = { kind: secret.kind, key: secret.key, sightings: [{ t: frame.t, rect: secret.rect }], missed: 0 };
      open.push(fresh);
      seen.add(fresh);
    }
    for (const group of [...open]) {
      if (seen.has(group) || ++group.missed < rules.missing || frame.t - group.sightings.at(-1)!.t < rules.gone) continue;
      open.splice(open.indexOf(group), 1);
      closed.push(group);
    }
  }
  // Frames are read where the picture changes: a secret stays on screen until a frame read shows it
  // gone, so a mask lasts until then (to the take's end when none does).
  const times = frames.map((frame) => frame.t).sort((a, b) => a - b);
  const until = (last: number) => {
    const next = times.find((t) => t > last) ?? (Number.isFinite(end) ? end : last);
    return Math.max(last + rules.margin, next);
  };
  const pad = (rect: Rect): Rect => {
    const left = Math.max(0, rect[0] - rules.pad);
    const top = Math.max(0, rect[1] - rules.pad);
    return [Math.round(left), Math.round(top), Math.round(Math.min(screen.width, rect[0] + rect[2] + rules.pad) - left), Math.round(Math.min(screen.height, rect[1] + rect[3] + rules.pad) - top)];
  };
  const moved = (a: Rect, b: Rect) => a.some((value, k) => Math.abs(value - b[k]!) > rules.moved);
  const masks = [...closed, ...open]
    .map((group): PrivacyMask => {
      const [first, ...rest] = group.sightings as [Sighting, ...Sighting[]];
      const from = round(Math.max(0, first.t - rules.margin));
      const moves: { at: number; rect: Rect }[] = [];
      // where the mask is now (its rect, or its last move's), unpadded: a jittering box grows it
      let base = first.rect;
      let shown = first.rect;
      let previous = first;
      for (const sighting of rest) {
        if (moved(previous.rect, sighting.rect) && overlap(previous.rect, sighting.rect) >= rules.jitter) {
          shown = union(shown, sighting.rect);
          if (moves.length > 0) moves.at(-1)!.rect = shown;
          else base = shown;
        } else if (moved(previous.rect, sighting.rect)) {
          // where it was last seen before it moved, then where it went: between the two it covers both
          if (moves.at(-1)?.at !== previous.t && previous !== first) moves.push({ at: round(previous.t), rect: previous.rect });
          moves.push({ at: round(sighting.t), rect: sighting.rect });
          shown = sighting.rect;
        }
        previous = sighting;
      }
      const path: ZoomMove[] = moves.map((move) => ({ at: move.at, rect: pad(move.rect) }));
      return { from, to: round(until(previous.t)), rect: pad(base), ...(path.length > 0 && { moves: path }), kind: group.kind, label: SECRET_LABELS[group.kind] };
    })
    .sort((a, b) => a.from - b.from);
  return joinCovering(masks);
}

/** Which kind names a mask that two rules found: the more specific. */
const SPECIFIC: readonly SecretKind[] = ['key', 'token', 'iban', 'card', 'email', 'phone', 'word', 'value'];

/**
 * Masks over the same text, found by two rules (a key in a `NAME=value` line), are one: those that
 * overlap in time and, place by place (their rect, then each move at the same time), one covers
 * most of the other.
 */
function joinCovering(masks: PrivacyMask[]): PrivacyMask[] {
  const covered = (a: Rect, b: Rect) => {
    const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
    const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
    return w > 0 && h > 0 ? (w * h) / Math.min(a[2] * a[3], b[2] * b[3]) : 0;
  };
  const both = (a: Rect, b: Rect): Rect => {
    const left = Math.min(a[0], b[0]);
    const top = Math.min(a[1], b[1]);
    return [left, top, Math.max(a[0] + a[2], b[0] + b[2]) - left, Math.max(a[1] + a[3], b[1] + b[3]) - top];
  };
  const samePath = (a: PrivacyMask, b: PrivacyMask) => {
    const [first, second] = [a.moves ?? [], b.moves ?? []];
    return covered(a.rect, b.rect) >= 0.8 && first.length === second.length && first.every((move, k) => move.at === second[k]!.at && covered(move.rect, second[k]!.rect) >= 0.8);
  };
  const joined: PrivacyMask[] = [];
  for (const mask of masks) {
    const other = joined.find((one) => one.from < mask.to && mask.from < one.to && samePath(one, mask));
    if (!other) {
      joined.push({ ...mask });
      continue;
    }
    other.rect = both(other.rect, mask.rect);
    if (other.moves) other.moves = other.moves.map((move, k) => ({ at: move.at, rect: both(move.rect, mask.moves![k]!.rect) }));
    other.from = Math.min(other.from, mask.from);
    other.to = Math.max(other.to, mask.to);
    if (SPECIFIC.indexOf(mask.kind) < SPECIFIC.indexOf(other.kind)) {
      other.kind = mask.kind;
      other.label = mask.label;
    }
  }
  return joined;
}

const round = (value: number) => Math.round(value * 1000) / 1000;
