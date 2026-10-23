// A zoom's path in the editor: its places (where it starts, then each move), one of them selected.
// The source view edits the selected place's rect, the timeline a move's time, the inspector its
// curve; a move is added at the playhead (where the zoom aims there, so nothing changes until it is
// moved) and removed again. Each is one edit, and an edited path is the person's (its `auto` goes).
import type { MoveEase, Rect, Zoom } from "@cuttle/project";
import { sceneSpans, zoomTargetAt } from "@cuttle/timeline";
import type { Command } from "../../shared/document";
import { outputTimesOf } from "../../shared/timeline-model";
import { playheadPlace } from "./actions";
import { edit, toast } from "./doc";
import { currentPlayer, documentProject, store } from "./session";

type Move = NonNullable<Zoom["moves"]>[number];
type PathZoom = Zoom & { id: string };

/** Moves keep this far apart (source seconds), and inside the zoom. */
const GAP = 0.01;
const round = (value: number) => Math.round(value * 1000) / 1000;

/** The selected zoom, when a zoom is selected. */
export function selectedZoom(): PathZoom | undefined {
  const { selection } = store.get();
  if (selection?.kind !== "zoom") return undefined;
  return documentProject()?.zooms.find((zoom) => zoom.id === selection.id) as
    PathZoom | undefined;
}

/** A place of a zoom's path: 0 where it starts, k its k-th move. */
export function placeOf(
  zoom: Pick<Zoom, "at" | "rect" | "moves">,
  index: number,
): { at: number; rect: Rect; ease?: MoveEase } | undefined {
  if (index === 0) return { at: zoom.at, rect: zoom.rect };
  return zoom.moves?.[index - 1];
}

/** Selects a place of the selected zoom's path (none: the whole path) and shows it: the playhead goes to its time. */
export function selectPlace(index: number | undefined): void {
  store.set({ place: index });
  const zoom = selectedZoom();
  const project = documentProject();
  const place = zoom && index !== undefined ? placeOf(zoom, index) : undefined;
  if (!project || !place) return;
  const t = outputTimesOf(
    sceneSpans(project.scenes, project.cuts),
    place.at,
  )[0];
  if (t !== undefined) void currentPlayer()?.seek(t);
}

/** The time a move may take: after the place before it, before the next (or the zoom's end). */
export function moveRange(
  zoom: Pick<Zoom, "at" | "duration" | "moves">,
  index: number,
): [number, number] {
  const moves = zoom.moves ?? [];
  return [
    (index === 1 ? zoom.at : moves[index - 2]!.at) + GAP,
    (index === moves.length ? zoom.at + zoom.duration : moves[index]!.at) - GAP,
  ];
}

/** The command that changes a place: its rect (the start's is the zoom's `rect`), a move's time or curve. */
export function placeCommand(
  zoom: PathZoom,
  index: number,
  change: { at?: number; rect?: Rect; ease?: MoveEase },
): Command {
  // the start's rect alone: the moves stay where they are
  if (index === 0)
    return {
      type: "set",
      list: "zooms",
      id: zoom.id,
      fields: {
        rect: change.rect ?? zoom.rect,
        ...(zoom.moves && { moves: zoom.moves }),
      },
    };
  const [from, to] = moveRange(zoom, index);
  const moves = (zoom.moves ?? []).map((move, i): Move => {
    if (i !== index - 1) return move;
    const { ease: _ease, ...rest } = move;
    const ease = "ease" in change ? change.ease : move.ease;
    return {
      ...rest,
      ...(change.at !== undefined && {
        at: round(Math.min(to, Math.max(from, change.at))),
      }),
      ...(change.rect && { rect: change.rect }),
      ...(ease && ease !== "settle" && { ease }),
    };
  });
  return { type: "set", list: "zooms", id: zoom.id, fields: { moves } };
}

/** Sets how the zoom gets to a move's rect. */
export function setMoveEase(index: number, ease: MoveEase): void {
  const zoom = selectedZoom();
  if (zoom && index > 0)
    edit([placeCommand(zoom, index, { ease })], "Change how the zoom moves");
}

/** A move at the playhead: where the zoom aims there, selected (then dragged in the source view). */
export function addMove(): void {
  const zoom = selectedZoom();
  if (!zoom) return;
  const place = playheadPlace();
  const at = place?.source === undefined ? undefined : round(place.source);
  if (
    at === undefined ||
    !place?.clip ||
    !(at > zoom.at + GAP && at < zoom.at + zoom.duration - GAP)
  )
    return toast("Move the playhead inside the zoom to add a move there.", {
      tone: "warning",
    });
  if (zoom.moves?.some((move) => Math.abs(move.at - at) < GAP))
    return toast(
      "The zoom moves at this moment already: select that move to change it.",
      { tone: "warning" },
    );
  const rect = zoomTargetAt(zoom, at, place.clip.speed).map((value) =>
    Math.round(value),
  ) as Rect;
  const moves = [...(zoom.moves ?? []), { at, rect }].sort(
    (a, b) => a.at - b.at,
  );
  if (
    edit(
      [{ type: "set", list: "zooms", id: zoom.id, fields: { moves } }],
      "Add a move to the zoom",
    )
  )
    store.set({ place: moves.findIndex((move) => move.at === at) + 1 });
}

/** Takes a move off the path (the last one taken: the zoom holds still). */
export function removeMove(index: number): void {
  const zoom = selectedZoom();
  if (!zoom || index < 1 || !zoom.moves?.[index - 1]) return;
  const moves = zoom.moves.filter((_, i) => i !== index - 1);
  if (
    edit(
      [
        {
          type: "set",
          list: "zooms",
          id: zoom.id,
          fields: { moves: moves.length > 0 ? moves : undefined },
        },
      ],
      "Remove a move of the zoom",
    )
  ) {
    store.set({
      place: moves.length === 0 ? undefined : Math.min(index, moves.length),
    });
  }
}
