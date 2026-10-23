// The source view: while the Zoom or Mask tool is on, or a zoom or mask is selected, the stage shows
// the screen frame at the playhead itself (not the composed video), with every zoom and mask there
// outlined and the selected one with handles. Drag on the frame to draw a new one, drag a box to move
// it, its handles to resize it (a zoom keeps the screen's shape: what is drawn is what it shows).
// Esc goes back to the video.
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Rect } from '@cuttle/project';
import type { Command } from '../../shared/document';
import { formatSource } from '../../shared/format';
import { maskRectAt, zoomTargetAt } from '@cuttle/timeline';
import { adjustRect, drawnRect, fitInside, movePath, toSource, toStage, type Fit, type Handle } from '../../shared/edit';
import { addAnnotation, addMask, addZoom, cropClip, overlayBlocked, playheadPlace } from './actions';
import { edit, preview } from './doc';
import { beginGesture, cancelGesture } from './gesture';
import { FrameGrabber } from './frames';
import { currentPlayer, select, setTool, shownProject, sourceViewShown, store } from './session';
import { useStore } from './store';

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
/** Room above the frame for the chip and "Back to the video", so they never cover the screen (a secret at its top). */
const BAND = 52;
/** Room around the frame, so the handles of an area at the screen's edge stay whole and easy to hit. */
const MARGIN = 14;
/** Smaller drags are clicks, not new boxes. */
const MIN_DRAW = 12;

interface Box {
  kind: 'zoom' | 'mask' | 'crop' | 'annotation';
  id: string;
  rect: Rect;
  /** It shows at the playhead's source second (others are drawn faint). */
  here: boolean;
}

export function SourceView() {
  const tool = useStore(store, (state) => state.tool);
  const selection = useStore(store, (state) => state.selection);
  const t = useStore(store, (state) => state.player.t);
  useStore(store, (state) => state.doc?.preview ?? state.doc?.project);
  const media = useStore(store, (state) => state.media);
  // While playing, the video shows (the zooms and masks at work); paused, the source view again.
  const active = useStore(store, sourceViewShown);
  const area = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [drawing, setDrawing] = useState<Rect>();
  // an arrow being drawn: from where the drag started to the pointer (source px)
  const [drawingArrow, setDrawingArrow] = useState<[number, number, number, number]>();
  const annotationKind = useStore(store, (state) => state.annotationKind);
  const grabber = useRef<{ grabber: FrameGrabber; source: unknown }>(undefined);

  // a drag under way ends with the view (Esc, playing)
  useEffect(() => {
    if (!active) cancelGesture('source');
  }, [active]);

  useLayoutEffect(() => {
    const element = area.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [active]);

  const project = active ? shownProject() : undefined;
  const place = active ? playheadPlace(t) : undefined;
  const source = place?.source;
  const screen = media?.screen.size ?? { width: 1920, height: 1080 };
  const inner = fitInside({ width: Math.max(1, size.width - 2 * MARGIN), height: Math.max(1, size.height - BAND - MARGIN) }, screen);
  const fit: Fit = { x: inner.x + MARGIN, y: inner.y + BAND, scale: inner.scale };
  // A selected zoom or mask the playhead is not on shows on the frame where it starts.
  const item =
    selection?.kind === 'zoom'
      ? project?.zooms.find((zoom) => zoom.id === selection.id)
      : selection?.kind === 'mask'
        ? project?.masks.find((mask) => mask.id === selection.id)
        : selection?.kind === 'annotation'
          ? project?.annotations.find((annotation) => annotation.id === selection.id)
          : undefined;
  // The clip the crop is about: a selected crop's, with the Crop tool the selected clip, else the one
  // at the playhead. Its frames show: the playhead's when it is on the clip, else the clip's first.
  const cropSelected = selection?.kind === 'crop' || (tool === 'crop' && selection?.kind === 'scene');
  const cropTarget = cropSelected ? project?.scenes.find((scene) => scene.id === selection!.id) : tool === 'crop' ? place?.clip : undefined;
  const croppedClip = cropTarget?.type === 'clip' ? cropTarget : undefined;
  const cropRange = croppedClip ? [croppedClip.from, croppedClip.to] : undefined;
  const range = item ? ('at' in item ? [item.at, item.at + item.duration] : [item.from, item.to]) : cropRange;
  const frameAt = range && (source === undefined || source < range[0]! || source >= range[1]!) ? range[0] : source;

  // The screen frame at that source second, decoded on its own (the player's frames are the video's).
  useEffect(() => {
    if (!active || frameAt === undefined || size.width === 0) return;
    const player = currentPlayer();
    if (!player) return;
    const video = player.screenSource;
    if (grabber.current?.source !== video) grabber.current = { grabber: new FrameGrabber(video), source: video };
    let cancelled = false;
    void grabber.current.grabber.grab(frameAt).then(
      (held) => {
        if (!held) return;
        try {
          const element = canvas.current;
          if (cancelled || !element) return;
          const ratio = window.devicePixelRatio || 1;
          element.width = Math.round(size.width * ratio);
          element.height = Math.round(size.height * ratio);
          const context = element.getContext('2d')!;
          context.fillStyle = '#08080a';
          context.fillRect(0, 0, element.width, element.height);
          context.drawImage(held.frame, fit.x * ratio, fit.y * ratio, screen.width * fit.scale * ratio, screen.height * fit.scale * ratio);
        } finally {
          held.close();
        }
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [active, frameAt, size.width, size.height, screen.width, screen.height]);

  if (!active || !project) return null;
  // a zoom that follows shows where it is at that second
  const speed = place?.span.scene.type === 'clip' ? place.span.scene.speed : 1;
  const zoomAt = (zoom: (typeof project.zooms)[number]): Rect => (frameAt === undefined ? zoom.rect : (zoomTargetAt(zoom, frameAt, speed).map((value) => Math.round(value)) as Rect));
  const boxes: Box[] = [
    ...project.zooms.map((zoom) => ({ kind: 'zoom' as const, id: zoom.id!, rect: zoomAt(zoom), here: frameAt !== undefined && frameAt >= zoom.at && frameAt < zoom.at + zoom.duration })),
    // a mask that follows covers, at that second, where it is (between two places both)
    ...project.masks.map((mask) => ({ kind: 'mask' as const, id: mask.id!, rect: frameAt === undefined ? mask.rect : maskRectAt(mask, frameAt), here: frameAt !== undefined && frameAt >= mask.from && frameAt < mask.to })),
    // an annotation with an area (an arrow is a line of its own, below)
    ...project.annotations.flatMap((annotation) =>
      annotation.rect ? [{ kind: 'annotation' as const, id: annotation.id!, rect: annotation.rect, here: frameAt !== undefined && frameAt >= annotation.at && frameAt < annotation.at + annotation.duration }] : [],
    ),
  ].filter((box) => box.here || (selection?.kind === box.kind && selection.id === box.id));
  const arrows = project.annotations.filter(
    (annotation) =>
      annotation.kind === 'arrow' &&
      annotation.from &&
      annotation.to &&
      ((frameAt !== undefined && frameAt >= annotation.at && frameAt < annotation.at + annotation.duration) || (selection?.kind === 'annotation' && selection.id === annotation.id)),
  );
  // that clip's crop, while cropping or selected
  if (croppedClip?.crop && croppedClip.id) boxes.push({ kind: 'crop', id: croppedClip.id, rect: croppedClip.crop.rect, here: true });
  const selected = boxes.find((box) => selection?.kind === box.kind && selection.id === box.id);
  const aspect = screen.width / screen.height;
  /**
   * Follows a drag from a press: `onMove` with the source-pixel offset, `onEnd` when released. It
   * listens on the window (the box is drawn anew as it moves) and keeps the view's place from the
   * press; Esc, playing or the view going away cancel it (`gesture.ts`): no edit, no preview.
   */
  const follow = (event: ReactPointerEvent<HTMLElement>, onMove: (dx: number, dy: number, at: { x: number; y: number }) => void, onEnd: (moved: boolean) => void) => {
    event.stopPropagation();
    const target = event.currentTarget;
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // a synthetic pointer (the check) has nothing to capture
    }
    const bounds = area.current!.getBoundingClientRect();
    const local = (point: { clientX: number; clientY: number }) => toSource({ x: point.clientX - bounds.left, y: point.clientY - bounds.top }, fit);
    const start = local(event);
    let moved = false;
    const move = (next: PointerEvent) => {
      const at = local(next);
      if (!moved && Math.hypot(at.x - start.x, at.y - start.y) * fit.scale < 3) return;
      moved = true;
      onMove(at.x - start.x, at.y - start.y, at);
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    const ended = beginGesture('source', () => {
      stop();
      setDrawing(undefined);
      preview(undefined);
    });
    const up = () => {
      stop();
      ended();
      onEnd(moved);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return start;
  };

  /** A press on a box or one of its handles: select it; drag to move or resize. */
  const pressBox = (event: ReactPointerEvent<HTMLElement>, box: Box) => {
    if (event.button !== 0) return;
    const handle = ((event.target as HTMLElement).dataset.handle as Handle | undefined) ?? 'move';
    select({ kind: box.kind, id: box.id });
    const list = box.kind === 'zoom' ? 'zooms' : box.kind === 'mask' ? 'masks' : box.kind === 'annotation' ? 'annotations' : 'scenes';
    const clip = box.kind === 'crop' ? project.scenes.find((scene) => scene.id === box.id) : undefined;
    const path = box.kind === 'zoom' ? project.zooms.find((zoom) => zoom.id === box.id) : box.kind === 'mask' ? project.masks.find((mask) => mask.id === box.id) : undefined;
    let commands: Command[] | undefined;
    follow(
      event,
      (dx, dy) => {
        const rect = adjustRect(box.rect, handle, dx, dy, screen, box.kind === 'zoom' ? aspect : undefined).map((value) => Math.round(value));
        // a crop moved by hand is the person's: a new crop object, without the automatic tag; a zoom
        // or mask that follows takes its whole path along
        const fields =
          box.kind === 'crop' && clip?.type === 'clip'
            ? { crop: { rect, ...(clip.crop?.enabled === false && { enabled: false }) } }
            : path?.moves?.length
              ? movePath(path, box.rect, rect as Rect)
              : { rect };
        commands = [{ type: 'set', list, id: box.id, fields }];
        preview(commands);
      },
      (moved) => {
        if (!moved || !commands) return preview(undefined);
        edit(commands, handle === 'move' ? `Move the ${box.kind} area` : `Resize the ${box.kind} area`);
      },
    );
  };

  /** A press on an arrow: on its line it moves, on an end that end moves. */
  const pressArrow = (event: ReactPointerEvent<HTMLElement | SVGElement>, id: string, from: readonly number[], to: readonly number[]) => {
    if (event.button !== 0) return;
    const end = (event.target as Element).getAttribute('data-end') as 'from' | 'to' | null;
    select({ kind: 'annotation', id });
    let commands: Command[] | undefined;
    const clampPoint = (x: number, y: number) => [Math.round(Math.min(Math.max(x, 0), screen.width)), Math.round(Math.min(Math.max(y, 0), screen.height))];
    follow(
      event as ReactPointerEvent<HTMLElement>,
      (dx, dy) => {
        const fields =
          end === 'from'
            ? { from: clampPoint(from[0]! + dx, from[1]! + dy) }
            : end === 'to'
              ? { to: clampPoint(to[0]! + dx, to[1]! + dy) }
              : { from: clampPoint(from[0]! + dx, from[1]! + dy), to: clampPoint(to[0]! + dx, to[1]! + dy) };
        commands = [{ type: 'set', list: 'annotations', id, fields }];
        preview(commands);
      },
      (moved) => {
        if (!moved || !commands) return preview(undefined);
        edit(commands, end ? 'Move the end of the arrow' : 'Move the arrow');
      },
    );
  };

  /** A press on the frame: with the Zoom, Mask, Crop or Annotate tool, draw a new one there. */
  const pressFrame = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if (tool === 'annotate' && annotationKind === 'arrow') {
      // an arrow: from where the drag starts to where it ends
      let line: [number, number, number, number] | undefined;
      const begin = follow(
        event,
        (_dx, _dy, at) => {
          line = [begin.x, begin.y, Math.min(Math.max(at.x, 0), screen.width), Math.min(Math.max(at.y, 0), screen.height)];
          setDrawingArrow(line);
        },
        (moved) => {
          setDrawingArrow(undefined);
          if (!moved || !line || Math.hypot(line[2] - line[0], line[3] - line[1]) * fit.scale < MIN_DRAW) return;
          addAnnotation({ from: [Math.round(line[0]), Math.round(line[1])], to: [Math.round(line[2]), Math.round(line[3])] });
        },
      );
      return;
    }
    const kind = tool === 'zoom' || tool === 'mask' || tool === 'crop' || tool === 'annotate' ? tool : undefined;
    if (!kind) {
      select(undefined);
      return;
    }
    let rect: Rect | undefined;
    const start = follow(
      event,
      (_dx, _dy, at) => {
        rect = drawnRect(start, at, screen, kind === 'zoom' ? aspect : undefined);
        setDrawing(rect);
      },
      (moved) => {
        setDrawing(undefined);
        if (!moved || !rect || rect[2] * fit.scale < MIN_DRAW || rect[3] * fit.scale < MIN_DRAW) return;
        const whole = rect.map((value) => Math.round(value));
        if (kind === 'zoom') addZoom(whole);
        else if (kind === 'crop') cropClip(whole, croppedClip?.id);
        else if (kind === 'annotate') addAnnotation({ rect: whole });
        else addMask(whole);
      },
    );
  };

  const blocked = overlayBlocked(t);
  return (
    <div className="source-view" ref={area} onPointerDown={pressFrame} data-testid="source-view">
      <canvas ref={canvas} style={{ width: size.width, height: size.height }} />
      {(selected?.kind === 'zoom' || selected?.kind === 'crop') && <ZoomDim fit={fit} rect={selected.rect} size={size} />}
      {selected?.kind === 'zoom' && <ZoomPath fit={fit} zoom={project.zooms.find((zoom) => zoom.id === selected.id)} />}
      {selected?.kind === 'mask' && <ZoomPath fit={fit} mask={project.masks.find((mask) => mask.id === selected.id)} />}
      {!selected && tool === 'crop' && boxes.some((box) => box.kind === 'crop') && <ZoomDim fit={fit} rect={boxes.find((box) => box.kind === 'crop')!.rect} size={size} />}
      {boxes.map((box) => {
        const at = toStage(box.rect, fit);
        const isSelected = box === selected;
        return (
          <div
            key={`${box.kind}-${box.id}`}
            className={`source-box ${box.kind}${isSelected ? ' selected' : ''}${box.here ? '' : ' elsewhere'}`}
            style={{ left: at.x, top: at.y, width: at.width, height: at.height }}
            onPointerDown={(event) => pressBox(event, box)}
            data-id={box.id}
            title={box.here ? `${box.kind === 'zoom' ? 'Zoom' : box.kind === 'mask' ? 'Mask' : 'Crop: what the clip shows'}: drag to move, handles to resize` : `This ${box.kind} is not shown at the playhead`}
          >
            {isSelected && HANDLES.map((handle) => <i key={handle} className={`box-handle ${handle}`} data-handle={handle} />)}
          </div>
        );
      })}
      {(arrows.length > 0 || drawingArrow) && (
        <svg className="source-arrows" data-testid="source-arrows">
          {arrows.map((arrow) => {
            const [x1, y1] = stagePoint(arrow.from!, fit);
            const [x2, y2] = stagePoint(arrow.to!, fit);
            const isSelected = selection?.kind === 'annotation' && selection.id === arrow.id;
            return (
              <g key={arrow.id} className={`source-arrow${isSelected ? ' selected' : ''}`} onPointerDown={(event) => pressArrow(event, arrow.id!, arrow.from!, arrow.to!)} data-id={arrow.id}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} className="hit" />
                <line x1={x1} y1={y1} x2={x2} y2={y2} />
                {isSelected && (
                  <>
                    <circle cx={x1} cy={y1} r={6} data-end="from" />
                    <circle cx={x2} cy={y2} r={6} data-end="to" />
                  </>
                )}
              </g>
            );
          })}
          {drawingArrow && (
            <g className="source-arrow drawing">
              <line x1={stagePoint([drawingArrow[0], drawingArrow[1]], fit)[0]} y1={stagePoint([drawingArrow[0], drawingArrow[1]], fit)[1]} x2={stagePoint([drawingArrow[2], drawingArrow[3]], fit)[0]} y2={stagePoint([drawingArrow[2], drawingArrow[3]], fit)[1]} />
            </g>
          )}
        </svg>
      )}
      {drawing && (tool === 'zoom' || tool === 'crop') && <ZoomDim fit={fit} rect={drawing} size={size} />}
      {drawing && (
        <div
          className={`source-box ${tool === 'annotate' ? 'annotation' : tool} drawing`}
          style={(() => {
            const at = toStage(drawing, fit);
            return { left: at.x, top: at.y, width: at.width, height: at.height };
          })()}
        >
          {/* how close the zoom brings it: the screen's width over the area's */}
          {tool === 'zoom' && <span className="zoom-factor">{(screen.width / Math.max(1, drawing[2])).toFixed(1)}×</span>}
        </div>
      )}
      <div className="source-chip" role="status" data-testid="source-chip">
        <b>Source view</b>
        {frameAt === undefined
          ? ' · move the playhead onto a clip to see the screen'
          : frameAt !== source
            ? ` · the frame at ${formatSource(frameAt)}, where this ${selection?.kind} starts`
            : tool === 'annotate'
              ? blocked
                ? ` · ${blocked}`
                : annotationKind === 'arrow'
                  ? ' · drag from where the arrow starts to what it points at'
                  : ` · drag over what the ${annotationKind} marks`
              : tool === 'crop'
                ? !croppedClip
                  ? ' · select a clip, or move the playhead onto one, to crop it'
                  : boxes.some((box) => box.kind === 'crop')
                    ? ' · drag the crop to move it, its handles to resize it, elsewhere for a new one'
                    : ' · drag over the part of the screen this clip shows'
                : tool === 'zoom' || tool === 'mask'
                  ? blocked
                    ? ` · ${blocked}`
                    : selected
                      ? ` · drag the box to place it, elsewhere for a new ${tool}`
                      : ` · drag to draw a ${tool}`
                  : (selected?.kind === 'zoom' ? project.zooms : selected?.kind === 'mask' ? project.masks : []).find((item) => item.id === selected?.id)?.moves?.length
                    ? ' · it follows the dashed path: drag the box to move all of it, its handles to resize it'
                    : ' · drag the box to move it, its handles to resize it'}
        <span className="sep" />
        <kbd>Esc</kbd> for the video
      </div>
      <button
        type="button"
        className="source-close"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => {
          setTool('select');
          if (selection?.kind === 'zoom' || selection?.kind === 'mask' || selection?.kind === 'crop' || selection?.kind === 'annotation') select(undefined);
        }}
      >
        Back to the video
      </button>
    </div>
  );
}

/** A place where a zoom or mask that follows stays this long (seconds) is one it rests at. */
const REST = 0.25;

type Following = { rect: Rect; moves?: { at: number; rect: Rect }[] };

/**
 * A selected zoom or mask that follows: the way through its places, and dashed, the rects where it
 * rests (its first and last place, and where it stays `REST` or longer). A privacy mask has a place
 * in each frame its text moved: those are on the way only.
 */
function ZoomPath({ fit, zoom, mask }: { fit: Fit; zoom?: Following & { at: number; duration: number }; mask?: Following & { from: number; to: number } }) {
  const item = zoom ?? mask;
  if (!item?.moves?.length) return null;
  const kind = zoom ? 'zoom' : 'mask';
  const [from, to] = zoom ? [zoom.at, zoom.at + zoom.duration] : [mask!.from, mask!.to];
  const places = [{ at: from, rect: item.rect }, ...item.moves];
  const rects = places.filter((place, i) => i === 0 || i === places.length - 1 || (places[i + 1]?.at ?? to) - place.at >= REST).map((place) => toStage(place.rect, fit));
  const middles = places.map((place) => toStage(place.rect, fit)).map((rect) => `${rect.x + rect.width / 2},${rect.y + rect.height / 2}`);
  return (
    <svg className={`zoom-path${kind === 'mask' ? ' mask' : ''}`} data-testid={`${kind}-path`}>
      {rects.map((rect, i) => (
        <rect key={i} x={rect.x} y={rect.y} width={rect.width} height={rect.height} />
      ))}
      <polyline points={middles.join(' ')} />
      {rects.map((rect, i) => (
        <circle key={i} cx={rect.x + rect.width / 2} cy={rect.y + rect.height / 2} r={3} />
      ))}
    </svg>
  );
}

/** Outside a selected zoom's area is dimmed: what stays bright is what the zoom shows. */
function ZoomDim({ fit, rect, size }: { fit: Fit; rect: Rect; size: { width: number; height: number } }) {
  const at = toStage(rect, fit);
  const hole = `polygon(evenodd, 0 0, ${size.width}px 0, ${size.width}px ${size.height}px, 0 ${size.height}px, 0 0, ${at.x}px ${at.y}px, ${at.x + at.width}px ${at.y}px, ${at.x + at.width}px ${at.y + at.height}px, ${at.x}px ${at.y + at.height}px, ${at.x}px ${at.y}px)`;
  return <div className="zoom-dim" style={{ clipPath: hole }} />;
}

/** A point in source px on the stage. */
function stagePoint(point: readonly number[], fit: Fit): [number, number] {
  const at = toStage([point[0]!, point[1]!, 0, 0], fit);
  return [at.x, at.y];
}
