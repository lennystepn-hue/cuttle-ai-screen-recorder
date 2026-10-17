// The open document in the editor: edits as commands (one gesture is one step to undo), saving when
// a gesture ends with the hash-checked write, the gesture put on top of a newer version when the
// file changed meanwhile, and changes made outside the app (Claude, the CLI, suggest) shown and
// undoable. A change from outside is always a step of its own in the history, so no undo ever
// removes it without saying so.
import { parseProject, type CuttleProject } from '@cuttle/project';
import { applyCommand, describeChange, DocumentError, ensureIds, firstChanged, pinIds, replayCommands, type Command, type EditLimits, type ListName, type Raw } from '../../shared/document';
import type { ChangeOrigin, ProjectFileEvent } from '../../shared/ipc';
import { takeKey } from '../../shared/take';
import { bridge } from '../bridge';
import { store } from './session';

/** A version to go back to, and what going back undoes. */
interface Step {
  raw: Raw;
  label: string;
}

export interface Toast {
  id: number;
  text: string;
  /** "Undo" for a change, when it is still the newest. */
  undo?: boolean;
  /** "Show" for an outside change: the first item it added or changed. */
  show?: { list: ListName; id: string };
  tone?: 'note' | 'warning';
}

export interface DocState {
  raw: Raw;
  project: CuttleProject;
  /** The file's hash on disk for the version saved last (or read). */
  hash: string;
  /** A drag's result before the gesture ends: shown, not saved, not in the history. */
  preview?: CuttleProject;
  saving: boolean;
  /** Why the last save failed, said for people. */
  problem?: string;
  /** cuttle.json on disk does not parse: its issues; editing waits until it is fixed. */
  issues?: string[];
  undoLabel?: string;
  redoLabel?: string;
  toast?: Toast;
  /** A version a conflict set aside (cuttle.json.draft), offered back ("Use mine") until answered: why. */
  draftNote?: string;
  /** The take a restart put aside (its folder in the project), offered back ("Undo restart") until answered. */
  restartNote?: string;
}

const undoStack: Step[] = [];
const redoStack: Step[] = [];
/**
 * The gestures made since the version on disk (`hash`), with the ids their new items got: put on
 * top of a newer version when the file changed meanwhile. Each has its step on the undo stack.
 */
let unsaved: { label: string; commands: Command[] }[] = [];
/** A whole version to write (undo, redo, an outside change undone), instead of replaying commands. */
let unsavedRestore = false;
/** Counts the restores: a write ends one only when no newer one came while it ran (two fast undos). */
let restores = 0;
let saving: Promise<void> | undefined;
/** The person's version a save conflict could not carry over (also in cuttle.json.draft), until answered. */
let draft: Raw | undefined;
/** Versions a save met as conflicts and put the person's gestures on: the watcher's news of them is old. */
const replayedOnto = new Set<string>();
let toastIds = 0;
let limits: () => EditLimits = () => ({});

const parse = (raw: Raw): CuttleProject => {
  const parsed = parseProject(raw);
  if (!parsed.ok) throw new DocumentError('invalid', parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'));
  return parsed.project;
};

const doc = (): DocState => store.get().doc!;

function setDoc(change: Partial<DocState>): void {
  store.set((state) => ({ doc: { ...state.doc!, ...change, undoLabel: undoStack.at(-1)?.label, redoLabel: redoStack.at(-1)?.label } }));
}

export function toast(text: string, options: Omit<Toast, 'id' | 'text'> = {}): void {
  setDoc({ toast: { id: ++toastIds, text, ...options } });
}

export function dismissToast(): void {
  setDoc({ toast: undefined });
}

/** The take was restarted: the one before is offered back, in a note no other note replaces. */
export function offerUndoRestart(discarded: string): void {
  setDoc({ restartNote: discarded });
}

/** Keeps the new take: the one before stays put aside (takes/.discarded), the offer goes. */
export function dismissRestart(): void {
  setDoc({ restartNote: undefined });
}

/** Declines the draft: cuttle.json.draft stays on disk, the offer goes. */
export function dismissDraft(): void {
  draft = undefined;
  setDoc({ draftNote: undefined });
}

/** Opens the document from cuttle.json as read; items without an id get one (written with the first save). */
export function openDocument(raw: Raw, hash: string, editLimits: () => EditLimits): DocState {
  limits = editLimits;
  const withIds = ensureIds(raw);
  return { raw: withIds, project: parse(withIds), hash, saving: false };
}

const BROKEN = 'cuttle.json has a mistake; fix it first (Claude or a text editor), then edit here again.';

/** Applies a gesture's commands as one step (`label` names it for Undo) and saves. Returns false when nothing could change. */
export function edit(commands: Command[], label: string): boolean {
  const current = doc();
  if (current.issues) {
    setDoc({ preview: undefined });
    toast(BROKEN, { tone: 'warning' });
    return false;
  }
  let raw = current.raw;
  const pinned: Command[] = [];
  try {
    for (const command of commands) {
      const next = applyCommand(raw, command, limits());
      pinned.push(pinIds(raw, next, command));
      raw = next;
    }
  } catch (error) {
    setDoc({ preview: undefined });
    if (error instanceof DocumentError) toast(`${label} is not possible: ${error.message.split('\n')[0]}`, { tone: 'warning' });
    else throw error;
    return false;
  }
  if (JSON.stringify(raw) === JSON.stringify(current.raw)) {
    setDoc({ preview: undefined });
    return false;
  }
  undoStack.push({ raw: current.raw, label });
  redoStack.length = 0;
  unsaved.push({ label, commands: pinned });
  setDoc({ raw, project: parse(raw), preview: undefined, toast: undefined });
  void save();
  return true;
}

/** Shows what a gesture would do while it runs (a drag); `edit` ends it. Undefined commands end it without a change. */
export function preview(commands: Command[] | undefined): void {
  if (!commands) return setDoc({ preview: undefined });
  try {
    let raw = doc().raw;
    for (const command of commands) raw = applyCommand(raw, command, limits());
    setDoc({ preview: parse(raw) });
  } catch {
    // a step of the drag that is not possible: keep showing the last one that was
  }
}

export function undo(): void {
  if (doc().issues) return toast(BROKEN, { tone: 'warning' });
  const step = undoStack.pop();
  if (!step) return;
  redoStack.push({ raw: doc().raw, label: step.label });
  restore(step.raw);
}

export function redo(): void {
  if (doc().issues) return toast(BROKEN, { tone: 'warning' });
  const step = redoStack.pop();
  if (!step) return;
  undoStack.push({ raw: doc().raw, label: step.label });
  restore(step.raw);
}

function restore(raw: Raw): void {
  unsavedRestore = true;
  restores++;
  unsaved = [];
  setDoc({ raw, project: parse(raw), preview: undefined, toast: undefined });
  void save();
}

const sourcesOf = (raw: Raw) => takeKey(raw.sources);

/** The undo step of a change made outside the editor, by who made it. */
const ORIGIN_LABELS: Record<ChangeOrigin, string> = { outside: 'the outside change', suggest: "Cuttle's cut", speech: "Cuttle's speech edits" };

/** What the app's speech edits did, said once they arrive. */
function speechToast(project: CuttleProject): string {
  const count = (kind: 'filler' | 'pause') => project.cuts.filter((cut) => cut.auto === kind && cut.enabled).length;
  const fillers = count('filler');
  const pauses = count('pause');
  if (fillers + pauses === 0) return 'Cuttle transcribed the take: no filler words or pauses to cut.';
  const parts = [fillers > 0 && `${fillers} filler word${fillers === 1 ? '' : 's'}`, pauses > 0 && `${pauses} pause${pauses === 1 ? '' : 's'}`].filter(Boolean);
  return `Cuttle cut ${parts.join(' and ')} where the picture rests.`;
}

/** The editor opens anew on another take (its media); the main process reloads it (a page cannot). */
function reloadForTake(): void {
  void bridge.invoke('project:reload');
}

/** Writes the document; a newer version on disk gets the unsaved gestures put on top of it. One write at a time. */
function save(): Promise<void> {
  if (saving) return saving.then(() => (unsaved.length > 0 || unsavedRestore ? save() : undefined));
  saving = (async () => {
    setDoc({ saving: true });
    // Gestures made while this save runs are written by the save chained after it.
    for (let conflicts = 0; ; ) {
      const { raw, hash } = doc();
      const writing = unsaved.length;
      const restoring = unsavedRestore;
      const restored = restores;
      const answer = await bridge.invoke('project:save', { raw, base: hash }).catch((error: Error) => ({ problem: error.message }));
      if ('hash' in answer) {
        unsaved = unsaved.slice(writing);
        // a restore that came while this one was written still has to be written (the save chained after this)
        if (restoring && restored === restores) unsavedRestore = false;
        setDoc({ hash: answer.hash, problem: undefined });
        return finish();
      }
      if ('problem' in answer) {
        setDoc({ problem: answer.problem });
        return finish();
      }
      // The file changed meanwhile (Claude, the CLI, suggest).
      if (++conflicts > 5) {
        setDoc({ problem: 'cuttle.json keeps changing outside the app' });
        return finish();
      }
      const conflict = answer.conflict;
      replayedOnto.add(conflict.hash);
      const latest = ensureIds(conflict.raw);
      const mine = doc().raw;
      let newer: CuttleProject;
      try {
        newer = parse(latest);
      } catch {
        // the outside version has a mistake (the banner shows it): the edit is saved once it is fixed
        setDoc({ problem: 'cuttle.json changed outside the app and has a mistake: your edit is saved once it is fixed' });
        return finish();
      }
      const outside = ORIGIN_LABELS[conflict.origin];
      if (restoring) {
        // An undo or redo is a whole version: the newer one shows, as a step to undo (back to the
        // version the person had asked for).
        unsavedRestore = false;
        unsaved = [];
        undoStack.push({ raw: mine, label: outside });
        redoStack.length = 0;
        setDoc({ raw: latest, project: newer, hash: conflict.hash });
        toast(`cuttle.json changed outside the app as you undid (${describeChange(parse(mine), newer)}): it shows now. Undo goes back to yours.`, { undo: true, tone: 'warning' });
        return finish();
      }
      // The gestures go on top of the newer version, and the history says so: the outside change is
      // the step below them, so undoing them never undoes it unannounced.
      const gestures = unsaved;
      const steps = undoStack.splice(undoStack.length - gestures.length, gestures.length);
      const before = steps[0]?.raw ?? mine;
      undoStack.push({ raw: before, label: outside });
      let merged = latest;
      const dropped: string[] = [];
      for (const gesture of gestures) {
        undoStack.push({ raw: merged, label: gesture.label });
        const replayed = replayCommands(merged, gesture.commands, limits());
        merged = replayed.raw;
        dropped.push(...replayed.dropped);
      }
      redoStack.length = 0;
      setDoc({ raw: merged, project: parse(merged), hash: conflict.hash });
      if (sourcesOf(latest) !== sourcesOf(mine)) {
        // another take: the editor opens on it; what could not go on it is in the draft
        if (dropped.length > 0 || gestures.length > 0) await keepDraft(mine, 'A new take was put in cuttle.json while you edited.');
        reloadForTake();
        return finish();
      }
      const show = firstChanged(parse(before), newer);
      // (`dropped` names items by id: the note names the gesture instead)
      if (dropped.length > 0) void keepDraft(mine, `cuttle.json changed outside the app, and “${gestures.at(-1)?.label}” no longer fits it.`);
      toast(`Changed outside the app while you edited: ${describeChange(parse(before), newer)}. Your edit is on top of it.`, { ...(show && { show }) });
      // the version with the gestures on top is written next
    }
  })();
  return saving.finally(() => (saving = undefined));

  function finish(): void {
    setDoc({ saving: false });
  }
}

/**
 * Keeps the person's version that a conflict could not carry over, in cuttle.json.draft, and offers
 * it back. The first one waits until it is answered: a later conflict does not replace it.
 */
async function keepDraft(mine: Raw, why: string): Promise<void> {
  if (draft) return;
  draft = mine;
  const kept = await bridge.invoke('project:draft', { raw: mine }).then(
    () => true,
    () => false,
  );
  setDoc({ draftNote: `${why} ${kept ? 'Your version is kept in cuttle.json.draft.' : 'Your version can still be used.'}` });
}

/** "Use mine": the version a conflict set aside replaces the file's, as a new step to undo. */
export function useDraft(): void {
  if (!draft || doc().issues) return;
  const mine = draft;
  draft = undefined;
  setDoc({ draftNote: undefined });
  undoStack.push({ raw: doc().raw, label: 'Use your version' });
  redoStack.length = 0;
  restore(mine);
}

/** Writes again what a failed save left unsaved (the title bar's "Not saved · Try again"). */
export function retrySave(): void {
  setDoc({ problem: undefined });
  if (unsaved.length > 0 || unsavedRestore) void save();
}

/**
 * Waits until every edit is on disk (before an export, which reads the file, and before the window
 * closes): the save under way, then the ones queued behind it. Resolves with whether everything is
 * on disk; a save that failed, or a file that does not parse, ends the wait with false.
 */
export async function flush(): Promise<boolean> {
  for (;;) {
    if (saving) await saving;
    else if ((unsaved.length > 0 || unsavedRestore) && !doc().problem && !doc().issues) await save();
    else return unsaved.length === 0 && !unsavedRestore;
  }
}

/**
 * Before the window closes: the field being typed in is left (it saves), every edit is written,
 * and what could not be is kept in cuttle.json.draft.
 */
export async function beforeClose(): Promise<void> {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  if (!store.get().doc) return;
  if (!(await flush())) await bridge.invoke('project:draft', { raw: doc().raw }).catch(() => undefined);
}

/**
 * A version of cuttle.json this window did not write. With nothing unsaved it replaces the document
 * at once, as one step to undo; while a gesture or a save is under way, the save puts the gesture on
 * top of it. A file that does not parse keeps the last good document; another take reloads.
 */
export async function outsideChange(event: ProjectFileEvent): Promise<void> {
  if ('issues' in event) return setDoc({ issues: event.issues, preview: undefined });
  if (doc().issues) setDoc({ issues: undefined, preview: undefined });
  if (event.hash === doc().hash) return;
  if (saving) await saving;
  // our save met this version as a conflict and put the gesture on top of it: nothing more to take
  if (event.hash === doc().hash || replayedOnto.has(event.hash)) return;
  // an edit still waits (its save failed, or met a version with a mistake): it goes on top of this one
  if (unsaved.length > 0 || unsavedRestore) return void save();
  const before = doc();
  const raw = ensureIds(event.raw);
  if (sourcesOf(raw) !== sourcesOf(before.raw)) return reloadForTake();
  let project: CuttleProject;
  try {
    project = parse(raw);
  } catch {
    return;
  }
  undoStack.push({ raw: before.raw, label: ORIGIN_LABELS[event.origin] });
  redoStack.length = 0;
  setDoc({ raw, project, hash: event.hash, preview: undefined });
  const show = firstChanged(before.project, project);
  const said = event.origin === 'suggest' ? 'Cuttle cut the take.' : event.origin === 'speech' ? speechToast(project) : `Changed outside the app: ${describeChange(before.project, project)}`;
  toast(said, { undo: true, ...(show && event.origin === 'outside' && { show }) });
}
