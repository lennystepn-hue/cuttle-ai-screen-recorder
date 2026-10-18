import { backgroundTone, type CuttleProject, type MotionOverlay, type MotionScene, type SceneTransition } from '@cuttle/project';
import { TAKE_WORKER, type MotionInit } from './runtime';
import { projectFileUrl } from './take';

/**
 * The project's theme for its pages (`cuttle.theme`): its look and brand as CSS variables (the keys
 * that start with `--`), and the brand's `name`, `url`, `logo` (its URL in the page, or "") and
 * headings' `font`.
 */
export function motionTheme(project: CuttleProject): Record<string, string> {
  const { background, cursor } = project.look;
  const { theme } = project;
  return {
    '--cuttle-accent': theme.accent ?? cursor.color,
    '--cuttle-bg': theme.background ?? backgroundTone(background),
    '--cuttle-fg': theme.foreground,
    '--cuttle-font': '"Inter", "Segoe UI", system-ui, sans-serif',
    '--cuttle-display': `"${theme.font}", "Archivo", "Inter", system-ui, sans-serif`,
    '--cuttle-mono': '"JetBrains Mono", "Cascadia Mono", Consolas, monospace',
    font: theme.font,
    name: theme.name ?? '',
    url: theme.url ?? '',
    logo: theme.logo ? (projectFileUrl(theme.logo) ?? '') : '',
  };
}

/** `16:9`, `9:16` or `1:1` for those shapes, else the size (`1440x900`). */
export function formatName(size: { width: number; height: number }): string {
  const ratio = size.width / size.height;
  if (Math.abs(ratio - 16 / 9) < 0.01) return '16:9';
  if (Math.abs(ratio - 9 / 16) < 0.01) return '9:16';
  if (Math.abs(ratio - 1) < 0.01) return '1:1';
  return `${size.width}x${size.height}`;
}

/** A seed from a name (FNV-1a): an item looks the same in every render, and two items differ. */
export function motionSeed(name: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) hash = Math.imul(hash ^ name.charCodeAt(i), 0x01000193) >>> 0;
  return hash;
}

/** What a page has besides its item: the take, the kit's fonts, and the params its page declares with their defaults. */
export interface MotionContext {
  take: MotionInit['take'];
  fonts: MotionInit['fonts'];
  defaults: Record<string, unknown>;
  /** A transition page (it is given the frames it goes between). */
  transition?: boolean;
}

/**
 * What a motion item's page is told for one showing of it: `start` is the output second where it starts
 * and `duration` how long it lasts. The item's params win over the page's defaults.
 */
export function motionInit(
  project: CuttleProject,
  item: MotionScene | MotionOverlay | SceneTransition,
  name: string,
  showing: { start: number; duration: number },
  context: MotionContext,
): MotionInit {
  const { width, height, fps } = project.output;
  return {
    duration: showing.duration,
    start: showing.start,
    fps,
    width,
    height,
    format: formatName(project.output),
    params: { ...context.defaults, ...item.params },
    theme: motionTheme(project),
    seed: motionSeed(('id' in item ? item.id : undefined) ?? name),
    fonts: context.fonts,
    take: context.take,
    takeWorker: TAKE_WORKER,
    ...(context.transition && { transition: true }),
  };
}
