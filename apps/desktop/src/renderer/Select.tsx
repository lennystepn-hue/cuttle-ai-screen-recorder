// Cuttle's own select: a button that opens a styled list in place of the system's (whose list is
// drawn by Windows, white and in its own font). The list opens below the button, or above it when
// there is no room; it is drawn into the page's body, so no panel clips it.
//
// Keys, as in a system select: Enter, Space or the arrows open it; in the list the arrows, Home and
// End move, letters jump to an option, Enter or Space picks, Esc and Tab close it (Esc also never
// reaches the window: the editor would read it as "back out").
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CheckIcon, ChevronIcon } from './icons';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /** Quiet text at the end of the row (a size, "not connected"). */
  note?: string;
  disabled?: boolean;
}

export interface SelectProps<T extends string> {
  value: T | undefined;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  /** Its name for screen readers (the visible label is beside it). */
  label: string;
  /** Shown when the value is none of the options. */
  placeholder?: string;
  disabled?: boolean;
  /** \`field\`: as wide as its field; \`compact\`: the timeline bar's height; \`bare\`: text with a chevron; \`icon\`: the chevron only. */
  variant?: 'field' | 'compact' | 'bare' | 'icon';
  className?: string;
  testId?: string;
  title?: string;
  /** What the button shows instead of the chosen option's label. */
  children?: ReactNode;
}

const GAP = 4;
const MAX_HEIGHT = 320;

export function Select<T extends string>({ value, options, onChange, label, placeholder = '–', disabled, variant = 'field', className, testId, title, children }: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [place, setPlace] = useState<{ left: number; top?: number; bottom?: number; minWidth: number; maxHeight: number }>();
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const id = useId();
  const chosen = options.find((option) => option.value === value);

  const enabledFrom = (start: number, step: 1 | -1) => {
    for (let i = start; i >= 0 && i < options.length; i += step) if (!options[i]!.disabled) return i;
    return -1;
  };

  const show = () => {
    if (disabled || options.length === 0) return;
    const at = options.findIndex((option) => option.value === value);
    setActive(at >= 0 && !options[at]!.disabled ? at : enabledFrom(0, 1));
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    // placed anew on the next open, before the list is drawn
    setPlace(undefined);
    if (refocus) button.current?.focus({ preventScroll: true });
  };
  /** Picks an option; with the mouse the focus is let go (the keys go back to the page, as after a click on a button). */
  const pick = (index: number, byMouse = false) => {
    const option = options[index];
    if (!option || option.disabled) return;
    close(!byMouse);
    if (byMouse) button.current?.blur();
    if (option.value !== value) onChange(option.value);
  };

  // below the button, or above it when the window has no room for the list below
  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const box = button.current.getBoundingClientRect();
    const below = window.innerHeight - box.bottom - GAP - 8;
    const above = box.top - GAP - 8;
    const wanted = Math.min(MAX_HEIGHT, options.length * 30 + 8);
    const up = below < wanted && above > below;
    setPlace({
      left: Math.max(8, Math.min(box.left, window.innerWidth - Math.max(box.width, 160) - 8)),
      minWidth: box.width,
      maxHeight: Math.max(120, Math.min(MAX_HEIGHT, up ? above : below)),
      ...(up ? { bottom: window.innerHeight - box.top + GAP } : { top: box.bottom + GAP }),
    });
  }, [open, options.length]);

  // the keys go to the list while it is open (it is drawn once placed); a press elsewhere, a scroll or a resize closes it
  const placed = place !== undefined;
  useEffect(() => {
    if (!open || !placed) return;
    list.current?.focus({ preventScroll: true });
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!list.current?.contains(target) && !button.current?.contains(target)) close(false);
    };
    const shut = (event: Event) => {
      if (event.type === 'scroll' && list.current?.contains(event.target as Node)) return;
      close(false);
    };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('scroll', shut, true);
    window.addEventListener('resize', shut);
    window.addEventListener('blur', shut);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('scroll', shut, true);
      window.removeEventListener('resize', shut);
      window.removeEventListener('blur', shut);
    };
  }, [open, placed]);

  // the active option stays in view
  useEffect(() => {
    if (open && active >= 0) list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  /** Letters typed within half a second find the first option that starts with them. */
  const typeAhead = (key: string): boolean => {
    if (key.length !== 1 || key === ' ') return false;
    const now = performance.now();
    typed.current = { text: now - typed.current.at < 500 ? typed.current.text + key.toLowerCase() : key.toLowerCase(), at: now };
    const found = options.findIndex((option) => !option.disabled && option.label.toLowerCase().startsWith(typed.current.text));
    if (found >= 0) setActive(found);
    return true;
  };

  const onButtonKey = (event: KeyboardEvent) => {
    if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      show();
    }
  };

  const onListKey = (event: KeyboardEvent) => {
    // nothing pressed in the list reaches the window (the editor's keys)
    event.stopPropagation();
    const step = (from: number, by: 1 | -1) => {
      const next = enabledFrom(from + by, by);
      return next >= 0 ? next : from;
    };
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive((at) => step(at, 1));
        return;
      case 'ArrowUp':
        event.preventDefault();
        setActive((at) => step(at, -1));
        return;
      case 'Home':
        event.preventDefault();
        setActive(enabledFrom(0, 1));
        return;
      case 'End':
        event.preventDefault();
        setActive(enabledFrom(options.length - 1, -1));
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        pick(active);
        return;
      case 'Escape':
        event.preventDefault();
        close();
        return;
      case 'Tab':
        close(false);
        return;
      default:
        if (typeAhead(event.key)) event.preventDefault();
    }
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className={`select-trigger select-${variant}${className ? ` ${className}` : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-label={label}
        title={title}
        disabled={disabled}
        data-testid={testId}
        data-value={value}
        onClick={() => (open ? close() : show())}
        onKeyDown={onButtonKey}
      >
        {variant !== 'icon' && <span className="select-value">{children ?? chosen?.label ?? placeholder}</span>}
        <ChevronIcon size={variant === 'compact' || variant === 'bare' ? 12 : 14} />
      </button>
      {open &&
        place &&
        createPortal(
          <ul
            ref={list}
            id={`${id}-list`}
            className="select-list"
            role="listbox"
            aria-label={label}
            tabIndex={-1}
            aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
            style={place}
            onKeyDown={onListKey}
            data-testid={testId ? `${testId}-list` : undefined}
          >
            {options.map((option, index) => (
              <li
                key={option.value}
                id={`${id}-${index}`}
                data-index={index}
                role="option"
                aria-selected={option.value === value}
                aria-disabled={option.disabled || undefined}
                className={index === active ? 'active' : undefined}
                onPointerEnter={() => !option.disabled && setActive(index)}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => pick(index, true)}
              >
                <CheckIcon className="check" size={14} />
                <span className="option-label">{option.label}</span>
                {option.note && <span className="option-note">{option.note}</span>}
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </>
  );
}
