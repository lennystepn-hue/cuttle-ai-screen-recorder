// Cuttle's icon set: 16 px, 1.6 px strokes, drawn for Cuttle.
import type { ReactElement, SVGProps } from 'react';
import { MARK_EYE, MARK_PATH, MARK_VIEW_BOX } from './mark';

type IconProps = { size?: number } & Omit<SVGProps<SVGSVGElement>, 'children'>;

function icon(paths: ReactElement, filled = false) {
  return function Icon({ size = 16, ...props }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill={filled ? 'currentColor' : 'none'}
        stroke={filled ? 'none' : 'currentColor'}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...props}
      >
        {paths}
      </svg>
    );
  };
}

export const PlayIcon = icon(<path d="M4.5 2.8v10.4L13 8z" />, true);
export const PauseIcon = icon(
  <>
    <rect x="3.5" y="2.5" width="3" height="11" rx="1" />
    <rect x="9.5" y="2.5" width="3" height="11" rx="1" />
  </>,
  true,
);
export const ExportIcon = icon(<path d="M8 2v8.5M4.5 7 8 10.5 11.5 7M3 13.5h10" />);
export const UndoIcon = icon(<path d="M5 4 2 7l3 3M2.5 7H10a3.5 3.5 0 0 1 0 7H8" />);
export const RedoIcon = icon(<path d="m11 4 3 3-3 3M13.5 7H6a3.5 3.5 0 0 0 0 7h2" />);
export const SelectIcon = icon(<path d="M3.5 2.5 12 8l-3.7.9 2 4-1.6.8-2-4L4 12z" />);
export const ZoomIcon = icon(
  <>
    <circle cx="7" cy="7" r="4.5" />
    <path d="m10.5 10.5 3 3M7 5v4M5 7h4" />
  </>,
);
export const MaskIcon = icon(
  <>
    <rect x="2" y="4" width="12" height="8" rx="1.5" />
    <path d="m2.5 11.5 11-7" />
  </>,
);
export const TextIcon = icon(<path d="M3 4V3h10v1M8 3v10M6 13h4" />);
export const SplitIcon = icon(
  <>
    <circle cx="4.5" cy="4.5" r="2" />
    <circle cx="4.5" cy="11.5" r="2" />
    <path d="M6.2 5.6 13.5 12M6.2 10.4 13.5 4" />
  </>,
);
/** A crop: two corner brackets crossing. */
/** An arrow drawn on the screen (the Annotate tool). */
export const AnnotateIcon = icon(<path d="M2.5 13.5 12 4M12 4H7.5M12 4v4.5" />);
export const CropIcon = icon(<path d="M4.5 1.5v10h10M1.5 4.5h10v10" />);
export const FitIcon = icon(<path d="M2.5 6V3.5a1 1 0 0 1 1-1H6M10 2.5h2.5a1 1 0 0 1 1 1V6M13.5 10v2.5a1 1 0 0 1-1 1H10M6 13.5H3.5a1 1 0 0 1-1-1V10" />);
export const FolderIcon = icon(<path d="M2 4.5h4l1.5 1.5H14v6.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />);
export const TrashIcon = icon(<path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 9h6.6l.7-9M6.7 7v4.5M9.3 7v4.5" />);
export const CopyIcon = icon(<path d="M5.5 5.5h8v8h-8zM10.5 5.5v-3h-8v8h3" />);
/** The command menu: a keyboard. */
export const KeysIcon = icon(<path d="M2 4.5h12v7H2zM4.5 7h.1M7 7h.1M9.5 7h.1M12 7h.1M5 9.5h6" />);
export const CloseIcon = icon(<path d="m4 4 8 8M12 4l-8 8" />);
export const CheckIcon = icon(<path d="m3 8.5 3 3 7-7" />);
export const FilmIcon = icon(
  <>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="M5 3v10M11 3v10M2 6.5h3M2 9.5h3M11 6.5h3M11 9.5h3" />
  </>,
);
export const CardIcon = icon(
  <>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="M5 7h6M6 9.5h4" />
  </>,
);
/** Motion: a spark, and a small one. */
export const MotionIcon = icon(
  <>
    <path d="M6.5 2.2 7.8 5.7l3.5 1.3-3.5 1.3-1.3 3.5-1.3-3.5L1.7 7l3.5-1.3z" />
    <path d="m12.2 10.2.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z" />
  </>,
);
export const PageIcon = icon(<path d="M4 2h5.5L12 4.5V14H4zM9.5 2v2.5H12M6 7.5h4M6 10h4" />);
export const MicIcon = icon(
  <>
    <rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5" />
    <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" />
  </>,
);
export const WarningIcon = icon(<path d="M8 2.5 14 13H2zM8 6.5v3M8 11.2v.1" />);
export const RecordIcon = icon(<circle cx="8" cy="8" r="5" />, true);
export const ChevronIcon = icon(<path d="m4.5 6 3.5 3.5L11.5 6" />);
// the look's parts
export const WatermarkIcon = icon(<path d="M2.5 2.5h11v11h-11zM8.5 10.5h3v1.5h-3z" />);
export const BrandIcon = icon(<path d="M2.5 2.5h5.2l5.8 5.8-5.2 5.2-5.8-5.8zM5.4 5.4h.1" />);
export const BackgroundIcon = icon(<path d="M2.5 3.5h11v9h-11zM2.5 10l3.2-3 2.6 2.4L10.5 7.5l3 2.8" />);
export const WindowIcon = icon(<path d="M2 3.5h12v9H2zM2 6h12M3.8 4.8h.1M5.3 4.8h.1" />);
export const CameraIcon = icon(<path d="M8 8.2a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6zM3.6 13.5c.6-2.3 2.3-3.5 4.4-3.5s3.8 1.2 4.4 3.5" />);
export const SubtitlesIcon = icon(<path d="M2 3.5h12v9H2zM4.5 10h3M9 10h2.5M4.5 7.5h7" />);
export const TerminalIcon = icon(<path d="M2 3h12v10H2zM4.5 6.5 6.5 8l-2 1.5M8 10h3" />);
export const GearIcon = icon(
  <path d="M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 1.8v1.6M8 12.6v1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M1.8 8h1.6M12.6 8h1.6M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1" />,
);
export const SoundIcon = icon(<path d="M2.5 6v4h2.5L8.5 13V3L5 6zM11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.8a6 6 0 0 1 0 8.4" />);

/** Cuttle's mark: an orange tile with a dark arrow. */
/** Cuttle's mark: the cuttlefish of its icons (tools/icons.mjs) on the brand's orange tile. */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <span className="mark" style={{ width: size, height: size, borderRadius: size * 0.3 }} aria-hidden="true">
      <svg width={size * 0.8} height={size * 0.56} viewBox={MARK_VIEW_BOX}>
        <path d={MARK_PATH} fill="#1b0f0a" />
        <circle cx={MARK_EYE.cx} cy={MARK_EYE.cy} r={MARK_EYE.r} fill="#fff1e6" />
      </svg>
    </span>
  );
}
/** A window with a panel on its right: the inspector shown or hidden. */
export const SidebarIcon = icon(<path d="M2 3h12v10H2zM10 3v10M11.8 5.5h.6M11.8 7.5h.6" />);
