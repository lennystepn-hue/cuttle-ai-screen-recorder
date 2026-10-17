// @cuttle/core: what the CLI and the app do to a project folder, in Node: read and write cuttle.json
// as written (with backups), point the project at a take, suggest scenes, recover a take, grab a
// frame, run ffmpeg, and transcribe the mic (the speech models, whisper, the speech edits).
export { CoreError, type CoreErrorCode } from './errors';
export { EDITOR_LOCK, editorLockOf, type EditorLock } from './editor-lock';
export { ffmpegPath, runFfmpeg } from './ffmpeg';
export { BACKUPS, PROJECT_FILE, backupFile, newProjectFile, projectExists, projectHash, readProjectFile, writeProjectFile, type ProjectFile, type WriteOptions, type WriteResult } from './project-file';
export { samePath, useTake, type TakeFiles } from './use-take';
export { suggestProject, type SuggestOptions, type SuggestResult } from './suggest';
export { recoverTake, type RecoverResult } from './recover';
export { GRID_STEP, grabFrame, gridFilter, type FrameOptions, type FrameResult } from './frame';
export { analyseScreen, grabGray, parseAnalysis, probeScreen, streamSeconds, type Gray, type ScreenAnalysis } from './suggest/media';
export { RULES, suggestClips, type SuggestInput, type SuggestedClip, type Suggestion } from './suggest/plan';
export { changedRegion, zoomRect } from './suggest/region';
export { gaps, length, union, type Span } from './suggest/spans';
export { transcriptMarkers } from './suggest/transcript';
export { DEFAULT_MODEL, MODEL_NAMES, SPEECH_MODELS, chooseModel, downloadFile, downloadModel, installedModels, modelInstalled, modelPath, modelUrl, modelsDir, removeModel, speechModel, type DownloadOptions, type ModelName, type SpeechModel } from './speech/models';
export { filterValue, hasWhisper, parseWhisperLines, runWhisper, type HeardWord, type WhisperOptions } from './speech/whisper';
export { LEVEL_SECONDS, SPEECH_RULES, micLevels, speechStretches } from './speech/levels';
export { ALIGN_RULES, alignWords, guessLanguage, type Alignment } from './speech/align';
export { SPEECH_EDIT_RULES, fillerCuts, fillerWords, inputSpans, mergeCuts, pauseCuts, restingAt, speechCuts, type RawCut, type SpeechCut, type SpeechEditInput } from './speech/edits';
export { TRANSCRIPT_FILE, micOffset, readTranscript, transcribeTake, transcriptOfMic, type TranscribeOptions, type TranscribeResult } from './speech/transcribe';
export { applySpeechEdits, speechActivity, withSpeechCuts, wordStretches, type SpeechCutsInput, type SpeechCutsResult, type SpeechEditsResult } from './speech/apply';
export { RETAKE_RULES, retakeCuts, spokenCues, type RetakeCut, type RetakeInput, type SpokenCue } from './speech/retakes';
export { CLEAN_MIC_FILE, cleanMic, cleanupFilter, denoiseLatency } from './speech/cleanup';
