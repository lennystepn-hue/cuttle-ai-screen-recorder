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
export const STILL_MOTIONS = ['none', 'kenburns', 'scroll'] as const;
export const WEBCAM_SHAPES = ['circle', 'rounded'] as const;
export const WEBCAM_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
export const CLICK_EFFECTS = ['ripple', 'none'] as const;
export const MOUSE_BUTTONS = ['left', 'right', 'middle'] as const;

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

const ClipSceneSchema = z
  .strictObject({
    type: z.literal('clip'),
    from: seconds,
    to: seconds,
    speed: z.number().positive().max(64).default(1),
    badge: z.string().optional(),
  })
  .refine((clip) => clip.to > clip.from, { message: '"to" must be greater than "from"', path: ['to'] });

const StillSceneSchema = z.strictObject({
  type: z.literal('still'),
  image: z.string().min(1),
  duration: positiveSeconds,
  motion: z.enum(STILL_MOTIONS).default('none'),
  frame: z.enum(FRAME_STYLES).default('none'),
});

const CardSceneSchema = z.strictObject({
  type: z.literal('card'),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  duration: positiveSeconds,
});

const SceneSchema = z.discriminatedUnion('type', [ClipSceneSchema, StillSceneSchema, CardSceneSchema]);

const ZoomSchema = z.strictObject({
  at: seconds,
  duration: positiveSeconds,
  rect: RectSchema,
  ease: z.enum(EASES).default('smooth'),
  enabled: z.boolean().default(true),
});

const MaskSchema = z
  .strictObject({
    from: seconds,
    to: seconds,
    rect: RectSchema,
    style: z.enum(MASK_STYLES).default('fill'),
    enabled: z.boolean().default(true),
  })
  .refine((mask) => mask.to > mask.from, { message: '"to" must be greater than "from"', path: ['to'] });

const TextSchema = z.strictObject({
  at: seconds,
  duration: positiveSeconds,
  text: z.string().min(1),
  style: z.enum(TEXT_STYLES).default('pill'),
  position: z.enum(TEXT_POSITIONS).default('top'),
  enabled: z.boolean().default(true),
});

export const ProjectSchema = z.strictObject({
  version: z.literal(CURRENT_VERSION),
  output: OutputSchema.prefault({}),
  sources: SourcesSchema,
  look: LookSchema.prefault({}),
  scenes: z.array(SceneSchema).default([]),
  zooms: z.array(ZoomSchema).default([]),
  masks: z.array(MaskSchema).default([]),
  texts: z.array(TextSchema).default([]),
});

// One line of events.jsonl. Times are source seconds (seconds since the screen track started).
// x and y are source pixels of the screen track (the recorder subtracts the capture origin and,
// where the system reports points instead of pixels, applies the display scale); positions outside
// [0, width) x [0, height) mean the pointer is off the captured area.
const point = { t: seconds, x: z.number(), y: z.number() };
export const InputEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('move'), ...point }),
  z.strictObject({ type: z.literal('click'), ...point, button: z.enum(MOUSE_BUTTONS) }),
  z.strictObject({ type: z.literal('scroll'), ...point, dx: z.number(), dy: z.number() }),
  z.strictObject({ type: z.literal('shape'), t: seconds, shape: z.enum(CURSOR_SHAPES) }),
  z.strictObject({ type: z.literal('keys'), t: seconds, count: z.number().int().positive() }),
]);

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
export type Mask = CuttleProject['masks'][number];
export type TextOverlay = CuttleProject['texts'][number];
