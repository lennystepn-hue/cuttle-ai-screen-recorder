// The editor's layout as the person sets it: the inspector's width (or the inspector hidden) and the
// timeline's height. Kept in this browser's storage (the editor windows share it) and put on the
// root as CSS variables: a drag moves the grid a frame at a time without React rendering the editor.
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { store, type EditorState } from './session';

/** The inspector's width: its default, and how narrow and wide a drag makes it. */
export const INSPECTOR_WIDTH = { initial: 360, min: 320, max: 440 };
/** The timeline at its lowest (its bar and two lanes); at its highest it leaves the video 38 % of the window. */
const TIMELINE_MIN = 150;
const TIMELINE_MAX_VH = 62;
const KEY = 'cuttle.editor.layout';

interface Layout {
  inspectorWidth?: number;
  timelineHeight?: number;
  inspectorHidden?: boolean;
}

function load(): Layout {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return typeof saved === 'object' && saved !== null ? (saved as Layout) : {};
  } catch {
    return {};
  }
}

let layout: Layout = load();

function keep(change: Partial<Layout>): void {
  layout = { ...layout, ...change };
  try {
    localStorage.setItem(KEY, JSON.stringify(layout));
  } catch {
    // storage refused (a private profile): the layout lasts this window
  }
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function setWidth(width: number | undefined): void {
  const root = document.documentElement.style;
  if (width === undefined) root.removeProperty('--inspector-width');
  else root.setProperty('--inspector-width', `${width}px`);
}

function setHeight(height: number | undefined): void {
  const root = document.documentElement;
  // a height kept from a taller window still leaves the video its share
  if (height === undefined) root.style.removeProperty('--timeline-height');
  else root.style.setProperty('--timeline-height', `min(${height}px, ${TIMELINE_MAX_VH}vh)`);
  root.toggleAttribute('data-timeline-sized', height !== undefined);
}

/** Hides the inspector, or shows it again; kept for the next editor. */
export function toggleInspector(): void {
  const hidden = !store.get().inspectorHidden;
  store.set({ inspectorHidden: hidden });
  keep({ inspectorHidden: hidden });
}

/** Shows the inspector at one of its tabs (a command asked for it). */
export function showInspector(tab?: EditorState['tab']): void {
  if (store.get().inspectorHidden) toggleInspector();
  if (tab) store.set({ tab });
}

/**
 * The handles in the gutters: the inspector's left edge (its width) and the timeline's top edge
 * (its height). A drag follows the pointer a frame at a time; a double click goes back to the
 * default. Also puts the kept layout on the root as the editor opens.
 */
export function LayoutHandles() {
  useEffect(() => {
    setWidth(layout.inspectorWidth);
    setHeight(layout.timelineHeight);
    if (layout.inspectorHidden) store.set({ inspectorHidden: true });
  }, []);
  return (
    <>
      <Handle
        className="resize-inspector"
        axis="x"
        title="Drag to make the inspector wider or narrower; double-click for its usual width"
        measure={() => document.querySelector('.inspector')?.getBoundingClientRect().width ?? INSPECTOR_WIDTH.initial}
        // the inspector is on the right: dragging left widens it
        apply={(start, moved) => {
          const width = Math.round(clamp(start - moved, INSPECTOR_WIDTH.min, INSPECTOR_WIDTH.max));
          setWidth(width);
          return width;
        }}
        commit={(width) => keep({ inspectorWidth: width })}
        reset={() => {
          setWidth(undefined);
          keep({ inspectorWidth: undefined });
        }}
      />
      <Handle
        className="resize-timeline"
        axis="y"
        title="Drag to make the timeline taller or lower; double-click to fit its rows"
        measure={() => document.querySelector('.timeline')?.getBoundingClientRect().height ?? 240}
        apply={(start, moved) => {
          const height = Math.round(clamp(start - moved, TIMELINE_MIN, (window.innerHeight * TIMELINE_MAX_VH) / 100));
          setHeight(height);
          return height;
        }}
        commit={(height) => keep({ timelineHeight: height })}
        reset={() => {
          setHeight(undefined);
          keep({ timelineHeight: undefined });
        }}
      />
    </>
  );
}

function Handle({
  className,
  axis,
  title,
  measure,
  apply,
  commit,
  reset,
}: {
  className: string;
  axis: 'x' | 'y';
  title: string;
  measure: () => number;
  apply: (start: number, moved: number) => number;
  commit: (value: number) => void;
  reset: () => void;
}) {
  const drag = useRef<{ from: number; start: number; at: number; value?: number; frame?: number }>(undefined);
  const onDown = (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    (event.target as Element).setPointerCapture(event.pointerId);
    const from = axis === 'x' ? event.clientX : event.clientY;
    drag.current = { from, start: measure(), at: from };
    document.documentElement.dataset.resizing = axis;
  };
  const onMove = (event: ReactPointerEvent) => {
    const current = drag.current;
    if (!current) return;
    current.at = axis === 'x' ? event.clientX : event.clientY;
    // one change of the grid a frame, however often the pointer moves
    current.frame ??= requestAnimationFrame(() => {
      current.frame = undefined;
      current.value = apply(current.start, current.at - current.from);
    });
  };
  const onUp = () => {
    const current = drag.current;
    drag.current = undefined;
    delete document.documentElement.dataset.resizing;
    if (!current) return;
    if (current.frame !== undefined) {
      cancelAnimationFrame(current.frame);
      current.value = apply(current.start, current.at - current.from);
    }
    if (current.value !== undefined) commit(current.value);
  };
  return <div className={`resize-handle ${className}`} role="separator" aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'} title={title} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onDoubleClick={reset} />;
}
