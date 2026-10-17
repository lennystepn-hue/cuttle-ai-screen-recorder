// A clip's speed as the editor sets it: the speed, and the clip's zooms on clicks placed anew for it
// as `suggest` places them. Pure: the editor passes its project, the take's events and a way to see
// the project after commands.
import type { CuttleProject, InputEvent } from '@cuttle/project';
import { clickZooms, sceneSpans, type ZoomScreen } from '@cuttle/timeline';
import type { Command } from './document';

/**
 * The commands for clip `id` at `speed`. Its zooms on clicks are placed anew for it: their lead and
 * tail are output seconds, and a clip sped up past 2× gets none (waiting). Only where suggest's
 * zooms on clicks were and are on: one deleted or switched off stays so. The other zooms stay where
 * they are in the take, or keep their length when made by hand (the speed command).
 */
export function speedCommands(
  project: CuttleProject,
  id: string,
  speed: number,
  events: readonly InputEvent[],
  screen: ZoomScreen,
  after: (commands: Command[]) => CuttleProject | undefined,
): Command[] {
  const commands: Command[] = [{ type: 'speed', id, speed }];
  const clip = project.scenes.find((scene) => scene.id === id);
  if (clip?.type !== 'clip' || !project.autoEdits.clickZooms) return commands;
  const inside = (zoom: { at: number; duration: number }) => zoom.at >= clip.from && zoom.at + zoom.duration <= clip.to;
  // every zoom of a document opened in the editor has an id
  const replaced = project.zooms.filter((zoom): zoom is typeof zoom & { id: string } => zoom.id !== undefined && zoom.auto === 'click' && zoom.enabled && inside(zoom));
  if (replaced.length === 0) return commands;
  const removed: Command[] = replaced.map((zoom) => ({ type: 'delete', list: 'zooms', id: zoom.id }));
  const next = after([...commands, ...removed]);
  if (!next) return commands;
  const clips = sceneSpans(next.scenes, next.cuts).flatMap((span) => (span.scene.type === 'clip' ? [{ from: span.scene.from, to: span.scene.to, speed: span.scene.speed, start: span.start }] : []));
  const where = (zoom: { at: number; duration: number }) => replaced.some((old) => zoom.at < old.at + old.duration && old.at < zoom.at + zoom.duration);
  const placed = clickZooms(events, clips, screen, next.zooms).filter((zoom) => zoom.at >= clip.from && zoom.at < clip.to && where(zoom));
  return [
    ...commands,
    ...removed,
    ...placed.map((zoom) => ({ type: 'add', list: 'zooms', item: { label: zoom.clicks === 1 ? 'Click' : 'Clicks', at: zoom.at, duration: zoom.duration, rect: zoom.rect, ...(zoom.moves && { moves: zoom.moves }), auto: 'click' } }) as Command),
  ];
}
