import { z } from 'zod';

export const BACKGROUND_PRESETS = ['sunset-sky', 'aurora', 'mesh', 'solid', 'image'] as const;
export const FRAME_STYLES = ['mac-dark', 'mac-light', 'browser-light', 'none'] as const;
export const TEXT_STYLES = ['pill', 'lower-third', 'caption'] as const;
export const CURSOR_STYLES = ['system', 'arrow-white', 'arrow-black', 'dot', 'ring', 'spotlight'] as const;
export const CURSOR_SHAPES = ['arrow', 'text', 'pointer', 'wait', 'crosshair', 'move', 'not-allowed'] as const;

const seconds = z.number().finite().nonnegative();
const positiveSeconds = z.number().finite().positive();
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected a hex color like #0c0c0c');

export const RectSchema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite().positive(),
  z.number().finite().positive(),
]);

const OutputSchema = z.strictObject({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().int().positive().max(120),
});

const SourcesSchema = z.strictObject({
  screen: z.string().min(1),
  webcam: z.string().min(1).optional(),
  mic: z.string().min(1).optional(),
  events: z.string().min(1).optional(),
  markers: z.string().min(1).optional(),
});

const BackgroundSchema = z.strictObject({
  preset: z.enum(BACKGROUND_PRESETS),
  color: hexColor.optional(),
  image: z.string().min(1).optional(),
});

const FrameSchema = z.strictObject({
  enabled: z.boolean().default(true),
  style: z.enum(FRAME_STYLES).default('mac-dark'),
  title: z.string().default(''),
  radius: z.number().finite().nonnegative().default(14),
  shadow: z.boolean().default(true),
});

const CursorSchema = z.strictObject({
  enabled: z.boolean().default(true),
  style: z.enum(CURSOR_STYLES).default('system'),
  size: z.number().positive().max(4).default(1),
  color: hexColor.default('#D97757'),
  clickEffect: z.enum(['ripple', 'none']).default('ripple'),
});

const WebcamSchema = z.strictObject({
  enabled: z.boolean().default(false),
  shape: z.enum(['circle', 'rounded']).default('circle'),
  corner: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']).default('bottom-left'),
  size: z.number().gt(0).max(0.5).default(0.18),
});

const AudioSchema = z.strictObject({
  enabled: z.boolean().default(true),
  muteSpedUp: z.boolean().default(true),
});

const TransitionSchema = z.strictObject({
  enabled: z.boolean().default(true),
  duration: z.number().finite().nonnegative().max(2).default(0.3),
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

const ClipSceneSchema = z.strictObject({
  type: z.literal('clip'),
  from: seconds,
  to: seconds,
  speed: z.number().finite().positive().max(64).default(1),
  badge: z.string().optional(),
});

const StillSceneSchema = z.strictObject({
  type: z.literal('still'),
  image: z.string().min(1),
  duration: positiveSeconds,
  motion: z.enum(['none', 'kenburns', 'scroll']).default('none'),
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
  ease: z.enum(['smooth', 'linear']).default('smooth'),
  enabled: z.boolean().default(true),
});

const MaskSchema = z.strictObject({
  from: seconds,
  to: seconds,
  rect: RectSchema,
  style: z.enum(['fill', 'blur']).default('fill'),
  enabled: z.boolean().default(true),
});

const TextSchema = z.strictObject({
  at: seconds,
  duration: positiveSeconds,
  text: z.string().min(1),
  style: z.enum(TEXT_STYLES).default('pill'),
  position: z.enum(['top', 'center', 'bottom']).default('top'),
  enabled: z.boolean().default(true),
});

export const ProjectSchema = z
  .strictObject({
    version: z.literal(1),
    output: OutputSchema.default({ width: 1920, height: 1080, fps: 30 }),
    sources: SourcesSchema,
    look: LookSchema.prefault({}),
    scenes: z.array(SceneSchema).default([]),
    zooms: z.array(ZoomSchema).default([]),
    masks: z.array(MaskSchema).default([]),
    texts: z.array(TextSchema).default([]),
  })
  .superRefine((p, ctx) => {
    p.scenes.forEach((scene, i) => {
      if (scene.type === 'clip' && scene.to <= scene.from) {
        ctx.addIssue({ code: 'custom', message: '"to" must be greater than "from"', path: ['scenes', i, 'to'] });
      }
    });
    p.masks.forEach((mask, i) => {
      if (mask.to <= mask.from) {
        ctx.addIssue({ code: 'custom', message: '"to" must be greater than "from"', path: ['masks', i, 'to'] });
      }
    });
    const background = p.look.background;
    if (background.preset === 'solid' && background.color === undefined) {
      ctx.addIssue({ code: 'custom', message: 'the "solid" background needs a "color"', path: ['look', 'background', 'color'] });
    }
    if (background.preset === 'image' && background.image === undefined) {
      ctx.addIssue({ code: 'custom', message: 'the "image" background needs an "image" path', path: ['look', 'background', 'image'] });
    }
  });

// One line of events.jsonl. Times are source seconds (seconds since the screen track started).
const point = { t: seconds, x: z.number().finite(), y: z.number().finite() };
export const InputEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('move'), ...point }),
  z.strictObject({ type: z.literal('click'), ...point, button: z.enum(['left', 'right', 'middle']) }),
  z.strictObject({ type: z.literal('scroll'), ...point, dx: z.number().finite(), dy: z.number().finite() }),
  z.strictObject({ type: z.literal('shape'), t: seconds, shape: z.enum(CURSOR_SHAPES) }),
  z.strictObject({ type: z.literal('keys'), t: seconds, count: z.number().int().positive() }),
]);

export type InputEvent = z.output<typeof InputEventSchema>;
export type CursorShape = (typeof CURSOR_SHAPES)[number];
export type CursorStyle = (typeof CURSOR_STYLES)[number];
export type CuttleProject = z.output<typeof ProjectSchema>;
export type CuttleProjectInput = z.input<typeof ProjectSchema>;
export type Rect = z.output<typeof RectSchema>;
export type Scene = CuttleProject['scenes'][number];
export type ClipScene = Extract<Scene, { type: 'clip' }>;
export type StillScene = Extract<Scene, { type: 'still' }>;
export type CardScene = Extract<Scene, { type: 'card' }>;
export type Zoom = CuttleProject['zooms'][number];
export type Mask = CuttleProject['masks'][number];
export type TextOverlay = CuttleProject['texts'][number];
