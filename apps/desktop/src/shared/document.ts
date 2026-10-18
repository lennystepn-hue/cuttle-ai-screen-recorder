// The editor's document: cuttle.json as written (`raw`, so the file stays as short as it was) and
// the edits on it as commands on items by id, applied by pure functions. A result is clamped to
// valid values and checked with `parseProject`; a command whose item is gone throws, so a replay
// on a newer version of the file can drop it with a note.
import { newId, parseProject, usedIds, type AutoEdits, type CuttleProject, type IdList } from '@cuttle/project';
import { takeKey } from './take';

export type Raw = Record<string, unknown>;
export type ListName = IdList;
export type OverlayList = 'zooms' | 'masks' | 'texts' | 'overlays' | 'sounds';
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
  /** Switches a kind of automatic edit on or off (`autoEdits`). */
  | { type: 'auto-edits'; kind: keyof AutoEdits; value: boolean }
  /** Sets a field of the captions (the subtitles from the transcript). */
  | { type: 'captions'; field: 'enabled' | 'style' | 'position' | 'size' | 'color'; value: unknown }
  /** The words spoken in [at, end) read as `text` ("" for none); `undefined` takes the fixes there away. */
  | { type: 'caption-fix'; at: number; end: number; text: string | undefined }
  /** Replaces every scene (Show raw take). */
  | { type: 'scenes'; scenes: Item[] }
  /** Sets fields of the music (`undefined` removes a field); `null` removes the music. */
  | { type: 'music'; fields: Item | null }
  /** Sets fields of the theme, the project's brand (`undefined` removes a field); `replace`: `fields` are the whole theme (a brand kit applied). */
  | { type: 'theme'; fields: Item; replace?: boolean };

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

/** Gives every scene, overlay and cut without an id one (`s3`, `z1` …); returns the same object when all have one. */
export function ensureIds(raw: Raw): Raw {
  const lists = (['scenes', 'zooms', 'masks', 'texts', 'overlays', 'cuts', 'sounds'] as const).filter((list) => items(raw, list).some((item) => typeof item.id !== 'string'));
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

/**
 * Hand edits win: an automatic item (`auto`) changed by hand in anything but being on or off is
 * the person's now, and a rerun of the automatic edits leaves it alone.
 */
function claim(item: Item, fields?: Item): void {
  if (fields && (Object.keys(fields).every((key) => key === 'enabled' || key === 'auto' || key === 'id') || 'auto' in fields)) return;
  delete item.auto;
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

type Move = { at: number; rect: number[] };

/** An item's source range: a mask's `from` and `to`, a zoom's `at` and `at + duration`. */
const rangeOf = (item: Item): [number, number] => (item.from !== undefined ? [Number(item.from), Number(item.to)] : [Number(item.at), Number(item.at) + Number(item.duration)]);

/**
 * Keeps a zoom's or mask's moves with its time. Moved as a whole, they go with it (`by`); at a new
 * speed of its clip, they stretch with it from its start (`scale`); with an edge moved, they stay
 * where they are in the take. Moves no longer inside it go, and when its start passed some, it
 * starts where the last of them went.
 */
function keepPath(item: Item, change: { by?: number; scale?: number } = {}): void {
  if (!Array.isArray(item.moves)) return;
  const [at, end] = rangeOf(item);
  let moves = item.moves as Move[];
  if (change.by) moves = moves.map((move) => ({ ...move, at: move.at + change.by! }));
  if (change.scale) moves = moves.map((move) => ({ ...move, at: at + (move.at - at) * change.scale! }));
  const passed = moves.filter((move) => move.at <= at);
  if (passed.length > 0) item.rect = passed.at(-1)!.rect;
  const kept: Move[] = [];
  for (const move of moves) {
    const time = round(move.at);
    if (time > (kept.at(-1)?.at ?? at) && time < end) kept.push({ ...move, at: time });
  }
  if (kept.length > 0) item.moves = kept;
  else delete item.moves;
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
      // a crop stays inside the screen, at least 8 px each way
      const crop = item.crop as { rect?: number[] } | undefined;
      if (crop && Array.isArray(crop.rect)) crop.rect = clampRect(crop.rect, limits.screen);
    } else item.duration = round(Math.max(frame, Number(item.duration)));
    return;
  }
  if (list === 'sounds') {
    item.at = round(Math.max(0, Number(item.at)));
    if (item.volume !== undefined) item.volume = round(clampNumber(Number(item.volume), 0, 1));
    return;
  }
  if (list === 'masks' || list === 'cuts') {
    item.from = round(Math.max(0, Number(item.from)));
    item.to = round(Math.max(Number(item.from) + frame, Number(item.to)));
  } else {
    item.at = round(Math.max(0, Number(item.at)));
    item.duration = round(Math.max(frame, Number(item.duration)));
  }
  if (Array.isArray(item.rect)) item.rect = clampRect(item.rect as number[], limits.screen);
  if ((list === 'zooms' || list === 'masks') && Array.isArray(item.moves)) {
    item.moves = (item.moves as Move[]).map((move) => ({ at: Number(move.at), rect: clampRect(move.rect, limits.screen) }));
    keepPath(item);
  }
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
        // the edge that moves stops a frame before the other one: the clip never grows into source it did not show
        const frame = Number(item.speed ?? 1) / (limits.fps ?? 30);
        if (command.from !== undefined) item.from = Math.min(command.from, Number(command.to ?? item.to) - frame);
        if (command.to !== undefined) item.to = Math.max(command.to, Number(item.from) + frame);
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
      // shorter than a frame at that speed: refused, not grown into source the clip did not show
      if ((to - from) / speed < 1 / (limits.fps ?? 30) - 1e-9) throw new DocumentError('invalid', `the clip is too short for ${round(speed)}×`);
      item.speed = round(speed);
      touched.push(['scenes', item]);
      // Zooms, captions and motion overlays inside the clip keep their output length: a 3 s caption stays 3 s at 12×.
      for (const name of ['zooms', 'texts', 'overlays'] as const) {
        for (const overlay of items(next, name)) {
          const at = Number(overlay.at);
          const duration = Number(overlay.duration);
          if (at < from || at + duration > to) continue;
          overlay.duration = round(Math.min((duration / before) * speed, to - at));
          if (name === 'zooms') keepPath(overlay, { scale: Number(overlay.duration) / duration });
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
        keepPath(item, { by });
      } else {
        const at = Number(item.at);
        item.at = Math.max(0, at + command.by);
        if (command.list === 'zooms') keepPath(item, { by: Number(item.at) - at });
      }
      claim(item);
      touched.push([command.list, item]);
      break;
    }
    case 'set': {
      const { item } = find(next, command.list, command.id);
      const before = rangeOf(item);
      claim(item, command.fields);
      setFields(item, command.fields);
      // a path goes with its zoom or mask when it moves as a whole, and stays in the take when an edge moves
      if ((command.list === 'zooms' || command.list === 'masks') && !('moves' in command.fields)) {
        const after = rangeOf(item);
        keepPath(item, after[1] - after[0] === before[1] - before[0] ? { by: after[0] - before[0] } : {});
      }
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
      // a scene takes the sounds placed in it along
      if (command.list === 'scenes' && Array.isArray(next.sounds)) next.sounds = (next.sounds as Item[]).filter((sound) => sound.scene !== command.id);
      break;
    }
    case 'duplicate': {
      const { item, index } = find(next, command.list, command.id);
      const taken = usedIds(next);
      const copy: Item = { ...structuredClone(item), id: command.newId && !taken.has(command.newId) ? command.newId : newId(command.list, taken) };
      // a copy is the person's, never one the automatic edits may replace
      claim(copy);
      if (command.shift) {
        if (command.list === 'masks') {
          copy.from = Number(copy.from) + command.shift;
          copy.to = Number(copy.to) + command.shift;
          keepPath(copy, { by: command.shift });
        } else if (command.list !== 'scenes') {
          copy.at = Number(copy.at) + command.shift;
          if (command.list === 'zooms') keepPath(copy, { by: command.shift });
        }
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
    case 'music': {
      if (command.fields === null) delete next.music;
      else {
        const music = (next.music && typeof next.music === 'object' ? next.music : (next.music = {})) as Item;
        setFields(music, structuredClone(command.fields));
        if (typeof music.volume === 'number') music.volume = round(clampNumber(music.volume, 0, 1));
        if (typeof music.duck === 'number') music.duck = round(clampNumber(music.duck, 0, 40));
      }
      break;
    }
    case 'theme': {
      const theme = (!command.replace && next.theme && typeof next.theme === 'object' ? next.theme : (next.theme = {})) as Item;
      setFields(theme, structuredClone(command.fields));
      break;
    }
    case 'output': {
      const output = (next.output && typeof next.output === 'object' ? next.output : (next.output = {})) as Item;
      output.width = command.width;
      output.height = command.height;
      break;
    }
    case 'auto-edits': {
      const autoEdits = (next.autoEdits && typeof next.autoEdits === 'object' ? next.autoEdits : (next.autoEdits = {})) as Item;
      autoEdits[command.kind] = command.value;
      break;
    }
    case 'captions': {
      const captions = (next.captions && typeof next.captions === 'object' ? next.captions : (next.captions = {})) as Item;
      captions[command.field] = structuredClone(command.value);
      break;
    }
    case 'caption-fix': {
      if (!(command.end > command.at)) throw new DocumentError('invalid', 'a fix must end after it starts');
      const captions = (next.captions && typeof next.captions === 'object' ? next.captions : (next.captions = {})) as Item;
      const fixes = (Array.isArray(captions.fixes) ? captions.fixes : []) as { at: number; end: number; text: string }[];
      // a new fix takes the place of the fixes it overlaps
      const kept = fixes.filter((fix) => !(fix.at < command.end && command.at < fix.end));
      if (command.text !== undefined) kept.push({ at: command.at, end: command.end, text: command.text });
      if (kept.length > 0) captions.fixes = kept.sort((a, b) => a.at - b.at);
      else delete captions.fixes;
      break;
    }
    case 'scenes': {
      next.scenes = structuredClone(command.scenes);
      const ids = ensureIds(next);
      next.scenes = ids.scenes;
      // sounds placed in scenes that are gone go with them
      const kept = new Set(items(next, 'scenes').map((scene) => scene.id));
      if (Array.isArray(next.sounds)) next.sounds = (next.sounds as Item[]).filter((sound) => sound.scene === undefined || kept.has(sound.scene));
      break;
    }
  }
  for (const [name, item] of touched) clampItem(name, item, limits);
  const parsed = parseProject(next);
  if (!parsed.ok) throw new DocumentError('invalid', parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'));
  return next;
}

/**
 * The command with the id it gave a new item (add, split, duplicate) pinned in it, so a replay on a
 * newer version names the same item, never one someone else added meanwhile.
 */
export function pinIds(before: Raw, after: Raw, command: Command): Command {
  const fresh = (list: ListName) => {
    const old = new Set(items(before, list).map((item) => item.id));
    const found = items(after, list).find((item) => !old.has(item.id))?.id;
    return typeof found === 'string' ? found : undefined;
  };
  if (command.type === 'add') {
    const id = fresh(command.list);
    return id ? { ...command, item: { ...command.item, id } } : command;
  }
  if (command.type === 'split' || command.type === 'duplicate') {
    const id = fresh(command.type === 'split' ? 'scenes' : command.list);
    return id ? { ...command, newId: id } : command;
  }
  return command;
}

/**
 * Applies commands in order; the ones that cannot go on are left out and named: their item is gone,
 * the id a new item had is taken by another one now (and what was done to that new item after).
 * Deleting an item the newer version no longer has is done already, not left out.
 */
export function replayCommands(raw: Raw, commands: readonly Command[], limits: EditLimits = {}): { raw: Raw; dropped: string[] } {
  let current = raw;
  const dropped: string[] = [];
  /** New items that could not be added again: commands on them are left out too. */
  const lost = new Set<string>();
  for (const command of commands) {
    const pinned = command.type === 'add' ? command.item.id : command.type === 'split' || command.type === 'duplicate' ? command.newId : undefined;
    if (typeof pinned === 'string' && usedIds(current).has(pinned)) {
      lost.add(pinned);
      dropped.push(`the id ${pinned} of a new item is taken by another one now`);
      continue;
    }
    if ('id' in command && lost.has(command.id)) {
      dropped.push(`${command.id} was not added again`);
      continue;
    }
    try {
      current = applyCommand(current, command, limits);
    } catch (error) {
      if (!(error instanceof DocumentError)) throw error;
      if (command.type === 'delete' && error.code === 'gone') continue;
      dropped.push(error.message);
    }
  }
  return { raw: current, dropped };
}

const NOUNS: Record<ListName, [string, string]> = {
  scenes: ['scene', 'scenes'],
  zooms: ['zoom', 'zooms'],
  masks: ['mask', 'masks'],
  texts: ['caption', 'captions'],
  overlays: ['motion overlay', 'motion overlays'],
  cuts: ['cut', 'cuts'],
  sounds: ['sound', 'sounds'],
};
const noun = (list: ListName, count: number) => `${count} ${NOUNS[list][count === 1 ? 0 : 1]}`;

/**
 * What changed between two versions of a project, for people: "2 masks added · 1 scene changed",
 * "the look changed". Items are matched by id (by position when they have none).
 */
export function describeChange(before: CuttleProject, after: CuttleProject): string {
  return changeParts(before, after).join(' · ') || 'no visible change';
}

/** The first item added or changed between two versions (scenes, then zooms, masks, captions, motion overlays, cuts, sounds), to show it. */
export function firstChanged(before: CuttleProject, after: CuttleProject): { list: ListName; id: string } | undefined {
  for (const list of ['scenes', 'zooms', 'masks', 'texts', 'overlays', 'cuts', 'sounds'] as const) {
    const old = new Map(before[list].map((item) => [item.id, JSON.stringify(item)]));
    const found = after[list].find((item) => item.id !== undefined && old.get(item.id) !== JSON.stringify(item));
    if (found?.id) return { list, id: found.id };
  }
  return undefined;
}

function changeParts(before: CuttleProject, after: CuttleProject): string[] {
  const parts: string[] = [];
  for (const list of ['scenes', 'zooms', 'masks', 'texts', 'overlays', 'cuts', 'sounds'] as const) {
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
  if (JSON.stringify(before.music) !== JSON.stringify(after.music)) parts.push(!before.music ? 'music added' : !after.music ? 'the music removed' : 'the music changed');
  if (JSON.stringify(before.look) !== JSON.stringify(after.look)) parts.push('the look changed');
  if (JSON.stringify(before.theme) !== JSON.stringify(after.theme)) parts.push('the brand changed');
  if (JSON.stringify(before.autoEdits) !== JSON.stringify(after.autoEdits)) parts.push('the automatic edits changed');
  if (JSON.stringify(before.output) !== JSON.stringify(after.output)) parts.push('the output size changed');
  if (JSON.stringify(before.captions) !== JSON.stringify(after.captions)) parts.push('the subtitles changed');
  if (takeKey(before.sources) !== takeKey(after.sources)) parts.push('another take');
  else if (before.sources.transcript !== after.sources.transcript) parts.push(after.sources.transcript ? 'the take was transcribed' : 'the transcript was unlinked');
  return parts;
}
