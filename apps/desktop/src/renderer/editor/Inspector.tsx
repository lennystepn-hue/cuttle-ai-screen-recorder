// The inspector: the selection's settings and the look, edited in place. A field saves when it is
// left or Enter is pressed (text also every 2 s while typing); each save is one step to undo.
// Output times read m:ss.t, take seconds "54.4 s into the take", lengths "2.5 s". While cuttle.json
// does not parse, every field is off (editing waits).
import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode } from 'react';
import { EXPORT_FORMATS } from '@cuttle/export/formats';
import {
  BACKGROUND_PRESETS,
  CAPTION_STYLES,
  CLICK_EFFECTS,
  CURSOR_STYLES,
  EASES,
  FRAME_STYLES,
  MASK_STYLES,
  STILL_MOTIONS,
  TEXT_POSITIONS,
  TEXT_STYLES,
  WEBCAM_CORNERS,
  WEBCAM_SHAPES,
  type AutoEdits,
  type AutoKind,
  type CuttleProject,
  type MotionOverlay,
  type MotionScene,
  type Music,
  type Rect,
} from '@cuttle/project';
import type { ParamDeclaration } from '@cuttle/export/motion-params';
import { sceneSpans, type SceneSpan } from '@cuttle/timeline';
import type { Command, ListName } from '../../shared/document';
import type { MotionParams, MotionStatusView, SoundStatusView } from '../../shared/ipc';
import { formatDuration, formatSource, formatSpeed, formatTime } from '../../shared/format';
import {
  BACKGROUND_NAMES,
  CAPTION_STYLE_NAMES,
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
import { motionName, outputTimesOf, soundName } from '../../shared/timeline-model';
import { BUILT_IN_SOUNDS } from '@cuttle/motion-kit';
import {
  BackgroundIcon,
  CameraIcon,
  CardIcon,
  CheckIcon,
  ChevronIcon,
  CopyIcon,
  CropIcon,
  FilmIcon,
  MaskIcon,
  MotionIcon,
  PageIcon,
  SelectIcon,
  SoundIcon,
  SplitIcon,
  SubtitlesIcon,
  TextIcon,
  TrashIcon,
  WindowIcon,
  ZoomIcon,
} from '../icons';
import { bridge } from '../bridge';
import { Select as StyledSelect } from '../Select';
import { chooseImage, cutShownAt, deleteSelection, duplicateSelection, LIST_OF, playheadPlace, reveal, SPEEDS } from './actions';
import { edit, preview } from './doc';
import { currentPlayer, engineAssets, select, setTool, store, type LookSection, type Selection, type Tool } from './session';
import { isColoured, swatch, type SwatchKey } from './swatches';
import { useStore } from './store';
import { PrivacyNote } from './PrivacyNote';
import { SpeechNote, TranscriptPanel } from './Transcript';

const TABS = [
  { id: 'selection', name: 'Selection' },
  { id: 'auto', name: 'Auto' },
  { id: 'transcript', name: 'Transcript' },
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
          {tab === 'selection' ? <SelectionPanel /> : tab === 'auto' ? <AutoPanel /> : tab === 'transcript' ? <TranscriptPanel /> : <LookPanel />}
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
        {note !== undefined && <em title={typeof note === 'string' ? note : undefined}>{note}</em>}
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
      if (event.key === 'Enter' && (!multiline || event.ctrlKey || event.metaKey)) {
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
    <StyledSelect value={value} options={options.map((option) => ({ value: option, label: names[option] }))} onChange={onChange} label={names[value] ?? value} testId={testId} />
  );
}

/**
 * How smooth the cursor's path is: the steps the menu offers (ones far enough apart to see), and a
 * value set in cuttle.json kept as it is.
 */
const SMOOTHING: { value: number; name: string }[] = [
  { value: 0, name: 'As recorded' },
  { value: 0.5, name: 'Smooth (default)' },
  { value: 1, name: 'Very smooth' },
];

function SmoothingSelect({ value }: { value: number }) {
  const known = SMOOTHING.some((step) => step.value === value);
  return (
    <StyledSelect
      value={String(value)}
      options={[...(known ? [] : [{ value: String(value), label: `${value} (from cuttle.json)` }]), ...SMOOTHING.map((step) => ({ value: String(step.value), label: step.name }))]}
      onChange={(chosen) => look(['cursor', 'smoothing'], Number(chosen), 'Cursor movement')}
      label="Cursor movement"
      testId="cursor-smoothing"
    />
  );
}

/**
 * A style's picture, drawn by the engine (see swatches.ts): undefined while it is drawn, false when
 * it could not be. The engine's assets come with the project, so it is drawn once that is open; a
 * coloured one is drawn again when the colour settles, the old picture showing meanwhile.
 */
function useSwatch(key: SwatchKey, color: string): string | false | undefined {
  const ready = useStore(store, (state) => state.phase === 'ready');
  const [picture, setPicture] = useState<string | false>();
  const tint = isColoured(key) ? color : '';
  useEffect(() => {
    if (!ready || !engineAssets) return;
    const assets = engineAssets;
    let live = true;
    const timer = setTimeout(
      () =>
        swatch(assets, key, tint).then(
          (url) => live && setPicture(url),
          () => live && setPicture(false),
        ),
      picture ? 150 : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [ready, key, tint]);
  return picture;
}

function PictureSwatch({ swatchKey, name, title, pressed, color, onPick }: { swatchKey: SwatchKey; name: string; title?: string; pressed: boolean; color: string; onPick: () => void }) {
  const picture = useSwatch(swatchKey, color);
  return (
    <button type="button" className="picture-swatch" aria-pressed={pressed} title={title ?? name} onClick={onPick} data-testid={swatchKey.replace(':', '-')}>
      <span className="picture">{picture ? <img src={picture} alt="" draggable={false} /> : <i className={`swatch-wait${picture === false ? ' failed' : ''}`} aria-hidden />}</span>
      <span className="name">{name}</span>
    </button>
  );
}

/** The engine's own pictures of the cursor or frame styles, to pick one by sight; the name under each. */
function PictureSwatches<T extends string>({
  label,
  kind,
  options,
  names,
  titles,
  value,
  color,
  onPick,
}: {
  label: string;
  kind: 'cursor' | 'frame';
  options: readonly T[];
  names: Record<T, string>;
  titles?: Partial<Record<T, string>>;
  value: T;
  color: string;
  onPick: (value: T) => void;
}) {
  return (
    <div className={`swatches picture-swatches ${kind}s`} role="group" aria-label={label}>
      {options.map((option) => (
        <PictureSwatch key={option} swatchKey={`${kind}:${option}` as SwatchKey} name={names[option]} title={titles?.[option]} pressed={value === option} color={color} onPick={() => onPick(option)} />
      ))}
    </div>
  );
}

const CURSOR_TITLES: Partial<Record<(typeof CURSOR_STYLES)[number], string>> = {
  system: 'System: changes shape like the real pointer (arrow, hand, text beam…)',
  spotlight: 'Spotlight: a light around the pointer, the rest of the screen dimmed',
};

/** A cut: a stretch of the take the video jumps over, its place, its range, on or off. */
function CutDetails({ project, id }: { project: CuttleProject; id: string }) {
  const cut = project.cuts.find((item) => item.id === id)!;
  const at = cutShownAt(sceneSpans(project.scenes, project.cuts), cut);
  return (
    <>
      <Head icon={<SplitIcon />} color="var(--text)" name={cut.label ?? 'Cut'} copies={false} />
      <AutoNote kind={cut.auto} />
      <Row label="Label">
        <TextInput value={cut.label ?? ''} placeholder="Cut" onCommit={(value) => set('cuts', id, { label: value.trim() || undefined }, 'Rename cut')} />
      </Row>
      <Row label="In the video">{at === undefined ? 'Nowhere: no clip plays this stretch' : `${cut.enabled ? 'jumps at' : 'would jump at'} ${formatTime(at)}`}</Row>
      <div className="grid2">
        <Row label="From (take s)">
          <NumberInput value={cut.from} min={0} onCommit={(from) => set('cuts', id, { from, to: Math.max(cut.to, from + 0.05) }, 'Change cut')} testId="cut-from" />
        </Row>
        <Row label="To (take s)">
          <NumberInput value={cut.to} min={0} onCommit={(to) => set('cuts', id, { to }, 'Change cut')} testId="cut-to" />
        </Row>
      </div>
      <Row label="Takes out">{formatDuration(cut.to - cut.from)} of the take</Row>
      <Row label="Cut" inline>
        <em>{cut.enabled ? 'On: the video jumps over it' : 'Off: the video plays it'}</em>
        <Toggle checked={cut.enabled} label="Cut this stretch" onChange={(on) => set('cuts', id, { enabled: on ? undefined : false }, on ? 'Cut on' : 'Cut off')} testId="cut-enabled" />
      </Row>
    </>
  );
}

/** A clip's crop: the part of the screen it shows, in source pixels, on or off. */
function CropDetails({ project, id }: { project: CuttleProject; id: string }) {
  const clip = project.scenes.find((scene) => scene.id === id);
  if (clip?.type !== 'clip' || !clip.crop) return <p className="hint">This clip has no crop any more.</p>;
  const crop = clip.crop;
  const setCrop = (fields: { rect?: Rect; enabled?: boolean }, label: string) => {
    const rect = fields.rect ?? crop.rect;
    const enabled = fields.enabled ?? crop.enabled;
    // switching keeps it Cuttle's; a new area makes it the person's
    const auto = fields.rect === undefined ? crop.auto : undefined;
    set('scenes', id, { crop: { rect, ...(!enabled && { enabled: false }), ...(auto && { auto }) } }, label);
  };
  return (
    <>
      <Head icon={<CropIcon />} color="var(--text)" name={`Crop of ${clip.label ?? 'the clip'}`} copies={false} />
      <AutoNote kind={crop.auto} />
      <div className="field">
        <span className="field-label">
          Area, in source pixels
          <button type="button" className="link" onClick={() => setTool('crop')}>
            Draw on the video
          </button>
        </span>
        <div className="grid4">
          {(['x', 'y', 'w', 'h'] as const).map((name, i) => (
            <label key={name} className="field-input">
              <em>{name}</em>
              <NumberInput value={crop.rect[i]!} digits={0} step={1} min={i < 2 ? 0 : 8} onCommit={(value) => setCrop({ rect: crop.rect.map((old, j) => (j === i ? value : old)) as Rect }, 'Change the crop')} />
            </label>
          ))}
        </div>
      </div>
      <Row label="Crop" inline>
        <em>{crop.enabled ? 'On: the clip shows this part' : 'Off: the whole screen shows'}</em>
        <Toggle checked={crop.enabled} label="Crop the clip" onChange={(on) => setCrop({ enabled: on }, on ? 'Crop on' : 'Crop off')} testId="crop-enabled" />
      </Row>
    </>
  );
}

// ---- what Cuttle did on its own ------------------------------------------------------------------

interface AutoItem {
  kind: Exclude<Selection['kind'], 'music'>;
  id: string;
  label: string;
  enabled: boolean;
  /** Output seconds where the video shows it. */
  at?: number;
}

interface AutoGroup {
  id: string;
  title: string;
  icon: ReactNode;
  kinds: AutoKind[];
  /** The switch in `autoEdits`; none for one-off edits (the length fit). */
  key?: keyof AutoEdits;
}

const AUTO_GROUPS: AutoGroup[] = [
  { id: 'crop', title: 'Cropped to the content', icon: <CropIcon />, kinds: ['crop'], key: 'crop' },
  { id: 'privacy', title: 'Private things masked', icon: <MaskIcon />, kinds: ['privacy', 'notification'], key: 'privacy' },
  { id: 'retakes', title: 'Retakes cut', icon: <SplitIcon />, kinds: ['retake'], key: 'retakes' },
  { id: 'fillers', title: 'Filler words cut', icon: <SplitIcon />, kinds: ['filler'], key: 'fillers' },
  { id: 'pauses', title: 'Pauses shortened', icon: <SplitIcon />, kinds: ['pause'], key: 'pauses' },
  { id: 'length', title: 'Cut to fit the length', icon: <SplitIcon />, kinds: ['length'] },
  { id: 'typing', title: 'Zooms while typing', icon: <ZoomIcon />, kinds: ['typing'], key: 'typingZooms' },
  { id: 'dialog', title: 'Zooms on dialogs', icon: <ZoomIcon />, kinds: ['dialog'], key: 'dialogZooms' },
  { id: 'click', title: 'Zooms on clicks', icon: <ZoomIcon />, kinds: ['click'], key: 'clickZooms' },
  { id: 'answer', title: 'Zoom on Claude’s answer', icon: <ZoomIcon />, kinds: ['answer'], key: 'answerZoom' },
];

/** The automatic items of a group, in the order the video shows them. */
function autoItems(project: CuttleProject, spans: readonly SceneSpan[], group: AutoGroup): AutoItem[] {
  const items: AutoItem[] = [];
  const of = (kind?: AutoKind) => kind !== undefined && group.kinds.includes(kind);
  for (const zoom of project.zooms) if (of(zoom.auto) && zoom.id) items.push({ kind: 'zoom', id: zoom.id, label: zoom.label ?? 'Zoom', enabled: zoom.enabled, at: outputTimesOf(spans, zoom.at)[0] });
  for (const mask of project.masks) if (of(mask.auto) && mask.id) items.push({ kind: 'mask', id: mask.id, label: mask.label ?? 'Mask', enabled: mask.enabled, at: outputTimesOf(spans, mask.from)[0] });
  for (const cut of project.cuts) if (of(cut.auto) && cut.id) items.push({ kind: 'cut', id: cut.id, label: cut.label ?? 'Cut', enabled: cut.enabled, at: cutShownAt(spans, cut) });
  project.scenes.forEach((scene, index) => {
    if (scene.type === 'clip' && scene.id && of(scene.crop?.auto)) {
      items.push({ kind: 'crop', id: scene.id, label: `${scene.label ?? 'Clip'}: ${Math.round(scene.crop!.rect[2])} × ${Math.round(scene.crop!.rect[3])}`, enabled: scene.crop!.enabled, at: sceneStretch(spans, index)?.start });
    }
  });
  return items.sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity));
}

/** The command that switches an automatic item on or off. */
function switchItem(project: CuttleProject, item: AutoItem, on: boolean): Command {
  if (item.kind === 'crop') {
    const clip = project.scenes.find((scene) => scene.id === item.id);
    const crop = clip?.type === 'clip' ? clip.crop! : { rect: [0, 0, 8, 8] as Rect, enabled: true };
    return { type: 'set', list: 'scenes', id: item.id, fields: { crop: { rect: crop.rect, ...(!on && { enabled: false }), auto: 'crop' } } };
  }
  return { type: 'set', list: LIST_OF[item.kind], id: item.id, fields: { enabled: on ? undefined : false } };
}

/** What Cuttle did on its own, kind by kind: a switch per kind and per item, and where each shows. */
function AutoPanel() {
  const project = useStore(store, (state) => state.doc?.project);
  const [open, setOpen] = useState<string>();
  if (!project) return null;
  const spans = sceneSpans(project.scenes, project.cuts);
  const groups = AUTO_GROUPS.map((group) => ({ group, items: autoItems(project, spans, group) })).filter(
    ({ group, items }) => items.length > 0 || (group.key !== undefined && !project.autoEdits[group.key]),
  );
  if (groups.length === 0) {
    return (
      <div className="auto-empty" data-testid="auto-empty">
        <SpeechNote />
        <PrivacyNote />
        <p>
          <b>Nothing automatic yet.</b>
        </p>
        <p className="hint">Cuttle’s cut of a take adds its zooms here. Each automatic edit shows here with its reason: switch any off, or a whole kind.</p>
      </div>
    );
  }
  const switchKind = (group: AutoGroup, items: AutoItem[], on: boolean) => {
    const commands: Command[] = [
      ...(group.key ? [{ type: 'auto-edits', kind: group.key, value: on } as Command] : []),
      ...items.filter((item) => item.enabled !== on).map((item) => switchItem(project, item, on)),
    ];
    edit(commands, `${group.title}: ${on ? 'on' : 'off'}`);
  };
  return (
    <div className="auto-panel" data-testid="auto-panel">
      <p className="hint auto-intro">What Cuttle did on its own. Switch a kind off and it leaves the video and is not made again; change an item and it is yours.</p>
      <SpeechNote />
      <PrivacyNote />
      {groups.map(({ group, items }) => {
        const on = items.filter((item) => item.enabled).length;
        const kindOn = group.key ? project.autoEdits[group.key] : on > 0;
        const expanded = open === group.id;
        return (
          <section key={group.id} className={`auto-group${kindOn ? '' : ' off'}`} data-testid={`auto-group-${group.id}`}>
            <div className="auto-head">
              <button type="button" className="auto-toggle" aria-expanded={expanded} onClick={() => setOpen(expanded ? undefined : group.id)}>
                <span className="kind-icon">{group.icon}</span>
                <span className="auto-text">
                  <span className="auto-title">{group.title}</span>
                  <span className="auto-count">{items.length === 0 ? 'Off: not made again' : on === items.length ? `${on} on` : on === 0 ? `${items.length} off` : `${on} of ${items.length} on`}</span>
                </span>
                <ChevronIcon className="auto-chevron" />
              </button>
              <Toggle checked={kindOn} label={`${group.title}: ${kindOn ? 'on' : 'off'}`} onChange={(value) => switchKind(group, items, value)} testId={`auto-switch-${group.id}`} />
            </div>
            {expanded && (
              <ul className="auto-items">
                {items.length === 0 && <li className="hint">Off: Cuttle does not make these when it edits again.</li>}
                {items.map((item) => (
                  <li key={`${item.kind}-${item.id}`} className={item.enabled ? '' : 'off'}>
                    <button
                      type="button"
                      className="auto-item"
                      onClick={() => {
                        if (item.kind === 'crop') {
                          select({ kind: 'crop', id: item.id });
                          if (item.at !== undefined) void currentPlayer()?.seek(item.at);
                        } else reveal(LIST_OF[item.kind], item.id);
                      }}
                      title="Show it in the video and select it"
                    >
                      <span className="auto-time">{item.at === undefined ? '–' : formatTime(item.at)}</span>
                      <span className="auto-label">{item.label}</span>
                    </button>
                    <Toggle checked={item.enabled} label={`${item.label}: ${item.enabled ? 'on' : 'off'}`} onChange={(value) => edit([switchItem(project, item, value)], `${item.label}: ${value ? 'on' : 'off'}`)} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Toggle({ checked, onChange, label, testId, disabled }: { checked: boolean; onChange: (checked: boolean) => void; label: string; testId?: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="toggle" onClick={() => onChange(!checked)} aria-label={label} data-testid={testId} disabled={disabled}>
      <i />
    </button>
  );
}

/** The selection's kind, name, and its Duplicate (unless it cannot be copied) and Delete. */
function Head({ icon, color, name, copies = true }: { icon: ReactNode; color: string; name: string; copies?: boolean }) {
  return (
    <div className="kind-head">
      <span className="kind-icon" style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>
        {icon}
      </span>
      <span className="name" title={name}>
        {name}
      </span>
      {copies && (
        <button type="button" className="head-action" onClick={duplicateSelection} title="Duplicate (Ctrl+D)" aria-label="Duplicate" data-testid="duplicate">
          <CopyIcon size={15} />
        </button>
      )}
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
  const spans = sceneSpans(project.scenes, project.cuts);
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
  crop: <p className="hint">Crop tool: drag on the screen over the part the clip should show, leaving out tabs, bars or a taskbar. The window takes its shape. Esc goes back.</p>,
};

/** Why Cuttle made an automatic item, in a few words. */
const AUTO_REASONS: Record<AutoKind, string> = {
  crop: 'the content of the window',
  privacy: 'private text on screen',
  notification: 'a notification over the take',
  retake: 'a retake',
  filler: 'a filler word',
  pause: 'a pause',
  length: 'the length the video should have',
  typing: 'typing',
  dialog: 'a dialog',
  click: 'clicks',
  answer: "Claude's answer",
};

/** Says that Cuttle made the item, for what, and that a change makes it the person's. */
function AutoNote({ kind }: { kind?: AutoKind }) {
  if (!kind) return null;
  return (
    <p className="auto-note" data-testid="auto-note">
      <b>Made by Cuttle</b> for {AUTO_REASONS[kind]}. Change it and it is yours: Cuttle leaves it alone when it edits again.
    </p>
  );
}

/** Where a scene shows in the video: from its first piece's start to its last piece's end. */
function sceneStretch(spans: readonly SceneSpan[], index: number): { start: number; end: number } | undefined {
  const pieces = spans.filter((span) => span.sceneIndex === index);
  return pieces.length === 0 ? undefined : { start: pieces[0]!.start, end: pieces.at(-1)!.end };
}

function SelectionPanel() {
  const selection = useStore(store, (state) => state.selection);
  const tool = useStore(store, (state) => state.tool);
  // a drag in progress shows here as it goes
  const project = useStore(store, (state) => state.doc?.preview ?? state.doc?.project);
  if (!project || !selection) return HINTS[tool];
  if (selection.kind === 'music') return project.music ? <MusicDetails music={project.music} /> : <p className="hint">The music is not in the project any more.</p>;
  const list = LIST_OF[selection.kind];
  const item = (project[list] as { id?: string }[]).find((candidate) => candidate.id === selection.id);
  if (!item) return <p className="hint">The selection is not in the project any more.</p>;
  return <Details project={project} selection={selection} />;
}

function Details({ project, selection }: { project: CuttleProject; selection: Selection }) {
  const id = selection.id;
  if (selection.kind === 'cut') return <CutDetails project={project} id={id} />;
  if (selection.kind === 'crop') return <CropDetails project={project} id={id} />;
  if (selection.kind === 'scene') {
    const sceneIndex = project.scenes.findIndex((item) => item.id === id);
    const scene = project.scenes[sceneIndex]!;
    const stretch = sceneStretch(sceneSpans(project.scenes, project.cuts), sceneIndex);
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
          <Row label="Crop" plain note={scene.crop ? (scene.crop.auto ? 'Cuttle’s: the content of the window' : undefined) : 'the whole screen shows'}>
            {scene.crop ? (
              <button type="button" className="ghost small" onClick={() => select({ kind: 'crop', id })} data-testid="clip-crop">
                {`${Math.round(scene.crop.rect[2])} × ${Math.round(scene.crop.rect[3])}${scene.crop.enabled ? '' : ' · off'}`}
              </button>
            ) : (
              <button
                type="button"
                className="ghost small"
                onClick={() => {
                  // the crop tool works on the clip at the playhead: bring the playhead onto this one
                  if (playheadPlace()?.index !== sceneIndex && stretch) void currentPlayer()?.seek(stretch.start);
                  setTool('crop');
                }}
                data-testid="clip-crop"
              >
                Crop…
              </button>
            )}
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
    if (scene.type === 'motion') {
      return (
        <MotionDetails
          list="scenes"
          index={sceneIndex}
          item={scene}
          placement={
            <>
              {inVideo}
              <Row label="Length (s)">
                <NumberInput value={scene.duration} min={0.1} onCommit={(duration) => edit([{ type: 'trim', id, duration }], 'Change the length of the motion scene')} testId="motion-length" />
              </Row>
            </>
          }
        />
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
  const timing = (list: 'zooms' | 'texts' | 'masks' | 'overlays', from: number, to: number) => {
    const stretch = stretchOf(project, selection, from, to);
    const label = list === 'masks' ? 'mask' : list === 'zooms' ? 'zoom' : list === 'overlays' ? 'motion overlay' : 'caption';
    const testId = list === 'overlays' ? 'motion' : label;
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
              <NumberInput value={from} min={0} onCommit={(at) => set(list, id, { at }, `Move ${label}`)} testId={`${testId}-at`} />
            </Row>
            <Row label="Length (s)" note={stretch && stretch.speed !== 1 ? `${formatDuration(to - from)} src` : undefined}>
              <NumberInput
                value={stretch ? (to - from) / stretch.speed : to - from}
                min={0.05}
                onCommit={(length) => set(list, id, { duration: length * (stretch?.speed ?? 1) }, `Change the length of the ${label}`)}
                testId={`${testId}-length`}
              />
            </Row>
          </div>
        )}
      </>
    );
  };

  const area = (list: 'zooms' | 'masks', rect: Rect, label: string, title = 'Area, in source pixels') => (
    <div className="field">
      <span className="field-label">
        {title}
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

  const enabled = (list: 'zooms' | 'masks' | 'texts' | 'overlays', on: boolean, label: string) => (
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
        <AutoNote kind={zoom.auto} />
        <Row label="Label">
          <TextInput value={zoom.label ?? ''} placeholder="Zoom" onCommit={(value) => set('zooms', id, { label: value.trim() || undefined }, 'Rename zoom')} />
        </Row>
        {timing('zooms', zoom.at, zoom.at + zoom.duration)}
        {area('zooms', zoom.rect, 'zoom', zoom.moves?.length ? 'Start, in source pixels' : undefined)}
        {zoom.moves && zoom.moves.length > 0 && (
          <Row label="Follows" note={`${zoom.moves.length} move${zoom.moves.length === 1 ? '' : 's'}`} plain>
            <button type="button" className="ghost small" onClick={() => set('zooms', id, { moves: undefined }, 'Hold the zoom still')} data-testid="zoom-hold">
              Hold still
            </button>
          </Row>
        )}
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
        <AutoNote kind={mask.auto} />
        <Row label="Label">
          <TextInput value={mask.label ?? ''} placeholder="Mask" onCommit={(value) => set('masks', id, { label: value.trim() || undefined }, 'Rename mask')} />
        </Row>
        {timing('masks', mask.from, mask.to)}
        {area('masks', mask.rect, 'mask', mask.moves?.length ? 'Start, in source pixels' : undefined)}
        {mask.moves && mask.moves.length > 0 && (
          <Row label="Follows" note={`${mask.moves.length} move${mask.moves.length === 1 ? '' : 's'}`} plain>
            <button type="button" className="ghost small" onClick={() => set('masks', id, { moves: undefined }, 'Hold the mask still')} data-testid="mask-hold">
              Hold still
            </button>
          </Row>
        )}
        <Row label="Style">
          <Select value={mask.style} options={MASK_STYLES} names={MASK_STYLE_NAMES} onChange={(style) => set('masks', id, { style }, 'Change mask style')} />
        </Row>
        {enabled('masks', mask.enabled, 'mask')}
      </>
    );
  }
  if (selection.kind === 'motion') {
    const index = project.overlays.findIndex((item) => item.id === id);
    const overlay = project.overlays[index]!;
    return (
      <MotionDetails
        list="overlays"
        index={index}
        item={overlay}
        placement={
          <>
            {timing('overlays', overlay.at, overlay.at + overlay.duration)}
            {enabled('overlays', overlay.enabled, 'motion overlay')}
          </>
        }
      />
    );
  }
  if (selection.kind === 'sound') return <SoundDetails project={project} id={id} />;
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

// ---- music and sounds ----------------------------------------------------------------------------

/** The params the music page declares, read again with each new render (Claude edited the page). */
function useMusicParams(src: string): MotionParams | undefined {
  const rendered = useStore(store, (state) => state.soundStatus.key);
  const [read, setRead] = useState<{ src: string; params: MotionParams }>();
  useEffect(() => {
    let live = true;
    bridge.invoke('sound:params', src).then(
      (params) => live && setRead({ src, params }),
      (error: Error) => live && setRead({ src, params: { params: [], issues: [error.message] } }),
    );
    return () => {
      live = false;
    };
  }, [src, rendered]);
  return read?.src === src ? read.params : undefined;
}

const musicEdit = (fields: Record<string, unknown>): Command => ({ type: 'music', fields });

/**
 * The video's music: how its render is doing, its page, on or off, its level and how far it goes down
 * under speech, the params its page declares, what the page said.
 */
function MusicDetails({ music }: { music: Music }) {
  const status = useStore(store, (state) => state.soundStatus);
  const declared = useMusicParams(music.src);
  const info = status.info;
  const summary = [info?.bpm ? `${Math.round(info.bpm * 10) / 10} BPM` : '', info?.key ?? '', info?.sections?.length ? `${info.sections.length} parts` : ''].filter(Boolean).join(' · ');
  const values = music.params;
  const param = (name: string, value: unknown): Command => {
    const next: Record<string, unknown> = { ...values };
    if (value === undefined) delete next[name];
    else next[name] = value;
    return musicEdit({ params: next });
  };
  return (
    <>
      <Head icon={<SoundIcon />} color="var(--music)" name={`Music · ${motionName(music.src)}`} copies={false} />
      <MusicState status={status} />
      <div className="field">
        <span className="field-label">
          Page
          <span className="links">
            <button type="button" className="link" onClick={() => void bridge.invoke('project:reveal', music.src)} title="Show the page's file in its folder">
              Show file
            </button>
            <button type="button" className="link" onClick={() => void bridge.invoke('sound:reload')} title="Render the music again" data-testid="music-reload">
              Reload
            </button>
          </span>
        </span>
        <span className="field-input">
          <span className="path" title={music.src}>
            {music.src}
          </span>
        </span>
      </div>
      {summary && <Row label="Made">{summary}</Row>}
      <Row label="Music" inline>
        <em>{music.enabled ? 'On' : 'Off'}</em>
        <Toggle checked={music.enabled} label="Play the music" onChange={(on) => edit([musicEdit({ enabled: on ? undefined : false })], on ? 'Music on' : 'Music off')} testId="music-enabled" />
      </Row>
      <Row label={`Volume · ${Math.round(music.volume * 100)} %`}>
        <RangeInput value={Math.round(music.volume * 100)} min={0} max={100} label="Music volume" toCommand={(value) => musicEdit({ volume: value / 100 })} commitLabel="Music volume" testId="music-volume" />
      </Row>
      <Row label={`Under speech · ${music.duck > 0 ? `${music.duck} dB down` : 'stays as it is'}`}>
        <RangeInput value={music.duck} min={0} max={30} label="How far the music goes down under speech (dB)" toCommand={(value) => musicEdit({ duck: value })} commitLabel="Music under speech" testId="music-duck" />
      </Row>
      {declared && (declared.params.length > 0 || declared.issues.length > 0) && (
        <div className="motion-params" data-testid="music-params">
          <span className="section-title">Params</span>
          {declared.issues.map((issue) => (
            <p key={issue} className="note warning">
              {issue}
            </p>
          ))}
          {declared.params.map((declaration) => (
            <ParamField key={declaration.name} param={declaration} value={declaration.name in values ? values[declaration.name] : declaration.default} set={declaration.name in values} toCommand={(value) => param(declaration.name, value)} />
          ))}
        </div>
      )}
      <MotionLog status={{ item: 'music', src: music.src, state: status.state === 'failed' ? 'failed' : 'ready', errors: [...status.errors, ...status.skipped], console: status.console }} />
      <p className="hint motion-hint">Claude writes this music for the video: ask it in Claude Code for another mood, tempo or sound. A saved change plays here a moment later.</p>
    </>
  );
}

/** How the music's render is doing. */
function MusicState({ status }: { status: SoundStatusView }) {
  const errors = status.errors.length;
  const text =
    status.state === 'failed'
      ? `The music cannot render: ${status.failure ?? 'it failed'}`
      : status.state === 'rendering'
        ? 'Rendering the music…'
        : status.state === 'none'
          ? 'Waiting for the music'
          : errors > 0
            ? `Plays, but the page threw ${errors === 1 ? 'an error' : `${errors} errors`}`
            : `Ready${status.renderMs !== undefined ? ` · rendered in ${(status.renderMs / 1000).toFixed(1)} s` : ''}`;
  const state = status.state === 'ready' ? (errors > 0 ? 'warn' : 'ready') : status.state === 'failed' ? 'failed' : 'loading';
  return (
    <p className={`motion-state ${state}`} data-testid="music-state" title={text}>
      <i />
      {text}
    </p>
  );
}

/** A sound: which one, where it plays, how loud, on or off. */
function SoundDetails({ project, id }: { project: CuttleProject; id: string }) {
  const sound = project.sounds.find((item) => item.id === id)!;
  const scene = sound.scene !== undefined ? project.scenes.find((item) => item.id === sound.scene) : undefined;
  const options = [...BUILT_IN_SOUNDS.map(([name]) => name), ...(BUILT_IN_SOUNDS.some(([name]) => name === sound.sound) ? [] : [sound.sound])];
  return (
    <>
      <Head icon={<SoundIcon />} color="var(--sound)" name={sound.label ?? soundName(sound.sound)} />
      <Row label="Sound" note={BUILT_IN_SOUNDS.find(([name]) => name === sound.sound)?.[1] ?? 'a file of the project'}>
        <StyledSelect value={sound.sound} options={options.map((name) => ({ value: name, label: soundName(name) }))} onChange={(name) => set('sounds', id, { sound: name }, 'Change sound')} label="Sound" />
      </Row>
      <Row label={scene ? `Into ${scene.label ?? 'its scene'} (s)` : 'At (take s)'} note={scene ? undefined : formatSource(sound.at)}>
        <NumberInput value={sound.at} min={0} step={0.05} onCommit={(at) => set('sounds', id, { at }, 'Move sound')} testId="sound-at" />
      </Row>
      <Row label={`Volume · ${Math.round(sound.volume * 100)} %`}>
        <RangeInput value={Math.round(sound.volume * 100)} min={0} max={100} label="Sound volume" toCommand={(value) => ({ type: 'set', list: 'sounds', id, fields: { volume: value / 100 } })} commitLabel="Sound volume" testId="sound-volume" />
      </Row>
      <Row label="Label">
        <TextInput value={sound.label ?? ''} placeholder={soundName(sound.sound)} onCommit={(value) => set('sounds', id, { label: value.trim() || undefined }, 'Rename sound')} />
      </Row>
      <Row label="In the video" inline>
        <em>{sound.enabled ? 'On' : 'Off'}</em>
        <Toggle checked={sound.enabled} label="Play the sound" onChange={(on) => set('sounds', id, { enabled: on ? undefined : false }, on ? 'Sound on' : 'Sound off')} testId="sound-enabled" />
      </Row>
    </>
  );
}

// ---- motion --------------------------------------------------------------------------------------

/** The params a page declares, read again when the project's files change (Claude edited the page). */
function useMotionParams(src: string): MotionParams | undefined {
  const files = useStore(store, (state) => state.motionFiles);
  const [read, setRead] = useState<{ src: string; params: MotionParams }>();
  useEffect(() => {
    let live = true;
    bridge.invoke('motion:params', src).then(
      (params) => live && setRead({ src, params }),
      (error: Error) => live && setRead({ src, params: { params: [], issues: [error.message] } }),
    );
    return () => {
      live = false;
    };
  }, [src, files]);
  return read?.src === src ? read.params : undefined;
}

const BLUR_SAMPLES = ['4', '8', '16', '32'] as const;

/**
 * A motion scene or overlay: its page and how it is doing in the preview (what it threw, its
 * console), its place (`placement`), the params its page declares, the internet and motion blur.
 */
function MotionDetails({ list, index, item, placement }: { list: 'scenes' | 'overlays'; index: number; item: MotionScene | MotionOverlay; placement: ReactNode }) {
  const id = item.id!;
  const name = `${list}[${index}]`;
  const status = useStore(store, (state) => state.motionStatus.find((entry) => entry.item === name && entry.src === item.src));
  const declared = useMotionParams(item.src);
  const noun = list === 'scenes' ? 'motion scene' : 'motion overlay';
  const blur = item.motionBlur;
  return (
    <>
      <Head icon={<MotionIcon />} color="var(--motion)" name={item.label ?? motionName(item.src)} />
      <MotionState status={status} />
      <Row label="Label">
        <TextInput value={item.label ?? ''} placeholder={motionName(item.src)} onCommit={(value) => set(list, id, { label: value.trim() || undefined }, `Rename ${noun}`)} testId="motion-label" />
      </Row>
      <div className="field">
        <span className="field-label">
          Page
          <span className="links">
            <button type="button" className="link" onClick={() => void bridge.invoke('project:reveal', item.src)} title="Show the page's file in its folder">
              Show file
            </button>
            <button type="button" className="link" onClick={() => void bridge.invoke('motion:reload', name)} title="Load the page again" data-testid="motion-reload">
              Reload
            </button>
          </span>
        </span>
        <span className="field-input">
          <span className="path" title={item.src}>
            {item.src}
          </span>
        </span>
      </div>
      {placement}
      {declared && <MotionParamFields list={list} id={id} item={item} declared={declared} />}
      <Row label="Internet" inline>
        <em title={item.network ? 'The page may load fonts, images and data from https: addresses' : 'The page reaches only the project folder and the motion kit'}>{item.network ? 'On' : 'Off'}</em>
        <Toggle checked={item.network} label="Let the page load from the internet" onChange={(on) => set(list, id, { network: on || undefined }, on ? 'Let the page load from the internet' : 'Keep the page offline')} testId="motion-network" />
      </Row>
      <Row label="Motion blur" inline>
        <em title="Each frame is the average of moments while a shutter would be open: smooth fast motion, drawn that many times (slower)">{blur ? 'On' : 'Off'}</em>
        <Toggle checked={!!blur} label="Motion blur" onChange={(on) => set(list, id, { motionBlur: on ? { samples: 8, shutter: 0.5 } : undefined }, on ? 'Motion blur on' : 'Motion blur off')} testId="motion-blur" />
      </Row>
      {blur && (
        <div className="grid2">
          <Row label="Samples">
            <StyledSelect
              value={String(blur.samples)}
              options={[...new Set([...BLUR_SAMPLES, String(blur.samples)])].map((samples) => ({ value: samples, label: samples }))}
              onChange={(samples) => set(list, id, { motionBlur: { ...blur, samples: Number(samples) } }, 'Change motion blur')}
              label="Samples"
            />
          </Row>
          <Row label="Shutter" note="of a frame">
            <NumberInput value={blur.shutter} min={0.05} max={1} step={0.05} onCommit={(shutter) => set(list, id, { motionBlur: { ...blur, shutter } }, 'Change motion blur')} />
          </Row>
        </div>
      )}
      <MotionLog status={status} />
      <p className="hint motion-hint">Claude can change this page or write a new one: ask it in Claude Code. Each saved change shows here at once.</p>
    </>
  );
}

/** How the page is doing in the preview. */
function MotionState({ status }: { status: MotionStatusView | undefined }) {
  if (!status) return null;
  const errors = status.errors.length;
  const text =
    status.state === 'failed'
      ? `The page cannot draw: ${status.failure ?? 'it failed'}`
      : status.state === 'loading'
        ? 'Loading the page…'
        : errors > 0
          ? `Draws, but threw ${errors === 1 ? 'an error' : `${errors} errors`}`
          : 'Ready';
  return (
    <p className={`motion-state ${status.state === 'ready' && errors > 0 ? 'warn' : status.state}`} data-testid="motion-state" title={text}>
      <i />
      {text}
    </p>
  );
}

/** What the page threw, and its console. */
function MotionLog({ status }: { status: MotionStatusView | undefined }) {
  if (!status || (status.errors.length === 0 && status.console.length === 0)) return null;
  return (
    <div className="motion-log">
      {status.errors.length > 0 && (
        <details open>
          <summary>Errors ({status.errors.length})</summary>
          <pre data-testid="motion-errors">{status.errors.join('\n')}</pre>
        </details>
      )}
      {status.console.length > 0 && (
        <details>
          <summary>Console ({status.console.length})</summary>
          <pre>{status.console.join('\n')}</pre>
        </details>
      )}
    </div>
  );
}

/** The params the page declares, each in a field of its kind; ones the item has that the page does not declare, as text. */
function MotionParamFields({ list, id, item, declared }: { list: 'scenes' | 'overlays'; id: string; item: MotionScene | MotionOverlay; declared: MotionParams }) {
  const values = item.params;
  const command = (name: string, value: unknown): Command => {
    const next: Record<string, unknown> = { ...values };
    if (value === undefined) delete next[name];
    else next[name] = value;
    return { type: 'set', list, id, fields: { params: Object.keys(next).length > 0 ? next : undefined } };
  };
  const others = Object.keys(values).filter((name) => !declared.params.some((param) => param.name === name));
  if (declared.params.length === 0 && others.length === 0 && declared.issues.length === 0) return null;
  return (
    <div className="motion-params" data-testid="motion-params">
      <span className="section-title">Params</span>
      {declared.issues.map((issue) => (
        <p key={issue} className="note warning">
          {issue}
        </p>
      ))}
      {declared.params.map((param) => (
        <ParamField key={param.name} param={param} value={param.name in values ? values[param.name] : param.default} set={param.name in values} toCommand={(value) => command(param.name, value)} />
      ))}
      {others.map((name) => (
        <Row key={name} label={name} note="not declared by the page">
          <TextInput
            value={typeof values[name] === 'string' ? (values[name] as string) : JSON.stringify(values[name])}
            onCommit={(text) => {
              let value: unknown = text;
              try {
                value = JSON.parse(text);
              } catch {
                // plain text
              }
              edit([command(name, value)], `Change ${name}`);
            }}
          />
        </Row>
      ))}
    </div>
  );
}

/** One param: a field of its kind, live on the video while a slider or a colour moves; Reset back to the page's default. */
function ParamField({ param, value, set: isSet, toCommand }: { param: ParamDeclaration; value: unknown; set: boolean; toCommand: (value: unknown) => Command }) {
  const label = `Change ${param.label}`;
  const commit = (next: unknown) => edit([toCommand(next)], label);
  let input: ReactNode;
  switch (param.type) {
    case 'bool':
      input = <Toggle checked={value === true} label={param.label} onChange={(on) => commit(on)} testId={`param-${param.name}`} />;
      break;
    case 'select':
      input = (
        <StyledSelect
          value={String(value ?? '')}
          options={(param.options ?? []).map((option) => ({ value: option, label: option }))}
          onChange={(option) => commit(option)}
          label={param.label}
          testId={`param-${param.name}`}
        />
      );
      break;
    case 'number': {
      const number = typeof value === 'number' ? value : 0;
      const { min, max } = param;
      input = (
        <>
          {min !== undefined && max !== undefined && max > min && (
            <input
              key={number}
              type="range"
              className="range"
              min={min}
              max={max}
              step={(max - min) / 200}
              defaultValue={number}
              aria-label={param.label}
              onInput={(event) => preview([toCommand(Number((event.target as HTMLInputElement).value))])}
              onChange={(event) => {
                preview(undefined);
                commit(Number(event.target.value));
              }}
            />
          )}
          <span className="narrow">
            <NumberInput value={number} min={min} max={max} step={min !== undefined && max !== undefined ? (max - min) / 20 : 1} onCommit={commit} testId={`param-${param.name}`} />
          </span>
        </>
      );
      break;
    }
    case 'color':
      input = (
        <>
          <ColorInput value={/^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : '#ffffff'} label={label} toCommand={(colour) => toCommand(colour)} />
          <TextInput value={String(value ?? '')} placeholder="#ffffff" onCommit={(text) => commit(text.trim() || undefined)} testId={`param-${param.name}`} />
        </>
      );
      break;
    case 'image':
      input = (
        <>
          <span className="path" title={String(value ?? '')}>
            {value ? String(value) : 'none'}
          </span>
          <button
            type="button"
            className="ghost small"
            onClick={() =>
              void bridge.invoke('project:import-image', { purpose: 'still' }).then((chosen) => {
                if (chosen) commit(chosen.path);
              })
            }
          >
            Choose…
          </button>
          {value ? (
            <button type="button" className="ghost small" onClick={() => commit(null)}>
              None
            </button>
          ) : null}
        </>
      );
      break;
    default: {
      const text = String(value ?? '');
      input = <TextInput value={text} multiline={text.includes('\n') || String(param.default ?? '').includes('\n')} onCommit={(next) => commit(next)} testId={`param-${param.name}`} />;
    }
  }
  return (
    <div className={`field${param.type === 'bool' ? ' inline' : ''}`}>
      <span className="field-label">
        {param.label}
        {isSet && (
          <button type="button" className="link" onClick={() => edit([toCommand(undefined)], `Reset ${param.label}`)} title={`Back to the page's default (${JSON.stringify(param.default)})`}>
            Reset
          </button>
        )}
      </span>
      <span className="field-input">{input}</span>
    </div>
  );
}

// ---- the look ------------------------------------------------------------------------------------

const look = (path: string[], value: unknown, label: string) => edit([{ type: 'look', path, value } as Command], label);
const caption = (field: 'enabled' | 'style' | 'position' | 'size' | 'color', value: unknown, label: string) => edit([{ type: 'captions', field, value }], label);

/**
 * A colour well: the video follows the picker while it moves, and the colour is one step to undo
 * once the picker closes (its native change), not one per move. It sets `look.<path>`, or what
 * `toCommand` makes of the colour.
 */
function ColorInput({ value, path = [], label, upper, toCommand }: { value: string; path?: string[]; label: string; upper?: boolean; toCommand?: (colour: string) => Command }) {
  const input = useRef<HTMLInputElement>(null);
  const shape = (colour: string) => (upper ? colour.toUpperCase() : colour);
  const command = (colour: string): Command => toCommand?.(colour) ?? ({ type: 'look', path, value: colour } as Command);
  useEffect(() => {
    const element = input.current;
    if (!element) return;
    const commit = () => {
      preview(undefined);
      edit([command(shape(element.value))], label);
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
      onInput={(event) => preview([command(shape((event.target as HTMLInputElement).value))])}
      aria-label={label}
    />
  );
}

const SIZES = [
  { name: '16:9', ...EXPORT_FORMATS['16:9'] },
  { name: '1:1', ...EXPORT_FORMATS['1:1'] },
  { name: '9:16', ...EXPORT_FORMATS['9:16'] },
];

/** The look's parts, in the order the tab lists them. */
const LOOK_PARTS: { id: LookSection; title: string; icon: ComponentType<{ size?: number }> }[] = [
  { id: 'background', title: 'Background', icon: BackgroundIcon },
  { id: 'window', title: 'Window', icon: WindowIcon },
  { id: 'cursor', title: 'Cursor', icon: SelectIcon },
  { id: 'camera', title: 'Camera', icon: CameraIcon },
  { id: 'subtitles', title: 'Subtitles', icon: SubtitlesIcon },
  { id: 'sound', title: 'Sound', icon: SoundIcon },
  { id: 'video', title: 'Video', icon: FilmIcon },
];

/**
 * One part of the look: a line with its name and what it is now; a click opens it (one part at a
 * time), so the whole look reads at a glance and only one part's fields show.
 */
function LookPart({ id, summary, children }: { id: LookSection; summary: string; children: ReactNode }) {
  const open = useStore(store, (state) => state.lookSection === id);
  const part = LOOK_PARTS.find((item) => item.id === id)!;
  const Icon = part.icon;
  return (
    <section className={`look-part${open ? ' open' : ''}`} data-testid={`look-${id}`}>
      <button type="button" className="look-head" aria-expanded={open} onClick={() => store.set({ lookSection: id })} data-testid={`look-open-${id}`}>
        <Icon size={16} />
        <b>{part.title}</b>
        <span className="look-summary" title={summary}>
          {summary}
        </span>
        <ChevronIcon size={13} />
      </button>
      {open && <div className="look-body">{children}</div>}
    </section>
  );
}

function LookPanel() {
  const project = useStore(store, (state) => state.doc?.project);
  const raw = useStore(store, (state) => state.doc?.raw);
  if (!project || !raw) return null;
  const { look: current, output, sources, captions } = project;
  const size = SIZES.find((item) => item.width === output.width && item.height === output.height);
  const webcam = current.webcam;
  const summaries: Record<LookSection, string> = {
    background: current.background.preset === 'solid' ? `Solid · ${(current.background.color ?? '#1c1c22').toUpperCase()}` : BACKGROUND_NAMES[current.background.preset],
    window: current.frame.enabled ? [FRAME_NAMES[current.frame.style], current.frame.title].filter(Boolean).join(' · ') : 'No frame',
    cursor: current.cursor.enabled ? `${CURSOR_NAMES[current.cursor.style]} · ${current.cursor.size}×` : 'Hidden',
    camera: !sources.webcam
      ? 'No webcam in this take'
      : webcam.enabled
        ? `${WEBCAM_SHAPE_NAMES[webcam.shape]} · ${webcam.position ? 'moved' : CORNER_NAMES[webcam.corner].toLowerCase()} · ${Math.round(webcam.size * 100)} %`
        : 'Off',
    subtitles: captions.enabled ? CAPTION_STYLE_NAMES[captions.style] : sources.transcript ? 'Off' : 'Not transcribed yet',
    sound: current.audio.enabled
      ? [sources.cleanMic && current.audio.cleanup ? 'Mic · clean voice' : 'Mic', current.audio.typing && 'key clicks', project.music?.enabled && 'music', current.audio.effects && project.sounds.length > 0 && 'sounds'].filter(Boolean).join(' · ')
      : 'Muted',
    video: `${size?.name ?? `${output.width} × ${output.height}`} · ${output.fps} fps${current.transition.enabled ? ' · crossfades' : ''}`,
  };
  return (
    <div className="look-parts">
      <LookPart id="background" summary={summaries.background}>
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
      </LookPart>

      <LookPart id="window" summary={summaries.window}>
        <Row label="Frame" inline>
          <Toggle checked={current.frame.enabled} label="Window frame" onChange={(on) => look(['frame', 'enabled'], on, on ? 'Window frame on' : 'Window frame off')} />
        </Row>
        {current.frame.enabled && (
          <>
            <PictureSwatches
              label="Frame style"
              kind="frame"
              options={FRAME_STYLES}
              names={FRAME_NAMES}
              value={current.frame.style}
              color={current.cursor.color}
              onPick={(style) => look(['frame', 'style'], style, `Frame: ${FRAME_NAMES[style]}`)}
            />
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
      </LookPart>

      <LookPart id="cursor" summary={summaries.cursor}>
        <Row label="Cursor" inline>
          <Toggle checked={current.cursor.enabled} label="Cursor" onChange={(on) => look(['cursor', 'enabled'], on, on ? 'Cursor on' : 'Cursor off')} />
        </Row>
        {current.cursor.enabled && (
          <>
            <PictureSwatches
              label="Cursor style"
              kind="cursor"
              options={CURSOR_STYLES}
              names={CURSOR_NAMES}
              titles={CURSOR_TITLES}
              value={current.cursor.style}
              color={current.cursor.color}
              onPick={(style) => look(['cursor', 'style'], style, `Cursor: ${CURSOR_NAMES[style]}`)}
            />
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
            <Row label="Movement" note="the pointer glides; clicks stay exact">
              <SmoothingSelect value={current.cursor.smoothing} />
            </Row>
          </>
        )}
      </LookPart>

      <LookPart id="camera" summary={summaries.camera}>
        <Row label="Bubble" inline note={sources.webcam ? undefined : 'no webcam in this take'}>
          <Toggle checked={webcam.enabled} disabled={!sources.webcam} label="Webcam bubble" onChange={(on) => look(['webcam', 'enabled'], on, on ? 'Webcam on' : 'Webcam off')} testId="webcam-enabled" />
        </Row>
        {webcam.enabled && sources.webcam && <CameraFields webcam={webcam} />}
      </LookPart>

      <LookPart id="subtitles" summary={summaries.subtitles}>
        <Row label="Subtitles" inline note={sources.transcript ? undefined : 'the take is not transcribed yet'}>
          <Toggle checked={captions.enabled} label="Subtitles" onChange={(on) => caption('enabled', on, on ? 'Subtitles on' : 'Subtitles off')} testId="captions-enabled" />
        </Row>
        {captions.enabled && (
          <>
            <div className="grid2">
              <Row label="Style">
                <Select value={captions.style} options={CAPTION_STYLES} names={CAPTION_STYLE_NAMES} onChange={(style) => caption('style', style, `Subtitles: ${CAPTION_STYLE_NAMES[style]}`)} testId="captions-style" />
              </Row>
              <Row label="Position">
                <Select value={captions.position} options={TEXT_POSITIONS} names={POSITION_NAMES} onChange={(position) => caption('position', position, 'Subtitles position')} testId="captions-position" />
              </Row>
            </div>
            <div className="grid2">
              <Row label="Size">
                <NumberInput value={captions.size} min={0.5} max={2} step={0.1} onCommit={(size) => caption('size', size, 'Subtitles size')} testId="captions-size" />
              </Row>
              {captions.style !== 'subtitle' && (
                <Row label="Spoken word">
                  <ColorInput value={captions.color} label="Spoken word colour" upper toCommand={(color) => ({ type: 'captions', field: 'color', value: color })} />
                </Row>
              )}
            </div>
          </>
        )}
      </LookPart>

      <LookPart id="sound" summary={summaries.sound}>
        <Row label="Sound" inline note="the mic, the music and the sounds">
          <Toggle checked={current.audio.enabled} label="Sound" onChange={(on) => look(['audio', 'enabled'], on, on ? 'Sound on' : 'Sound off')} />
        </Row>
        {current.audio.enabled && sources.cleanMic && (
          <Row label="Clean voice" inline note="less noise">
            <Toggle checked={current.audio.cleanup} label="Clean voice" onChange={(on) => look(['audio', 'cleanup'], on, on ? 'Clean voice on' : 'Clean voice off')} testId="audio-cleanup" />
          </Row>
        )}
        {current.audio.enabled && (
          <Row label="Typing sounds" inline note="a click per key">
            <Toggle checked={current.audio.typing} label="Typing sounds" onChange={(on) => look(['audio', 'typing'], on, on ? 'Typing sounds on' : 'Typing sounds off')} testId="audio-typing" />
          </Row>
        )}
        {current.audio.enabled && current.audio.typing && (
          <Row label={`Typing volume · ${Math.round(current.audio.typingVolume * 100)} %`}>
            <RangeInput
              value={Math.round(current.audio.typingVolume * 100)}
              min={0}
              max={100}
              label="Typing volume"
              toCommand={(value) => ({ type: 'look', path: ['audio', 'typingVolume'], value: value / 100 }) as Command}
              commitLabel="Typing volume"
              testId="audio-typing-volume"
            />
          </Row>
        )}
        {current.audio.enabled && (
          <Row label="Sounds" inline note="the sounds and the music's effects">
            <Toggle checked={current.audio.effects} label="Sounds" onChange={(on) => look(['audio', 'effects'], on, on ? 'Sounds on' : 'Sounds off')} testId="audio-effects" />
          </Row>
        )}
        {current.audio.enabled && current.audio.effects && (
          <Row label={`Sounds volume · ${Math.round(current.audio.effectsVolume * 100)} %`}>
            <RangeInput
              value={Math.round(current.audio.effectsVolume * 100)}
              min={0}
              max={100}
              label="Sounds volume"
              toCommand={(value) => ({ type: 'look', path: ['audio', 'effectsVolume'], value: value / 100 }) as Command}
              commitLabel="Sounds volume"
              testId="audio-effects-volume"
            />
          </Row>
        )}
        {current.audio.enabled && (
          <Row label="Sped-up clips" inline>
            <Toggle checked={current.audio.muteSpedUp} label="Silent when sped up" onChange={(on) => look(['audio', 'muteSpedUp'], on, on ? 'Sped-up clips silent' : 'Sped-up clips heard')} />
            <em>{current.audio.muteSpedUp ? 'Silent' : 'Heard'}</em>
          </Row>
        )}
      </LookPart>

      <LookPart id="video" summary={summaries.video}>
        <Row label="Size" note={`${output.fps} fps`}>
          <StyledSelect
            value={size?.name ?? 'custom'}
            options={[
              ...(size ? [] : [{ value: 'custom', label: `${output.width} × ${output.height}` }]),
              ...SIZES.map((item) => ({ value: item.name, label: item.name, note: `${item.width} × ${item.height}` })),
            ]}
            onChange={(name) => {
              const chosen = SIZES.find((item) => item.name === name);
              if (chosen) edit([{ type: 'output', width: chosen.width, height: chosen.height }], `Output ${chosen.name}`);
            }}
            label="Output size"
            testId="output-size"
          >
            {size ? `${size.name} · ${size.width} × ${size.height}` : `${output.width} × ${output.height}`}
          </StyledSelect>
        </Row>
        <Row label="Crossfade" inline>
          <Toggle checked={current.transition.enabled} label="Crossfade at cuts" onChange={(on) => look(['transition', 'enabled'], on, on ? 'Crossfade on' : 'Crossfade off')} />
        </Row>
        {current.transition.enabled && (
          <Row label="Length (s)">
            <NumberInput value={current.transition.duration} min={0} max={2} step={0.1} onCommit={(value) => look(['transition', 'duration'], value, 'Crossfade length')} />
          </Row>
        )}
      </LookPart>
    </div>
  );
}

/**
 * The camera bubble's look: its shape as tiles, its corner (or where it was placed on the video,
 * with the way back to a corner), its size, its ring, shadow and mirror. Dragging it on the video
 * moves and resizes it too.
 */
function CameraFields({ webcam }: { webcam: CuttleProject['look']['webcam'] }) {
  return (
    <>
      <div className="shape-tiles" role="group" aria-label="Camera shape">
        {WEBCAM_SHAPES.map((shape) => (
          <button key={shape} type="button" className={`shape-tile ${shape}`} aria-pressed={webcam.shape === shape} onClick={() => look(['webcam', 'shape'], shape, `Camera: ${WEBCAM_SHAPE_NAMES[shape]}`)} data-testid={`webcam-shape-${shape}`}>
            <i />
            <span>{WEBCAM_SHAPE_NAMES[shape]}</span>
          </button>
        ))}
      </div>
      <Row label="Place" plain note={webcam.position ? 'moved; a corner puts it back' : 'or drag it on the video'}>
        <div className="corner-picker" role="group" aria-label="Camera corner">
          {WEBCAM_CORNERS.map((corner) => (
            <button
              key={corner}
              type="button"
              className={corner}
              aria-pressed={!webcam.position && webcam.corner === corner}
              title={CORNER_NAMES[corner]}
              aria-label={CORNER_NAMES[corner]}
              onClick={() => edit([{ type: 'look', path: ['webcam', 'corner'], value: corner } as Command, { type: 'look', path: ['webcam', 'position'], value: undefined } as Command], `Camera: ${CORNER_NAMES[corner].toLowerCase()}`)}
              data-testid={`webcam-corner-${corner}`}
            >
              <i />
            </button>
          ))}
        </div>
      </Row>
      <Row label={`Size · ${Math.round(webcam.size * 100)} %`}>
        <RangeInput value={Math.round(webcam.size * 100)} min={8} max={50} label="Camera size" toCommand={(value) => ({ type: 'look', path: ['webcam', 'size'], value: value / 100 }) as Command} commitLabel="Camera size" testId="webcam-size" />
      </Row>
      <div className="chips" role="group" aria-label="Camera details">
        {(
          [
            ['border', 'Ring', 'Camera ring'],
            ['shadow', 'Shadow', 'Camera shadow'],
            ['mirror', 'Mirror', 'Camera mirrored'],
          ] as const
        ).map(([field, name, change]) => (
          <button key={field} type="button" className="chip" aria-pressed={webcam[field]} onClick={() => look(['webcam', field], !webcam[field], `${change} ${webcam[field] ? 'off' : 'on'}`)} data-testid={`webcam-${field}`}>
            {webcam[field] && <CheckIcon size={12} />}
            {name}
          </button>
        ))}
      </div>
    </>
  );
}

/** A slider: the video follows it while it is dragged (a preview), one edit when it is let go. */
function RangeInput({ value, min, max, label, toCommand, commitLabel, testId }: { value: number; min: number; max: number; label: string; toCommand: (value: number) => Command; commitLabel: string; testId?: string }) {
  return (
    <input
      key={value}
      type="range"
      className="range"
      min={min}
      max={max}
      step={1}
      defaultValue={value}
      aria-label={label}
      onInput={(event) => preview([toCommand(Number((event.target as HTMLInputElement).value))])}
      onChange={(event) => {
        preview(undefined);
        edit([toCommand(Number(event.target.value))], commitLabel);
      }}
      data-testid={testId}
    />
  );
}
