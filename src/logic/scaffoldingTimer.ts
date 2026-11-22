import { READING_THRESHOLDS, type ReadingThresholds } from './pedagogy';

export interface ScaffoldingTimerState {
  examRenderTimeMs: number;
  accumulatedIdleMs: number;
  lastTickMs: number;
  pausedForSpeech: boolean;
  usedVisualSplit: boolean;
  usedAudioHint: boolean;
}

export function createScaffoldingState(nowMs: number): ScaffoldingTimerState {
  return {
    examRenderTimeMs: nowMs,
    accumulatedIdleMs: 0,
    lastTickMs: nowMs,
    pausedForSpeech: false,
    usedVisualSplit: false,
    usedAudioHint: false,
  };
}

/**
 * Synchronously freeze 4.5s and 8.0s scaffolding timers when speech starts
 * so post-speech silence windows (e.g. 1950 ms) never trigger false scaffolding penalties.
 */
export function pauseScaffoldingForSpeech(
  state: ScaffoldingTimerState,
  nowMs: number,
): ScaffoldingTimerState {
  if (state.pausedForSpeech) {
    return state;
  }
  const delta = Math.max(0, nowMs - state.lastTickMs);
  return {
    ...state,
    accumulatedIdleMs: state.accumulatedIdleMs + delta,
    lastTickMs: nowMs,
    pausedForSpeech: true,
  };
}

/**
 * Deadlock guard: resume scaffolding timers if a speech trigger turned out to be
 * ambient noise / silence / low-confidence STT.
 */
export function resumeScaffoldingAfterFalseStart(
  state: ScaffoldingTimerState,
  nowMs: number,
  thresholds: ReadingThresholds = READING_THRESHOLDS,
): ScaffoldingTimerState {
  return {
    ...state,
    lastTickMs: nowMs,
    pausedForSpeech: false,
    usedVisualSplit:
      state.usedVisualSplit || state.accumulatedIdleMs >= thresholds.visualSplitDelayMs,
    usedAudioHint:
      state.usedAudioHint || state.accumulatedIdleMs >= thresholds.audioHintDelayMs,
  };
}

export function markScaffoldingAudioHint(state: ScaffoldingTimerState): ScaffoldingTimerState {
  return {
    ...state,
    usedVisualSplit: true,
    usedAudioHint: true,
  };
}

/** Advance idle scaffolding clock when not speaking and unlock visual/audio hints at thresholds. */
export function tickScaffolding(
  state: ScaffoldingTimerState,
  nowMs: number,
  thresholds: ReadingThresholds = READING_THRESHOLDS,
): ScaffoldingTimerState {
  if (state.pausedForSpeech) {
    return {
      ...state,
      lastTickMs: nowMs,
    };
  }
  const delta = Math.max(0, nowMs - state.lastTickMs);
  const nextIdleMs = state.accumulatedIdleMs + delta;
  const hitAudio = state.usedAudioHint || nextIdleMs >= thresholds.audioHintDelayMs;
  const hitSplit = state.usedVisualSplit || hitAudio || nextIdleMs >= thresholds.visualSplitDelayMs;

  return {
    ...state,
    accumulatedIdleMs: nextIdleMs,
    lastTickMs: nowMs,
    usedVisualSplit: hitSplit,
    usedAudioHint: hitAudio,
  };
}

/** Compute reactionMs (render -> speech start) and articulationMs (speech start -> speech end). */
export function computeReadingDurations(params: {
  examRenderTimeMs: number;
  recordingStartWallMs: number;
  firstSpeechMs: number | null;
  lastSpeechMs: number | null;
  audioDurationMs: number;
}): { reactionMs: number; articulationMs: number } {
  const speechStartWallMs =
    params.firstSpeechMs !== null
      ? params.recordingStartWallMs + params.firstSpeechMs
      : params.recordingStartWallMs;
  const reactionMs = Math.max(0, Math.round(speechStartWallMs - params.examRenderTimeMs));

  const rawArticulationMs =
    params.firstSpeechMs !== null && params.lastSpeechMs !== null
      ? params.lastSpeechMs - params.firstSpeechMs
      : params.audioDurationMs;
  const articulationMs = Math.max(250, Math.round(rawArticulationMs));

  return { reactionMs, articulationMs };
}
