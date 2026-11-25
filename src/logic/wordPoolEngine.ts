import {
  ALIFBE_LETTERS_29,
  type AlifbeLetterInfo,
  type WordPoolItem,
} from '../data/curriculum';
import { hasExplicitVisualMapping, resolveVisualSrc } from '../data/wordVisuals';
import { fisherYatesShuffle, shuffleOptionsWithAntiStreak } from './optionShuffle';
import {
  matchesSpelledOrSyllabicTranscript,
  normalizeUzbek,
  type WordProgress,
} from './pedagogy';

export type ReadingGameMode = 'spotlight' | 'constructor' | 'bubbles';

const GAME_MODE_ROTATION: ReadingGameMode[] = ['spotlight', 'constructor', 'bubbles'];

/** Rotate interactive game modes across a 5-word round so the child stays engaged. */
export function getGameModeForRoundIndex(index: number, item?: WordPoolItem): ReadingGameMode {
  if (item && item.parts.length >= 3) {
    return index % 2 === 0 ? 'bubbles' : 'constructor';
  }
  return GAME_MODE_ROTATION[Math.abs(index) % GAME_MODE_ROTATION.length] ?? 'spotlight';
}

export interface SelectDynamicRoundParams {
  worldId: number;
  pool: WordPoolItem[];
  seenWordIds: string[];
  letterHintCounts: Record<string, number>;
  roundSize?: number;
}

export interface SelectDynamicRoundResult {
  items: WordPoolItem[];
  resetCycle: boolean;
}

function scoreItemByStrugglingLetters(
  item: WordPoolItem,
  letterHintCounts: Record<string, number>,
): number {
  let score = 0;
  for (const letter of item.letters) {
    const count = letterHintCounts[letter] ?? 0;
    if (count > 0) {
      score += count;
    }
  }
  return score;
}

/**
 * Select up to `roundSize` (default 5) items from `worldId` without repeating
 * already-seen words until all words in the world have been played.
 * Prioritizes unseen words containing letters the child recently tapped for help.
 */
export function selectDynamicRound(params: SelectDynamicRoundParams): SelectDynamicRoundResult {
  const roundSize = Math.max(1, params.roundSize ?? 5);
  const worldItems = params.pool.filter((item) => item.worldId === params.worldId);
  if (worldItems.length === 0) {
    return { items: [], resetCycle: false };
  }

  const seenSet = new Set(params.seenWordIds);
  const unseen = worldItems.filter((item) => !seenSet.has(item.id));
  const seenOrderIndex = new Map<string, number>();
  params.seenWordIds.forEach((id, idx) => seenOrderIndex.set(id, idx));

  const rankedUnseen = [...unseen].sort((a, b) => {
    const diff =
      scoreItemByStrugglingLetters(b, params.letterHintCounts) -
      scoreItemByStrugglingLetters(a, params.letterHintCounts);
    if (diff !== 0) return diff;
    return worldItems.indexOf(a) - worldItems.indexOf(b);
  });

  if (rankedUnseen.length >= roundSize) {
    return {
      items: rankedUnseen.slice(0, roundSize),
      resetCycle: false,
    };
  }

  // Fewer unseen items left than roundSize: take all unseen first, then least-recently-seen.
  const seenInWorld = worldItems
    .filter((item) => seenSet.has(item.id))
    .sort((a, b) => (seenOrderIndex.get(a.id) ?? 0) - (seenOrderIndex.get(b.id) ?? 0));

  const combined = [...rankedUnseen, ...seenInWorld].slice(0, Math.min(roundSize, worldItems.length));
  return {
    items: combined,
    resetCycle: true,
  };
}

export interface SpelledOrSpokenEvalResult {
  outcome: 'accepted' | 'silence' | 'try_again';
  matchedMode: 'fluent' | 'spelled_or_syllabic' | null;
  messageUz: string;
}

/**
 * Evaluate spoken speech allowing both fluent words and spelled-out child
 * decoding (e.g., "k i ki t o b tob kitob" or "ki tob" for KITOB).
 */
export function evaluateSpelledOrSpokenAttempt(params: {
  targetText: string;
  parts: string[];
  acceptAliases: string[];
  transcript: string;
  isSilence: boolean;
}): SpelledOrSpokenEvalResult {
  const normTranscript = normalizeUzbek(params.transcript);
  if (params.isSilence || !normTranscript) {
    return {
      outcome: 'silence',
      matchedMode: null,
      messageUz: 'Ovozing yaxshi eshitilmadi, mikrofonga yaqinroq ayt-chi!',
    };
  }

  const acceptedSet = new Set<string>();
  const normExpected = normalizeUzbek(params.targetText);
  if (normExpected) acceptedSet.add(normExpected);
  for (const alias of params.acceptAliases) {
    const normAlias = normalizeUzbek(alias);
    if (normAlias) acceptedSet.add(normAlias);
  }

  const match = matchesSpelledOrSyllabicTranscript(normTranscript, acceptedSet, params.parts);
  if (match.matched) {
    return {
      outcome: 'accepted',
      matchedMode: match.mode,
      messageUz:
        match.mode === 'spelled_or_syllabic'
          ? 'Barakalla! Bo‘g‘inlab to‘g‘ri o‘qiding!'
          : 'Ajoyib! Juda aniq va ravon aytding!',
    };
  }

  return {
    outcome: 'try_again',
    matchedMode: null,
    messageUz: 'Yaxshi harakat! Qani yana bir marta harakat qilib ko‘ramiz!',
  };
}

export type VoiceDialogPhase =
  | 'ask_what_is_it'
  | 'cheer_and_repeat'
  | 'completed_success'
  | 'motivational_assist';

export interface VoiceDialogState {
  phase: VoiceDialogPhase;
  attemptsInPhase: number;
  starsAwarded: number;
  characterMood: 'talking' | 'celebrating' | 'encouraging';
  promptUz: string;
  lastFeedbackUz: string | null;
  isFinished: boolean;
}

/**
 * Initialize the two-turn interactive voice dialog after the child finishes
 * building/matching the word in Stage 1.
 */
export function createInitialVoiceDialogState(item: WordPoolItem): VoiceDialogState {
  return {
    phase: 'ask_what_is_it',
    attemptsInPhase: 0,
    starsAwarded: 0,
    characterMood: 'talking',
    promptUz: item.questionPromptUz,
    lastFeedbackUz: null,
    isFinished: false,
  };
}

/**
 * Advance the two-turn interactive voice dialog ("Bu nima?" -> "Qaytaring!").
 * Never locks or punishes the child: 2 unsuccessful tries seamlessly switch to
 * warm motivational co-reading (`motivational_assist`) with effort stars.
 */
export function advanceVoiceDialogState(
  current: VoiceDialogState,
  item: WordPoolItem,
  transcript: string,
  isSilence: boolean,
): VoiceDialogState {
  if (current.isFinished) {
    return current;
  }

  const evalRes = evaluateSpelledOrSpokenAttempt({
    targetText: item.text,
    parts: item.parts,
    acceptAliases: item.accept,
    transcript,
    isSilence,
  });

  if (evalRes.outcome === 'accepted') {
    if (current.phase === 'ask_what_is_it') {
      return {
        phase: 'cheer_and_repeat',
        attemptsInPhase: 0,
        starsAwarded: 1,
        characterMood: 'celebrating',
        promptUz: item.repeatPromptUz,
        lastFeedbackUz:
          evalRes.matchedMode === 'spelled_or_syllabic'
            ? 'Yasha! Bo‘g‘inlab to‘g‘ri topding! Endi bir nafasda qaytar!'
            : 'Yasha! Juda to‘g‘ri! Endi quvnoq qilib yana bir bor qaytar!',
        isFinished: false,
      };
    }

    // Completed turn 2 ("cheer_and_repeat")
    return {
      phase: 'completed_success',
      attemptsInPhase: current.attemptsInPhase + 1,
      starsAwarded: 3,
      characterMood: 'celebrating',
      promptUz: `Barakalla! «${item.text}» so‘zini a’lo o‘qiding!`,
      lastFeedbackUz: evalRes.messageUz,
      isFinished: true,
    };
  }

  const nextAttempts = current.attemptsInPhase + 1;
  if (nextAttempts >= 2) {
    return {
      phase: 'motivational_assist',
      attemptsInPhase: nextAttempts,
      starsAwarded: 2,
      characterMood: 'encouraging',
      promptUz: item.motivationPromptUz,
      lastFeedbackUz: item.motivationPromptUz,
      isFinished: true,
    };
  }

  return {
    ...current,
    attemptsInPhase: nextAttempts,
    characterMood: 'encouraging',
    lastFeedbackUz:
      evalRes.outcome === 'silence'
        ? 'Ovozing eshitilmadi — qo‘rqmasdan balandroq aytib ko‘r-chi!'
        : 'Deyarli to‘g‘ri! Qani yana bir marta urinib ko‘r-chi, men senga ishonaman!',
  };
}

/** Allow a child to tap "Birga aytamiz" for warm guided practice without frustration. */
export function triggerMotivationalAssist(item: WordPoolItem): VoiceDialogState {
  return {
    phase: 'motivational_assist',
    attemptsInPhase: 1,
    starsAwarded: 2,
    characterMood: 'encouraging',
    promptUz: item.motivationPromptUz,
    lastFeedbackUz: item.motivationPromptUz,
    isFinished: true,
  };
}

export const DAILY_LIMIT_OPTIONS = [10, 15, 20] as const;
export const DEFAULT_DAILY_LIMIT_MINUTES = 15;

export function clampDailyLimitMinutes(minutes: number): 10 | 15 | 20 {
  if (minutes <= 10) return 10;
  if (minutes >= 20) return 20;
  return 15;
}

export interface ScreenTimeStatus {
  dailyLimitMinutes: number;
  practicedSeconds: number;
  remainingMinutes: number;
  progressPct: number;
  isLimitReached: boolean;
}

/**
 * Evaluate whether the child has reached today's healthy screen-time limit
 * so the character can gently go to sleep ("Telefonga bog'lanib qolmaslik").
 */
export function evaluateScreenTimeLimit(params: {
  dailyLimitMinutes: number;
  dailyPracticeDate: string;
  todayDateStr: string;
  todayPracticedSeconds: number;
}): ScreenTimeStatus {
  const limitMin = clampDailyLimitMinutes(params.dailyLimitMinutes);
  const limitSeconds = limitMin * 60;
  // Reset only when calendar date moves strictly forward (guards against clock-rollback bypass)
  const isNewForwardDay =
    params.dailyPracticeDate === '' || params.todayDateStr > params.dailyPracticeDate;
  const practicedSeconds = isNewForwardDay
    ? 0
    : Math.max(0, Math.round(params.todayPracticedSeconds));
  const remainingSeconds = Math.max(0, limitSeconds - practicedSeconds);
  const remainingMinutes = Math.ceil(remainingSeconds / 60);
  const progressPct = Math.min(100, Math.round((practicedSeconds / Math.max(1, limitSeconds)) * 100));

  return {
    dailyLimitMinutes: limitMin,
    practicedSeconds,
    remainingMinutes,
    progressPct,
    isLimitReached: practicedSeconds >= limitSeconds,
  };
}

/** Add elapsed seconds to today's counter, resetting only when the calendar date moves forward. */
export function addPracticedSeconds(params: {
  dailyPracticeDate: string;
  todayDateStr: string;
  todayPracticedSeconds: number;
  deltaSeconds: number;
}): { dailyPracticeDate: string; todayPracticedSeconds: number } {
  const safeDelta = Math.max(0, Math.round(params.deltaSeconds));
  const isNewForwardDay =
    params.dailyPracticeDate === '' || params.todayDateStr > params.dailyPracticeDate;
  const base = isNewForwardDay ? 0 : Math.max(0, Math.round(params.todayPracticedSeconds));
  const nextDate = isNewForwardDay ? params.todayDateStr : params.dailyPracticeDate;
  return {
    dailyPracticeDate: nextDate,
    todayPracticedSeconds: base + safeDelta,
  };
}

/** Increment the tap-to-recall hint counter for a letter. */
export function recordLetterHintTap(
  letterHintCounts: Record<string, number>,
  letter: string,
): Record<string, number> {
  const norm = letter.trim().toUpperCase().replace(/[‘ʻʼ`´]/g, "'");
  if (!norm) return letterHintCounts;
  return {
    ...letterHintCounts,
    [norm]: (letterHintCounts[norm] ?? 0) + 1,
  };
}

export interface StrugglingLetterSummary {
  letter: string;
  display: string;
  tapCount: number;
  exampleWord: string;
  exampleEmoji: string;
  coachingTipUz: string;
}

/**
 * Summarize which letters the child tapped most often for reminders,
 * giving parents gentle, actionable offline coaching tips without pressure.
 */
export function getStrugglingLettersSummary(
  letterHintCounts: Record<string, number>,
  lettersCatalog: AlifbeLetterInfo[] = ALIFBE_LETTERS_29,
): StrugglingLetterSummary[] {
  const catalogByLetter = new Map<string, AlifbeLetterInfo>();
  for (const entry of lettersCatalog) {
    catalogByLetter.set(entry.letter.toUpperCase(), entry);
  }

  return Object.entries(letterHintCounts)
    .filter(([, count]) => typeof count === 'number' && count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([letter, tapCount]) => {
      const meta = catalogByLetter.get(letter.toUpperCase());
      const display = meta?.display ?? letter;
      const exampleWord = meta?.exampleWord ?? letter;
      const exampleEmoji = meta?.exampleEmoji ?? '🍎';
      return {
        letter,
        display,
        tapCount,
        exampleWord,
        exampleEmoji,
        coachingTipUz: `O‘yin davomida «${display}» (${exampleWord}) tovushini ${tapCount} marta eslatma sifatida bosdi — kitob yoki ko‘chadagi yozuvlarda shu harfni birga topib o‘ynang.`,
      };
    });
}

// ============================================================================
// Alifbo 2.2 — Adaptive 2:2:1 Spaced Repetition & Offline 4-Choice Helpers
// ============================================================================

export const MAX_NEW_WORDS_PER_SESSION = 3;
export const DEFAULT_SESSION_SIZE = 5;

export interface AdaptiveSessionWord {
  item: WordPoolItem;
  expressExamOnly: boolean;
  sourceBucket: 'assisted_or_syllable' | 'mastered_review' | 'new' | 'fallback_review';
}

export interface SelectAdaptiveSessionParams {
  worldId: number;
  pool: WordPoolItem[];
  wordProgressMap: Record<string, WordProgress>;
  todayStr: string;
  letterHintCounts?: Record<string, number>;
  sessionSize?: number;
  maxNewWords?: number;
  recentSessionWordIds?: readonly string[];
}

/**
 * Select words for a reading session using the 2:2:1 Spaced Repetition quota:
 * - Up to 2 assisted/syllable words (pendingVoiceVerify & assisted prioritized, then due syllable)
 * - Up to 2 due mastered review words (nextReviewDate <= todayStr)
 * - Up to 1 new word (backfilling open slots up to `maxNewWords = 3` Cold-Start limit)
 */
export function selectAdaptiveSessionWords(
  params: SelectAdaptiveSessionParams,
): AdaptiveSessionWord[] {
  const sessionSize = Math.max(1, params.sessionSize ?? DEFAULT_SESSION_SIZE);
  const maxNewWords = Math.max(1, params.maxNewWords ?? MAX_NEW_WORDS_PER_SESSION);
  const letterHints = params.letterHintCounts ?? {};
  const allWorldItems = params.pool.filter((item) => item.worldId === params.worldId);
  if (allWorldItems.length === 0) return [];

  const pickFromItems = (worldItems: WordPoolItem[]): AdaptiveSessionWord[] => {
    if (worldItems.length === 0) return [];

    const worldOrder = new Map<string, number>();
    worldItems.forEach((item, idx) => worldOrder.set(item.id, idx));

    const pendingVerifyBucket: WordPoolItem[] = [];
    const assistedBucket: WordPoolItem[] = [];
    const dueSyllableBucket: WordPoolItem[] = [];
    const dueMasteredBucket: WordPoolItem[] = [];
    const newBucket: WordPoolItem[] = [];
    const notDueBucket: WordPoolItem[] = [];

    for (const item of worldItems) {
      const prog = params.wordProgressMap[item.id];
      if (!prog || prog.status === 'new') {
        newBucket.push(item);
        continue;
      }
      if (prog.pendingVoiceVerify && prog.status !== 'mastered') {
        pendingVerifyBucket.push(item);
        continue;
      }
      if (prog.status === 'assisted') {
        assistedBucket.push(item);
        continue;
      }
      if (prog.status === 'syllable') {
        if (prog.nextReviewDate <= params.todayStr) {
          dueSyllableBucket.push(item);
        } else {
          notDueBucket.push(item);
        }
        continue;
      }
      if (prog.status === 'mastered') {
        if (prog.nextReviewDate <= params.todayStr) {
          dueMasteredBucket.push(item);
        } else {
          notDueBucket.push(item);
        }
      }
    }

    pendingVerifyBucket.sort((a, b) => {
      const pa = params.wordProgressMap[a.id]!;
      const pb = params.wordProgressMap[b.id]!;
      const statusWeightA = pa.status === 'assisted' ? 0 : 1;
      const statusWeightB = pb.status === 'assisted' ? 0 : 1;
      if (statusWeightA !== statusWeightB) return statusWeightA - statusWeightB;
      return (worldOrder.get(a.id) ?? 0) - (worldOrder.get(b.id) ?? 0);
    });

    assistedBucket.sort((a, b) => {
      const scoreDiff =
        scoreItemByStrugglingLetters(b, letterHints) - scoreItemByStrugglingLetters(a, letterHints);
      if (scoreDiff !== 0) return scoreDiff;
      const pa = params.wordProgressMap[a.id]!;
      const pb = params.wordProgressMap[b.id]!;
      return pa.nextReviewDate.localeCompare(pb.nextReviewDate) ||
        (worldOrder.get(a.id) ?? 0) - (worldOrder.get(b.id) ?? 0);
    });

    dueSyllableBucket.sort((a, b) => {
      const pa = params.wordProgressMap[a.id]!;
      const pb = params.wordProgressMap[b.id]!;
      const dateDiff = pa.nextReviewDate.localeCompare(pb.nextReviewDate);
      if (dateDiff !== 0) return dateDiff;
      const scoreDiff =
        scoreItemByStrugglingLetters(b, letterHints) - scoreItemByStrugglingLetters(a, letterHints);
      if (scoreDiff !== 0) return scoreDiff;
      return (worldOrder.get(a.id) ?? 0) - (worldOrder.get(b.id) ?? 0);
    });

    dueMasteredBucket.sort((a, b) => {
      const pa = params.wordProgressMap[a.id]!;
      const pb = params.wordProgressMap[b.id]!;
      const dateDiff = pa.nextReviewDate.localeCompare(pb.nextReviewDate);
      if (dateDiff !== 0) return dateDiff;
      return pa.reviewIntervalDays - pb.reviewIntervalDays ||
        (worldOrder.get(a.id) ?? 0) - (worldOrder.get(b.id) ?? 0);
    });

    newBucket.sort((a, b) => {
      const scoreDiff =
        scoreItemByStrugglingLetters(b, letterHints) - scoreItemByStrugglingLetters(a, letterHints);
      if (scoreDiff !== 0) return scoreDiff;
      return (worldOrder.get(a.id) ?? 0) - (worldOrder.get(b.id) ?? 0);
    });

    notDueBucket.sort((a, b) => {
      const pa = params.wordProgressMap[a.id]!;
      const pb = params.wordProgressMap[b.id]!;
      return pa.nextReviewDate.localeCompare(pb.nextReviewDate) ||
        (worldOrder.get(a.id) ?? 0) - (worldOrder.get(b.id) ?? 0);
    });

    const assistedOrSyllableQueue = [...pendingVerifyBucket, ...assistedBucket, ...dueSyllableBucket];
    const selected: AdaptiveSessionWord[] = [];
    const usedIds = new Set<string>();
    let newCount = 0;

    const pushEntry = (
      item: WordPoolItem,
      sourceBucket: AdaptiveSessionWord['sourceBucket'],
    ): boolean => {
      if (usedIds.has(item.id) || selected.length >= sessionSize) return false;
      usedIds.add(item.id);
      const prog = params.wordProgressMap[item.id];
      const expressExamOnly =
        prog?.status === 'mastered' || Boolean(prog?.pendingVoiceVerify);
      selected.push({ item, expressExamOnly, sourceBucket });
      return true;
    };

    // Primary 2:2:1 quota
    let aPicked = 0;
    for (const item of assistedOrSyllableQueue) {
      if (aPicked >= 2) break;
      if (pushEntry(item, 'assisted_or_syllable')) aPicked++;
    }

    let mPicked = 0;
    for (const item of dueMasteredBucket) {
      if (mPicked >= 2) break;
      if (pushEntry(item, 'mastered_review')) mPicked++;
    }

    for (const item of newBucket) {
      if (newCount >= 1) break;
      if (pushEntry(item, 'new')) newCount++;
    }

    // Backfill remaining slots: first remaining review queues, then up to maxNewWords (3)
    if (selected.length < sessionSize) {
      for (const item of assistedOrSyllableQueue) {
        if (selected.length >= sessionSize) break;
        pushEntry(item, 'assisted_or_syllable');
      }
    }
    if (selected.length < sessionSize) {
      for (const item of dueMasteredBucket) {
        if (selected.length >= sessionSize) break;
        pushEntry(item, 'mastered_review');
      }
    }
    if (selected.length < sessionSize && newCount < maxNewWords) {
      for (const item of newBucket) {
        if (selected.length >= sessionSize || newCount >= maxNewWords) break;
        if (pushEntry(item, 'new')) newCount++;
      }
    }

    // If no due or allowed new words remain (e.g., all words mastered and none due), allow practice replay
    if (selected.length === 0) {
      for (const item of notDueBucket) {
        if (selected.length >= sessionSize) break;
        pushEntry(item, 'fallback_review');
      }
    }

    return selected;
  };

  if (params.recentSessionWordIds && params.recentSessionWordIds.length > 0) {
    const recentSet = new Set(params.recentSessionWordIds);
    const nonRecentItems = allWorldItems.filter((item) => !recentSet.has(item.id));
    if (nonRecentItems.length > 0) {
      const freshSelection = pickFromItems(nonRecentItems);
      if (freshSelection.length > 0) {
        return freshSelection;
      }
    }
  }

  return pickFromItems(allWorldItems);
}

export interface ShuffledStageQueues {
  stage1: AdaptiveSessionWord[];
  stage2: AdaptiveSessionWord[];
  stage3: AdaptiveSessionWord[];
}

/**
 * Shuffle session words using Fisher–Yates so consecutive exercises do not repeat
 * the exact same word order (nor immediately repeat the previous exercise's last word when >= 3 items exist).
 */
export function shuffleSessionWordsForExercise(
  items: readonly AdaptiveSessionWord[],
  previousOrderIds: readonly string[] = [],
  rng: () => number = Math.random,
): AdaptiveSessionWord[] {
  if (items.length <= 1) {
    return [...items];
  }

  const prevLastId =
    previousOrderIds.length > 0 ? previousOrderIds[previousOrderIds.length - 1] ?? null : null;

  const isSameOrder = (arr: readonly AdaptiveSessionWord[]): boolean =>
    previousOrderIds.length === arr.length &&
    arr.every((entry, idx) => entry.item.id === previousOrderIds[idx]);

  let candidate: AdaptiveSessionWord[] = [];
  for (let attempt = 0; attempt < 12; attempt++) {
    candidate = fisherYatesShuffle(items, rng);
    const boundaryRepeat =
      items.length >= 3 && prevLastId !== null && candidate[0]?.item.id === prevLastId;
    if (!isSameOrder(candidate) && !boundaryRepeat) {
      return candidate;
    }
  }

  const arr = [...candidate];
  if (items.length >= 3 && prevLastId !== null && arr[0]?.item.id === prevLastId) {
    const swapIdx = arr.findIndex((entry, idx) => idx > 0 && entry.item.id !== prevLastId);
    if (swapIdx > 0) {
      const tmp = arr[0]!;
      arr[0] = arr[swapIdx]!;
      arr[swapIdx] = tmp;
    }
  }

  if (isSameOrder(arr)) {
    if (arr.length === 2) {
      const tmp = arr[0]!;
      arr[0] = arr[1]!;
      arr[1] = tmp;
    } else if (arr.length >= 3) {
      const tmp = arr[1]!;
      arr[1] = arr[2]!;
      arr[2] = tmp;
    }
  }

  return arr;
}

/**
 * Build independent shuffled word queues for Stage 1 (Build), Stage 2 (Spotlight),
 * and Stage 3 (Exam) so the child cannot rely on memorized sequential order.
 */
export function buildShuffledExerciseQueues(
  sessionItems: readonly AdaptiveSessionWord[],
  rng: () => number = Math.random,
): ShuffledStageQueues {
  const fullPipelineItems = sessionItems.filter((entry) => !entry.expressExamOnly);
  const stage1 = shuffleSessionWordsForExercise(
    fullPipelineItems,
    fullPipelineItems.map((entry) => entry.item.id),
    rng,
  );
  const stage2 = shuffleSessionWordsForExercise(
    fullPipelineItems,
    stage1.map((entry) => entry.item.id),
    rng,
  );
  const stage3PrevIds =
    stage2.length > 0
      ? stage2.map((entry) => entry.item.id)
      : sessionItems.map((entry) => entry.item.id);
  const stage3 = shuffleSessionWordsForExercise(sessionItems, stage3PrevIds, rng);

  return { stage1, stage2, stage3 };
}

export type InterleavedStepPhase = 'stage1_build' | 'stage2_spotlight' | 'exam';

export interface InterleavedSessionStep {
  stage: 1 | 2 | 3;
  phase: InterleavedStepPhase;
  entry: AdaptiveSessionWord;
  stage1OrderIndex: number | null;
}

const INTERLEAVED_STAGE_TO_PHASE: Record<1 | 2 | 3, InterleavedStepPhase> = {
  1: 'stage1_build',
  2: 'stage2_spotlight',
  3: 'exam',
};

function findBestExpressInsertIndex(
  queue: readonly InterleavedSessionStep[],
  expressWordId: string,
): number {
  let bestPos = queue.length;
  let bestScore = -1;

  for (let pos = 0; pos <= queue.length; pos++) {
    const left = pos > 0 ? queue[pos - 1] : undefined;
    const right = pos < queue.length ? queue[pos] : undefined;

    if (left?.entry.item.id === expressWordId || right?.entry.item.id === expressWordId) {
      continue;
    }

    const breaksSameWord =
      left !== undefined && right !== undefined && left.entry.item.id === right.entry.item.id;
    const touchesStage3 = left?.stage === 3 || right?.stage === 3;
    const breaksNon3SameStage =
      left !== undefined &&
      right !== undefined &&
      left.stage === right.stage &&
      left.stage !== 3;
    const isInterior = pos > 0 && pos < queue.length;

    let score: number;
    if (breaksSameWord && !touchesStage3) {
      score = 1000;
    } else if (breaksSameWord) {
      score = 900;
    } else if (breaksNon3SameStage) {
      score = 800;
    } else if (!touchesStage3 && isInterior) {
      score = 700;
    } else if (!touchesStage3 && pos === 0) {
      score = 600;
    } else if (left?.stage !== 3 || right?.stage !== 3) {
      score = pos === queue.length ? 400 : 300;
    } else {
      score = 100;
    }

    if (score > bestScore) {
      bestScore = score;
      bestPos = pos;
    }
  }

  return bestPos;
}

/**
 * Build an interleaved "Zinapoya" session queue across Stage 1 (Build), Stage 2 (Spotlight),
 * and Stage 3 (Exam).
 * For 3 full-pipeline words [A, B, C], emits:
 *   1(A) -> 1(B) -> 2(A) -> 1(C) -> 2(B) -> 3(A) -> 2(C) -> 3(B) -> 3(C)
 * Guarantees no two consecutive steps share the same word (when >= 2 distinct words exist),
 * alternates exercise types, and preserves strict 1 -> 2 -> 3 order per word.
 * Express-exam-only words (`expressExamOnly: true`) are woven into non-adjacent slots.
 */
export function buildInterleavedSessionQueue(
  sessionItems: readonly AdaptiveSessionWord[],
): InterleavedSessionStep[] {
  if (sessionItems.length === 0) {
    return [];
  }

  const fullItems = sessionItems.filter((entry) => !entry.expressExamOnly);
  const expressItems = sessionItems.filter((entry) => entry.expressExamOnly);

  if (fullItems.length === 0) {
    return expressItems.map((entry) => ({
      stage: 3,
      phase: 'exam',
      entry,
      stage1OrderIndex: null,
    }));
  }

  const queue: InterleavedSessionStep[] = [];
  const fullCount = fullItems.length;

  for (let diagonal = 0; diagonal <= fullCount + 1; diagonal++) {
    for (const stage of [1, 2, 3] as const) {
      const wordIdx = diagonal - (stage - 1);
      if (wordIdx >= 0 && wordIdx < fullCount) {
        const entry = fullItems[wordIdx];
        if (entry) {
          queue.push({
            stage,
            phase: INTERLEAVED_STAGE_TO_PHASE[stage],
            entry,
            stage1OrderIndex: stage === 1 ? wordIdx : null,
          });
        }
      }
    }
  }

  for (const expressEntry of expressItems) {
    const insertPos = findBestExpressInsertIndex(queue, expressEntry.item.id);
    queue.splice(insertPos, 0, {
      stage: 3,
      phase: 'exam',
      entry: expressEntry,
      stage1OrderIndex: null,
    });
  }

  return queue;
}

export type ConstructorCheckOutcome = 'no_selection' | 'correct' | 'wrong';

/**
 * Evaluate the selected Constructor option when the child taps "Tekshirish".
 */
export function evaluateConstructorSelection(
  selectedPart: string | null,
  expectedPart: string,
): ConstructorCheckOutcome {
  if (!selectedPart) return 'no_selection';
  return selectedPart === expectedPart ? 'correct' : 'wrong';
}

const FALLBACK_EMOJI_POOL = ['🍎', '🚗', '🐶', '🌸', '⚽', '🔑', '🎈', '🌞', '📘', '🧸'];

/**
 * Return 4 unique Fisher–Yates shuffled emoji options for Offline 4-Picture Reading Check
 * with anti-streak protection against repeating `previousCorrectIndex` twice in a row.
 */
export function getOfflineFallbackEmojiChoices(
  item: WordPoolItem,
  pool: WordPoolItem[],
  previousCorrectIndex: number | null = null,
  rng: () => number = Math.random,
): string[] {
  const unique = new Set<string>();
  const usedPaths = new Set<string>();

  if (item.emoji) {
    unique.add(item.emoji);
    usedPaths.add(resolveVisualSrc({ emoji: item.emoji, image: item.image, wordId: item.id }));
  }

  const sameWorldCandidates = pool.filter((p) => p.worldId === item.worldId && p.id !== item.id);
  const otherCandidates = pool.filter((p) => p.worldId !== item.worldId);
  const allCandidateEmojis = [
    ...item.distractorEmojis,
    ...sameWorldCandidates.map((c) => c.emoji),
    ...otherCandidates.map((c) => c.emoji),
    ...FALLBACK_EMOJI_POOL,
  ];

  for (const cand of allCandidateEmojis) {
    if (unique.size >= 4) break;
    if (!cand || unique.has(cand)) continue;
    if (!hasExplicitVisualMapping({ emoji: cand })) continue;
    const candPath = resolveVisualSrc({ emoji: cand });
    if (!candPath || usedPaths.has(candPath)) continue;
    unique.add(cand);
    usedPaths.add(candPath);
  }

  const arr = Array.from(unique).slice(0, 4);
  return shuffleOptionsWithAntiStreak(
    arr,
    (emoji) => emoji === item.emoji,
    previousCorrectIndex,
    rng,
  );
}

/**
 * Return visual split chunks for 4.5s scaffolding in Stage 3 Exam.
 * For 1-syllable words (e.g. QOR -> ['QO','R']) or sentences, falls back to `item.parts`.
 */
export function getVisualSplitParts(item: WordPoolItem): string[] {
  if (item.kind === 'sentence' || item.syllables.length <= 1) {
    return item.parts;
  }
  return item.syllables;
}

export type Stage1GameMode = 'word_hunter' | 'constructor' | 'bubbles' | 'sentence_builder';

const EARLY_WORLD_STAGE1_ROTATION: readonly Stage1GameMode[] = [
  'word_hunter',
  'constructor',
  'bubbles',
];

/**
 * Select the Stage 1 interactive game mode:
 * - World 5 sentences use `'sentence_builder'`
 * - Worlds 1–2 rotate `'word_hunter'` (read & pick matching word + voice check), `'constructor'`, and `'bubbles'`
 * - Worlds 3–4 rotate `'bubbles'` and `'constructor'` (favoring `'bubbles'` on 3+ syllable words)
 */
export function getStage1GameMode(roundIndex: number, item: WordPoolItem): Stage1GameMode {
  if (item.kind === 'sentence') {
    return 'sentence_builder';
  }
  if (item.worldId <= 2) {
    return EARLY_WORLD_STAGE1_ROTATION[Math.abs(roundIndex) % EARLY_WORLD_STAGE1_ROTATION.length] ?? 'word_hunter';
  }
  if (item.parts.length >= 3) {
    return roundIndex % 2 === 0 ? 'bubbles' : 'constructor';
  }
  return roundIndex % 2 === 0 ? 'constructor' : 'bubbles';
}

export interface WordHunterChoice {
  id: string;
  text: string;
  parts: string[];
  isTarget: boolean;
}

/**
 * Build 3 syllable-segmented reading choices for Stage 1 "So‘z Ovchisi" (`word_hunter`):
 * the target word plus 2 visually/phonetically close Stage-Gate allowed distractors
 * so the child must actually read the syllables to match the picture.
 */
export function buildWordHunterChoices(
  target: WordPoolItem,
  pool: readonly WordPoolItem[],
  opts?: { prevCorrectIndex?: number | null; rng?: () => number },
): { choices: WordHunterChoice[]; correctIndex: number } {
  const targetNorm = normalizeUzbek(target.text);
  const candidates = pool
    .filter(
      (item) =>
        item.kind === 'word' &&
        item.worldId <= target.worldId &&
        item.id !== target.id &&
        normalizeUzbek(item.text) !== targetNorm,
    )
    .map((item) => {
      let score = 0;
      if (item.parts[0]?.toUpperCase() === target.parts[0]?.toUpperCase()) score += 3;
      if (item.letters[0] === target.letters[0]) score += 2;
      if (item.parts.length === target.parts.length) score += 2;
      if (item.worldId === target.worldId) score += 1;
      return { item, score };
    })
    .sort((a, b) => b.score - a.score);

  const pickedDistractors: WordPoolItem[] = [];
  const usedNorms = new Set<string>([targetNorm]);
  for (const cand of candidates) {
    const norm = normalizeUzbek(cand.item.text);
    if (usedNorms.has(norm)) continue;
    usedNorms.add(norm);
    pickedDistractors.push(cand.item);
    if (pickedDistractors.length >= 2) break;
  }

  const rawChoices: WordHunterChoice[] = [
    {
      id: target.id,
      text: target.text,
      parts: target.parts,
      isTarget: true,
    },
    ...pickedDistractors.map((dist) => ({
      id: dist.id,
      text: dist.text,
      parts: dist.parts,
      isTarget: false,
    })),
  ];

  // Guarantee 3 choices even if a unit test passes a minimal synthetic pool
  if (rawChoices.length < 3 && target.distractorParts.length > 0) {
    for (let i = 0; i < target.distractorParts.length && rawChoices.length < 3; i++) {
      const fakePart = target.distractorParts[i]!;
      const tailParts = target.parts.slice(1);
      const fakeParts = [fakePart, ...tailParts];
      const fakeText = fakeParts.join('');
      const norm = normalizeUzbek(fakeText);
      if (!usedNorms.has(norm)) {
        usedNorms.add(norm);
        rawChoices.push({
          id: `synth-${target.id}-${i}`,
          text: fakeText,
          parts: fakeParts,
          isTarget: false,
        });
      }
    }
  }

  const choices = shuffleOptionsWithAntiStreak(
    rawChoices,
    (choice) => choice.isTarget,
    opts?.prevCorrectIndex,
    opts?.rng,
  );
  return {
    choices,
    correctIndex: choices.findIndex((choice) => choice.isTarget),
  };
}

export interface SentenceWordTile {
  key: string;
  text: string;
  isDistractor: boolean;
}

/**
 * Build a shuffled word bank for World 5 sentence-builder exercises, including
 * all target words plus up to 1 non-colliding distractor word.
 */
export function buildSentenceWordBank(
  item: WordPoolItem,
  rng: () => number = Math.random,
): SentenceWordTile[] {
  const rawTiles: SentenceWordTile[] = item.parts.map((text, idx) => ({
    key: `word-${idx}-${text}`,
    text,
    isDistractor: false,
  }));

  const targetUpper = new Set(item.parts.map((p) => p.toUpperCase()));
  const distractor = item.distractorParts.find((d) => !targetUpper.has(d.toUpperCase()));
  if (distractor) {
    rawTiles.push({
      key: `dist-0-${distractor}`,
      text: distractor,
      isDistractor: true,
    });
  }

  const tiles = fisherYatesShuffle(rawTiles, rng);

  // Ensure non-distractor words do not remain in exact target order when reordering is possible
  const nonDistIndices: number[] = [];
  tiles.forEach((tile, idx) => {
    if (!tile.isDistractor) nonDistIndices.push(idx);
  });

  const isExactTargetOrder =
    nonDistIndices.length >= 2 &&
    nonDistIndices.every((tileIdx, orderIdx) => tiles[tileIdx]!.text === item.parts[orderIdx]);

  if (isExactTargetOrder) {
    const firstIdx = nonDistIndices[0]!;
    const swapIdx = nonDistIndices.find((idx) => tiles[idx]!.text !== tiles[firstIdx]!.text) ?? nonDistIndices[1]!;
    const tmp = tiles[firstIdx]!;
    tiles[firstIdx] = tiles[swapIdx]!;
    tiles[swapIdx] = tmp;
  }

  return tiles;
}

export function getSentenceComprehensionAudioKey(
  item: WordPoolItem,
): 'instr_comp_eat' | 'instr_comp_move' | 'instr_comp_nature' | 'instr_comprehension_action' {
  const upper = item.text.toUpperCase();
  if (upper.includes('YEDI') || upper.includes('ICHDI') || upper.includes('YOPDI')) {
    return 'instr_comp_eat';
  }
  if (
    upper.includes('UCHDI') ||
    upper.includes('SUZDI') ||
    upper.includes('YUGURDI') ||
    upper.includes('BORDI')
  ) {
    return 'instr_comp_move';
  }
  if (
    upper.includes('YOG‘DI') ||
    upper.includes('CHIQDI') ||
    upper.includes('OCHILDI') ||
    upper.includes('PORLADI')
  ) {
    return 'instr_comp_nature';
  }
  return 'instr_comprehension_action';
}

/**
 * Return a child-friendly Uzbek comprehension prompt for World 5 sentences
 * based on the sentence's action or theme.
 */
export function getSentenceComprehensionPromptUz(item: WordPoolItem): string {
  const key = getSentenceComprehensionAudioKey(item);
  if (key === 'instr_comp_eat') {
    return 'Kim nima yedi, ichdi yoki tayyorladi? Mos rasmni tanla!';
  }
  if (key === 'instr_comp_move') {
    return 'Kim qanday harakat qildi? To‘g‘ri rasmni tanla!';
  }
  if (key === 'instr_comp_nature') {
    return 'Tabiatda nima sodir bo‘ldi? Mos rasmni tanla!';
  }
  return 'Gapda nima haqida aytilgan? Ma’nosiga mos rasmni tanla!';
}
