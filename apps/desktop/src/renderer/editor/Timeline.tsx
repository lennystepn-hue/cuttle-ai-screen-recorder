// The timeline (read-only in this version): markers, ruler, scenes with thumbnails, the overlay lanes
// (one block per stretch of output that shows an overlay), the mic's waveform and input activity.
// The playhead is dragged on the ruler and the lanes.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { MarkerKind } from '@cuttle/project';
import { formatTime } from '../../shared/format';
import { activityColumns, groupPins, timelineModel, waveformColumns, type OverlayKind, type Peaks, type SceneBlock } from '../../shared/timeline-model';
import { FitIcon } from '../icons';
import { audible } from './audio';
import { mediaUrl } from './media';
import { currentPlayer, select, shownProject, store, type Selection } from './session';
import { useStore } from './store';

const NAME_WIDTH = 88;
const END_SPACE = 40;
const ROWS = { markers: 26, ruler: 20, video: 52, zoom: 34, mask: 34, caption: 34, mic: 30, input: 26 } as const;
const LANES: { kind: OverlayKind; name: string }[] = [
  { kind: 'zoom', name: 'Zoom' },
  { kind: 'mask', name: 'Mask' },
  { kind: 'caption', name: 'Caption' },
];
const TICKS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
const MAX_PPS = 400;

const top = (row: keyof typeof ROWS) => {
  let y = 0;
  for (const key of Object.keys(ROWS) as (keyof typeof ROWS)[]) {
    if (key === row) return y;
    y += ROWS[key];
  }
  return y;
};

const MARKER_DOT: Record<MarkerKind, string> = { prompt: '#ececf1', tool: '#62626c', answer: '#4fd1a1', manual: '#9a9aa5' };

export function Timeline() {
  const scroller = useRef<HTMLDivElement>(null);
  const media = useStore(store, (state) => state.media);
  const format = useStore(store, (state) => state.format);
  const t = useStore(store, (state) => state.player.t);
  const playing = useStore(store, (state) => state.player.playing);
  const pps = useStore(store, (state) => state.pxPerSecond);
  const selection = useStore(store, (state) => state.selection);
  const mediaState = useStore(store, (state) => state.mediaState);
  const [view, setView] = useState({ left: 0, width: 800 });
  const [peaks, setPeaks] = useState<Peaks>();

  const player = currentPlayer();
  const project = shownProject();
  const spans = player?.spans ?? [];
  const duration = player?.duration ?? 0;
  const model = useMemo(() => (project ? timelineModel(project, spans, media?.markers) : undefined), [project, spans, media, format]);

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
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', update);
    };
  }, []);

  // The mic's peaks, once the worker has made them.
  useEffect(() => {
    const ready = mediaState.peaks;
    if (ready.state !== 'ready' || !ready.path || !ready.rate || !media?.mic) return;
    let cancelled = false;
    void fetch(mediaUrl(ready.path))
      .then((response) => (response.ok ? response.arrayBuffer() : undefined))
      .then((buffer) => {
        if (!cancelled && buffer) setPeaks({ rate: ready.rate!, offset: media.mic!.offset, data: new Uint8Array(buffer) });
      });
    return () => {
      cancelled = true;
    };
  }, [mediaState.peaks, media]);

  // Keep the playhead in view while playing.
  useEffect(() => {
    const element = scroller.current;
    if (!element || !playing) return;
    const x = t * pps;
    if (x < element.scrollLeft || x > element.scrollLeft + element.clientWidth - 40) element.scrollLeft = Math.max(0, x - element.clientWidth / 3);
  }, [t, pps, playing]);

  const timeAt = (clientX: number) => {
    const element = scroller.current!;
    const box = element.getBoundingClientRect();
    return Math.max(0, Math.min(duration, (clientX - box.left + element.scrollLeft) / pps));
  };

  const scrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !player) return;
    const target = event.currentTarget;
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // a synthetic pointer (the check) has nothing to capture
    }
    void player.seek(timeAt(event.clientX));
    const move = (moved: PointerEvent) => void player.seek(timeAt(moved.clientX));
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  const width = duration * pps;
  const height = Object.values(ROWS).reduce((sum, rowHeight) => sum + rowHeight, 0);
  const fitPps = scroller.current && duration > 0 ? (scroller.current.clientWidth - END_SPACE - 8) / duration : pps;
  const zoomValue = pps > 0 && fitPps > 0 ? Math.log(pps / fitPps) / Math.log(Math.max(1.0001, MAX_PPS / fitPps)) : 0;

  const cutOut = (kind: OverlayKind) => model?.lanes[kind].cutOut ?? 0;
  return (
    <section className="timeline" aria-label="Timeline">
      <div className="tl-bar">
        <span className="tl-status">
          {model ? `${model.scenes.length} scene${model.scenes.length === 1 ? '' : 's'} · ${formatTime(duration)}` : ''}
        </span>
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
          onChange={(event) => {
            const element = scroller.current;
            if (!element || !(fitPps > 0)) return;
            const next = fitPps * Math.pow(MAX_PPS / fitPps, Number(event.target.value));
            const anchor = t;
            store.set({ pxPerSecond: next });
            requestAnimationFrame(() => (element.scrollLeft = Math.max(0, anchor * next - element.clientWidth / 2)));
          }}
        />
      </div>
      <div className="tl-body">
        <div className="tl-names" aria-hidden="true">
          <div style={{ height: ROWS.markers }} />
          <div style={{ height: ROWS.ruler }} />
          <div style={{ height: ROWS.video }}>Video</div>
          {LANES.map((lane) => (
            <div key={lane.kind} style={{ height: ROWS[lane.kind] }}>
              {lane.name}
              {cutOut(lane.kind) > 0 && <small title="Not shown by any clip">· {cutOut(lane.kind)} cut out</small>}
            </div>
          ))}
          <div style={{ height: ROWS.mic }}>Mic</div>
          <div style={{ height: ROWS.input }}>Input</div>
        </div>
        <div className="tl-scroll" ref={scroller} data-testid="timeline">
          <div className="tl-content" style={{ width: width + END_SPACE, height }} onPointerDown={scrub}>
            {model && pps > 0 && (
              <>
                <Markers model={model} pps={pps} />
                <Ruler duration={duration} pps={pps} view={view} />
                <div className="tl-row" style={{ position: 'absolute', top: top('video'), height: ROWS.video, left: 0, right: 0 }}>
                  {model.scenes.map((scene) => (
                    <Scene key={scene.index} scene={scene} pps={pps} view={view} selected={selection?.kind === 'scene' && selection.index === scene.index} />
                  ))}
                </div>
                {LANES.map((lane) => (
                  <div key={lane.kind} className="tl-row" style={{ position: 'absolute', top: top(lane.kind), height: ROWS[lane.kind], left: 0, right: 0 }}>
                    {model.lanes[lane.kind].blocks.map((block, i) => (
                      <button
                        key={`${block.item}-${i}`}
                        className={`item ${lane.kind}${block.enabled ? '' : ' off'}${isSelected(selection, lane.kind, block.item) ? ' selected' : ''}`}
                        style={{ left: block.start * pps, width: Math.max(6, (block.end - block.start) * pps) }}
                        title={`${block.title}${block.enabled ? '' : ' (off)'}`}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => select({ kind: lane.kind, index: block.item })}
                        onDoubleClick={() => void player?.seek(block.start)}
                      >
                        {block.title}
                      </button>
                    ))}
                  </div>
                ))}
                {project && (
                  <ColumnsCanvas
                    top={top('mic')}
                    height={ROWS.mic}
                    view={view}
                    color="#3b3b46"
                    columns={(from, to, count) => (peaks ? waveformColumns(peaks, spans, from, to, count, (speed) => !audible(project, speed)) : new Array<number>(count).fill(0))}
                    pps={pps}
                    mirrored
                    deps={[peaks, spans, project]}
                  />
                )}
                <ColumnsCanvas
                  top={top('input')}
                  height={ROWS.input}
                  view={view}
                  color="#34343e"
                  columns={(from, to, count) => activityColumns(media?.events ?? [], spans, from, to, count)}
                  pps={pps}
                  deps={[media, spans]}
                />
                <div className="playhead" style={{ left: t * pps, top: ROWS.markers }} />
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

const isSelected = (selection: Selection | undefined, kind: Selection['kind'], index: number) => selection?.kind === kind && selection.index === index;

function Markers({ model, pps }: { model: NonNullable<ReturnType<typeof timelineModel>>; pps: number }) {
  const groups = groupPins(model.markers, 70 / pps);
  return (
    <div className="tl-row" style={{ position: 'absolute', top: 0, height: ROWS.markers, left: 0, right: 0 }}>
      {groups.map((group, i) => {
        const first = group.pins[0]!;
        const name =
          group.kind === 'prompt' ? 'Prompt' : group.kind === 'answer' ? 'Answer' : group.kind === 'tool' ? (first.label ?? 'Tool') : (first.label ?? 'Marker');
        return (
          <span key={i} className="flag" style={{ left: group.t * pps }} title={group.pins.map((pin) => `${pin.label ?? pin.kind} at source ${pin.source.toFixed(1)} s`).join('\n')}>
            <i style={{ background: MARKER_DOT[group.kind] }} />
            {name}
            {group.pins.length > 1 ? ` ×${group.pins.length}` : ''}
          </span>
        );
      })}
    </div>
  );
}

function Ruler({ duration, pps, view }: { duration: number; pps: number; view: { left: number; width: number } }) {
  const step = TICKS.find((tick) => tick * pps >= 70) ?? TICKS.at(-1)!;
  const first = Math.max(0, Math.floor(view.left / pps / step) * step);
  const last = Math.min(duration, (view.left + view.width) / pps);
  const ticks: number[] = [];
  for (let tick = first; tick <= last + 1e-9; tick += step) ticks.push(Math.round(tick * 1000) / 1000);
  return (
    <div className="tl-row ruler" style={{ position: 'absolute', top: ROWS.markers, height: ROWS.ruler, left: 0, right: 0 }}>
      {ticks.map((tick) => (
        <span key={tick} style={{ left: tick * pps }}>
          {step < 1 ? tick.toFixed(1) : formatTime(tick).replace(/\.\d$/, '')}
        </span>
      ))}
    </div>
  );
}

function Scene({ scene, pps, view, selected }: { scene: SceneBlock; pps: number; view: { left: number; width: number }; selected: boolean }) {
  const thumbnails = useStore(store, (state) => state.mediaState.thumbnails);
  const project = shownProject();
  const left = scene.start * pps;
  const width = (scene.end - scene.start) * pps;
  const tiles: { x: number; index: number }[] = [];
  const clip = project?.scenes[scene.index];
  const tileHeight = ROWS.video - 10;
  const meta = thumbnails.state === 'ready' && thumbnails.path && thumbnails.interval ? thumbnails : undefined;
  if (meta && clip?.type === 'clip' && width > 0) {
    const tileWidth = Math.round((tileHeight * (meta.width ?? 160)) / (meta.height ?? 90));
    const from = Math.max(0, Math.floor((view.left - left) / tileWidth));
    const to = Math.min(Math.ceil(width / tileWidth), Math.ceil((view.left + view.width - left) / tileWidth) + 1);
    for (let i = from; i < to; i++) {
      const outT = scene.start + ((i + 0.5) * tileWidth) / pps;
      const source = clip.from + (outT - scene.start) * clip.speed;
      tiles.push({ x: i * tileWidth, index: Math.min((meta.count ?? 1) - 1, Math.max(0, Math.floor(source / meta.interval!))) });
    }
  }
  const kindClass = scene.kind === 'clip' ? '' : ` ${scene.kind}`;
  return (
    <button
      className={`scene${kindClass}${selected ? ' selected' : ''}`}
      style={{ left, width: Math.max(4, width - 2) }}
      title={`${scene.title} · ${scene.detail}`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={() => select({ kind: 'scene', index: scene.index })}
      onDoubleClick={() => void currentPlayer()?.seek(scene.start)}
    >
      {meta && tiles.length > 0 && (
        <span className="thumbs">
          {tiles.map((tile) => {
            const tileWidth = Math.round((tileHeight * (meta.width ?? 160)) / (meta.height ?? 90));
            const columns = meta.columns ?? 1;
            const scale = tileHeight / (meta.height ?? 90);
            return (
              <i
                key={tile.x}
                style={{
                  left: tile.x,
                  width: tileWidth,
                  backgroundImage: `url("${mediaUrl(meta.path!)}")`,
                  backgroundSize: `${columns * (meta.width ?? 160) * scale}px auto`,
                  backgroundPosition: `${-(tile.index % columns) * (meta.width ?? 160) * scale}px ${-Math.floor(tile.index / columns) * tileHeight}px`,
                }}
              />
            );
          })}
        </span>
      )}
      <span className="lbl">
        {scene.speed !== undefined && scene.speed !== 1 && <b>{Math.round(scene.speed * 10) / 10}× </b>}
        {scene.title} · {scene.detail}
      </span>
    </button>
  );
}

/** A canvas over the visible part of a lane, one bar per pixel column (0–1 each). */
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
