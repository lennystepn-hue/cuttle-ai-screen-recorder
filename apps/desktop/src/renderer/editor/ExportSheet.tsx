// The export sheet: formats, encoder, progress, cancel, and the files at the end.
import { useEffect, useState } from 'react';
import { EXPORT_FORMATS, type ExportFormat } from '@cuttle/export/formats';
import { formatBytes, formatDuration } from '../../shared/format';
import { CheckIcon, CloseIcon, FolderIcon } from '../icons';
import { bridge } from '../bridge';
import { cancelExport, closeExport, startExport, store } from './session';
import { useStore } from './store';

const FORMATS = Object.keys(EXPORT_FORMATS) as ExportFormat[];
const ENCODERS = { auto: 'Automatic', hardware: 'Graphics card', software: 'Processor' } as const;

export function ExportSheet() {
  const open = useStore(store, (state) => state.exportOpen);
  const exporting = useStore(store, (state) => state.exporting);
  const progress = useStore(store, (state) => state.exportProgress);
  const end = useStore(store, (state) => state.exportEnd);
  const format = useStore(store, (state) => state.format);
  const output = useStore(store, (state) => state.media?.project.output);
  const own = FORMATS.find((name) => output && EXPORT_FORMATS[name].width === output.width && EXPORT_FORMATS[name].height === output.height);
  const [chosen, setChosen] = useState<ExportFormat[]>([]);
  const [encoder, setEncoder] = useState<keyof typeof ENCODERS>('auto');

  useEffect(() => {
    if (open && !exporting) setChosen([format ?? own ?? '16:9']);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !exporting) closeExport();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, exporting]);

  if (!open) return null;
  const toggle = (name: ExportFormat) => setChosen((list) => (list.includes(name) ? list.filter((item) => item !== name) : FORMATS.filter((item) => item === name || list.includes(item))));
  const done = progress ? progress.done / Math.max(1, progress.total) : 0;
  const finishing = progress !== undefined && progress.position === progress.formats - 1 && progress.done >= progress.total;
  const remaining = progress && done > 0.02 && !finishing ? (progress.elapsed / (progress.position + done)) * (progress.formats - progress.position - done) : undefined;

  return (
    <div className="scrim" onPointerDown={(event) => event.target === event.currentTarget && !exporting && closeExport()}>
      <div className="sheet" role="dialog" aria-label="Export" data-testid="export-sheet">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <h2 style={{ flex: 1 }}>Export</h2>
          {!exporting && (
            <button className="ghost" style={{ width: 28, padding: 0, justifyContent: 'center' }} onClick={closeExport} aria-label="Close (Esc)">
              <CloseIcon size={14} />
            </button>
          )}
        </div>

        {!exporting && !end && (
          <>
            <div className="formats" role="group" aria-label="Formats">
              {FORMATS.map((name) => {
                const { width, height } = EXPORT_FORMATS[name];
                const scale = 34 / Math.max(width, height);
                return (
                  <button key={name} className="format" aria-pressed={chosen.includes(name)} onClick={() => toggle(name)}>
                    <span className="shape" style={{ width: width * scale, height: height * scale }} />
                    {name}
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
            <div className="row">
              <span>
                Into <b style={{ color: 'var(--text)', fontWeight: 500 }}>out/</b> in the project, as it is saved now
              </span>
            </div>
            <div className="actions">
              <button className="ghost" onClick={closeExport}>
                Cancel
              </button>
              <button className="primary" disabled={chosen.length === 0} onClick={() => void startExport(chosen, encoder)} data-testid="export-start">
                Export {chosen.length > 1 ? `${chosen.length} formats` : chosen[0]}
              </button>
            </div>
          </>
        )}

        {exporting && (
          <>
            <div className="progress" aria-live="polite">
              <div className="meta">
                <span>
                  {progress ? `${progress.format}${progress.formats > 1 ? ` · ${progress.position + 1} of ${progress.formats}` : ''}` : 'Starting…'}
                </span>
                <span>{progress ? `${Math.round(done * 100)} %` : ''}</span>
              </div>
              <div className="track">
                <i style={{ width: `${Math.round(done * 100)}%` }} />
              </div>
              <div className="meta">
                <span>{progress ? `${progress.done} of ${progress.total} frames` : ''}</span>
                <span>{finishing ? 'Adding the sound…' : remaining !== undefined ? `about ${formatDuration(remaining)} left` : ''}</span>
              </div>
            </div>
            <div className="actions">
              <button className="ghost" onClick={cancelExport}>
                Cancel export
              </button>
            </div>
          </>
        )}

        {!exporting && end && (
          <>
            {end.state === 'failed' && (
              <div className="error-text">
                The {end.format} export failed ({end.code}): {end.message}
              </div>
            )}
            {end.state === 'cancelled' && <div className="hint">The export was cancelled; nothing was left half-written.</div>}
            {end.files.map((file) => (
              <div key={file.out} className="file-row" data-testid="export-file">
                <CheckIcon size={14} style={{ color: 'var(--ok)' }} />
                <div>
                  {file.out.split(/[\\/]/).at(-1)}
                  <small>
                    {file.format} · {formatDuration(file.seconds)} · {formatBytes(file.bytes)}
                  </small>
                </div>
                <button className="ghost" onClick={() => void bridge.invoke('project:reveal', file.out)} title="Show in folder">
                  <FolderIcon size={14} />
                  Show
                </button>
              </div>
            ))}
            <div className="actions">
              <button className="ghost" onClick={() => store.set({ exportEnd: undefined })}>
                Export again
              </button>
              <button className="primary" onClick={closeExport}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
