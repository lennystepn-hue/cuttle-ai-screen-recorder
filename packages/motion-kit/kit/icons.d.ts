// Types of the kit's icons (icons.js), served with them at cuttle-motion://kit/icons.d.ts.

export interface IconOptions {
  /** Its box in px (24). */
  size?: number;
  /** The colour of its lines: any CSS colour (`currentColor`). */
  color?: string;
  /** The width of its lines in the icon's 24-unit grid (2). */
  stroke?: number;
  /** Inside its shapes (`none`). */
  fill?: string;
}

export function iconNames(): Promise<string[]>;
export function icon(name: string, options?: IconOptions): Promise<SVGSVGElement>;
export function iconImage(name: string, options?: IconOptions): Promise<HTMLImageElement>;
