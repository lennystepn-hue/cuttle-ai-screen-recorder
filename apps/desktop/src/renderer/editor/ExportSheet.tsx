// The export sheet: formats (the project's own size first), encoder, which files it writes and what
// they replace, a check of things worth a second look, progress, cancel, and the files at the end.
// Closing it while an export runs keeps the export running (the title bar shows it).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { EXPORT_FORMATS } from '@cuttle/export/formats';
import { formatBytes, formatDuration, formatTime } from '../../shared/format';
import type { ExportTarget } from '../../shared/ipc';
import { exportChecks } from '../../shared/timeline-model';
import { bridge } from '../bridge';
import { CheckIcon, CloseIcon, FolderIcon } from '../icons';
import { cancelExport, closeExport, currentPlayer, startExport, store } from './session';
import { useStore } from './store';
import { FORMATS, ownFormat, targetName } from './targets';

const ENCODERS = { auto: 'Automatic', hardware: 'Graphics card', software: 'Processor' } as const;

/** When an earlier export was made, for people: `14:05` today, `12 Oct, 14:05` before. */
function madeAt(time: number): string {
  const date = new Date(time);
  const clock = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return date.toDateString() === new Date().toDateString() ? clock : `${date.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${clock}`;
}

const fileName = (path: string) => `out/${path.split(/[\\/]/).at(-1)}`;

export function ExportSheet() {
  const open = useStore(store, (state) => state.exportOpen);
  const exporting = useStore(store, (state) => state.exporting);
  const progress = useStore(store, (state) => state.exportProgress);
  const end = useStore(store, (state) => state.exportEnd);
  const started = useStore(store, (state) => state.exportStarted);
  const format = useStore(store, (state) => state.format);
  const media = useStore(store, (state) => state.media);
  const output = media?.project.output;
  const own = ownFormat(output);
  // The project's own size first; a preset of the same size would write the same video again.
  const targets = useMemo<ExportTarget[]>(() => ['project', ...FORMATS.filter((name) => name !== own)], [own]);
  const [chosen, setChosen] = useState<ExportTarget[]>([]);
  const [encoder, setEncoder] = useState<keyof typeof ENCODERS>('auto');
  const [files, setFiles] = useState<{ format: ExportTarget; out: string; modified?: number }[]>([]);
  const sheet = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && !exporting) setChosen([format ?? 'project']);
  }, [open]);

  // Which files the chosen formats write, and when an export already there was made.
  useEffect(() => {
    if (!open || chosen.length === 0) return setFiles([]);
    let current = true;
    void bridge.invoke('export:targets', chosen).then((answer) => current && setFiles(answer));
    return () => {
      current = false;
    };
  }, [open, chosen, end]);

  // Focus moves into the sheet when it opens and back where it was when it closes.
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    requestAnimationFrame(() => sheet.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus());
    return () => before?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') closeExport();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const checks = useMemo(() => (media ? exportChecks(media.project, currentPlayer()?.spans ?? []) : []), [media]);

  if (!open) return null;

  /** Tab stays inside the sheet. */
  const trap = (event: KeyboardEvent) => {
    if (event.key !== 'Tab' || !sheet.current) return;
    const focusable = [...sheet.current.querySelectorAll<HTMLElement>('button:not(:disabled), select, [tabindex]:not([tabindex="-1"])')];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const toggle = (name: ExportTarget) => setChosen((list) => (list.includes(name) ? list.filter((item) => item !== name) : targets.filter((item) => item === name || list.includes(item))));
  const done = progress ? progress.done / Math.max(1, progress.total) : 0;
  const finishing = progress !== undefined && progress.position === progress.formats - 1 && progress.done >= progress.total;
  const remaining = progress && done > 0.02 && !finishing ? (progress.elapsed / (progress.position + done)) * (progress.formats - progress.position - done) : undefined;
  const replaced = files.filter((file) => file.modified !== undefined);

  return (
    <div className="scrim" onPointerDown={(event) => event.target === event.currentTarget && closeExport()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="export-title" data-testid="export-sheet" ref={sheet} onKeyDown={trap}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <h2 id="export-title" style={{ flex: 1 }}>
            Export
          </h2>
          <button className="ghost" style={{ width: 28, padding: 0, justifyContent: 'center' }} onClick={closeExport} aria-label="Close (Esc)" title={exporting ? 'Close; the export keeps running' : 'Close (Esc)'}>
            <CloseIcon size={14} />
          </button>
        </div>

        {!exporting && !end && (
          <>
            <div className="formats" role="group" aria-label="Formats">
              {targets.map((name) => {
                const { width, height } = name === 'project' ? (output ?? { width: 16, height: 9 }) : EXPORT_FORMATS[name];
                const scale = 34 / Math.max(width, height);
                return (
                  <button key={name} className="format" aria-pressed={chosen.includes(name)} onClick={() => toggle(name)}>
                    <span className="shape-box">
                      <span className="shape" style={{ width: width * scale, height: height * scale }} />
                    </span>
                    {name === 'project' ? (own ? `Project, ${own}` : 'Project') : name}
                    <small>
                      {width}×{height}
                    </small>
                  </button>
                );
              })}
            </div>
            <div className="row">
              Encoder
              <select value={encoder} onChange={(event) => setEncoder(event.target.value as keyof typeof ENCODERS)}>
                {Object.entries(ENCODERS).map(([value, name]) => (
                  <option key={value} value={value}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            {files.length > 0 && (
              <div className="note" data-testid="export-note">
                Saves {files.map((file, i) => (
                  <span key={file.out}>
                    {i > 0 && (i === files.length - 1 ? ' and ' : ', ')}
                    <b>{fileName(file.out)}</b>
                  </span>
                ))}{' '}
                from cuttle.json as it is saved now.
                {replaced.length > 0 && ` Replaces ${replaced.map((file) => `${fileName(file.out)} from ${madeAt(file.modified!)}`).join(' and ')}.`}
              </div>
            )}
            {checks.length > 0 && (
              <ul className="checks" aria-label="Worth a second look" data-testid="export-checks">
                {checks.map((check) => (
                  <li key={check}>{check}</li>
                ))}
              </ul>
            )}
            <div className="actions">
              <button className="ghost" onClick={closeExport}>
                Cancel
              </button>
              <button className="primary" disabled={chosen.length === 0} onClick={() => void startExport(chosen, encoder)} data-testid="export-start" data-autofocus>
                Export {chosen.length > 1 ? `${chosen.length} formats` : chosen[0] ? targetName(chosen[0], output) : ''}
              </button>
            </div>
          </>
        )}

        {exporting && (
          <>
            <div className="progress" aria-live="polite">
              <div className="meta">
                <span>
                  {progress ? `${targetName(progress.format, output)}${progress.formats > 1 ? ` · ${progress.position + 1} of ${progress.formats}` : ''}` : 'Starting…'}
                </span>
                <span>{progress ? `${Math.round(done * 100)}%` : ''}</span>
              </div>
              <div className="track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(done * 100)}>
                <i style={{ width: `${Math.round(done * 100)}%` }} />
              </div>
              <div className="meta">
                <span>{progress ? `${progress.done} of ${progress.total} frames · ${formatTime(progress.elapsed).replace(/\.\d$/, '')} elapsed` : ''}</span>
                <span>{finishing ? 'Adding the sound…' : remaining !== undefined ? `about ${formatDuration(remaining)} left` : ''}</span>
              </div>
            </div>
            <div className="note">
              From cuttle.json as saved at {started ? madeAt(started) : 'the start'}. Closing this keeps the export running.
            </div>
            <div className="actions">
              <button className="ghost" onClick={cancelExport}>
                Cancel export
              </button>
              <button className="primary" onClick={closeExport} data-autofocus>
                Keep editing
              </button>
            </div>
          </>
        )}

        {!exporting && end && (
          <>
            {end.state === 'failed' && (
              <div className="error-text" role="alert">
                The {targetName(end.format, output)} export failed: {end.message}
              </div>
            )}
            {end.state === 'cancelled' && <div className="note">The export was cancelled; nothing was left half-written.</div>}
            {end.files.map((file) => (
              <div key={file.out} className="file-row" data-testid="export-file">
                <CheckIcon size={14} style={{ color: 'var(--ok)' }} />
                <div>
                  {fileName(file.out)}
                  <small>
                    {targetName(file.format, output)} · {formatDuration(file.seconds)} · {formatBytes(file.bytes)}
                  </small>
                </div>
                <button className="ghost" onClick={() => void bridge.invoke('project:reveal', file.out)} title="Show in folder">
                  <FolderIcon size={14} />
                  Show
                </button>
              </div>
            ))}
            <div className="actions">
              {end.state === 'done' ? (
                <>
                  <button className="ghost" onClick={() => store.set({ exportEnd: undefined })}>
                    Export again
                  </button>
                  <button className="primary" onClick={closeExport} data-autofocus>
                    Done
                  </button>
                </>
              ) : (
                <>
                  <button className="ghost" onClick={closeExport}>
                    Close
                  </button>
                  <button className="primary" onClick={() => store.set({ exportEnd: undefined })} data-autofocus>
                    Export again
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
