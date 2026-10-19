export { record, allocateTake, CLAUDE_BACKGROUND_SECONDS, CLAUDE_TAIL_SECONDS } from './record';
export { VIDEO_CHAIN } from './args';
export { joinSegments } from './join';
export { listDevices } from './devices';
export { RecorderError, type RecorderErrorCode } from './errors';
export { HOTKEYS } from './input';
export { LEVEL_FLOOR, PCM_RATE, levelMeter, wholeSamples, type MicLevel } from './level';
export { claudeTranscriptDir, isMarkerSignal, readTranscriptLine, recentClaudeFolders, SessionReader, type ClaudeFolder, type ClaudeSignal, type MarkerSignal } from './claude';
export { focusWindow } from './devices';
/** macOS's helper (native/macos/capture.swift), which also reads pictures' text (`cuttle-capture ocr`). */
export { captureHelper } from './mac-capture';
export type {
  Backend,
  Bounds,
  CaptureSource,
  Devices,
  Monitor,
  RecordOptions,
  RecorderEvent,
  Recording,
  StopOptions,
  StopReason,
  Take,
  WindowInfo,
} from './types';
