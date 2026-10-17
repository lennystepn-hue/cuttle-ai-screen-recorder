// The source view: while the Zoom or Mask tool is on, or a zoom or mask is selected, the stage shows
// the screen frame at the playhead itself (not the composed video), with every zoom and mask there
// outlined and the selected one with handles. Drag on the frame to draw a new one, drag a box to move
// it, its handles to resize it (a zoom keeps the screen's shape: what is drawn is what it shows).
// Esc goes back to the video.
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Rect } from '@cuttle/project';
import type { Command } from '../../shared/document';
import { formatSource } from '../../shared/format';
import { adjustRect, drawnRect, fitInside, toSource, toStage, type Fit, type Handle } from '../../shared/edit';
import { addMask, addZoom, overlayBlocked, playheadPlace } from './actions';
import { edit, preview } from './doc';
import { FrameGrabber } from './frames';
import { currentPlayer, select, setTool, shownProject, sourceViewShown, store } from './session';
import { useStore } from './store';

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
/** Smaller drags are clicks, not new boxes. */
const MIN_DRAW = 12;

interface Box {
  kind: 'zoom' | 'mask';
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
  const grabber = useRef<{ grabber: FrameGrabber; source: unknown }>(undefined);

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
  const source = active ? playheadPlace(t)?.source : undefined;
  const screen = media?.screen.size ?? { width: 1920, height: 1080 };
  const fit: Fit = fitInside(size.width > 0 ? size : { width: 1, height: 1 }, screen);
  // A selected zoom or mask the playhead is not on shows on the frame where it starts.
  const item = selection?.kind === 'zoom' ? project?.zooms.find((zoom) => zoom.id === selection.id) : selection?.kind === 'mask' ? project?.masks.find((mask) => mask.id === selection.id) : undefined;
  const range = item && ('at' in item ? [item.at, item.at + item.duration] : [item.from, item.to]);
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
  const boxes: Box[] = [
    ...project.zooms.map((zoom) => ({ kind: 'zoom' as const, id: zoom.id!, rect: zoom.rect, here: frameAt !== undefined && frameAt >= zoom.at && frameAt < zoom.at + zoom.duration })),
    ...project.masks.map((mask) => ({ kind: 'mask' as const, id: mask.id!, rect: mask.rect, here: frameAt !== undefined && frameAt >= mask.from && frameAt < mask.to })),
  ].filter((box) => box.here || (selection?.kind === box.kind && selection.id === box.id));
  const selected = boxes.find((box) => selection?.kind === box.kind && selection.id === box.id);
  const aspect = screen.width / screen.height;
  const local = (event: { clientX: number; clientY: number }) => {
    const bounds = area.current!.getBoundingClientRect();
    return toSource({ x: event.clientX - bounds.left, y: event.clientY - bounds.top }, fit);
  };

  /** Follows a drag from a press: `onMove` with the source-pixel offset, `onEnd` when released (on the window: the box is drawn anew as it moves). */
  const follow = (event: ReactPointerEvent<HTMLElement>, onMove: (dx: number, dy: number, at: { x: number; y: number }) => void, onEnd: (moved: boolean) => void) => {
    event.stopPropagation();
    const target = event.currentTarget;
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // a synthetic pointer (the check) has nothing to capture
    }
    const start = local(event);
    let moved = false;
    const move = (next: PointerEvent) => {
      const at = local(next);
      if (!moved && Math.hypot(at.x - start.x, at.y - start.y) * fit.scale < 3) return;
      moved = true;
      onMove(at.x - start.x, at.y - start.y, at);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
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
    const list = box.kind === 'zoom' ? 'zooms' : 'masks';
    let commands: Command[] | undefined;
    follow(
      event,
      (dx, dy) => {
        const rect = adjustRect(box.rect, handle, dx, dy, screen, box.kind === 'zoom' ? aspect : undefined);
        commands = [{ type: 'set', list, id: box.id, fields: { rect: rect.map((value) => Math.round(value)) } }];
        preview(commands);
      },
      (moved) => {
        if (!moved || !commands) return preview(undefined);
        edit(commands, handle === 'move' ? `Move the ${box.kind} area` : `Resize the ${box.kind} area`);
      },
    );
  };

  /** A press on the frame: with the Zoom or Mask tool, draw a new one there. */
  const pressFrame = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const kind = tool === 'zoom' || tool === 'mask' ? tool : undefined;
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
        else addMask(whole);
      },
    );
  };

  const blocked = overlayBlocked(t);
  return (
    <div className="source-view" ref={area} onPointerDown={pressFrame} data-testid="source-view">
      <canvas ref={canvas} style={{ width: size.width, height: size.height }} />
      {selected?.kind === 'zoom' && <ZoomDim fit={fit} rect={selected.rect} size={size} />}
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
            title={box.here ? `${box.kind === 'zoom' ? 'Zoom' : 'Mask'}: drag to move, handles to resize` : `This ${box.kind} is not shown at the playhead`}
          >
            {isSelected && HANDLES.map((handle) => <i key={handle} className={`box-handle ${handle}`} data-handle={handle} />)}
          </div>
        );
      })}
      {drawing && (
        <div className={`source-box ${tool} drawing`} style={(() => {
          const at = toStage(drawing, fit);
          return { left: at.x, top: at.y, width: at.width, height: at.height };
        })()} />
      )}
      <div className="source-chip" role="status" data-testid="source-chip">
        <b>Source view</b>
        {frameAt === undefined
          ? ' · move the playhead onto a clip to see the screen'
          : frameAt !== source
            ? ` · the frame at ${formatSource(frameAt)}, where this ${selection?.kind} starts`
            : tool === 'zoom' || tool === 'mask'
              ? blocked
                ? ` · ${blocked}`
                : ` · drag to draw a ${tool}`
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
          if (selection?.kind === 'zoom' || selection?.kind === 'mask') select(undefined);
        }}
      >
        Back to the video
      </button>
    </div>
  );
}

/** Outside a selected zoom's area is dimmed: what stays bright is what the zoom shows. */
function ZoomDim({ fit, rect, size }: { fit: Fit; rect: Rect; size: { width: number; height: number } }) {
  const at = toStage(rect, fit);
  const hole = `polygon(evenodd, 0 0, ${size.width}px 0, ${size.width}px ${size.height}px, 0 ${size.height}px, 0 0, ${at.x}px ${at.y}px, ${at.x + at.width}px ${at.y}px, ${at.x + at.width}px ${at.y + at.height}px, ${at.x}px ${at.y + at.height}px, ${at.x}px ${at.y}px)`;
  return <div className="zoom-dim" style={{ clipPath: hole }} />;
}
