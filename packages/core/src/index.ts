// @cuttle/core: what the CLI and the app do to a project folder, in Node: read and write cuttle.json
// as written (with backups), point the project at a take, import a video as a take, suggest scenes,
// recover a take, grab a frame, run ffmpeg, transcribe the mic (the speech models, whisper, live
// captions, the speech edits), keep brand kits, and read a product's colours and the desktop's
// wallpaper for a background.
export { CoreError, type CoreErrorCode } from './errors';
export { EDITOR_LOCK, editorLockOf, type EditorLock } from './editor-lock';
export { ffmpegPath, runFfmpeg } from './ffmpeg';
export { BACKUPS, PROJECT_FILE, PROJECT_GITIGNORE, backupFile, newProjectFile, projectExists, projectHash, readProjectFile, writeProjectFile, type ProjectFile, type WriteOptions, type WriteResult } from './project-file';
export { samePath, useTake, type TakeFiles } from './use-take';
export { suggestProject, type SuggestOptions, type SuggestResult } from './suggest';
export { recoverTake, type RecoverResult } from './recover';
export { IMPORT_RULES, importTake, type ImportOptions, type ImportResult } from './import';
export { GRID_STEP, grabFrame, gridFilter, type FrameOptions, type FrameResult } from './frame';
export { ANALYSIS_DIR, analyseScreen, cachedAnalysis, grabGray, parseAnalysis, probeScreen, streamSeconds, type Gray, type ScreenAnalysis } from './suggest/media';
export { applyLengthFit, withLengthFit, withoutLengthFit, type LengthApplied, type LengthFitResult, type LengthInput } from './suggest/length';
export { RULES, suggestClips, type SuggestInput, type SuggestedClip, type Suggestion } from './suggest/plan';
export { changedRegion, zoomRect } from './suggest/region';
export { gaps, length, union, type Span } from './suggest/spans';
export { transcriptMarkers } from './suggest/transcript';
export { DEFAULT_MODEL, MODEL_NAMES, SPEECH_MODELS, chooseModel, downloadFile, downloadModel, installedModels, modelInstalled, modelPath, modelUrl, modelsDir, removeModel, speechModel, type DownloadOptions, type ModelName, type SpeechModel } from './speech/models';
export { filterValue, hasWhisper, NO_WHISPER, parseWhisperCliJson, parseWhisperLines, runWhisper, whisperCliPath, whisperEngine, type HeardWord, type WhisperEngine, type WhisperOptions } from './speech/whisper';
export { LIVE_RATE, LIVE_RULES, liveCaptions, liveModel, quietestCut, withoutEchoes, type LiveCaptions, type LiveMode, type LiveOptions } from './speech/live';
export { LEVEL_SECONDS, SPEECH_RULES, micLevels, speechStretches } from './speech/levels';
export { ALIGN_RULES, alignWords, guessLanguage, type Alignment } from './speech/align';
export { SPEECH_EDIT_RULES, fillerCuts, fillerWords, inputSpans, mergeCuts, pauseCuts, restingAt, speechCuts, type RawCut, type SpeechCut, type SpeechEditInput } from './speech/edits';
export { TRANSCRIPT_FILE, micOffset, readTranscript, transcribeTake, transcriptOfMic, type TranscribeOptions, type TranscribeResult } from './speech/transcribe';
export { applySpeechEdits, speechActivity, withSpeechCuts, wordStretches, type SpeechCutsInput, type SpeechCutsResult, type SpeechEditsResult } from './speech/apply';
export { RETAKE_RULES, retakeCuts, spokenCues, type RetakeCut, type RetakeInput, type SpokenCue } from './speech/retakes';
export { TYPING_RULES, keyBursts, screenStretches, typingZooms, type Burst, type ScreenChange, type TypingInput, type TypingZoom } from './suggest/typing';
export { CROP_RULES, areaStretches, bandCrop, cropOf, cropPieces, type CropStretch, type ScreenBands } from './suggest/crop';
export { DIALOG_RULES, dialogZooms, type DialogZoom } from './suggest/dialogs';
export { MARK, RANDOM_RULES, SECRET_KINDS, SECRET_LABELS, SPECIFIC, findSecrets, isMark, lineSecrets, randomLooking, secretWords, type Secret, type SecretKind } from './privacy/patterns';
export { redactFrames } from './privacy/redact';
export { MASK_RULES, privacyMasks, type PrivacyMask } from './privacy/masks';
export { FOLLOW_RULES, followTracks, type Place, type Stretch } from './privacy/follow';
export { OCR_TIMEOUT, ScreenReader } from './privacy/ocr';
export { READ_RULES, SCREEN_TEXT_FILE, framesToRead, readFrames, writeScreenText } from './privacy/read';
export { applyPrivacy, followScreenText, readScreenTake, readScreenText, withPrivacyMasks, type PrivacyInput, type PrivacyMasksResult, type PrivacyResult, type RawMask } from './privacy/apply';
export { NOTIFICATION_RULES, notificationMasks, type NotificationMask } from './privacy/notifications';
export { CLEAN_MIC_FILE, cleanMic, cleanupFilter, denoiseLatency } from './speech/cleanup';
export { BRAND_FILE, PROJECT_BRAND_DIR, applyBrand, brandFields, brandSlug, brandsDir, findBrand, listBrands, removeBrand, saveBrand, type Brand, type BrandFields } from './brands';
export { keepInProject } from './keep-file';
export { PALETTE_RULES, imagePalette, paletteOf, takePalette } from './palette';
export { importWallpaper, wallpaperFile } from './wallpaper';
export { newShotFolder } from './shots';
export { parseRegWallpaper } from './wallpaper-win32';
export { DEFAULT_VOICE, LOCAL_VOICES, downloadVoice, localVoice, removeVoice, untar, voiceDir, voiceFiles, voiceInstalled, voiceUrl, type LocalVoice } from './voice/voices';
export { ELEVENLABS_MODEL, elevenLabsKey, elevenLabsVoices, speakElevenLabs, wordsFromCharacters } from './voice/elevenlabs';
export { speakLocal } from './voice/local';
export { spokenWords, spreadWords } from './voice/words';
export { VOICE_RATE, readRender, renderVoiceover, type RenderedLine, type VoiceoverOptions } from './voice/render';
