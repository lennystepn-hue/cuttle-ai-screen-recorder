// The script's steps as titles: where the video shows each step reached, its title as a text in the
// lower-third style, or as an overlay of the step's motion template. The titles suggest made before
// are replaced; one the person switched off stays off; texts and overlays of their own stay.
import { newId, type CuttleProject, type StepMotion } from '@cuttle/project';
import { shownFrom, type ClipSpan, type StepMove } from '@cuttle/timeline';

/** A step's title shows this many seconds of the video, less when the next step comes sooner. */
export const STEP_TITLE_SECONDS = 3;
/** The motion templates' own lengths (seconds of the video), as the kit adds them. */
export const STEP_MOTION_SECONDS: Record<StepMotion, number> = { 'lower-third': 4, title: 3.5 };
/** A title is not made for a step shown shorter than this (output seconds). */
const MIN_TITLE_SECONDS = 0.8;

type RawItem = Record<string, unknown>;

export interface StepTitlesInput {
  moves: readonly StepMove[];
  /** The new clips, with where each starts in the video. */
  clips: readonly ClipSpan[];
  /** Where the texts go: the top when subtitles take the bottom. */
  position: 'top' | 'bottom';
  /** Make them (the kind is on); off: only the titles made before go. */
  make: boolean;
  /** Copies a motion template into the project for the steps that name one, and gives its page; none: titles as texts. */
  page?: (template: StepMotion) => Promise<string | undefined>;
}

export interface StepTitles {
  /** The file's texts and overlays afterwards; none when nothing changed in them. */
  texts?: RawItem[];
  overlays?: RawItem[];
  made: number;
  notes: string[];
}

/** What a title says, as its item has it: a text's words, an overlay's title param (or the lower third's name). */
const sayOf = (item: { text?: unknown; params?: unknown }) => {
  const params = (item.params ?? {}) as Record<string, unknown>;
  return String(item.text ?? params.title ?? params.name ?? '');
};

/** The steps' titles, in place of those suggest made before (tagged `auto: "title"`). */
export async function withStepTitles(raw: RawItem, project: CuttleProject, input: StepTitlesInput, taken: Set<string>): Promise<StepTitles> {
  const notes: string[] = [];
  const rawTexts = (raw.texts as RawItem[] | undefined) ?? [];
  const rawOverlays = (raw.overlays as RawItem[] | undefined) ?? [];
  const ours = (item: RawItem) => item.auto === 'title';
  // a title switched off by the person: the new one for the same words stays off
  const off = new Set([...project.texts, ...project.overlays].filter((item) => item.auto === 'title' && !item.enabled).map(sayOf));
  const texts: RawItem[] = [];
  const overlays: RawItem[] = [];
  const pages = new Map<StepMotion, string | undefined>();
  const speedAt = (t: number) => input.clips.find((clip) => t >= clip.from && t < clip.to)?.speed ?? 1;
  // no title goes on past the take's last shown second
  const last = Math.max(...input.clips.map((clip) => clip.to));
  const total = project.script.length;
  if (input.make) {
    for (const [i, move] of input.moves.entries()) {
      const at = shownFrom(input.clips, move.t);
      if (at === undefined) continue;
      const next = input.moves.slice(i + 1).map((later) => shownFrom(input.clips, later.t)).find((t): t is number => t !== undefined && t > at) ?? Infinity;
      const motion = move.step.motion;
      if (motion && input.page && !pages.has(motion)) pages.set(motion, await input.page(motion));
      const src = motion ? pages.get(motion) : undefined;
      // seconds of the video, as source seconds where it shows them (a sped-up clip shows more of them)
      const shown = src && motion ? STEP_MOTION_SECONDS[motion] : STEP_TITLE_SECONDS;
      const duration = Math.round(Math.min(shown * speedAt(at), next - at, last - at) * 1000) / 1000;
      if (duration / speedAt(at) < MIN_TITLE_SECONDS) continue;
      const title = move.step.title;
      const common = { label: `Step ${move.number}`, at: Math.round(at * 1000) / 1000, duration, ...(off.has(title) && { enabled: false }), auto: 'title' };
      if (src && motion) {
        const params = motion === 'lower-third' ? { name: title, role: `Step ${move.number} of ${total}` } : { title, eyebrow: `Step ${move.number}`, background: false };
        overlays.push({ id: newId('overlays', taken), ...common, src, params });
      } else {
        texts.push({ id: newId('texts', taken), ...common, text: title, style: 'lower-third', position: input.position });
      }
    }
    const missing = [...pages].filter(([, page]) => page === undefined).map(([motion]) => motion);
    if (missing.length > 0) notes.push(`the motion template${missing.length === 1 ? '' : 's'} ${missing.join(', ')} could not be added: those step titles are texts`);
    if (texts.length + overlays.length > 0) notes.push(`${texts.length + overlays.length} step title${texts.length + overlays.length === 1 ? '' : 's'} from the script`);
  }
  const before = { texts: rawTexts.filter(ours).length, overlays: rawOverlays.filter(ours).length };
  return {
    ...((before.texts > 0 || texts.length > 0) && { texts: [...rawTexts.filter((item) => !ours(item)), ...texts] }),
    ...((before.overlays > 0 || overlays.length > 0) && { overlays: [...rawOverlays.filter((item) => !ours(item)), ...overlays] }),
    made: texts.length + overlays.length,
    notes,
  };
}
