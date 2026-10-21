// Everything the editor can do by name, with its keys: the command menu (Ctrl+K) lists these, and
// the keyboard runs them. Keys are written as the menu shows them.
import { EXPORT_FORMATS } from '@cuttle/export/formats';
import { BUILT_IN_SOUNDS, MOTION_TEMPLATES, MUSIC_TEMPLATES } from '@cuttle/motion-kit';
import { bridge } from '../bridge';
import {
  addCard,
  addMask,
  addMotion,
  addMusic,
  addSound,
  addPage,
  addZoom,
  autoZoomClicks,
  cycleSpeed,
  deleteSelection,
  duplicateSelection,
  overlayBlocked,
  selectedOrCurrentClip,
  setSpeed,
  showRawTake,
  split,
  templateLabel,
} from './actions';
import { redo, undo } from './doc';
import { currentPlayer, openExport, select, setFormat, setTool, store } from './session';

export interface EditorCommand {
  id: string;
  name: string;
  /** Shown beside the name, never searched (what Undo would undo). */
  detail?: string;
  /** More words it is found by. */
  keywords?: string;
  /** The keys, as people read them ("Ctrl+Z"). */
  keys?: string;
  group: 'Edit' | 'Add' | 'Play' | 'View' | 'Tools' | 'Project';
  run: () => void;
  /** Why it cannot run now, for the menu; undefined when it can. */
  blocked?: () => string | undefined;
}

const needsSelection = () => (store.get().selection ? undefined : 'Select something first');
const needsClip = () => (selectedOrCurrentClip() ? undefined : 'Select a clip, or move the playhead onto one');

export function editorCommands(): EditorCommand[] {
  const player = currentPlayer();
  return [
    // what they undo is shown, not searched: "zoom" must not find "Undo Add zoom"
    { id: 'undo', name: 'Undo', detail: store.get().doc?.undoLabel, keys: 'Ctrl+Z', group: 'Edit', run: undo, blocked: () => (store.get().doc?.undoLabel ? undefined : 'Nothing to undo') },
    { id: 'redo', name: 'Redo', detail: store.get().doc?.redoLabel, keys: 'Ctrl+Shift+Z', group: 'Edit', run: redo, blocked: () => (store.get().doc?.redoLabel ? undefined : 'Nothing to redo') },
    { id: 'split', name: 'Split the clip at the playhead', keys: 'S', group: 'Edit', run: split, blocked: () => (selectedOrCurrentClip() ? undefined : 'Move the playhead onto a clip') },
    { id: 'delete', name: 'Delete the selection', keys: 'Delete', group: 'Edit', run: deleteSelection, blocked: needsSelection },
    { id: 'duplicate', name: 'Duplicate the selection', keys: 'Ctrl+D', group: 'Edit', run: duplicateSelection, blocked: needsSelection },
    { id: 'faster', name: 'Faster: the next speed', keywords: 'speed', keys: 'R', group: 'Edit', run: () => cycleSpeed(1), blocked: needsClip },
    { id: 'slower', name: 'Slower: the speed before', keywords: 'speed', keys: 'Shift+R', group: 'Edit', run: () => cycleSpeed(-1), blocked: needsClip },
    { id: 'speed-1', name: 'Normal speed (1×)', keywords: 'speed', group: 'Edit', run: () => setSpeed(1), blocked: needsClip },
    { id: 'raw', name: 'Show the raw take (one clip over all of it)', group: 'Edit', run: showRawTake },
    { id: 'add-zoom', name: 'Add a zoom at the playhead', group: 'Add', run: () => addZoom(), blocked: () => overlayBlocked() },
    { id: 'auto-zoom', name: 'Zoom on clicks: add zooms where you clicked', keywords: 'auto zoom clicks automatic follow', group: 'Add', run: autoZoomClicks },
    { id: 'add-mask', name: 'Add a mask at the playhead', group: 'Add', run: () => addMask(), blocked: () => overlayBlocked() },
    { id: 'add-caption', name: 'Add a caption at the playhead (type it on the video)', group: 'Add', run: () => setTool('caption'), blocked: () => overlayBlocked() },
    { id: 'add-card', name: 'Add a title card', group: 'Add', run: addCard },
    { id: 'add-page', name: 'Add a page (an image)…', group: 'Add', run: () => void addPage() },
    ...MOTION_TEMPLATES.map(
      (template): EditorCommand => ({
        id: `add-motion-${template.name}`,
        name: `Add motion: ${templateLabel(template.name)}${template.kind === 'scene' ? '' : ' (over the video)'}`,
        keywords: `motion template animation ${template.kind} ${template.description}`,
        group: 'Add',
        run: () => void addMotion(template.name),
      }),
    ),
    ...MUSIC_TEMPLATES.map(
      (template): EditorCommand => ({
        id: `add-music-${template.name}`,
        name: `Add music: ${templateLabel(template.name)}`,
        keywords: `music soundtrack score song ${template.description}`,
        group: 'Add',
        run: () => void addMusic(template.name),
      }),
    ),
    ...BUILT_IN_SOUNDS.map(
      ([name, description]): EditorCommand => ({
        id: `add-sound-${name}`,
        name: `Add a sound at the playhead: ${templateLabel(name)}`,
        keywords: `sound effect sfx ${description}`,
        group: 'Add',
        run: () => addSound(name),
      }),
    ),
    { id: 'tool-select', name: 'Select tool', keys: 'V', group: 'Tools', run: () => setTool('select') },
    { id: 'tool-zoom', name: 'Zoom tool: draw a zoom on the video', keys: 'Z', group: 'Tools', run: () => setTool('zoom'), blocked: () => overlayBlocked() },
    { id: 'tool-mask', name: 'Mask tool: draw a mask on the video', keys: 'M', group: 'Tools', run: () => setTool('mask'), blocked: () => overlayBlocked() },
    { id: 'tool-caption', name: 'Caption tool: type a caption on the video', keys: 'T', group: 'Tools', run: () => setTool('caption'), blocked: () => overlayBlocked() },
    { id: 'tool-crop', name: 'Crop tool: draw the part of the screen a clip shows', keywords: 'crop trim tabs taskbar', keys: 'C', group: 'Tools', run: () => setTool('crop'), blocked: () => overlayBlocked() },
    { id: 'play', name: 'Play or pause', keys: 'Space', group: 'Play', run: () => player?.toggle() },
    { id: 'back', name: 'A second back', keys: 'J', group: 'Play', run: () => void player?.seek(player.current().t - 1) },
    { id: 'frame-back', name: 'A frame back (Shift: a second)', keys: '←', group: 'Play', run: () => void player?.seek(player.current().t - 1 / player.fps) },
    { id: 'frame-on', name: 'A frame on (Shift: a second)', keys: '→', group: 'Play', run: () => void player?.seek(player.current().t + 1 / player.fps) },
    { id: 'start', name: 'Go to the start', keys: 'Home', group: 'Play', run: () => void player?.seek(0) },
    { id: 'end', name: 'Go to the end', keys: 'End', group: 'Play', run: () => void player?.seek(player.duration) },
    { id: 'fit', name: 'Fit the whole video in the timeline', keywords: 'zoom scale timeline', keys: 'Shift+Z', group: 'View', run: () => store.set({ pxPerSecond: 0 }) },
    { id: 'snap', name: store.get().snap ? 'Turn snapping off' : 'Turn snapping on', group: 'View', run: () => store.set({ snap: !store.get().snap }) },
    { id: 'deselect', name: 'Clear the selection', keys: 'Esc', group: 'View', run: () => select(undefined) },
    { id: 'look', name: 'Show the look (background, frame, cursor…)', group: 'View', run: () => store.set({ tab: 'look' }) },
    { id: 'auto', name: 'Show what Cuttle did on its own', keywords: 'automatic zooms cuts masks fillers pauses', group: 'View', run: () => store.set({ tab: 'auto' }) },
    { id: 'transcript', name: 'Show the transcript', keywords: 'words speech subtitles', group: 'View', run: () => store.set({ tab: 'transcript' }) },
    { id: 'format-own', name: 'Preview at the project’s own size', keywords: 'format aspect output', group: 'View', run: () => setFormat(undefined) },
    ...Object.keys(EXPORT_FORMATS).map(
      (name): EditorCommand => ({ id: `format-${name}`, name: `Preview as ${name}`, keywords: 'format aspect output vertical square', group: 'View', run: () => setFormat(name as keyof typeof EXPORT_FORMATS) }),
    ),
    { id: 'export', name: 'Export…', keys: 'Ctrl+E', group: 'Project', run: openExport },
    { id: 'record', name: 'Record a new take for this project', keywords: 'record again retake', group: 'Project', run: () => void bridge.invoke('project:record') },
    { id: 'takes', name: 'Earlier takes of this project…', keywords: 'takes restore history', group: 'Project', run: () => void bridge.invoke('project:takes') },
    { id: 'reveal', name: 'Show the project’s folder', keywords: 'finder explorer files open', group: 'Project', run: () => void bridge.invoke('project:reveal') },
    { id: 'settings', name: 'Settings…', keywords: 'preferences ffmpeg countdown camera microphone motion', keys: 'Ctrl+,', group: 'Project', run: () => void bridge.invoke('app:settings') },
  ];
}
