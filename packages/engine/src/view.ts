import type { FrameStyle, Look, Rect } from '@cuttle/project';
import type { SceneFrame } from '@cuttle/timeline';
import { cameraPlace, windowLayout, type Size, type WindowLayout } from './layout';
import { FRAME_CHROME, type FrameChrome } from './presets/frames';

/** The window for a frame style (none: the content fills the output); `aspect` is the content's. */
export function frameLayout(output: Size, look: Pick<Look, 'frame'>, style: FrameStyle | null, aspect: number, area?: Rect): { chrome: FrameChrome | null; layout: WindowLayout } {
  const chrome = style ? FRAME_CHROME[style] : null;
  return { chrome, layout: windowLayout(output, aspect, chrome ? { titleBar: chrome.titleBar, radius: look.frame.radius, ...(chrome.device && { device: chrome.device }) } : null, area) };
}

/** Where a clip shows the screen in a frame: the part of the screen recording and the rect of the output it fills. */
export interface ClipView {
  /** The part of the screen recording shown, in source px (the zoom, else the crop, else all of it). */
  zoom: Rect;
  /** Where it is drawn, in output px (inside the window frame). */
  content: Rect;
}

/** A clip layer's view, as the renderer draws it. `layer` is the timeline's `SceneFrame`; a camera layout (with the look's webcam) moves the window aside. */
export function clipView(output: Size, look: Pick<Look, 'frame'> & Partial<Pick<Look, 'webcam'>>, layer: { zoom?: Rect; aspect?: number; camera?: SceneFrame['camera'] }, screen: Size): ClipView {
  const aspect = layer.aspect ?? screen.width / screen.height;
  const area = layer.camera && look.webcam ? cameraPlace(output, look.webcam, layer.camera).area : undefined;
  const { layout } = frameLayout(output, look, look.frame.enabled ? look.frame.style : null, aspect, area);
  return { zoom: layer.zoom ?? [0, 0, screen.width, screen.height], content: layout.content };
}
