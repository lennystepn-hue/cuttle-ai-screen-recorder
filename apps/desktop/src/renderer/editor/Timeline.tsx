// The timeline (view only in this version): markers, ruler, scenes with thumbnails, the overlay lanes
// (one block per stretch of output that shows an overlay, overlapping ones on separate rows), the
// mic's waveform and input activity. The playhead is dragged anywhere on the ruler and the lanes; a
// click without a drag selects a block. The wheel scrolls along the timeline, Shift+wheel up and
// down when the lanes are taller than the panel, Ctrl+wheel zooms around the pointer.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { MarkerKind } from '@cuttle/project';
import { formatTime } from '../../shared/format';
import { activityColumns, groupPins, pinGroupDetail, pinGroupName, timelineModel, waveformColumns, type OverlayKind, type Peaks, type SceneBlock, type TimelineModel } from '../../shared/timeline-model';
import { FitIcon } from '../icons';
import { audible } from './audio';
import { mediaUrl } from './media';
import { currentPlayer, select, shownProject, store, type Selection } from './session';
import { useStore } from './store';

const END_SPACE = 40;
/** A row of an overlay lane (lanes grow a row for overlays that overlap in time). */
const ROW = 22;
const BASE_ROWS = { markers: 26, ruler: 20, video: 52, mic: 30, input: 26 } as const;
const LANES: { kind: OverlayKind; name: string }[] = [
  { kind: 'zoom', name: 'Zoom' },
  { kind: 'mask', name: 'Mask' },
  { kind: 'caption', name: 'Caption' },
];
const TICKS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
const MAX_PPS = 400;
/** A pointer that moves less than this between down and up clicked (selects); more scrubs. */
const DRAG_PX = 3;
/** Labels hide on blocks narrower than this. */
const LABEL_MIN_PX = 48;

const MARKER_DOT: Record<MarkerKind, string> = { prompt: '#ececf1', tool: '#7a7a85', answer: '#4fd1a1', manual: '#9a9aa5' };

interface Layout {
  heights: Record<'markers' | 'ruler' | 'video' | OverlayKind | 'mic' | 'input', number>;
  tops: Record<'markers' | 'ruler' | 'video' | OverlayKind | 'mic' | 'input', number>;
  total: number;
}

function layoutOf(model: TimelineModel | undefined): Layout {
  const heights = {
    ...BASE_ROWS,
    zoom: 8 + ROW * (model?.lanes.zoom.rows ?? 1),
    mask: 8 + ROW * (model?.lanes.mask.rows ?? 1),
    caption: 8 + ROW * (model?.lanes.caption.rows ?? 1),
  };
  const order = ['markers', 'ruler', 'video', 'zoom', 'mask', 'caption', 'mic', 'input'] as const;
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

export function Timeline() {
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const media = useStore(store, (state) => state.media);
  const format = useStore(store, (state) => state.format);
  const pps = useStore(store, (state) => state.pxPerSecond);
  const selection = useStore(store, (state) => state.selection);
  const peaksState = useStore(store, (state) => state.mediaState.peaks.state);
  const peaksPath = useStore(store, (state) => state.mediaState.peaks.path);
  const peaksRate = useStore(store, (state) => state.mediaState.peaks.rate);
  const [view, setView] = useState({ left: 0, width: 800 });
  const [peaks, setPeaks] = useState<Peaks>();

  const player = currentPlayer();
  const project = shownProject();
  const spans = player?.spans ?? [];
  const duration = player?.duration ?? 0;
  const model = useMemo(() => (project ? timelineModel(project, spans, media?.markers) : undefined), [project, spans, media, format]);
  const layout = useMemo(() => layoutOf(model), [model]);

  const fit = useCallback(() => {
    const element = scroller.current;
    if (!element || !(duration > 0)) return;
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
    const observer = new ResizeObserver(update);
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
        const length = currentPlayer()?.duration ?? 0;
        const fitPps = length > 0 ? (element.clientWidth - END_SPACE - 8) / length : current;
        const box = element.getBoundingClientRect();
        const anchorX = event.clientX - box.left;
        const anchorT = (element.scrollLeft + anchorX) / current;
        const next = Math.min(MAX_PPS, Math.max(fitPps, current * Math.exp(-event.deltaY * 0.002)));
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

  /**
   * Scrubs from a pointerdown: the playhead follows the pointer (from the press when `seekAtDown`, else
   * from the first move). A press that does not move calls `onClick`: a block selects itself, the
   * empty timeline clears the selection.
   */
  const scrub = (event: ReactPointerEvent<HTMLElement>, onClick?: () => void, seekAtDown = !onClick) => {
    if (event.button !== 0 || !player) return;
    event.stopPropagation();
    const target = event.currentTarget;
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // a synthetic pointer (the check) has nothing to capture
    }
    const startX = event.clientX;
    let dragging = false;
    if (seekAtDown) void player.seek(timeAt(startX));
    const move = (moved: PointerEvent) => {
      if (!dragging && Math.abs(moved.clientX - startX) < DRAG_PX) return;
      dragging = true;
      void player.seek(timeAt(moved.clientX));
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      if (!dragging) onClick?.();
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  const width = duration * pps;
  const fitPps = scroller.current && duration > 0 ? (scroller.current.clientWidth - END_SPACE - 8) / duration : pps;
  const zoomValue = pps > 0 && fitPps > 0 ? Math.log(pps / fitPps) / Math.log(Math.max(1.0001, MAX_PPS / fitPps)) : 0;
  const { heights, tops } = layout;

  return (
    <section className="timeline" aria-label="Timeline">
      <div className="tl-bar">
        <span className="tl-status">{model ? `${model.scenes.length} scene${model.scenes.length === 1 ? '' : 's'} · ${formatTime(duration)}` : ''}</span>
        <div className="grow" />
        <button className="act" onClick={fit} title="Fit the whole video (Shift+Z)">
          <FitIcon size={14} />
          Fit
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={Math.max(0, Math.min(1, zoomValue))}
          aria-label="Timeline scale"
          title="Timeline scale (Ctrl + wheel)"
          onChange={(event) => {
            const element = scroller.current;
            if (!element || !(fitPps > 0)) return;
            const next = fitPps * Math.pow(MAX_PPS / fitPps, Number(event.target.value));
            const anchor = currentPlayer()?.current().t ?? 0;
            store.set({ pxPerSecond: next });
            requestAnimationFrame(() => (element.scrollLeft = Math.max(0, anchor * next - element.clientWidth / 2)));
          }}
        />
      </div>
      <div className="tl-body" ref={body}>
        <div className="tl-names" aria-hidden="true" style={{ height: layout.total }}>
          <div style={{ height: heights.markers }} />
          <div style={{ height: heights.ruler }} />
          <div style={{ height: heights.video }}>Video</div>
          {LANES.map((lane) => (
            <div key={lane.kind} style={{ height: heights[lane.kind] }} className="lane-name">
              {lane.name}
              {(model?.lanes[lane.kind].cutOut ?? 0) > 0 && <small title="No clip shows these; they are not in the video">{model!.lanes[lane.kind].cutOut} cut out</small>}
            </div>
          ))}
          <div style={{ height: heights.mic }}>Mic</div>
          <div style={{ height: heights.input }}>Input</div>
        </div>
        <div className="tl-scroll" ref={scroller} data-testid="timeline">
          <div
            className="tl-content"
            style={{ width: width + END_SPACE, height: layout.total }}
            onPointerDown={(event) => scrub(event, () => select(undefined), true)}
          >
            {model && pps > 0 && (
              <>
                <Markers model={model} pps={pps} />
                <Ruler duration={duration} pps={pps} view={view} top={tops.ruler} />
                <div className="tl-row" style={{ position: 'absolute', top: tops.video, height: heights.video, left: 0, right: 0 }}>
                  {model.scenes.map((scene) => (
                    <Scene
                      key={scene.index}
                      scene={scene}
                      pps={pps}
                      view={view}
                      selected={selection?.kind === 'scene' && selection.index === scene.index}
                      onPointerDown={(event) => scrub(event, () => select({ kind: 'scene', index: scene.index }))}
                    />
                  ))}
                </div>
                {LANES.map((lane) => (
                  <div key={lane.kind} className="tl-row" style={{ position: 'absolute', top: tops[lane.kind], height: heights[lane.kind], left: 0, right: 0 }}>
                    {model.lanes[lane.kind].blocks.map((block, i) => {
                      const blockLeft = block.start * pps;
                      const blockWidth = Math.max(6, (block.end - block.start) * pps);
                      const inset = Math.max(0, Math.min(view.left - blockLeft, blockWidth - LABEL_MIN_PX));
                      return (
                        <button
                          key={`${block.item}-${i}`}
                          className={`item ${lane.kind}${block.enabled ? '' : ' off'}${isSelected(selection, lane.kind, block.item) ? ' selected' : ''}`}
                          style={{ left: blockLeft, width: blockWidth, top: 4 + block.row * ROW }}
                          title={`${block.title}${block.enabled ? '' : ' (off: not in the video)'}`}
                          onPointerDown={(event) => scrub(event, () => select({ kind: lane.kind, index: block.item, start: block.start, end: block.end }))}
                          onKeyDown={(event) => event.key === 'Enter' && select({ kind: lane.kind, index: block.item, start: block.start, end: block.end })}
                        >
                          {blockWidth >= LABEL_MIN_PX && <span style={{ marginLeft: inset }}>{block.title}</span>}
                        </button>
                      );
                    })}
                  </div>
                ))}
                {project && (
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
                )}
                <ColumnsCanvas
                  top={tops.input}
                  height={heights.input}
                  view={view}
                  color={BARS}
                  columns={(from, to, count) => activityColumns(media?.events ?? [], spans, from, to, count)}
                  pps={pps}
                  deps={[media, spans]}
                />
                <Playhead pps={pps} top={heights.markers - 8} scroller={scroller} />
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

const isSelected = (selection: Selection | undefined, kind: Selection['kind'], index: number) => selection?.kind === kind && selection.index === index;

/** The playhead: the only part that changes on every frame. Keeps itself in view after any seek. */
function Playhead({ pps, top, scroller }: { pps: number; top: number; scroller: React.RefObject<HTMLDivElement | null> }) {
  const t = useStore(store, (state) => state.player.t);
  const playing = useStore(store, (state) => state.player.playing);
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const x = t * pps;
    if (x < element.scrollLeft + (playing ? 0 : 40) || x > element.scrollLeft + element.clientWidth - 40) element.scrollLeft = Math.max(0, x - element.clientWidth / 3);
  }, [t, pps, playing, scroller]);
  return <div className="playhead" style={{ left: t * pps, top }} />;
}

const Markers = memo(function Markers({ model, pps }: { model: TimelineModel; pps: number }) {
  const groups = groupPins(model.markers, 70 / pps);
  return (
    <div className="tl-row" style={{ position: 'absolute', top: 0, height: BASE_ROWS.markers, left: 0, right: 0 }}>
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

function Scene(props: { scene: SceneBlock; pps: number; view: { left: number; width: number }; selected: boolean; onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void }) {
  const { scene, pps, view, selected, onPointerDown } = props;
  const thumbState = useStore(store, (state) => state.mediaState.thumbnails.state);
  const thumbPath = useStore(store, (state) => state.mediaState.thumbnails.path);
  const interval = useStore(store, (state) => state.mediaState.thumbnails.interval);
  const thumbWidth = useStore(store, (state) => state.mediaState.thumbnails.width ?? 160);
  const thumbHeight = useStore(store, (state) => state.mediaState.thumbnails.height ?? 90);
  const count = useStore(store, (state) => state.mediaState.thumbnails.count ?? 1);
  const columns = useStore(store, (state) => state.mediaState.thumbnails.columns ?? 1);
  const screenStart = useStore(store, (state) => state.media?.screen.start ?? 0);
  const project = shownProject();
  const left = scene.start * pps;
  const width = (scene.end - scene.start) * pps;
  const clip = project?.scenes[scene.index];
  const tileHeight = BASE_ROWS.video - 10;
  const tiles: { x: number; index: number }[] = [];
  const ready = thumbState === 'ready' && thumbPath !== undefined && interval !== undefined;
  const tileWidth = Math.round((tileHeight * thumbWidth) / thumbHeight);
  if (ready && clip?.type === 'clip' && width > 0) {
    const from = Math.max(0, Math.floor((view.left - left) / tileWidth));
    const to = Math.min(Math.ceil(width / tileWidth), Math.ceil((view.left + view.width - left) / tileWidth) + 1);
    for (let i = from; i < to; i++) {
      const outT = scene.start + ((i + 0.5) * tileWidth) / pps;
      // The thumbnails count from the take's first frame.
      const source = clip.from + (outT - scene.start) * clip.speed - screenStart;
      tiles.push({ x: i * tileWidth, index: Math.min(count - 1, Math.max(0, Math.floor(source / interval!))) });
    }
  }
  const kindClass = scene.kind === 'clip' ? '' : ` ${scene.kind}`;
  const speed = scene.speed !== undefined && scene.speed !== 1 ? `${Math.round(scene.speed * 10) / 10}×` : '';
  const name = [speed, scene.title].filter(Boolean).join(' ');
  const inset = Math.max(0, Math.min(view.left - left, width - LABEL_MIN_PX - 14));
  const scale = tileHeight / thumbHeight;
  return (
    <button
      className={`scene${kindClass}${selected ? ' selected' : ''}`}
      style={{ left, width: Math.max(4, width - 2) }}
      title={`${name} · ${scene.detail}`}
      onPointerDown={onPointerDown}
      onKeyDown={(event) => event.key === 'Enter' && select({ kind: 'scene', index: scene.index })}
    >
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
    </button>
  );
}

/** A canvas over the visible part of a lane, one bar per two pixels (0–1 each). */
function ColumnsCanvas(props: {
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
  return <canvas ref={canvas} className="tl-canvas" style={{ top: y, left: view.left, width: view.width, height }} />;
}
