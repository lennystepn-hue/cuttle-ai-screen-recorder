import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type PointerEvent as ReactPointerEvent } from 'react';
import { webcamRect } from '@cuttle/engine';
import type { Rect } from '@cuttle/project';
import { HANDLES, movedBubble, resizedBubble, type Handle } from '../../shared/bubble';
import type { Command } from '../../shared/document';
import { formatDuration, formatSource, formatTime, plainIssue } from '../../shared/format';
import type { MediaState } from '../../shared/ipc';
import { bridge } from '../bridge';
import { shortcut } from '../keys';
import {
  ChevronIcon,
  CloseIcon,
  ExportIcon,
  FolderIcon,
  KeysIcon,
  Mark,
  MaskIcon,
  PauseIcon,
  PlayIcon,
  RecordIcon,
  RedoIcon,
  SelectIcon,
  TextIcon,
  UndoIcon,
  WarningIcon,
  ZoomIcon,
  CropIcon,
} from '../icons';
import { captionCommand, captionPositionsAt, chooseTool, cycleSpeed, freeCaptionPosition, deleteSelection, duplicateSelection, overlayBlocked, reveal, showRawTake, split, type CaptionPosition } from './actions';
import { CommandMenu, closeMenu, openMenu } from './CommandMenu';
import { beginGesture, cancelGesture } from './gesture';
import { dismissDraft, dismissRestart, dismissToast, edit, preview, redo, retrySave, undo, useDraft } from './doc';
import { ExportSheet } from './ExportSheet';
import { Inspector } from './Inspector';
import { SourceView } from './SourceView';
import { currentPlayer, documentProject, openExport, openSession, retryMedia, select, setFormat, setTool, shownProject, sourceViewShown, store, type Tool } from './session';
import { useStore } from './store';
import { FORMATS, ownFormat, targetName } from './targets';
import { Timeline } from './Timeline';

export function App() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const phase = useStore(store, (state) => state.phase);
  const tool = useStore(store, (state) => state.tool);

  useEffect(() => {
    if (canvas.current) void openSession(canvas.current);
  }, []);
  useShortcuts();
  useMouseFocus();

  if (phase === 'failed') return <Failed />;
  return (
    <div className="app" data-phase={phase} data-tool={tool}>
      <TitleBar />
      <Tools />
      <Stage canvas={canvas} />
      <Timeline />
      <Inspector />
      <ExportSheet />
      <CommandMenu />
      {phase === 'loading' && (
        <div className="opening">
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
            <button className="primary" onClick={() => void bridge.invoke('project:reload')}>
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
  const status = useStore(store, (state) => state.status);
  useStore(store, (state) => state.doc?.project);
  // the player takes a new version a moment after the document: its length comes with its state
  useStore(store, (state) => state.player.duration);
  const duration = currentPlayer()?.duration ?? 0;
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
      {phase === 'ready' && <SaveState />}
      {phase === 'ready' && <RestartChip />}
      <div className="grow" />
      {status?.state === 'failed' ? (
        <button
          className="chip-status warn"
          onClick={() => void bridge.invoke(status.retry === 'speech' ? 'project:transcribe' : status.retry === 'privacy' ? 'project:read-screen' : 'project:cut')}
          title={`${status.text}. Click to try again.`}
          data-testid="project-status"
        >
          <WarningIcon size={14} />
          <span className="chip-text">{status.retry === 'speech' ? 'The speech could not be transcribed' : status.retry === 'privacy' ? 'The screen could not be read' : 'The take could not be cut'}</span> · Try again
        </button>
      ) : (
        status && (
          <div className="chip-status" role="status" data-testid="project-status" title={status.text}>
            <span className="spinner small" aria-hidden="true" />
            <span className="chip-text">{status.text}</span>
          </div>
        )
      )}
      {phase === 'ready' && (
        <>
          <MediaChip />
          <ExportChip />
          <FormatSwitch />
          <History />
          <div className="seg" role="group" aria-label="Takes">
            <button onClick={() => void bridge.invoke('project:record')} title="Record a new take for this project; this one stays restorable" data-testid="record-again">
              <RecordIcon size={10} style={{ color: 'var(--recording)', display: 'inline-block', marginRight: 6, verticalAlign: -1 }} />
              Record again
            </button>
            <button onClick={() => void bridge.invoke('project:takes')} title="Earlier takes of this project" aria-label="Takes">
              <ChevronIcon size={13} />
            </button>
          </div>
          <button className="primary" onClick={openExport} disabled={(store.get().doc?.project.scenes.length ?? 0) === 0} title={(store.get().doc?.project.scenes.length ?? 0) === 0 ? 'Nothing to export yet: the project has no scenes' : `Export (${shortcut('Ctrl+E')})`}>
            <ExportIcon size={14} />
            Export
          </button>
        </>
      )}
    </header>
  );
}

/** Undo and Redo: their tooltips say what they undo and redo (off while cuttle.json has a mistake). */
function History() {
  const undoLabel = useStore(store, (state) => (state.doc?.issues ? undefined : state.doc?.undoLabel));
  const redoLabel = useStore(store, (state) => (state.doc?.issues ? undefined : state.doc?.redoLabel));
  return (
    <div className="seg icons" role="group" aria-label="History">
      <button onClick={undo} disabled={!undoLabel} title={undoLabel ? `Undo ${undoLabel} (${shortcut('Ctrl+Z')})` : 'Nothing to undo'} aria-label={undoLabel ? `Undo ${undoLabel}` : 'Undo'} data-testid="undo">
        <UndoIcon size={14} />
      </button>
      <button onClick={redo} disabled={!redoLabel} title={redoLabel ? `Redo ${redoLabel} (${shortcut('Ctrl+Shift+Z')})` : 'Nothing to redo'} aria-label={redoLabel ? `Redo ${redoLabel}` : 'Redo'} data-testid="redo">
        <RedoIcon size={14} />
      </button>
    </div>
  );
}

/** "Saved", "Saving…" (only when it takes a moment), or why it is not, with a retry. */
function SaveState() {
  const saving = useStore(store, (state) => state.doc?.saving ?? false);
  const problem = useStore(store, (state) => state.doc?.problem);
  const issues = useStore(store, (state) => state.doc?.issues);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!saving) return setSlow(false);
    const timer = setTimeout(() => setSlow(true), 400);
    return () => clearTimeout(timer);
  }, [saving]);
  if (problem)
    return (
      <button className="chip-status warn" onClick={retrySave} title={`${problem}\nClick to try again.`} data-testid="save-state">
        <WarningIcon size={14} />
        Not saved · Try again
      </button>
    );
  if (issues)
    return (
      <span className="save-state warn" title="cuttle.json has a mistake; see the note over the video" data-testid="save-state">
        Editing waits
      </span>
    );
  return (
    <span className="save-state" title="Every edit is written to cuttle.json at once; Claude and the CLI see it too" data-testid="save-state">
      {slow ? 'Saving…' : 'Saved'}
    </span>
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
            ? `Cuttle makes these with ffmpeg, and ffmpeg was not found. Install it (${navigator.userAgent.includes('Macintosh') ? 'brew install ffmpeg' : 'winget install Gyan.FFmpeg'}), then click to try again. Playback and export work without them.`
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
  const output = useStore(store, (state) => state.doc?.project.output);
  if (open) return null;
  if (exporting) {
    const percent = progress ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : 0;
    return (
      <button className="chip-status" onClick={openExport} title={`Show the export (${shortcut('Ctrl+E')})`}>
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
  const output = useStore(store, (state) => state.doc?.project.output);
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

const TOOLS: { tool: Tool; Icon: ComponentType<{ size?: number }>; name: string; keys: string; hint: string }[] = [
  { tool: 'select', Icon: SelectIcon, name: 'Select', keys: 'V', hint: 'click a caption on the video, or anything on the timeline' },
  { tool: 'zoom', Icon: ZoomIcon, name: 'Zoom', keys: 'Z', hint: 'drag over what the video should show close up' },
  { tool: 'mask', Icon: MaskIcon, name: 'Mask', keys: 'M', hint: 'drag over what the video should hide (a password, an address…)' },
  { tool: 'caption', Icon: TextIcon, name: 'Caption', keys: 'T', hint: 'type a caption on the video at the playhead' },
  { tool: 'crop', Icon: CropIcon, name: 'Crop', keys: 'C', hint: 'drag over the part of the screen the clip shows (tabs, a taskbar left out)' },
];

/** The tools, beside the video: they decide what a drag or click on the video does. */
function Tools() {
  const tool = useStore(store, (state) => state.tool);
  const ready = useStore(store, (state) => state.phase === 'ready' && !state.doc?.issues);
  // where the playhead is decides whether a zoom, mask or caption can go there
  useStore(store, (state) => Math.round(state.player.t * 30));
  useStore(store, (state) => state.doc?.project);
  const blocked = ready ? overlayBlocked() : undefined;
  return (
    <nav className="tools" role="toolbar" aria-label="Tools" aria-orientation="vertical">
      {TOOLS.map(({ tool: name, Icon, name: label, keys, hint }) => {
        // the tool in use stays pressable, to turn it off
        const off = !ready || (name !== 'select' && blocked !== undefined && tool !== name);
        return (
          <button
            key={name}
            aria-pressed={tool === name}
            disabled={off}
            onClick={() => setTool(tool === name && name !== 'select' ? 'select' : name)}
            title={`${label} (${keys}): ${off && blocked ? blocked : hint}`}
            aria-label={label}
            data-testid={`tool-${name}`}
          >
            <Icon size={17} />
            <kbd>{keys}</kbd>
          </button>
        );
      })}
      <div className="grow" />
      <button onClick={openMenu} disabled={!ready} title={`Every command and its keys (${shortcut('Ctrl+K')})`} aria-label="Commands" data-testid="open-menu">
        <KeysIcon size={17} />
      </button>
    </nav>
  );
}

function Stage({ canvas }: { canvas: React.RefObject<HTMLCanvasElement | null> }) {
  const viewport = useRef<HTMLDivElement>(null);
  const error = useStore(store, (state) => state.player.error);
  const media = useStore(store, (state) => state.media);
  const format = useStore(store, (state) => state.format);
  const issues = useStore(store, (state) => state.doc?.issues);
  const sourceView = useStore(store, sourceViewShown);
  useStore(store, (state) => state.doc?.preview ?? state.doc?.project);
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
      {issues ? (
        <IssuesBanner issues={issues} />
      ) : (
        warning &&
        warning !== dismissed &&
        // the source view says what it shows in the same place
        !sourceView && (
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
        )
      )}
      <div className="viewport" ref={viewport}>
        <VideoFrame canvas={canvas} size={size} output={output} />
        <SourceView />
        {project && project.scenes.length === 0 && !issues && <EmptyStage />}
      </div>
      <div className="top-notes">
        <DraftNote />
      </div>
      <ToastNote />
      <Transport />
    </main>
  );
}

const bandOf = (y: number): CaptionPosition => (y < 1 / 3 ? 'top' : y > 2 / 3 ? 'bottom' : 'center');

/**
 * The video, with what the tools do on it: Select picks a caption by clicking it (a double click
 * edits its text) and moves the webcam bubble (its corners resize it), Caption types a new one
 * where it is clicked.
 */
function VideoFrame({ canvas, size, output }: { canvas: React.RefObject<HTMLCanvasElement | null>; size: { width: number; height: number }; output: { width: number; height: number } }) {
  const tool = useStore(store, (state) => state.tool);
  const selection = useStore(store, (state) => state.selection);
  // every frame the player draws (a seek to the same second after an edit too): the captions' boxes are its
  const drawnFrame = useStore(store, (state) => state.player);
  const [hover, setHover] = useState<string>();
  const [position, setPosition] = useState<CaptionPosition>('bottom');
  const scale = size.width > 0 ? size.width / output.width : 0;
  // a new caption goes where none is shown at the playhead (they would cover each other)
  useEffect(() => {
    if (tool === 'caption') setPosition(freeCaptionPosition());
  }, [tool]);

  /** The caption drawn under the pointer, by the boxes the last frame drew them in. */
  const captionAt = (event: { clientX: number; clientY: number }) => {
    const bounds = canvas.current?.getBoundingClientRect();
    if (!bounds || scale === 0) return undefined;
    const x = (event.clientX - bounds.left) / scale;
    const y = (event.clientY - bounds.top) / scale;
    const drawn = currentPlayer()?.drawnTexts() ?? [];
    return drawn.findLast(({ rect }) => x >= rect[0] && x < rect[0] + rect[2] && y >= rect[1] && y < rect[1] + rect[3]);
  };

  const press = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    if (tool === 'caption') {
      const bounds = event.currentTarget.getBoundingClientRect();
      setPosition(bandOf((event.clientY - bounds.top) / bounds.height));
      return;
    }
    const hit = captionAt(event);
    if (hit?.overlay.id) select({ kind: 'caption', id: hit.overlay.id });
    else if (selection?.kind === 'caption') select(undefined);
  };

  // The webcam bubble: dragged anywhere (snapping to a corner's place or the middle, with a guide),
  // resized at its corners; previewed while dragging, one edit at the end.
  const project = shownProject();
  const webcam = project?.look.webcam;
  const bubble = tool === 'select' && scale > 0 && webcam?.enabled && project?.sources.webcam ? webcamRect(output, webcam) : undefined;
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  const [dragging, setDragging] = useState(false);
  const dragBubble = (event: ReactPointerEvent<HTMLElement>, handle?: Handle) => {
    if (event.button !== 0 || !bubble || !webcam) return;
    event.stopPropagation();
    const target = event.currentTarget;
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // a synthetic pointer (the check) has nothing to capture
    }
    const from = { x: event.clientX, y: event.clientY };
    let commands: Command[] | undefined;
    const detach = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      preview(undefined);
      setGuides({});
      setDragging(false);
    };
    const end = beginGesture('stage', detach);
    const move = (moved: PointerEvent) => {
      const dx = (moved.clientX - from.x) / scale;
      const dy = (moved.clientY - from.y) / scale;
      if (handle) {
        commands = [{ type: 'look', path: ['webcam', 'size'], value: resizedBubble(output, bubble, handle, dx, dy) }];
      } else {
        const place = movedBubble(output, bubble, dx, dy, (corner) => webcamRect(output, { corner, size: webcam.size }));
        commands =
          'corner' in place
            ? [{ type: 'look', path: ['webcam', 'corner'], value: place.corner }, { type: 'look', path: ['webcam', 'position'], value: undefined }]
            : [{ type: 'look', path: ['webcam', 'position'], value: place.position }];
        setGuides('guides' in place ? place.guides : {});
      }
      preview(commands);
    };
    const up = () => {
      end();
      detach();
      if (commands) edit(commands, handle ? 'Webcam size' : 'Move webcam');
    };
    setDragging(true);
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };
  const bubbleRadius = webcam?.shape === 'circle' ? '50%' : webcam?.shape === 'square' ? '0' : webcam?.shape === 'squircle' ? '30%' : '22%';

  // The boxes of the captions on the frame now: the selected one outlined, the one under the pointer too.
  void drawnFrame;
  const drawn = scale > 0 && tool === 'select' ? (currentPlayer()?.drawnTexts() ?? []) : [];
  const outlined = drawn.filter(({ overlay }) => overlay.id && (overlay.id === hover || (selection?.kind === 'caption' && selection.id === overlay.id)));
  const toStage = (rect: Rect) => ({ left: rect[0] * scale - 3, top: rect[1] * scale - 3, width: rect[2] * scale + 6, height: rect[3] * scale + 6 });

  return (
    <>
      <div className="frame" style={{ width: size.width || undefined, height: size.height || undefined }}>
        <canvas
          ref={canvas}
          data-testid="output"
          className={hover && tool === 'select' ? 'over-caption' : undefined}
          style={{ width: size.width || undefined, height: size.height || undefined }}
          onPointerDown={press}
          onPointerMove={(event) => tool === 'select' && setHover(captionAt(event)?.overlay.id)}
          onPointerLeave={() => setHover(undefined)}
          onDoubleClick={(event) => {
            if (tool !== 'select' || !captionAt(event)) return;
            requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-testid="caption-text"]')?.focus());
          }}
        />
        {outlined.map(({ overlay, rect }) => (
          <div key={overlay.id} className={`caption-box${selection?.id === overlay.id ? ' selected' : ''}`} style={toStage(rect)} />
        ))}
        {bubble && (
          <div
            className={`webcam-box${dragging ? ' dragging' : ''}`}
            style={{ left: bubble[0] * scale, top: bubble[1] * scale, width: bubble[2] * scale, height: bubble[3] * scale, borderRadius: bubbleRadius }}
            onPointerDown={(event) => dragBubble(event)}
            onDoubleClick={() => store.set({ tab: 'look', lookSection: 'camera' })}
            title="Drag the camera anywhere; drag a corner to resize it. A double click shows its look."
            data-testid="webcam-box"
          >
            {(Object.keys(HANDLES) as Handle[]).map((handle) => (
              <i key={handle} className={`handle ${handle}`} onPointerDown={(event) => dragBubble(event, handle)} data-testid={`webcam-handle-${handle}`} />
            ))}
          </div>
        )}
        {guides.x !== undefined && <div className="guide across" style={{ left: guides.x * scale }} />}
        {guides.y !== undefined && <div className="guide down" style={{ top: guides.y * scale }} />}
      </div>
      {tool === 'caption' && <CaptionBar position={position} onPosition={setPosition} />}
    </>
  );
}

const POSITIONS: { position: CaptionPosition; name: string }[] = [
  { position: 'top', name: 'Top' },
  { position: 'center', name: 'Middle' },
  { position: 'bottom', name: 'Bottom' },
];

/**
 * The caption tool: type the caption on the video; the video shows it as it will be while typing.
 * Enter adds it at the playhead (and selects it), Esc goes back without one.
 */
function CaptionBar({ position, onPosition }: { position: CaptionPosition; onPosition: (position: CaptionPosition) => void }) {
  const t = useStore(store, (state) => Math.round(state.player.t * 30));
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  void t;
  const blocked = overlayBlocked();
  const used = captionPositionsAt();

  useEffect(() => {
    if (!blocked) input.current?.focus();
  }, [blocked]);
  // While typing, the video shows the caption (not saved, not in the history).
  useEffect(() => {
    const command = text.trim() ? captionCommand(text, position) : undefined;
    preview(command && [command]);
  }, [text, position, blocked]);
  useEffect(() => () => preview(undefined), []);

  const add = () => {
    const command = captionCommand(text.trim(), position);
    if (!text.trim() || !command) return;
    // the document as saved: the preview while typing has the new caption (with the id it gets) already
    const before = new Set(documentProject()?.texts.map((item) => item.id));
    if (!edit([command], 'Add caption')) return;
    const added = store.get().doc?.project.texts.find((item) => !before.has(item.id));
    setText('');
    setTool('select');
    if (added?.id) select({ kind: 'caption', id: added.id });
  };

  return (
    // away from where the caption goes, so the caption shows while it is typed
    <div className={`caption-bar ${position === 'top' ? 'near-bottom' : 'near-top'}`} onPointerDown={(event) => event.stopPropagation()}>
      <input
        ref={input}
        value={text}
        disabled={!!blocked}
        placeholder={blocked ?? 'Type the caption; Enter adds it at the playhead'}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') {
            event.preventDefault();
            add();
          }
          if (event.key === 'Escape') setTool('select');
        }}
        aria-label="Caption"
        data-testid="caption-input"
      />
      <div className="seg" role="group" aria-label="Where the caption goes">
        {POSITIONS.map((item) => (
          <button
            key={item.position}
            type="button"
            aria-pressed={position === item.position}
            className={used.has(item.position) ? 'used' : undefined}
            title={used.has(item.position) ? `${item.name}: a caption shows there now` : item.name}
            onClick={() => onPosition(item.position)}
          >
            {item.name}
          </button>
        ))}
      </div>
      <button type="button" className="ghost small add" onClick={add} disabled={!text.trim() || !!blocked}>
        Add
      </button>
    </div>
  );
}

/** cuttle.json on disk does not parse: editing waits, and says what to fix. */
function IssuesBanner({ issues }: { issues: string[] }) {
  return (
    <div className="banner" role="alert" data-testid="issues">
      <WarningIcon size={16} />
      <div>
        <b>cuttle.json has a mistake, so editing here waits.</b>
        <p>Fix it in a text editor or ask Claude: the editor takes the fixed file by itself. The video shows the last version that worked.</p>
        <ul>
          {issues.slice(0, 3).map((issue) => (
            <li key={issue}>{plainIssue(issue)}</li>
          ))}
          {issues.length > 3 && <li>and {issues.length - 3} more</li>}
        </ul>
      </div>
      <button className="ghost small" onClick={() => void bridge.invoke('project:reveal')}>
        <FolderIcon size={13} />
        Show the folder
      </button>
    </div>
  );
}

/** A version a save conflict set aside (cuttle.json.draft): offered back until it is answered. */
function DraftNote() {
  const note = useStore(store, (state) => state.doc?.draftNote);
  if (!note) return null;
  return (
    <div className="draft-note" role="alert" data-testid="draft-note">
      <WarningIcon size={14} />
      <span title={note}>{note}</span>
      <button className="toast-undo" onClick={useDraft} title="Put your version back (one step to undo)" data-testid="draft-use">
        Use mine
      </button>
      <button className="toast-close" onClick={dismissDraft} aria-label="Keep the newer version" title="Keep the newer version (cuttle.json.draft stays in the folder)">
        <CloseIcon size={11} />
      </button>
    </div>
  );
}

/** A project without scenes (all deleted, or a cuttle.json written so): what to do, over the empty frame. */
function EmptyStage() {
  const cutting = useStore(store, (state) => state.status?.state === 'working');
  return (
    <div className="empty-stage" data-testid="empty-stage">
      <div>
        <h2>Nothing in the video yet</h2>
        <p>The take is there, but no scene shows it. Let Cuttle cut it, or start from the whole take.</p>
        <div className="empty-actions">
          <button className="primary" onClick={() => void bridge.invoke('project:cut')} disabled={cutting}>
            {cutting ? 'Cutting…' : 'Let Cuttle cut it'}
          </button>
          <button className="ghost" onClick={showRawTake}>
            Show the whole take
          </button>
        </div>
      </div>
    </div>
  );
}

/** After a restart: a quiet offer in the title bar to use the take before it (it waits; the video stays clear). */
function RestartChip() {
  const discarded = useStore(store, (state) => state.doc?.restartNote);
  if (!discarded) return null;
  return (
    <div className="chip-status restart-chip" role="status" data-testid="restart-note">
      <span className="chip-text">Restarted: the earlier take is kept.</span>
      <button
        className="chip-action"
        onClick={() => {
          dismissRestart();
          void bridge.invoke('project:undo-restart', discarded);
        }}
        title="Use the take from before the restart (this one stays in Record again ▾)"
        data-testid="undo-restart"
      >
        Use it instead
      </button>
      <button className="chip-close" onClick={dismissRestart} aria-label="Keep this take" title="Keep this take (the earlier one stays in Record again ▾)">
        <CloseIcon size={10} />
      </button>
    </div>
  );
}

/** What just happened (an outside change, a cut by suggest, an edit that was not possible), with Undo where it applies. */
function ToastNote() {
  const toast = useStore(store, (state) => state.doc?.toast);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!toast || held) return;
    const timer = setTimeout(dismissToast, toast.tone === 'warning' ? 9000 : 6000);
    return () => clearTimeout(timer);
  }, [toast?.id, held]);
  if (!toast) return null;
  return (
    <div className={`toast${toast.tone === 'warning' ? ' warn' : ''}`} role="status" aria-live="polite" onPointerEnter={() => setHeld(true)} onPointerLeave={() => setHeld(false)} data-testid="toast" key={toast.id}>
      {toast.tone === 'warning' && <WarningIcon size={14} />}
      <span title={toast.text}>{toast.text}</span>
      {toast.show && (
        <button className="toast-undo" onClick={() => reveal(toast.show!.list, toast.show!.id)} data-testid="toast-show">
          Show
        </button>
      )}
      {toast.undo && (
        <button className="toast-undo" onClick={undo} data-testid="toast-undo">
          Undo
        </button>
      )}
      <button className="toast-close" onClick={dismissToast} aria-label="Dismiss" title="Dismiss">
        <CloseIcon size={11} />
      </button>
    </div>
  );
}

function Transport() {
  const playing = useStore(store, (state) => state.player.playing);
  const t = useStore(store, (state) => state.player.t);
  const source = useStore(store, (state) => state.player.source);
  const format = useStore(store, (state) => state.format);
  const output = useStore(store, (state) => state.doc?.project.output);
  const own = ownFormat(output);
  useStore(store, (state) => state.player.duration);
  const duration = currentPlayer()?.duration ?? 0;
  return (
    <div className="transport">
      <button
        className="play"
        onClick={() => currentPlayer()?.toggle()}
        disabled={duration <= 0}
        aria-label={playing ? 'Pause (Space)' : 'Play (Space)'}
        title={duration <= 0 ? 'Nothing to play yet: the project has no scenes' : playing ? 'Pause (Space)' : 'Play (Space)'}
      >
        {playing ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
      </button>
      <span className="time tabular" data-testid="time">
        <b>{formatTime(t)}</b> / {formatTime(duration)}
        {source !== undefined && <em>{formatSource(source)}</em>}
      </span>
      {format !== undefined && format !== own && output && (
        <span className="preview-note" title="The preview shows another format; the export sheet picks what is exported">
          Preview {format} · the project is {own ?? `${output.width}×${output.height}`}
        </span>
      )}
    </div>
  );
}

/** Keys that repeat while held (a frame or a second at a time); the others act once per press. */
const REPEATING = new Set(['ArrowLeft', 'ArrowRight']);

/**
 * The editor's keys (the command menu lists them): Space (K pauses, L plays, J a second back),
 * arrows (Shift: a second), Home/End, S split, Delete, Ctrl+D, R/Shift+R speed, V/Z/M/T tools, Shift+Z
 * fit, Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y, Ctrl+K or ? the menu, Ctrl+E export, Ctrl+F find in the transcript, Esc back out. Typing in a
 * field, and Space or Enter on a focused button outside the timeline, keep their own meaning.
 */
function useShortcuts(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : undefined;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const command = (event.ctrlKey || event.metaKey) && !event.altKey;
      const { phase, exportOpen, menuOpen } = store.get();
      if (phase !== 'ready') return;
      // Ctrl+K opens the menu from anywhere, a field too (the menu closes itself on it)
      if (command && key === 'k' && !menuOpen) {
        event.preventDefault();
        if (!event.repeat) openMenu();
        return;
      }
      // Ctrl+F finds a word in the transcript, from anywhere
      if (command && key === 'f' && !menuOpen) {
        event.preventDefault();
        store.set({ tab: 'transcript', findRequest: (store.get().findRequest ?? 0) + 1 });
        return;
      }
      if (menuOpen || target?.closest('input, select, textarea, [contenteditable]:not([contenteditable="false"])')) return;
      if (command && key === ',') {
        event.preventDefault();
        if (!event.repeat) void bridge.invoke('app:settings');
        return;
      }
      if (command && key === 'e') {
        event.preventDefault();
        if (!event.repeat) openExport();
        return;
      }
      if (exportOpen) return;
      if (command) {
        const edits: Record<string, () => void> = {
          z: () => (event.shiftKey ? redo() : undo()),
          y: redo,
          d: duplicateSelection,
        };
        const action = edits[key];
        if (!action) return;
        event.preventDefault();
        action();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if ((event.key === ' ' || event.key === 'Enter') && target?.closest('button, [role="tab"]') && !target.closest('.timeline')) return;
      const player = currentPlayer();
      if (!player) return;
      const { t } = player.current();
      const frame = 1 / player.fps;
      const keys: Record<string, () => void> = {
        // playing ends a drag under way (what it drags moves under it)
        ' ': () => (cancelGesture(), player.toggle()),
        k: () => player.pause(),
        l: () => (cancelGesture(), player.play()),
        j: () => void player.seek(t - 1),
        ArrowLeft: () => void player.seek(t - (event.shiftKey ? 1 : frame)),
        ArrowRight: () => void player.seek(t + (event.shiftKey ? 1 : frame)),
        Home: () => void player.seek(0),
        End: () => void player.seek(player.duration),
        Escape: backOut,
        s: split,
        Delete: deleteSelection,
        Backspace: deleteSelection,
        // R: the next speed, Shift+R: the one before
        r: () => cycleSpeed(event.shiftKey ? -1 : 1),
        v: () => setTool('select'),
        // Shift+Z: the whole video in the timeline
        z: () => (event.shiftKey ? store.set({ pxPerSecond: 0 }) : chooseTool('zoom')),
        m: () => chooseTool('mask'),
        t: () => chooseTool('caption'),
        c: () => chooseTool('crop'),
        '?': openMenu,
      };
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

/**
 * A click leaves the keys to the editor: a button pressed with the mouse takes no focus (Space and
 * the arrows go on playing and stepping; a field the person typed in is left, which saves it). A
 * select (Select.tsx) lets go of the focus itself once chosen with the mouse. Keyboard focus (Tab)
 * is kept as it is.
 */
function useMouseFocus(): void {
  useEffect(() => {
    const down = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : undefined;
      if (event.button !== 0 || !target?.closest('button')) return;
      event.preventDefault();
      // the caption bar and the menu keep their field's focus
      if (target.closest('.caption-bar, .command-menu')) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body) active.blur();
    };
    window.addEventListener('mousedown', down, true);
    return () => window.removeEventListener('mousedown', down, true);
  }, []);
}

/** Esc: out of the source view (the tool and a zoom or mask selected), else out of a tool, else the selection. */
function backOut(): void {
  // first a drag under way: it ends without an edit
  if (cancelGesture()) return;
  const { tool, selection } = store.get();
  closeMenu();
  const inSource = tool === 'zoom' || tool === 'mask' || tool === 'crop' || selection?.kind === 'zoom' || selection?.kind === 'mask' || selection?.kind === 'crop';
  if (tool !== 'select') setTool('select');
  if (inSource || tool === 'select') select(undefined);
}
