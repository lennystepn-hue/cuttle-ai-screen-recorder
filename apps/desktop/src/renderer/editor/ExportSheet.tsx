// The export sheet: formats (the project's own size first), encoder, which files it writes and what
// they replace, a check of things worth a second look, progress, cancel, and the files at the end
// with their chapters (from the script's steps) to copy into a YouTube description.
// Closing it while an export runs keeps the export running (the title bar shows it).
import { useEffect, useMemo, useRef, useState } from 'react';
import { EXPORT_FORMATS } from '@cuttle/export/formats';
import { formatBytes, formatDuration, formatTime } from '../../shared/format';
import type { ExportTarget } from '../../shared/ipc';
import { sceneSpans, stepChapters, youtubeChapters, type Chapter } from '@cuttle/timeline';
import { exportChecks } from '../../shared/timeline-model';
import { bridge } from '../bridge';
import { CheckIcon, CloseIcon, FolderIcon } from '../icons';
import { Select } from '../Select';
import { LOUDNESS_TARGETS, type LoudnessTarget } from '@cuttle/project';
import type { Command } from '../../shared/document';
import { edit } from './doc';
import { cancelExport, closeExport, startExport, store } from './session';
import { useStore } from './store';
import { FORMATS, ownFormat, targetName } from './targets';

const ENCODERS = { auto: 'Automatic', hardware: 'Graphics card', software: 'Processor' } as const;
/** The loudness targets as people know them (`LOUDNESS`). */
const LOUDNESS_NAMES: Record<LoudnessTarget, string> = {
  off: 'As mixed',
  youtube: 'YouTube & social · −14 LUFS',
  podcast: 'Podcast · −16 LUFS',
  broadcast: 'Broadcast · −23 LUFS',
};

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
  const project = useStore(store, (state) => state.doc?.project);
  const markers = useStore(store, (state) => state.media?.markers);
  const output = project?.output;
  const own = ownFormat(output);
  // The project's own size first; a preset of the same size would write the same video again.
  const targets = useMemo<ExportTarget[]>(() => ['project', ...FORMATS.filter((name) => name !== own)], [own]);
  const [chosen, setChosen] = useState<ExportTarget[]>([]);
  const [encoder, setEncoder] = useState<keyof typeof ENCODERS>('auto');
  // subtitles: burned in as the project has them (Look tab), and the files beside the video
  const [burned, setBurned] = useState<'in' | 'off'>('in');
  const [subtitleFiles, setSubtitleFiles] = useState<('srt' | 'vtt')[]>([]);
  const transcribed = project?.sources.transcript !== undefined;
  const [files, setFiles] = useState<{ format: ExportTarget; out: string; modified?: number }[]>([]);
  const sheet = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && !exporting) {
      setChosen([format ?? 'project']);
      setBurned(project?.captions.enabled === false ? 'off' : 'in');
    }
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

  // Focus stays in the sheet while it is open: it goes back where it was when the sheet closes (the
  // Export button when that is gone, as the title bar's export chip is) ...
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    return () => (before?.isConnected ? before : document.querySelector<HTMLElement>('.titlebar .primary'))?.focus();
  }, [open]);

  // ... it moves in when the sheet opens or changes view (the button that had it is gone) ...
  const view = exporting ? 'progress' : end ? 'end' : 'form';
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const element = sheet.current;
      if (element && !element.contains(document.activeElement)) element.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, view]);

  // ... and Tab cycles inside it, also from wherever the focus fell. Esc closes it.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') return closeExport();
      const element = sheet.current;
      if (event.key !== 'Tab' || !element) return;
      const focusable = [...element.querySelectorAll<HTMLElement>('button:not(:disabled), select, [tabindex]:not([tabindex="-1"])')];
      if (focusable.length === 0) return;
      const at = focusable.indexOf(document.activeElement as HTMLElement);
      if (at < 0 || (event.shiftKey && at === 0) || (!event.shiftKey && at === focusable.length - 1)) {
        event.preventDefault();
        (event.shiftKey ? focusable.at(-1)! : focusable[0]!).focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const checks = useMemo(() => (project ? exportChecks(project, sceneSpans(project.scenes, project.cuts)) : []), [project]);
  // the script's steps the take reached: the video's chapters
  const chapters = useMemo(() => (project ? stepChapters(project.script, markers ?? [], sceneSpans(project.scenes, project.cuts)) : []), [project, markers]);

  if (!open) return null;

  const toggle = (name: ExportTarget) => setChosen((list) => (list.includes(name) ? list.filter((item) => item !== name) : targets.filter((item) => item === name || list.includes(item))));
  const done = progress ? progress.done / Math.max(1, progress.total) : 0;
  const finishing = progress !== undefined && progress.position === progress.formats - 1 && progress.done >= progress.total;
  const remaining = progress && done > 0.02 && !finishing ? (progress.elapsed / (progress.position + done)) * (progress.formats - progress.position - done) : undefined;
  const replaced = files.filter((file) => file.modified !== undefined);

  return (
    <div className="scrim" onPointerDown={(event) => event.target === event.currentTarget && closeExport()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="export-title" data-testid="export-sheet" ref={sheet}>
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
              <Select
                value={encoder}
                options={(Object.entries(ENCODERS) as [keyof typeof ENCODERS, string][]).map(([value, name]) => ({ value, label: name }))}
                onChange={setEncoder}
                label="Encoder"
                variant="compact"
                testId="encoder"
              />
            </div>
            <div className="row">
              Loudness
              <Select
                value={project?.look.audio.loudness ?? 'off'}
                options={LOUDNESS_TARGETS.map((value) => ({ value, label: LOUDNESS_NAMES[value] }))}
                onChange={(value) => edit([{ type: 'look', path: ['audio', 'loudness'], value: value === 'off' ? undefined : value } as Command], `Loudness: ${LOUDNESS_NAMES[value]}`)}
                label="Loudness"
                variant="compact"
                testId="export-loudness"
                title="Where a platform plays the sound: the whole mix brought there, its peaks kept under -1 dBTP (kept in the project)"
              />
            </div>
            {transcribed && (
              <div className="row">
                Subtitles
                <Select
                  value={burned}
                  options={[
                    { value: 'in', label: 'In the video' },
                    { value: 'off', label: 'Not in the video' },
                  ]}
                  onChange={setBurned}
                  label="Subtitles"
                  variant="compact"
                  testId="export-subtitles"
                />
                <span className="subtitle-files" role="group" aria-label="Subtitle files">
                  {(['srt', 'vtt'] as const).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      className="chip"
                      aria-pressed={subtitleFiles.includes(kind)}
                      onClick={() => setSubtitleFiles((list) => (list.includes(kind) ? list.filter((item) => item !== kind) : [...list, kind].sort()))}
                      title={`Also save the subtitles as a .${kind} file next to the video`}
                      data-testid={`export-${kind}`}
                    >
                      .{kind}
                    </button>
                  ))}
                </span>
              </div>
            )}
            {chapters.length > 0 && (
              <div className="row" data-testid="export-chapters">
                Chapters
                <span>
                  {chapters.length} from the script, in the video file
                </span>
              </div>
            )}
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
              <button
                className="primary"
                disabled={chosen.length === 0}
                onClick={() => void startExport(chosen, encoder, transcribed ? { captions: burned === 'in', files: subtitleFiles } : {})}
                data-testid="export-start"
                data-autofocus
              >
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
                    {file.subtitles && ` · with ${file.subtitles.map((path) => `.${path.split('.').at(-1)}`).join(' and ')}`}
                    {file.chapters && ` · ${file.chapters.length} chapter${file.chapters.length === 1 ? '' : 's'}`}
                    {file.loudness && ` · ${file.loudness.lufs === null ? 'silent' : `${file.loudness.lufs.toFixed(1)} LUFS`}`}
                  </small>
                </div>
                <button className="ghost" onClick={() => void bridge.invoke('project:reveal', file.out)} title="Show in folder">
                  <FolderIcon size={14} />
                  Show
                </button>
              </div>
            ))}
            {end.files.some((file) => file.chapters) && <ChapterList chapters={end.files.find((file) => file.chapters)!.chapters!} />}
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

/** The chapters an export wrote, as lines for a YouTube description, with a button that copies them and why YouTube would not show them. */
function ChapterList({ chapters }: { chapters: Chapter[] }) {
  const [copied, setCopied] = useState(false);
  const { text, problems } = youtubeChapters(chapters);
  const copy = () =>
    void bridge.invoke('export:copy', text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  return (
    <div className="chapter-list" data-testid="export-chapter-list">
      <div className="chapter-head">
        <b>Chapters in the video</b>
        <button className="ghost" onClick={copy} title="Copy the lines for a YouTube description" data-testid="export-copy-chapters">
          {copied ? 'Copied' : 'Copy for YouTube'}
        </button>
      </div>
      <pre>{text}</pre>
      {problems.map((problem) => (
        <div key={problem} className="note">
          {problem}
        </div>
      ))}
    </div>
  );
}
