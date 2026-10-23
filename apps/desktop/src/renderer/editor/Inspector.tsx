// The inspector: the selection's settings and the look, edited in place. A field saves when it is
// left or Enter is pressed (text also every 2 s while typing); each save is one step to undo.
// Output times read m:ss.t, take seconds "54.4 s into the take", lengths "2.5 s". While cuttle.json
// does not parse, every field is off (editing waits).
import { useEffect, useRef, useState, type ComponentType, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { EXPORT_FORMATS } from '@cuttle/export/formats';
import {
  BACKGROUND_PRESETS,
  CAPTION_STYLES,
  CLICK_EFFECTS,
  CURSOR_STYLES,
  EASES,
  MOVE_EASES,
  type MoveEase,
  CAMERA_LAYOUTS,
  type CameraLayout,
  TEXT_ANIMATIONS,
  type TextAnimation,
  FRAME_STYLES,
  MASK_STYLES,
  STILL_MOTIONS,
  TEXT_POSITIONS,
  TEXT_STYLES,
  THEME_FONTS,
  WEBCAM_CORNERS,
  WEBCAM_SHAPES,
  type AutoEdits,
  type AutoKind,
  type CuttleProject,
  type MotionOverlay,
  type MotionScene,
  type Music,
  type Rect,
  type ThemeFont,
  backgroundColors,
  backgroundTone,
  isColouredBackground,
  SOLID_DEFAULT,
  voiceLineKey,
  ANNOTATION_KINDS,
  type AnnotationKind,
} from '@cuttle/project';
import type { ParamDeclaration } from '@cuttle/export/motion-params';
import { narrationCues, sceneSpans, type SceneSpan } from '@cuttle/timeline';
import type { Command, ListName } from '../../shared/document';
import { MEDIA_ORIGIN, type BrandView, type MotionParams, type MotionStatusView, type SoundStatusView, type VoiceState } from '../../shared/ipc';
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
import { ANNOTATION_NAMES, CAMERA_NAMES, motionName, outputTimesOf, soundName } from '../../shared/timeline-model';
import { BUILT_IN_SOUNDS } from '@cuttle/motion-kit';
import { BackgroundIcon, BrandIcon, CameraIcon, CardIcon, CheckIcon, ChevronIcon, CloseIcon, CopyIcon, CropIcon, FilmIcon, KeysIcon, MaskIcon, MotionIcon, PageIcon, SelectIcon, SoundIcon, SplitIcon, SubtitlesIcon, TextIcon, TrashIcon, WatermarkIcon, WindowIcon, ZoomIcon, AnnotateIcon } from '../icons';
import { bridge } from '../bridge';
import { Select as StyledSelect } from '../Select';
import { shortcut } from '../keys';
import { addCamera, chooseImage, chooseTool, cutShownAt, deleteSelection, duplicateSelection, LIST_OF, playheadPlace, reveal, setSpeed, SPEEDS, switchSelection } from './actions';
import { edit, preview } from './doc';
import { addMove, removeMove, selectPlace, setMoveEase } from './path';
import { currentPlayer, engineAssets, select, setTool, store, type LookSection, type Selection, type Tool } from './session';
import { isColoured, swatch, type SwatchKey } from './swatches';
import { useStore } from './store';
import { PrivacyNote } from './PrivacyNote';
import { SpeechNote, TranscriptPanel } from './Transcript';
import { applyBrandKit, removeBrandKit, saveBrandKit } from './brand';
import { colorsFrom, switchTo, wallpaperBehind } from './background';

const TABS = [
  { id: 'selection', name: 'Selection' },
  { id: 'auto', name: 'Auto' },
  { id: 'transcript', name: 'Transcript' },
  { id: 'voice', name: 'Voice' },
  { id: 'look', name: 'Look' },
] as const;

export function Inspector() {
  const tab = useStore(store, (state) => state.tab);
  const broken = useStore(store, (state) => state.doc?.issues !== undefined);
  const tabs = useRef<HTMLDivElement>(null);
  // Arrow keys move between the tabs, Home and End to the first and the last, as in any tab list.
  const onKey = (event: KeyboardEvent) => {
    const at = TABS.findIndex((item) => item.id === tab);
    const to = { ArrowLeft: at - 1, ArrowRight: at + 1, Home: 0, End: TABS.length - 1 }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    const next = TABS[(to + TABS.length) % TABS.length]!;
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
          {tab === 'selection' ? <SelectionPanel /> : tab === 'auto' ? <AutoPanel /> : tab === 'transcript' ? <TranscriptPanel /> : tab === 'voice' ? <VoicePanel /> : <LookPanel />}
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
function Row({
  label,
  children,
  note,
  wide,
  plain,
  inline: beside,
  readout,
  compact,
}: {
  label: string;
  children: ReactNode;
  note?: ReactNode;
  wide?: boolean;
  plain?: boolean;
  inline?: boolean;
  readout?: boolean;
  /** A short number: its field beside its name, as wide as the number needs. */
  compact?: boolean;
}) {
  const Tag = plain ? 'div' : 'label';
  const inline = beside || compact;
  const said = note !== undefined && <em title={typeof note === 'string' ? note : undefined}>{note}</em>;
  if (readout) {
    // a value to read, not to change: its name and the value on one line, a note under the value
    return (
      <div className="field readout">
        <span className="field-label">{label}</span>
        <span className="field-value">
          <span>{children}</span>
          {said}
        </span>
      </div>
    );
  }
  return (
    <Tag className={`field${wide ? ' wide' : ''}${inline ? ' inline' : ''}${compact ? ' compact' : ''}`}>
      {inline && said ? (
        // beside a switch the note goes under the name: the switches line up, and a long note wraps
        <span className="field-text">
          <span className="field-label">{label}</span>
          {said}
        </span>
      ) : (
        <span className="field-label">{label}</span>
      )}
      <span className="field-input">
        {children}
        {!inline && said}
      </span>
    </Tag>
  );
}

/** A part of the selection's settings under its title. */
function Section({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <section className="insp-section" aria-label={title} data-testid={testId}>
      <h3 className="section-title">{title}</h3>
      {children}
    </section>
  );
}

/**
 * What few need (seconds into the take, pixels of the screen, a page's file): closed at first; once
 * opened it stays open from one selection to the next, until it is closed.
 */
function Advanced({ children, note }: { children: ReactNode; note?: string }) {
  const open = useStore(store, (state) => state.advancedOpen);
  return (
    <details className="advanced" open={open} onToggle={(event) => event.currentTarget.open !== open && store.set({ advancedOpen: event.currentTarget.open })} data-testid="advanced">
      <summary>
        <ChevronIcon size={13} />
        Advanced
      </summary>
      <div className="advanced-body">
        {note && <p className="hint">{note}</p>}
        {children}
      </div>
    </details>
  );
}

/** "Draw on the video" with the tool's picture and key: the tool that draws this kind of area. */
function DrawOn({ tool }: { tool: 'zoom' | 'mask' | 'crop' | 'annotate' }) {
  const { Icon, keys, name } = START_TOOLS.find((item) => item.tool === tool)!;
  return (
    <button type="button" className="ghost small draw-on" onClick={() => setTool(tool)} title={`${name} tool (${keys}): drag on the screen`}>
      <Icon size={14} />
      Draw on the video
      <kbd>{keys}</kbd>
    </button>
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
 * puts it back and leaves the field. Its unit (s, ×, px…) shows inside it, after the number.
 */
function NumberInput({ unit, ...props }: NumberProps & { unit?: string }) {
  if (!unit) return <NumberField {...props} />;
  return (
    <span className="unit-input">
      <NumberField {...props} />
      <i aria-hidden>{unit}</i>
    </span>
  );
}

interface NumberProps {
  value: number;
  onCommit: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  digits?: number;
  testId?: string;
}

function NumberField({ value, onCommit, step = 0.1, min, max, digits = 2, testId }: NumberProps) {
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

/** How much the picture smears as the zoom and the pointer move: a camera's shutter, open this share of a frame. */
const MOTION_BLUR: { value: number; name: string }[] = [
  { value: 0, name: 'Off' },
  { value: 0.25, name: 'Light (default)' },
  { value: 0.5, name: 'Film' },
  { value: 1, name: 'Strong' },
];

function MotionBlurSelect({ value }: { value: number }) {
  const known = MOTION_BLUR.some((step) => step.value === value);
  return (
    <StyledSelect
      value={String(value)}
      options={[...(known ? [] : [{ value: String(value), label: `${value} (from cuttle.json)` }]), ...MOTION_BLUR.map((step) => ({ value: String(step.value), label: step.name }))]}
      onChange={(chosen) => look(['motionBlur'], Number(chosen), 'Motion blur')}
      label="Motion blur"
      testId="motion-blur"
    />
  );
}

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
      <Section title="Timing">
        <Row label="In the video" readout>
          {at === undefined ? 'Nowhere: no clip plays this stretch' : `${cut.enabled ? 'jumps at' : 'would jump at'} ${formatTime(at)}`}
        </Row>
        <Row label="Takes out" readout>
          {formatDuration(cut.to - cut.from)} of the take
        </Row>
      </Section>
      <Section title="In the take">
        <div className="grid2">
          <Row label="From">
            <NumberInput unit="s" value={cut.from} min={0} onCommit={(from) => set('cuts', id, { from, to: Math.max(cut.to, from + 0.05) }, 'Change cut')} testId="cut-from" />
          </Row>
          <Row label="To">
            <NumberInput unit="s" value={cut.to} min={0} onCommit={(to) => set('cuts', id, { to }, 'Change cut')} testId="cut-to" />
          </Row>
        </div>
      </Section>
      <Row label="Cut" inline>
        <em>{cut.enabled ? 'On: the video jumps over it' : 'Off: the video plays it'}</em>
        <Toggle checked={cut.enabled} label="Cut this stretch" onChange={(on) => set('cuts', id, { enabled: on ? undefined : false }, on ? 'Cut on' : 'Cut off')} testId="cut-enabled" />
      </Row>
    </>
  );
}

/** An area's x, y, width and height in pixels of the screen, each after its letter. */
function AreaFields({ rect, onCommit }: { rect: Rect; onCommit: (rect: Rect) => void }) {
  return (
    <div className="field">
      <span className="field-label">Area, in pixels of the screen</span>
      <div className="grid4">
        {(['x', 'y', 'w', 'h'] as const).map((name, i) => (
          <label key={name} className="field-input">
            <em>{name}</em>
            <NumberInput value={rect[i]!} digits={0} step={1} min={i < 2 ? 0 : 8} onCommit={(value) => onCommit(rect.map((old, j) => (j === i ? value : old)) as Rect)} />
          </label>
        ))}
      </div>
    </div>
  );
}

/** A clip's crop: the part of the screen it shows, in source pixels, on or off. */
/** The transition page a scene is gone into with (Claude adds one with `motion new fold`): its length, on and off, out. */
function TransitionInto({ project, index }: { project: CuttleProject; index: number }) {
  const scene = project.scenes[index];
  const transition = scene?.transition;
  const name = `scenes[${index}].transition`;
  const status = useStore(store, (state) => state.motionStatus.find((entry) => entry.item === name && entry.src === transition?.src));
  if (!scene?.id || !transition || index === 0) return null;
  const id = scene.id;
  const change = (fields: Partial<typeof transition>, label: string) => set('scenes', id, { transition: { ...transition, ...fields } }, label);
  return (
    <Section title="Transition in" testId="transition-in">
      <Row label="Page" readout>
        {motionName(transition.src)}
      </Row>
      {status && <MotionState status={status} />}
      <p className="hint" title="Its page draws the frames between the two scenes from them. The player shows them once they are made, a moment after you stop on the timeline; until then, a crossfade.">
        The player crossfades until its frames are made.
      </p>
      <div className="grid2">
        <Row label="Length">
          <NumberInput unit="s" value={transition.duration} min={0.1} max={4} step={0.1} onCommit={(duration) => change({ duration }, 'Transition length')} testId="transition-duration" />
        </Row>
        <Row label="Transition" inline>
          <Toggle checked={transition.enabled} label="The transition into this scene" onChange={(on) => change({ enabled: on }, on ? 'Transition on' : 'Transition off')} testId="transition-on" />
        </Row>
      </div>
      <button type="button" className="ghost small start" onClick={() => set('scenes', id, { transition: undefined }, 'Remove transition')} data-testid="transition-remove">
        Remove the transition
      </button>
    </Section>
  );
}

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
      <Section title="Area">
        <Row label="Shows" readout>
          {Math.round(crop.rect[2])} × {Math.round(crop.rect[3])} px of the screen
        </Row>
        <DrawOn tool="crop" />
      </Section>
      <Row label="Crop" inline>
        <em>{crop.enabled ? 'On: the clip shows this part' : 'Off: the whole screen shows'}</em>
        <Toggle checked={crop.enabled} label="Crop the clip" onChange={(on) => setCrop({ enabled: on }, on ? 'Crop on' : 'Crop off')} testId="crop-enabled" />
      </Row>
      <Advanced>
        <AreaFields rect={crop.rect} onCommit={(rect) => setCrop({ rect }, 'Change the crop')} />
      </Advanced>
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
  { id: 'titles', title: 'Step titles', icon: <TextIcon />, kinds: ['title'], key: 'stepTitles' },
  { id: 'steps', title: 'Zooms on steps', icon: <ZoomIcon />, kinds: ['step'], key: 'stepZooms' },
];

/** The automatic items of a group, in the order the video shows them. */
function autoItems(project: CuttleProject, spans: readonly SceneSpan[], group: AutoGroup): AutoItem[] {
  const items: AutoItem[] = [];
  const of = (kind?: AutoKind) => kind !== undefined && group.kinds.includes(kind);
  for (const zoom of project.zooms) if (of(zoom.auto) && zoom.id) items.push({ kind: 'zoom', id: zoom.id, label: zoom.label ?? 'Zoom', enabled: zoom.enabled, at: outputTimesOf(spans, zoom.at)[0] });
  for (const mask of project.masks) if (of(mask.auto) && mask.id) items.push({ kind: 'mask', id: mask.id, label: mask.label ?? 'Mask', enabled: mask.enabled, at: outputTimesOf(spans, mask.from)[0] });
  for (const cut of project.cuts) if (of(cut.auto) && cut.id) items.push({ kind: 'cut', id: cut.id, label: cut.label ?? 'Cut', enabled: cut.enabled, at: cutShownAt(spans, cut) });
  for (const text of project.texts) if (of(text.auto) && text.id) items.push({ kind: 'caption', id: text.id, label: text.text, enabled: text.enabled, at: outputTimesOf(spans, text.at)[0] });
  for (const overlay of project.overlays) {
    if (of(overlay.auto) && overlay.id) items.push({ kind: 'motion', id: overlay.id, label: overlay.label ?? motionName(overlay.src), enabled: overlay.enabled, at: outputTimesOf(spans, overlay.at)[0] });
  }
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
        <button type="button" className="head-action" onClick={duplicateSelection} title={`Duplicate (${shortcut('Ctrl+D')})`} aria-label="Duplicate" data-testid="duplicate">
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

/** The tools the empty inspector starts with: each draws on the video, as on the bar beside it. */
const START_TOOLS: { tool: Tool; Icon: ComponentType<{ size?: number }>; name: string; keys: string; what: string }[] = [
  { tool: 'zoom', Icon: ZoomIcon, name: 'Zoom', keys: 'Z', what: 'show a part close up' },
  { tool: 'mask', Icon: MaskIcon, name: 'Mask', keys: 'M', what: 'hide a password, an address' },
  { tool: 'caption', Icon: TextIcon, name: 'Caption', keys: 'T', what: 'type on the video' },
  { tool: 'annotate', Icon: AnnotateIcon, name: 'Annotate', keys: 'A', what: 'point at something' },
  { tool: 'crop', Icon: CropIcon, name: 'Crop', keys: 'C', what: 'leave out tabs and bars' },
];

/** Nothing selected: what to select, the tools to start with, and the keys that edit. */
function StartHere() {
  return (
    <div className="start-here">
      <p className="start-lead">Click a scene, zoom, mask or caption on the timeline, or a caption on the video, to change it here.</p>
      <div className="start-tools">
        {START_TOOLS.map(({ tool, Icon, name, keys, what }) => (
          <button key={tool} type="button" className={`start-tool ${tool}`} onClick={() => chooseTool(tool)} title={`${name} (${keys}): ${what}`} data-testid={`start-${tool}`}>
            <span className="start-icon">
              <Icon size={16} />
            </span>
            <span className="start-name">
              {name} <kbd>{keys}</kbd>
            </span>
            <span className="start-what">{what}</span>
          </button>
        ))}
      </div>
      <ul className="hint-list">
        <li>
          <kbd>S</kbd> splits at the playhead, <kbd>R</kbd> speeds a clip up, <kbd>Del</kbd> deletes.
        </li>
        <li>
          <kbd>{shortcut('Ctrl+K')}</kbd> finds any command.
        </li>
      </ul>
    </div>
  );
}

/** The Annotate tool: what it draws (one of the six), and how. */
function AnnotateHint() {
  const kind = useStore(store, (state) => state.annotationKind);
  return (
    <div className="annotate-hint">
      <p className="hint">Annotate tool: pick what to draw, then drag on the screen ({kind === 'arrow' ? 'from where the arrow starts to what it points at' : 'over what it marks'}). It starts at the playhead and lasts 3 s. Esc goes back.</p>
      <div className="seg full annotate-kinds" role="group" aria-label="What the Annotate tool draws">
        {ANNOTATION_KINDS.map((each) => (
          <button key={each} type="button" aria-pressed={kind === each} onClick={() => store.set({ annotationKind: each })} data-testid={`annotate-${each}`}>
            {ANNOTATION_NAMES[each]}
          </button>
        ))}
      </div>
    </div>
  );
}

/** What the empty inspector says: how to start with the tool in hand. */
const HINTS: Record<Tool, ReactNode> = {
  select: <StartHere />,
  zoom: <p className="hint">Zoom tool: drag on the screen over what the video should show close up. It starts at the playhead and lasts 3 s. Esc goes back.</p>,
  mask: <p className="hint">Mask tool: drag on the screen over what the video must not show (a password, an address). It lasts from the playhead to the end of the clip. Esc goes back.</p>,
  caption: <p className="hint">Caption tool: type the caption in the bar and press Enter; it shows at the playhead for 3 s. Esc goes back.</p>,
  annotate: <AnnotateHint />,
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
  title: 'a step of the script',
  step: 'a step of the script',
};

/** Says that Cuttle made the item, for what, and that a change makes it the person's. */
function AutoNote({ kind }: { kind?: AutoKind }) {
  if (!kind) return null;
  return (
    <p className="auto-note" data-testid="auto-note" title="Change it and it is yours: Cuttle leaves it alone when it edits again.">
      <b>Made by Cuttle</b> · for {AUTO_REASONS[kind]}
    </p>
  );
}

/** Where a scene shows in the video: from its first piece's start to its last piece's end. */
function sceneStretch(spans: readonly SceneSpan[], index: number): { start: number; end: number } | undefined {
  const pieces = spans.filter((span) => span.sceneIndex === index);
  return pieces.length === 0 ? undefined : { start: pieces[0]!.start, end: pieces.at(-1)!.end };
}

function SelectionPanel() {
  const tool = useStore(store, (state) => state.tool);
  const selected = useStore(store, (state) => state.selection !== undefined);
  // the Annotate tool's picker stays on top while the tool is in hand, over what is selected
  if (tool !== 'annotate' || !selected) return <SelectedPanel />;
  return (
    <>
      <AnnotateHint />
      <SelectedPanel />
    </>
  );
}

function SelectedPanel() {
  const selection = useStore(store, (state) => state.selection);
  const also = useStore(store, (state) => state.also);
  const tool = useStore(store, (state) => state.tool);
  // a drag in progress shows here as it goes
  const project = useStore(store, (state) => state.doc?.preview ?? state.doc?.project);
  if (!project || !selection) return HINTS[tool];
  if (also.length > 0) return <ManyDetails project={project} items={[selection, ...also]} />;
  if (selection.kind === 'music') return project.music ? <MusicDetails music={project.music} /> : <p className="hint">The music is not in the project any more.</p>;
  const list = LIST_OF[selection.kind];
  const item = (project[list] as { id?: string }[]).find((candidate) => candidate.id === selection.id);
  if (!item) return <p className="hint">The selection is not in the project any more.</p>;
  return <Details project={project} selection={selection} />;
}

/** What each camera layout does, in a few words. */
const CAMERA_HINTS: Record<CameraLayout, string> = {
  full: 'the camera over the whole video: an intro, an outro, a word to the viewer',
  side: 'the screen and the camera side by side (one above the other on a tall video)',
  large: 'a big bubble in its corner, over the screen',
};

/** How a zoom gets to a move's place, in words. */
const MOVE_EASE_NAMES: Record<MoveEase, string> = { settle: 'Settle', smooth: 'Smooth', linear: 'Linear', jump: 'Jump' };

/**
 * A zoom's path: where it starts and each move (picked, the source view shows and edits it, the
 * playhead goes there), each move's curve, a move added at the playhead, one taken off.
 */
function PathPart({ project, zoom }: { project: CuttleProject; zoom: CuttleProject['zooms'][number] }) {
  const place = useStore(store, (state) => state.place);
  const spans = sceneSpans(project.scenes, project.cuts);
  const places: { at: number; ease?: MoveEase }[] = [{ at: zoom.at }, ...(zoom.moves ?? [])];
  return (
    <Section title="Path" testId="zoom-path-part">
      {zoom.moves?.length ? (
        <ul className="path-places">
          {places.map((each, index) => {
            const t = outputTimesOf(spans, each.at)[0];
            return (
              <li key={index} className={place === index ? 'selected' : undefined}>
                <button type="button" className="path-place" onClick={() => selectPlace(place === index ? undefined : index)} aria-pressed={place === index} data-testid={`zoom-place-${index}`}>
                  <span className="auto-time">{t === undefined ? '–' : formatTime(t)}</span>
                  <span className="auto-label">{index === 0 ? 'Start' : `Move ${index}`}</span>
                </button>
                {index > 0 && (
                  <>
                    <Select value={each.ease ?? 'settle'} options={MOVE_EASES} names={MOVE_EASE_NAMES} onChange={(ease) => setMoveEase(index, ease)} testId={`zoom-move-ease-${index}`} />
                    <button type="button" className="head-action" onClick={() => removeMove(index)} title="Take this move off the path" aria-label={`Remove move ${index}`} data-testid={`zoom-move-remove-${index}`}>
                      <CloseIcon size={13} />
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="hint">It holds still. A move makes it follow something: added at the playhead, then dragged in the source view.</p>
      )}
      <button type="button" className="ghost small" onClick={addMove} data-testid="zoom-add-move">
        Add a move at the playhead
      </button>
    </Section>
  );
}

/** What each kind is called, one and several. */
const KIND_NAMES: Record<Selection['kind'], [string, string]> = {
  scene: ['scene', 'scenes'],
  zoom: ['zoom', 'zooms'],
  mask: ['mask', 'masks'],
  caption: ['caption', 'captions'],
  annotation: ['annotation', 'annotations'],
  camera: ['camera layout', 'camera layouts'],
  motion: ['motion overlay', 'motion overlays'],
  cut: ['cut', 'cuts'],
  crop: ['crop', 'crops'],
  sound: ['sound', 'sounds'],
  music: ['music', 'music'],
};

/** Several items selected together: what they are, and what can be done to all of them at once. */
function ManyDetails({ project, items }: { project: CuttleProject; items: readonly Selection[] }) {
  const counts = new Map<Selection['kind'], number>();
  for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  const kinds = [...counts].map(([kind, count]) => `${count} ${KIND_NAMES[kind][count === 1 ? 0 : 1]}`);
  // a scene is not turned off: it is cut or deleted
  const switchable = items.filter((item) => item.kind !== 'scene' && item.kind !== 'music' && item.kind !== 'crop');
  const on = switchable.filter((item) => (project[LIST_OF[item.kind as Exclude<Selection['kind'], 'music'>]] as { id?: string; enabled?: boolean }[]).find((candidate) => candidate.id === item.id)?.enabled !== false);
  return (
    <div data-testid="many-details">
      <Head icon={<SelectIcon />} color="var(--accent)" name={`${items.length} items`} copies={items.some((item) => item.kind !== 'cut')} />
      <p className="hint many-kinds">{kinds.join(', ')}</p>
      {switchable.length > 0 && (
        <Row label="Show" inline>
          <em>{on.length === switchable.length ? 'All on' : on.length === 0 ? 'All off: kept, not in the video' : `${on.length} of ${switchable.length} on`}</em>
          <Toggle checked={on.length === switchable.length} label="Show them all" onChange={switchSelection} testId="many-enabled" />
        </Row>
      )}
      <p className="hint">
        Drag one on the timeline and the others move along. {shortcut('Shift')}- or {shortcut('Ctrl')}-click adds an item or takes it out; {shortcut('Shift')}-drag on the lanes selects what the band touches.
      </p>
    </div>
  );
}

function Details({ project, selection }: { project: CuttleProject; selection: Selection }) {
  const id = selection.id;
  if (selection.kind === 'cut') return <CutDetails project={project} id={id} />;
  if (selection.kind === 'crop') return <CropDetails project={project} id={id} />;
  if (selection.kind === 'scene') {
    const sceneIndex = project.scenes.findIndex((item) => item.id === id);
    const scene = project.scenes[sceneIndex]!;
    const stretch = sceneStretch(sceneSpans(project.scenes, project.cuts), sceneIndex);
    const inVideo = stretch && (
      <Row label="In the video" readout>
        {span(stretch.start, stretch.end)}
      </Row>
    );
    /** A page, a card or a motion scene: where it shows and how long, the transition into it. */
    const sceneTiming = (length: ReactNode) => (
      <>
        <Section title="Timing">
          {inVideo}
          {length}
        </Section>
        <TransitionInto project={project} index={sceneIndex} />
      </>
    );
    if (scene.type === 'clip') {
      const name = [scene.speed !== 1 ? formatSpeed(scene.speed) : '', scene.label ?? (scene.speed === 1 ? 'Clip' : '')].filter(Boolean).join(' ');
      return (
        <>
          <Head icon={<FilmIcon />} color="var(--text)" name={name} />
          <Row label="Label">
            <TextInput value={scene.label ?? ''} placeholder="Clip" onCommit={(value) => set('scenes', id, { label: value.trim() || undefined }, 'Rename clip')} testId="clip-label" />
          </Row>
          <Section title="Speed">
            <div className="seg full" role="group" aria-label="Speed">
              {SPEEDS.map((speed) => (
                <button key={speed} type="button" aria-pressed={scene.speed === speed} onClick={() => setSpeed(speed, id)}>
                  {speed}×
                </button>
              ))}
            </div>
            <div className="field">
              <label className="field-input narrow">
                <NumberInput unit="×" value={scene.speed} min={0.25} max={64} step={0.5} onCommit={(speed) => setSpeed(speed, id)} testId="clip-speed" />
                <em>{stretch ? `${formatDuration(stretch.end - stretch.start)} in the video` : 'not in the video'}</em>
              </label>
            </div>
          </Section>
          {inVideo && <Section title="Timing">{inVideo}</Section>}
          <TransitionInto project={project} index={sceneIndex} />
          <Section title="Picture">
            <Row label="Badge" note={scene.badge === undefined ? 'shows the speed when sped up' : undefined}>
              <TextInput value={scene.badge ?? ''} placeholder={scene.speed > 1 ? `${formatSpeed(scene.speed)} speed` : 'none'} onCommit={(value) => set('scenes', id, { badge: value === '' ? undefined : value }, 'Change badge')} />
            </Row>
            <Row label="Crop" plain inline note={scene.crop ? (scene.crop.auto ? 'Cuttle’s: the content of the window' : undefined) : 'the whole screen shows'}>
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
                  <CropIcon size={14} />
                  Crop…
                </button>
              )}
            </Row>
          </Section>
          <Advanced note="Seconds into the take, as cuttle.json has them.">
            <div className="grid2">
              <Row label="From">
                <NumberInput unit="s" value={scene.from} min={0} onCommit={(from) => edit([{ type: 'trim', id, from }], 'Trim clip')} testId="clip-from" />
              </Row>
              <Row label="To">
                <NumberInput unit="s" value={scene.to} min={0} onCommit={(to) => edit([{ type: 'trim', id, to }], 'Trim clip')} testId="clip-to" />
              </Row>
            </div>
          </Advanced>
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
          <Section title="Picture">
            <Row label="Image" plain>
              <span className="path" title={scene.image}>
                {scene.image}
              </span>
              <button type="button" className="ghost small" onClick={() => void chooseImage('still', id)}>
                Replace…
              </button>
            </Row>
            <div className="grid2">
              <Row label="Motion">
                <Select value={scene.motion} options={STILL_MOTIONS} names={MOTION_NAMES} onChange={(motion) => set('scenes', id, { motion }, 'Change motion')} />
              </Row>
              <Row label="Frame">
                <Select value={scene.frame} options={FRAME_STYLES} names={FRAME_NAMES} onChange={(frame) => set('scenes', id, { frame }, 'Change frame')} />
              </Row>
            </div>
          </Section>
          {sceneTiming(
            <Row label="Length" compact>
              <NumberInput unit="s" value={scene.duration} min={0.1} onCommit={(duration) => edit([{ type: 'trim', id, duration }], 'Change the length of the page')} />
            </Row>,
          )}
        </>
      );
    }
    if (scene.type === 'motion') {
      return (
        <MotionDetails
          list="scenes"
          index={sceneIndex}
          item={scene}
          placement={sceneTiming(
            <Row label="Length" compact>
              <NumberInput unit="s" value={scene.duration} min={0.1} onCommit={(duration) => edit([{ type: 'trim', id, duration }], 'Change the length of the motion scene')} testId="motion-length" />
            </Row>,
          )}
        />
      );
    }
    return (
      <>
        <Head icon={<CardIcon />} color="var(--card)" name={scene.label ?? 'Card'} />
        <Section title="Text">
          <Row label="Title">
            <TextInput value={scene.title} onCommit={(value) => value.trim() && set('scenes', id, { title: value.trim() }, 'Change title')} testId="card-title" />
          </Row>
          <Row label="Subtitle">
            <TextInput value={scene.subtitle ?? ''} placeholder="none" onCommit={(value) => set('scenes', id, { subtitle: value.trim() || undefined }, 'Change subtitle')} />
          </Row>
          <Row label="Comes in" note="the subtitle a moment after the title">
            <Select
              value={scene.enter ?? 'none'}
              options={CARD_ENTERS}
              names={CARD_ENTER_NAMES}
              onChange={(enter) => set('scenes', id, { enter: enter === 'none' ? undefined : enter }, `Title comes in: ${CARD_ENTER_NAMES[enter].toLowerCase()}`)}
              testId="card-enter"
            />
          </Row>
        </Section>
        {sceneTiming(
          <Row label="Length" compact>
            <NumberInput unit="s" value={scene.duration} min={0.1} onCommit={(duration) => edit([{ type: 'trim', id, duration }], 'Change the length of the card')} />
          </Row>,
        )}
      </>
    );
  }

  /** An overlay's place: where the video shows it (read) and its length there. */
  const timing = (list: 'zooms' | 'texts' | 'masks' | 'annotations' | 'cameras' | 'overlays', from: number, to: number) => {
    const stretch = stretchOf(project, selection, from, to);
    const speed = stretch?.speed ?? 1;
    const label = NOUNS[list];
    return (
      <Section title="Timing">
        <Row label="Shows at" readout note={formatSource(from)}>
          {stretch ? span(stretch.start, stretch.end) : 'Nowhere: no clip shows it'}
        </Row>
        <Row label="Length" compact note={speed !== 1 ? `${formatDuration(to - from)} of the take, at ${formatSpeed(speed)}` : undefined}>
          <NumberInput
            unit="s"
            value={(to - from) / speed}
            min={0.05}
            onCommit={(length) => set(list, id, list === 'masks' ? { to: from + length * speed } : { duration: length * speed }, `Change the length of the ${label}`)}
            testId={`${list === 'overlays' ? 'motion' : list === 'cameras' ? 'camera' : label}-length`}
          />
        </Row>
      </Section>
    );
  };

  /** Where an overlay starts in the take (a mask: where it starts and ends), for Advanced. */
  const inTake = (list: 'zooms' | 'texts' | 'masks' | 'annotations' | 'cameras' | 'overlays', from: number, to: number) =>
    list === 'masks' ? (
      <div className="grid2">
        <Row label="From">
          <NumberInput unit="s" value={from} min={0} onCommit={(value) => set('masks', id, { from: value, to: Math.max(to, value + 0.05) }, 'Move mask')} />
        </Row>
        <Row label="To">
          <NumberInput unit="s" value={to} min={0} onCommit={(value) => set('masks', id, { to: value }, 'Change the length of the mask')} />
        </Row>
      </div>
    ) : (
      <Row label="Start" compact>
        <NumberInput unit="s" value={from} min={0} onCommit={(at) => set(list, id, { at }, `Move ${NOUNS[list]}`)} testId={`${list === 'overlays' ? 'motion' : NOUNS[list]}-at`} />
      </Row>
    );

  /** A zoom's or a mask's area: its size, the tool that draws it again, and the way back from following. */
  const area = (list: 'zooms' | 'masks', rect: Rect, moves = 0) => (
    <Section title="Area">
      <Row label={moves > 0 ? 'Size at the start' : 'Size'} readout>
        {Math.round(rect[2])} × {Math.round(rect[3])} px
      </Row>
      <DrawOn tool={list === 'zooms' ? 'zoom' : 'mask'} />
      {moves > 0 && (
        <Row label="Follows the screen" note={`${moves} move${moves === 1 ? '' : 's'}`} plain inline>
          <button type="button" className="ghost small" onClick={() => set(list, id, { moves: undefined }, `Hold the ${NOUNS[list]} still`)} data-testid={`${NOUNS[list]}-hold`}>
            Hold still
          </button>
        </Row>
      )}
    </Section>
  );

  const pixels = (list: 'zooms' | 'masks', rect: Rect) => <AreaFields rect={rect} onCommit={(next) => set(list, id, { rect: next }, `Change the ${NOUNS[list]} area`)} />;

  const enabled = (list: 'zooms' | 'masks' | 'texts' | 'annotations' | 'cameras' | 'overlays', on: boolean) => (
    <Row label="Show" inline>
      <em>{on ? 'On' : 'Off: kept, not in the video'}</em>
      <Toggle checked={on} label={`Show the ${NOUNS[list]}`} onChange={(value) => set(list, id, { enabled: value ? undefined : false }, value ? `Turn ${NOUNS[list]} on` : `Turn ${NOUNS[list]} off`)} />
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
        {area('zooms', zoom.rect, zoom.moves?.length)}
        <Section title="Movement">
          <Row label="Easing">
            <Select value={zoom.ease} options={EASES} names={EASE_NAMES} onChange={(ease) => set('zooms', id, { ease }, 'Change easing')} />
          </Row>
        </Section>
        <PathPart project={project} zoom={zoom} />
        {enabled('zooms', zoom.enabled)}
        <Advanced note={ADVANCED_NOTE}>
          {inTake('zooms', zoom.at, zoom.at + zoom.duration)}
          {pixels('zooms', zoom.rect)}
        </Advanced>
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
        {area('masks', mask.rect, mask.moves?.length)}
        <Section title="Cover">
          <Row label="Style">
            <Select value={mask.style} options={MASK_STYLES} names={MASK_STYLE_NAMES} onChange={(style) => set('masks', id, { style }, 'Change mask style')} />
          </Row>
        </Section>
        {enabled('masks', mask.enabled)}
        <Advanced note={ADVANCED_NOTE}>
          {inTake('masks', mask.from, mask.to)}
          {pixels('masks', mask.rect)}
        </Advanced>
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
            {enabled('overlays', overlay.enabled)}
          </>
        }
        advanced={inTake('overlays', overlay.at, overlay.at + overlay.duration)}
      />
    );
  }
  if (selection.kind === 'annotation') {
    const annotation = project.annotations.find((item) => item.id === id)!;
    const name = annotation.label ?? ANNOTATION_NAMES[annotation.kind];
    // a kind changed from an arrow to one with an area (or back) takes a shape from what it had
    const changeKind = (kind: AnnotationKind) => {
      if (kind === annotation.kind) return;
      const from = annotation.from ?? [annotation.rect![0], annotation.rect![1] + annotation.rect![3]];
      const to = annotation.to ?? [annotation.rect![0] + annotation.rect![2] / 2, annotation.rect![1]];
      const shape =
        kind === 'arrow'
          ? { from: annotation.from ?? from, to: annotation.to ?? to, rect: undefined }
          : { rect: annotation.rect ?? ([Math.min(from[0], to[0]), Math.min(from[1], to[1]), Math.max(8, Math.abs(to[0] - from[0])), Math.max(8, Math.abs(to[1] - from[1]))] as Rect), from: undefined, to: undefined };
      set('annotations', id, { kind, ...shape }, `Make it ${ANNOTATION_NAMES[kind].toLowerCase()}`);
    };
    return (
      <>
        <Head icon={<AnnotateIcon />} color="var(--annotation)" name={name} />
        <Row label="Label">
          <TextInput value={annotation.label ?? ''} placeholder={ANNOTATION_NAMES[annotation.kind]} onCommit={(value) => set('annotations', id, { label: value.trim() || undefined }, 'Rename annotation')} />
        </Row>
        <Section title="Mark">
          <Row label="Kind">
            <Select value={annotation.kind} options={ANNOTATION_KINDS} names={ANNOTATION_NAMES} onChange={changeKind} testId="annotation-kind" />
          </Row>
          <Row label="Callout" note="a few words beside it">
            <TextInput value={annotation.text ?? ''} placeholder="None" onCommit={(text) => set('annotations', id, { text: text.trim() || undefined }, 'Change the callout')} testId="annotation-text" />
          </Row>
          <Row label="Colour" note={annotation.color ? undefined : "the brand's accent"}>
            <ColorInput
              value={annotation.color ?? project.theme.accent ?? project.look.cursor.color}
              label="Annotation colour"
              upper
              hex
              toCommand={(color) => ({ type: 'set', list: 'annotations', id, fields: { color } })}
            />
          </Row>
          {annotation.kind === 'magnifier' && (
            <Row label="Magnifies">
              <RangeInput value={Math.round(annotation.zoom * 10)} min={15} max={40} label="Magnifies" toCommand={(value) => ({ type: 'set', list: 'annotations', id, fields: { zoom: value / 10 } })} commitLabel="Magnify" format={(value) => `${(value / 10).toFixed(1)}×`} testId="annotation-zoom" />
            </Row>
          )}
          <DrawOn tool="annotate" />
        </Section>
        {timing('annotations', annotation.at, annotation.at + annotation.duration)}
        {enabled('annotations', annotation.enabled)}
        <Advanced note={ADVANCED_NOTE}>
          {inTake('annotations', annotation.at, annotation.at + annotation.duration)}
          {annotation.rect && <AreaFields rect={annotation.rect} onCommit={(rect) => set('annotations', id, { rect }, 'Change the annotation area')} />}
        </Advanced>
      </>
    );
  }
  if (selection.kind === 'camera') {
    const camera = project.cameras.find((item) => item.id === id)!;
    return (
      <>
        <Head icon={<CameraIcon />} color="var(--camera)" name={camera.label ?? CAMERA_NAMES[camera.layout]} />
        <Row label="Label">
          <TextInput value={camera.label ?? ''} placeholder={CAMERA_NAMES[camera.layout]} onCommit={(value) => set('cameras', id, { label: value.trim() || undefined }, 'Rename the camera layout')} />
        </Row>
        <Section title="Camera">
          <Row label="Layout" note={CAMERA_HINTS[camera.layout]}>
            <Select value={camera.layout} options={CAMERA_LAYOUTS} names={CAMERA_NAMES} onChange={(layout) => set('cameras', id, { layout }, `${CAMERA_NAMES[layout]} there`)} testId="camera-layout" />
          </Row>
          {!project.sources.webcam && <p className="hint">This take has no webcam: record with a camera to see it here.</p>}
          {project.sources.webcam && !project.look.webcam.enabled && <p className="hint">The bubble is off (Look, Camera): the camera fades in here instead of growing out of it.</p>}
        </Section>
        {timing('cameras', camera.at, camera.at + camera.duration)}
        {enabled('cameras', camera.enabled)}
        <Advanced note={ADVANCED_NOTE}>{inTake('cameras', camera.at, camera.at + camera.duration)}</Advanced>
      </>
    );
  }
  if (selection.kind === 'sound') return <SoundDetails project={project} id={id} />;
  const text = project.texts.find((item) => item.id === id)!;
  return (
    <>
      <Head icon={<TextIcon />} color="var(--caption)" name={text.label ?? 'Caption'} />
      <AutoNote kind={text.auto} />
      <Row label="Text" wide>
        <TextInput value={text.text} multiline onCommit={(value) => value.trim() && set('texts', id, { text: value }, 'Edit caption')} testId="caption-text" />
      </Row>
      {timing('texts', text.at, text.at + text.duration)}
      <Section title="Look">
        <div className="grid2">
          <Row label="Style">
            <Select value={text.style} options={TEXT_STYLES} names={TEXT_STYLE_NAMES} onChange={(style) => set('texts', id, { style }, 'Change caption style')} />
          </Row>
          <Row label="Position">
            <Select value={text.position} options={TEXT_POSITIONS} names={POSITION_NAMES} onChange={(position) => set('texts', id, { position }, 'Move caption')} />
          </Row>
          <Row label="Comes in">
            <Select value={text.enter ?? 'fade'} options={TEXT_ANIMATIONS} names={TEXT_ANIMATION_NAMES} onChange={(enter) => set('texts', id, { enter: enter === 'fade' ? undefined : enter }, `Caption comes in: ${TEXT_ANIMATION_NAMES[enter].toLowerCase()}`)} testId="caption-enter" />
          </Row>
          <Row label="Goes out">
            <Select value={text.exit ?? 'fade'} options={TEXT_ANIMATIONS} names={TEXT_ANIMATION_NAMES} onChange={(exit) => set('texts', id, { exit: exit === 'fade' ? undefined : exit }, `Caption goes out: ${TEXT_ANIMATION_NAMES[exit].toLowerCase()}`)} testId="caption-exit" />
          </Row>
        </div>
      </Section>
      {enabled('texts', text.enabled)}
      <Advanced note="Seconds into the take, as cuttle.json has them.">
        {inTake('texts', text.at, text.at + text.duration)}
        <Row label="Label" note="its name on the timeline">
          <TextInput value={text.label ?? ''} placeholder="Caption" onCommit={(value) => set('texts', id, { label: value.trim() || undefined }, 'Rename caption')} />
        </Row>
      </Advanced>
    </>
  );
}

/** The ways a caption comes in and goes out, as people say them. */
const TEXT_ANIMATION_NAMES: Record<TextAnimation, string> = { fade: 'Fade', pop: 'Pop', slide: 'Slide', blur: 'Blur', typewriter: 'Typewriter', words: 'Word by word', sweep: 'Sweep' };
/** How a title card's title comes in: as the captions can, or there from the start. */
const CARD_ENTERS = ['none', ...TEXT_ANIMATIONS] as const;
const CARD_ENTER_NAMES: Record<(typeof CARD_ENTERS)[number], string> = { none: 'There from the start', ...TEXT_ANIMATION_NAMES };

/** What each list's items are called in the names of their changes. */
const NOUNS = { zooms: 'zoom', masks: 'mask', texts: 'caption', annotations: 'annotation', cameras: 'camera layout', overlays: 'motion overlay' } as const;

const ADVANCED_NOTE = 'Seconds into the take and pixels of the screen, as cuttle.json has them.';

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
      {summary && (
        <Row label="Made" readout>
          {summary}
        </Row>
      )}
      <Section title="Sound">
        <Row label="Music" inline>
          <em>{music.enabled ? 'On' : 'Off'}</em>
          <Toggle checked={music.enabled} label="Play the music" onChange={(on) => edit([musicEdit({ enabled: on ? undefined : false })], on ? 'Music on' : 'Music off')} testId="music-enabled" />
        </Row>
        <Row label="Volume">
          <RangeInput value={Math.round(music.volume * 100)} min={0} max={100} label="Music volume" toCommand={(value) => musicEdit({ volume: value / 100 })} commitLabel="Music volume" testId="music-volume" />
        </Row>
        <Row label="Under speech">
          <RangeInput value={music.duck} min={0} max={30} label="How far the music goes down under speech (dB)" toCommand={(value) => musicEdit({ duck: value })} commitLabel="Music under speech" format={(value) => (value > 0 ? `−${value} dB` : 'as is')} testId="music-duck" />
        </Row>
      </Section>
      {declared && (declared.params.length > 0 || declared.issues.length > 0) && (
        <Section title="Params" testId="music-params">
          {declared.issues.map((issue) => (
            <p key={issue} className="note warning">
              {issue}
            </p>
          ))}
          {declared.params.map((declaration) => (
            <ParamField key={declaration.name} param={declaration} value={declaration.name in values ? values[declaration.name] : declaration.default} set={declaration.name in values} toCommand={(value) => param(declaration.name, value)} />
          ))}
        </Section>
      )}
      <MotionLog status={{ item: 'music', src: music.src, state: status.state === 'failed' ? 'failed' : 'ready', errors: [...status.errors, ...status.skipped], console: status.console }} />
      <Advanced>
        <PageFile src={music.src} reload={() => void bridge.invoke('sound:reload')} testId="music-reload" />
      </Advanced>
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
      <Row label="Label">
        <TextInput value={sound.label ?? ''} placeholder={soundName(sound.sound)} onCommit={(value) => set('sounds', id, { label: value.trim() || undefined }, 'Rename sound')} />
      </Row>
      <Section title="Sound">
        <Row label="Sound" note={BUILT_IN_SOUNDS.find(([name]) => name === sound.sound)?.[1] ?? 'a file of the project'}>
          <StyledSelect value={sound.sound} options={options.map((name) => ({ value: name, label: soundName(name) }))} onChange={(name) => set('sounds', id, { sound: name }, 'Change sound')} label="Sound" />
        </Row>
        <Row label="Volume">
          <RangeInput value={Math.round(sound.volume * 100)} min={0} max={100} label="Sound volume" toCommand={(value) => ({ type: 'set', list: 'sounds', id, fields: { volume: value / 100 } })} commitLabel="Sound volume" testId="sound-volume" />
        </Row>
      </Section>
      <Section title="Timing">
        <Row label={scene ? `Into ${scene.label ?? 'its scene'}` : 'At, in the take'} compact note={scene ? undefined : formatSource(sound.at)}>
          <NumberInput unit="s" value={sound.at} min={0} step={0.05} onCommit={(at) => set('sounds', id, { at }, 'Move sound')} testId="sound-at" />
        </Row>
      </Section>
      <Row label="In the video" inline>
        <em>{sound.enabled ? 'On' : 'Off'}</em>
        <Toggle checked={sound.enabled} label="Play the sound" onChange={(on) => set('sounds', id, { enabled: on ? undefined : false }, on ? 'Sound on' : 'Sound off')} testId="sound-enabled" />
      </Row>
    </>
  );
}

// ---- the narration -------------------------------------------------------------------------------

/** The voices this computer has and whether ElevenLabs has a key, read again after a download or a key. */
function useVoiceState(): [VoiceState | undefined, () => void] {
  const [state, setState] = useState<VoiceState>();
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    let live = true;
    bridge.invoke('voice:state').then(
      (read) => live && setState(read),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [asked]);
  return [state, () => setAsked((count) => count + 1)];
}

const megabytes = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;

/** What the request's failure says, without Electron's prefix. */
const failure = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '');

/**
 * The narration: who speaks it (a voice on this computer, downloaded once, or ElevenLabs' by its
 * voice ID with the account's key, kept in the keychain), how fast and loud, its subtitles, and its
 * lines, each at a moment of the video. Lines are spoken as they are written (into voiceover/).
 */
function VoicePanel() {
  const project = useStore(store, (state) => state.doc?.project);
  const status = useStore(store, (state) => state.voiceStatus);
  const media = useStore(store, (state) => state.media);
  const [voices, reread] = useVoiceState();
  const [problem, setProblem] = useState<string>();
  const [key, setKey] = useState('');
  // ElevenLabs chosen before its voice ID is written: shown, not saved yet (a voice needs its ID)
  const [chosen, setChosen] = useState<'local' | 'elevenlabs'>();
  if (!project) return null;
  const { voiceover } = project;
  const voice = voiceover.voice;
  const provider = chosen ?? voice?.provider ?? 'local';
  const local = voices?.local.find((each) => each.name === voice?.id);
  const narration = (fields: Record<string, unknown>, label: string) => edit([{ type: 'voiceover', fields }], label);
  const setVoice = (fields: Record<string, unknown>, label: string) => narration({ voice: { ...voice, ...fields } }, label);
  const download = (name: string) => {
    setProblem(undefined);
    const done = bridge.invoke('voice:download', name).then(
      () => reread(),
      (error) => setProblem(failure(error)),
    );
    // the list says it downloads at once
    void Promise.resolve().then(reread);
    return done;
  };
  const saveKey = () =>
    bridge.invoke('voice:key', key.trim() === '' ? null : key.trim()).then(
      () => {
        setKey('');
        reread();
      },
      (error) => setProblem(failure(error)),
    );
  const spans = sceneSpans(project.scenes, project.cuts);
  const placed = new Map(narrationCues(project, spans).cues.map((cue) => [cue.index, cue.at]));
  const addLine = () => {
    const place = playheadPlace();
    if (!place) return;
    const scene = project.scenes[place.index];
    const where = place.source !== undefined ? { at: Math.round(place.source * 100) / 100 } : { at: Math.round((place.t - place.span.start) * 100) / 100, ...(scene?.id !== undefined && { scene: scene.id }) };
    // the first line brings a voice: one on this computer, downloaded if there is one
    const first: Command[] = voiceover.voice ? [] : [{ type: 'voiceover', fields: { voice: { provider: 'local', id: voices?.local.find((each) => each.installed)?.name ?? 'en_US-amy-medium' } } }];
    edit([...first, { type: 'add-voice-line', item: { text: '', ...where } }], 'Add a line');
  };
  return (
    <div className="voice-panel">
      <Section title="Voice" testId="voice-voice">
        <Row label="Speaks with">
          <StyledSelect
            value={provider}
            options={[
              { value: 'local', label: 'A voice on this computer' },
              { value: 'elevenlabs', label: 'ElevenLabs' },
            ]}
            onChange={(next) => {
              if (next === (voice?.provider ?? 'local')) return setChosen(undefined);
              if (next === 'elevenlabs') return setChosen('elevenlabs');
              setChosen(undefined);
              setVoice({ provider: 'local', id: voices?.local.find((each) => each.installed)?.name ?? 'en_US-amy-medium', model: undefined, stability: undefined, similarity: undefined, style: undefined }, 'Change the narration\'s voice');
            }}
            label="Speaks with"
            testId="voice-provider"
          />
        </Row>
        {provider === 'local' ? (
          <>
            <Row label="Voice" note={local ? `${local.language}${local.installed ? '' : ` · ${megabytes(local.bytes)} to download`}` : undefined}>
              <StyledSelect
                value={voice?.id}
                options={(voices?.local ?? []).map((each) => ({ value: each.name, label: `${each.label} · ${each.language}${each.installed ? '' : ' ↓'}` }))}
                onChange={(name) => setVoice({ provider: 'local', id: name }, 'Change the narration\'s voice')}
                label="Voice"
                testId="voice-local"
              />
            </Row>
            {local && !local.installed && (
              <button type="button" className="ghost small" disabled={voices?.downloading.includes(local.name)} onClick={() => void download(local.name)} data-testid="voice-download">
                {voices?.downloading.includes(local.name) ? 'Downloading…' : `Download ${local.label} (${megabytes(local.bytes)})`}
              </button>
            )}
          </>
        ) : (
          <>
            <Row label="Voice ID" note="as ElevenLabs' voice library shows it">
              <TextInput
                value={voice?.provider === 'elevenlabs' ? voice.id : ''}
                placeholder="21m00Tcm4TlvDq8ikWAM"
                onCommit={(id) => {
                  if (id.trim() === '') return;
                  setChosen(undefined);
                  setVoice({ provider: 'elevenlabs', id: id.trim() }, 'Change the narration\'s voice');
                }}
                testId="voice-eleven-id"
              />
            </Row>
            <Row label="Model">
              <TextInput value={voice?.model ?? ''} placeholder="eleven_multilingual_v2" onCommit={(model) => setVoice({ model: model.trim() || undefined }, 'Change the voice\'s model')} />
            </Row>
            <Row label="API key" note={voices?.elevenLabs ? 'kept in this computer\'s keychain' : 'not set'}>
              <input type="password" value={key} placeholder={voices?.elevenLabs ? '••••••••' : 'your ElevenLabs API key'} onChange={(event) => setKey(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void saveKey()} aria-label="ElevenLabs API key" data-testid="voice-eleven-key" />
            </Row>
            <button type="button" className="ghost small" onClick={() => void saveKey()} disabled={key.trim() === '' && !voices?.elevenLabs}>
              {key.trim() === '' ? 'Forget the key' : 'Keep the key'}
            </button>
          </>
        )}
        {voice && (
          <Row label="Speed">
            <RangeInput value={Math.round(voice.speed * 100)} min={50} max={200} label="Speed" toCommand={(value) => ({ type: 'voiceover', fields: { voice: { ...voice, speed: value / 100 } } })} commitLabel="Voice speed" testId="voice-speed" />
          </Row>
        )}
        <Row label="Volume">
          <RangeInput value={Math.round(voiceover.volume * 100)} min={0} max={100} label="Narration volume" toCommand={(value) => ({ type: 'voiceover', fields: { volume: value / 100 } })} commitLabel="Narration volume" testId="voice-volume" />
        </Row>
        <Row label="Subtitles" inline note="its words, with the mic's">
          <Toggle checked={voiceover.captions} label="The narration's subtitles" onChange={(on) => narration({ captions: on ? undefined : false }, on ? 'Narration subtitles on' : 'Narration subtitles off')} testId="voice-captions" />
        </Row>
      </Section>
      <Section title="Lines" testId="voice-lines">
        {voiceover.lines.length === 0 && <p className="hint">No lines yet. Write what the video says: each line plays where you put it, spoken on this computer or by ElevenLabs.</p>}
        {voiceover.lines.map((line, index) => {
          const id = line.id ?? `#${index + 1}`;
          const scene = line.scene !== undefined ? project.scenes.find((item) => item.id === line.scene) : undefined;
          const spoken = media?.narration.get(voiceLineKey(voiceover, line));
          const at = placed.get(index);
          const said = !line.enabled ? 'off' : spoken ? `${spoken.seconds.toFixed(1)} s${at !== undefined ? ` · plays at ${formatTime(at)}` : ' · plays nowhere'}` : status.state === 'speaking' ? 'speaking…' : 'not spoken yet';
          return (
            <div className="voice-line" key={line.id ?? index} data-testid={`voice-line-${id}`}>
              <TextInput value={line.text} multiline placeholder="What the narration says here" onCommit={(text) => line.id && edit([{ type: 'voice-line', id: line.id, fields: { text } }], 'Edit a line')} testId={`voice-text-${id}`} />
              <Row label={scene ? `Into ${scene.label ?? scene.id}` : 'At, in the take'} compact note={said}>
                <NumberInput unit="s" value={line.at} min={0} step={0.05} onCommit={(value) => line.id && edit([{ type: 'voice-line', id: line.id, fields: { at: value } }], 'Move a line')} testId={`voice-at-${id}`} />
              </Row>
              <div className="voice-line-actions">
                <Toggle checked={line.enabled} label="Speak the line" onChange={(on) => line.id && edit([{ type: 'voice-line', id: line.id, fields: { enabled: on ? undefined : false } }], on ? 'Line on' : 'Line off')} testId={`voice-enabled-${id}`} />
                <button type="button" className="ghost small" onClick={() => line.id && edit([{ type: 'voice-line', id: line.id, fields: null }], 'Delete a line')}>
                  Delete
                </button>
              </div>
            </div>
          );
        })}
        <button type="button" className="ghost small" onClick={addLine} data-testid="voice-add">
          Add a line at the playhead
        </button>
      </Section>
      {(problem ?? (status.state === 'failed' ? status.message : undefined)) && <p className="hint warn" data-testid="voice-problem">{problem ?? status.message}</p>}
    </div>
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
function MotionDetails({ list, index, item, placement, advanced }: { list: 'scenes' | 'overlays'; index: number; item: MotionScene | MotionOverlay; placement: ReactNode; advanced?: ReactNode }) {
  const id = item.id!;
  const name = `${list}[${index}]`;
  const status = useStore(store, (state) => state.motionStatus.find((entry) => entry.item === name && entry.src === item.src));
  const declared = useMotionParams(item.src);
  const noun = list === 'scenes' ? 'motion scene' : 'motion overlay';
  const blur = item.motionBlur;
  return (
    <>
      <Head icon={<MotionIcon />} color="var(--motion)" name={item.label ?? motionName(item.src)} />
      {'auto' in item && <AutoNote kind={item.auto} />}
      <MotionState status={status} />
      <Row label="Label">
        <TextInput value={item.label ?? ''} placeholder={motionName(item.src)} onCommit={(value) => set(list, id, { label: value.trim() || undefined }, `Rename ${noun}`)} testId="motion-label" />
      </Row>
      {placement}
      {declared && <MotionParamFields list={list} id={id} item={item} declared={declared} />}
      <MotionLog status={status} />
      <Advanced>
        {advanced}
        <PageFile src={item.src} reload={() => void bridge.invoke('motion:reload', name)} testId="motion-reload" />
        <Row label="Internet" inline note={item.network ? 'the page may load fonts, images and data from https: addresses' : 'the page reaches only the project folder and the motion kit'}>
          <Toggle checked={item.network} label="Let the page load from the internet" onChange={(on) => set(list, id, { network: on || undefined }, on ? 'Let the page load from the internet' : 'Keep the page offline')} testId="motion-network" />
        </Row>
        <Row label="Motion blur" inline note="each frame the average of moments while a shutter is open: smoother fast motion, slower to draw">
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
      </Advanced>
      <p className="hint motion-hint">Claude can change this page or write a new one: ask it in Claude Code. Each saved change shows here at once.</p>
    </>
  );
}

/** A page's file (a motion item's or the music's): its path, the folder it is in, and loading it again. */
function PageFile({ src, reload, testId }: { src: string; reload: () => void; testId: string }) {
  return (
    <div className="field">
      <span className="field-label">
        Page
        <span className="links">
          <button type="button" className="link" onClick={() => void bridge.invoke('project:reveal', src)} title="Show the page's file in its folder">
            Show file
          </button>
          <button type="button" className="link" onClick={reload} title="Load the page again" data-testid={testId}>
            Reload
          </button>
        </span>
      </span>
      <span className="field-input">
        <span className="path" title={src}>
          {src}
        </span>
      </span>
    </div>
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
    <Section title="Params" testId="motion-params">
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
    </Section>
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
              style={fill(number, min, max)}
              min={min}
              max={max}
              step={(max - min) / 200}
              defaultValue={number}
              aria-label={param.label}
              onInput={(event) => {
                const target = event.target as HTMLInputElement;
                target.style.setProperty('--fill', fillOf(Number(target.value), min, max));
                preview([toCommand(Number(target.value))]);
              }}
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
function ColorInput({ value, path = [], label, upper, toCommand, hex }: { value: string; path?: string[]; label: string; upper?: boolean; toCommand?: (colour: string) => Command; hex?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const shape = (colour: string) => (upper ? colour.toUpperCase() : colour.toLowerCase());
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
  const well = (
    <input
      key={value}
      ref={input}
      type="color"
      defaultValue={value.toLowerCase()}
      onInput={(event) => preview([command(shape((event.target as HTMLInputElement).value))])}
      aria-label={label}
    />
  );
  if (!hex) return well;
  return (
    <span className="color-field">
      {well}
      <HexInput value={value} label={label} onCommit={(colour) => edit([command(shape(colour))], label)} />
    </span>
  );
}

/** A colour typed as hex (#RRGGBB, or #RGB): saved when left or on Enter if it is one, else put back. */
function HexInput({ value, label, onCommit }: { value: string; label: string; onCommit: (colour: string) => void }) {
  const shown = value.toUpperCase();
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  const commit = () => {
    const digits = draft.trim().replace(/^#/, '');
    const full = /^[0-9a-f]{3}$/i.test(digits) ? [...digits].map((digit) => digit + digit).join('') : digits;
    if (/^[0-9a-f]{6}$/i.test(full) && `#${full}`.toLowerCase() !== value.toLowerCase()) onCommit(`#${full}`);
    else setDraft(shown);
  };
  return (
    <input
      type="text"
      className="hex"
      value={draft}
      maxLength={7}
      spellCheck={false}
      aria-label={`${label} (hex)`}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') {
          setDraft(shown);
          (event.target as HTMLInputElement).blur();
        }
      }}
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
  { id: 'brand', title: 'Brand', icon: BrandIcon },
  { id: 'watermark', title: 'Watermark', icon: WatermarkIcon },
  { id: 'background', title: 'Background', icon: BackgroundIcon },
  { id: 'window', title: 'Window', icon: WindowIcon },
  { id: 'cursor', title: 'Cursor', icon: SelectIcon },
  { id: 'keys', title: 'Keys', icon: KeysIcon },
  { id: 'camera', title: 'Camera', icon: CameraIcon },
  { id: 'subtitles', title: 'Subtitles', icon: SubtitlesIcon },
  { id: 'sound', title: 'Sound', icon: SoundIcon },
  { id: 'video', title: 'Video', icon: FilmIcon },
];

/**
 * One part of the look: its name and, under it, what it is now; a click opens it (one part at a
 * time) and closes it again, so the whole look reads at a glance and only one part's fields show.
 * A part that can be off has its switch in its head: switched on, it opens.
 */
function LookPart({ id, summary, children, on }: { id: LookSection; summary: string; children: ReactNode; on?: { checked: boolean; label: string; onChange: (on: boolean) => void; testId?: string; disabled?: boolean } }) {
  const open = useStore(store, (state) => state.lookSection === id);
  const part = LOOK_PARTS.find((item) => item.id === id)!;
  const Icon = part.icon;
  return (
    <section className={`look-part${open ? ' open' : ''}${on && !on.checked ? ' off' : ''}`} data-testid={`look-${id}`}>
      <div className="look-top">
        <button type="button" className="look-head" aria-expanded={open} onClick={() => store.set({ lookSection: open ? undefined : id })} data-testid={`look-open-${id}`}>
          <Icon size={16} />
          <span className="look-text">
            <b>{part.title}</b>
            <span className="look-summary" title={summary}>
              {summary}
            </span>
          </span>
          <ChevronIcon size={13} />
        </button>
        {on && (
          <Toggle
            checked={on.checked}
            label={on.label}
            disabled={on.disabled}
            testId={on.testId}
            onChange={(checked) => {
              on.onChange(checked);
              if (checked) store.set({ lookSection: id });
            }}
          />
        )}
      </div>
      {open && <div className="look-body">{children}</div>}
    </section>
  );
}

/** The theme's fields as one step to undo (`undefined` removes one). */
const setTheme = (fields: Record<string, unknown>, label: string) => edit([{ type: 'theme', fields }], label);

/** A kit's chip: its background as a tile with its accent on it, and its name. */
function KitTone({ kit }: { kit: BrandView }) {
  return (
    <i className={`kit-tone bg-${kit.background.preset}`} style={kit.background.preset === 'solid' && kit.background.color ? { background: kit.background.color } : undefined}>
      <b style={{ background: kit.accent }} />
    </i>
  );
}

/**
 * The project's brand, which its motion pages read (titles, end cards, lower thirds, every colour):
 * the saved kits as chips that apply with one click, then the name, URL, logo, colours and heading
 * font, and saving it all as a kit for the next video.
 */
function BrandFields({ project }: { project: CuttleProject }) {
  const { theme, look: current } = project;
  const [kits, setKits] = useState<BrandView[]>();
  const [removing, setRemoving] = useState<string>();
  const [kitName, setKitName] = useState('');
  useEffect(() => {
    let live = true;
    void bridge.invoke('brand:list').then((list) => live && setKits(list));
    return () => {
      live = false;
    };
  }, []);
  const save = async () => {
    const name = (kitName || theme.name || '').trim();
    if (!name) return;
    const brands = await saveBrandKit(name);
    if (!brands) return;
    setKits(brands);
    setKitName('');
  };
  const remove = async (name: string) => {
    setRemoving(undefined);
    const brands = await removeBrandKit(name);
    if (brands) setKits(brands);
  };
  return (
    <>
      {kits && kits.length > 0 && (
        <div className="kits" role="group" aria-label="Brand kits">
          {kits.map((kit) => (
            <span key={kit.name} className="kit">
              <button type="button" className="chip" aria-pressed={theme.kit === kit.name} title={`Apply ${kit.name}: its brand, background, frame and cursor`} onClick={() => void applyBrandKit(kit.name)} data-testid="brand-kit">
                <KitTone kit={kit} />
                {kit.name}
              </button>
              <button type="button" className="kit-remove" aria-label={`Remove the kit ${kit.name}`} title="Remove this kit" onClick={() => setRemoving(kit.name)}>
                <CloseIcon size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
      {removing && (
        <div className="kit-confirm" role="alert">
          <span>
            Remove the kit “{removing}”? Projects keep what it set.
          </span>
          <button type="button" className="ghost small" onClick={() => setRemoving(undefined)}>
            Keep
          </button>
          <button type="button" className="primary small danger" onClick={() => void remove(removing)}>
            Remove
          </button>
        </div>
      )}
      {kits && kits.length === 0 && <p className="hint">No brand kits yet: set the brand below, then save it as a kit to use it in the next video with one click.</p>}
      <div className="grid2">
        <Row label="Name">
          <TextInput value={theme.name ?? ''} placeholder="the product" onCommit={(name) => setTheme({ name: name.trim() || undefined }, 'Brand name')} testId="brand-name" />
        </Row>
        <Row label="URL">
          <TextInput value={theme.url ?? ''} placeholder="example.com" onCommit={(url) => setTheme({ url: url.trim() || undefined }, 'Brand URL')} testId="brand-url" />
        </Row>
      </div>
      <Row label="Logo" plain>
        {theme.logo ? (
          <>
            <img className="logo-thumb" src={`${MEDIA_ORIGIN}/${theme.logo.split('/').map(encodeURIComponent).join('/')}`} alt="" />
            <span className="path" title={theme.logo}>
              {theme.logo.split('/').pop()}
            </span>
            <button type="button" className="ghost small" onClick={() => setTheme({ logo: undefined }, 'No logo')}>
              Remove
            </button>
          </>
        ) : (
          <span className="path">none: end cards show the name’s first letter</span>
        )}
        <button type="button" className="ghost small" onClick={() => void chooseImage('logo')} data-testid="brand-logo">
          {theme.logo ? 'Replace…' : 'Choose…'}
        </button>
      </Row>
      <div className="grid2">
        <Row label="Accent" note={theme.accent ? undefined : 'the cursor’s colour'}>
          <ColorInput value={theme.accent ?? current.cursor.color} label="Accent colour" upper hex toCommand={(accent) => ({ type: 'theme', fields: { accent } })} />
        </Row>
        <Row label="Text">
          <ColorInput value={theme.foreground} label="Text colour" upper hex toCommand={(foreground) => ({ type: 'theme', fields: { foreground } })} />
        </Row>
      </div>
      <Row label="Headings">
        <StyledSelect value={theme.font} options={THEME_FONTS.map((font) => ({ value: font, label: font, note: FONT_NOTES[font] }))} onChange={(font) => setTheme({ font }, `Headings: ${font}`)} label="Heading font" testId="brand-font" />
      </Row>
      <Row label="Pages’ background" note={theme.background ? undefined : 'a dark tone of the background'}>
        <ColorInput value={theme.background ?? backgroundTone(current.background)} label="Pages’ background" upper hex toCommand={(background) => ({ type: 'theme', fields: { background } })} />
        {theme.background && (
          <button type="button" className="ghost small" onClick={() => setTheme({ background: undefined }, 'Pages’ background from the background')}>
            Reset
          </button>
        )}
      </Row>
      <Row label="Save as a kit" plain>
        <span className="kit-save" title="The brand, the background, the frame and the cursor, for the next video; a kit of the same name is replaced">
          <input type="text" value={kitName} placeholder={theme.name || 'a name'} onChange={(event) => setKitName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void save()} aria-label="The kit's name" data-testid="brand-kit-name" />
          <button type="button" className="ghost small" disabled={!(kitName || theme.name || '').trim()} onClick={() => void save()} data-testid="brand-save">
            Save
          </button>
        </span>
      </Row>
    </>
  );
}

/**
 * The swatch of the current gradient or mesh in its own colours (a gradient as laid out); the
 * others keep their picture.
 */
function swatchStyle(background: CuttleProject['look']['background'], preset: (typeof BACKGROUND_PRESETS)[number]): CSSProperties | undefined {
  if ((preset !== 'gradient' && preset !== 'mesh') || !background.colors || background.preset !== preset) return undefined;
  const stops = background.colors.join(', ');
  if (preset === 'mesh') return { backgroundImage: `linear-gradient(135deg in oklab, ${stops})` };
  return { backgroundImage: background.kind === 'radial' ? `radial-gradient(circle, ${stops})` : `linear-gradient(${background.angle ?? 135}deg in oklab, ${stops})` };
}

/**
 * The colours of a gradient (its stops, first to last) or the tints of mesh, flow, bokeh and dots:
 * a well each (2 to 4, one more with +, one fewer with its ×), and the colours of the take's screen
 * or of the brand's logo with a click.
 */
function BackgroundColors({ background, logo }: { background: CuttleProject['look']['background']; logo: boolean }) {
  const colors = [...backgroundColors(background)];
  const setColors = (next: string[], label: string) => look(['background', 'colors'], next, label);
  return (
    <>
      <Row label={background.preset === 'gradient' ? 'Colours, first to last' : 'Colours'} plain note={background.colors ? undefined : 'its own'}>
        <span className="color-stops" data-testid="bg-colors">
          {colors.map((color, i) => (
            <span key={i} className="color-stop">
              <ColorInput value={color} label={`Colour ${i + 1}`} upper toCommand={(value) => ({ type: 'look', path: ['background', 'colors'], value: colors.map((other, j) => (j === i ? value : other)) }) as Command} />
              {colors.length > 2 && (
                <button type="button" className="stop-remove" aria-label={`Remove colour ${i + 1}`} title="Remove this colour" onClick={() => setColors(colors.filter((_, j) => j !== i), 'Background: a colour fewer')}>
                  <CloseIcon size={9} />
                </button>
              )}
            </span>
          ))}
          {colors.length < 4 && (
            <button type="button" className="ghost small stop-add" aria-label="Add a colour" title="Add a colour" onClick={() => setColors([...colors, colors.at(-1)!], 'Background: a colour more')} data-testid="bg-color-add">
              +
            </button>
          )}
        </span>
      </Row>
      <Row label="Take colours from" plain>
        <button type="button" className="ghost small" title="The clearest colours the take shows" onClick={() => void colorsFrom('take')} data-testid="bg-from-take">
          The take
        </button>
        <button type="button" className="ghost small" disabled={!logo} title={logo ? undefined : 'Choose a logo under Brand first'} onClick={() => void colorsFrom('logo')} data-testid="bg-from-logo">
          The logo
        </button>
      </Row>
    </>
  );
}

/**
 * The watermark: a mark in a corner of the whole video. Its image (else the brand's logo) or, without
 * one, its text (else the brand's name); its corner, height and opacity.
 */
function WatermarkFields({ project }: { project: CuttleProject }) {
  const { watermark } = project.look;
  const { theme } = project;
  const image = watermark.image ?? theme.logo;
  if (!watermark.enabled) return <p className="hint">Off. Switched on, the logo or the brand’s name shows in a corner of the whole video.</p>;
  return (
    <>
      {(
        <>
          <Row label="Image" plain>
            {image ? (
              <>
                <img className="logo-thumb" src={`${MEDIA_ORIGIN}/${image.split('/').map(encodeURIComponent).join('/')}`} alt="" />
                <span className="path" title={image}>
                  {watermark.image ? image.split('/').pop() : 'the brand’s logo'}
                </span>
              </>
            ) : (
              <span className="path">none: the text shows</span>
            )}
            {watermark.image && (
              <button type="button" className="ghost small" onClick={() => look(['watermark', 'image'], undefined, 'Watermark: no image of its own')}>
                Remove
              </button>
            )}
            <button type="button" className="ghost small" onClick={() => void chooseImage('watermark')} data-testid="watermark-image">
              {watermark.image ? 'Replace…' : 'Choose…'}
            </button>
          </Row>
          {!image && (
            <Row label="Text">
              <TextInput value={watermark.text ?? ''} placeholder={theme.name || 'the brand’s name'} onCommit={(text) => look(['watermark', 'text'], text.trim() || undefined, 'Watermark text')} testId="watermark-text" />
            </Row>
          )}
          <Row label="Corner" plain inline note={CORNER_NAMES[watermark.corner]}>
            <CornerPicker label="Watermark corner" value={watermark.corner} onPick={(corner) => look(['watermark', 'corner'], corner, `Watermark: ${CORNER_NAMES[corner].toLowerCase()}`)} testId="watermark" />
          </Row>
          <div className="grid2">
            <Row label="Size">
              <RangeInput value={Math.round(watermark.size * 100)} min={2} max={30} label="Watermark size" toCommand={(value) => ({ type: 'look', path: ['watermark', 'size'], value: value / 100 }) as Command} commitLabel="Watermark size" testId="watermark-size" />
            </Row>
            <Row label="Opacity">
              <RangeInput value={Math.round(watermark.opacity * 100)} min={10} max={100} label="Watermark opacity" toCommand={(value) => ({ type: 'look', path: ['watermark', 'opacity'], value: value / 100 }) as Command} commitLabel="Watermark opacity" testId="watermark-opacity" />
            </Row>
          </div>
        </>
      )}
    </>
  );
}

/** What each heading font is like, in the font list. */
const FONT_NOTES: Record<ThemeFont, string> = {
  Archivo: 'wide, bold',
  Inter: 'plain',
  'Space Grotesk': 'technical',
  Fraunces: 'warm serif',
  'Instrument Serif': 'editorial serif',
  'Bebas Neue': 'tall capitals',
};

function LookPanel() {
  const project = useStore(store, (state) => state.doc?.project);
  const raw = useStore(store, (state) => state.doc?.raw);
  const shortcutCount = useStore(store, (state) => state.media?.shortcuts?.length ?? 0);
  if (!project || !raw) return null;
  const { look: current, output, sources, captions } = project;
  const size = SIZES.find((item) => item.width === output.width && item.height === output.height);
  const webcam = current.webcam;
  const theme = project.theme;
  // the shortcuts the take logged (none in a take recorded before Cuttle logged them)
  const shortcuts = shortcutCount;
  const summaries: Record<LookSection, string> = {
    watermark: current.watermark.enabled
      ? [current.watermark.image ? 'Image' : theme.logo ? 'Logo' : current.watermark.text || theme.name ? 'Text' : 'Nothing to show', CORNER_NAMES[current.watermark.corner].toLowerCase()].join(' · ')
      : 'Off',
    brand: theme.kit ? `Kit · ${theme.kit}` : [theme.name, theme.font !== 'Archivo' && theme.font].filter(Boolean).join(' · ') || 'None set',
    background:
      current.background.preset === 'solid'
        ? `Solid · ${(current.background.color ?? SOLID_DEFAULT).toUpperCase()}`
        : current.background.preset === 'image'
          ? ['Image', current.background.blur && 'soft', current.background.dim && 'darker'].filter(Boolean).join(' · ')
          : current.background.preset === 'gradient'
            ? `Gradient · ${current.background.colors?.length ?? 2} colours${current.background.kind === 'radial' ? ' · radial' : ''}`
            : `${BACKGROUND_NAMES[current.background.preset]}${current.background.colors ? ' · your colours' : ''}`,
    window: current.frame.enabled ? [FRAME_NAMES[current.frame.style], current.frame.title].filter(Boolean).join(' · ') : 'No frame',
    cursor: current.cursor.enabled ? `${CURSOR_NAMES[current.cursor.style]} · ${current.cursor.size}×` : 'Hidden',
    keys: shortcuts === 0 ? 'No shortcuts in this take' : current.keys.enabled ? `${current.keys.show === 'keys' ? 'All keys' : 'Shortcuts'} · ${current.keys.position} · ${shortcuts} in the take` : 'Off',
    camera: !sources.webcam
      ? 'No webcam in this take'
      : webcam.enabled
        ? `${WEBCAM_SHAPE_NAMES[webcam.shape]} · ${webcam.position ? 'moved' : CORNER_NAMES[webcam.corner].toLowerCase()} · ${Math.round(webcam.size * 100)} %`
        : 'Off',
    subtitles: captions.enabled ? CAPTION_STYLE_NAMES[captions.style] : sources.transcript ? 'Off' : 'Not transcribed yet',
    sound: current.audio.enabled
      ? [sources.cleanMic && current.audio.cleanup ? 'Mic · clean voice' : 'Mic', sources.system && current.audio.system && "computer's sound", current.audio.typing && 'key clicks', project.music?.enabled && 'music', current.audio.effects && project.sounds.length > 0 && 'sounds'].filter(Boolean).join(' · ')
      : 'Muted',
    video: `${size?.name ?? `${output.width} × ${output.height}`} · ${output.fps} fps${current.transition.enabled ? ' · crossfades' : ''}${current.motionBlur > 0 ? ' · motion blur' : ''}`,
  };
  return (
    <div className="look-parts">
      <LookPart id="brand" summary={summaries.brand}>
        <BrandFields project={project} />
      </LookPart>

      <LookPart id="watermark" summary={summaries.watermark} on={{ checked: current.watermark.enabled, label: 'Watermark', onChange: (on) => look(['watermark', 'enabled'], on, on ? 'Watermark on' : 'Watermark off'), testId: 'watermark-enabled' }}>
        <WatermarkFields project={project} />
      </LookPart>

      <LookPart id="background" summary={summaries.background}>
        <div className="swatches" role="group" aria-label="Background">
          {BACKGROUND_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={`swatch-button bg-${preset}`}
              aria-pressed={current.background.preset === preset}
              title={BACKGROUND_NAMES[preset]}
              style={swatchStyle(current.background, preset)}
              onClick={() => (preset === 'image' ? void chooseImage('background') : switchTo(preset))}
              data-testid={`bg-${preset}`}
            >
              <span>{BACKGROUND_NAMES[preset]}</span>
            </button>
          ))}
        </div>
        {current.background.preset === 'solid' && (
          <Row label="Colour">
            <ColorInput value={current.background.color ?? SOLID_DEFAULT} path={['background', 'color']} label="Background colour" hex />
          </Row>
        )}
        {current.background.preset === 'image' && current.background.image && (
          <>
            <Row label="Image" plain>
              <span className="path" title={current.background.image}>
                {current.background.image}
              </span>
              <button type="button" className="ghost small" onClick={() => void chooseImage('background')}>
                Replace…
              </button>
            </Row>
            <div className="grid2">
              <Row label="Soft">
                <RangeInput
                  value={Math.round((current.background.blur ?? 0) * 100)}
                  min={0}
                  max={100}
                  label="How soft the image is"
                  toCommand={(value) => ({ type: 'look', path: ['background', 'blur'], value: value > 0 ? value / 100 : undefined }) as Command}
                  commitLabel="Background softness"
                  testId="bg-blur"
                />
              </Row>
              <Row label="Darker">
                <RangeInput
                  value={Math.round((current.background.dim ?? 0) * 100)}
                  min={0}
                  max={80}
                  label="How much darker the image is"
                  toCommand={(value) => ({ type: 'look', path: ['background', 'dim'], value: value > 0 ? value / 100 : undefined }) as Command}
                  commitLabel="Background darker"
                  testId="bg-dim"
                />
              </Row>
            </div>
          </>
        )}
        {isColouredBackground(current.background.preset) && <BackgroundColors background={current.background} logo={Boolean(project.theme.logo)} />}
        {current.background.preset === 'gradient' && (
          <div className="grid2">
            <Row label="Angle" note={current.background.kind === 'radial' ? 'radial: none' : undefined}>
              <NumberInput unit="°" value={current.background.angle ?? 135} min={0} max={360} step={15} digits={0} onCommit={(angle) => look(['background', 'angle'], angle, 'Gradient angle')} testId="bg-angle" />
            </Row>
            <Row label="Shape" plain>
              <div className="seg" role="group" aria-label="Gradient shape">
                <button type="button" aria-pressed={current.background.kind !== 'radial'} onClick={() => look(['background', 'kind'], undefined, 'Gradient: linear')}>
                  Linear
                </button>
                <button type="button" aria-pressed={current.background.kind === 'radial'} onClick={() => look(['background', 'kind'], 'radial', 'Gradient: radial')} data-testid="bg-radial">
                  Radial
                </button>
              </div>
            </Row>
          </div>
        )}
        <Row label="Your desktop" plain>
          <button type="button" className="ghost small" title="The desktop's wallpaper behind the window, softened" onClick={() => void wallpaperBehind()} data-testid="bg-wallpaper">
            Use its wallpaper
          </button>
        </Row>
      </LookPart>

      <LookPart id="window" summary={summaries.window} on={{ checked: current.frame.enabled, label: 'Window frame', onChange: (on) => look(['frame', 'enabled'], on, on ? 'Window frame on' : 'Window frame off') }}>
        {!current.frame.enabled && <p className="hint">No frame: the take shows as it was recorded. Switched on, it gets a window around it.</p>}
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
              <Row label="Corners">
                <NumberInput unit="px" value={current.frame.radius} min={0} max={48} step={1} digits={0} onCommit={(radius) => look(['frame', 'radius'], radius, 'Frame corners')} />
              </Row>
              <Row label="Shadow" inline>
                <Toggle checked={current.frame.shadow} label="Shadow" onChange={(on) => look(['frame', 'shadow'], on, on ? 'Shadow on' : 'Shadow off')} />
              </Row>
            </div>
          </>
        )}
      </LookPart>

      <LookPart id="cursor" summary={summaries.cursor} on={{ checked: current.cursor.enabled, label: 'Cursor', onChange: (on) => look(['cursor', 'enabled'], on, on ? 'Cursor on' : 'Cursor off') }}>
        {!current.cursor.enabled && <p className="hint">Hidden: the video shows no pointer.</p>}
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
                <NumberInput unit="×" value={current.cursor.size} min={0.5} max={4} step={0.25} onCommit={(value) => look(['cursor', 'size'], value, 'Cursor size')} />
              </Row>
              <Row label="Colour">
                <ColorInput value={current.cursor.color} path={['cursor', 'color']} label="Cursor colour" upper hex />
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

      <LookPart
        id="keys"
        summary={summaries.keys}
        on={{ checked: current.keys.enabled, label: 'Keystroke badges', onChange: (on) => look(['keys', 'enabled'], on, on ? 'Keystroke badges on' : 'Keystroke badges off'), testId: 'keys-enabled' }}
      >
        <KeysFields keys={current.keys} shortcuts={shortcuts} />
      </LookPart>

      <LookPart
        id="camera"
        summary={summaries.camera}
        on={{ checked: webcam.enabled && Boolean(sources.webcam), disabled: !sources.webcam, label: 'Webcam bubble', onChange: (on) => look(['webcam', 'enabled'], on, on ? 'Webcam on' : 'Webcam off'), testId: 'webcam-enabled' }}
      >
        {!sources.webcam ? (
          <p className="hint">No webcam in this take: choose a camera before recording the next one.</p>
        ) : webcam.enabled ? (
          <CameraFields webcam={webcam} />
        ) : (
          <p className="hint">Off. Switched on, the webcam shows as a bubble over the video.</p>
        )}
        {sources.webcam && (
          <Row label="From the playhead" note="for 3 s, then back: a lane of its own on the timeline">
            <div className="seg full" role="group" aria-label="Camera layouts">
              {CAMERA_LAYOUTS.map((layout) => (
                <button key={layout} type="button" onClick={() => addCamera(layout)} title={CAMERA_HINTS[layout]} data-testid={`camera-add-${layout}`}>
                  {CAMERA_NAMES[layout]}
                </button>
              ))}
            </div>
          </Row>
        )}
      </LookPart>

      <LookPart id="subtitles" summary={summaries.subtitles} on={{ checked: captions.enabled, label: 'Subtitles', onChange: (on) => caption('enabled', on, on ? 'Subtitles on' : 'Subtitles off'), testId: 'captions-enabled' }}>
        {!captions.enabled && <p className="hint">{sources.transcript ? 'Off. Switched on, what is said shows under the video, word by word.' : 'The take is not transcribed yet: the Transcript tab makes the words the subtitles show.'}</p>}
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
                <NumberInput unit="×" value={captions.size} min={0.5} max={2} step={0.1} onCommit={(size) => caption('size', size, 'Subtitles size')} testId="captions-size" />
              </Row>
              {captions.style !== 'subtitle' && (
                <Row label="Spoken word">
                  <ColorInput value={captions.color} label="Spoken word colour" upper hex toCommand={(color) => ({ type: 'captions', field: 'color', value: color })} />
                </Row>
              )}
            </div>
          </>
        )}
      </LookPart>

      <LookPart id="sound" summary={summaries.sound} on={{ checked: current.audio.enabled, label: 'Sound', onChange: (on) => look(['audio', 'enabled'], on, on ? 'Sound on' : 'Sound off') }}>
        {!current.audio.enabled && <p className="hint">Muted: the video has no sound, neither the mic nor the computer's nor the music nor the sounds.</p>}
        {current.audio.enabled && sources.cleanMic && (
          <Row label="Clean voice" inline note="less noise">
            <Toggle checked={current.audio.cleanup} label="Clean voice" onChange={(on) => look(['audio', 'cleanup'], on, on ? 'Clean voice on' : 'Clean voice off')} testId="audio-cleanup" />
          </Row>
        )}
        {current.audio.enabled && sources.system && (
          <Row label="Computer's sound" inline note="what the apps played">
            <Toggle checked={current.audio.system} label="Computer's sound" onChange={(on) => look(['audio', 'system'], on, on ? "Computer's sound on" : "Computer's sound off")} testId="audio-system" />
          </Row>
        )}
        {current.audio.enabled && sources.system && current.audio.system && (
          <>
            <Row label="Its volume">
              <RangeInput
                value={Math.round(current.audio.systemVolume * 100)}
                min={0}
                max={100}
                label="Computer's sound volume"
                toCommand={(value) => ({ type: 'look', path: ['audio', 'systemVolume'], value: value / 100 }) as Command}
                commitLabel="Computer's sound volume"
                testId="audio-system-volume"
              />
            </Row>
            <Row label="Under speech" note={current.audio.systemDuck > 0 ? `${current.audio.systemDuck} dB down` : 'stays up'}>
              <RangeInput
                value={current.audio.systemDuck}
                min={0}
                max={24}
                label="Computer's sound under speech"
                toCommand={(value) => ({ type: 'look', path: ['audio', 'systemDuck'], value }) as Command}
                commitLabel="Computer's sound under speech"
                testId="audio-system-duck"
              />
            </Row>
          </>
        )}
        {current.audio.enabled && (
          <Row label="Typing sounds" inline note="a click per key">
            <Toggle checked={current.audio.typing} label="Typing sounds" onChange={(on) => look(['audio', 'typing'], on, on ? 'Typing sounds on' : 'Typing sounds off')} testId="audio-typing" />
          </Row>
        )}
        {current.audio.enabled && current.audio.typing && (
          <Row label="Typing volume">
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
          <Row label="Sounds volume">
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
          <Row label="Sped-up clips" inline note={current.audio.muteSpedUp ? 'silent' : 'heard'}>
            <Toggle checked={current.audio.muteSpedUp} label="Silent when sped up" onChange={(on) => look(['audio', 'muteSpedUp'], on, on ? 'Sped-up clips silent' : 'Sped-up clips heard')} />
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
        <Row label="Motion blur" note="as zooms and the pointer move">
          <MotionBlurSelect value={current.motionBlur} />
        </Row>
        <Row label="Crossfade" inline>
          <Toggle checked={current.transition.enabled} label="Crossfade at cuts" onChange={(on) => look(['transition', 'enabled'], on, on ? 'Crossfade on' : 'Crossfade off')} />
        </Row>
        {current.transition.enabled && (
          <Row label="Length" compact>
            <NumberInput unit="s" value={current.transition.duration} min={0} max={2} step={0.1} onCommit={(value) => look(['transition', 'duration'], value, 'Crossfade length')} />
          </Row>
        )}
      </LookPart>
    </div>
  );
}

/**
 * The badges of the shortcuts pressed (⌘K, Ctrl+S): chords only or every special key too, under or
 * over the video, how large. A take recorded before Cuttle logged shortcuts has none.
 */
function KeysFields({ keys, shortcuts }: { keys: CuttleProject['look']['keys']; shortcuts: number }) {
  if (!keys.enabled) return <p className="hint">Off. Switched on, each shortcut pressed in the take shows as keys under the video.</p>;
  return (
    <>
      {shortcuts === 0 && <p className="hint">This take has no shortcuts: a take recorded with an older Cuttle, or one without a keyboard pressed (macOS needs Input Monitoring for it).</p>}
      <Row label="Show" plain>
        <div className="seg full" role="group" aria-label="Which keys">
          <button type="button" aria-pressed={keys.show === 'shortcuts'} onClick={() => look(['keys', 'show'], 'shortcuts', 'Badges: shortcuts')} title="Keys pressed with ⌘, Ctrl, Alt or Win" data-testid="keys-shortcuts">
            Shortcuts
          </button>
          <button type="button" aria-pressed={keys.show === 'keys'} onClick={() => look(['keys', 'show'], 'keys', 'Badges: every key')} title="Shortcuts, and Esc, Enter, Tab and the arrows alone" data-testid="keys-all">
            All keys
          </button>
        </div>
      </Row>
      <Row label="Place" plain>
        <div className="seg full" role="group" aria-label="Where the badges sit">
          <button type="button" aria-pressed={keys.position === 'bottom'} onClick={() => look(['keys', 'position'], 'bottom', 'Badges at the bottom')}>
            Bottom
          </button>
          <button type="button" aria-pressed={keys.position === 'top'} onClick={() => look(['keys', 'position'], 'top', 'Badges at the top')} data-testid="keys-top">
            Top
          </button>
        </div>
      </Row>
      <Row label="Size">
        <RangeInput value={Math.round(keys.size * 100)} min={50} max={200} label="Badge size" toCommand={(value) => ({ type: 'look', path: ['keys', 'size'], value: value / 100 }) as Command} commitLabel="Badge size" testId="keys-size" />
      </Row>
    </>
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
      <Row label="Place" plain inline note={webcam.position ? 'moved; a corner puts it back' : `${CORNER_NAMES[webcam.corner]}, or drag it on the video`}>
        <CornerPicker
          label="Camera corner"
          value={webcam.position ? undefined : webcam.corner}
          onPick={(corner) => edit([{ type: 'look', path: ['webcam', 'corner'], value: corner } as Command, { type: 'look', path: ['webcam', 'position'], value: undefined } as Command], `Camera: ${CORNER_NAMES[corner].toLowerCase()}`)}
          testId="webcam-corner"
        />
      </Row>
      <Row label="Size">
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

/** How far a slider's track is filled (its `--fill`). */
const fillOf = (value: number, min: number, max: number) => `${max > min ? ((value - min) / (max - min)) * 100 : 0}%`;
const fill = (value: number, min: number, max: number) => ({ '--fill': fillOf(value, min, max) }) as CSSProperties;

/** The four corners as a small picture of the video, the chosen one lit; each button's test id is `testId-corner`. */
function CornerPicker({ label, value, onPick, testId }: { label: string; value?: (typeof WEBCAM_CORNERS)[number]; onPick: (corner: (typeof WEBCAM_CORNERS)[number]) => void; testId: string }) {
  return (
    <div className="corner-picker" role="group" aria-label={label}>
      {WEBCAM_CORNERS.map((corner) => (
        <button key={corner} type="button" className={corner} aria-pressed={value === corner} title={CORNER_NAMES[corner]} aria-label={CORNER_NAMES[corner]} onClick={() => onPick(corner)} data-testid={`${testId}-${corner}`}>
          <i />
        </button>
      ))}
    </div>
  );
}

/**
 * A slider with its value beside it: the video and the value follow it while it is dragged (a
 * preview), one edit when it is let go.
 */
function RangeInput({
  value,
  min,
  max,
  label,
  toCommand,
  commitLabel,
  testId,
  format = (shown) => `${shown} %`,
}: {
  value: number;
  min: number;
  max: number;
  label: string;
  toCommand: (value: number) => Command;
  commitLabel: string;
  testId?: string;
  format?: (value: number) => string;
}) {
  const [shown, setShown] = useState(value);
  useEffect(() => setShown(value), [value]);
  return (
    <span className="range-field">
      <input
        key={value}
        type="range"
        className="range"
        style={fill(shown, min, max)}
        min={min}
        max={max}
        step={1}
        defaultValue={value}
        aria-label={label}
        onInput={(event) => {
          const next = Number((event.target as HTMLInputElement).value);
          setShown(next);
          preview([toCommand(next)]);
        }}
        onChange={(event) => {
          preview(undefined);
          edit([toCommand(Number(event.target.value))], commitLabel);
        }}
        data-testid={testId}
      />
      <output>{format(shown)}</output>
    </span>
  );
}
