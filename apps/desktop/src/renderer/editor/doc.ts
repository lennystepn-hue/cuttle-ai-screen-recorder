// The open document in the editor: edits as commands (one gesture is one step to undo), saving when
// a gesture ends with the hash-checked write, the gesture replayed on a newer version when the
// file changed meanwhile, and changes made outside the app (Claude, the CLI, suggest) shown and
// undoable.
import { parseProject, type CuttleProject } from '@cuttle/project';
import { applyCommand, describeChange, DocumentError, ensureIds, firstChanged, replayCommands, type Command, type EditLimits, type ListName, type Raw } from '../../shared/document';
import type { ProjectFileEvent } from '../../shared/ipc';
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
  /** "Use mine" for the version a conflict set aside (cuttle.json.draft); it stays until answered. */
  draft?: boolean;
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
}

const undoStack: Step[] = [];
const redoStack: Step[] = [];
/** Commands applied since the version on disk (`hash`): replayed when the file changed meanwhile. */
let unsaved: Command[] = [];
/** A whole version to write (undo, redo, an outside change undone), instead of replaying commands. */
let unsavedRestore = false;
let saving: Promise<void> | undefined;
/** The person's version a save conflict could not carry over (also in cuttle.json.draft). */
let draft: Raw | undefined;
/** The newest edit not on disk yet, to name it when a newer version cannot take it. */
let unsavedLabel = '';
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

/** Opens the document from cuttle.json as read; items without an id get one (written with the first save). */
export function openDocument(raw: Raw, hash: string, editLimits: () => EditLimits): DocState {
  limits = editLimits;
  const withIds = ensureIds(raw);
  return { raw: withIds, project: parse(withIds), hash, saving: false };
}

/** Applies a gesture's commands as one step (`label` names it for Undo) and saves. Returns false when nothing could change. */
const BROKEN = 'cuttle.json has a mistake; fix it first (Claude or a text editor), then edit here again.';

export function edit(commands: Command[], label: string): boolean {
  const current = doc();
  if (current.issues) {
    toast(BROKEN, { tone: 'warning' });
    return false;
  }
  let raw = current.raw;
  try {
    for (const command of commands) raw = applyCommand(raw, command, limits());
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
  unsaved.push(...commands);
  unsavedLabel = label;
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
  unsaved = [];
  setDoc({ raw, project: parse(raw), preview: undefined, toast: undefined });
  void save();
}

/** Writes the document; a newer version on disk gets the unsaved commands replayed on it. One write at a time. */
function save(): Promise<void> {
  if (saving) return saving.then(() => (unsaved.length > 0 || unsavedRestore ? save() : undefined));
  saving = (async () => {
    setDoc({ saving: true });
    for (let attempt = 0; attempt < 5; attempt++) {
      const { raw, hash } = doc();
      const writing = unsaved.length;
      const restoring = unsavedRestore;
      const answer = await bridge.invoke('project:save', { raw, base: hash }).catch((error: Error) => ({ problem: error.message }));
      if ('hash' in answer) {
        unsaved = unsaved.slice(writing);
        if (restoring) unsavedRestore = false;
        setDoc({ hash: answer.hash, problem: undefined });
        if (unsaved.length === 0 && !unsavedRestore) break;
        continue;
      }
      if ('problem' in answer) {
        setDoc({ problem: answer.problem });
        break;
      }
      // The file changed meanwhile (Claude, the CLI): this gesture's commands go on top of that version.
      const latest = ensureIds(answer.conflict.raw);
      const mine = doc().raw;
      let newer: CuttleProject;
      try {
        newer = parse(latest);
      } catch {
        // the outside version has a mistake (the banner shows it): the edit is saved once it is fixed
        setDoc({ problem: 'cuttle.json changed outside the app and has a mistake: your edit is saved once it is fixed' });
        break;
      }
      if (restoring) {
        // an undo or redo cannot be replayed: the newer version shows, and the person's is kept to choose
        unsavedRestore = false;
        unsaved = [];
        const before = doc().project;
        setDoc({ raw: latest, project: newer, hash: answer.conflict.hash });
        void keepDraft(mine, `cuttle.json changed outside the app (${describeChange(before, newer)}), so your undo was not saved.`);
        break;
      }
      const { raw: merged, dropped } = replayCommands(latest, unsaved, limits());
      setDoc({ raw: merged, project: parse(merged), hash: answer.conflict.hash });
      // (`dropped` names items by id: the note names the edit instead)
      if (dropped.length > 0) void keepDraft(mine, `cuttle.json changed outside the app, and “${unsavedLabel}” no longer fits it.`);
    }
    setDoc({ saving: false });
  })();
  return saving.finally(() => (saving = undefined));
}

/** Keeps the person's version that a conflict could not carry over, in cuttle.json.draft, and offers it back. */
async function keepDraft(mine: Raw, why: string): Promise<void> {
  draft = mine;
  const kept = await bridge.invoke('project:draft', { raw: mine }).then(
    () => true,
    () => false,
  );
  toast(`${why} ${kept ? 'Your version is kept in cuttle.json.draft.' : 'Your version can still be used.'}`, { tone: 'warning', draft: true });
}

/** "Use mine": the version a conflict set aside replaces the file's, as a new step to undo. */
export function useDraft(): void {
  if (!draft || doc().issues) return;
  const mine = draft;
  draft = undefined;
  undoStack.push({ raw: doc().raw, label: 'Use your version' });
  redoStack.length = 0;
  restore(mine);
}

/** Writes again what a failed save left unsaved (the title bar's "Not saved · Try again"). */
export function retrySave(): void {
  if (unsaved.length > 0 || unsavedRestore) void save();
  else setDoc({ problem: undefined });
}

/**
 * Waits until every edit is on disk (before an export, which reads the file): the save under way,
 * then the ones queued behind it. A save that failed, or a file that does not parse, ends the wait.
 */
export async function flush(): Promise<void> {
  for (;;) {
    if (saving) await saving;
    else if ((unsaved.length > 0 || unsavedRestore) && !doc().problem && !doc().issues) await save();
    else return;
  }
}

/**
 * A version of cuttle.json this window did not write. With nothing unsaved it replaces the document
 * at once, as one step to undo; while a gesture or a save is under way, the save replays the
 * gesture on it. A file that does not parse keeps the last good document.
 */
export async function outsideChange(event: ProjectFileEvent): Promise<void> {
  if ('issues' in event) return setDoc({ issues: event.issues });
  if (doc().issues) setDoc({ issues: undefined });
  if (event.hash === doc().hash) return;
  if (saving) await saving;
  // our save conflicted on this version and replayed onto it: nothing more to take
  if (event.hash === doc().hash) return;
  // an edit still waits (its save failed, or met a version with a mistake): it goes on top of this one
  if (unsaved.length > 0 || unsavedRestore) return void save();
  const before = doc();
  const raw = ensureIds(event.raw);
  let project: CuttleProject;
  try {
    project = parse(raw);
  } catch {
    return;
  }
  undoStack.push({ raw: before.raw, label: event.origin === 'suggest' ? 'Cut by suggest' : 'the outside change' });
  redoStack.length = 0;
  setDoc({ raw, project, hash: event.hash, preview: undefined });
  const show = firstChanged(before.project, project);
  toast(event.origin === 'suggest' ? 'Cut by suggest' : `Changed outside the app: ${describeChange(before.project, project)}`, { undo: true, ...(show && event.origin !== 'suggest' && { show }) });
}
