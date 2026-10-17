import { z } from 'zod';

// The cuttle.json format version this build reads and writes.
export const CURRENT_VERSION = 1;

export const BACKGROUND_PRESETS = ['sunset-sky', 'aurora', 'mesh', 'solid', 'image'] as const;
export const FRAME_STYLES = ['mac-dark', 'mac-light', 'browser-light', 'none'] as const;
export const TEXT_STYLES = ['pill', 'lower-third', 'caption'] as const;
export const CURSOR_STYLES = ['system', 'arrow-white', 'arrow-black', 'dot', 'ring', 'spotlight'] as const;
export const CURSOR_SHAPES = ['arrow', 'text', 'pointer', 'wait', 'crosshair', 'move', 'not-allowed'] as const;
export const EASES = ['smooth', 'linear'] as const;
export const MASK_STYLES = ['fill', 'blur'] as const;
export const TEXT_POSITIONS = ['top', 'center', 'bottom'] as const;
/** How captions look: classic subtitles on a dark box, the spoken word in colour, or a few big words at a time. */
export const CAPTION_STYLES = ['subtitle', 'karaoke', 'bold'] as const;
export const STILL_MOTIONS = ['none', 'kenburns', 'scroll'] as const;
export const WEBCAM_SHAPES = ['circle', 'rounded'] as const;
export const WEBCAM_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
export const CLICK_EFFECTS = ['ripple', 'none'] as const;
export const MOUSE_BUTTONS = ['left', 'right', 'middle'] as const;
/**
 * What made an automatic item (`auto` on cuts, zooms, masks and a clip's crop). Editing an item by
 * hand drops its tag; a rerun replaces only tagged items of the kinds it makes.
 */
export const AUTO_KINDS = ['crop', 'privacy', 'notification', 'retake', 'filler', 'pause', 'length', 'typing', 'dialog', 'click', 'answer'] as const;

// z.number() already rejects Infinity and NaN in zod 4.
const seconds = z.number().nonnegative();
const positiveSeconds = z.number().positive();
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected a hex color like #0c0c0c');

export const RectSchema = z.tuple([z.number(), z.number(), z.number().positive(), z.number().positive()]);

const dimension = z
  .number()
  .int()
  .positive()
  .max(4096)
  .multipleOf(2, 'must be even (H.264 needs even width and height)');

const OutputSchema = z.strictObject({
  width: dimension.default(1920),
  height: dimension.default(1080),
  fps: z.number().int().positive().max(120).default(30),
});

const SourcesSchema = z.strictObject({
  screen: z.string().min(1),
  webcam: z.string().min(1).optional(),
  mic: z.string().min(1).optional(),
  events: z.string().min(1).optional(),
  markers: z.string().min(1).optional(),
  /** What the mic said, word by word (`cuttle transcribe`, the app after a take). */
  transcript: z.string().min(1).optional(),
  /** The mic cleaned up (made with the transcription): less noise, even loudness, in step with the mic. */
  cleanMic: z.string().min(1).optional(),
  /** The screen's text, read where the picture changed (the privacy masks are made from it). */
  screenText: z.string().min(1).optional(),
});

// Cross-field checks live on the object they belong to, so zod reports them in the same pass
// as every other issue (a root superRefine is skipped when any other issue exists).
const BackgroundSchema = z
  .strictObject({
    preset: z.enum(BACKGROUND_PRESETS),
    color: hexColor.optional(),
    image: z.string().min(1).optional(),
  })
  .superRefine((background, ctx) => {
    if (background.preset === 'solid' && background.color === undefined) {
      ctx.addIssue({ code: 'custom', message: 'the "solid" background needs a "color"', path: ['color'] });
    }
    if (background.preset === 'image' && background.image === undefined) {
      ctx.addIssue({ code: 'custom', message: 'the "image" background needs an "image" path', path: ['image'] });
    }
  });

const FrameSchema = z.strictObject({
  enabled: z.boolean().default(true),
  style: z.enum(FRAME_STYLES).default('mac-dark'),
  title: z.string().default(''),
  radius: z.number().nonnegative().default(14),
  shadow: z.boolean().default(true),
});

const CursorSchema = z.strictObject({
  enabled: z.boolean().default(true),
  style: z.enum(CURSOR_STYLES).default('system'),
  size: z.number().positive().max(4).default(1),
  color: hexColor.default('#D97757'),
  clickEffect: z.enum(CLICK_EFFECTS).default('ripple'),
  /** How smooth the drawn path is: 0 as recorded, 1 very smooth (clicks stay exact). */
  smoothing: z.number().min(0).max(1).default(0.5),
});

const WebcamSchema = z.strictObject({
  enabled: z.boolean().default(false),
  shape: z.enum(WEBCAM_SHAPES).default('circle'),
  corner: z.enum(WEBCAM_CORNERS).default('bottom-left'),
  size: z.number().positive().max(0.5).default(0.18),
});

const AudioSchema = z.strictObject({
  enabled: z.boolean().default(true),
  muteSpedUp: z.boolean().default(true),
  /** Play the cleaned-up mic (`sources.cleanMic`: less noise, even loudness) where there is one. */
  cleanup: z.boolean().default(true),
});

const TransitionSchema = z.strictObject({
  enabled: z.boolean().default(true),
  duration: z.number().nonnegative().max(2).default(0.3),
});

// zod 4: .default() returns its value without parsing it; .prefault() parses it, so inner
// defaults apply when a whole block is missing.
const LookSchema = z.strictObject({
  background: BackgroundSchema.default({ preset: 'sunset-sky' }),
  frame: FrameSchema.prefault({}),
  cursor: CursorSchema.prefault({}),
  webcam: WebcamSchema.prefault({}),
  audio: AudioSchema.prefault({}),
  transition: TransitionSchema.prefault({}),
});

// Scenes and overlays may carry an id (for editors: selection, undo; unique in the project) and a
// label (a name for people, e.g. "Answer").
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const named = {
  id: z.string().regex(ID_PATTERN, 'an id is 1 to 64 letters, digits, "-" or "_"').optional(),
  label: z.string().max(200).optional(),
};

const autoKind = z.enum(AUTO_KINDS).optional();

const ClipSceneSchema = z
  .strictObject({
    type: z.literal('clip'),
    ...named,
    from: seconds,
    to: seconds,
    speed: z.number().positive().max(64).default(1),
    badge: z.string().optional(),
    /** The part of the screen the clip shows (source px); zooms fit inside it, the window takes its shape. */
    crop: z.strictObject({ rect: RectSchema, enabled: z.boolean().default(true), auto: z.literal('crop').optional() }).optional(),
  })
  .refine((clip) => clip.to > clip.from, { message: '"to" must be greater than "from"', path: ['to'] });

const StillSceneSchema = z.strictObject({
  type: z.literal('still'),
  ...named,
  image: z.string().min(1),
  duration: positiveSeconds,
  motion: z.enum(STILL_MOTIONS).default('none'),
  frame: z.enum(FRAME_STYLES).default('none'),
});

const CardSceneSchema = z.strictObject({
  type: z.literal('card'),
  ...named,
  title: z.string().min(1),
  subtitle: z.string().optional(),
  duration: positiveSeconds,
});

const SceneSchema = z.discriminatedUnion('type', [ClipSceneSchema, StillSceneSchema, CardSceneSchema]);

/** A point on a zoom's path: from `at` (source seconds) the zoom shows `rect`. */
const ZoomMoveSchema = z.strictObject({ at: seconds, rect: RectSchema });

const ZoomSchema = z
  .strictObject({
    ...named,
    at: seconds,
    duration: positiveSeconds,
    rect: RectSchema,
    /** A zoom that follows (typing): from `rect` it moves to each move's rect in turn. */
    moves: z.array(ZoomMoveSchema).optional(),
    ease: z.enum(EASES).default('smooth'),
    enabled: z.boolean().default(true),
    auto: autoKind,
  })
  .superRefine((zoom, ctx) => {
    let previous = zoom.at;
    (zoom.moves ?? []).forEach((move, index) => {
      if (!(move.at > previous)) ctx.addIssue({ code: 'custom', message: index === 0 ? 'a move must come after the zoom starts ("at")' : 'moves must be in time order', path: ['moves', index, 'at'] });
      else if (!(move.at < zoom.at + zoom.duration)) ctx.addIssue({ code: 'custom', message: 'a move must come before the zoom ends ("at" + "duration")', path: ['moves', index, 'at'] });
      previous = move.at;
    });
  });

const MaskSchema = z
  .strictObject({
    ...named,
    from: seconds,
    to: seconds,
    rect: RectSchema,
    /** A mask that follows (text that scrolls): from `rect` it goes to each move's rect in turn. */
    moves: z.array(ZoomMoveSchema).optional(),
    style: z.enum(MASK_STYLES).default('fill'),
    enabled: z.boolean().default(true),
    auto: autoKind,
  })
  .superRefine((mask, ctx) => {
    if (!(mask.to > mask.from)) ctx.addIssue({ code: 'custom', message: '"to" must be greater than "from"', path: ['to'] });
    let previous = mask.from;
    (mask.moves ?? []).forEach((move, index) => {
      if (!(move.at > previous)) ctx.addIssue({ code: 'custom', message: index === 0 ? 'a move must come after the mask starts ("from")' : 'moves must be in time order', path: ['moves', index, 'at'] });
      else if (!(move.at < mask.to)) ctx.addIssue({ code: 'custom', message: 'a move must come before the mask ends ("to")', path: ['moves', index, 'at'] });
      previous = move.at;
    });
  });

/** The privacy guard's words: masked wherever the screen shows them (a name, an address). */
const PrivacySchema = z.strictObject({
  words: z.array(z.string().trim().min(1).max(100)).default([]),
});

/** A fix the person made to the transcript: the words spoken in [at, end) (source seconds) read as `text` ("" for none). */
const CaptionFixSchema = z
  .strictObject({ at: seconds, end: seconds, text: z.string().max(200) })
  .refine((fix) => fix.end > fix.at, { message: '"end" must be greater than "at"', path: ['end'] });

/** Captions from the take's transcript (`sources.transcript`); none without one. */
const CaptionsSchema = z.strictObject({
  enabled: z.boolean().default(true),
  style: z.enum(CAPTION_STYLES).default('subtitle'),
  position: z.enum(TEXT_POSITIONS).default('bottom'),
  /** Scale of the style's text size. */
  size: z.number().min(0.5).max(2).default(1),
  /** The spoken word's colour (`karaoke`, `bold`). */
  color: hexColor.default('#D97757'),
  fixes: z.array(CaptionFixSchema).default([]),
});

/** A source range taken out of every clip that covers it: a jump cut, no crossfade. */
const CutSchema = z
  .strictObject({
    ...named,
    from: seconds,
    to: seconds,
    enabled: z.boolean().default(true),
    auto: autoKind,
  })
  .refine((cut) => cut.to > cut.from, { message: '"to" must be greater than "from"', path: ['to'] });

/** The kinds of automatic edits the person keeps; one switched off is not made again on a rerun. */
const AutoEditsSchema = z.strictObject({
  crop: z.boolean().default(true),
  privacy: z.boolean().default(true),
  retakes: z.boolean().default(true),
  fillers: z.boolean().default(true),
  pauses: z.boolean().default(true),
  typingZooms: z.boolean().default(true),
  dialogZooms: z.boolean().default(true),
  clickZooms: z.boolean().default(true),
  answerZoom: z.boolean().default(true),
});

const TextSchema = z.strictObject({
  ...named,
  at: seconds,
  duration: positiveSeconds,
  text: z.string().min(1),
  style: z.enum(TEXT_STYLES).default('pill'),
  position: z.enum(TEXT_POSITIONS).default('top'),
  enabled: z.boolean().default(true),
});

export const ProjectSchema = z
  .strictObject({
    version: z.literal(CURRENT_VERSION),
    output: OutputSchema.prefault({}),
    sources: SourcesSchema,
    look: LookSchema.prefault({}),
    scenes: z.array(SceneSchema).default([]),
    zooms: z.array(ZoomSchema).default([]),
    masks: z.array(MaskSchema).default([]),
    texts: z.array(TextSchema).default([]),
    cuts: z.array(CutSchema).default([]),
    autoEdits: AutoEditsSchema.prefault({}),
    captions: CaptionsSchema.prefault({}),
    privacy: PrivacySchema.prefault({}),
  })
  // Runs once everything else is valid (see the note above BackgroundSchema).
  .superRefine((project, ctx) => {
    const seen = new Map<string, string>();
    for (const list of ['scenes', 'zooms', 'masks', 'texts', 'cuts'] as const) {
      project[list].forEach((item: { id?: string }, index) => {
        if (item.id === undefined) return;
        const first = seen.get(item.id);
        if (first === undefined) seen.set(item.id, `${list}[${index}]`);
        else ctx.addIssue({ code: 'custom', message: `the id "${item.id}" is already used by ${first}`, path: [list, index, 'id'] });
      });
    }
  });

// One line of events.jsonl. Times are source seconds (seconds since the screen track started).
// x and y are source pixels of the screen track (the recorder subtracts the capture origin and,
// where the system reports points instead of pixels, applies the display scale); positions outside
// [0, width) x [0, height) mean the pointer is off the captured area.
const point = { t: seconds, x: z.number(), y: z.number() };
/** What a window over the screen is, by its class (see the recorder). */
export const WINDOW_KINDS = ['dialog', 'menu', 'notification'] as const;
export const InputEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('move'), ...point }),
  z.strictObject({ type: z.literal('click'), ...point, button: z.enum(MOUSE_BUTTONS) }),
  z.strictObject({ type: z.literal('scroll'), ...point, dx: z.number(), dy: z.number() }),
  z.strictObject({ type: z.literal('shape'), t: seconds, shape: z.enum(CURSOR_SHAPES) }),
  z.strictObject({ type: z.literal('keys'), t: seconds, count: z.number().int().positive() }),
  // where text is typed: the system caret, where the app keeps one (a fact, not input)
  z.strictObject({ type: z.literal('caret'), t: seconds, rect: RectSchema }),
  // the content area of the window shown (a browser's page, an Electron app's view); null: none
  z.strictObject({ type: z.literal('area'), t: seconds, rect: RectSchema.nullable() }),
  // a dialog, menu or notification opens (`open`) or closes over the screen; `id` pairs the two
  z.strictObject({ type: z.literal('window'), t: seconds, id: z.number().int().nonnegative(), kind: z.enum(WINDOW_KINDS), rect: RectSchema, open: z.boolean() }),
]);

/** Events that are facts about the screen, not input: the pointer's shape, the caret, the content area, windows. */
const FACTS: ReadonlySet<string> = new Set(['shape', 'caret', 'area', 'window']);
export const isFact = (event: InputEvent): boolean => FACTS.has(event.type);

export type InputEvent = z.output<typeof InputEventSchema>;
export type CursorShape = (typeof CURSOR_SHAPES)[number];
export type CursorStyle = (typeof CURSOR_STYLES)[number];
export type Ease = (typeof EASES)[number];
export type MaskStyle = (typeof MASK_STYLES)[number];
export type TextPosition = (typeof TEXT_POSITIONS)[number];
export type StillMotion = (typeof STILL_MOTIONS)[number];
export type BackgroundPreset = (typeof BACKGROUND_PRESETS)[number];
export type FrameStyle = (typeof FRAME_STYLES)[number];
export type TextStyle = (typeof TEXT_STYLES)[number];
export type CaptionStyle = (typeof CAPTION_STYLES)[number];
export type CuttleProject = z.output<typeof ProjectSchema>;
export type CuttleProjectInput = z.input<typeof ProjectSchema>;
export type Look = CuttleProject['look'];
export type Output = CuttleProject['output'];
export type Rect = z.output<typeof RectSchema>;
export type Scene = CuttleProject['scenes'][number];
export type ClipScene = Extract<Scene, { type: 'clip' }>;
export type StillScene = Extract<Scene, { type: 'still' }>;
export type CardScene = Extract<Scene, { type: 'card' }>;
export type Zoom = CuttleProject['zooms'][number];
export type ZoomMove = NonNullable<Zoom['moves']>[number];
export type WindowKind = (typeof WINDOW_KINDS)[number];
export type Mask = CuttleProject['masks'][number];
export type TextOverlay = CuttleProject['texts'][number];
export type Cut = CuttleProject['cuts'][number];
export type AutoKind = (typeof AUTO_KINDS)[number];
export type AutoEdits = CuttleProject['autoEdits'];
export type Captions = CuttleProject['captions'];
export type CaptionFix = Captions['fixes'][number];
