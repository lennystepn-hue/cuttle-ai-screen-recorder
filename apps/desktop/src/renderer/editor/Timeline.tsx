// The timeline: markers, ruler, scenes with thumbnails, the overlay lanes (one block per stretch of
// output that shows an overlay, overlapping ones on separate rows), the mic's waveform and input
// activity. The ruler, the markers and empty lanes scrub; a click on a block selects it (and moves
// the playhead there); a drag edits: a scene's edges trim it and its body moves it among the
// scenes; an overlay's body moves it and its edges change its length (Alt: a copy). Drags snap to
// the playhead, scene edges, markers and other overlays (Ctrl: only to frames). Edits ripple: the
// scenes after move. The wheel scrolls along, Shift+wheel up and down, Ctrl+wheel zooms.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { BUILT_IN_SOUNDS, MOTION_TEMPLATES, MUSIC_TEMPLATES } from '@cuttle/motion-kit';
import type { CuttleProject, MarkerKind } from '@cuttle/project';
import { applyCaptionFixes, captionCues, captionWords, sceneSpans } from '@cuttle/timeline';
import type { Command, OverlayList } from '../../shared/document';
import { dragRange, overlayRange, rangeFields, snapTime } from '../../shared/edit';
import { formatTime } from '../../shared/format';
import {
  activityColumns,
  blockSourceAt,
  groupPins,
  pinGroupDetail,
  pinGroupName,
  soundName,
  timelineModel,
  waveformColumns,
  type OverlayBlock,
  type OverlayKind,
  type Peaks,
  type SceneBlock,
  type TimelineModel,
} from '../../shared/timeline-model';
import { FitIcon } from '../icons';
import { Select } from '../Select';
import { addCard, addMask, addMotion, addMusic, addPage, addSound, addZoom, overlayBlocked, selectedOrCurrentClip, setSpeed, split, SPEEDS, templateLabel } from './actions';
import { audible } from './audio';
import { edit, fitLength, preview } from './doc';
import { beginGesture } from './gesture';
import { mediaUrl } from './media';
import type { MotionStrip } from './motion';
import { currentPlayer, select, setTool, shownProject, store, type Selection, selectMany, toggleSelect } from './session';
import { useStore } from './store';

const END_SPACE = 40;
/** A row of an overlay lane (lanes grow a row for overlays that overlap in time)… */
const ROW = 30;
/** …with this much room above its first row and below its last. */
const LANE_PAD = 6;
const BASE_ROWS = { markers: 26, ruler: 24, video: 64, music: 40, mic: 34, input: 28 } as const;
const LANES: { kind: OverlayKind; name: string; list: OverlayList }[] = [
  { kind: 'zoom', name: 'Zoom', list: 'zooms' },
  { kind: 'mask', name: 'Mask', list: 'masks' },
  { kind: 'caption', name: 'Caption', list: 'texts' },
  { kind: 'annotation', name: 'Draw', list: 'annotations' },
  { kind: 'motion', name: 'Motion', list: 'overlays' },
  { kind: 'sound', name: 'Sound', list: 'sounds' },
];
const NOUN: Record<OverlayKind, string> = { zoom: 'zoom', mask: 'mask', caption: 'caption', annotation: 'annotation', motion: 'motion overlay', sound: 'sound' };
const TICKS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
const MAX_PPS = 400;
/** A pointer that moves less than this between down and up clicked (selects); more drags. */
const DRAG_PX = 3;
/** A block this wide shows its whole label (cut short with an ellipsis); a narrower one its first letter, down to INITIAL_MIN_PX. */
const LABEL_MIN_PX = 48;
const INITIAL_MIN_PX = 16;
/** A label's first letter or digit, for a block too narrow for the label. */
const initialOf = (title: string) => /[\p{L}\p{N}]/u.exec(title)?.[0]?.toUpperCase() ?? '';
/** How near (px) a dragged edge comes to a target before it snaps. */
const SNAP_PX = 6;

/**
 * Until when the playhead was last moved with the pointer (performance.now()): the view does not
 * follow those seeks, or a drag near an edge would scroll the content under the pointer and run away.
 */
let pointerSeekUntil = 0;

const MARKER_DOT: Record<MarkerKind, string> = { prompt: '#ececf1', tool: '#7a7a85', answer: '#4fd1a1', manual: '#9a9aa5', retake: '#f2b34a', step: '#d97757' };

interface Layout {
  heights: Record<'markers' | 'ruler' | 'video' | OverlayKind | 'music' | 'mic' | 'input', number>;
  tops: Record<'markers' | 'ruler' | 'video' | OverlayKind | 'music' | 'mic' | 'input', number>;
  total: number;
}

/**
 * An overlay lane's height: a row per overlap; none while it is empty (its kind is added from the
 * bar above, or drawn on the video), unless `more` it holds (the sounds motion pages ask for).
 */
const laneHeight = (model: TimelineModel | undefined, kind: OverlayKind, more = false): number => {
  const lane = model?.lanes[kind];
  if (!lane || (lane.blocks.length === 0 && lane.cutOut === 0 && !more)) return 0;
  return 2 * LANE_PAD + ROW * Math.max(1, lane.rows);
};

/** What the take has besides the project's items: a row shows only for what is there. */
interface Shown {
  mic: boolean;
  input: boolean;
  pageSounds: boolean;
}

function layoutOf(model: TimelineModel | undefined, shown: Shown): Layout {
  const heights = {
    markers: (model?.markers.length ?? 0) > 0 ? BASE_ROWS.markers : 0,
    ruler: BASE_ROWS.ruler,
    video: BASE_ROWS.video,
    zoom: laneHeight(model, 'zoom'),
    mask: laneHeight(model, 'mask'),
    caption: laneHeight(model, 'caption'),
    annotation: laneHeight(model, 'annotation'),
    motion: laneHeight(model, 'motion'),
    sound: laneHeight(model, 'sound', shown.pageSounds),
    music: model?.music ? BASE_ROWS.music : 0,
    mic: shown.mic ? BASE_ROWS.mic : 0,
    input: shown.input ? BASE_ROWS.input : 0,
  };
  const order = ['markers', 'ruler', 'video', 'zoom', 'mask', 'caption', 'annotation', 'motion', 'sound', 'music', 'mic', 'input'] as const;
  const tops = {} as Layout['tops'];
  let y = 0;
  for (const row of order) {
    tops[row] = y;
    y += heights[row];
  }
  return { heights, tops, total: y };
}

/** The colour of the waveform and activity bars (the `--bars` token). */
const BARS = '#5c5c68';

/** A drag under way: where a snapped edge lines up (a guide), where a moved scene would go. */
interface DragView {
  guide?: number;
  insertAt?: number;
  /** A scene being moved: a copy of its block follows the pointer (left and width in output seconds), the block itself dimmed. */
  ghost?: { id: string; left: number; width: number; label: string };
}

export function Timeline() {
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const media = useStore(store, (state) => state.media);
  useStore(store, (state) => state.doc?.preview ?? state.doc?.project);
  useStore(store, (state) => state.format);
  const pps = useStore(store, (state) => state.pxPerSecond);
  const selection = useStore(store, (state) => state.selection);
  const also = useStore(store, (state) => state.also);
  const chosen = selection ? [selection, ...also] : [];
  // a rubber band being drawn (Shift-drag on the lanes), in the content's px
  const [band, setBand] = useState<{ left: number; top: number; width: number; height: number }>();
  const motionStatus = useStore(store, (state) => state.motionStatus);
  const pageSounds = useStore(store, (state) => state.soundStatus.pageSounds);
  const snapOn = useStore(store, (state) => state.snap);
  const peaksState = useStore(store, (state) => state.mediaState.peaks.state);
  const peaksPath = useStore(store, (state) => state.mediaState.peaks.path);
  const peaksRate = useStore(store, (state) => state.mediaState.peaks.rate);
  const [view, setView] = useState({ left: 0, width: 800 });
  const [peaks, setPeaks] = useState<Peaks>();
  const [drag, setDrag] = useState<DragView>({});
  // The overlay under the pointer: its other blocks (other clips that show it) light up with it.
  const [hovered, setHovered] = useState<string>();
  // The lane whose cut-out overlays are listed, and where its label is on screen.
  const [cutOutList, setCutOutList] = useState<{ kind: OverlayKind; left: number; top: number }>();

  const project = shownProject();
  const spans = useMemo(() => (project ? sceneSpans(project.scenes, project.cuts) : []), [project]);
  const duration = spans.at(-1)?.end ?? 0;
  const model = useMemo(() => (project ? timelineModel(project, spans, media?.markers) : undefined), [project, spans, media]);
  // the subtitles over the mic's waveform: where each one shows, as the video has them
  const cues = useMemo(
    () => (project && media?.transcript ? captionCues(captionWords(applyCaptionFixes(media.transcript.words, project.captions.fixes), spans), project.captions.style) : []),
    [project, spans, media],
  );
  const hasMic = project?.sources.mic !== undefined;
  const hasInput = project?.sources.events !== undefined;
  const hasPageSounds = (pageSounds?.length ?? 0) > 0;
  const layout = useMemo(() => layoutOf(model, { mic: hasMic, input: hasInput, pageSounds: hasPageSounds }), [model, hasMic, hasInput, hasPageSounds]);

  /** The whole video is in view: it stays so when the window changes size, until the person scales it. */
  const fitted = useRef(true);
  const fit = useCallback(() => {
    const element = scroller.current;
    if (!element || !(duration > 0)) return;
    fitted.current = true;
    store.set({ pxPerSecond: Math.max(0.01, (element.clientWidth - END_SPACE - 8) / duration) });
    element.scrollLeft = 0;
  }, [duration]);

  useLayoutEffect(() => {
    if (pps === 0 && duration > 0) fit();
  }, [pps, duration, fit]);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const update = () => setView({ left: element.scrollLeft, width: element.clientWidth });
    update();
    const observer = new ResizeObserver(() => {
      update();
      if (fitted.current) store.set({ pxPerSecond: 0 }); // fitted again by the layout effect
    });
    observer.observe(element);
    element.addEventListener('scroll', update, { passive: true });
    const onWheel = (event: WheelEvent) => {
      if (event.shiftKey) {
        event.preventDefault();
        if (body.current) body.current.scrollTop += event.deltaY || event.deltaX;
        return;
      }
      const current = store.get().pxPerSecond;
      if (event.ctrlKey || event.altKey) {
        event.preventDefault();
        const project = shownProject();
        const length = project ? (sceneSpans(project.scenes, project.cuts).at(-1)?.end ?? 0) : 0;
        const fitPps = length > 0 ? (element.clientWidth - END_SPACE - 8) / length : current;
        const box = element.getBoundingClientRect();
        const anchorX = event.clientX - box.left;
        const anchorT = (element.scrollLeft + anchorX) / current;
        const next = Math.min(MAX_PPS, Math.max(fitPps, current * Math.exp(-event.deltaY * 0.002)));
        fitted.current = false;
        store.set({ pxPerSecond: next });
        requestAnimationFrame(() => (element.scrollLeft = Math.max(0, anchorT * next - anchorX)));
        return;
      }
      if (event.deltaX === 0 && event.deltaY !== 0) {
        event.preventDefault();
        element.scrollLeft += event.deltaY;
      }
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', update);
      element.removeEventListener('wheel', onWheel);
    };
  }, []);

  // The mic's peaks, once the worker has made them.
  useEffect(() => {
    if (peaksState !== 'ready' || !peaksPath || !peaksRate || !media?.mic) return;
    let cancelled = false;
    void fetch(mediaUrl(peaksPath))
      .then((response) => (response.ok ? response.arrayBuffer() : undefined))
      .then((buffer) => {
        if (!cancelled && buffer) setPeaks({ rate: peaksRate, offset: media.mic!.offset, data: new Uint8Array(buffer) });
      });
    return () => {
      cancelled = true;
    };
  }, [peaksState, peaksPath, peaksRate, media]);

  const timeAt = (clientX: number) => {
    const element = scroller.current!;
    const box = element.getBoundingClientRect();
    return Math.max(0, Math.min(duration, (clientX - box.left + element.scrollLeft) / pps));
  };

  const seekTo = (t: number) => {
    pointerSeekUntil = performance.now() + 1000;
    void currentPlayer()?.seek(t);
  };

  /**
   * Follows a pointer from a press on `event`'s element: `onMove` with the horizontal distance
   * (px) once it moved more than a click would, `onEnd` with whether it moved. It listens on the
   * window: the pressed element may be drawn anew while it is dragged.
   */
  const follow = (event: ReactPointerEvent<HTMLElement>, onMove: (dx: number, moved: PointerEvent) => void, onEnd: (moved: boolean, last: PointerEvent | undefined) => void) => {
    const target = event.currentTarget;
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // a synthetic pointer (the check) has nothing to capture
    }
    const startX = event.clientX;
    let dragging = false;
    let last: PointerEvent | undefined;
    const move = (moved: PointerEvent) => {
      if (!dragging && Math.abs(moved.clientX - startX) < DRAG_PX) return;
      dragging = true;
      last = moved;
      onMove(moved.clientX - startX, moved);
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    // Esc or playing cancels it: no edit, the preview and the guides go
    const ended = beginGesture('timeline', () => {
      stop();
      setDrag({});
      preview(undefined);
    });
    const up = () => {
      stop();
      ended();
      onEnd(dragging, last);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  /** Scrubs from a press on the ruler, the markers or an empty lane (a click on an empty lane clears the selection). */
  const scrub = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const onLane = !(event.target as HTMLElement).closest('.ruler, .markers');
    // Shift on the lanes: a rubber band, not the playhead
    if (event.shiftKey && onLane) return drawBand(event);
    seekTo(timeAt(event.clientX));
    follow(
      event,
      (_dx, moved) => seekTo(timeAt(moved.clientX)),
      (moved) => !moved && onLane && select(undefined),
    );
  };

  /** Output times a dragged edge snaps to, without those of the item being dragged. */
  const targets = (except: { scene?: string; overlay?: string }): number[] => {
    if (!model) return [];
    const list = [currentPlayer()?.current().t ?? 0, ...model.markers.map((pin) => pin.t)];
    for (const scene of model.scenes) if (scene.id !== except.scene) list.push(scene.start, scene.end);
    for (const lane of LANES) for (const block of model.lanes[lane.kind].blocks) if (block.id !== except.overlay) list.push(block.start, block.end);
    return list;
  };
  const fps = project?.output.fps ?? 30;
  const snapped = (t: number, list: number[], event: { ctrlKey: boolean }) => (snapOn && !event.ctrlKey ? snapTime(t, list, SNAP_PX / pps, fps) : { t: Math.round(t * fps) / fps });

  /** A press on a scene: select it (the playhead goes there); its edges trim, its body moves it. */
  const pressScene = (event: ReactPointerEvent<HTMLElement>, block: SceneBlock) => {
    if (event.button !== 0 || !model || !project) return;
    event.stopPropagation();
    const edge = (event.target as HTMLElement).dataset.edge as 'start' | 'end' | undefined;
    const picked: Selection = { kind: 'scene', id: block.id };
    // Shift-click: added to the selection, or taken out of it; Ctrl/⌘ the same on a click, while a
    // Ctrl-drag still edits (without snapping)
    if (event.shiftKey) return toggleSelect(picked);
    const adding = event.ctrlKey || event.metaKey;
    if (!adding) select(picked);
    if (!edge && !adding) seekTo(timeAt(event.clientX));
    const scene = project.scenes[block.index]!;
    const others = targets({ scene: block.id });
    // where on the timeline the scene was taken (the ghost keeps that point under the pointer)
    const pressedAt = timeAt(event.clientX);
    let commands: Command[] | undefined;
    let insertAt: number | undefined;
    follow(
      event,
      (dx, moved) => {
        const deltaOut = dx / pps;
        if (edge) {
          // The end edge snaps; the start edge of a clip moves its source start (where it starts in
          // the video stays, and it gets shorter or longer at its end, as every edit ripples).
          if (scene.type === 'clip') {
            if (edge === 'end') {
              const end = snapped(block.end + deltaOut, others, moved);
              setDrag({ guide: end.target });
              // through the clip's pieces: cuts inside it take no output time
              commands = [{ type: 'trim', id: block.id, to: blockSourceAt(block, end.t) }];
            } else commands = [{ type: 'trim', id: block.id, from: scene.from + deltaOut * scene.speed }];
          } else {
            const end = edge === 'end' ? snapped(block.end + deltaOut, others, moved) : { t: block.end - deltaOut, target: undefined };
            setDrag({ guide: end.target });
            commands = [{ type: 'trim', id: block.id, duration: Math.max(1 / fps, end.t - block.start) }];
          }
          preview(commands);
          return;
        }
        // moving: the scene goes where the pointer is among the others' middles; a ghost of it follows the pointer
        const t = timeAt(moved.clientX);
        const rest = model.scenes.filter((other) => other.id !== block.id);
        insertAt = rest.filter((other) => (other.start + other.end) / 2 < t).length;
        setDrag({
          insertAt: insertAt === 0 ? (rest[0]?.start ?? 0) : rest[insertAt - 1]!.end,
          // on the timeline, never past its ends
          ghost: { id: block.id, left: Math.min(Math.max(0, block.start + (t - pressedAt)), duration - (block.end - block.start)), width: block.end - block.start, label: block.title },
        });
      },
      (moved) => {
        setDrag({});
        if (!moved) return adding ? toggleSelect(picked) : undefined;
        if (adding) select(picked);
        if (edge) {
          if (commands) edit(commands, scene.type === 'clip' ? 'Trim clip' : `Change the length of the ${scene.type === 'still' ? 'page' : scene.type === 'motion' ? 'motion scene' : 'card'}`);
          else preview(undefined);
          return;
        }
        if (insertAt !== undefined && insertAt !== block.index) edit([{ type: 'move-scene', id: block.id, index: insertAt }], 'Move scene');
      },
    );
  };

  /**
   * Moves every selected overlay by the same output time, each in source seconds at the speed of the
   * clip that shows it (scenes and cuts stay); one step to undo.
   */
  const moveSelected = (event: ReactPointerEvent<HTMLElement>, clicked: () => void) => {
    if (!model || !project) return;
    const lists: Partial<Record<Selection['kind'], OverlayList>> = Object.fromEntries(LANES.map((lane) => [lane.kind, lane.list]));
    const moving = chosen.flatMap((item) => {
      const list = lists[item.kind];
      const block = list && model.lanes[item.kind as OverlayKind].blocks.find((candidate) => candidate.id === item.id);
      if (!list || !block) return [];
      const scene = spans[block.span]?.scene;
      // a sound in a scene counts in the scene's seconds
      const speed = scene?.type === 'clip' && !(item.kind === 'sound' && (project.sounds.find((sound) => sound.id === item.id)?.scene !== undefined)) ? scene.speed : 1;
      return [{ list, id: item.id, speed }];
    });
    let commands: Command[] | undefined;
    follow(
      event,
      (dx) => {
        const deltaOut = Math.round((dx / pps) * fps) / fps;
        commands = moving.map(({ list, id, speed }) => ({ type: 'shift', list, id, by: deltaOut * speed }));
        preview(commands);
      },
      (moved) => {
        if (!moved || !commands) {
          preview(undefined);
          return clicked();
        }
        edit(commands, `Move ${moving.length} items`);
      },
    );
  };

  /** A Shift-drag on the lanes: the items the band touches are selected together (Esc: none). */
  const drawBand = (event: ReactPointerEvent<HTMLElement>) => {
    const content = event.currentTarget;
    const origin = content.getBoundingClientRect();
    const start = { x: event.clientX - origin.left, y: event.clientY - origin.top };
    const rect = (at: PointerEvent) => {
      const x = at.clientX - origin.left;
      const y = at.clientY - origin.top;
      return { left: Math.min(start.x, x), top: Math.min(start.y, y), width: Math.abs(x - start.x), height: Math.abs(y - start.y) };
    };
    let box: ReturnType<typeof rect> | undefined;
    const move = (moved: PointerEvent) => {
      // either way: a band can go across the lanes at one time
      if (!box && Math.hypot(moved.clientX - event.clientX, moved.clientY - event.clientY) < DRAG_PX) return;
      box = rect(moved);
      setBand(box);
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setBand(undefined);
    };
    const ended = beginGesture('timeline', stop);
    const up = () => {
      stop();
      ended();
      if (!box) return;
      const touched: Selection[] = [];
      for (const element of content.querySelectorAll<HTMLElement>('[data-kind][data-id]')) {
        const at = element.getBoundingClientRect();
        const [left, top] = [at.left - origin.left, at.top - origin.top];
        if (left < box.left + box.width && left + at.width > box.left && top < box.top + box.height && top + at.height > box.top) {
          const item = { kind: element.dataset.kind as Selection['kind'], id: element.dataset.id! };
          if (!touched.some((each) => each.kind === item.kind && each.id === item.id)) touched.push(item);
        }
      }
      selectMany(touched);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  /** A press on an overlay block: select it; its edges change its length, its body moves it (Alt: a copy). */
  const pressOverlay = (event: ReactPointerEvent<HTMLElement>, block: OverlayBlock, list: OverlayList) => {
    if (event.button !== 0 || !project) return;
    event.stopPropagation();
    const edge = ((event.target as HTMLElement).dataset.edge as 'start' | 'end' | undefined) ?? 'move';
    const copy = event.altKey && edge === 'move';
    const picked: Selection = { kind: block.kind, id: block.id, start: block.start, end: block.end };
    // Shift-click: added to the selection, or taken out of it; Ctrl/⌘ the same on a click, while a
    // Ctrl-drag still moves it (without snapping)
    if (event.shiftKey) return toggleSelect(picked);
    const adding = event.ctrlKey || event.metaKey;
    const clicked = () => (adding ? toggleSelect(picked) : select(picked));
    // its body, dragged while it is one of several selected: they all move along (a click: it alone)
    if (edge === 'move' && !copy && chosen.length > 1 && isSelected(chosen, block.kind, block.id)) return moveSelected(event, clicked);
    if (!adding) select(picked);
    if (edge === 'move' && !adding) seekTo(timeAt(event.clientX));
    const item = project[list].find((candidate) => candidate.id === block.id);
    const scene = spans[block.span]?.scene;
    // a sound in a scene moves inside it, in output seconds
    if (item && 'sound' in item && item.scene !== undefined) {
      const at = item.at;
      const length = (spans.filter((span) => span.sceneIndex === spans[block.span]?.sceneIndex).at(-1)?.end ?? block.end) - (block.start - at);
      let moves: Command[] | undefined;
      follow(
        event,
        (dx) => {
          const next = Math.min(Math.max(0, at + dx / pps), Math.max(0, length - 1 / fps));
          moves = copy ? [{ type: 'duplicate', list, id: block.id, shift: next - at }] : [{ type: 'set', list, id: block.id, fields: { at: Math.round(next * 1000) / 1000 } }];
          preview(moves);
        },
        (moved) => {
          if (!moved || !moves) {
            preview(undefined);
            return adding && clicked();
          }
          if (adding) select(picked);
          edit(moves, copy ? 'Duplicate sound' : 'Move sound');
        },
      );
      return;
    }
    if (!item || scene?.type !== 'clip') return adding && clicked();
    const range = overlayRange(item as { from?: number; to?: number; at?: number; duration?: number });
    const others = targets({ overlay: block.id });
    let commands: Command[] | undefined;
    follow(
      event,
      (dx, moved) => {
        let deltaOut = dx / pps;
        // the edge that leads snaps (both ends of a moved block: the nearer target wins)
        const candidates = edge === 'move' ? [block.start, block.end] : [edge === 'start' ? block.start : block.end];
        let best: { delta: number; target: number } | undefined;
        for (const at of candidates) {
          const hit = snapped(at + deltaOut, others, moved);
          if (hit.target !== undefined && (!best || Math.abs(hit.t - at - deltaOut) < Math.abs(best.delta - deltaOut))) best = { delta: hit.t - at, target: hit.target };
        }
        if (best) deltaOut = best.delta;
        setDrag({ guide: best?.target });
        const [from, to] = dragRange(range, edge, deltaOut, scene.speed, scene.speed / fps);
        commands = copy
          ? [{ type: 'duplicate', list, id: block.id, shift: from - range[0] }]
          : [{ type: 'set', list, id: block.id, fields: rangeFields(list, from, to) }];
        preview(commands);
      },
      (moved) => {
        setDrag({});
        if (!moved || !commands) {
          preview(undefined);
          return adding && clicked();
        }
        if (adding) select(picked);
        const noun = NOUN[block.kind];
        edit(commands, copy ? `Duplicate ${noun}` : edge === 'move' ? `Move ${noun}` : `Change the length of the ${noun}`);
      },
    );
  };

  const width = duration * pps;
  const fitPps = scroller.current && duration > 0 ? (scroller.current.clientWidth - END_SPACE - 8) / duration : pps;
  const zoomValue = pps > 0 && fitPps > 0 ? Math.log(pps / fitPps) / Math.log(Math.max(1.0001, MAX_PPS / fitPps)) : 0;
  const { heights, tops } = layout;

  return (
    <section className="timeline" aria-label="Timeline">
      <TimelineBar status={model ? `${model.scenes.length} scene${model.scenes.length === 1 ? '' : 's'}` : ''} duration={model ? duration : undefined} fit={fit} zoomValue={zoomValue} onScale={(value) => {
        const element = scroller.current;
        if (!element || !(fitPps > 0)) return;
        const next = fitPps * Math.pow(MAX_PPS / fitPps, value);
        const anchor = currentPlayer()?.current().t ?? 0;
        fitted.current = false;
        store.set({ pxPerSecond: next });
        requestAnimationFrame(() => (element.scrollLeft = Math.max(0, anchor * next - element.clientWidth / 2)));
      }} />
      <div className="tl-body" ref={body}>
        <div className="tl-names" style={{ height: layout.total }}>
          <div style={{ height: heights.markers }} />
          <div style={{ height: heights.ruler }} />
          <div style={{ height: heights.video }}>Video</div>
          {LANES.map((lane) => (
            <div key={lane.kind} style={{ height: heights[lane.kind] }} className={`lane-name ${lane.kind}`}>
              {lane.name}
              {(model?.lanes[lane.kind].cutOut ?? 0) > 0 && (
                <button
                  type="button"
                  className="cut-out"
                  title="No clip shows these; they are not in the video. Click to list them."
                  aria-expanded={cutOutList?.kind === lane.kind}
                  onClick={(event) => {
                    const at = event.currentTarget.getBoundingClientRect();
                    setCutOutList(cutOutList?.kind === lane.kind ? undefined : { kind: lane.kind, left: at.right + 6, top: at.top });
                  }}
                  data-testid={`cut-out-${lane.kind}`}
                >
                  {model!.lanes[lane.kind].cutOut} cut out
                </button>
              )}
              {cutOutList?.kind === lane.kind && model && (
                <CutOutList
                  at={cutOutList}
                  items={model.lanes[lane.kind].cutOutItems}
                  onPick={(id) => {
                    setCutOutList(undefined);
                    select({ kind: lane.kind, id });
                  }}
                  onClose={() => setCutOutList(undefined)}
                />
              )}
            </div>
          ))}
          <div style={{ height: heights.music }} className="lane-name music">
            Music
          </div>
          <div style={{ height: heights.mic }}>Mic</div>
          <div style={{ height: heights.input }}>Input</div>
        </div>
        <div className="tl-scroll" ref={scroller} data-testid="timeline">
          <div className="tl-content" style={{ width: width + END_SPACE, height: layout.total }} onPointerDown={scrub}>
            {band && <div className="tl-band" style={band} data-testid="timeline-band" />}
            {model && project && model.scenes.length === 0 && (
              <span className="lane-hint" style={{ top: tops.video + heights.video / 2, left: 10 }}>
                The video's scenes show here once Cuttle cuts the take
              </span>
            )}
            {model && project && pps > 0 && (
              <>
                {heights.markers > 0 && <Markers model={model} pps={pps} />}
                <Ruler duration={duration} pps={pps} view={view} top={tops.ruler} />
                <div className="tl-row" style={{ position: 'absolute', top: tops.video, height: heights.video, left: 0, right: 0 }}>
                  {model.scenes.map((scene) => (
                    <Scene key={scene.id} scene={scene} project={project} pps={pps} view={view} selected={isSelected(chosen, 'scene', scene.id)} moving={drag.ghost?.id === scene.id} onPointerDown={(event) => pressScene(event, scene)} />
                  ))}
                  {/* where cuts take a stretch out: a notch; an off cut, faint, where it would cut */}
                  {model.cuts.map((notch) => (
                    <button
                      key={`${notch.ids.join('+')}@${notch.t}`}
                      type="button"
                      className={`cut-notch${notch.enabled ? '' : ' off'}${notch.ids.some((id) => isSelected(chosen, 'cut', id)) ? ' selected' : ''}`}
                      style={{ left: notch.t * pps }}
                      title={`${notch.title}${notch.ids.length > 1 ? ` and ${notch.ids.length - 1} more` : ''}${notch.enabled ? '' : ' (off: the video plays it)'} · click to select`}
                      aria-label={`${notch.enabled ? 'Cut' : 'Cut, off'}: ${notch.title}`}
                      data-testid="cut-notch"
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        select({ kind: 'cut', id: notch.ids[0]! });
                      }}
                      // Enter or Space when it has the keyboard's focus
                      onClick={() => select({ kind: 'cut', id: notch.ids[0]! })}
                    />
                  ))}
                </div>
                {LANES.map((lane) => (
                  <div key={lane.kind} className={`tl-row lane ${lane.kind}`} hidden={heights[lane.kind] === 0} style={{ position: 'absolute', top: tops[lane.kind], height: heights[lane.kind], left: 0, right: 0 }}>
                    {model.lanes[lane.kind].blocks.map((block, index, blocks) => {
                      const failed = lane.kind === 'motion' && motionStatus.some((entry) => entry.item === `overlays[${block.item}]` && entry.state === 'failed');
                      const blockLeft = block.start * pps;
                      const blockWidth = Math.max(6, (block.end - block.start) * pps);
                      const inset = Math.max(0, Math.min(view.left - blockLeft, blockWidth - LABEL_MIN_PX));
                      return (
                        <button
                          // by the overlay and which of its blocks: a block keeps its element while it is dragged
                          key={`${block.id}#${blocks.slice(0, index).filter((other) => other.id === block.id).length}`}
                          className={`item ${lane.kind}${block.enabled ? '' : ' off'}${isSelected(chosen, lane.kind, block.id) ? ' selected' : ''}${hovered === block.id ? ' linked' : ''}${failed ? ' failed' : ''}`}
                          onPointerEnter={() => setHovered(block.id)}
                          onPointerLeave={() => setHovered((id) => (id === block.id ? undefined : id))}
                          style={{ left: blockLeft, width: blockWidth, top: LANE_PAD + 2 + block.row * ROW }}
                          title={`${block.title}${block.enabled ? '' : ' (off: not in the video)'} · drag to move${lane.kind === 'sound' ? '' : ', edges to change the length'}, Alt to copy, Del to delete`}
                          data-id={block.id}
                          data-kind={lane.kind}
                          onPointerDown={(event) => pressOverlay(event, block, lane.list)}
                          onKeyDown={(event) => event.key === 'Enter' && select({ kind: lane.kind, id: block.id, start: block.start, end: block.end })}
                        >
                          {blockWidth >= 14 && lane.kind !== 'sound' && <i className="edge start" data-edge="start" />}
                          {blockWidth >= LABEL_MIN_PX ? (
                            <span style={{ marginLeft: inset }}>{block.title}</span>
                          ) : (
                            blockWidth >= INITIAL_MIN_PX && (
                              <span className="initial" aria-hidden>
                                {initialOf(block.title)}
                              </span>
                            )
                          )}
                          {/* a zoom that follows: where it moves on */}
                          {block.marks?.map((mark) => <i key={mark} className="move-mark" style={{ left: (mark - block.start) * pps }} />)}
                          {blockWidth >= 14 && lane.kind !== 'sound' && <i className="edge end" data-edge="end" />}
                        </button>
                      );
                    })}
                    {/* the sounds motion pages ask for: where they play, theirs to move */}
                    {lane.kind === 'sound' &&
                      pageSounds?.map((mark, index) => (
                        <i
                          key={`${mark.item}@${mark.at}#${index}`}
                          className="page-sound"
                          style={{ left: mark.at * pps }}
                          title={`${soundName(mark.sound)} at ${formatTime(mark.at)}: ${mark.item} asks for it (its page moves it)`}
                          data-testid="page-sound"
                        />
                      ))}
                  </div>
                ))}
                <MusicLane model={model} top={tops.music} height={heights.music} pps={pps} view={view} duration={duration} selected={isSelected(chosen, 'music', 'music')} />
                <ColumnsCanvas
                  top={tops.mic}
                  height={heights.mic}
                  view={view}
                  color={BARS}
                  columns={(from, to, count) => (peaks ? waveformColumns(peaks, spans, from, to, count, (speed) => !audible(project, speed)) : new Array<number>(count).fill(0))}
                  pps={pps}
                  mirrored
                  deps={[peaks, spans, project]}
                />
                {cues.map((cue) => {
                  const left = cue.start * pps;
                  const width = (cue.end - cue.start) * pps;
                  if (left + width < view.left || left > view.left + view.width) return null;
                  const text = cue.lines.map((line) => line.map((word) => word.text).join(' ')).join(' ');
                  return (
                    <button
                      key={cue.start}
                      type="button"
                      className={`subtitle-cue${project.captions.enabled ? '' : ' off'}`}
                      style={{ left, width: Math.max(2, width - 1), top: tops.mic + 2 }}
                      title={`${text}${project.captions.enabled ? '' : ' (subtitles are off)'} · click to go there`}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        void currentPlayer()?.seek(cue.start);
                      }}
                      tabIndex={-1}
                      data-testid="subtitle-cue"
                    >
                      {width >= 28 && text}
                    </button>
                  );
                })}
                <ColumnsCanvas
                  top={tops.input}
                  height={heights.input}
                  view={view}
                  color={BARS}
                  columns={(from, to, count) => activityColumns(media?.events ?? [], spans, from, to, count)}
                  pps={pps}
                  deps={[media, spans]}
                />
                {drag.guide !== undefined && <div className="snap-guide" style={{ left: drag.guide * pps }} />}
                {drag.ghost && (
                  <div className="scene-ghost" style={{ left: drag.ghost.left * pps, width: drag.ghost.width * pps, top: tops.video + 4, height: heights.video - 8 }}>
                    <span className="lbl">{drag.ghost.label}</span>
                  </div>
                )}
                {/* at either end of the timeline the mark stays whole */}
                {drag.insertAt !== undefined && <div className="insert-mark" style={{ left: Math.min(Math.max(drag.insertAt * pps, 2), duration * pps - 2), top: tops.video, height: heights.video }} />}
                <Playhead pps={pps} top={tops.ruler} scroller={scroller} />
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

const isSelected = (selected: readonly Selection[], kind: Selection['kind'], id: string) => selected.some((item) => item.kind === kind && item.id === id);

/** The rendered music's peaks: this many a second (as the main process makes them). */
const MUSIC_PEAKS_RATE = 50;

/**
 * The music's lane: one block over the video with the rendered music's waveform and the parts its page
 * named, and what it is doing (rendering, failed). Without music: how to add some.
 */
function MusicLane({ model, top, height, pps, view, duration, selected }: { model: TimelineModel; top: number; height: number; pps: number; view: { left: number; width: number }; duration: number; selected: boolean }) {
  const status = useStore(store, (state) => state.soundStatus);
  const track = useStore(store, (state) => state.soundtrack);
  const music = model.music;
  // without music its row is not shown: + Music adds some
  if (!music) return null;
  const sections = status.info?.sections ?? [];
  const problems = status.errors.length;
  const state = status.state === 'rendering' ? 'rendering …' : status.state === 'failed' ? 'could not render' : problems > 0 ? `${problems} error${problems === 1 ? '' : 's'}` : '';
  const info = [status.info?.bpm ? `${Math.round(status.info.bpm * 10) / 10} BPM` : '', status.info?.key ?? ''].filter(Boolean).join(' · ');
  return (
    <>
      <button
        type="button"
        className={`item music${music.enabled ? '' : ' off'}${selected ? ' selected' : ''}${status.state === 'failed' || problems > 0 ? ' failed' : ''}`}
        style={{ left: 0, width: Math.max(6, duration * pps), top: top + 3, height: height - 6 }}
        title={`Music: ${music.title}${music.enabled ? '' : ' (off)'}${info ? ` · ${info}` : ''} · click for its page and params`}
        data-testid="music-lane"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.stopPropagation();
          select({ kind: 'music', id: 'music' });
        }}
        onKeyDown={(event) => event.key === 'Enter' && select({ kind: 'music', id: 'music' })}
      >
        {sections.map((part, index) => (
          <span key={index} className="music-part" style={{ left: part.start * pps }}>
            {(part.end - part.start) * pps >= 56 ? `${part.name}${part.energy !== undefined ? ` · ${part.energy}` : ''}` : ''}
          </span>
        ))}
        {sections.length === 0 && <span style={{ marginLeft: Math.max(0, view.left) }}>{music.title}</span>}
        {state && (
          <span className="music-state" style={{ right: Math.max(8, duration * pps - view.left - view.width + 8) }}>
            {state}
          </span>
        )}
      </button>
      {track && (
        <ColumnsCanvas
          className="music-wave"
          top={top + 12}
          height={height - 16}
          view={view}
          color="rgba(232, 197, 71, 0.55)"
          columns={(from, to, count) => {
            const out = new Array<number>(count).fill(0);
            const per = (to - from) / count;
            for (let i = 0; i < count; i++) {
              const a = Math.max(0, Math.floor((from + i * per) * MUSIC_PEAKS_RATE));
              const b = Math.min(track.peaks.length, Math.ceil((from + (i + 1) * per) * MUSIC_PEAKS_RATE));
              let peak = 0;
              for (let k = a; k < b; k++) peak = Math.max(peak, track.peaks[k]!);
              out[i] = (peak / 255) * (music.enabled ? 1 : 0.4);
            }
            return out;
          }}
          pps={pps}
          mirrored
          deps={[track, music.enabled]}
        />
      )}
    </>
  );
}

/** The timeline's bar: split, speed, new items, snapping, fit and scale. */
function TimelineBar({ status, duration, fit, zoomValue, onScale }: { status: string; duration?: number; fit: () => void; zoomValue: number; onScale: (value: number) => void }) {
  useStore(store, (state) => state.doc?.project);
  useStore(store, (state) => state.selection);
  const t = useStore(store, (state) => Math.round(state.player.t * 10));
  const snap = useStore(store, (state) => state.snap);
  const broken = useStore(store, (state) => state.doc?.issues !== undefined);
  const clip = selectedOrCurrentClip();
  const blocked = broken ? 'cuttle.json has a mistake: editing waits' : overlayBlocked();
  void t;
  return (
    <div className="tl-bar" role="toolbar" aria-label="Edit">
      <button className="act split" onClick={split} disabled={!clip || broken} title="Split the clip at the playhead (S)" data-testid="split">
        <SplitGlyph />
        <span className="act-name">Split</span>
      </button>
      <label className="act speed" title="The clip's speed (R faster, Shift+R slower)">
        <span>Speed</span>
        <Select
          value={clip ? String(clip.speed) : undefined}
          options={[
            ...(clip && !SPEEDS.includes(clip.speed as (typeof SPEEDS)[number]) ? [{ value: String(clip.speed), label: `${clip.speed}×` }] : []),
            ...SPEEDS.map((speed) => ({ value: String(speed), label: `${speed}×` })),
          ]}
          disabled={!clip || broken}
          onChange={(speed) => setSpeed(Number(speed), clip?.id)}
          label="Speed"
          variant="compact"
          testId="speed"
        />
      </label>
      <span className="tl-sep" />
      <button className="act add" onClick={() => addZoom()} disabled={!!blocked} title={blocked ?? 'A zoom at the playhead (Z draws one)'}>
        <i className="dot zoom" aria-hidden="true" />
        <span className="act-name">Zoom</span>
      </button>
      <button className="act add" onClick={() => addMask()} disabled={!!blocked} title={blocked ?? 'A mask at the playhead (M draws one)'}>
        <i className="dot mask" aria-hidden="true" />
        <span className="act-name">Mask</span>
      </button>
      <button className="act add" onClick={() => setTool('caption')} disabled={!!blocked} title={blocked ?? 'A caption at the playhead: type it on the video (T)'}>
        <i className="dot caption" aria-hidden="true" />
        <span className="act-name">Caption</span>
      </button>
      <button className="act add" onClick={addCard} disabled={broken} title="A title card after the scene under the playhead">
        <i className="dot card" aria-hidden="true" />
        <span className="act-name">Card</span>
      </button>
      <button className="act add" onClick={() => void addPage()} disabled={broken} title="A page (an image, scrolled through) after the scene under the playhead">
        <i className="dot still" aria-hidden="true" />
        <span className="act-name">Page</span>
      </button>
      <Select
        value={undefined}
        options={MOTION_TEMPLATES.map((template) => ({ value: template.name, label: templateLabel(template.name), note: template.kind === 'scene' ? 'scene' : template.whole ? 'over the take' : 'overlay' }))}
        onChange={(name) => void addMotion(name)}
        label="Add a motion template"
        variant="bare"
        disabled={broken}
        className="act add motion-add"
        testId="add-motion"
        title="Motion from the kit's templates: a scene after the scene under the playhead, or an overlay on the video. Claude can change its page, or write one of its own."
      >
        <i className="dot motion" aria-hidden="true" />
        <span className="act-name">Motion</span>
      </Select>
      <Select
        value={undefined}
        options={MUSIC_TEMPLATES.map((template) => ({ value: template.name, label: templateLabel(template.name), note: template.description.split(':')[0]! }))}
        onChange={(name) => void addMusic(name)}
        label="Add music from a template"
        variant="bare"
        disabled={broken}
        className="act add music-add"
        testId="add-music"
        title="Music written for this video from a template (it follows the scenes and cuts and goes down under speech). Claude can change it or write the video's own."
      >
        <i className="dot music" aria-hidden="true" />
        <span className="act-name">Music</span>
      </Select>
      <Select
        value={undefined}
        options={BUILT_IN_SOUNDS.map(([name, description]) => ({ value: name, label: templateLabel(name), note: description }))}
        onChange={(name) => addSound(name)}
        label="Add a sound at the playhead"
        variant="bare"
        disabled={broken}
        className="act add sound-add"
        testId="add-sound"
        title="A sound at the playhead: a whoosh, a pop, a ding (it moves with what the video shows there)"
      >
        <i className="dot sound" aria-hidden="true" />
        <span className="act-name">Sound</span>
      </Select>
      <span className="tl-sep" />
      <span className="tl-status">{status}</span>
      {duration !== undefined && <LengthControl duration={duration} />}
      <div className="grow" />
      <button className="act" aria-pressed={snap} onClick={() => store.set({ snap: !snap })} title="Snap to the playhead, scene edges, markers and other overlays (Ctrl while dragging: frames only)">
        Snap
      </button>
      <button className="act fit" onClick={fit} title="Fit the whole video (Shift+Z)">
        <FitIcon size={14} />
        <span className="act-name">Fit</span>
      </button>
      <input type="range" min={0} max={1} step={0.001} value={Math.max(0, Math.min(1, zoomValue))} aria-label="Timeline scale" title="Timeline scale (Ctrl + wheel)" onChange={(event) => onScale(Number(event.target.value))} />
    </div>
  );
}

/** The lengths the Length menu offers (output seconds). */
const LENGTHS = [15, 30, 45, 60, 90];

/**
 * The video's length; its menu fits the video to another length (Cuttle cuts where it rests, never
 * speech, clicks or typing: the Auto tab lists the cuts), to one typed in, or takes the fit out.
 */
function LengthControl({ duration }: { duration: number }) {
  const fitted = useStore(store, (state) => state.doc?.project.cuts.some((cut) => cut.auto === 'length') ?? false);
  const busy = useStore(store, (state) => state.status?.state === 'working' || state.doc?.issues !== undefined);
  const [typing, setTyping] = useState(false);
  if (typing) {
    return (
      <input
        className="length-input"
        autoFocus
        inputMode="decimal"
        placeholder="seconds"
        aria-label="Fit the video to this many seconds"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') {
            const seconds = Number(event.currentTarget.value.trim().replace(',', '.'));
            setTyping(false);
            if (seconds > 0) void fitLength(seconds);
          }
          if (event.key === 'Escape') setTyping(false);
        }}
        onBlur={() => setTyping(false)}
        data-testid="length-input"
      />
    );
  }
  return (
    <Select
      value={undefined}
      options={[
        ...LENGTHS.map((seconds) => ({ value: String(seconds), label: `${seconds} s`, ...(duration <= seconds + 0.05 && { note: 'fits' }) })),
        { value: 'other', label: 'Other length…' },
        ...(fitted ? [{ value: 'none', label: 'Full length', note: 'no fit' }] : []),
      ]}
      onChange={(choice) => {
        if (choice === 'other') setTyping(true);
        else void fitLength(choice === 'none' ? null : Number(choice));
      }}
      label="Fit the video to a length"
      variant="bare"
      disabled={busy}
      className="length-select"
      testId="length"
      title="The video's length: fit it to another, and Cuttle cuts where it rests (never speech, clicks or typing)"
    >
      {formatTime(duration)}
      {fitted && <span className="length-fitted"> · fitted</span>}
    </Select>
  );
}

/** The overlays of a lane that no clip shows: a click selects one (the inspector can move or delete it). */
function CutOutList({ at, items, onPick, onClose }: { at: { left: number; top: number }; items: { id: string; title: string }[]; onPick: (id: string) => void; onClose: () => void }) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector('button')?.focus();
    const away = (event: PointerEvent) => !list.current?.contains(event.target as Node) && onClose();
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  }, [onClose]);
  // on the body: the lane names clip what overflows them
  return createPortal(
    <div
      className="cut-out-list"
      ref={list}
      role="menu"
      style={{ left: at.left, top: Math.min(at.top, window.innerHeight - 40 - items.length * 30) }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="cut-out-head">Not in the video: no clip shows these</div>
      {items.map((item) => (
        <button key={item.id} type="button" role="menuitem" onClick={() => onPick(item.id)}>
          {item.title}
        </button>
      ))}
    </div>,
    document.body,
  );
}

function SplitGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M8 1.5v13M3 5l-1.5 3L3 11M13 5l1.5 3L13 11" />
    </svg>
  );
}

/** The playhead: the only part that changes on every frame. Keeps itself in view while playing and after a seek by key. */
function Playhead({ pps, top, scroller }: { pps: number; top: number; scroller: React.RefObject<HTMLDivElement | null> }) {
  const t = useStore(store, (state) => state.player.t);
  const playing = useStore(store, (state) => state.player.playing);
  useEffect(() => {
    const element = scroller.current;
    if (!element || (!playing && performance.now() < pointerSeekUntil)) return;
    const x = t * pps;
    if (x < element.scrollLeft + (playing ? 0 : 40) || x > element.scrollLeft + element.clientWidth - 40) element.scrollLeft = Math.max(0, x - element.clientWidth / 3);
  }, [t, pps, playing, scroller]);
  // moved with a transform: no layout each frame while it plays
  return <div className="playhead" style={{ transform: `translateX(${t * pps}px)`, top }} />;
}

const Markers = memo(function Markers({ model, pps }: { model: TimelineModel; pps: number }) {
  const groups = groupPins(model.markers, 70 / pps);
  return (
    <div className="tl-row markers" style={{ position: 'absolute', top: 0, height: BASE_ROWS.markers, left: 0, right: 0 }}>
      {groups.map((group, i) => {
        // A flag ends before the next one starts (its dot always shows); the tooltip names it in full.
        const next = groups[i + 1];
        const room = next ? (next.t - group.t) * pps - 3 : undefined;
        return (
          <span key={i} className="flag" style={{ left: group.t * pps, ...(room !== undefined && { maxWidth: Math.max(17, room) }) }} title={`${pinGroupName(group)}: ${pinGroupDetail(group)}`}>
            <i style={{ background: MARKER_DOT[group.kind] }} />
            <span>{pinGroupName(group)}</span>
          </span>
        );
      })}
    </div>
  );
});

const Ruler = memo(function Ruler({ duration, pps, view, top }: { duration: number; pps: number; view: { left: number; width: number }; top: number }) {
  const step = TICKS.find((tick) => tick * pps >= 70) ?? TICKS.at(-1)!;
  const first = Math.max(0, Math.floor(view.left / pps / step) * step);
  const last = Math.min(duration, (view.left + view.width) / pps);
  const ticks: number[] = [];
  for (let tick = first; tick <= last + 1e-9; tick += step) ticks.push(Math.round(tick * 1000) / 1000);
  return (
    <div className="tl-row ruler" style={{ position: 'absolute', top, height: BASE_ROWS.ruler, left: 0, right: 0 }}>
      {ticks.map((tick) => (
        <span key={tick} style={{ left: tick * pps }}>
          {step < 1 ? formatTime(tick) : formatTime(tick).replace(/\.\d$/, '')}
        </span>
      ))}
    </div>
  );
});

/**
 * Frames across a motion scene for its block, drawn by its page: asked for again a moment after the
 * project or its files change (an unchanged scene answers at once, with nothing to draw).
 */
function useMotionStrip(scene: SceneBlock, project: CuttleProject, height: number): MotionStrip | undefined {
  const files = useStore(store, (state) => state.motionFiles);
  const [strip, setStrip] = useState<{ id: string; strip: MotionStrip }>();
  const motion = scene.kind === 'motion';
  useEffect(() => {
    if (!motion) return;
    let live = true;
    const timer = setTimeout(() => {
      void currentPlayer()
        ?.motionStrip(scene.index, height)
        .then((next) => live && next && setStrip({ id: scene.id, strip: next }), () => {});
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [motion, scene.index, scene.id, project, files, height]);
  return strip?.id === scene.id ? strip.strip : undefined;
}

function Scene(props: { scene: SceneBlock; project: CuttleProject; pps: number; view: { left: number; width: number }; selected: boolean; moving: boolean; onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void }) {
  const { scene, project, pps, view, selected, onPointerDown } = props;
  const failed = useStore(store, (state) => (scene.kind === 'motion' ? state.motionStatus.find((entry) => entry.item === `scenes[${scene.index}]` && entry.state === 'failed') : undefined));
  const thumbState = useStore(store, (state) => state.mediaState.thumbnails.state);
  const thumbPath = useStore(store, (state) => state.mediaState.thumbnails.path);
  const interval = useStore(store, (state) => state.mediaState.thumbnails.interval);
  const thumbWidth = useStore(store, (state) => state.mediaState.thumbnails.width ?? 160);
  const thumbHeight = useStore(store, (state) => state.mediaState.thumbnails.height ?? 90);
  const count = useStore(store, (state) => state.mediaState.thumbnails.count ?? 1);
  const columns = useStore(store, (state) => state.mediaState.thumbnails.columns ?? 1);
  const screenStart = useStore(store, (state) => state.media?.screen.start ?? 0);
  const left = scene.start * pps;
  const width = (scene.end - scene.start) * pps;
  const clip = project.scenes[scene.index];
  const tileHeight = BASE_ROWS.video - 12;
  const tiles: { x: number; index: number }[] = [];
  const ready = thumbState === 'ready' && thumbPath !== undefined && interval !== undefined;
  const tileWidth = Math.round((tileHeight * thumbWidth) / thumbHeight);
  if (ready && clip?.type === 'clip' && width > 0) {
    const from = Math.max(0, Math.floor((view.left - left) / tileWidth));
    const to = Math.min(Math.ceil(width / tileWidth), Math.ceil((view.left + view.width - left) / tileWidth) + 1);
    for (let i = from; i < to; i++) {
      const outT = scene.start + ((i + 0.5) * tileWidth) / pps;
      // The thumbnails count from the take's first frame.
      // the source second shown there, through the clip's pieces (cuts take no output time)
      const source = blockSourceAt(scene, outT) - screenStart;
      tiles.push({ x: i * tileWidth, index: Math.min(count - 1, Math.max(0, Math.floor(source / interval!))) });
    }
  }
  // a motion scene: its page's frames, each tile the frame nearest its time
  const strip = useMotionStrip(scene, project, tileHeight * 2);
  const motionTiles: { x: number; width: number; url: string }[] = [];
  if (strip && width > 0) {
    const tile = Math.max(8, Math.round((tileHeight * project.output.width) / project.output.height));
    const from = Math.max(0, Math.floor((view.left - left) / tile));
    const to = Math.min(Math.ceil(width / tile), Math.ceil((view.left + view.width - left) / tile) + 1);
    for (let i = from; i < to; i++) {
      const frame = (((i + 0.5) * tile) / pps) * project.output.fps;
      let nearest = 0;
      strip.frames.forEach((candidate, k) => {
        if (Math.abs(candidate - frame) < Math.abs(strip.frames[nearest]! - frame)) nearest = k;
      });
      motionTiles.push({ x: i * tile, width: tile, url: strip.urls[nearest]! });
    }
  }
  const kindClass = scene.kind === 'clip' ? '' : ` ${scene.kind}`;
  const speed = scene.speed !== undefined && scene.speed !== 1 ? `${Math.round(scene.speed * 10) / 10}×` : '';
  const name = [speed, scene.title].filter(Boolean).join(' ');
  const inset = Math.max(0, Math.min(view.left - left, width - LABEL_MIN_PX - 14));
  const scale = tileHeight / thumbHeight;
  return (
    <button
      className={`scene${kindClass}${selected ? ' selected' : ''}${props.moving ? ' moving' : ''}${failed ? ' failed' : ''}`}
      style={{ left, width: Math.max(4, width - 2) }}
      title={failed ? `${name} · its page cannot draw: ${failed.failure ?? 'it failed'}` : `${name} · ${scene.detail} · drag to move, edges to trim`}
      data-id={scene.id}
      data-kind="scene"
      onPointerDown={onPointerDown}
      onKeyDown={(event) => event.key === 'Enter' && select({ kind: 'scene', id: scene.id })}
    >
      {motionTiles.length > 0 && (
        <span className="thumbs">
          {motionTiles.map((tile) => (
            <i key={tile.x} style={{ left: tile.x, width: tile.width, backgroundImage: `url("${tile.url}")`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
          ))}
        </span>
      )}
      {ready && tiles.length > 0 && (
        <span className="thumbs">
          {tiles.map((tile) => (
            <i
              key={tile.x}
              style={{
                left: tile.x,
                width: tileWidth,
                backgroundImage: `url("${mediaUrl(thumbPath!)}")`,
                backgroundSize: `${columns * thumbWidth * scale}px auto`,
                backgroundPosition: `${-(tile.index % columns) * thumbWidth * scale}px ${-Math.floor(tile.index / columns) * tileHeight}px`,
              }}
            />
          ))}
        </span>
      )}
      {width >= LABEL_MIN_PX ? (
        <span className="lbl" style={{ marginLeft: 7 + inset }}>
          {speed && <b>{speed} </b>}
          {scene.title}
          {width >= 160 && <span className="detail"> · {scene.detail}</span>}
        </span>
      ) : (
        // a narrow clip still says its speed
        speed &&
        width >= 30 && (
          <span className="lbl" style={{ marginLeft: 4, padding: '1px 4px' }}>
            <b>{speed}</b>
          </span>
        )
      )}
      {width >= 14 && <i className="edge start" data-edge="start" />}
      {width >= 14 && <i className="edge end" data-edge="end" />}
    </button>
  );
}

/** A canvas over the visible part of a lane, one bar per two pixels (0–1 each). */
function ColumnsCanvas(props: {
  className?: string;
  top: number;
  height: number;
  view: { left: number; width: number };
  pps: number;
  color: string;
  mirrored?: boolean;
  columns: (from: number, to: number, count: number) => number[];
  deps: unknown[];
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { top: y, height, view, pps, color, mirrored } = props;
  useEffect(() => {
    const element = canvas.current;
    if (!element || !(pps > 0)) return;
    const ratio = window.devicePixelRatio || 1;
    const columns = Math.max(1, Math.floor(view.width / 2));
    element.width = Math.max(1, Math.round(view.width * ratio));
    element.height = Math.round(height * ratio);
    const context = element.getContext('2d')!;
    context.clearRect(0, 0, element.width, element.height);
    context.fillStyle = color;
    const values = props.columns(view.left / pps, (view.left + view.width) / pps, columns);
    const columnWidth = element.width / columns;
    const middle = element.height / 2;
    values.forEach((value, i) => {
      if (value <= 0) return;
      const bar = Math.max(1, value * (mirrored ? element.height - 4 * ratio : element.height - 2 * ratio));
      context.fillRect(i * columnWidth, mirrored ? middle - bar / 2 : element.height - bar, Math.max(1, columnWidth - ratio), bar);
    });
  }, [view.left, view.width, pps, height, color, ...props.deps]);
  return <canvas ref={canvas} className={`tl-canvas${props.className ? ` ${props.className}` : ''}`} style={{ top: y, left: view.left, width: view.width, height }} />;
}
