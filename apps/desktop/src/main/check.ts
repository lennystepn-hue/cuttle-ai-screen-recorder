// The end-to-end check's switches. Each acts only with --cuttle-check on the command line as well, so
// a stray environment variable cannot hide a real app or make it record test patterns.

export const CHECK = process.argv.includes('--cuttle-check');

/** Windows are never shown and dialogs become log lines (CUTTLE_HIDDEN=1). */
export const HIDDEN = CHECK && process.env.CUTTLE_HIDDEN === '1';

/** The recorder's `test` backend (ffmpeg test sources, synthetic input) instead of this machine (CUTTLE_RECORDER_BACKEND=test). */
export const TEST_BACKEND = CHECK && process.env.CUTTLE_RECORDER_BACKEND === 'test';

/** The countdown's seconds instead of the setting's (CUTTLE_COUNTDOWN=0 skips it). */
export const COUNTDOWN = CHECK && process.env.CUTTLE_COUNTDOWN !== undefined ? Number(process.env.CUTTLE_COUNTDOWN) : undefined;
