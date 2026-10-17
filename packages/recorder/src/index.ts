export { record, CLAUDE_TAIL_SECONDS } from './record';
export { listDevices } from './devices';
export { RecorderError, type RecorderErrorCode } from './errors';
export { HOTKEYS } from './input';
export { claudeTranscriptDir, readTranscriptLine, SessionReader, type ClaudeSignal } from './claude';
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
