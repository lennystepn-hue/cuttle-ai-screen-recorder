// The command menu (Ctrl+K, or ?): everything the editor can do, by name, with its keys. Type to
// filter, arrows to choose, Enter to run; what cannot run now says why.
import { useEffect, useMemo, useRef, useState } from 'react';
import { editorCommands, type EditorCommand } from './commands';
import { store } from './session';
import { useStore } from './store';

export function openMenu(): void {
  if (store.get().phase === 'ready' && !store.get().exportOpen) store.set({ menuOpen: true });
}

export function closeMenu(): void {
  store.set({ menuOpen: false });
}

/** Every word typed is somewhere in the command's name, group or keys. */
function matches(command: EditorCommand, query: string): boolean {
  const haystack = `${command.name} ${command.group} ${command.keys ?? ''}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

export function CommandMenu() {
  const open = useStore(store, (state) => state.menuOpen);
  if (!open) return null;
  return <Menu />;
}

function Menu() {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  // The commands as they are when the menu opens (their names say what Undo would undo).
  const commands = useMemo(() => editorCommands().map((command) => ({ command, blocked: command.blocked?.() })), []);
  const shown = commands.filter(({ command }) => matches(command, query));
  const runnable = shown.filter((item) => !item.blocked);
  const current = runnable[Math.min(active, runnable.length - 1)];

  // The focus goes back where it was when the menu closes.
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    return () => before?.focus();
  }, []);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [current?.command.id]);

  const run = (command: EditorCommand) => {
    closeMenu();
    // after the menu is gone, so a command that moves the focus (Speed…) keeps it
    requestAnimationFrame(() => command.run());
  };

  const onKey = (event: React.KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === 'Escape' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k')) {
      event.preventDefault();
      closeMenu();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (runnable.length === 0) return;
      const at = Math.min(active, runnable.length - 1);
      setActive((at + (event.key === 'ArrowDown' ? 1 : runnable.length - 1)) % runnable.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (current) run(current.command);
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
          placeholder="Type a command (split, zoom, undo…)"
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
            const heading = command.group !== group ? (group = command.group) : undefined;
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
                  onPointerMove={() => {
                    const index = runnable.findIndex((item) => item.command.id === command.id);
                    if (index >= 0 && index !== active) setActive(index);
                  }}
                  onClick={() => !blocked && run(command)}
                >
                  <span className="command-name">{command.name}</span>
                  {blocked ? <em>{blocked}</em> : command.keys && <kbd>{command.keys}</kbd>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="command-foot">
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
        </div>
      </div>
    </div>
  );
}
