/**
 * Pure adaptive microphone auto-stop state machine.
 * Calibrates ambient room noise during the initial calibration window, then stops
 * automatically on post-speech silence, initial no-speech timeout, or max duration.
 */

export const MIC_AUTO_STOP_CONFIG = {
  calibrationMs: 300,
  silenceAfterSpeechMs: 1350,
  noSpeechTimeoutMs: 5000,
  maxDurationMs: 7000,
  minSpeechThreshold: 0.012,
  maxSpeechThreshold: 0.25,
  noiseMultiplier: 3.0,
} as const;

export type MicAutoStopConfig = {
  readonly calibrationMs: number;
  readonly silenceAfterSpeechMs: number;
  readonly noSpeechTimeoutMs: number;
  readonly maxDurationMs: number;
  readonly minSpeechThreshold: number;
  readonly maxSpeechThreshold: number;
  readonly noiseMultiplier: number;
};

/**
 * Extended silence patience for 1st-grade children spelling out syllables
 * aloud (e.g., "k... i... ki... t... o... b... tob... kitob").
 */
export const SPELLING_FRIENDLY_MIC_CONFIG: MicAutoStopConfig = {
  calibrationMs: 300,
  silenceAfterSpeechMs: 1950,
  noSpeechTimeoutMs: 6000,
  maxDurationMs: 10000,
  minSpeechThreshold: 0.012,
  maxSpeechThreshold: 0.25,
  noiseMultiplier: 3.0,
};

/**
 * Extended multi-word reading patience for 2–4 word sentences in World 5
 * so a 1st-grader is never cut off between words.
 */
export const SENTENCE_FRIENDLY_MIC_CONFIG: MicAutoStopConfig = {
  calibrationMs: 300,
  silenceAfterSpeechMs: 2200,
  noSpeechTimeoutMs: 6500,
  maxDurationMs: 14000,
  minSpeechThreshold: 0.012,
  maxSpeechThreshold: 0.25,
  noiseMultiplier: 3.0,
};

export type MicAutoStopAction =
  | 'continue'
  | 'stop_silence_after_speech'
  | 'stop_no_speech'
  | 'stop_max_duration';

export interface MicAutoStopState {
  noiseSum: number;
  noiseCount: number;
  speechThreshold: number;
  speechStarted: boolean;
  firstSpeechMs: number | null;
  lastSpeechMs: number | null;
}

export function createMicAutoStopState(config: MicAutoStopConfig = MIC_AUTO_STOP_CONFIG): MicAutoStopState {
  return {
    noiseSum: 0,
    noiseCount: 0,
    speechThreshold: config.minSpeechThreshold,
    speechStarted: false,
    firstSpeechMs: null,
    lastSpeechMs: null,
  };
}

export function stepMicAutoStop(
  state: MicAutoStopState,
  frameRms: number,
  elapsedMs: number,
  config: MicAutoStopConfig = MIC_AUTO_STOP_CONFIG,
): { state: MicAutoStopState; action: MicAutoStopAction } {
  if (elapsedMs >= config.maxDurationMs) {
    return { state, action: 'stop_max_duration' };
  }

  if (elapsedMs < config.calibrationMs) {
    const noiseSum = state.noiseSum + frameRms;
    const noiseCount = state.noiseCount + 1;
    const noiseMean = noiseSum / noiseCount;
    const adaptedThreshold = Math.min(
      config.maxSpeechThreshold,
      Math.max(config.minSpeechThreshold, noiseMean * config.noiseMultiplier),
    );
    return {
      state: {
        ...state,
        noiseSum,
        noiseCount,
        speechThreshold: adaptedThreshold,
      },
      action: 'continue',
    };
  }

  if (frameRms >= state.speechThreshold) {
    return {
      state: {
        ...state,
        speechStarted: true,
        firstSpeechMs: state.firstSpeechMs ?? elapsedMs,
        lastSpeechMs: elapsedMs,
      },
      action: 'continue',
    };
  }

  if (state.speechStarted && state.lastSpeechMs !== null) {
    if (elapsedMs - state.lastSpeechMs >= config.silenceAfterSpeechMs) {
      return { state, action: 'stop_silence_after_speech' };
    }
    return { state, action: 'continue' };
  }

  if (elapsedMs >= config.noSpeechTimeoutMs) {
    return { state, action: 'stop_no_speech' };
  }

  return { state, action: 'continue' };
}
