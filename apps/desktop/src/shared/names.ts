// The project's enum values as people read them in the editor ("mac-dark" is "Mac, dark").
import type {
  BACKGROUND_PRESETS,
  CLICK_EFFECTS,
  CURSOR_STYLES,
  EASES,
  FRAME_STYLES,
  MASK_STYLES,
  STILL_MOTIONS,
  TEXT_POSITIONS,
  TEXT_STYLES,
  WEBCAM_CORNERS,
  WEBCAM_SHAPES,
} from '@cuttle/project';

type Names<T extends readonly string[]> = Record<T[number], string>;

export const BACKGROUND_NAMES: Names<typeof BACKGROUND_PRESETS> = { 'sunset-sky': 'Sunset sky', aurora: 'Aurora', mesh: 'Mesh', solid: 'Solid colour', image: 'Image' };
export const FRAME_NAMES: Names<typeof FRAME_STYLES> = { 'mac-dark': 'Mac, dark', 'mac-light': 'Mac, light', 'browser-light': 'Browser, light', none: 'None' };
export const CURSOR_NAMES: Names<typeof CURSOR_STYLES> = {
  system: 'System pointer',
  'arrow-white': 'White arrow',
  'arrow-black': 'Black arrow',
  dot: 'Dot',
  ring: 'Ring',
  spotlight: 'Spotlight',
};
export const TEXT_STYLE_NAMES: Names<typeof TEXT_STYLES> = { pill: 'Pill', 'lower-third': 'Lower third', caption: 'Caption' };
export const POSITION_NAMES: Names<typeof TEXT_POSITIONS> = { top: 'Top', center: 'Centre', bottom: 'Bottom' };
export const MOTION_NAMES: Names<typeof STILL_MOTIONS> = { none: 'None', kenburns: 'Ken Burns', scroll: 'Scroll' };
export const EASE_NAMES: Names<typeof EASES> = { smooth: 'Smooth', linear: 'Linear' };
export const MASK_STYLE_NAMES: Names<typeof MASK_STYLES> = { fill: 'Fill', blur: 'Blur' };
export const CLICK_NAMES: Names<typeof CLICK_EFFECTS> = { ripple: 'Ripple', none: 'None' };
export const WEBCAM_SHAPE_NAMES: Names<typeof WEBCAM_SHAPES> = { circle: 'Circle', rounded: 'Rounded square' };
export const CORNER_NAMES: Names<typeof WEBCAM_CORNERS> = { 'top-left': 'Top left', 'top-right': 'Top right', 'bottom-left': 'Bottom left', 'bottom-right': 'Bottom right' };
