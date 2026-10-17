// The editor's document: cuttle.json as written (`raw`, so the file stays as short as it was) and
// the edits on it as commands on items by id, applied by pure functions. A result is clamped to
// valid values and checked with `parseProject`; a command whose item is gone throws, so a replay
// on a newer version of the file can drop it with a note.
import { newId, parseProject, usedIds, type CuttleProject, type IdList } from '@cuttle/project';

export type Raw = Record<string, unknown>;
export type ListName = IdList;
export type OverlayList = 'zooms' | 'masks' | 'texts';
type Item = Record<string, unknown>;

/** What a command may need to clamp to: the take's length and the screen's size. */
export interface EditLimits {
  /** Source seconds the screen track lasts (a clip ends there at the latest). */
  sourceEnd?: number;
  /** The screen track's size in pixels (zoom and mask areas stay inside it). */
  screen?: { width: number; height: number };
  /** The output's frame rate: no clip, still or overlay is shorter than a frame. */
  fps?: number;
}

export type Command =
  /** Splits a clip at a source second inside it: a continuous cut. */
  | { type: 'split'; id: string; at: number; newId?: string }
  /** A clip's source range, or a still's or card's length. */
  | { type: 'trim'; id: string; from?: number; to?: number; duration?: number }
  | { type: 'move-scene'; id: string; index: number }
  /** A clip's speed; zooms and captions entirely inside it keep their output length. */
  | { type: 'speed'; id: string; speed: number }
  /** Moves an overlay by source seconds. */
  | { type: 'shift'; list: OverlayList; id: string; by: number }
  /** Sets fields of an item (`undefined` removes a field). */
  | { type: 'set'; list: ListName; id: string; fields: Item }
  | { type: 'add'; list: ListName; item: Item; index?: number }
  | { type: 'delete'; list: ListName; id: string }
  | { type: 'duplicate'; list: ListName; id: string; newId?: string; shift?: number }
  /** Sets `look.<path…>` (`undefined` removes it). */
  | { type: 'look'; path: string[]; value: unknown }
  | { type: 'output'; width: number; height: number }
  /** Replaces every scene (Show raw take). */
  | { type: 'scenes'; scenes: Item[] };

/** A command that cannot run: its item is gone (`gone`) or the result is not a valid project (`invalid`). */
export class DocumentError extends Error {
  constructor(
    readonly code: 'gone' | 'invalid',
    message: string,
  ) {
    super(message);
    this.name = 'DocumentError';
  }
}

const MIN_RECT = 8;

const items = (raw: Raw, list: ListName): Item[] => (Array.isArray(raw[list]) ? (raw[list] as Item[]) : []);

function find(raw: Raw, list: ListName, id: string): { item: Item; index: number } {
  const index = items(raw, list).findIndex((item) => item.id === id);
  if (index < 0) throw new DocumentError('gone', `${list.slice(0, -1)} ${id} is not in the project any more`);
  return { item: items(raw, list)[index]!, index };
}

const round = (value: number) => Math.round(value * 1e6) / 1e6;
const clampNumber = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** Gives every scene and overlay without an id one (`s3`, `z1` …); returns the same object when all have one. */
export function ensureIds(raw: Raw): Raw {
  const lists = (['scenes', 'zooms', 'masks', 'texts'] as const).filter((list) => items(raw, list).some((item) => typeof item.id !== 'string'));
  if (lists.length === 0) return raw;
  const next = structuredClone(raw);
  const taken = usedIds(next);
  for (const list of lists) for (const item of items(next, list)) if (typeof item.id !== 'string') item.id = newId(list, taken);
  return next;
}

function setFields(item: Item, fields: Item): void {
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'id') continue;
    if (value === undefined) delete item[key];
    else item[key] = value;
  }
}

/** Keeps a rectangle `[x, y, w, h]` inside the screen (its corner moved in, its size cut), at least 8 px each way. */
export function clampRect(rect: readonly number[], screen: { width: number; height: number } | undefined): number[] {
  let [x = 0, y = 0, w = MIN_RECT, h = MIN_RECT] = rect;
  w = Math.max(MIN_RECT, w);
  h = Math.max(MIN_RECT, h);
  if (screen) {
    // the corner stays where it was put (inside), the size gives way
    x = clampNumber(x, 0, screen.width - MIN_RECT);
    y = clampNumber(y, 0, screen.height - MIN_RECT);
    w = Math.min(w, screen.width - x);
    h = Math.min(h, screen.height - y);
  }
  return [round(x), round(y), round(w), round(h)];
}

/** Clamps the item's times and area after an edit. */
function clampItem(list: ListName, item: Item, limits: EditLimits): void {
  const frame = 1 / (limits.fps ?? 30);
  const end = limits.sourceEnd ?? Infinity;
  if (list === 'scenes') {
    if (item.type === 'clip') {
      const speed = clampNumber(Number(item.speed ?? 1), 1 / 64, 64);
      if (item.speed !== undefined) item.speed = round(speed);
      const from = clampNumber(Number(item.from), 0, Math.max(0, end - frame * speed));
      const to = clampNumber(Number(item.to), from + frame * speed, end);
      item.from = round(from);
      item.to = round(to);
    } else item.duration = round(Math.max(frame, Number(item.duration)));
    return;
  }
  if (list === 'masks') {
    item.from = round(Math.max(0, Number(item.from)));
    item.to = round(Math.max(Number(item.from) + frame, Number(item.to)));
  } else {
    item.at = round(Math.max(0, Number(item.at)));
    item.duration = round(Math.max(frame, Number(item.duration)));
  }
  if (Array.isArray(item.rect)) item.rect = clampRect(item.rect as number[], limits.screen);
}

/** Applies one command to `raw` (left as it was) and returns the new version, checked. */
export function applyCommand(raw: Raw, command: Command, limits: EditLimits = {}): Raw {
  const next = structuredClone(raw);
  const list = (name: ListName): Item[] => {
    if (!Array.isArray(next[name])) next[name] = [];
    return next[name] as Item[];
  };
  const touched: [ListName, Item][] = [];
  switch (command.type) {
    case 'split': {
      const { item, index } = find(next, 'scenes', command.id);
      if (item.type !== 'clip') throw new DocumentError('invalid', 'only a clip can be split');
      const from = Number(item.from);
      const to = Number(item.to);
      const at = round(command.at);
      if (!(at > from && at < to)) throw new DocumentError('invalid', 'the split point lies outside the clip');
      const second: Item = { ...structuredClone(item), id: command.newId && !usedIds(next).has(command.newId) ? command.newId : newId('scenes', usedIds(next)), from: at };
      item.to = at;
      list('scenes').splice(index + 1, 0, second);
      touched.push(['scenes', item], ['scenes', second]);
      break;
    }
    case 'trim': {
      const { item } = find(next, 'scenes', command.id);
      if (item.type === 'clip') {
        if (command.from !== undefined) item.from = command.from;
        if (command.to !== undefined) item.to = command.to;
      } else if (command.duration !== undefined) item.duration = command.duration;
      touched.push(['scenes', item]);
      break;
    }
    case 'move-scene': {
      const { item, index } = find(next, 'scenes', command.id);
      const scenes = list('scenes');
      scenes.splice(index, 1);
      scenes.splice(clampNumber(Math.round(command.index), 0, scenes.length), 0, item);
      break;
    }
    case 'speed': {
      const { item } = find(next, 'scenes', command.id);
      if (item.type !== 'clip') throw new DocumentError('invalid', 'only a clip has a speed');
      const before = Number(item.speed ?? 1);
      const speed = clampNumber(command.speed, 1 / 64, 64);
      const from = Number(item.from);
      const to = Number(item.to);
      if (speed === 1 && item.speed === undefined) break;
      item.speed = round(speed);
      touched.push(['scenes', item]);
      // Zooms and captions inside the clip keep their output length: a 3 s caption stays 3 s at 12×.
      for (const name of ['zooms', 'texts'] as const) {
        for (const overlay of items(next, name)) {
          const at = Number(overlay.at);
          const duration = Number(overlay.duration);
          if (at < from || at + duration > to) continue;
          overlay.duration = round(Math.min((duration / before) * speed, to - at));
          touched.push([name, overlay]);
        }
      }
      break;
    }
    case 'shift': {
      const { item } = find(next, command.list, command.id);
      if (command.list === 'masks') {
        const by = Math.max(command.by, -Number(item.from));
        item.from = Number(item.from) + by;
        item.to = Number(item.to) + by;
      } else item.at = Math.max(0, Number(item.at) + command.by);
      touched.push([command.list, item]);
      break;
    }
    case 'set': {
      const { item } = find(next, command.list, command.id);
      setFields(item, command.fields);
      touched.push([command.list, item]);
      break;
    }
    case 'add': {
      const taken = usedIds(next);
      const wanted = typeof command.item.id === 'string' && !taken.has(command.item.id) ? command.item.id : newId(command.list, taken);
      const item = { ...structuredClone(command.item), id: wanted };
      const target = list(command.list);
      target.splice(command.index === undefined ? target.length : clampNumber(command.index, 0, target.length), 0, item);
      touched.push([command.list, item]);
      break;
    }
    case 'delete': {
      const { index } = find(next, command.list, command.id);
      list(command.list).splice(index, 1);
      break;
    }
    case 'duplicate': {
      const { item, index } = find(next, command.list, command.id);
      const taken = usedIds(next);
      const copy: Item = { ...structuredClone(item), id: command.newId && !taken.has(command.newId) ? command.newId : newId(command.list, taken) };
      if (command.shift) {
        if (command.list === 'masks') {
          copy.from = Number(copy.from) + command.shift;
          copy.to = Number(copy.to) + command.shift;
        } else if (command.list !== 'scenes') copy.at = Number(copy.at) + command.shift;
      }
      list(command.list).splice(index + 1, 0, copy);
      touched.push([command.list, copy]);
      break;
    }
    case 'look': {
      if (command.path.length === 0) throw new DocumentError('invalid', 'a look path is empty');
      const look = (next.look && typeof next.look === 'object' ? next.look : (next.look = {})) as Item;
      let parent = look;
      for (const key of command.path.slice(0, -1)) {
        if (!parent[key] || typeof parent[key] !== 'object') parent[key] = {};
        parent = parent[key] as Item;
      }
      const last = command.path.at(-1)!;
      if (command.value === undefined) delete parent[last];
      else parent[last] = structuredClone(command.value);
      break;
    }
    case 'output': {
      const output = (next.output && typeof next.output === 'object' ? next.output : (next.output = {})) as Item;
      output.width = command.width;
      output.height = command.height;
      break;
    }
    case 'scenes': {
      next.scenes = structuredClone(command.scenes);
      const ids = ensureIds(next);
      next.scenes = ids.scenes;
      break;
    }
  }
  for (const [name, item] of touched) clampItem(name, item, limits);
  const parsed = parseProject(next);
  if (!parsed.ok) throw new DocumentError('invalid', parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'));
  return next;
}

/** Applies commands in order; the ones whose item is gone are left out and named. */
export function replayCommands(raw: Raw, commands: readonly Command[], limits: EditLimits = {}): { raw: Raw; dropped: string[] } {
  let current = raw;
  const dropped: string[] = [];
  for (const command of commands) {
    try {
      current = applyCommand(current, command, limits);
    } catch (error) {
      if (!(error instanceof DocumentError)) throw error;
      dropped.push(error.message);
    }
  }
  return { raw: current, dropped };
}

const NOUNS: Record<ListName, [string, string]> = { scenes: ['scene', 'scenes'], zooms: ['zoom', 'zooms'], masks: ['mask', 'masks'], texts: ['caption', 'captions'] };
const noun = (list: ListName, count: number) => `${count} ${NOUNS[list][count === 1 ? 0 : 1]}`;

/**
 * What changed between two versions of a project, for people: "2 masks added · 1 scene changed",
 * "the look changed". Items are matched by id (by position when they have none).
 */
export function describeChange(before: CuttleProject, after: CuttleProject): string {
  return changeParts(before, after).join(' · ') || 'no visible change';
}

/** The first item added or changed between two versions (scenes, then zooms, masks, captions), to show it. */
export function firstChanged(before: CuttleProject, after: CuttleProject): { list: ListName; id: string } | undefined {
  for (const list of ['scenes', 'zooms', 'masks', 'texts'] as const) {
    const old = new Map(before[list].map((item) => [item.id, JSON.stringify(item)]));
    const found = after[list].find((item) => item.id !== undefined && old.get(item.id) !== JSON.stringify(item));
    if (found?.id) return { list, id: found.id };
  }
  return undefined;
}

function changeParts(before: CuttleProject, after: CuttleProject): string[] {
  const parts: string[] = [];
  for (const list of ['scenes', 'zooms', 'masks', 'texts'] as const) {
    const key = (item: { id?: string }, index: number) => item.id ?? `#${index}`;
    const old = new Map(before[list].map((item, index) => [key(item, index), JSON.stringify(item)]));
    const now = new Map(after[list].map((item, index) => [key(item, index), JSON.stringify(item)]));
    const added = [...now.keys()].filter((id) => !old.has(id)).length;
    const removed = [...old.keys()].filter((id) => !now.has(id)).length;
    const changed = [...now].filter(([id, text]) => old.has(id) && old.get(id) !== text).length;
    if (added) parts.push(`${noun(list, added)} added`);
    if (removed) parts.push(`${noun(list, removed)} removed`);
    if (changed) parts.push(`${noun(list, changed)} changed`);
  }
  if (JSON.stringify(before.look) !== JSON.stringify(after.look)) parts.push('the look changed');
  if (JSON.stringify(before.output) !== JSON.stringify(after.output)) parts.push('the output size changed');
  if (JSON.stringify(before.sources) !== JSON.stringify(after.sources)) parts.push('another take');
  return parts;
}
