// `cuttle items`: the project's timed items (zooms, masks, captions, annotations, motion overlays,
// sounds, cuts), found by kind, by whether Cuttle made them, by the stretch of the take they touch or
// by id; and for all of them at once, in one write: switched on or off, deleted, or moved by seconds.
import { readProjectFile, writeProjectFile } from '@cuttle/core';
import { AUTO_KINDS } from '@cuttle/project';
import { CliError } from '../errors';
import type { Output } from '../output';

/** Each kind and its list in cuttle.json. */
export const ITEM_LISTS = { zoom: 'zooms', mask: 'masks', caption: 'texts', annotation: 'annotations', motion: 'overlays', sound: 'sounds', cut: 'cuts' } as const;
type Kind = keyof typeof ITEM_LISTS;
const KINDS = Object.keys(ITEM_LISTS) as Kind[];
/** Lists whose items span `from`–`to` (the others start `at` and last `duration`; a sound has no length). */
const SPANS: ReadonlySet<Kind> = new Set(['mask', 'cut']);

export interface ItemsArgs {
  /** "zoom,mask" (PowerShell passes it split at the commas). */
  kind?: string | string[];
  /** Only Cuttle's (true) or only the person's (false). */
  auto?: boolean;
  /** Only those of this automatic kind ("click", "privacy", …). */
  made?: string;
  /** "a,b": only those touching these source seconds. */
  between?: string | string[];
  ids?: string | string[];
  on?: boolean;
  off?: boolean;
  delete?: boolean;
  /** Source seconds to move them by (negative: earlier). */
  shift?: number;
}

export interface ListedItem {
  id: string;
  kind: Kind;
  label?: string;
  /** Source seconds; a sound in a scene counts from the scene's start (`scene`). */
  from: number;
  to?: number;
  scene?: string;
  enabled: boolean;
  auto?: string;
}

const words = (value: string | string[] | undefined) => (value === undefined ? undefined : [value].flat().join(',').split(/[\s,]+/).filter((part) => part !== ''));
const round = (value: number) => Math.round(value * 1000) / 1000;

export async function itemsCommand(projectDir: string, args: ItemsArgs, output: Output): Promise<{ items: ListedItem[]; changed?: 'on' | 'off' | 'delete' | 'shift' }> {
  const kinds = words(args.kind) ?? KINDS;
  const unknown = kinds.find((kind) => !(KINDS as string[]).includes(kind));
  if (unknown) throw new CliError('usage', `"${unknown}" is no kind of item: ${KINDS.join(', ')}`);
  if (args.made !== undefined && !(AUTO_KINDS as readonly string[]).includes(args.made)) throw new CliError('usage', `"${args.made}" is not something Cuttle makes: ${AUTO_KINDS.join(', ')}`);
  const between = words(args.between)?.map(Number);
  if (between && (between.length !== 2 || !between.every(Number.isFinite) || between[1]! < between[0]!)) throw new CliError('usage', `--between needs from,to in source seconds (got "${[args.between].flat().join(',')}")`);
  const ids = words(args.ids);
  if (args.shift !== undefined && !Number.isFinite(args.shift)) throw new CliError('usage', '--shift needs seconds, negative to move earlier');
  const changes = ([args.on && 'on', args.off && 'off', args.delete && 'delete', args.shift !== undefined && 'shift'] as const).filter((change) => change !== false && change !== undefined);
  if (changes.length > 1) throw new CliError('usage', 'one of --on, --off, --delete or --shift at a time');
  const changed = changes[0];
  // all of a project's items at once only when asked for by name
  if (changed && args.kind === undefined && args.auto === undefined && args.made === undefined && !between && !ids) throw new CliError('usage', `say which items to ${changed === 'shift' ? 'move' : changed === 'delete' ? 'delete' : `turn ${changed}`}: --kind, --auto, --made, --between or --ids`);

  const file = await readProjectFile(projectDir);
  const items: ListedItem[] = [];
  const picked = new Map<Kind, Set<string>>();
  for (const kind of kinds as Kind[]) {
    const list = ITEM_LISTS[kind];
    for (const item of file.project[list] as { id?: string; label?: string; at?: number; duration?: number; from?: number; to?: number; scene?: string; enabled: boolean; auto?: string }[]) {
      if (!item.id) continue;
      const from = SPANS.has(kind) ? item.from! : item.at!;
      const to = SPANS.has(kind) ? item.to : item.duration === undefined ? undefined : item.at! + item.duration;
      if (args.auto !== undefined && (item.auto !== undefined) !== args.auto) continue;
      if (args.made !== undefined && item.auto !== args.made) continue;
      if (ids && !ids.includes(item.id)) continue;
      // a sound in a scene has no place in the take to compare
      if (between && (item.scene !== undefined || (to ?? from) < between[0]! || from > between[1]!)) continue;
      items.push({ id: item.id, kind, ...(item.label !== undefined && { label: item.label }), from: round(from), ...(to !== undefined && { to: round(to) }), ...(item.scene !== undefined && { scene: item.scene }), enabled: item.enabled, ...(item.auto !== undefined && { auto: item.auto }) });
      if (!picked.has(kind)) picked.set(kind, new Set());
      picked.get(kind)!.add(item.id);
    }
  }
  const missing = ids?.filter((id) => !items.some((item) => item.id === id));
  if (changed && missing && missing.length > 0) throw new CliError('usage', `no ${kinds.length === KINDS.length ? 'item' : kinds.join(' or ')} has the id ${missing.join(', ')}`);
  if (changed === 'shift') {
    const early = items.find((item) => item.scene === undefined && item.from + args.shift! < 0);
    if (early) throw new CliError('usage', `${early.id} would start ${round(-(early.from + args.shift!))} s before the take`);
  }

  if (changed && items.length > 0) {
    for (const [kind, chosen] of picked) {
      const list = ITEM_LISTS[kind];
      const raw = (file.raw[list] as Record<string, unknown>[] | undefined) ?? [];
      if (changed === 'delete') {
        file.raw[list] = raw.filter((item) => !chosen.has(item.id as string));
        continue;
      }
      for (const item of raw) {
        if (!chosen.has(item.id as string)) continue;
        if (changed === 'on') delete item.enabled;
        else if (changed === 'off') item.enabled = false;
        else {
          const by = args.shift!;
          if (SPANS.has(kind)) [item.from, item.to] = [round((item.from as number) + by), round((item.to as number) + by)];
          else item.at = round(Math.max(0, (item.at as number) + by));
          // a zoom's or mask's path goes along; moved, an item is the person's: the next suggest keeps it
          if (Array.isArray(item.moves)) item.moves = (item.moves as { at: number }[]).map((move) => ({ ...move, at: round(move.at + by) }));
          delete item.auto;
        }
      }
    }
    await writeProjectFile(file, `items ${changed}`);
    if (changed === 'on' || changed === 'off') for (const item of items) item.enabled = changed === 'on';
    if (changed === 'shift') {
      for (const item of items) {
        Object.assign(item, { from: round(Math.max(0, item.from + args.shift!)) }, item.to !== undefined && { to: round(item.to + args.shift!) });
        delete item.auto;
      }
    }
  }

  const result = { items, ...(changed && { changed }) };
  output.result(result, () => {
    const lines = items.map((item) => {
      const time = `${item.scene ? `${item.scene} +` : ''}${item.from}${item.to === undefined ? '' : `–${item.to}`} s`;
      return [item.id.padEnd(6), item.kind.padEnd(11), time.padEnd(18), item.auto ?? 'yours', item.enabled ? '' : 'off', item.label ?? ''].filter(Boolean).join('  ');
    });
    const done = changed === undefined ? '' : `\n${changed === 'delete' ? 'deleted' : changed === 'shift' ? `moved by ${args.shift} s:` : `turned ${changed}:`} ${items.length} item${items.length === 1 ? '' : 's'}`;
    return `${lines.length > 0 ? lines.join('\n') : 'no items'}${done}`;
  });
  return result;
}
