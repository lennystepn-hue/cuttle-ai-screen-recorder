// The settings window, and the first run in the same window (#welcome): ffmpeg, the cuttle command
// and the Claude skill, then the pill. Every change is kept at once; there is no Save.
import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode } from 'react';
import type { Motion, Permission, PermissionView, RequestArgument, SettingsPage, SettingsView, SpeechLanguage, SpeechModelName, SpeechStatus, ToolsStatus, UpdateStatus } from '../../shared/ipc';
import { bridge } from '../bridge';
import { CheckIcon, CloseIcon, CopyIcon, FolderIcon, GearIcon, Mark, MaskIcon, MicIcon, RecordIcon, TerminalIcon, WarningIcon } from '../icons';
import { hotkeyKeys } from '../keys';
import { Select } from '../Select';
import { PrivacySettings } from './PrivacySettings';

const MAC = navigator.userAgent.includes('Macintosh');
/** The command that installs ffmpeg on this OS. */
const INSTALL_FFMPEG = MAC ? 'brew install ffmpeg' : 'winget install Gyan.FFmpeg';

type Devices = { cameras: string[]; mics: string[]; problem?: string };

/** A path as people read it: the user's folder as ~ (the whole path is in the tooltip). */
const shortPath = (path: string) => path.replace(/^[A-Za-z]:\\Users\\[^\\]+(?=\\|$)/i, '~').replace(/^\/(home|Users)\/[^/]+(?=\/|$)/, '~');
/** A long path cut in its middle, so the folder's own name shows: "~\AppData\…\Videos\Cuttle". */
function middlePath(path: string, max = 46): string {
  if (path.length <= max) return path;
  const parts = path.split(/(?=[\\/])/);
  let tail = parts.pop() ?? '';
  while (parts.length > 1 && (parts.at(-1)!.length + tail.length) < max * 0.6) tail = parts.pop()! + tail;
  const head = parts.slice(0, 2).join('');
  return `${head}${path.includes('\\') ? '\\' : '/'}…${tail}`;
}
/** "9.0" from "9.0-full_build-www.gyan.dev". */
const shortVersion = (version: string) => /^n?(\d+(\.\d+)*)/.exec(version)?.[1] ?? version;
/** "2 h ago" for a recent project. */
function ago(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / (24 * 60))} days ago`;
}

/** A request's failure, said in its first line (the rest is for logs). */
const firstLine = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '').split('\n')[0]!;

/** A recording hotkey: one chip per key (the Mac's symbols, in its order, on a Mac). */
const Keys = ({ keys }: { keys: string }) => (
  <span className="keys">
    {hotkeyKeys(keys).map((key) => (
      <kbd key={key}>{key}</kbd>
    ))}
  </span>
);
/** Where Cuttle waits when its windows are closed. */
const TRAY = MAC ? 'menu bar' : 'tray';

/** The settings' pages, in the sidebar's order, each with what it is about under its title. */
const PAGES: { id: SettingsPage; title: string; lead: string; icon: ComponentType<{ size?: number }> }[] = [
  { id: 'recording', title: 'Recording', lead: 'Where takes go, what they record, and the keys that run a take.', icon: RecordIcon },
  { id: 'speech', title: 'Speech', lead: 'What is said in a take, written down on this computer: nothing is uploaded.', icon: MicIcon },
  { id: 'privacy', title: 'Privacy', lead: 'What Cuttle masks in a take before anyone sees it.', icon: MaskIcon },
  { id: 'claude', title: 'Claude Code', lead: 'Claude Code records and cuts with Cuttle through the cuttle command and its skill.', icon: TerminalIcon },
  { id: 'projects', title: 'Projects', lead: 'The projects you opened or recorded lately.', icon: FolderIcon },
  { id: 'general', title: 'General', lead: 'How Cuttle starts, moves and stays up to date.', icon: GearIcon },
];

/** The recording hotkeys (HOTKEYS in @cuttle/recorder's input.ts, and the one that starts a take). */
const HOTKEY_LIST: [string, string][] = [
  ['Start a recording', 'Ctrl+Shift+Alt+R'],
  ['A screenshot', 'Ctrl+Shift+Alt+C'],
  ['Stop', 'Ctrl+Shift+Alt+S'],
  ['Pause and resume', 'Ctrl+Shift+Alt+P'],
  ['A slip: cut back to the pause before', 'Ctrl+Shift+Alt+X'],
  ['Set a marker', 'Ctrl+Shift+Alt+M'],
  ['The script’s next step', 'Ctrl+Shift+Alt+N'],
  ['The step before', 'Ctrl+Shift+Alt+B'],
];

/** Each permission as System Settings names it, and what a take has from it. */
const PERMISSION_NAMES: Record<Permission, { name: string; what: string; asked?: string }> = {
  screen: { name: 'Screen & System Audio Recording', what: 'Records the screen and its windows.', asked: 'macOS asks the first time you record.' },
  input: { name: 'Input Monitoring', what: 'Sees clicks and keys: zooms on clicks, zooms while typing, the recording hotkeys.' },
  accessibility: { name: 'Accessibility', what: 'Sees where you type and the page in a browser: zooms follow the letters.' },
  camera: { name: 'Camera', what: 'The webcam bubble, when a take has one.', asked: 'macOS asks the first time a take uses it.' },
  microphone: { name: 'Microphone', what: 'Your voice, when a take records the mic.', asked: 'macOS asks the first time a take uses it.' },
};

export function Settings() {
  const welcome = location.hash === '#welcome';
  const [view, setView] = useState<SettingsView>();
  const [tools, setTools] = useState<ToolsStatus>();
  const [devices, setDevices] = useState<Devices>();
  // the page asked for in the address (settings.html#speech), then by the main process
  const [page, setPage] = useState<SettingsPage>(() => PAGES.find(({ id }) => `#${id}` === location.hash)?.id ?? 'recording');
  useEffect(() => bridge.on('settings:page', setPage), []);

  useEffect(() => {
    // the taskbar and Alt+Tab name the window by its page
    document.title = welcome ? 'Welcome to Cuttle' : 'Cuttle settings';
    void bridge.invoke('settings:get').then(setView);
    void bridge.invoke('tools:status').then(setTools);
    void bridge.invoke('settings:devices').then(setDevices);
    // Esc (not while a field or menu has it) and Ctrl+W close the window
    const onKey = (event: globalThis.KeyboardEvent) => {
      const typing = (event.target as HTMLElement | null)?.closest('input, select, textarea');
      if ((event.key === 'Escape' && !typing && !event.defaultPrevented) || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'w')) {
        event.preventDefault();
        window.close();
      }
    };
    window.addEventListener('keydown', onKey);
    const off = bridge.on('settings:changed', setView);
    return () => {
      window.removeEventListener('keydown', onKey);
      off();
    };
  }, []);

  const change = (next: RequestArgument<'settings:set'>) => void bridge.invoke('settings:set', next).then(setView);
  const current = PAGES.find(({ id }) => id === page)!;

  return (
    <div className="settings" data-mode={welcome ? 'welcome' : 'settings'} data-testid="settings">
      <header className="drag">
        <Mark />
        <span>{welcome ? 'Welcome to Cuttle' : 'Settings'}</span>
      </header>
      <main>
        {welcome ? (
          <Welcome tools={tools} setTools={setTools} />
        ) : (
          <div className="settings-body">
            <nav className="settings-nav" aria-label="Settings">
              {PAGES.map(({ id, title, icon: Icon }) => (
                <button key={id} type="button" aria-current={page === id ? 'page' : undefined} onClick={() => setPage(id)} data-testid={`settings-page-${id}`}>
                  <Icon size={16} />
                  {title}
                </button>
              ))}
            </nav>
            <div className="settings-page" data-page={page}>
              <div className="page-head">
                <h1>{current.title}</h1>
                <p>{current.lead}</p>
              </div>
              {page === 'recording' && (
                <>
                  <Section title="Takes">
                    <Row label="Projects folder" hint="Every new recording gets a folder here, named by its date and time." stacked>
                      <div className="path-row">
                        <span className="path" title={view?.projectsFolder} data-testid="projects-folder">
                          {view ? middlePath(shortPath(view.projectsFolder)) : ''}
                        </span>
                        <button className="ghost" onClick={() => void bridge.invoke('settings:choose-folder').then(setView)} data-testid="choose-folder">
                          Change…
                        </button>
                      </div>
                    </Row>
                    <Row label="Countdown" hint="Counts down over the recorded area before recording starts.">
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
                  <Section title="Screenshots">
                    <Row label="Screenshots folder" hint="Every screenshot gets a folder here: the picture as taken, its look, and the framed picture." stacked>
                      <div className="path-row">
                        <span className="path" title={view?.shots.folder} data-testid="shots-folder">
                          {view ? middlePath(shortPath(view.shots.folder)) : ''}
                        </span>
                        <button className="ghost" onClick={() => void bridge.invoke('settings:choose-folder', 'shots').then(setView)} data-testid="choose-shots-folder">
                          Change…
                        </button>
                      </div>
                    </Row>
                    <Row label="After a screenshot" hint="Framed in the last look and copied, with a note to edit it; or straight into the screenshot editor.">
                      <Segmented
                        value={view ? (view.shots.quick ? 'copy' : 'edit') : undefined}
                        options={[
                          ['copy', 'Copy it'],
                          ['edit', 'Edit it'],
                        ]}
                        onChange={(after) => change({ shotsQuick: after === 'copy' })}
                        label="After a screenshot"
                        testid="shots-after"
                      />
                    </Row>
                  </Section>
                  <Permissions />
                  <Section title="Hotkeys">
                    <ul className="hotkeys" data-testid="hotkeys">
                      {HOTKEY_LIST.map(([what, keys]) => (
                        <li key={keys}>
                          <span>{what}</span>
                          <Keys keys={keys} />
                        </li>
                      ))}
                    </ul>
                  </Section>
                  <Section title="To record">
                    <FfmpegLine tools={tools} setTools={setTools} />
                  </Section>
                </>
              )}

              {page === 'speech' && (
                <>
                  <Section title="Transcription">
                    <SpeechSettings view={view} change={change} />
                  </Section>
                </>
              )}

              {page === 'privacy' && (
                <>
                  <Section title="Masks">
                    <PrivacySettings view={view} change={change} />
                  </Section>
                </>
              )}

              {page === 'claude' && (
                <>
                  <Section title="Tools">
                    <ClaudeTools tools={tools} setTools={setTools} />
                  </Section>
                  <Section title="Other agents (MCP)">
                    <Row label="Claude Desktop, Cursor and other MCP clients" hint="Cuttle's commands as tools for any agent: add this to the client's MCP settings. It needs the cuttle command (above). Recording stays with you." stacked>
                      <CopyText text={MCP_CONFIG} testid="copy-mcp" />
                    </Row>
                  </Section>
                </>
              )}

              {page === 'general' && (
                <>
                  <Section title="App">
                    <Row label="Start Cuttle when you sign in" hint={<>It waits in the {TRAY}; <Keys keys="Ctrl+Shift+Alt+R" /> starts a recording.</>}>
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
                          ['system', MAC ? 'Like macOS' : 'Like Windows'],
                          ['reduce', 'Less'],
                          ['full', 'Full'],
                        ]}
                        onChange={(motion) => change({ motion })}
                        label="Motion"
                        testid="motion"
                      />
                    </Row>
                  </Section>
                  <Section title="Updates">
                    <Updates view={view} change={change} />
                  </Section>
                </>
              )}

              {page === 'projects' && (
                <>
                  <Section title="Recent">
                    <Recent view={view} />
                  </Section>
                </>
              )}
            </div>
          </div>
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

export function Row({ label, hint, stacked, children }: { label: string; hint?: ReactNode; stacked?: boolean; children: ReactNode }) {
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

/** A radio group: Tab reaches the chosen one, the arrow keys move and choose. */
function Segmented<T extends string | number>({ value, options, onChange, label, testid }: { value: T | undefined; options: [T, string][]; onChange: (value: T) => void; label: string; testid: string }) {
  const group = useRef<HTMLDivElement>(null);
  const at = Math.max(0, options.findIndex(([option]) => option === value));
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (at + step + options.length) % options.length;
    onChange(options[next]![0]);
    group.current?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
  };
  return (
    <div className="seg" role="radiogroup" aria-label={label} data-testid={testid} ref={group} onKeyDown={onKeyDown}>
      {options.map(([option, text], index) => (
        <button key={String(option)} role="radio" aria-checked={value === option} tabIndex={index === at ? 0 : -1} onClick={() => onChange(option)}>
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
    <Select
      value={value ?? ''}
      options={[
        { value: '', label: devices === undefined ? 'Listing…' : 'None' },
        ...(missing ? [{ value: value!, label: value!, note: 'not connected' }] : []),
        ...(devices ?? []).map((device) => ({ value: device, label: device })),
      ]}
      onChange={(device) => onChange(device === '' ? null : device)}
      disabled={devices === undefined}
      label={kind === 'camera' ? 'Camera' : 'Microphone'}
      className="device"
      testId={`${kind}-select`}
    />
  );
}

/**
 * macOS: each permission a take needs, allowed or not, with the way to its pane of System Settings;
 * looked at again when the window comes back to the front (after System Settings). None elsewhere.
 */
function Permissions() {
  const [permissions, setPermissions] = useState<PermissionView[]>();
  useEffect(() => {
    const look = () => void bridge.invoke('settings:permissions').then(setPermissions);
    look();
    window.addEventListener('focus', look);
    return () => window.removeEventListener('focus', look);
  }, []);
  if (!permissions || permissions.length === 0) return null;
  return (
    <Section title="Permissions">
      {permissions.map(({ permission, granted }) => {
        const { name, what, asked } = PERMISSION_NAMES[permission];
        const waits = granted === undefined && asked !== undefined;
        return (
          <ToolLine
            key={permission}
            state={granted ? 'ok' : waits ? 'off' : 'warn'}
            name={name}
            detail={granted ? what : waits ? `${what} ${asked}` : `Not allowed. ${what}`}
            testid={`permission-${permission}`}
            plain
          >
            {!granted && !waits && (
              <button className="ghost" onClick={() => void bridge.invoke('settings:permission', permission)}>
                Open System Settings
              </button>
            )}
          </ToolLine>
        );
      })}
    </Section>
  );
}

const megabytes = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;

/**
 * Transcribing a take after its cut: the model (or off), its download (progress, cancel, checksum)
 * or removal, and the language spoken. Everything runs on this computer.
 */
function SpeechSettings({ view, change }: { view: SettingsView | undefined; change: (next: RequestArgument<'settings:set'>) => void }) {
  const [status, setStatus] = useState<SpeechStatus>();
  useEffect(() => {
    void bridge.invoke('speech:status').then(setStatus);
    return bridge.on('speech:status', setStatus);
  }, []);
  const chosen = view?.speech.model;
  const model = status?.models.find((entry) => entry.name === chosen);
  const download = status?.download;
  const failed = status?.failure?.name === chosen ? status?.failure : undefined;
  // one download at a time: the line shows it whichever model is chosen, so it can be cancelled
  const fetching = download !== undefined;
  const fetched = status?.models.find((entry) => entry.name === download?.name);
  const percent = fetching ? Math.floor((download.received / download.total) * 100) : 0;
  return (
    <>
      <Row label="Transcribe after a take" hint="Cuttle cuts filler words and pauses where the picture rests. It runs on this computer: nothing is uploaded.">
        <Select<SpeechModelName | 'off'>
          value={chosen}
          options={[
            { value: 'off', label: 'Off' },
            ...(status?.models ?? []).map((entry) => ({ value: entry.name, label: `${entry.label} (${entry.name})`, note: entry.installed ? 'downloaded' : megabytes(entry.bytes) })),
          ]}
          onChange={(speechModel) => change({ speechModel })}
          disabled={status === undefined}
          label="Speech model"
          className="device"
          testId="speech-model"
        />
      </Row>
      {model && (
        <ToolLine
          state={failed ? 'failed' : model.installed ? (status?.whisper === false ? 'warn' : 'ok') : fetching ? 'unknown' : 'off'}
          name={`The ${model.label} model`}
          detail={
            failed
              ? `The download failed: ${failed.message}`
              : fetching
                ? download.name === chosen
                  ? `Downloading… ${percent} % of ${megabytes(download.total)}`
                  : `The ${fetched?.label} model is downloading (${percent} % of ${megabytes(download.total)}): one download at a time.`
                : model.installed
                  ? status?.whisper === false
                    ? 'Downloaded, but Cuttle cannot transcribe yet: it needs ffmpeg with whisper (winget upgrade Gyan.FFmpeg) or, on a Mac, whisper.cpp (brew install whisper-cpp).'
                    : `Downloaded: ${model.note}.`
                  : `${model.note[0]!.toUpperCase()}${model.note.slice(1)}. ${megabytes(model.bytes)} to download, once.`
          }
          title={status?.dir}
          testid="speech-line"
          busy={fetching}
          plain
        >
          {fetching ? (
            <>
              <progress className="download" max={download.total} value={download.received} aria-label={`Downloading the ${fetched?.label} model`} />
              <button className="ghost" onClick={() => void bridge.invoke('speech:cancel')} data-testid="speech-cancel">
                Cancel
              </button>
            </>
          ) : model.installed ? (
            <button className="ghost" onClick={() => void bridge.invoke('speech:remove', model.name).then(setStatus)} data-testid="speech-remove">
              Remove
            </button>
          ) : (
            <button className="primary" onClick={() => void bridge.invoke('speech:download', model.name).then(setStatus)} data-testid="speech-download">
              {failed ? 'Try again' : `Download (${megabytes(model.bytes)})`}
            </button>
          )}
        </ToolLine>
      )}
      <Row label="Language" hint="What is spoken in your takes. Auto finds out by itself.">
        <Segmented<SpeechLanguage>
          value={view?.speech.language}
          options={[
            ['auto', 'Auto'],
            ['de', 'Deutsch'],
            ['en', 'English'],
          ]}
          onChange={(speechLanguage) => change({ speechLanguage })}
          label="Language"
          testid="speech-language"
        />
      </Row>
      <Row
        label="Live captions while recording"
        hint={
          status && !status.models.some((entry) => entry.installed)
            ? 'The HUD shows what the mic hears as you speak. It needs a speech model: download one above.'
            : 'The HUD shows what the mic hears as you speak, with the fastest model downloaded. Nothing of it is saved.'
        }
      >
        <button
          className="toggle"
          role="switch"
          aria-checked={view?.speech.live ?? false}
          aria-label="Live captions while recording"
          disabled={!view}
          onClick={() => view && change({ speechLive: !view.speech.live })}
          data-testid="speech-live"
        >
          <i />
        </button>
      </Row>
    </>
  );
}

/** ffmpeg: found (its version and where), or how to install it and look again. */
function FfmpegLine({ tools, setTools }: { tools: ToolsStatus | undefined; setTools: (tools: ToolsStatus) => void }) {
  const [looking, setLooking] = useState(false);
  const check = async () => {
    setLooking(true);
    try {
      setTools(await bridge.invoke('tools:check'));
    } finally {
      setLooking(false);
    }
  };
  return (
    <ToolLine
      state={tools === undefined ? 'unknown' : tools.ffmpeg ? 'ok' : 'warn'}
      name={tools?.ffmpeg ? `ffmpeg ${shortVersion(tools.ffmpeg.version)}` : 'ffmpeg'}
      detail={tools?.ffmpeg ? shortPath(tools.ffmpeg.path) : 'Cuttle records and exports with it. Install it in a terminal, then check again.'}
      title={tools?.ffmpeg?.path}
      testid="tool-ffmpeg"
    >
      {tools && !tools.ffmpeg && (
        <>
          <Winget />
          <button className="ghost" onClick={() => void check()} disabled={looking} data-testid="check-again">
            {looking ? 'Looking…' : 'Check again'}
          </button>
        </>
      )}
    </ToolLine>
  );
}

/** The cuttle command and the skill: what is there, and Install (or Update, after the app moved). */
function ClaudeTools({ tools, setTools, welcome }: { tools: ToolsStatus | undefined; setTools: (tools: ToolsStatus) => void; welcome?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  const install = async () => {
    setBusy(true);
    setFailure(undefined);
    try {
      setTools(await bridge.invoke('tools:install'));
    } catch (error) {
      setFailure(firstLine(error));
    } finally {
      setBusy(false);
    }
  };
  const check = async () => setTools(await bridge.invoke('tools:check'));
  const problems = tools?.problems;
  const missing = tools !== undefined && (!tools.command || tools.skill.state === 'missing');
  const moved = !welcome && tools?.command?.moved === true;
  const command = tools?.command;
  const skill = tools?.skill;
  return (
    <>
      <ToolLine
        state={tools === undefined ? 'unknown' : problems?.command ? 'failed' : command ? 'ok' : 'off'}
        name="The cuttle command"
        detail={problems?.command ?? (command ? shortPath(command.path) : tools?.pathLine ? `Its folder is not on your PATH yet. Add this line to your shell profile: ${tools.pathLine}` : 'Claude Code runs it to record, cut and render.')}
        title={command?.path}
        testid="tool-command"
      />
      <ToolLine
        state={tools === undefined ? 'unknown' : problems?.skill ? 'failed' : skill?.state === 'installed' ? 'ok' : skill?.state === 'other' ? 'warn' : 'off'}
        name="The Claude skill"
        detail={
          problems?.skill ??
          (skill?.state === 'other'
            ? `${shortPath(skill.dir)} has a cuttle skill from somewhere else. Cuttle leaves it alone. To use Cuttle's, move or rename that folder, then check again.`
            : skill?.state === 'installed'
              ? shortPath(skill.dir)
              : 'Tells Claude Code how to make a demo with Cuttle.')
        }
        title={skill?.dir}
        testid="tool-skill"
      >
        {skill?.state === 'other' && (
          <>
            <button className="ghost" onClick={() => void bridge.invoke('tools:reveal')}>
              Show the folder
            </button>
            <button className="ghost" onClick={() => void check()}>
              Check again
            </button>
          </>
        )}
      </ToolLine>
      <div className="tools-actions">
        <span className={`row-hint${failure ? ' error-inline' : ''}`} role={failure ? 'alert' : undefined} data-testid="tools-note">
          {failure ??
            (tools?.newTerminal
              ? 'Start Claude Code again in a new terminal: one opened before does not know the cuttle command or the skill yet.'
              : moved
                ? 'Cuttle moved: update the cuttle command so it runs this copy.'
                : 'Lets Claude Code record and cut with Cuttle.')}
        </span>
        {(missing || moved || problems) && (
          <button className="primary" onClick={() => void install()} disabled={busy} data-testid="install-tools">
            {busy ? 'Installing…' : problems ? 'Try again' : moved && !missing ? 'Update' : 'Install both'}
          </button>
        )}
      </div>
    </>
  );
}

type ToolState = 'unknown' | 'ok' | 'off' | 'warn' | 'failed';

/** A tool or a model: a mark, its name, and a line on it (a path, in monospace, once it is there; `plain`: words). */
function ToolLine({ state, name, detail, title, testid, busy, plain, children }: { state: ToolState; name: string; detail: string; title?: string; testid: string; busy?: boolean; plain?: boolean; children?: ReactNode }) {
  return (
    <div className="tool" data-state={state === 'ok' ? 'ok' : state === 'unknown' ? 'unknown' : 'missing'} data-testid={testid}>
      <span className={`tool-mark ${state}`} aria-hidden>
        {state === 'ok' ? <CheckIcon size={12} /> : state === 'warn' || state === 'failed' ? <WarningIcon size={12} /> : null}
      </span>
      <div className="tool-text">
        <div className="row-label">{name}</div>
        <div className={`row-hint${state === 'ok' && !plain ? ' path-text' : ''}${state === 'failed' ? ' error-inline' : ''}`} title={title ?? detail} role={state === 'failed' ? 'alert' : undefined}>
          {state === 'unknown' && !busy ? 'Looking…' : detail}
        </div>
        {children && <div className="tool-extra">{children}</div>}
      </div>
    </div>
  );
}

/** "today at 14:05", or the date. */
function when(ms: number): string {
  const at = new Date(ms);
  const time = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return at.toDateString() === new Date().toDateString() ? `today at ${time}` : `${at.toLocaleDateString()} at ${time}`;
}

/**
 * Updates from GitHub's releases: this version, what the last check found, the download, Restart
 * and update; and whether Cuttle looks by itself once a day.
 */
function Updates({ view, change }: { view: SettingsView | undefined; change: (next: RequestArgument<'settings:set'>) => void }) {
  const [status, setStatus] = useState<UpdateStatus>();
  const [problem, setProblem] = useState<string>();
  useEffect(() => {
    void bridge.invoke('updates:status').then(setStatus);
    return bridge.on('updates:status', setStatus);
  }, []);
  const version = status?.version ?? view?.version ?? '';
  const download = status?.download;
  const percent = download && download.total > 0 ? Math.floor((download.received / download.total) * 100) : 0;
  const checked = status?.checked !== undefined ? ` Looked ${when(status.checked)}.` : '';
  const detail = !status
    ? 'Looking…'
    : !status.supported
      ? 'Run from the repository: update it with git pull.'
      : status.state === 'checking'
        ? 'Looking for a new version…'
        : status.state === 'current'
          ? `This is the newest version.${checked}`
          : status.state === 'available'
            ? `Version ${status.next} is out.`
            : status.state === 'downloading'
              ? `Downloading version ${status.next}…${download ? ` ${percent} %` : ''}`
              : status.state === 'ready'
                ? `Version ${status.next} is downloaded. It is installed when Cuttle quits, or now.`
                : status.state === 'failed'
                  ? status.next !== undefined
                    ? `Downloading version ${status.next} failed: ${status.failure}`
                    : `Cuttle could not look for a new version: ${status.failure}`
                  : 'Not looked for a new version yet.';
  const look = () => {
    setProblem(undefined);
    void bridge.invoke('updates:check').then(setStatus);
  };
  return (
    <>
      <ToolLine
        state={!status ? 'unknown' : status.state === 'failed' ? 'failed' : status.state === 'current' || status.state === 'ready' ? 'ok' : 'off'}
        name={`Cuttle ${version}`}
        detail={problem ?? detail}
        testid="updates-line"
        busy={status?.state === 'checking' || status?.state === 'downloading'}
        plain
      >
        {status?.supported &&
          (status.state === 'downloading' ? (
            download && <progress className="download" max={download.total} value={download.received} aria-label={`Downloading version ${status.next}`} />
          ) : status.state === 'ready' ? (
            <button
              className="primary"
              onClick={() => void bridge.invoke('updates:install').then((answer) => setProblem(answer.problem))}
              data-testid="updates-install"
            >
              Restart and update
            </button>
          ) : status.state === 'available' ? (
            <button className="primary" onClick={() => void bridge.invoke('updates:download').then(setStatus)} data-testid="updates-download">
              Download version {status.next}
            </button>
          ) : (
            <>
              <button className="ghost" onClick={look} disabled={status.state === 'checking'} data-testid="updates-check">
                {status.state === 'failed' ? 'Try again' : 'Check now'}
              </button>
              {status.state === 'failed' && (
                <button className="ghost" onClick={() => void bridge.invoke('updates:releases')} data-testid="updates-releases">
                  Download page
                </button>
              )}
            </>
          ))}
      </ToolLine>
      <Row label="Check for updates" hint="Once a day Cuttle asks GitHub for a new version and downloads it; it is installed when Cuttle quits. Nothing about you or your recordings is sent.">
        <button
          className="toggle"
          role="switch"
          aria-checked={view?.updates ?? true}
          aria-label="Check for updates"
          disabled={!view || status?.supported === false}
          onClick={() => view && change({ updates: !view.updates })}
          data-testid="updates-auto"
        >
          <i />
        </button>
      </Row>
    </>
  );
}

/** The MCP server's entry for a client's settings: Windows starts the cuttle shim (a .cmd) through cmd. */
const MCP_CONFIG = JSON.stringify({ mcpServers: { cuttle: MAC ? { command: 'cuttle', args: ['mcp'] } : { command: 'cmd', args: ['/c', 'cuttle', 'mcp'] } } });

/** A text to copy (into a client's settings), with a button that says it was. */
function CopyText({ text, testid }: { text: string; testid: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="command"
      onClick={() => {
        void bridge.invoke('tools:copy', text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
      title="Copy, then paste it into the client's MCP settings"
      data-testid={testid}
    >
      <code>{text}</code>
      {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}

/** The command that installs ffmpeg, to copy into a terminal. */
function Winget() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="command"
      onClick={() => {
        void bridge.invoke('tools:copy', INSTALL_FFMPEG);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
      title="Copy, then paste it in a terminal"
      data-testid="copy-winget"
    >
      <code>{INSTALL_FFMPEG}</code>
      {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}

/** The recent projects: open, rename (its folder), show in the folder, take off the list. */
function Recent({ view }: { view: SettingsView | undefined }) {
  const [renaming, setRenaming] = useState<string>();
  const [problem, setProblem] = useState<{ dir: string; text: string }>();
  /** Where the focus goes once a rename or a removal ends: that row's Rename, or the next row. */
  const [focusAfter, setFocusAfter] = useState<{ dir: string; what: 'rename' | 'name' }>();
  const list = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    if (!focusAfter || renaming) return;
    const row = [...(list.current?.querySelectorAll<HTMLElement>('li') ?? [])].find((item) => item.dataset.dir === focusAfter.dir);
    (row?.querySelector<HTMLElement>(focusAfter.what === 'rename' ? '[data-testid=recent-rename]' : '.recent-name') ?? list.current?.querySelector<HTMLElement>('.recent-name'))?.focus();
    setFocusAfter(undefined);
  }, [focusAfter, renaming, view]);

  if (view && view.recent.length === 0) return <p className="empty">Projects you open or record show here.</p>;
  const parentOf = (dir: string) => dir.replace(/[\\/][^\\/]+$/, '');
  const inProjects = (dir: string) => view !== undefined && parentOf(dir).toLowerCase() === view.projectsFolder.replace(/[\\/]+$/, '').toLowerCase();
  const rename = async (dir: string, name: string) => {
    if (name === '') return setProblem({ dir, text: 'Type a name for the folder.' });
    try {
      const answer = await bridge.invoke('recent:rename', { dir, name });
      if ('problem' in answer) return setProblem({ dir, text: answer.problem });
      setProblem(undefined);
      setRenaming(undefined);
      setFocusAfter({ dir: answer.dir, what: 'rename' });
    } catch (error) {
      setProblem({ dir, text: firstLine(error) });
    }
  };
  return (
    <ul className="recent" data-testid="recent" ref={list}>
      {view?.recent.map((entry, index) => (
        <li key={entry.dir} data-dir={entry.dir}>
          {renaming === entry.dir ? (
            <RenameField
              initial={entry.name}
              onDone={(name) => {
                if (name === undefined || name === entry.name) {
                  setProblem(undefined);
                  setRenaming(undefined);
                  setFocusAfter({ dir: entry.dir, what: 'rename' });
                  return;
                }
                void rename(entry.dir, name);
              }}
            />
          ) : (
            <button className="recent-name" onClick={() => void bridge.invoke('recent:open', entry.dir)} title={`Open ${entry.dir}`}>
              <b>{entry.name}</b>
              <span className="path-text">{inProjects(entry.dir) ? ago(entry.opened) : shortPath(parentOf(entry.dir))}</span>
            </button>
          )}
          {renaming !== entry.dir && (
            <span className="recent-actions">
              <button
                onClick={() => {
                  setProblem(undefined);
                  setRenaming(entry.dir);
                }}
                disabled={entry.open !== undefined}
                title={entry.open === 'here' ? 'Close its editor to rename it' : entry.open ? `Open in Cuttle on ${entry.open}` : 'Rename the project’s folder'}
                data-testid="recent-rename"
              >
                Rename
              </button>
              <button className="icon" onClick={() => void bridge.invoke('recent:reveal', entry.dir)} title="Show in its folder" aria-label="Show in its folder">
                <FolderIcon size={14} />
              </button>
              <button
                className="icon"
                onClick={() => {
                  const next = view.recent[index + 1] ?? view.recent[index - 1];
                  void bridge.invoke('recent:forget', entry.dir).then(() => next && setFocusAfter({ dir: next.dir, what: 'name' }));
                }}
                title="Remove from the list (the folder stays)"
                aria-label="Remove from the list (the folder stays)"
                data-testid="recent-forget"
              >
                <CloseIcon size={12} />
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
  const ended = useRef(false);
  useEffect(() => input.current?.select(), []);
  const end = (name: string | undefined) => {
    if (ended.current && name !== undefined) return;
    ended.current = name !== undefined;
    onDone(name);
  };
  return (
    <input
      ref={input}
      className="rename"
      defaultValue={initial}
      aria-label="Project name"
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          ended.current = false;
          end(event.currentTarget.value.trim());
        }
        if (event.key === 'Escape') {
          // Esc ends the rename, not the window
          event.preventDefault();
          event.stopPropagation();
          ended.current = true;
          onDone(undefined);
        }
      }}
      onBlur={(event) => {
        if (!ended.current) end(event.currentTarget.value.trim());
      }}
      data-testid="rename-input"
    />
  );
}

/** The first run: what recording needs, what Claude Code can use, then Done (the pill) or a first recording. */
function Welcome({ tools, setTools }: { tools: ToolsStatus | undefined; setTools: (tools: ToolsStatus) => void }) {
  // one accent: Install while Claude Code's part is missing, Start recording once all is there
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
      <Section title="To record">
        <FfmpegLine tools={tools} setTools={setTools} />
      </Section>
      <Section title="For Claude Code">
        <ClaudeTools tools={tools} setTools={setTools} welcome />
      </Section>
      <div className="welcome-foot">
        <span className="row-hint">
          Cuttle waits at the top of your screen and in the {TRAY}. <Keys keys="Ctrl+Shift+Alt+R" /> starts a recording from anywhere.
        </span>
        <button className="ghost" onClick={() => void bridge.invoke('settings:welcomed')} data-testid="welcome-done">
          Done
        </button>
        {ready && (
          <button className="primary record" onClick={() => void bridge.invoke('settings:welcomed', { record: true })} data-testid="welcome-record">
            <i />
            Start recording
          </button>
        )}
      </div>
    </div>
  );
}
