// The command menu (Ctrl+K, or ?): everything the editor can do, by name, with its keys. Type to
// filter, arrows to choose, Enter to run; what cannot run now says why.
import { useEffect, useMemo, useRef, useState } from 'react';
import { shortcut } from '../keys';
import { editorCommands, type EditorCommand } from './commands';
import { store } from './session';
import { useStore } from './store';

/** Where the focus was before the menu opened (a field, a button): it goes back there. */
let returnFocus: HTMLElement | undefined;

export function openMenu(): void {
  if (store.get().phase !== 'ready' || store.get().exportOpen || store.get().menuOpen) return;
  // taken before the menu's input has the focus
  const active = document.activeElement;
  returnFocus = active instanceof HTMLElement && active !== document.body ? active : undefined;
  store.set({ menuOpen: true });
}

export function closeMenu(): void {
  if (!store.get().menuOpen) return;
  store.set({ menuOpen: false });
  const back = returnFocus;
  returnFocus = undefined;
  // after the menu is gone (its input had the focus)
  requestAnimationFrame(() => {
    if (back?.isConnected) back.focus();
  });
}

const words = (text: string) => text.toLowerCase().split(/\s+/).filter(Boolean);

/**
 * How well a command matches the query: undefined when a word typed is not in its name, keywords,
 * group or keys; else 0 when its name starts with the first word, 1 when a word of its name or
 * keywords does, 2 otherwise (what it would undo is not searched).
 */
export function rank(command: EditorCommand, query: string): number | undefined {
  const typed = words(query);
  if (typed.length === 0) return 2;
  const haystack = `${command.name} ${command.keywords ?? ''} ${command.group} ${command.keys ?? ''}`.toLowerCase();
  if (!typed.every((word) => haystack.includes(word))) return undefined;
  const name = command.name.toLowerCase();
  if (name.startsWith(typed[0]!)) return 0;
  return words(`${command.name} ${command.keywords ?? ''}`).some((word) => word.startsWith(typed[0]!)) ? 1 : 2;
}

const HISTORY = new Set(['undo', 'redo']);

export function CommandMenu() {
  const open = useStore(store, (state) => state.menuOpen);
  if (!open) return null;
  return <Menu />;
}

function Menu() {
  const [query, setQuery] = useState('');
  /** The command chosen with the arrows or the pointer; none: the best match. */
  const [chosen, setChosen] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const list = useRef<HTMLDivElement>(null);
  // The commands as they are when the menu opens (Undo says what it would undo).
  const commands = useMemo(() => editorCommands().map((command) => ({ command, blocked: command.blocked?.() })), []);
  const shown = commands
    .map((item, order) => ({ ...item, order, rank: rank(item.command, query) }))
    .filter((item) => item.rank !== undefined)
    .sort((a, b) => (query.trim() === '' ? 0 : a.rank! - b.rank!) || a.order - b.order);
  const runnable = shown.filter((item) => !item.blocked);
  // Enter right after Ctrl+K never undoes: the best match is not Undo or Redo unless asked for by name
  const best = runnable.find((item) => !HISTORY.has(item.command.id) || item.rank === 0);
  const current = runnable.find((item) => item.command.id === chosen) ?? best;

  useEffect(() => {
    setChosen(undefined);
    setNotice(undefined);
  }, [query]);
  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [current?.command.id]);

  const run = (command: EditorCommand) => {
    closeMenu();
    // after the menu is gone and the focus is back
    requestAnimationFrame(() => requestAnimationFrame(() => command.run()));
  };

  const onKey = (event: React.KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === 'Escape' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k')) {
      event.preventDefault();
      closeMenu();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (runnable.length === 0) return;
      const at = Math.max(0, runnable.findIndex((item) => item === current));
      setChosen(runnable[(at + (event.key === 'ArrowDown' ? 1 : runnable.length - 1)) % runnable.length]!.command.id);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (current) run(current.command);
      // nothing runs: say why instead of doing nothing
      else setNotice(shown[0]?.blocked ?? (query.trim() ? `No command has “${query.trim()}” in it.` : undefined));
    }
  };

  let group = '';
  return (
    <div className="menu-scrim" onPointerDown={closeMenu}>
      <div className="command-menu" role="dialog" aria-label="Commands" onPointerDown={(event) => event.stopPropagation()} onKeyDown={onKey}>
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Type a command (split, zoom, faster…)"
          aria-label="Command"
          role="combobox"
          aria-expanded="true"
          aria-controls="command-list"
          aria-activedescendant={current ? `command-${current.command.id}` : undefined}
          data-testid="command-input"
        />
        <div className="command-list" id="command-list" role="listbox" ref={list}>
          {shown.length === 0 && <p className="hint">No command has “{query}” in it.</p>}
          {shown.map(({ command, blocked }) => {
            const heading = query.trim() === '' && command.group !== group ? (group = command.group) : undefined;
            const isActive = command.id === current?.command.id;
            return (
              <div key={command.id}>
                {heading && <div className="command-group">{heading}</div>}
                <div
                  id={`command-${command.id}`}
                  className="command"
                  role="option"
                  aria-selected={isActive}
                  aria-disabled={!!blocked}
                  data-active={isActive}
                  onPointerMove={() => !blocked && command.id !== current?.command.id && setChosen(command.id)}
                  onClick={() => !blocked && run(command)}
                >
                  <span className="command-name">
                    {command.name}
                    {command.detail && <span className="command-detail">{command.detail}</span>}
                  </span>
                  {blocked ? <em title={blocked}>{blocked}</em> : command.keys && <kbd>{shortcut(command.keys)}</kbd>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="command-foot" role="status">
          {notice ? (
            <span className="notice">{notice}</span>
          ) : (
            <>
              <span>
                <kbd>↑</kbd>
                <kbd>↓</kbd> choose
              </span>
              <span>
                <kbd>Enter</kbd> run
              </span>
              <span>
                <kbd>Esc</kbd> close
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
