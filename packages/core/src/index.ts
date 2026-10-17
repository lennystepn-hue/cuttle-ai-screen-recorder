// @cuttle/core: what the CLI and the app do to a project folder, in Node: read and write cuttle.json
// as written (with backups), point the project at a take, suggest scenes, recover a take, grab a
// frame, and run ffmpeg.
export { CoreError, type CoreErrorCode } from './errors';
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
