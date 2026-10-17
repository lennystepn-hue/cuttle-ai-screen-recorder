// Cuttle's icon set: 16 px, 1.6 px strokes, drawn for Cuttle.
import type { ReactElement, SVGProps } from 'react';

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
export const FitIcon = icon(<path d="M2.5 6V3.5a1 1 0 0 1 1-1H6M10 2.5h2.5a1 1 0 0 1 1 1V6M13.5 10v2.5a1 1 0 0 1-1 1H10M6 13.5H3.5a1 1 0 0 1-1-1V10" />);
export const FolderIcon = icon(<path d="M2 4.5h4l1.5 1.5H14v6.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />);
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

/** Cuttle's mark: an orange tile with a dark arrow. */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <span className="mark" style={{ width: size, height: size, borderRadius: size * 0.32 }} aria-hidden="true">
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 12 12">
        <path d="M2 2h5l3 4-3 4H2z" fill="#1b0f0a" />
      </svg>
    </span>
  );
}
