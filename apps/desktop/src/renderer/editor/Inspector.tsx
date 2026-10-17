// The inspector: the selection's settings and the look (view only in this version). Output times read
// m:ss.t, source seconds "src 54.4 s" (src m:ss.t past a minute), lengths "2.5 s".
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { CuttleProject, Rect } from '@cuttle/project';
import { formatDuration, formatSource, formatSpeed, formatTime } from '../../shared/format';
import {
  BACKGROUND_NAMES,
  CLICK_NAMES,
  CORNER_NAMES,
  CURSOR_NAMES,
  EASE_NAMES,
  FRAME_NAMES,
  MASK_STYLE_NAMES,
  MOTION_NAMES,
  POSITION_NAMES,
  TEXT_STYLE_NAMES,
  WEBCAM_SHAPE_NAMES,
} from '../../shared/names';
import { outputTimesOf } from '../../shared/timeline-model';
import { CardIcon, FilmIcon, MaskIcon, PageIcon, TextIcon, ZoomIcon } from '../icons';
import { currentPlayer, shownProject, store, type Selection } from './session';
import { useStore } from './store';

const TABS = [
  { id: 'selection', name: 'Selection' },
  { id: 'look', name: 'Look' },
] as const;

export function Inspector() {
  const tab = useStore(store, (state) => state.tab);
  const tabs = useRef<HTMLDivElement>(null);
  // Arrow keys move between the tabs, as in any tab list.
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();
    const next = TABS[(TABS.findIndex((item) => item.id === tab) + 1) % TABS.length]!;
    store.set({ tab: next.id });
    tabs.current?.querySelector<HTMLButtonElement>(`#tab-${next.id}`)?.focus();
  };
  return (
    <aside className="inspector" aria-label="Inspector">
      <div className="tabs" role="tablist" ref={tabs} onKeyDown={onKey}>
        {TABS.map((item) => (
          <button
            key={item.id}
            id={`tab-${item.id}`}
            role="tab"
            aria-selected={tab === item.id}
            aria-controls="inspector-panel"
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => store.set({ tab: item.id })}
          >
            {item.name}
          </button>
        ))}
      </div>
      <p className="view-only">View only in this version. Ask Claude or use the cuttle command to change it.</p>
      <div className="panel-body" id="inspector-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'selection' ? <SelectionPanel /> : <LookPanel />}
      </div>
    </aside>
  );
}

function Field({ label, children, note }: { label: string; children: ReactNode; note?: string }) {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      <div className="value tabular">
        <span>{children}</span>
        {note && <em>{note}</em>}
      </div>
    </div>
  );
}

function Head({ icon, color, name }: { icon: ReactNode; color: string; name: string }) {
  return (
    <div className="kind-head">
      <span className="kind-icon" style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>
        {icon}
      </span>
      <span className="name" title={name}>
        {name}
      </span>
    </div>
  );
}

function AreaField({ rect }: { rect: Rect }) {
  return (
    <div className="field">
      <div className="field-label">Area, in source pixels</div>
      <div className="value tabular area">
        {(['x', 'y', 'w', 'h'] as const).map((name, i) => (
          <span key={name}>
            <em>{name}</em> {Math.round(rect[i]!)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** A source second without the "src" in front, for a field already named Source. */
const source = (seconds: number) => formatSource(seconds).slice(4);
const span = (from: number, to: number) => `${formatTime(from)} → ${formatTime(to)}`;

/** Where an overlay shows in the video: the clicked block, else its first stretch; undefined when no clip shows it. */
function shownStretch(selection: Selection, start: number, end: number): { start: number; end: number } | undefined {
  if (selection.start !== undefined && selection.end !== undefined) return { start: selection.start, end: selection.end };
  const spans = currentPlayer()?.spans ?? [];
  const from = outputTimesOf(spans, start)[0];
  if (from === undefined) return undefined;
  const to = outputTimesOf(spans, Math.max(start, end - 1e-6)).find((time) => time >= from);
  return { start: from, end: to ?? from };
}

const offNote = (enabled: boolean) => (enabled ? null : <Field label="State">Off: not in the video</Field>);

function SelectionPanel() {
  const selection = useStore(store, (state) => state.selection);
  useStore(store, (state) => state.format);
  const project = shownProject();
  if (!project || !selection) {
    return <p className="hint">Click a scene, zoom, mask or caption on the timeline to see its settings here. The Look tab holds the background, frame, cursor and more.</p>;
  }
  return <Details project={project} selection={selection} />;
}

function Details({ project, selection }: { project: CuttleProject; selection: Selection }) {
  if (selection.kind === 'scene') {
    const scene = project.scenes[selection.index];
    const stretch = currentPlayer()?.spans[selection.index];
    if (!scene || !stretch) return null;
    const length = stretch.end - stretch.start;
    const inVideo = <Field label="In the video">{span(stretch.start, stretch.end)}</Field>;
    if (scene.type === 'clip') {
      const name = [scene.speed !== 1 ? formatSpeed(scene.speed) : '', scene.label ?? (scene.speed === 1 ? 'Clip' : '')].filter(Boolean).join(' ');
      return (
        <>
          <Head icon={<FilmIcon />} color="var(--text)" name={name} />
          <div className="grid2">
            <Field label="Speed">{formatSpeed(scene.speed)}</Field>
            <Field label="Length" note={scene.speed !== 1 ? `${formatDuration(scene.to - scene.from)} src` : undefined}>
              {formatDuration(length)}
            </Field>
          </div>
          {inVideo}
          <Field label="Source">
            {source(scene.from)} → {source(scene.to)}
          </Field>
          {scene.badge !== undefined && <Field label="Badge">{scene.badge === '' ? 'None' : scene.badge}</Field>}
        </>
      );
    }
    if (scene.type === 'still') {
      return (
        <>
          <Head icon={<PageIcon />} color="var(--still)" name={scene.label ?? 'Still'} />
          <Field label="Image">{scene.image}</Field>
          {inVideo}
          <div className="grid2">
            <Field label="Length">{formatDuration(length)}</Field>
            <Field label="Motion">{MOTION_NAMES[scene.motion]}</Field>
          </div>
          <Field label="Frame">{FRAME_NAMES[scene.frame]}</Field>
        </>
      );
    }
    return (
      <>
        <Head icon={<CardIcon />} color="var(--card)" name={scene.label ?? 'Card'} />
        <Field label="Title">{scene.title}</Field>
        {scene.subtitle && <Field label="Subtitle">{scene.subtitle}</Field>}
        {inVideo}
        <Field label="Length">{formatDuration(length)}</Field>
      </>
    );
  }

  /** The overlay's stretch in the video and its source times, or "Not in the video" when every clip cuts it out. */
  const shown = (from: number, to: number) => {
    const stretch = shownStretch(selection, from, to);
    return (
      <>
        <div className="grid2">
          <Field label="In the video">{stretch ? span(stretch.start, stretch.end) : 'Cut out'}</Field>
          <Field label="Length" note={`${formatDuration(to - from)} src`}>
            {stretch ? formatDuration(stretch.end - stretch.start) : '–'}
          </Field>
        </div>
        <Field label="Source">
          {source(from)} → {source(to)}
        </Field>
      </>
    );
  };

  if (selection.kind === 'zoom') {
    const zoom = project.zooms[selection.index];
    if (!zoom) return null;
    return (
      <>
        <Head icon={<ZoomIcon />} color="var(--zoom)" name={zoom.label ?? 'Zoom'} />
        {shown(zoom.at, zoom.at + zoom.duration)}
        <AreaField rect={zoom.rect} />
        <Field label="Easing">{EASE_NAMES[zoom.ease]}</Field>
        {offNote(zoom.enabled)}
      </>
    );
  }
  if (selection.kind === 'mask') {
    const mask = project.masks[selection.index];
    if (!mask) return null;
    return (
      <>
        <Head icon={<MaskIcon />} color="var(--mask)" name={mask.label ?? 'Mask'} />
        {shown(mask.from, mask.to)}
        <AreaField rect={mask.rect} />
        <Field label="Style">{MASK_STYLE_NAMES[mask.style]}</Field>
        {offNote(mask.enabled)}
      </>
    );
  }
  const text = project.texts[selection.index];
  if (!text) return null;
  return (
    <>
      <Head icon={<TextIcon />} color="var(--caption)" name={text.label ?? 'Caption'} />
      <Field label="Text">{text.text}</Field>
      {shown(text.at, text.at + text.duration)}
      <div className="grid2">
        <Field label="Style">{TEXT_STYLE_NAMES[text.style]}</Field>
        <Field label="Position">{POSITION_NAMES[text.position]}</Field>
      </div>
      {offNote(text.enabled)}
    </>
  );
}

function LookPanel() {
  useStore(store, (state) => state.format);
  const project = shownProject();
  if (!project) return null;
  const { look, output } = project;
  const row = (name: string, value: ReactNode) => (
    <div className="look-row">
      {name}
      <b>{value}</b>
    </div>
  );
  return (
    <>
      <div className="section-title">Output</div>
      {row('Size', `${output.width} × ${output.height}`)}
      {row('Frame rate', `${output.fps} fps`)}
      <div className="section-title">Background</div>
      {row(
        'Preset',
        <>
          {look.background.preset === 'solid' && look.background.color && <span className="swatch" style={{ background: look.background.color }} />}
          {BACKGROUND_NAMES[look.background.preset]}
        </>,
      )}
      {look.background.image && row('Image', look.background.image)}
      <div className="section-title">Window frame</div>
      {row('Style', look.frame.enabled ? FRAME_NAMES[look.frame.style] : 'Off')}
      {look.frame.enabled && look.frame.title && row('Title', look.frame.title)}
      {look.frame.enabled && row('Corners', `${look.frame.radius} px${look.frame.shadow ? ', with shadow' : ''}`)}
      <div className="section-title">Cursor</div>
      {row('Style', look.cursor.enabled ? CURSOR_NAMES[look.cursor.style] : 'Off')}
      {look.cursor.enabled && row('Size', `${look.cursor.size}×`)}
      {look.cursor.enabled &&
        row(
          'Clicks',
          <>
            <span className="swatch" style={{ background: look.cursor.color }} />
            {CLICK_NAMES[look.cursor.clickEffect]}
          </>,
        )}
      <div className="section-title">Webcam</div>
      {row('Bubble', look.webcam.enabled ? `${WEBCAM_SHAPE_NAMES[look.webcam.shape]}, ${CORNER_NAMES[look.webcam.corner].toLowerCase()}` : 'Off')}
      <div className="section-title">Sound and transitions</div>
      {row('Mic', look.audio.enabled ? (look.audio.muteSpedUp ? 'On, sped-up clips silent' : 'On') : 'Off')}
      {row('Crossfade', look.transition.enabled ? formatDuration(look.transition.duration) : 'Off')}
    </>
  );
}
