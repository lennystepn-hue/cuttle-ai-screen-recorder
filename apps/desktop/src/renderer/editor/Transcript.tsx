// The Transcript tab: what the mic said, in paragraphs. The word being played is lit; a click goes
// there, a double click fixes its text (the subtitles follow), selected words are cut out of the
// video with Delete and come back with Restore; filler words are faint; Ctrl+F finds a word.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { likelyFiller, normWord, type CuttleProject, type TranscriptFile } from '@cuttle/project';
import { applyCaptionFixes, sceneSpans, type SceneSpan } from '@cuttle/timeline';
import type { Command } from '../../shared/document';
import { formatTime } from '../../shared/format';
import { outputTimesOf } from '../../shared/timeline-model';
import { bridge } from '../bridge';
import { edit } from './doc';
import { currentPlayer, store } from './session';
import { useStore } from './store';

/** Where a word is: shown at 1×, in a sped-up clip, taken out by a cut, or outside every clip. */
type WordState = 'shown' | 'fast' | 'cut' | 'out';

interface Word {
  t: number;
  end: number;
  text: string;
  state: WordState;
  filler: boolean;
  /** The text comes from a fix the person made. */
  fixed: boolean;
}

/** A gap this long (source seconds), or a sentence's end and half of it, starts a paragraph. */
const PARAGRAPH_GAP = 1.2;
/** Kept on both sides of words cut out, up to the words around them. */
const CUT_PAD = 0.05;

function wordsOf(transcript: TranscriptFile, project: CuttleProject): Word[] {
  const { fixes } = project.captions;
  return applyCaptionFixes(transcript.words, fixes).map((word) => {
    const clip = project.scenes.find((scene) => scene.type === 'clip' && word.t >= scene.from && word.t < scene.to);
    const cut = project.cuts.some((range) => range.enabled && word.t >= range.from && word.t < range.to);
    const state: WordState = !clip ? 'out' : cut ? 'cut' : clip.type === 'clip' && clip.speed > 1 ? 'fast' : 'shown';
    const fixed = fixes.some((fix) => fix.at === word.t && fix.end === word.end);
    return { ...word, state, filler: likelyFiller(word.text, transcript.language), fixed };
  });
}

function paragraphsOf(words: readonly Word[]): number[][] {
  const paragraphs: number[][] = [];
  words.forEach((word, i) => {
    const before = words[i - 1];
    const gap = before ? word.t - before.end : Infinity;
    if (!before || gap >= PARAGRAPH_GAP || (/[.!?…]["')\]]*$/.test(before.text) && gap >= PARAGRAPH_GAP / 2)) paragraphs.push([]);
    paragraphs.at(-1)!.push(i);
  });
  return paragraphs;
}

const TITLES: Record<WordState, string> = {
  shown: 'Click to go there, double-click to fix the word',
  fast: 'In a sped-up clip: it has no subtitle',
  cut: 'Cut from the video: select it and Restore',
  out: 'Outside every clip: lengthen a clip on the timeline to bring it back',
};

export function TranscriptPanel() {
  const project = useStore(store, (state) => state.doc?.project);
  const transcript = useStore(store, (state) => state.media?.transcript);
  const source = useStore(store, (state) => state.player.source);
  const findRequest = useStore(store, (state) => state.findRequest);
  const [selection, setSelection] = useState<{ anchor: number; focus: number }>();
  const [editing, setEditing] = useState<number>();
  const [query, setQuery] = useState('');
  const find = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const words = useMemo(() => (transcript && project ? wordsOf(transcript, project) : []), [transcript, project]);
  const paragraphs = useMemo(() => paragraphsOf(words), [words]);
  const spans = useMemo<SceneSpan[]>(() => (project ? sceneSpans(project.scenes, project.cuts) : []), [project]);

  useEffect(() => {
    if (findRequest === undefined) return;
    find.current?.focus();
    find.current?.select();
  }, [findRequest]);
  // the spoken word: the last one that started at the source second shown
  const spoken = source === undefined ? -1 : words.findLastIndex((word) => word.t <= source && source < word.end + 0.3);
  useEffect(() => {
    if (spoken >= 0) list.current?.querySelector(`[data-index="${spoken}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [spoken]);

  if (!project) return null;
  if (!transcript) return <SpeechNote />;
  if (words.length === 0) return <p className="hint">The mic was transcribed, but no words were heard.</p>;

  const [from, to] = selection ? [Math.min(selection.anchor, selection.focus), Math.max(selection.anchor, selection.focus)] : [-1, -2];
  const chosen = selection ? words.slice(from, to + 1) : [];
  const matches = query.trim() ? words.flatMap((word, i) => (normWord(word.text).includes(normWord(query)) ? [i] : [])) : [];
  const seekTo = (word: Word) => {
    const at = outputTimesOf(spans, word.t)[0];
    if (at !== undefined) void currentPlayer()?.seek(at);
  };
  const pick = (index: number, event: MouseEvent) => {
    setEditing(undefined);
    setSelection(event.shiftKey && selection ? { anchor: selection.anchor, focus: index } : { anchor: index, focus: index });
    if (!event.shiftKey) seekTo(words[index]!);
  };
  const quoted = (items: readonly Word[]) => {
    const text = items.map((word) => word.text).join(' ');
    return text.length > 40 ? `${text.slice(0, 39).trimEnd()}…` : text;
  };
  /** Cuts the selected words out of the video: one cut, padded up to the words around them. */
  const cutOut = () => {
    if (chosen.length === 0) return;
    const before = words[from - 1];
    const after = words[to + 1];
    const start = Math.max(before ? before.end : 0, chosen[0]!.t - CUT_PAD);
    const end = Math.min(after ? after.t : Infinity, chosen.at(-1)!.end + CUT_PAD);
    edit([{ type: 'add', list: 'cuts', item: { label: `Words: “${quoted(chosen)}”`, from: round(start), to: round(end) } }], 'Cut words');
  };
  /** Brings the selected words back: cuts made by hand over them go, automatic ones are switched off. */
  const restore = () => {
    const first = chosen[0];
    const last = chosen.at(-1);
    if (!first || !last) return;
    const over = project.cuts.filter((cut) => cut.enabled && cut.id && cut.from < last.end && first.t < cut.to);
    const commands: Command[] = over.map((cut) => (cut.auto ? { type: 'set', list: 'cuts', id: cut.id!, fields: { enabled: false } } : { type: 'delete', list: 'cuts', id: cut.id! }));
    if (commands.length > 0) edit(commands, 'Restore words');
  };
  const fix = (index: number, text: string) => {
    const word = words[index]!;
    setEditing(undefined);
    if (text.trim() === word.text) return;
    edit([{ type: 'caption-fix', at: word.t, end: word.end, text: text.trim() }], `Fix “${quoted([word])}”`);
  };
  const unfix = (word: Word) => edit([{ type: 'caption-fix', at: word.t, end: word.end, text: undefined }], `Unfix “${quoted([word])}”`);
  const canCut = chosen.length > 0 && chosen.some((word) => word.state === 'shown' || word.state === 'fast');
  const canRestore = chosen.some((word) => word.state === 'cut');
  const onKey = (event: KeyboardEvent) => {
    if (editing !== undefined || chosen.length === 0) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      // the words, not the timeline's selection
      event.preventDefault();
      event.stopPropagation();
      if (canCut) cutOut();
      else if (canRestore) restore();
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      setSelection(undefined);
    } else if (event.key === 'Enter' && chosen.length === 1) {
      event.preventDefault();
      setEditing(from);
    }
  };
  const next = (step: 1 | -1) => {
    if (matches.length === 0) return;
    const current = selection ? from : -1;
    const index = step === 1 ? (matches.find((i) => i > current) ?? matches[0]!) : (matches.findLast((i) => i < current) ?? matches.at(-1)!);
    setSelection({ anchor: index, focus: index });
    seekTo(words[index]!);
    list.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'center' });
  };

  return (
    <div className="transcript" data-testid="transcript">
      <div className="transcript-find">
        <input
          ref={find}
          type="search"
          value={query}
          placeholder="Find a word (Ctrl+F)"
          aria-label="Find a word"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              next(event.shiftKey ? -1 : 1);
            } else if (event.key === 'Escape') {
              event.stopPropagation();
              setQuery('');
              event.currentTarget.blur();
            }
          }}
          data-testid="transcript-find"
        />
        {query.trim() && <span className="transcript-count">{matches.length === 0 ? 'none' : `${matches.length} found`}</span>}
      </div>
      <p className="hint transcript-meta">
        {words.length} words · {transcript.language === 'auto' ? 'language not told' : transcript.language === 'de' ? 'German' : transcript.language === 'en' ? 'English' : transcript.language} · {transcript.model} model
      </p>
      <div className="transcript-words" ref={list} tabIndex={0} onKeyDown={onKey} role="listbox" aria-multiselectable="true" aria-label="Transcript">
        {paragraphs.map((paragraph) => (
          <p key={paragraph[0]}>
            <span className="transcript-time">{formatTime(outputTimesOf(spans, words[paragraph[0]!]!.t)[0] ?? words[paragraph[0]!]!.t)}</span>
            {paragraph.map((index) => {
              const word = words[index]!;
              if (editing === index) {
                return <WordField key={index} initial={word.text} onDone={(text) => (text === undefined ? setEditing(undefined) : fix(index, text))} />;
              }
              const classes = [
                'word',
                word.state,
                word.filler && 'filler',
                word.fixed && 'fixed',
                index === spoken && 'spoken',
                index >= from && index <= to && 'selected',
                matches.includes(index) && 'match',
              ].filter(Boolean);
              return (
                <span
                  key={index}
                  data-index={index}
                  role="option"
                  aria-selected={index >= from && index <= to}
                  className={classes.join(' ')}
                  title={word.fixed ? `Fixed; heard as said in the take. ${TITLES[word.state]}` : TITLES[word.state]}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={(event) => {
                    list.current?.focus();
                    pick(index, event);
                  }}
                  onDoubleClick={() => word.state !== 'out' && setEditing(index)}
                >
                  {word.text || '·'}{' '}
                </span>
              );
            })}
          </p>
        ))}
      </div>
      {chosen.length > 0 && (
        <div className="transcript-actions" data-testid="transcript-actions">
          <span className="hint">
            {chosen.length === 1 ? `“${quoted(chosen)}”` : `${chosen.length} words`} · {formatTime(chosen[0]!.t)}
          </span>
          {canCut && (
            <button type="button" className="ghost small" onClick={cutOut} data-testid="transcript-cut">
              Cut out
            </button>
          )}
          {canRestore && (
            <button type="button" className="ghost small" onClick={restore} data-testid="transcript-restore">
              Restore
            </button>
          )}
          {chosen.length === 1 && chosen[0]!.fixed && (
            <button type="button" className="ghost small" onClick={() => unfix(chosen[0]!)} data-testid="transcript-unfix">
              Undo fix
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const round = (seconds: number) => Math.round(seconds * 1000) / 1000;

/** The text of a word being fixed: Enter keeps it, Esc goes back. */
function WordField({ initial, onDone }: { initial: string; onDone: (text: string | undefined) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const ended = useRef(false);
  useEffect(() => input.current?.select(), []);
  const end = (text: string | undefined) => {
    if (ended.current) return;
    ended.current = true;
    onDone(text);
  };
  return (
    <input
      ref={input}
      className="word-field"
      defaultValue={initial}
      aria-label="The word's text"
      size={Math.max(4, initial.length + 1)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') end(event.currentTarget.value);
        if (event.key === 'Escape') end(undefined);
      }}
      onBlur={(event) => end(event.currentTarget.value)}
      data-testid="word-field"
    />
  );
}

/**
 * A take whose mic is not transcribed: what transcribing adds, and Transcribe. When it cannot run
 * (speech off, no model, an old ffmpeg), why, with the way to the settings.
 */
export function SpeechNote() {
  const sources = useStore(store, (state) => state.doc?.project.sources);
  const working = useStore(store, (state) => state.status?.state === 'working');
  const [problem, setProblem] = useState<{ text: string; settings?: boolean }>();
  if (!sources?.mic || sources.transcript) return null;
  const transcribe = async () => {
    const answer = await bridge.invoke('project:transcribe');
    setProblem('problem' in answer ? { text: answer.problem, ...(answer.settings && { settings: true }) } : undefined);
  };
  return (
    <div className="speech-note" data-testid="speech-note">
      <p>
        <b>The mic is not transcribed.</b> Once it is, Cuttle cuts filler words and pauses where the picture rests, and the video gets subtitles.
      </p>
      {problem && (
        <p className="speech-problem" role="alert" data-testid="speech-problem">
          {problem.text}
        </p>
      )}
      <div className="speech-actions">
        <button type="button" className="ghost small" disabled={working} onClick={() => void transcribe()} data-testid="transcribe">
          {working ? 'Busy…' : 'Transcribe'}
        </button>
        {problem?.settings && (
          <button type="button" className="ghost small" onClick={() => void bridge.invoke('app:settings')} data-testid="speech-settings">
            Settings
          </button>
        )}
      </div>
    </div>
  );
}
