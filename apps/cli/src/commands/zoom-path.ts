// `cuttle zoom-path <id>`: a zoom's path, where it starts and each move (source seconds, source px,
// the curve to it). With --at and --rect it adds a move there (or places the one at that second
// anew), --ease sets how the zoom gets there, --remove takes it off, --clear holds the zoom still.
// An edited path is the person's: its `auto` goes, as in the app.
import { readProjectFile, writeProjectFile } from '@cuttle/core';
import { MOVE_EASES, type MoveEase } from '@cuttle/project';
import { CliError } from '../errors';
import type { Output } from '../output';

export interface ZoomPathArgs {
  at?: number;
  /** "x,y,w,h" in source px; PowerShell passes it split at the commas. */
  rect?: string | string[];
  ease?: string;
  remove?: boolean;
  clear?: boolean;
}

interface Move {
  at: number;
  rect: number[];
  ease?: MoveEase;
}

/** Moves this close (source seconds) are one. */
const SAME = 0.005;

function rectOf(value: string | string[]): number[] {
  const text = [value].flat().join(',');
  const parts = text.split(/[\s,]+/).filter((part) => part !== '').map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite) || parts[2]! <= 0 || parts[3]! <= 0) throw new CliError('usage', `--rect needs x,y,w,h in source pixels (got "${text}")`);
  return parts.map((part) => Math.round(part));
}

export async function zoomPathCommand(projectDir: string, id: string, args: ZoomPathArgs, output: Output): Promise<{ zoom: string; start: { at: number; rect: number[] }; moves: Move[]; changed?: string }> {
  if (args.ease !== undefined && !(MOVE_EASES as readonly string[]).includes(args.ease)) throw new CliError('usage', `"${args.ease}" is no curve: ${MOVE_EASES.join(', ')}`);
  const changing = args.rect !== undefined || args.ease !== undefined || args.remove === true;
  if (changing && args.at === undefined) throw new CliError('usage', 'say which move with --at <source seconds>');
  if (args.clear && (changing || args.at !== undefined)) throw new CliError('usage', '--clear takes every move off: nothing else with it');
  if (args.remove && (args.rect !== undefined || args.ease !== undefined)) throw new CliError('usage', '--remove takes the move off: no --rect or --ease with it');

  const file = await readProjectFile(projectDir);
  const zooms = (file.raw.zooms as Record<string, unknown>[] | undefined) ?? [];
  const zoom = zooms.find((item) => item.id === id);
  if (!zoom) throw new CliError('usage', `no zoom has the id ${id} (cuttle items --kind zoom lists them)`);
  const from = zoom.at as number;
  const to = from + (zoom.duration as number);
  let moves = ((zoom.moves as Move[] | undefined) ?? []).map((move) => ({ ...move }));
  let changed: string | undefined;

  if (args.clear) {
    changed = 'clear';
    moves = [];
  } else if (changing) {
    const at = Math.round(args.at! * 1000) / 1000;
    const index = moves.findIndex((move) => Math.abs(move.at - at) < SAME);
    if (args.remove) {
      if (index < 0) throw new CliError('usage', `the zoom has no move at ${at} s: ${moves.map((move) => move.at).join(', ') || 'none'}`);
      moves.splice(index, 1);
      changed = 'remove';
    } else if (index >= 0) {
      moves[index] = { ...moves[index]!, ...(args.rect !== undefined && { rect: rectOf(args.rect) }), ...(args.ease !== undefined && { ease: args.ease as MoveEase }) };
      changed = 'move';
    } else {
      if (args.rect === undefined) throw new CliError('usage', `the zoom has no move at ${at} s: a new one needs --rect x,y,w,h`);
      if (!(at > from && at < to)) throw new CliError('usage', `a move must come inside the zoom: after ${from} s and before ${to} s`);
      moves = [...moves, { at, rect: rectOf(args.rect), ...(args.ease !== undefined && { ease: args.ease as MoveEase }) }].sort((a, b) => a.at - b.at);
      changed = 'add';
    }
    // `settle` is how a move goes when it says nothing
    for (const move of moves) if (move.ease === 'settle') delete move.ease;
  }

  if (changed) {
    if (moves.length > 0) zoom.moves = moves;
    else delete zoom.moves;
    delete zoom.auto;
    await writeProjectFile(file, `zoom-path ${changed}`);
  }
  const result = { zoom: id, start: { at: from, rect: zoom.rect as number[] }, moves, ...(changed && { changed }) };
  output.result(result, () => {
    const lines = [`start   ${from} s   ${(zoom.rect as number[]).join(',')}`, ...moves.map((move, i) => `move ${i + 1}  ${move.at} s   ${move.rect.join(',')}   ${move.ease ?? 'settle'}`)];
    return `${lines.join('\n')}${moves.length === 0 ? '\n(holds still)' : ''}`;
  });
  return result;
}
