import { z } from 'zod';

// The cuttle.json format version this build reads and writes.
export const CURRENT_VERSION = 1;

export const BACKGROUND_PRESETS = ['sunset-sky', 'aurora', 'mesh', 'solid', 'image', 'gradient', 'flow', 'bokeh', 'dots'] as const;
/** The backgrounds drawn in colours of their own (`background.colors`): a gradient's, and the tints of the others. */
export const COLOURED_BACKGROUNDS = ['gradient', 'mesh', 'flow', 'bokeh', 'dots'] as const;
export const GRADIENT_KINDS = ['linear', 'radial'] as const;
export const FRAME_STYLES = ['mac-dark', 'mac-light', 'browser-light', 'browser-dark', 'windows-light', 'windows-dark', 'terminal', 'iphone', 'android', 'none'] as const;
/** The frames that are a device around the screen (a bezel, a camera), not a window with a title bar. */
export const DEVICE_FRAMES = ['iphone', 'android'] as const;
export const TEXT_STYLES = ['pill', 'lower-third', 'caption'] as const;
export const CURSOR_STYLES = ['system', 'arrow-white', 'arrow-black', 'dot', 'ring', 'spotlight'] as const;
export const CURSOR_SHAPES = ['arrow', 'text', 'pointer', 'wait', 'crosshair', 'move', 'not-allowed'] as const;
export const EASES = ['smooth', 'linear'] as const;

/** The loudness a video's mix is brought to on export: none (`off`), or where a platform plays it (`LOUDNESS`). */
export const LOUDNESS_TARGETS = ['off', 'youtube', 'podcast', 'broadcast'] as const;
export type LoudnessTarget = (typeof LOUDNESS_TARGETS)[number];
/**
 * Each target's integrated loudness (LUFS, EBU R128) and true peak ceiling (dBTP): YouTube, Spotify,
 * TikTok and Instagram play at about -14; Apple Podcasts and many feeds at -16; broadcast (EBU R128) at -23.
 */
export const LOUDNESS: Record<Exclude<LoudnessTarget, 'off'>, { lufs: number; truePeak: number }> = {
  youtube: { lufs: -14, truePeak: -1 },
  podcast: { lufs: -16, truePeak: -1 },
  broadcast: { lufs: -23, truePeak: -1 },
};
export const MASK_STYLES = ['fill', 'blur'] as const;
export const TEXT_POSITIONS = ['top', 'center', 'bottom'] as const;
/** How captions look: classic subtitles on a dark box, the spoken word in colour, or a few big words at a time. */
export const CAPTION_STYLES = ['subtitle', 'karaoke', 'bold'] as const;
/** The fonts a theme's headings may be in: the motion kit's display faces, and its text face. */
export const THEME_FONTS = ['Archivo', 'Inter', 'Space Grotesk', 'Fraunces', 'Instrument Serif', 'Bebas Neue'] as const;
export const STILL_MOTIONS = ['none', 'kenburns', 'scroll'] as const;
export const WEBCAM_SHAPES = ['circle', 'rounded', 'squircle', 'square'] as const;
export const WEBCAM_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
export const CLICK_EFFECTS = ['ripple', 'none'] as const;
export const MOUSE_BUTTONS = ['left', 'right', 'middle'] as const;
/**
 * What made an automatic item (`auto` on cuts, zooms, masks, texts, overlays and a clip's crop).
 * Editing an item by hand drops its tag; a rerun replaces only tagged items of the kinds it makes.
 * `title`: a step's title from the script (a text, or an overlay of the step's motion template);
 * `step`: a zoom on where a step of the script happens.
 */
export const AUTO_KINDS = ['crop', 'privacy', 'notification', 'retake', 'filler', 'pause', 'length', 'typing', 'dialog', 'click', 'answer', 'title', 'step'] as const;
/** The motion templates a step's title may be drawn with, as an overlay over the step's start. */
export const STEP_MOTIONS = ['lower-third', 'title'] as const;

// z.number() already rejects Infinity and NaN in zod 4.
const seconds = z.number().nonnegative();
const positiveSeconds = z.number().positive();
export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected a hex color like #0c0c0c');

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
  /** What the computer played while the take recorded (its apps' sound), beside the mic. */
  system: z.string().min(1).optional(),
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
export const BackgroundSchema = z
  .strictObject({
    preset: z.enum(BACKGROUND_PRESETS),
    color: hexColor.optional(),
    image: z.string().min(1).optional(),
    /** The colours of a gradient (its stops, first to last) and the tints of mesh, flow, bokeh and dots; without them, their own. */
    colors: z.array(hexColor).min(2).max(4).optional(),
    /** A gradient's direction, as in CSS: 0 to the top, 90 to the right (default 135); and `radial`, from the centre out. */
    angle: z.number().min(0).max(360).optional(),
    kind: z.enum(GRADIENT_KINDS).optional(),
    /** An image softened (0 sharp, 1 a wash of its colours: a wallpaper behind the window) and darkened (0 to 0.8). */
    blur: z.number().min(0).max(1).optional(),
    dim: z.number().min(0).max(0.8).optional(),
  })
  .superRefine((background, ctx) => {
    if (background.preset === 'solid' && background.color === undefined) {
      ctx.addIssue({ code: 'custom', message: 'the "solid" background needs a "color"', path: ['color'] });
    }
    if (background.preset === 'image' && background.image === undefined) {
      ctx.addIssue({ code: 'custom', message: 'the "image" background needs an "image" path', path: ['image'] });
    }
    if (background.preset === 'gradient' && background.colors === undefined) {
      ctx.addIssue({ code: 'custom', message: 'the "gradient" background needs its "colors" (2 to 4)', path: ['colors'] });
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
  /**
   * Where the bubble's centre is, as a share of the video's width and height (it stays inside the
   * video); without it, `corner` places the bubble. A share keeps its place across 16:9, 1:1 and 9:16.
   */
  position: z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
  /** The white ring around the bubble. */
  border: z.boolean().default(true),
  /** The soft shadow under it. */
  shadow: z.boolean().default(true),
  /** The camera's picture flipped left to right, as a mirror shows a face. */
  mirror: z.boolean().default(false),
});

const AudioSchema = z.strictObject({
  enabled: z.boolean().default(true),
  muteSpedUp: z.boolean().default(true),
  /** Play the cleaned-up mic (`sources.cleanMic`: less noise, even loudness) where there is one. */
  cleanup: z.boolean().default(true),
  /** A key click for each key typed (the take's `keys` counts), where its clip is heard. */
  typing: z.boolean().default(true),
  /** The clicks' volume, 0 to 1. */
  typingVolume: z.number().min(0).max(1).default(0.5),
  /** The sounds (`sounds`) and the music page's effects. */
  effects: z.boolean().default(true),
  /** Their volume, 0 to 1. */
  effectsVolume: z.number().min(0).max(1).default(0.8),
  /** What the computer played (`sources.system`), where its clip is heard. */
  system: z.boolean().default(true),
  /** Its volume, 0 to 1. */
  systemVolume: z.number().min(0).max(1).default(0.8),
  /** How far it goes down under speech (dB), as the music; 0 leaves it. */
  systemDuck: z.number().min(0).max(40).default(12),
  /** The loudness the export brings the whole mix to (`LOUDNESS`): a platform's, or `off` (the mix as it is). */
  loudness: z.enum(LOUDNESS_TARGETS).default('off'),
});

const TransitionSchema = z.strictObject({
  enabled: z.boolean().default(true),
  duration: z.number().nonnegative().max(2).default(0.3),
});

// zod 4: .default() returns its value without parsing it; .prefault() parses it, so inner
// defaults apply when a whole block is missing.
/**
 * A mark in a corner of the whole video: an image of the project (else the brand's logo), or a text
 * (else the brand's name); off by default.
 */
const WatermarkSchema = z.strictObject({
  enabled: z.boolean().default(false),
  image: z.string().min(1).optional(),
  text: z.string().max(80).optional(),
  corner: z.enum(WEBCAM_CORNERS).default('bottom-right'),
  /** Its height as a share of the output's short side. */
  size: z.number().min(0.02).max(0.3).default(0.06),
  opacity: z.number().min(0.1).max(1).default(0.7),
});

/** Which key presses get a badge: chords only (⌘K, Ctrl+S), or also special keys alone (Esc, Enter, the arrows). */
export const KEY_BADGE_SHOWS = ['shortcuts', 'keys'] as const;
/** Where the badges sit: under the video's middle, or over it. */
export const KEY_BADGE_POSITIONS = ['bottom', 'top'] as const;

/** The badges of the shortcuts the take logged (events.jsonl's `shortcut`), drawn over the video. */
const KeysSchema = z.strictObject({
  enabled: z.boolean().default(true),
  show: z.enum(KEY_BADGE_SHOWS).default('shortcuts'),
  position: z.enum(KEY_BADGE_POSITIONS).default('bottom'),
  /** A factor on the badge's size (1: keys about 2.6 % of the output's short side high). */
  size: z.number().min(0.5).max(2).default(1),
});

/** Every modifier's name on either system (shortcuts as the recorder writes them): a shortcut with one of these but Shift is a chord. */
export const CHORD_MODIFIERS: ReadonlySet<string> = new Set(['⌃', '⌥', '⌘', 'Ctrl', 'Alt', 'Win']);
/** Whether a shortcut's keys hold a modifier other than Shift (⌘K, Ctrl+S), not a special key alone (Esc, ⇧⇥). */
export const isChord = (keys: readonly string[]): boolean => keys.some((key) => CHORD_MODIFIERS.has(key));

const LookSchema = z.strictObject({
  background: BackgroundSchema.default({ preset: 'sunset-sky' }),
  frame: FrameSchema.prefault({}),
  cursor: CursorSchema.prefault({}),
  webcam: WebcamSchema.prefault({}),
  audio: AudioSchema.prefault({}),
  transition: TransitionSchema.prefault({}),
  watermark: WatermarkSchema.prefault({}),
  keys: KeysSchema.prefault({}),
  /**
   * Motion blur: how long a frame's shutter is open, as a share of the frame (0 off, 0.25 light,
   * 0.5 a film camera's). The screen smears along the zoom's moves and the pointer along its path.
   */
  motionBlur: z.number().min(0).max(1).default(0.25),
});

// Scenes and overlays may carry an id (for editors: selection, undo; unique in the project) and a
// label (a name for people, e.g. "Answer").
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const named = {
  id: z.string().regex(ID_PATTERN, 'an id is 1 to 64 letters, digits, "-" or "_"').optional(),
  label: z.string().max(200).optional(),
};

const autoKind = z.enum(AUTO_KINDS).optional();

/** A page (HTML, in the project) as a value its params may hold: text, a number, a switch, a colour, a path. */
const ParamValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/**
 * A page that takes the place of the crossfade into its scene (a fold, a wipe, a zoom through): it is
 * given the outgoing and the incoming frame for each of its frames and draws the frame between them.
 * It lasts `duration` seconds around the cut, half before and half after, also with crossfades off.
 */
const SceneTransitionSchema = z.strictObject({
  /** The page: an HTML file in the project (`motion/fold/index.html`). */
  src: z.string().min(1),
  /** The values of the params the page declares. */
  params: z.record(z.string(), ParamValue).default({}),
  /** Let the page reach https: (off: only the project's files). */
  network: z.boolean().default(false),
  duration: z.number().positive().max(4).default(0.8),
  enabled: z.boolean().default(true),
});

/** What every scene may have: an id, a label, and a page for the way into it. */
const sceneFields = { ...named, transition: SceneTransitionSchema.optional() };

const ClipSceneSchema = z
  .strictObject({
    type: z.literal('clip'),
    ...sceneFields,
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
  ...sceneFields,
  image: z.string().min(1),
  duration: positiveSeconds,
  motion: z.enum(STILL_MOTIONS).default('none'),
  frame: z.enum(FRAME_STYLES).default('none'),
});

const CardSceneSchema = z.strictObject({
  type: z.literal('card'),
  ...sceneFields,
  title: z.string().min(1),
  subtitle: z.string().optional(),
  duration: positiveSeconds,
});

/** What a motion page gets: the page (a path in the project), its params, and whether it may reach the network. */
const motionPage = {
  /** The page: an HTML file in the project (`motion/intro/index.html`). */
  src: z.string().min(1),
  /** The values of the params the page declares. */
  params: z.record(z.string(), ParamValue).default({}),
  /** Let the page reach https: (off: only the project's files). */
  network: z.boolean().default(false),
  /**
   * Motion blur, as a camera's: each frame is the average of `samples` moments while the shutter is
   * open, `shutter` a share of the frame (0.5 is film's 180°). Off without it.
   */
  motionBlur: z
    .strictObject({
      samples: z.number().int().min(2).max(32).default(8),
      shutter: z.number().positive().max(1).default(0.5),
    })
    .optional(),
};

/** A page Claude or the person wrote, rendered frame by frame as a scene (an intro, an end card, a 3D shot). */
const MotionSceneSchema = z.strictObject({
  type: z.literal('motion'),
  ...sceneFields,
  ...motionPage,
  duration: positiveSeconds,
});

const SceneSchema = z.discriminatedUnion('type', [ClipSceneSchema, StillSceneSchema, CardSceneSchema, MotionSceneSchema]);

/**
 * How a zoom gets to a move's rect: `settle` as a camera does (the default: off at once, slowing
 * into place), `smooth` in and out, `linear` at an even pace, or `jump` there at its time.
 */
export const MOVE_EASES = ['settle', 'smooth', 'linear', 'jump'] as const;
export type MoveEase = (typeof MOVE_EASES)[number];

/** A point on a zoom's path: from `at` (source seconds) the zoom shows `rect`, getting there as `ease` says. */
const ZoomMoveSchema = z.strictObject({ at: seconds, rect: RectSchema, ease: z.enum(MOVE_EASES).optional() });
/** A point on a mask's path: from `at` (source seconds) it covers `rect`. */
const MaskMoveSchema = z.strictObject({ at: seconds, rect: RectSchema });

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
    moves: z.array(MaskMoveSchema).optional(),
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
/**
 * The project's brand: what its motion pages read for titles, end cards, lower thirds and every
 * colour (`--cuttle-accent`, `--cuttle-display`, `cuttle.theme.logo`). A brand kit sets it with a click.
 */
export const ThemeSchema = z.strictObject({
  /** The product's name and address, for titles and end cards. */
  name: z.string().max(80).optional(),
  url: z.string().max(200).optional(),
  /** The logo: an image in the project (`brand/logo.png`). */
  logo: z.string().min(1).optional(),
  /** The brand's colour (without one, the cursor's), the text's, and the tone pages draw their own background in (without one, the background's). */
  accent: hexColor.optional(),
  foreground: hexColor.default('#FFFFFF'),
  background: hexColor.optional(),
  /** The headings' font. */
  font: z.enum(THEME_FONTS).default('Archivo'),
  /** The brand kit it was set from, by name. */
  kit: z.string().max(80).optional(),
});

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
  stepTitles: z.boolean().default(true),
  stepZooms: z.boolean().default(true),
});

const TextSchema = z.strictObject({
  ...named,
  at: seconds,
  duration: positiveSeconds,
  text: z.string().min(1),
  style: z.enum(TEXT_STYLES).default('pill'),
  position: z.enum(TEXT_POSITIONS).default('top'),
  enabled: z.boolean().default(true),
  auto: autoKind,
});

/**
 * What an annotation draws: an arrow at something, a box or an ellipse round it, a highlighter
 * stroke over it, a spotlight on it (the rest of the screen darker), a magnifier over it.
 */
export const ANNOTATION_KINDS = ['arrow', 'box', 'ellipse', 'highlight', 'spotlight', 'magnifier'] as const;

/** A point in source px. */
const PointSchema = z.tuple([z.number(), z.number()]);

/**
 * A mark on the screen's content (source px), where its clips show source seconds `at` to
 * `at + duration`: it draws itself in, fades out, and moves with the content under zooms. An arrow
 * goes `from` → `to`; the others take `rect` (a magnifier shows it `zoom` times larger, over it).
 */
const AnnotationSchema = z
  .strictObject({
    ...named,
    kind: z.enum(ANNOTATION_KINDS),
    at: seconds,
    duration: positiveSeconds,
    rect: RectSchema.optional(),
    from: PointSchema.optional(),
    to: PointSchema.optional(),
    /** Its colour: the brand's accent, else the cursor's. */
    color: hexColor.optional(),
    /** A short callout beside it. */
    text: z.string().max(120).optional(),
    /** A magnifier: how many times larger. */
    zoom: z.number().min(1.5).max(4).default(2),
    enabled: z.boolean().default(true),
    auto: autoKind,
  })
  .superRefine((annotation, ctx) => {
    if (annotation.kind === 'arrow') {
      if (!annotation.from) ctx.addIssue({ code: 'custom', message: 'an arrow needs "from" (where it starts, source px)', path: ['from'] });
      if (!annotation.to) ctx.addIssue({ code: 'custom', message: 'an arrow needs "to" (where it points, source px)', path: ['to'] });
    } else if (!annotation.rect) ctx.addIssue({ code: 'custom', message: `a ${annotation.kind} needs "rect" (source px)`, path: ['rect'] });
  });

/**
 * How the camera shows for a while: `full` over the whole video (a talking-head intro or outro),
 * `side` beside the screen (below it on a tall video), `large` a big bubble in its corner.
 */
export const CAMERA_LAYOUTS = ['full', 'side', 'large'] as const;
export type CameraLayout = (typeof CAMERA_LAYOUTS)[number];

/**
 * The camera in another layout where the clips show source seconds `at` to `at + duration`; the
 * bubble turns into it and back over half a second each way. It needs a webcam take (`sources.webcam`);
 * with the bubble off (`look.webcam.enabled`) the camera fades in instead.
 */
const CameraSchema = z.strictObject({
  ...named,
  layout: z.enum(CAMERA_LAYOUTS),
  at: seconds,
  duration: positiveSeconds,
  enabled: z.boolean().default(true),
});

/**
 * A page drawn over the video where its clips show source seconds `at` to `at + duration`, with
 * its transparency (a lower third, callouts, a logo); its own clock runs in output seconds.
 */
const MotionOverlaySchema = z.strictObject({
  ...named,
  ...motionPage,
  at: seconds,
  duration: positiveSeconds,
  enabled: z.boolean().default(true),
  auto: autoKind,
});

/**
 * The video's music: a page that composes it in WebAudio for this video (`music/<name>/index.html`),
 * from the video's scenes, cuts, clicks, typing and words. It is rendered as long as the video,
 * follows every edit, and goes down under speech.
 */
const MusicSchema = z.strictObject({
  /** The page: an HTML file in the project. */
  src: z.string().min(1),
  /** The values of the params the page declares. */
  params: z.record(z.string(), ParamValue).default({}),
  /** Let the page reach https: (off: only the project's files). */
  network: z.boolean().default(false),
  /** Its level, 0 to 1. */
  volume: z.number().min(0).max(1).default(0.8),
  /** How far it goes down under speech, in dB (0: it does not). */
  duck: z.number().min(0).max(40).default(12),
  enabled: z.boolean().default(true),
});

/**
 * A sound at a moment: a built-in sound (`whoosh`, `pop`; `cuttle sound list`) or a file in the
 * project (`sounds/ding.wav`). At a source second it plays wherever the video shows that moment (and
 * not where it is cut); with `scene` (an id) it plays `at` seconds into that scene.
 */
const SoundSchema = z.strictObject({
  ...named,
  sound: z.string().min(1),
  at: seconds,
  scene: z.string().regex(ID_PATTERN).optional(),
  volume: z.number().min(0).max(1).default(0.8),
  enabled: z.boolean().default(true),
});

/** Where a narration's voice comes from: a voice on this computer, or ElevenLabs' by its ID. */
export const VOICE_PROVIDERS = ['local', 'elevenlabs'] as const;
/** A line of narration holds at most this many characters (a paragraph); the narration this many lines. */
export const VOICE_LINE_MAX = 2000;
export const VOICE_MAX_LINES = 200;

/**
 * A voice that speaks the narration: a local one by its name (`cuttle voice list`, e.g.
 * `de_DE-thorsten-medium`), or ElevenLabs' by its voice ID (`21m00Tcm4TlvDq8ikWAM`, as their voice
 * library shows it) with its model and settings.
 */
export const VoiceSchema = z.strictObject({
  provider: z.enum(VOICE_PROVIDERS).default('local'),
  id: z.string().min(1).max(200),
  /** How fast it speaks. */
  speed: z.number().min(0.5).max(2).default(1),
  /** ElevenLabs: the model (`eleven_multilingual_v2` when left out). */
  model: z.string().min(1).max(100).optional(),
  /** ElevenLabs' voice settings, 0 to 1: steadier, closer to the voice, more style. */
  stability: z.number().min(0).max(1).optional(),
  similarity: z.number().min(0).max(1).optional(),
  style: z.number().min(0).max(1).optional(),
});

/**
 * A line of the narration: its text, where it starts (as a sound: `at` in source seconds where the
 * clips show it, or seconds into `scene`), spoken by its own `voice` or the narration's. `file`: a
 * recording made elsewhere (another tool's voice, a studio take) plays instead; its `text` is then
 * what it says, for the subtitles (optional).
 */
const VoiceLineSchema = z.strictObject({
  ...named,
  /** Empty while it is being written: it speaks nothing until it has text (or a file). */
  text: z.string().max(VOICE_LINE_MAX).default(''),
  at: seconds,
  scene: z.string().regex(ID_PATTERN).optional(),
  voice: VoiceSchema.optional(),
  file: z.string().min(1).optional(),
  volume: z.number().min(0).max(1).default(1),
  enabled: z.boolean().default(true),
});

/** The narration: lines spoken by a voice, as a track of their own; the music and the computer's sound go down under it. */
const VoiceoverSchema = z.strictObject({
  /** The voice of every line that names none. */
  voice: VoiceSchema.optional(),
  /** Its volume, 0 to 1. */
  volume: z.number().min(0).max(1).default(1),
  /** Its words as subtitles, with the mic's. */
  captions: z.boolean().default(true),
  lines: z.array(VoiceLineSchema).max(VOICE_MAX_LINES).default([]),
});

/** A step's title is a few words (the prompter's heading); its note a few sentences; a script holds this many steps. */
export const STEP_TITLE_MAX = 80;
export const STEP_NOTE_MAX = 1000;
export const SCRIPT_MAX_STEPS = 50;

/**
 * A step of the script: what the person shows next, written before the take. While recording, the
 * prompter (a window that is never in the video) shows it, and the step key marks where it starts
 * (a `step` marker labelled with its id).
 */
const StepSchema = z.strictObject({
  /** The `step` markers name it; unique in the project. */
  id: z.string().regex(ID_PATTERN, 'an id is 1 to 64 letters, digits, "-" or "_"'),
  /** What it shows, in a few words. */
  title: z.string().max(STEP_TITLE_MAX).regex(/\S/, 'a step needs a title'),
  /** What to say or do: for the prompter only, never in the video. */
  note: z.string().max(STEP_NOTE_MAX).optional(),
  /** Its title as this motion template (an overlay), instead of a text. */
  motion: z.enum(STEP_MOTIONS).optional(),
});

export const ProjectSchema = z
  .strictObject({
    version: z.literal(CURRENT_VERSION),
    output: OutputSchema.prefault({}),
    sources: SourcesSchema,
    script: z.array(StepSchema).max(SCRIPT_MAX_STEPS).default([]),
    look: LookSchema.prefault({}),
    scenes: z.array(SceneSchema).default([]),
    zooms: z.array(ZoomSchema).default([]),
    masks: z.array(MaskSchema).default([]),
    texts: z.array(TextSchema).default([]),
    annotations: z.array(AnnotationSchema).default([]),
    cameras: z.array(CameraSchema).default([]),
    overlays: z.array(MotionOverlaySchema).default([]),
    cuts: z.array(CutSchema).default([]),
    music: MusicSchema.optional(),
    sounds: z.array(SoundSchema).default([]),
    voiceover: VoiceoverSchema.prefault({}),
    autoEdits: AutoEditsSchema.prefault({}),
    captions: CaptionsSchema.prefault({}),
    privacy: PrivacySchema.prefault({}),
    theme: ThemeSchema.prefault({}),
  })
  // Runs once everything else is valid (see the note above BackgroundSchema).
  .superRefine((project, ctx) => {
    const seen = new Map<string, string>();
    const lists: [string[], readonly { id?: string }[]][] = [
      ...(['scenes', 'zooms', 'masks', 'texts', 'annotations', 'cameras', 'overlays', 'cuts', 'sounds', 'script'] as const).map((list): [string[], readonly { id?: string }[]] => [[list], project[list]]),
      [['voiceover', 'lines'], project.voiceover.lines],
    ];
    for (const [path, items] of lists) {
      items.forEach((item, index) => {
        if (item.id === undefined) return;
        const first = seen.get(item.id);
        if (first === undefined) seen.set(item.id, `${path.join('.')}[${index}]`);
        else ctx.addIssue({ code: 'custom', message: `the id "${item.id}" is already used by ${first}`, path: [...path, index, 'id'] });
      });
    }
    project.sounds.forEach((sound, index) => {
      if (sound.scene !== undefined && !project.scenes.some((scene) => scene.id === sound.scene)) {
        ctx.addIssue({ code: 'custom', message: `no scene has the id "${sound.scene}"`, path: ['sounds', index, 'scene'] });
      }
    });
    project.voiceover.lines.forEach((line, index) => {
      if (line.scene !== undefined && !project.scenes.some((scene) => scene.id === line.scene)) {
        ctx.addIssue({ code: 'custom', message: `no scene has the id "${line.scene}"`, path: ['voiceover', 'lines', index, 'scene'] });
      }
      if (line.file === undefined && line.text.trim() !== '' && line.voice === undefined && project.voiceover.voice === undefined) {
        ctx.addIssue({ code: 'custom', message: 'a line needs a voice: its own, or voiceover.voice', path: ['voiceover', 'lines', index, 'voice'] });
      }
    });
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
  // a shortcut (⌘K, Ctrl+Shift+P, Esc): its keys as the recording system writes them; never typed text
  z.strictObject({ type: z.literal('shortcut'), t: seconds, keys: z.array(z.string().min(1).max(16)).min(1).max(6) }),
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
export type KeyBadgeShow = (typeof KEY_BADGE_SHOWS)[number];
export type KeyBadgePosition = (typeof KEY_BADGE_POSITIONS)[number];
export type Ease = (typeof EASES)[number];
export type MaskStyle = (typeof MASK_STYLES)[number];
export type TextPosition = (typeof TEXT_POSITIONS)[number];
export type StillMotion = (typeof STILL_MOTIONS)[number];
export type BackgroundPreset = (typeof BACKGROUND_PRESETS)[number];
export type DeviceFrame = (typeof DEVICE_FRAMES)[number];
export type ColouredBackground = (typeof COLOURED_BACKGROUNDS)[number];
export type GradientKind = (typeof GRADIENT_KINDS)[number];
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
export type MotionScene = Extract<Scene, { type: 'motion' }>;
export type MotionOverlay = CuttleProject['overlays'][number];
export type SceneTransition = NonNullable<Scene['transition']>;
export type Music = NonNullable<CuttleProject['music']>;
export type Sound = CuttleProject['sounds'][number];
/** The narration, a line of it, and a voice that speaks it. */
export type Voiceover = CuttleProject['voiceover'];
export type VoiceLine = Voiceover['lines'][number];
export type Voice = z.output<typeof VoiceSchema>;
export type VoiceProvider = (typeof VOICE_PROVIDERS)[number];
export type ScriptStep = CuttleProject['script'][number];
export type StepMotion = (typeof STEP_MOTIONS)[number];
export type Zoom = CuttleProject['zooms'][number];
export type ZoomMove = NonNullable<Zoom['moves']>[number];
export type WindowKind = (typeof WINDOW_KINDS)[number];
export type Mask = CuttleProject['masks'][number];
export type TextOverlay = CuttleProject['texts'][number];
export type Annotation = CuttleProject['annotations'][number];
export type Camera = CuttleProject['cameras'][number];

/** Whether the video shows the webcam at all: its bubble, or a camera layout (`cameras`). */
export const showsCamera = (project: Pick<CuttleProject, 'look' | 'cameras'>): boolean => project.look.webcam.enabled || project.cameras.some((camera) => camera.enabled);
export type AnnotationKind = (typeof ANNOTATION_KINDS)[number];
export type Cut = CuttleProject['cuts'][number];
export type AutoKind = (typeof AUTO_KINDS)[number];
export type AutoEdits = CuttleProject['autoEdits'];
export type Captions = CuttleProject['captions'];
export type Theme = CuttleProject['theme'];
export type ThemeFont = (typeof THEME_FONTS)[number];
export type CaptionFix = Captions['fixes'][number];
