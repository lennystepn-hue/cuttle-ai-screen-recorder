import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EXPORT_FORMATS, type ExportFormat } from '@cuttle/export/formats';
import { formatDuration, formatTime } from '../../shared/format';
import { ExportIcon, Mark, PauseIcon, PlayIcon, WarningIcon } from '../icons';
import { ExportSheet } from './ExportSheet';
import { Inspector } from './Inspector';
import { currentPlayer, openExport, openSession, setFormat, shownProject, store } from './session';
import { useStore } from './store';
import { Timeline } from './Timeline';

const FORMATS = Object.keys(EXPORT_FORMATS) as ExportFormat[];

export function App() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const phase = useStore(store, (state) => state.phase);
  const error = useStore(store, (state) => state.error);

  useEffect(() => {
    if (canvas.current) void openSession(canvas.current);
  }, []);
  useShortcuts();

  if (phase === 'failed') {
    return (
      <div className="center">
        <div>
          <WarningIcon size={28} style={{ margin: '0 auto', color: 'var(--card)' }} />
          <h1>This project cannot be opened</h1>
          <pre>{error}</pre>
        </div>
      </div>
    );
  }

  return (
    <div className="app" data-phase={phase}>
      <TitleBar />
      <Stage canvas={canvas} />
      <Inspector />
      <Timeline />
      <ExportSheet />
      {phase === 'loading' && (
        <div className="scrim" style={{ inset: 0, background: 'var(--bg)', placeItems: 'center', padding: 0 }}>
          <div className="spinner" aria-label="Opening the project" />
        </div>
      )}
    </div>
  );
}

function TitleBar() {
  const info = useStore(store, (state) => state.info);
  const media = useStore(store, (state) => state.media);
  const format = useStore(store, (state) => state.format);
  const proxy = useStore(store, (state) => state.mediaState.proxy);
  const duration = currentPlayer()?.duration ?? 0;
  const output = media?.project.output;
  const own = FORMATS.find((name) => output && EXPORT_FORMATS[name].width === output.width && EXPORT_FORMATS[name].height === output.height);
  const recorded = media ? media.screen.end - media.screen.start : 0;
  return (
    <header className="titlebar">
      <Mark />
      <div className="project-name">
        <b>{info?.name ?? 'Cuttle'}</b>
        {media && (
          <span>
            {formatDuration(recorded)} recorded · {formatDuration(duration)} video
          </span>
        )}
      </div>
      <div className="grow" />
      {proxy.state === 'working' && (
        <div className="chip-status" title="A smaller copy of the take for smooth playback; the export always uses the take">
          Preparing playback
          <span className="bar">
            <i style={{ width: `${Math.round((proxy.progress ?? 0) * 100)}%` }} />
          </span>
        </div>
      )}
      <div className="seg" role="group" aria-label="Preview format">
        {!own && output && (
          <button aria-pressed={format === undefined} onClick={() => setFormat(undefined)} title="The project's own output size">
            {output.width}×{output.height}
          </button>
        )}
        {FORMATS.map((name) => (
          <button key={name} aria-pressed={format === name || (format === undefined && own === name)} onClick={() => setFormat(name === own ? undefined : name)} title={`Preview in ${name}`}>
            {name}
          </button>
        ))}
      </div>
      <button className="primary" onClick={openExport} disabled={!media} title="Export (Ctrl+E)">
        <ExportIcon size={14} />
        Export
      </button>
    </header>
  );
}

function Stage({ canvas }: { canvas: React.RefObject<HTMLCanvasElement | null> }) {
  const viewport = useRef<HTMLDivElement>(null);
  const player = useStore(store, (state) => state.player);
  const media = useStore(store, (state) => state.media);
  const format = useStore(store, (state) => state.format);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const project = shownProject();
  const output = project?.output ?? { width: 1920, height: 1080 };

  // The canvas keeps the output's size (the engine draws at it); CSS fits it into the viewport.
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const fit = () => {
      const box = element.getBoundingClientRect();
      const scale = Math.min(box.width / output.width, box.height / output.height);
      setSize({ width: Math.floor(output.width * scale), height: Math.floor(output.height * scale) });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [output.width, output.height, format]);

  const duration = currentPlayer()?.duration ?? 0;
  const warning = player.error ?? media?.warnings[0];
  return (
    <main className="stage">
      {warning && (
        <div className={`stage-note${player.error ? ' warn' : ''}`} title={warning}>
          <WarningIcon size={14} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{warning}</span>
        </div>
      )}
      <div className="viewport" ref={viewport}>
        <canvas ref={canvas} data-testid="output" style={{ width: size.width || undefined, height: size.height || undefined }} />
      </div>
      <div className="transport">
        <button className="play" onClick={() => currentPlayer()?.toggle()} aria-label={player.playing ? 'Pause (Space)' : 'Play (Space)'} title={player.playing ? 'Pause (Space)' : 'Play (Space)'}>
          {player.playing ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
        </button>
        <span className="time tabular" data-testid="time">
          <b>{formatTime(player.t)}</b> / {formatTime(duration)}
          {player.source !== undefined && <em>source {player.source.toFixed(1)} s</em>}
        </span>
      </div>
    </main>
  );
}

/** The editor's keys: Space, J/K/L, arrows (Shift: a second), Home/End, Ctrl+E. */
function useShortcuts(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const player = currentPlayer();
      if (!player || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      const { t } = player.current();
      const frame = 1 / player.fps;
      const keys: Record<string, () => void> = {
        ' ': () => player.toggle(),
        k: () => player.pause(),
        l: () => player.play(),
        j: () => void player.seek(t - 1),
        ArrowLeft: () => void player.seek(t - (event.shiftKey ? 1 : frame)),
        ArrowRight: () => void player.seek(t + (event.shiftKey ? 1 : frame)),
        Home: () => void player.seek(0),
        End: () => void player.seek(player.duration),
        // Shift+Z: the whole video in the timeline
        z: () => event.shiftKey && store.set({ pxPerSecond: 0 }),
      };
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        openExport();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || store.get().exportOpen) return;
      const action = keys[event.key.length === 1 ? event.key.toLowerCase() : event.key];
      if (!action) return;
      event.preventDefault();
      action();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
