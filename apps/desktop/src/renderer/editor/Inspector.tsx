// The inspector: the selection's settings and the look (read-only in this version).
import type { ReactNode } from 'react';
import type { CuttleProject, Rect } from '@cuttle/project';
import { formatDuration, formatSpeed, formatTime } from '../../shared/format';
import { outputTimesOf } from '../../shared/timeline-model';
import { CardIcon, FilmIcon, MaskIcon, PageIcon, TextIcon, ZoomIcon } from '../icons';
import { currentPlayer, shownProject, store, type Selection } from './session';
import { useStore } from './store';

export function Inspector() {
  const tab = useStore(store, (state) => state.tab);
  return (
    <aside className="inspector" aria-label="Inspector">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'selection'} onClick={() => store.set({ tab: 'selection' })}>
          Selection
        </button>
        <button role="tab" aria-selected={tab === 'look'} onClick={() => store.set({ tab: 'look' })}>
          Look
        </button>
      </div>
      <div className="panel-body">{tab === 'selection' ? <SelectionPanel /> : <LookPanel />}</div>
    </aside>
  );
}

function Field({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <div>
      <div className="field-label">
        {label}
        {note && <em>{note}</em>}
      </div>
      {children}
    </div>
  );
}

const Value = ({ children, note }: { children: ReactNode; note?: string }) => (
  <div className="value tabular">
    <span>{children}</span>
    {note && <em>{note}</em>}
  </div>
);

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

function AreaFields({ rect }: { rect: Rect }) {
  return (
    <Field label="Area" note="source pixels">
      <div className="grid4">
        {(['x', 'y', 'w', 'h'] as const).map((name, i) => (
          <div key={name} className="value tabular">
            <em>{name}</em>
            {Math.round(rect[i]!)}
          </div>
        ))}
      </div>
    </Field>
  );
}

/** The output second where a source second first shows (in the clip under the playhead, when it shows there). */
function shownAt(project: CuttleProject, source: number): string {
  const player = currentPlayer();
  if (!player) return '';
  const times = outputTimesOf(player.spans, source);
  if (times.length === 0) return 'cut out';
  const t = player.current().t;
  const nearest = times.reduce((best, time) => (Math.abs(time - t) < Math.abs(best - t) ? time : best), times[0]!);
  return project && formatTime(nearest);
}

function SelectionPanel() {
  const selection = useStore(store, (state) => state.selection);
  useStore(store, (state) => state.player.t);
  const project = shownProject();
  if (!project || !selection) {
    return <p className="hint">Click a scene, zoom, mask or caption on the timeline to see its settings here. The Look tab holds the background, frame, cursor and more.</p>;
  }
  return <Details project={project} selection={selection} />;
}

function Details({ project, selection }: { project: CuttleProject; selection: Selection }) {
  if (selection.kind === 'scene') {
    const scene = project.scenes[selection.index];
    if (!scene) return null;
    const span = currentPlayer()?.spans[selection.index];
    const length = span ? span.end - span.start : 0;
    if (scene.type === 'clip') {
      return (
        <>
          <Head icon={<FilmIcon />} color="var(--text)" name={scene.label ?? (scene.speed > 1 ? 'Sped up' : 'Clip')} />
          <div className="grid2">
            <Field label="Speed">
              <Value>{formatSpeed(scene.speed)}</Value>
            </Field>
            <Field label="Length">
              <Value note={scene.speed !== 1 ? `${formatDuration(scene.to - scene.from)} src` : undefined}>{formatDuration(length)}</Value>
            </Field>
          </div>
          <div className="grid2">
            <Field label="From" note="source">
              <Value>{scene.from.toFixed(2)} s</Value>
            </Field>
            <Field label="To" note="source">
              <Value>{scene.to.toFixed(2)} s</Value>
            </Field>
          </div>
          <Field label="Starts at">
            <Value>{formatTime(span?.start ?? 0)}</Value>
          </Field>
          {scene.badge !== undefined && (
            <Field label="Badge">
              <Value>{scene.badge === '' ? 'none' : scene.badge}</Value>
            </Field>
          )}
        </>
      );
    }
    if (scene.type === 'still') {
      return (
        <>
          <Head icon={<PageIcon />} color="var(--still)" name={scene.label ?? scene.image.split(/[\\/]/).at(-1) ?? 'Still'} />
          <Field label="Image">
            <Value>{scene.image}</Value>
          </Field>
          <div className="grid2">
            <Field label="Length">
              <Value>{formatDuration(length)}</Value>
            </Field>
            <Field label="Motion">
              <Value>{scene.motion === 'kenburns' ? 'Ken Burns' : scene.motion === 'scroll' ? 'Scroll' : 'None'}</Value>
            </Field>
          </div>
          <Field label="Frame">
            <Value>{scene.frame}</Value>
          </Field>
        </>
      );
    }
    return (
      <>
        <Head icon={<CardIcon />} color="var(--card)" name={scene.label ?? scene.title} />
        <Field label="Title">
          <Value>{scene.title}</Value>
        </Field>
        {scene.subtitle && (
          <Field label="Subtitle">
            <Value>{scene.subtitle}</Value>
          </Field>
        )}
        <Field label="Length">
          <Value>{formatDuration(length)}</Value>
        </Field>
      </>
    );
  }
  if (selection.kind === 'zoom') {
    const zoom = project.zooms[selection.index];
    if (!zoom) return null;
    return (
      <>
        <Head icon={<ZoomIcon />} color="var(--zoom)" name={zoom.label ?? 'Zoom'} />
        <div className="grid2">
          <Field label="Starts" note={`${zoom.at.toFixed(1)} s src`}>
            <Value>{shownAt(project, zoom.at)}</Value>
          </Field>
          <Field label="Length" note="source">
            <Value>{formatDuration(zoom.duration)}</Value>
          </Field>
        </div>
        <AreaFields rect={zoom.rect} />
        <div className="grid2">
          <Field label="Easing">
            <Value>{zoom.ease === 'smooth' ? 'Smooth' : 'Linear'}</Value>
          </Field>
          <Field label="State">
            <Value>{zoom.enabled ? 'On' : 'Off'}</Value>
          </Field>
        </div>
      </>
    );
  }
  if (selection.kind === 'mask') {
    const mask = project.masks[selection.index];
    if (!mask) return null;
    return (
      <>
        <Head icon={<MaskIcon />} color="var(--mask)" name={mask.label ?? 'Mask'} />
        <div className="grid2">
          <Field label="From" note={`${mask.from.toFixed(1)} s src`}>
            <Value>{shownAt(project, mask.from)}</Value>
          </Field>
          <Field label="To" note="source">
            <Value>{mask.to.toFixed(1)} s</Value>
          </Field>
        </div>
        <AreaFields rect={mask.rect} />
        <div className="grid2">
          <Field label="Style">
            <Value>{mask.style === 'fill' ? 'Fill' : 'Blur'}</Value>
          </Field>
          <Field label="State">
            <Value>{mask.enabled ? 'On' : 'Off'}</Value>
          </Field>
        </div>
      </>
    );
  }
  const text = project.texts[selection.index];
  if (!text) return null;
  return (
    <>
      <Head icon={<TextIcon />} color="var(--caption)" name={text.label ?? text.text} />
      <Field label="Text">
        <Value>{text.text}</Value>
      </Field>
      <div className="grid2">
        <Field label="Starts" note={`${text.at.toFixed(1)} s src`}>
          <Value>{shownAt(project, text.at)}</Value>
        </Field>
        <Field label="Length" note="source">
          <Value>{formatDuration(text.duration)}</Value>
        </Field>
      </div>
      <div className="grid2">
        <Field label="Style">
          <Value>{text.style === 'lower-third' ? 'Lower third' : text.style === 'pill' ? 'Pill' : 'Caption'}</Value>
        </Field>
        <Field label="Position">
          <Value>{text.position[0]!.toUpperCase() + text.position.slice(1)}</Value>
        </Field>
      </div>
    </>
  );
}

const BACKGROUNDS: Record<string, string> = { 'sunset-sky': 'Sunset sky', aurora: 'Aurora', mesh: 'Mesh', solid: 'Solid', image: 'Image' };

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
          {BACKGROUNDS[look.background.preset] ?? look.background.preset}
        </>,
      )}
      {look.background.image && row('Image', look.background.image)}
      <div className="section-title">Window frame</div>
      {row('Style', look.frame.enabled ? look.frame.style : 'Off')}
      {look.frame.enabled && look.frame.title && row('Title', look.frame.title)}
      {look.frame.enabled && row('Corners', `${look.frame.radius} px${look.frame.shadow ? ' · shadow' : ''}`)}
      <div className="section-title">Cursor</div>
      {row('Style', look.cursor.enabled ? look.cursor.style : 'Off')}
      {look.cursor.enabled && row('Size', `${look.cursor.size}×`)}
      {look.cursor.enabled &&
        row(
          'Clicks',
          <>
            <span className="swatch" style={{ background: look.cursor.color }} />
            {look.cursor.clickEffect === 'ripple' ? 'Ripple' : 'None'}
          </>,
        )}
      <div className="section-title">Webcam</div>
      {row('Bubble', look.webcam.enabled ? `${look.webcam.shape}, ${look.webcam.corner}` : 'Off')}
      <div className="section-title">Sound and transitions</div>
      {row('Mic', look.audio.enabled ? (look.audio.muteSpedUp ? 'On, sped-up clips silent' : 'On') : 'Off')}
      {row('Crossfade', look.transition.enabled ? formatDuration(look.transition.duration) : 'Off')}
    </>
  );
}
