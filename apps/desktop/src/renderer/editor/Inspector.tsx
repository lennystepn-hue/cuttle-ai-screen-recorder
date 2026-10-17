// The inspector: the selection's settings and the look, edited in place. A field saves when it is
// left or Enter is pressed (text also every 2 s while typing); each save is one step to undo.
// Output times read m:ss.t, take seconds "54.4 s into the take", lengths "2.5 s". While cuttle.json
// does not parse, every field is off (editing waits).
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { EXPORT_FORMATS } from '@cuttle/export/formats';
import { BACKGROUND_PRESETS, CLICK_EFFECTS, CURSOR_STYLES, EASES, FRAME_STYLES, MASK_STYLES, STILL_MOTIONS, TEXT_POSITIONS, TEXT_STYLES, WEBCAM_CORNERS, WEBCAM_SHAPES, type CuttleProject, type Rect } from '@cuttle/project';
import { sceneSpans } from '@cuttle/timeline';
import type { Command, ListName } from '../../shared/document';
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
import { CardIcon, CopyIcon, FilmIcon, MaskIcon, PageIcon, TextIcon, TrashIcon, ZoomIcon } from '../icons';
import { chooseImage, deleteSelection, duplicateSelection, LIST_OF, SPEEDS } from './actions';
import { edit, preview } from './doc';
import { setTool, store, type Selection, type Tool } from './session';
import { useStore } from './store';

const TABS = [
  { id: 'selection', name: 'Selection' },
  { id: 'look', name: 'Look' },
] as const;

export function Inspector() {
  const tab = useStore(store, (state) => state.tab);
  const broken = useStore(store, (state) => state.doc?.issues !== undefined);
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
      <div className="panel-body" id="inspector-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        <fieldset className="panel-fields" disabled={broken}>
          {tab === 'selection' ? <SelectionPanel /> : <LookPanel />}
        </fieldset>
      </div>
    </aside>
  );
}

// ---- fields --------------------------------------------------------------------------------------

/**
 * A labelled field. The label is a <label> (a click on it reaches the field) unless `plain`: a row
 * with a button that is not its field (Replace…) must not press it from its label.
 */
function Row({ label, children, note, wide, plain, inline }: { label: string; children: ReactNode; note?: ReactNode; wide?: boolean; plain?: boolean; inline?: boolean }) {
  const Tag = plain ? 'div' : 'label';
  return (
    <Tag className={`field${wide ? ' wide' : ''}${inline ? ' inline' : ''}`}>
      <span className="field-label">{label}</span>
      <span className="field-input">
        {children}
        {note !== undefined && <em>{note}</em>}
      </span>
    </Tag>
  );
}

/** A text that saves when left, on Enter (not in a multi-line one), and every 2 s while typing. */
function TextInput({ value, onCommit, multiline, placeholder, testId }: { value: string; onCommit: (value: string) => void; multiline?: boolean; placeholder?: string; testId?: string }) {
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef(draft);
  useEffect(() => {
    setDraft(value);
    latest.current = value;
  }, [value]);
  const commit = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    if (latest.current !== value) onCommit(latest.current);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const props = {
    value: draft,
    placeholder,
    'data-testid': testId,
    onChange: (event: { target: { value: string } }) => {
      setDraft(event.target.value);
      latest.current = event.target.value;
      timer.current ??= setTimeout(commit, 2000);
    },
    onBlur: commit,
    onKeyDown: (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === 'Enter' && (!multiline || event.ctrlKey)) {
        event.preventDefault();
        commit();
      }
      if (event.key === 'Escape') {
        setDraft(value);
        latest.current = value;
        clearTimeout(timer.current);
        timer.current = undefined;
        (event.target as HTMLElement).blur();
      }
    },
  };
  return multiline ? <textarea rows={2} {...props} /> : <input type="text" {...props} />;
}

/**
 * A number that saves when left or on Enter, clamped to [min, max]. It reads with a point whatever
 * the system's language (as every time in the app does); ↑ and ↓ step it (Shift: ten steps); Esc
 * puts it back and leaves the field.
 */
function NumberInput({ value, onCommit, step = 0.1, min, max, digits = 2, testId }: { value: number; onCommit: (value: number) => void; step?: number; min?: number; max?: number; digits?: number; testId?: string }) {
  const shown = String(Math.round(value * 10 ** digits) / 10 ** digits);
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  const clamp = (number: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, number));
  const commit = (text = draft) => {
    const parsed = Number(text.trim().replace(',', '.'));
    if (text.trim() === '' || !Number.isFinite(parsed)) return setDraft(shown);
    const clamped = clamp(parsed);
    if (Math.abs(clamped - value) > 1e-9) onCommit(clamped);
    else setDraft(shown);
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      data-testid={testId}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => commit()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') commit();
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          const from = Number(draft.replace(',', '.'));
          const next = clamp((Number.isFinite(from) ? from : value) + (event.key === 'ArrowUp' ? 1 : -1) * step * (event.shiftKey ? 10 : 1));
          const text = String(Math.round(next * 10 ** digits) / 10 ** digits);
          setDraft(text);
          commit(text);
        }
        if (event.key === 'Escape') {
          setDraft(shown);
          (event.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

function Select<T extends string>({ value, options, names, onChange, testId }: { value: T; options: readonly T[]; names: Record<T, string>; onChange: (value: T) => void; testId?: string }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value as T)} data-testid={testId} onKeyDown={(event) => event.stopPropagation()}>
      {options.map((option) => (
        <option key={option} value={option}>
          {names[option]}
        </option>
      ))}
    </select>
  );
}

function Toggle({ checked, onChange, label, testId, disabled }: { checked: boolean; onChange: (checked: boolean) => void; label: string; testId?: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="toggle" onClick={() => onChange(!checked)} aria-label={label} data-testid={testId} disabled={disabled}>
      <i />
    </button>
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
      <button type="button" className="head-action" onClick={duplicateSelection} title="Duplicate (Ctrl+D)" aria-label="Duplicate" data-testid="duplicate">
        <CopyIcon size={15} />
      </button>
      <button type="button" className="head-action" onClick={deleteSelection} title="Delete (Del)" aria-label="Delete" data-testid="delete">
        <TrashIcon size={15} />
      </button>
    </div>
  );
}

// ---- the selection -------------------------------------------------------------------------------

const span = (from: number, to: number) => `${formatTime(from)} → ${formatTime(to)}`;
const set = (list: ListName, id: string, fields: Record<string, unknown>, label: string) => edit([{ type: 'set', list, id, fields }], label);

/** Where an overlay shows in the video (the clicked stretch, else its first) and the speed there. */
function stretchOf(project: CuttleProject, selection: Selection, from: number, to: number): { start: number; end: number; speed: number } | undefined {
  const spans = sceneSpans(project.scenes);
  const speedAt = (t: number) => {
    const scene = spans.find((item) => t >= item.start - 1e-9 && t < item.end)?.scene;
    return scene?.type === 'clip' ? scene.speed : 1;
  };
  if (selection.start !== undefined && selection.end !== undefined) return { start: selection.start, end: selection.end, speed: speedAt(selection.start) };
  const start = outputTimesOf(spans, from)[0];
  if (start === undefined) return undefined;
  const end = outputTimesOf(spans, Math.max(from, to - 1e-6)).find((time) => time >= start) ?? start;
  return { start, end, speed: speedAt(start) };
}

/** What the empty inspector says: how to start with the tool in hand. */
const HINTS: Record<Tool, ReactNode> = {
  select: (
    <ul className="hint-list">
      <li>Click a scene, zoom, mask or caption on the timeline, or a caption on the video, to change it here.</li>
      <li>
        <kbd>S</kbd> splits at the playhead, <kbd>R</kbd> speeds a clip up, <kbd>Del</kbd> deletes.
      </li>
      <li>
        <kbd>Z</kbd> zoom, <kbd>M</kbd> mask, <kbd>T</kbd> caption; <kbd>Ctrl+K</kbd> finds any command.
      </li>
    </ul>
  ),
  zoom: <p className="hint">Zoom tool: drag on the screen over what the video should show close up. It starts at the playhead and lasts 3 s. Esc goes back.</p>,
  mask: <p className="hint">Mask tool: drag on the screen over what the video must not show (a password, an address). It lasts from the playhead to the end of the clip. Esc goes back.</p>,
  caption: <p className="hint">Caption tool: type the caption in the bar and press Enter; it shows at the playhead for 3 s. Esc goes back.</p>,
};

function SelectionPanel() {
  const selection = useStore(store, (state) => state.selection);
  const tool = useStore(store, (state) => state.tool);
  // a drag in progress shows here as it goes
  const project = useStore(store, (state) => state.doc?.preview ?? state.doc?.project);
  if (!project || !selection) return HINTS[tool];
  const list = LIST_OF[selection.kind];
  const item = (project[list] as { id?: string }[]).find((candidate) => candidate.id === selection.id);
  if (!item) return <p className="hint">The selection is not in the project any more.</p>;
  return <Details project={project} selection={selection} />;
}

function Details({ project, selection }: { project: CuttleProject; selection: Selection }) {
  const id = selection.id;
  if (selection.kind === 'scene') {
    const scene = project.scenes.find((item) => item.id === id)!;
    const stretch = sceneSpans(project.scenes).find((item) => item.scene === scene);
    const inVideo = stretch && <Row label="In the video">{span(stretch.start, stretch.end)}</Row>;
    if (scene.type === 'clip') {
      const name = [scene.speed !== 1 ? formatSpeed(scene.speed) : '', scene.label ?? (scene.speed === 1 ? 'Clip' : '')].filter(Boolean).join(' ');
      return (
        <>
          <Head icon={<FilmIcon />} color="var(--text)" name={name} />
          <Row label="Label">
            <TextInput value={scene.label ?? ''} placeholder="Clip" onCommit={(value) => set('scenes', id, { label: value.trim() || undefined }, 'Rename clip')} testId="clip-label" />
          </Row>
          <div className="field">
            <span className="field-label">Speed</span>
            <div className="chips" role="group" aria-label="Speed">
              {SPEEDS.map((speed) => (
                <button key={speed} type="button" aria-pressed={scene.speed === speed} onClick={() => edit([{ type: 'speed', id, speed }], `Speed ${speed}×`)}>
                  {speed}×
                </button>
              ))}
            </div>
            <span className="field-input narrow">
              <NumberInput value={scene.speed} min={0.25} max={64} step={0.5} onCommit={(speed) => edit([{ type: 'speed', id, speed }], `Speed ${speed}×`)} testId="clip-speed" />
              <em>× · {stretch ? formatDuration(stretch.end - stretch.start) : ''} in the video</em>
            </span>
          </div>
          {inVideo}
          <div className="grid2">
            <Row label="From (take s)">
              <NumberInput value={scene.from} min={0} onCommit={(from) => edit([{ type: 'trim', id, from }], 'Trim clip')} testId="clip-from" />
            </Row>
            <Row label="To (take s)">
              <NumberInput value={scene.to} min={0} onCommit={(to) => edit([{ type: 'trim', id, to }], 'Trim clip')} testId="clip-to" />
            </Row>
          </div>
          <Row label="Badge" note={scene.badge === undefined ? 'shows the speed when sped up' : undefined}>
            <TextInput value={scene.badge ?? ''} placeholder={scene.speed > 1 ? `${formatSpeed(scene.speed)} speed` : 'none'} onCommit={(value) => set('scenes', id, { badge: value === '' ? undefined : value }, 'Change badge')} />
          </Row>
        </>
      );
    }
    if (scene.type === 'still') {
      return (
        <>
          <Head icon={<PageIcon />} color="var(--still)" name={scene.label ?? scene.image.split(/[\\/]/).at(-1)!} />
          <Row label="Label">
            <TextInput value={scene.label ?? ''} placeholder="Page" onCommit={(value) => set('scenes', id, { label: value.trim() || undefined }, 'Rename page')} />
          </Row>
          <Row label="Image" plain>
            <span className="path" title={scene.image}>
              {scene.image}
            </span>
            <button type="button" className="ghost small" onClick={() => void chooseImage('still', id)}>
              Replace…
            </button>
          </Row>
          {inVideo}
          <div className="grid2">
            <Row label="Length (s)">
              <NumberInput value={scene.duration} min={0.1} onCommit={(duration) => edit([{ type: 'trim', id, duration }], 'Change the length of the page')} />
            </Row>
            <Row label="Motion">
              <Select value={scene.motion} options={STILL_MOTIONS} names={MOTION_NAMES} onChange={(motion) => set('scenes', id, { motion }, 'Change motion')} />
            </Row>
          </div>
          <Row label="Frame">
            <Select value={scene.frame} options={FRAME_STYLES} names={FRAME_NAMES} onChange={(frame) => set('scenes', id, { frame }, 'Change frame')} />
          </Row>
        </>
      );
    }
    return (
      <>
        <Head icon={<CardIcon />} color="var(--card)" name={scene.label ?? 'Card'} />
        <Row label="Title">
          <TextInput value={scene.title} onCommit={(value) => value.trim() && set('scenes', id, { title: value.trim() }, 'Change title')} testId="card-title" />
        </Row>
        <Row label="Subtitle">
          <TextInput value={scene.subtitle ?? ''} placeholder="none" onCommit={(value) => set('scenes', id, { subtitle: value.trim() || undefined }, 'Change subtitle')} />
        </Row>
        {inVideo}
        <Row label="Length (s)">
          <NumberInput value={scene.duration} min={0.1} onCommit={(duration) => edit([{ type: 'trim', id, duration }], 'Change the length of the card')} />
        </Row>
      </>
    );
  }

  /** An overlay's place: in the video (read), its start in source seconds, its length in the video. */
  const timing = (list: 'zooms' | 'texts' | 'masks', from: number, to: number) => {
    const stretch = stretchOf(project, selection, from, to);
    const label = list === 'masks' ? 'mask' : list === 'zooms' ? 'zoom' : 'caption';
    return (
      <>
        <Row label="Shows at" note={formatSource(from)}>
          {stretch ? span(stretch.start, stretch.end) : 'Nowhere: no clip shows it'}
        </Row>
        {list === 'masks' ? (
          <div className="grid2">
            <Row label="From (take s)">
              <NumberInput value={from} min={0} onCommit={(value) => set('masks', id, { from: value, to: Math.max(to, value + 0.05) }, 'Move mask')} />
            </Row>
            <Row label="To (take s)">
              <NumberInput value={to} min={0} onCommit={(value) => set('masks', id, { to: value }, 'Change the length of the mask')} />
            </Row>
          </div>
        ) : (
          <div className="grid2">
            <Row label="Start (take s)">
              <NumberInput value={from} min={0} onCommit={(at) => set(list, id, { at }, `Move ${label}`)} testId={`${label}-at`} />
            </Row>
            <Row label="Length (s)" note={stretch && stretch.speed !== 1 ? `${formatDuration(to - from)} src` : undefined}>
              <NumberInput
                value={stretch ? (to - from) / stretch.speed : to - from}
                min={0.05}
                onCommit={(length) => set(list, id, { duration: length * (stretch?.speed ?? 1) }, `Change the length of the ${label}`)}
                testId={`${label}-length`}
              />
            </Row>
          </div>
        )}
      </>
    );
  };

  const area = (list: 'zooms' | 'masks', rect: Rect, label: string) => (
    <div className="field">
      <span className="field-label">
        Area, in source pixels
        <button type="button" className="link" onClick={() => setTool(list === 'zooms' ? 'zoom' : 'mask')}>
          Draw on the video
        </button>
      </span>
      <div className="grid4">
        {(['x', 'y', 'w', 'h'] as const).map((name, i) => (
          <label key={name} className="field-input">
            <em>{name}</em>
            <NumberInput value={rect[i]!} digits={0} step={1} min={i < 2 ? 0 : 8} onCommit={(value) => set(list, id, { rect: rect.map((old, j) => (j === i ? value : old)) }, `Change the ${label} area`)} />
          </label>
        ))}
      </div>
    </div>
  );

  const enabled = (list: 'zooms' | 'masks' | 'texts', on: boolean, label: string) => (
    <Row label="Show" inline>
      <em>{on ? 'On' : 'Off: kept, not in the video'}</em>
      <Toggle checked={on} label={`Show the ${label}`} onChange={(value) => set(list, id, { enabled: value ? undefined : false }, value ? `Turn ${label} on` : `Turn ${label} off`)} />
    </Row>
  );

  if (selection.kind === 'zoom') {
    const zoom = project.zooms.find((item) => item.id === id)!;
    return (
      <>
        <Head icon={<ZoomIcon />} color="var(--zoom)" name={zoom.label ?? 'Zoom'} />
        <Row label="Label">
          <TextInput value={zoom.label ?? ''} placeholder="Zoom" onCommit={(value) => set('zooms', id, { label: value.trim() || undefined }, 'Rename zoom')} />
        </Row>
        {timing('zooms', zoom.at, zoom.at + zoom.duration)}
        {area('zooms', zoom.rect, 'zoom')}
        <Row label="Easing">
          <Select value={zoom.ease} options={EASES} names={EASE_NAMES} onChange={(ease) => set('zooms', id, { ease }, 'Change easing')} />
        </Row>
        {enabled('zooms', zoom.enabled, 'zoom')}
      </>
    );
  }
  if (selection.kind === 'mask') {
    const mask = project.masks.find((item) => item.id === id)!;
    return (
      <>
        <Head icon={<MaskIcon />} color="var(--mask)" name={mask.label ?? 'Mask'} />
        <Row label="Label">
          <TextInput value={mask.label ?? ''} placeholder="Mask" onCommit={(value) => set('masks', id, { label: value.trim() || undefined }, 'Rename mask')} />
        </Row>
        {timing('masks', mask.from, mask.to)}
        {area('masks', mask.rect, 'mask')}
        <Row label="Style">
          <Select value={mask.style} options={MASK_STYLES} names={MASK_STYLE_NAMES} onChange={(style) => set('masks', id, { style }, 'Change mask style')} />
        </Row>
        {enabled('masks', mask.enabled, 'mask')}
      </>
    );
  }
  const text = project.texts.find((item) => item.id === id)!;
  return (
    <>
      <Head icon={<TextIcon />} color="var(--caption)" name={text.label ?? 'Caption'} />
      <Row label="Text" wide>
        <TextInput value={text.text} multiline onCommit={(value) => value.trim() && set('texts', id, { text: value }, 'Edit caption')} testId="caption-text" />
      </Row>
      {timing('texts', text.at, text.at + text.duration)}
      <div className="grid2">
        <Row label="Style">
          <Select value={text.style} options={TEXT_STYLES} names={TEXT_STYLE_NAMES} onChange={(style) => set('texts', id, { style }, 'Change caption style')} />
        </Row>
        <Row label="Position">
          <Select value={text.position} options={TEXT_POSITIONS} names={POSITION_NAMES} onChange={(position) => set('texts', id, { position }, 'Move caption')} />
        </Row>
      </div>
      <Row label="Label">
        <TextInput value={text.label ?? ''} placeholder="Caption" onCommit={(value) => set('texts', id, { label: value.trim() || undefined }, 'Rename caption')} />
      </Row>
      {enabled('texts', text.enabled, 'caption')}
    </>
  );
}

// ---- the look ------------------------------------------------------------------------------------

const look = (path: string[], value: unknown, label: string) => edit([{ type: 'look', path, value } as Command], label);

/**
 * A colour well: the video follows the picker while it moves, and the colour is one step to undo
 * once the picker closes (its native change), not one per move.
 */
function ColorInput({ value, path, label, upper }: { value: string; path: string[]; label: string; upper?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const shape = (colour: string) => (upper ? colour.toUpperCase() : colour);
  useEffect(() => {
    const element = input.current;
    if (!element) return;
    const commit = () => {
      preview(undefined);
      look(path, shape(element.value), label);
    };
    element.addEventListener('change', commit);
    return () => element.removeEventListener('change', commit);
  }, [path.join('.'), label, upper]);
  // uncontrolled while it is picked: a new version of the look resets it (`key`)
  return (
    <input
      key={value}
      ref={input}
      type="color"
      defaultValue={value.toLowerCase()}
      onInput={(event) => preview([{ type: 'look', path, value: shape((event.target as HTMLInputElement).value) } as Command])}
      aria-label={label}
    />
  );
}

const SIZES = [
  { name: '16:9', ...EXPORT_FORMATS['16:9'] },
  { name: '1:1', ...EXPORT_FORMATS['1:1'] },
  { name: '9:16', ...EXPORT_FORMATS['9:16'] },
];

function LookPanel() {
  const project = useStore(store, (state) => state.doc?.project);
  const raw = useStore(store, (state) => state.doc?.raw);
  if (!project || !raw) return null;
  const { look: current, output, sources } = project;
  const size = SIZES.find((item) => item.width === output.width && item.height === output.height);
  return (
    <>
      <div className="section-title">Output</div>
      <Row label="Size" note={`${output.fps} fps`}>
        <select
          value={size?.name ?? 'custom'}
          data-testid="output-size"
          onChange={(event) => {
            const chosen = SIZES.find((item) => item.name === event.target.value);
            if (chosen) edit([{ type: 'output', width: chosen.width, height: chosen.height }], `Output ${chosen.name}`);
          }}
        >
          {!size && <option value="custom">{`${output.width} × ${output.height}`}</option>}
          {SIZES.map((item) => (
            <option key={item.name} value={item.name}>
              {`${item.name} · ${item.width} × ${item.height}`}
            </option>
          ))}
        </select>
      </Row>

      <div className="section-title">Background</div>
      <div className="swatches" role="group" aria-label="Background">
        {BACKGROUND_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className={`swatch-button bg-${preset}`}
            aria-pressed={current.background.preset === preset}
            title={BACKGROUND_NAMES[preset]}
            onClick={() => {
              if (preset === 'image') return void chooseImage('background');
              look(['background'], preset === 'solid' ? { preset, color: current.background.color ?? '#1c1c22' } : { preset }, `Background: ${BACKGROUND_NAMES[preset]}`);
            }}
          >
            <span>{BACKGROUND_NAMES[preset]}</span>
          </button>
        ))}
      </div>
      {current.background.preset === 'solid' && (
        <Row label="Colour">
          <ColorInput value={current.background.color ?? '#1c1c22'} path={['background', 'color']} label="Background colour" />
        </Row>
      )}
      {current.background.preset === 'image' && current.background.image && (
        <Row label="Image" plain>
          <span className="path" title={current.background.image}>
            {current.background.image}
          </span>
          <button type="button" className="ghost small" onClick={() => void chooseImage('background')}>
            Replace…
          </button>
        </Row>
      )}

      <div className="section-title">Window frame</div>
      <Row label="Frame" inline>
        <Toggle checked={current.frame.enabled} label="Window frame" onChange={(on) => look(['frame', 'enabled'], on, on ? 'Window frame on' : 'Window frame off')} />
      </Row>
      {current.frame.enabled && (
        <>
          <Row label="Style">
            <Select value={current.frame.style} options={FRAME_STYLES} names={FRAME_NAMES} onChange={(style) => look(['frame', 'style'], style, 'Frame style')} testId="frame-style" />
          </Row>
          <Row label="Title">
            <TextInput value={current.frame.title} placeholder="none" onCommit={(title) => look(['frame', 'title'], title, 'Frame title')} />
          </Row>
          <div className="grid2">
            <Row label="Corners (px)">
              <NumberInput value={current.frame.radius} min={0} max={48} step={1} digits={0} onCommit={(radius) => look(['frame', 'radius'], radius, 'Frame corners')} />
            </Row>
            <Row label="Shadow" inline>
              <Toggle checked={current.frame.shadow} label="Shadow" onChange={(on) => look(['frame', 'shadow'], on, on ? 'Shadow on' : 'Shadow off')} />
            </Row>
          </div>
        </>
      )}

      <div className="section-title">Cursor</div>
      <Row label="Cursor" inline>
        <Toggle checked={current.cursor.enabled} label="Cursor" onChange={(on) => look(['cursor', 'enabled'], on, on ? 'Cursor on' : 'Cursor off')} />
      </Row>
      {current.cursor.enabled && (
        <>
          <Row label="Style">
            <Select value={current.cursor.style} options={CURSOR_STYLES} names={CURSOR_NAMES} onChange={(style) => look(['cursor', 'style'], style, 'Cursor style')} />
          </Row>
          <div className="grid2">
            <Row label="Size">
              <NumberInput value={current.cursor.size} min={0.5} max={4} step={0.25} onCommit={(value) => look(['cursor', 'size'], value, 'Cursor size')} />
            </Row>
            <Row label="Colour">
              <ColorInput value={current.cursor.color} path={['cursor', 'color']} label="Cursor colour" upper />
            </Row>
          </div>
          <Row label="Clicks">
            <Select value={current.cursor.clickEffect} options={CLICK_EFFECTS} names={CLICK_NAMES} onChange={(effect) => look(['cursor', 'clickEffect'], effect, 'Click effect')} />
          </Row>
        </>
      )}

      <div className="section-title">Webcam</div>
      <Row label="Bubble" inline note={sources.webcam ? undefined : 'no webcam in this take'}>
        <Toggle checked={current.webcam.enabled} disabled={!sources.webcam} label="Webcam bubble" onChange={(on) => look(['webcam', 'enabled'], on, on ? 'Webcam on' : 'Webcam off')} />
      </Row>
      {current.webcam.enabled && sources.webcam && (
        <>
          <div className="grid2">
            <Row label="Shape">
              <Select value={current.webcam.shape} options={WEBCAM_SHAPES} names={WEBCAM_SHAPE_NAMES} onChange={(shape) => look(['webcam', 'shape'], shape, 'Webcam shape')} />
            </Row>
            <Row label="Corner">
              <Select value={current.webcam.corner} options={WEBCAM_CORNERS} names={CORNER_NAMES} onChange={(corner) => look(['webcam', 'corner'], corner, 'Webcam corner')} />
            </Row>
          </div>
          <Row label="Size" note="% of the output's height">
            <NumberInput value={current.webcam.size * 100} min={8} max={50} step={1} digits={0} onCommit={(value) => look(['webcam', 'size'], value / 100, 'Webcam size')} />
          </Row>
        </>
      )}

      <div className="section-title">Sound and transitions</div>
      <Row label="Mic" inline>
        <Toggle checked={current.audio.enabled} label="Mic sound" onChange={(on) => look(['audio', 'enabled'], on, on ? 'Sound on' : 'Sound off')} />
      </Row>
      {current.audio.enabled && (
        <Row label="Sped-up clips" inline>
          <Toggle checked={current.audio.muteSpedUp} label="Silent when sped up" onChange={(on) => look(['audio', 'muteSpedUp'], on, on ? 'Sped-up clips silent' : 'Sped-up clips heard')} />
          <em>{current.audio.muteSpedUp ? 'Silent' : 'Heard'}</em>
        </Row>
      )}
      <Row label="Crossfade" inline>
        <Toggle checked={current.transition.enabled} label="Crossfade at cuts" onChange={(on) => look(['transition', 'enabled'], on, on ? 'Crossfade on' : 'Crossfade off')} />
      </Row>
      {current.transition.enabled && (
        <Row label="Length (s)">
          <NumberInput value={current.transition.duration} min={0} max={2} step={0.1} onCommit={(value) => look(['transition', 'duration'], value, 'Crossfade length')} />
        </Row>
      )}
    </>
  );
}
