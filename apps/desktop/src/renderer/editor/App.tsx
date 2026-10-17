import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatDuration, formatSource, formatTime, plainIssue } from '../../shared/format';
import type { MediaState } from '../../shared/ipc';
import { bridge } from '../bridge';
import { CloseIcon, ExportIcon, FolderIcon, Mark, PauseIcon, PlayIcon, WarningIcon } from '../icons';
import { ExportSheet } from './ExportSheet';
import { Inspector } from './Inspector';
import { currentPlayer, openExport, openSession, retryMedia, select, setFormat, shownProject, store } from './session';
import { useStore } from './store';
import { FORMATS, ownFormat, targetName } from './targets';
import { Timeline } from './Timeline';

export function App() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const phase = useStore(store, (state) => state.phase);

  useEffect(() => {
    if (canvas.current) void openSession(canvas.current);
  }, []);
  useShortcuts();

  if (phase === 'failed') return <Failed />;
  return (
    <div className="app" data-phase={phase}>
      <TitleBar />
      <Stage canvas={canvas} />
      <Timeline />
      <Inspector />
      <ExportSheet />
      {phase === 'loading' && (
        <div className="loading">
          <div className="spinner" role="status" aria-label="Opening the project" />
        </div>
      )}
    </div>
  );
}

/** A project that cannot be opened: what is wrong in plain lines, with the title bar (the window can still be moved) and a way on. */
function Failed() {
  const error = useStore(store, (state) => state.error) ?? '';
  return (
    <div className="app failed" data-phase="failed">
      <TitleBar />
      <main className="failed-view">
        <div role="alert">
          <WarningIcon size={28} style={{ color: 'var(--card)' }} />
          <h1>This project can't be opened</h1>
          <p>{error.split('\n').map(plainIssue).join('\n')}</p>
          <div className="actions">
            <button className="ghost" onClick={() => void bridge.invoke('project:reveal')}>
              <FolderIcon size={14} />
              Show the folder
            </button>
            <button className="primary" onClick={() => location.reload()}>
              Try again
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

function TitleBar() {
  const phase = useStore(store, (state) => state.phase);
  const info = useStore(store, (state) => state.info);
  const media = useStore(store, (state) => state.media);
  const duration = currentPlayer()?.duration ?? 0;
  const recorded = media ? media.screen.end - media.screen.start : 0;
  return (
    <header className="titlebar">
      <Mark />
      <div className="project-name">
        <b>{info?.name ?? 'Cuttle'}</b>
        {media && (
          <span>
            {formatDuration(recorded)} recorded · {formatDuration(duration)} video · view only
          </span>
        )}
      </div>
      <div className="grow" />
      {phase === 'ready' && (
        <>
          <MediaChip />
          <ExportChip />
          <FormatSwitch />
          <button className="primary" onClick={openExport} title="Export (Ctrl+E)">
            <ExportIcon size={14} />
            Export
          </button>
        </>
      )}
    </header>
  );
}

const MEDIA_NAMES: Record<Exclude<keyof MediaState, 'seq'>, string> = { proxy: 'smooth-playback copy', thumbnails: 'thumbnails', peaks: 'waveform' };

/** The background media: progress of the proxy, or what failed with a retry. */
function MediaChip() {
  const mediaState = useStore(store, (state) => state.mediaState);
  const failed = (Object.keys(MEDIA_NAMES) as (keyof typeof MEDIA_NAMES)[]).filter((kind) => mediaState[kind].state === 'failed');
  if (failed.length > 0) {
    const messages = failed.map((kind) => mediaState[kind].message ?? '');
    const noFfmpeg = messages.some((message) => /ffmpeg/i.test(message) && /ENOENT|not found/i.test(message));
    const names = failed.map((kind) => MEDIA_NAMES[kind]);
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;
    return (
      <button
        className="chip-status warn"
        onClick={retryMedia}
        title={
          noFfmpeg
            ? 'Cuttle makes these with ffmpeg, and ffmpeg was not found. Install it (winget install Gyan.FFmpeg), then click to try again. Playback and export work without them.'
            : `${messages.filter(Boolean).join('\n')}\nPlayback and export work without them. Click to try again.`
        }
      >
        <WarningIcon size={14} />
        {noFfmpeg ? 'ffmpeg not found' : `No ${list}`} · Try again
      </button>
    );
  }
  const proxy = mediaState.proxy;
  if (proxy.state !== 'working') return null;
  const percent = Math.round((proxy.progress ?? 0) * 100);
  return (
    <div className="chip-status" title="A smaller copy of the take, so playback stays smooth in long takes. Playback already works; the export always uses the take.">
      Making a smooth-playback copy · {percent}%
      <span className="bar">
        <i style={{ width: `${percent}%` }} />
      </span>
    </div>
  );
}

/** A running export, or one that ended while the sheet was closed: reopens the sheet. */
function ExportChip() {
  const open = useStore(store, (state) => state.exportOpen);
  const exporting = useStore(store, (state) => state.exporting);
  const unseen = useStore(store, (state) => state.exportUnseen);
  const progress = useStore(store, (state) => state.exportProgress);
  const end = useStore(store, (state) => state.exportEnd);
  const output = useStore(store, (state) => state.media?.project.output);
  if (open) return null;
  if (exporting) {
    const percent = progress ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : 0;
    return (
      <button className="chip-status" onClick={openExport} title="Show the export (Ctrl+E)">
        Exporting {progress ? targetName(progress.format, output) : ''} · {percent}%
        <span className="bar">
          <i style={{ width: `${percent}%` }} />
        </span>
      </button>
    );
  }
  if (!unseen || !end) return null;
  if (end.state === 'done')
    return (
      <button className="chip-status done" onClick={openExport} title="Show the exported files">
        Exported · Show
      </button>
    );
  if (end.state === 'failed')
    return (
      <button className="chip-status warn" onClick={openExport} title="Show what went wrong">
        <WarningIcon size={14} />
        Export failed · Details
      </button>
    );
  return null;
}

/** The preview's output format: the project's own size first (marked inside its preset when it is one), then the presets. */
function FormatSwitch() {
  const format = useStore(store, (state) => state.format);
  const output = useStore(store, (state) => state.media?.project.output);
  const own = ownFormat(output);
  return (
    <div className="seg" role="group" aria-label="Preview format">
      {!own && output && (
        <button aria-pressed={format === undefined} onClick={() => setFormat(undefined)} title={`The project's own size, ${output.width}×${output.height}`}>
          Project
        </button>
      )}
      {FORMATS.map((name) => (
        <button
          key={name}
          aria-pressed={format === name || (format === undefined && own === name)}
          onClick={() => setFormat(name === own ? undefined : name)}
          title={name === own ? `${name}, the project's own size` : `Preview as ${name}`}
        >
          {name}
        </button>
      ))}
    </div>
  );
}

function Stage({ canvas }: { canvas: React.RefObject<HTMLCanvasElement | null> }) {
  const viewport = useRef<HTMLDivElement>(null);
  const error = useStore(store, (state) => state.player.error);
  const media = useStore(store, (state) => state.media);
  const format = useStore(store, (state) => state.format);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [dismissed, setDismissed] = useState<string>();
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

  const warning = error ?? media?.warnings[0];
  const more = error ? 0 : Math.max(0, (media?.warnings.length ?? 0) - 1);
  return (
    <main className="stage">
      {warning && warning !== dismissed && (
        <div className={`stage-note${error ? ' warn' : ''}`} title={error ? warning : media?.warnings.join('\n')} role="status">
          <WarningIcon size={14} />
          <span>
            {warning}
            {more > 0 && ` (and ${more} more)`}
          </span>
          <button onClick={() => setDismissed(warning)} aria-label="Dismiss" title="Dismiss">
            <CloseIcon size={11} />
          </button>
        </div>
      )}
      <div className="viewport" ref={viewport}>
        <canvas ref={canvas} data-testid="output" style={{ width: size.width || undefined, height: size.height || undefined }} />
      </div>
      <Transport />
    </main>
  );
}

function Transport() {
  const playing = useStore(store, (state) => state.player.playing);
  const t = useStore(store, (state) => state.player.t);
  const source = useStore(store, (state) => state.player.source);
  const duration = currentPlayer()?.duration ?? 0;
  return (
    <div className="transport">
      <button className="play" onClick={() => currentPlayer()?.toggle()} aria-label={playing ? 'Pause (Space)' : 'Play (Space)'} title={playing ? 'Pause (Space)' : 'Play (Space)'}>
        {playing ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
      </button>
      <span className="time tabular" data-testid="time">
        <b>{formatTime(t)}</b> / {formatTime(duration)}
        {source !== undefined && <em>{formatSource(source)}</em>}
      </span>
    </div>
  );
}

/** Keys that repeat while held (a frame or a second at a time); the others act once per press. */
const REPEATING = new Set(['ArrowLeft', 'ArrowRight']);

/**
 * The editor's keys: Space (K pauses, L plays, J a second back), arrows (Shift: a second), Home/End,
 * Shift+Z (fit the timeline), Esc (clear the selection), Ctrl+E. Typing in a field, and Space or
 * Enter on a focused button outside the timeline, keep their own meaning.
 */
function useShortcuts(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : undefined;
      if (target?.closest('input, select, textarea, [contenteditable]:not([contenteditable="false"])')) return;
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        if (!event.repeat) openExport();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || store.get().exportOpen) return;
      if ((event.key === ' ' || event.key === 'Enter') && target?.closest('button, [role="tab"]') && !target.closest('.timeline')) return;
      const player = currentPlayer();
      if (!player) return;
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
        Escape: () => select(undefined),
        // Shift+Z: the whole video in the timeline
        z: () => event.shiftKey && store.set({ pxPerSecond: 0 }),
      };
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const action = keys[key];
      if (!action) return;
      event.preventDefault();
      if (event.repeat && !REPEATING.has(key)) return;
      action();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
