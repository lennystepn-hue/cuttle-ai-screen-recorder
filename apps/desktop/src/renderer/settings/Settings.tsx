// The settings window, and the first run in the same window (#welcome): ffmpeg, the cuttle command
// and the Claude skill, then the pill. Every change is kept at once; there is no Save.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Motion, RequestArgument, SettingsView, ToolsStatus } from '../../shared/ipc';
import { bridge } from '../bridge';
import { CheckIcon, CopyIcon, FolderIcon, Mark, WarningIcon } from '../icons';

const WINGET = 'winget install Gyan.FFmpeg';

type Devices = { cameras: string[]; mics: string[]; problem?: string };

/** A path as people read it: the user's folder as ~ (the whole path is in the tooltip). */
const shortPath = (path: string) => path.replace(/^[A-Za-z]:\\Users\\[^\\]+(?=\\)/i, '~').replace(/^\/(home|Users)\/[^/]+(?=\/)/, '~');
/** "9.0" from "9.0-full_build-www.gyan.dev". */
const shortVersion = (version: string) => /^n?(\d+(\.\d+)*)/.exec(version)?.[1] ?? version;

/** A request's failure, said in its first line (the rest is for logs). */
const firstLine = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '').split('\n')[0]!;

export function Settings() {
  const welcome = location.hash === '#welcome';
  const [view, setView] = useState<SettingsView>();
  const [tools, setTools] = useState<ToolsStatus>();
  const [devices, setDevices] = useState<Devices>();

  useEffect(() => {
    void bridge.invoke('settings:get').then(setView);
    void bridge.invoke('tools:status').then(setTools);
    void bridge.invoke('settings:devices').then(setDevices);
    return bridge.on('settings:changed', setView);
  }, []);

  const change = (next: RequestArgument<'settings:set'>) => void bridge.invoke('settings:set', next).then(setView);

  return (
    <div className="settings" data-mode={welcome ? 'welcome' : 'settings'} data-testid="settings">
      <header className="drag">{welcome ? 'Welcome to Cuttle' : 'Settings'}</header>
      <main>
        {welcome ? (
          <Welcome tools={tools} setTools={setTools} />
        ) : (
          <>
            <Section title="Recording">
              <Row label="Projects folder" hint="Every new recording gets a folder here, named by its date and time." stacked>
                <div className="path-row">
                  <span className="path" title={view?.projectsFolder} data-testid="projects-folder">
                    {view ? shortPath(view.projectsFolder) : ''}
                  </span>
                  <button className="ghost" onClick={() => void bridge.invoke('settings:choose-folder').then(setView)} data-testid="choose-folder">
                    Change…
                  </button>
                </div>
              </Row>
              <Row label="Countdown" hint="Before a recording starts, over what is recorded.">
                <Segmented
                  value={view?.countdown}
                  options={[
                    [0, 'Off'],
                    [3, '3 s'],
                    [5, '5 s'],
                  ]}
                  onChange={(countdown) => change({ countdown })}
                  label="Countdown"
                  testid="countdown"
                />
              </Row>
              <Row label="Camera" hint={devices?.problem ?? 'Shown as a bubble in the corner. The picker can change it for one recording.'}>
                <DeviceSelect kind="camera" value={view?.camera} devices={devices?.cameras} onChange={(camera) => change({ camera })} />
              </Row>
              <Row label="Microphone">
                <DeviceSelect kind="mic" value={view?.mic} devices={devices?.mics} onChange={(mic) => change({ mic })} />
              </Row>
            </Section>

            <Section title="Tools">
              <Tools tools={tools} setTools={setTools} />
            </Section>

            <Section title="App">
              <Row label="Start Cuttle when you sign in" hint="It waits in the tray; Ctrl+Shift+Alt+R starts a recording.">
                <button
                  className="toggle"
                  role="switch"
                  aria-checked={view?.launchAtLogin ?? false}
                  aria-label="Start Cuttle when you sign in"
                  onClick={() => view && change({ launchAtLogin: !view.launchAtLogin })}
                  data-testid="launch-at-login"
                >
                  <i />
                </button>
              </Row>
              <Row label="Motion" hint="Animations in Cuttle's windows. The video is not affected.">
                <Segmented<Motion>
                  value={view?.motion}
                  options={[
                    ['system', 'Like Windows'],
                    ['reduce', 'Less'],
                    ['full', 'Full'],
                  ]}
                  onChange={(motion) => change({ motion })}
                  label="Motion"
                  testid="motion"
                />
              </Row>
            </Section>

            <Section title="Recent projects">
              <Recent view={view} />
            </Section>
            <p className="version">Cuttle {view?.version}</p>
          </>
        )}
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2>{title}</h2>
      <div className="card">{children}</div>
    </section>
  );
}

function Row({ label, hint, stacked, children }: { label: string; hint?: string; stacked?: boolean; children: ReactNode }) {
  return (
    <div className={`row${stacked ? ' stacked' : ''}`}>
      <div className="row-text">
        <div className="row-label">{label}</div>
        {hint && <div className="row-hint">{hint}</div>}
      </div>
      <div className="row-control">{children}</div>
    </div>
  );
}

function Segmented<T extends string | number>({ value, options, onChange, label, testid }: { value: T | undefined; options: [T, string][]; onChange: (value: T) => void; label: string; testid: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label} data-testid={testid}>
      {options.map(([option, text]) => (
        <button key={String(option)} role="radio" aria-checked={value === option} aria-pressed={value === option} onClick={() => onChange(option)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** A camera or mic: None, the devices listed, and the saved one when it is not plugged in now. */
function DeviceSelect({ kind, value, devices, onChange }: { kind: 'camera' | 'mic'; value: string | undefined; devices: string[] | undefined; onChange: (device: string | null) => void }) {
  const missing = value !== undefined && devices !== undefined && !devices.includes(value);
  return (
    <select
      value={value ?? ''}
      onChange={(event) => {
        onChange(event.target.value === '' ? null : event.target.value);
        event.target.blur();
      }}
      disabled={devices === undefined}
      aria-label={kind === 'camera' ? 'Camera' : 'Microphone'}
      data-testid={`${kind}-select`}
    >
      <option value="">{devices === undefined ? 'Listing…' : 'None'}</option>
      {missing && <option value={value}>{value} (not connected)</option>}
      {(devices ?? []).map((device) => (
        <option key={device} value={device}>
          {device}
        </option>
      ))}
    </select>
  );
}

/** ffmpeg, the cuttle command and the skill: what is there, and Install for what is not. */
function Tools({ tools, setTools }: { tools: ToolsStatus | undefined; setTools: (tools: ToolsStatus) => void }) {
  const [busy, setBusy] = useState<'check' | 'install'>();
  const [problem, setProblem] = useState<string>();
  const check = async () => {
    setBusy('check');
    try {
      setTools(await bridge.invoke('tools:check'));
    } finally {
      setBusy(undefined);
    }
  };
  const install = async () => {
    setBusy('install');
    setProblem(undefined);
    try {
      const answer = await bridge.invoke('tools:install');
      setTools(answer.status);
      setProblem(answer.problem);
    } catch (error) {
      setProblem(firstLine(error));
    } finally {
      setBusy(undefined);
    }
  };
  // Install while something is missing; Install again (quieter) rewrites the app's own copies, after the app moved
  const missing = tools !== undefined && (!tools.command || tools.skill.state === 'missing');
  const again = tools !== undefined && !missing && tools.command?.ours === true;
  return (
    <>
      <ToolLine
        ok={tools ? tools.ffmpeg !== undefined : undefined}
        name={tools?.ffmpeg ? `ffmpeg ${shortVersion(tools.ffmpeg.version)}` : 'ffmpeg'}
        detail={tools?.ffmpeg ? tools.ffmpeg.path : 'Missing. Cuttle records and exports with it: install it in a terminal, then check again.'}
        testid="tool-ffmpeg"
      >
        {tools && !tools.ffmpeg && (
          <>
            <Winget />
            <button className="ghost" onClick={() => void check()} disabled={busy !== undefined} data-testid="check-again">
              {busy === 'check' ? 'Looking…' : 'Check again'}
            </button>
          </>
        )}
      </ToolLine>
      <ToolLine ok={tools ? tools.command !== undefined : undefined} name="The cuttle command" detail={tools?.command ? tools.command.path : 'Claude runs it to record, cut and render.'} testid="tool-command" />
      <ToolLine
        ok={tools ? tools.skill.state === 'installed' : undefined}
        warn={tools?.skill.state === 'other'}
        name="The Claude skill"
        detail={tools?.skill.state === 'other' ? `${tools.skill.dir} holds a cuttle skill Cuttle did not install.` : tools?.skill.state === 'installed' ? tools.skill.dir : 'Tells Claude Code how to make a demo with Cuttle.'}
        testid="tool-skill"
      />
      <div className="tools-actions">
        <span className="row-hint" data-testid="tools-note">
          {problem ?? (tools?.newTerminal ? 'Open a new terminal: one opened before does not know the cuttle command yet.' : 'Claude Code finds both once they are installed.')}
        </span>
        {(missing || again) && (
          <button className={missing ? 'primary' : 'ghost'} onClick={() => void install()} disabled={busy !== undefined} data-testid="install-tools">
            {busy === 'install' ? 'Installing…' : missing ? 'Install' : 'Install again'}
          </button>
        )}
      </div>
    </>
  );
}

function ToolLine({ ok, warn, name, detail, testid, children }: { ok: boolean | undefined; warn?: boolean; name: string; detail: string; testid: string; children?: ReactNode }) {
  return (
    <div className="tool" data-state={ok === undefined ? 'unknown' : ok ? 'ok' : 'missing'} data-testid={testid}>
      <span className={`tool-mark${ok ? ' ok' : warn || ok === false ? ' warn' : ''}`} aria-hidden>
        {ok ? <CheckIcon size={12} /> : ok === false ? <WarningIcon size={12} /> : null}
      </span>
      <div className="tool-text">
        <div className="row-label">{name}</div>
        <div className={`row-hint${ok ? ' path-text' : ''}`} title={detail}>
          {ok === undefined ? 'Looking…' : ok ? shortPath(detail) : detail}
        </div>
        {children && <div className="tool-extra">{children}</div>}
      </div>
    </div>
  );
}

/** The command that installs ffmpeg, to copy into a terminal. */
function Winget() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="command"
      onClick={() => {
        void bridge.invoke('tools:copy', WINGET);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
      title="Copy, then paste it in a terminal"
      data-testid="copy-winget"
    >
      <code>{WINGET}</code>
      {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}

/** The recent projects: open, rename (its folder), show in the folder, take off the list. */
function Recent({ view }: { view: SettingsView | undefined }) {
  const [renaming, setRenaming] = useState<string>();
  const [problem, setProblem] = useState<{ dir: string; text: string }>();
  if (view && view.recent.length === 0) return <p className="empty">Projects you open or record show here.</p>;
  return (
    <ul className="recent" data-testid="recent">
      {view?.recent.map((entry) => (
        <li key={entry.dir}>
          {renaming === entry.dir ? (
            <RenameField
              initial={entry.name}
              onDone={async (name) => {
                if (name === undefined || name === entry.name) return setRenaming(undefined);
                const answer = await bridge.invoke('recent:rename', { dir: entry.dir, name });
                if ('problem' in answer) setProblem({ dir: entry.dir, text: answer.problem });
                else {
                  setProblem(undefined);
                  setRenaming(undefined);
                }
              }}
            />
          ) : (
            <button className="recent-name" onClick={() => void bridge.invoke('recent:open', entry.dir)} title={`Open ${entry.dir}`}>
              <b>{entry.name}</b>
              <span className="path-text">{shortPath(entry.dir.replace(/[\\/][^\\/]+$/, ''))}</span>
            </button>
          )}
          {renaming !== entry.dir && (
            <span className="recent-actions">
              <button
                onClick={() => {
                  setProblem(undefined);
                  setRenaming(entry.dir);
                }}
                data-testid="recent-rename"
              >
                Rename
              </button>
              <button onClick={() => void bridge.invoke('recent:reveal', entry.dir)} title="Show in its folder" aria-label="Show in its folder">
                <FolderIcon size={14} />
              </button>
              <button onClick={() => void bridge.invoke('recent:forget', entry.dir)} title="Take it off this list (the folder stays)">
                Remove
              </button>
            </span>
          )}
          {problem?.dir === entry.dir && (
            <div className="error-text" role="alert" data-testid="rename-problem">
              {problem.text}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function RenameField({ initial, onDone }: { initial: string; onDone: (name: string | undefined) => void }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.select(), []);
  return (
    <input
      ref={input}
      className="rename"
      defaultValue={initial}
      aria-label="Project name"
      onKeyDown={(event) => {
        if (event.key === 'Enter') onDone(event.currentTarget.value.trim());
        if (event.key === 'Escape') onDone(undefined);
      }}
      onBlur={(event) => onDone(event.currentTarget.value.trim())}
      data-testid="rename-input"
    />
  );
}

/** The first run: ffmpeg and Claude Code, then Done (the pill). */
function Welcome({ tools, setTools }: { tools: ToolsStatus | undefined; setTools: (tools: ToolsStatus) => void }) {
  // one accent: Install while something is missing, Done once all is there
  const ready = tools !== undefined && tools.ffmpeg !== undefined && tools.command !== undefined && tools.skill.state !== 'missing';
  return (
    <div className="welcome">
      <div className="welcome-head">
        <Mark size={44} />
        <div>
          <h1>Record Claude Code at work.</h1>
          <p>Cuttle cuts the take for you: waiting sped up, a zoom on the answer, ready to export.</p>
        </div>
      </div>
      <Section title="Before the first recording">
        <Tools tools={tools} setTools={setTools} />
      </Section>
      <div className="welcome-foot">
        <span className="row-hint">Cuttle waits at the top of your screen and in the tray. Ctrl+Shift+Alt+R starts a recording from anywhere.</span>
        <button className={ready ? 'primary' : 'ghost'} onClick={() => void bridge.invoke('settings:welcomed')} data-testid="welcome-done">
          Done
        </button>
      </div>
    </div>
  );
}
