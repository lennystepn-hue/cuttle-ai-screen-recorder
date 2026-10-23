// `cuttle annotate <kind>`: a mark on the screen's content at a moment of the take: an arrow from a
// point to a point, or a box, an ellipse, a highlighter stroke, a spotlight or a magnifier over a rect
// (source px, as `frame --grid` shows them).
import { readProjectFile, writeProjectFile } from '@cuttle/core';
import { ANNOTATION_KINDS, newId, usedIds, type AnnotationKind } from '@cuttle/project';
import { CliError } from '../errors';
import type { Output } from '../output';

export interface AnnotateArgs {
  at: number;
  duration?: number;
  /** "x,y,w,h" in source px; PowerShell passes it split at the commas. */
  rect?: string | string[];
  /** An arrow's start and end, "x,y". */
  from?: string | string[];
  to?: string | string[];
  text?: string;
  color?: string;
  zoom?: number;
  label?: string;
}

/** Numbers given as "a,b,…" (or split at the commas), `count` of them, or a usage error naming `option`. */
function numbers(value: string | string[], count: number, option: string, example: string): number[] {
  const text = [value].flat().join(',');
  const parts = text.split(/[\s,]+/).filter((part) => part !== '').map(Number);
  if (parts.length !== count || !parts.every(Number.isFinite)) throw new CliError('usage', `${option} needs ${example} in source pixels (got "${text}")`);
  return parts.map((part) => Math.round(part));
}

export async function annotateCommand(projectDir: string, kind: string, args: AnnotateArgs, output: Output): Promise<{ annotation: Record<string, unknown> }> {
  if (!(ANNOTATION_KINDS as readonly string[]).includes(kind)) throw new CliError('usage', `"${kind}" is no annotation: ${ANNOTATION_KINDS.join(', ')}`);
  const arrow = kind === 'arrow';
  if (arrow && (args.from === undefined || args.to === undefined)) throw new CliError('usage', 'an arrow needs --from x,y (where it starts) and --to x,y (what it points at)');
  if (!arrow && args.rect === undefined) throw new CliError('usage', `a ${kind} needs --rect x,y,w,h (what it marks)`);
  if (args.zoom !== undefined && kind !== 'magnifier') throw new CliError('usage', '--zoom is how much a magnifier enlarges');
  const file = await readProjectFile(projectDir);
  const annotation: Record<string, unknown> = {
    id: newId('annotations', usedIds(file.raw)),
    ...(args.label !== undefined && { label: args.label }),
    kind: kind as AnnotationKind,
    at: args.at,
    duration: args.duration ?? 3,
    ...(arrow ? { from: numbers(args.from!, 2, '--from', 'x,y'), to: numbers(args.to!, 2, '--to', 'x,y') } : { rect: numbers(args.rect!, 4, '--rect', 'x,y,w,h') }),
    ...(args.text !== undefined && { text: args.text }),
    ...(args.color !== undefined && { color: args.color }),
    ...(args.zoom !== undefined && { zoom: args.zoom }),
  };
  file.raw.annotations = [...((file.raw.annotations as unknown[] | undefined) ?? []), annotation];
  await writeProjectFile(file, 'annotate');
  output.result({ annotation }, () => `added ${kind} ${String(annotation.id)} at source ${args.at} s for ${String(annotation.duration)} s`);
  return { annotation };
}
