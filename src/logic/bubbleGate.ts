import { normalizeText } from '../data/curriculum';

export const BUBBLE_OFFLINE_PAUSE_MS = 1350;

export type BubbleGatePhase =
  | 'pick_bubble'
  | 'awaiting_syllable_speech'
  | 'audio_pause'
  | 'awaiting_word_speech'
  | 'offline_word_confirm'
  | 'completed';

export interface BubbleGateState {
  parts: string[];
  confirmedCount: number;
  phase: BubbleGatePhase;
  activePart: string | null;
  pauseStartedAtMs: number;
  speechFailuresInStep: number;
  wrongBubbleTaps: number;
  wrongPictureTaps: number;
}

export type BubbleTapResult =
  | 'locked_ignored'
  | 'wrong'
  | 'accepted_need_speech'
  | 'accepted_offline_pause';

export function createBubbleGateState(parts: string[]): BubbleGateState {
  return {
    parts: [...parts],
    confirmedCount: 0,
    phase: 'pick_bubble',
    activePart: null,
    pauseStartedAtMs: 0,
    speechFailuresInStep: 0,
    wrongBubbleTaps: 0,
    wrongPictureTaps: 0,
  };
}

/**
 * Handle tapping a syllable bubble. Strictly rejects all taps whenever `phase !== 'pick_bubble'`
 * so rapid consecutive tapping cannot bypass spoken or audio-paused reading confirmation.
 */
export function tapSyllableBubble(
  state: BubbleGateState,
  tappedText: string,
  params: { isOfflineMode: boolean; nowMs: number },
): { state: BubbleGateState; result: BubbleTapResult } {
  if (state.phase !== 'pick_bubble') {
    return { state, result: 'locked_ignored' };
  }

  const expectedPart = state.parts[state.confirmedCount];
  if (!expectedPart || tappedText !== expectedPart) {
    return {
      state: {
        ...state,
        wrongBubbleTaps: state.wrongBubbleTaps + 1,
      },
      result: 'wrong',
    };
  }

  if (params.isOfflineMode) {
    return {
      state: {
        ...state,
        phase: 'audio_pause',
        activePart: expectedPart,
        pauseStartedAtMs: params.nowMs,
        speechFailuresInStep: 0,
      },
      result: 'accepted_offline_pause',
    };
  }

  return {
    state: {
      ...state,
      phase: 'awaiting_syllable_speech',
      activePart: expectedPart,
      speechFailuresInStep: 0,
    },
    result: 'accepted_need_speech',
  };
}

/**
 * Unlock the next bubble (or move to offline picture confirmation on the final part)
 * strictly after `BUBBLE_OFFLINE_PAUSE_MS` has elapsed.
 */
export function completeOfflineSyllablePause(
  state: BubbleGateState,
  nowMs: number,
  minPauseMs: number = BUBBLE_OFFLINE_PAUSE_MS,
): BubbleGateState {
  if (state.phase !== 'audio_pause') {
    return state;
  }
  if (nowMs - state.pauseStartedAtMs < minPauseMs) {
    return state;
  }

  const nextCount = state.confirmedCount + 1;
  const allPartsDone = nextCount >= state.parts.length;
  return {
    ...state,
    confirmedCount: nextCount,
    phase: allPartsDone ? 'offline_word_confirm' : 'pick_bubble',
    activePart: null,
    pauseStartedAtMs: 0,
    speechFailuresInStep: 0,
  };
}

/**
 * Advance online Voice AI bubble verification after a child speaks either the active
 * syllable (`awaiting_syllable_speech`) or the full assembled word (`awaiting_word_speech`).
 */
export function applyBubbleSpeechResult(
  state: BubbleGateState,
  accepted: boolean,
): BubbleGateState {
  if (state.phase === 'awaiting_syllable_speech') {
    if (!accepted) {
      return {
        ...state,
        speechFailuresInStep: state.speechFailuresInStep + 1,
      };
    }
    const nextCount = state.confirmedCount + 1;
    const allPartsDone = nextCount >= state.parts.length;
    return {
      ...state,
      confirmedCount: nextCount,
      phase: allPartsDone ? 'awaiting_word_speech' : 'pick_bubble',
      activePart: null,
      speechFailuresInStep: 0,
    };
  }

  if (state.phase === 'awaiting_word_speech') {
    if (!accepted) {
      return {
        ...state,
        speechFailuresInStep: state.speechFailuresInStep + 1,
      };
    }
    return {
      ...state,
      phase: 'completed',
      activePart: null,
      speechFailuresInStep: 0,
    };
  }

  return state;
}

/**
 * Require matching the assembled word to its picture before completing offline bubble mode.
 */
export function confirmOfflineBubblePicture(
  state: BubbleGateState,
  isCorrect: boolean,
): BubbleGateState {
  if (state.phase !== 'offline_word_confirm') {
    return state;
  }
  if (!isCorrect) {
    return {
      ...state,
      wrongPictureTaps: state.wrongPictureTaps + 1,
    };
  }
  return {
    ...state,
    phase: 'completed',
    activePart: null,
  };
}

/** Build child-friendly Uzbek STT aliases for an individual syllable chunk. */
export function buildSyllableAcceptAliases(syllable: string): string[] {
  const lower = (syllable || '').trim().toLowerCase();
  if (!lower) return [];
  const asciiApostrophe = lower.replace(/[‘’ʻʼ`´]/g, "'");
  const canonical = normalizeText(lower);
  const strippedApostrophe = asciiApostrophe.replace(/'/g, '');
  const variants = [lower, asciiApostrophe, canonical];
  if (strippedApostrophe.length >= 2 && strippedApostrophe !== asciiApostrophe) {
    variants.push(strippedApostrophe);
  }
  return Array.from(new Set(variants.filter((v) => v.length > 0)));
}
