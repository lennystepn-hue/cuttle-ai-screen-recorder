import type { CursorShape, CursorStyle } from '@cuttle/project';

/** Cursor art is drawn on a 32×32 grid. */
export const CURSOR_GRID = 32;
/** Cursor images are rasterized at this size and mipmapped. */
export const CURSOR_TEXTURE_PX = 128;

export interface CursorArt {
  svg: string;
  /** The grid point that sits on the pointer position. */
  hotspot: [x: number, y: number];
}

/** `system:<shape>` images are Cuttle's own lookalikes of the standard pointers, not copies of OS files. */
export type CursorImage = `system:${CursorShape}` | 'arrow-white' | 'arrow-black';

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${body}</svg>`;

const HAND =
  '<rect x="10" y="3" width="4" height="16" rx="2"/>' +
  '<rect x="14" y="10" width="3.6" height="10" rx="1.8"/>' +
  '<rect x="17.6" y="11" width="3.6" height="10" rx="1.8"/>' +
  '<rect x="21.2" y="12.5" width="3.4" height="9" rx="1.7"/>' +
  '<rect x="10" y="15" width="14.6" height="12.5" rx="4"/>' +
  '<rect x="5.6" y="14.6" width="4" height="9" rx="2" transform="rotate(-35 7.6 19.1)"/>';

const DESIGNED_ARROW = 'M6 3.5 L6 25 L11.3 20.2 L14.8 28 L18.6 26.4 L15.2 18.8 L22.6 18.8 Z';
const SOFT_SHADOW =
  '<defs><filter id="s" x="-50%" y="-50%" width="200%" height="200%">' +
  '<feDropShadow dx="0" dy="1.2" stdDeviation="1.1" flood-color="#000000" flood-opacity="0.35"/></filter></defs>';

export const CURSOR_ART: Record<CursorImage, CursorArt> = {
  'system:arrow': {
    svg: svg(
      '<path d="M4 2 L4 24.5 L9.6 19.2 L13.3 27.6 L16.9 26 L13.2 17.8 L20.8 17.8 Z" fill="#FFFFFF" stroke="#000000" stroke-width="1.4" stroke-linejoin="round"/>',
    ),
    hotspot: [4, 2],
  },
  'system:text': {
    svg: svg(
      '<g fill="none" stroke-linecap="round">' +
        '<path d="M12.5 6 H19.5 M16 6 V26 M12.5 26 H19.5" stroke="#FFFFFF" stroke-width="4"/>' +
        '<path d="M12.5 6 H19.5 M16 6 V26 M12.5 26 H19.5" stroke="#000000" stroke-width="1.6"/></g>',
    ),
    hotspot: [16, 16],
  },
  'system:pointer': {
    svg: svg(
      `<g fill="#000000" stroke="#000000" stroke-width="2.8" stroke-linejoin="round">${HAND}</g><g fill="#FFFFFF">${HAND}</g>`,
    ),
    hotspot: [12, 3],
  },
  'system:wait': {
    svg: svg(
      '<circle cx="16" cy="16" r="9" fill="none" stroke="#000000" stroke-width="5.6"/>' +
        '<circle cx="16" cy="16" r="9" fill="none" stroke="#FFFFFF" stroke-width="3"/>' +
        '<path d="M16 7 A9 9 0 0 1 25 16" fill="none" stroke="#2B7DE9" stroke-width="3" stroke-linecap="round"/>',
    ),
    hotspot: [16, 16],
  },
  'system:crosshair': {
    svg: svg(
      '<path d="M16 4 V28 M4 16 H28" stroke="#FFFFFF" stroke-width="3.6"/>' +
        '<path d="M16 4.8 V27.2 M4.8 16 H27.2" stroke="#000000" stroke-width="1.4"/>',
    ),
    hotspot: [16, 16],
  },
  'system:move': {
    svg: svg(
      '<path d="M16 3 L20.5 8 H17.5 V14.5 H24 V11.5 L29 16 L24 20.5 V17.5 H17.5 V24 H20.5 L16 29 L11.5 24 H14.5 V17.5 H8 V20.5 L3 16 L8 11.5 V14.5 H14.5 V8 H11.5 Z" fill="#FFFFFF" stroke="#000000" stroke-width="1.4" stroke-linejoin="round"/>',
    ),
    hotspot: [16, 16],
  },
  'system:not-allowed': {
    svg: svg(
      '<circle cx="16" cy="16" r="9.5" fill="none" stroke="#FFFFFF" stroke-width="5.6"/>' +
        '<path d="M9.3 9.3 L22.7 22.7" stroke="#FFFFFF" stroke-width="5.6" stroke-linecap="round"/>' +
        '<circle cx="16" cy="16" r="9.5" fill="none" stroke="#D93025" stroke-width="3"/>' +
        '<path d="M9.3 9.3 L22.7 22.7" stroke="#D93025" stroke-width="3"/>',
    ),
    hotspot: [16, 16],
  },
  'arrow-white': {
    svg: svg(
      `${SOFT_SHADOW}<path d="${DESIGNED_ARROW}" fill="#FFFFFF" stroke="#18181B" stroke-width="1.6" stroke-linejoin="round" filter="url(#s)"/>`,
    ),
    hotspot: [6, 3.5],
  },
  'arrow-black': {
    svg: svg(
      `${SOFT_SHADOW}<path d="${DESIGNED_ARROW}" fill="#111113" stroke="#FFFFFF" stroke-width="1.6" stroke-linejoin="round" filter="url(#s)"/>`,
    ),
    hotspot: [6, 3.5],
  },
};

/**
 * The image a cursor style shows for a pointer shape. Only `system` follows the shape; the designed
 * arrows always show an arrow; `dot`, `ring` and `spotlight` are drawn by a shader (undefined here).
 */
export function cursorImageFor(style: CursorStyle, shape: CursorShape): CursorImage | undefined {
  if (style === 'system') return `system:${shape}`;
  if (style === 'arrow-white' || style === 'arrow-black') return style;
  return undefined;
}
