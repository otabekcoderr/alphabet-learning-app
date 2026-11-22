import {
  tokenizeGraphemes,
  type CurriculumItem,
  type WordPoolItem,
} from '../data/curriculum';

export const DEFAULT_UNVERIFIED_CAP = 3;
export const MIN_UNVERIFIED_CAP = 1;
export const MAX_UNVERIFIED_CAP = 10;
export const MAX_UNVERIFIED_AHEAD = DEFAULT_UNVERIFIED_CAP;
export const EAR_ADVANCE_MIN_MS = 1200;
export const UNVERIFIED_PRAISE_MIN_MS = 1200;
export const PARENT_OFFLINE_BANNER_TITLE = "Ovoz tekshiruvi hozir o'chiq: server ishga tushirilmagan";

export function evaluateUnverifiedSelfConfirm(params: {
  aiOnline: boolean;
  parentSessionActive: boolean;
  completedKind: 'mastered' | 'unverified' | null;
}): {
  allowed: boolean;
  reason: 'confirmed_effort' | 'ignored_double_tap' | 'online_or_parent_mode';
  nextCompletedKind: 'mastered' | 'unverified' | null;
  starsEarned: number;
  shouldScheduleAdvance: boolean;
} {
  if (params.aiOnline || params.parentSessionActive) {
    return {
      allowed: false,
      reason: 'online_or_parent_mode',
      nextCompletedKind: params.completedKind,
      starsEarned: 0,
      shouldScheduleAdvance: false,
    };
  }
  if (params.completedKind !== null) {
    return {
      allowed: false,
      reason: 'ignored_double_tap',
      nextCompletedKind: params.completedKind,
      starsEarned: 0,
      shouldScheduleAdvance: false,
    };
  }
  return {
    allowed: true,
    reason: 'confirmed_effort',
    nextCompletedKind: 'unverified',
    starsEarned: 1,
    shouldScheduleAdvance: true,
  };
}

export function clampUnverifiedCap(cap: number): number {
  if (!Number.isFinite(cap)) return DEFAULT_UNVERIFIED_CAP;
  return Math.min(MAX_UNVERIFIED_CAP, Math.max(MIN_UNVERIFIED_CAP, Math.round(cap)));
}

export interface EarChoiceState {
  status: 'idle' | 'correct' | 'wrong';
  wrongChoiceId: string | null;
  locked: boolean;
}

export function createInitialEarChoiceState(): EarChoiceState {
  return {
    status: 'idle',
    wrongChoiceId: null,
    locked: false,
  };
}

export function evaluateEarChoice(
  current: EarChoiceState,
  targetId: string,
  chosenId: string,
): {
  state: EarChoiceState;
  outcome: 'ignored_locked' | 'correct' | 'wrong';
  shouldAdvance: boolean;
} {
  if (current.locked || current.status === 'correct') {
    return { state: current, outcome: 'ignored_locked', shouldAdvance: false };
  }
  if (chosenId === targetId) {
    return {
      state: { status: 'correct', wrongChoiceId: null, locked: true },
      outcome: 'correct',
      shouldAdvance: true,
    };
  }
  return {
    state: { status: 'wrong', wrongChoiceId: chosenId, locked: false },
    outcome: 'wrong',
    shouldAdvance: false,
  };
}

export interface VoiceStepUiState {
  mode: 'parent_confirm' | 'voice_mic' | 'offline_effort';
  showMicButton: boolean;
  showSelfConfirmButton: boolean;
  showMicBlockedBanner: boolean;
  showParentOfflineBanner: boolean;
}

export function resolveVoiceStepUiState(params: {
  aiOnline: boolean;
  parentSessionActive: boolean;
  micPermissionBlocked: boolean;
}): VoiceStepUiState {
  const showParentOfflineBanner = !params.aiOnline;
  if (params.parentSessionActive) {
    return {
      mode: 'parent_confirm',
      showMicButton: false,
      showSelfConfirmButton: false,
      showMicBlockedBanner: false,
      showParentOfflineBanner,
    };
  }
  if (params.aiOnline) {
    return {
      mode: 'voice_mic',
      showMicButton: true,
      showSelfConfirmButton: false,
      showMicBlockedBanner: params.micPermissionBlocked,
      showParentOfflineBanner: false,
    };
  }
  return {
    mode: 'offline_effort',
    showMicButton: false,
    showSelfConfirmButton: true,
    showMicBlockedBanner: false,
    showParentOfflineBanner: true,
  };
}

export type LessonStatus = 'mastered' | 'unverified';
export type ConfirmationSource = 'ai' | 'parent_single' | 'parent_bulk';

export const ONE_DAY_MS = 86_400_000;
export const FIRST_REVIEW_DAYS_BULK = 1;
export const FIRST_REVIEW_DAYS_SINGLE = 3;
export const FIRST_REVIEW_DAYS_AI_RETRY = 3;
export const FIRST_REVIEW_DAYS_AI_FIRST = 7;

export interface ItemProgress {
  itemId: string;
  status: LessonStatus;
  mastered: boolean;
  stars: number;
  effortStars: number;
  voiceAttempts: number;
  parentVerified: boolean;
  confirmationSource?: ConfirmationSource | null;
  nextReviewAt?: string | null;
  lastLatencyMs: number | null;
  lastPracticedAt: string; // ISO timestamp for ordering only; never derive calendar dates
}

export function getFirstReviewDelayDays(source: ConfirmationSource, voiceAttempts: number): number {
  if (source === 'parent_bulk') return FIRST_REVIEW_DAYS_BULK;
  if (source === 'parent_single') return FIRST_REVIEW_DAYS_SINGLE;
  return voiceAttempts > 1 ? FIRST_REVIEW_DAYS_AI_RETRY : FIRST_REVIEW_DAYS_AI_FIRST;
}

export function addDaysIso(baseIso: string, days: number): string {
  const parsedMs = Date.parse(baseIso);
  const baseMs = Number.isNaN(parsedMs) ? Date.now() : parsedMs;
  return new Date(baseMs + days * ONE_DAY_MS).toISOString();
}

export type SpeechOutcome = 'accepted' | 'silence' | 'try_again';

export interface SpeechEvaluation {
  outcome: SpeechOutcome;
  messageUz: string;
  starsEarned: number;
}

export interface DecodabilityViolation {
  itemId: string;
  text: string;
  missingLetter: string;
}

export interface DecodabilityReport {
  valid: boolean;
  violations: DecodabilityViolation[];
}

const APOSTROPHE_MAP: Record<string, string> = {
  '\u2018': "'",
  '\u2019': "'",
  '\u02bb': "'",
  '\u02bc': "'",
  '`': "'",
  '\u00b4': "'",
};

/** Normalize Uzbek text: lowercase, unify apostrophes, remove punctuation, collapse spaces. */
export function normalizeUzbek(text: string): string {
  let out = '';
  for (const ch of text || '') {
    out += APOSTROPHE_MAP[ch] ?? ch;
  }
  out = out.toLowerCase();
  out = out.replace(/[^\p{L}\p{N}\s']/gu, ' ').replace(/_/g, ' ');
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Verify that every syllable and word uses only letters introduced in an earlier
 * (or current) `kind === 'letter'` lesson.
 */
export function validateCurriculumDecodability(items: CurriculumItem[]): DecodabilityReport {
  const taughtLetters = new Set<string>();
  const violations: DecodabilityViolation[] = [];

  for (const item of items) {
    if (item.kind === 'letter') {
      taughtLetters.add(item.text.trim().toUpperCase());
    }

    const combinedChars = new Set([...item.text.toUpperCase(), ...item.parts.join('').toUpperCase()]);
    for (const ch of combinedChars) {
      if (!/[A-Z]/.test(ch)) continue;
      if (!taughtLetters.has(ch)) {
        violations.push({
          itemId: item.id,
          text: item.text,
          missingLetter: ch,
        });
      }
    }
  }

  return { valid: violations.length === 0, violations };
}

export function matchesSpelledOrSyllabicTranscript(
  normTranscript: string,
  acceptedSet: Set<string>,
  parts?: string[],
): { matched: boolean; mode: 'fluent' | 'spelled_or_syllabic' } {
  if (!normTranscript) {
    return { matched: false, mode: 'fluent' };
  }
  if (acceptedSet.has(normTranscript)) {
    return { matched: true, mode: 'fluent' };
  }

  const tokens = normTranscript.split(' ').filter(Boolean);
  for (const alias of acceptedSet) {
    if (alias.length < 2) continue;
    const aliasTokens = alias.split(' ').filter(Boolean);
    if (aliasTokens.length === 1) {
      if (tokens.includes(alias)) {
        return { matched: true, mode: 'spelled_or_syllabic' };
      }
    } else if (tokens.length >= aliasTokens.length) {
      for (let i = 0; i <= tokens.length - aliasTokens.length; i++) {
        let allEqual = true;
        for (let j = 0; j < aliasTokens.length; j++) {
          if (tokens[i + j] !== aliasTokens[j]) {
            allEqual = false;
            break;
          }
        }
        if (allEqual) {
          return { matched: true, mode: 'spelled_or_syllabic' };
        }
      }
    }
  }

  if (parts && parts.length >= 2) {
    const normParts = parts.map((p) => normalizeUzbek(p)).filter(Boolean);
    if (normParts.length >= 2) {
      let searchFrom = 0;
      let matchedAllParts = true;
      for (const part of normParts) {
        const foundIdx = tokens.indexOf(part, searchFrom);
        if (foundIdx === -1) {
          matchedAllParts = false;
          break;
        }
        searchFrom = foundIdx + 1;
      }
      if (matchedAllParts) {
        return { matched: true, mode: 'spelled_or_syllabic' };
      }
    }
  }

  return { matched: false, mode: 'fluent' };
}

/**
 * Evaluate child's speech recognition result using non-punitive rules.
 * Accepts direct fluent matches as well as spelled-out / syllabic child speech
 * (e.g. "k i ki t o b tob kitob" or "ki tob" for "KITOB").
 */
export function evaluateSpeechResult(
  expected: string,
  acceptAliases: string[],
  transcript: string,
  isSilence: boolean,
  attemptNumber: number,
  parts?: string[],
): SpeechEvaluation {
  const normTranscript = normalizeUzbek(transcript);
  if (isSilence || !normTranscript) {
    return {
      outcome: 'silence',
      messageUz: "Ovozingiz eshitilmadi. Mikrofonga yaqinroq bo'lib, balandroq aytib ko'ring!",
      starsEarned: 0,
    };
  }

  const acceptedSet = new Set<string>();
  const normExpected = normalizeUzbek(expected);
  if (normExpected) acceptedSet.add(normExpected);
  for (const alias of acceptAliases) {
    const normAlias = normalizeUzbek(alias);
    if (normAlias) acceptedSet.add(normAlias);
  }

  const match = matchesSpelledOrSyllabicTranscript(normTranscript, acceptedSet, parts);
  if (match.matched) {
    const starsEarned = attemptNumber <= 1 ? 3 : attemptNumber === 2 ? 2 : 1;
    return {
      outcome: 'accepted',
      messageUz:
        match.mode === 'spelled_or_syllabic'
          ? 'Barakalla! Bo‘g‘inlab to‘g‘ri o‘qidingiz!'
          : 'Barakalla! To‘g‘ri o‘qidingiz!',
      starsEarned,
    };
  }

  return {
    outcome: 'try_again',
    messageUz: 'Yaxshi harakat! Keling, yana bir marta urinib ko‘ramiz.',
    starsEarned: 0,
  };
}

/**
 * Record a child self-paced completion when AI is unavailable.
 * Earns effort stars only; does NOT mark the item mastered.
 */
export function applyUnverifiedAttempt(
  prev: ItemProgress | undefined,
  itemId: string,
  nowIso: string,
): { itemProgress: ItemProgress; effortStarsDelta: number } {
  const prevEffort = prev?.effortStars ?? 0;
  const effortStarsDelta = prevEffort < 3 ? 1 : 0;
  const alreadyMastered = Boolean(prev?.mastered);

  return {
    effortStarsDelta,
    itemProgress: {
      itemId,
      status: alreadyMastered ? 'mastered' : 'unverified',
      mastered: alreadyMastered,
      stars: prev?.stars ?? 0,
      effortStars: prevEffort + effortStarsDelta,
      voiceAttempts: prev?.voiceAttempts ?? 0,
      parentVerified: prev?.parentVerified ?? false,
      confirmationSource: alreadyMastered
        ? (prev?.confirmationSource ?? (prev?.parentVerified ? 'parent_single' : 'ai'))
        : null,
      nextReviewAt: alreadyMastered ? (prev?.nextReviewAt ?? null) : null,
      lastLatencyMs: prev?.lastLatencyMs ?? null,
      lastPracticedAt: nowIso,
    },
  };
}

/**
 * Record AI acceptance or PIN-authorized parent confirmation.
 * Updates mastery status, confirmation source, spaced review schedule, and mastery stars.
 */
export function applyVerifiedCompletion(
  prev: ItemProgress | undefined,
  payload: {
    itemId: string;
    starsEarned: number;
    voiceAttemptsDelta: number;
    parentVerified: boolean;
    confirmationSource?: ConfirmationSource;
    latencyMs: number | null;
    nowIso: string;
  },
): { itemProgress: ItemProgress; starsDelta: number } {
  const prevStars = prev?.stars ?? 0;
  const bestStars = Math.max(prevStars, payload.starsEarned);
  const starsDelta = Math.max(0, bestStars - prevStars);
  const nextVoiceAttempts = (prev?.voiceAttempts ?? 0) + payload.voiceAttemptsDelta;
  const resolvedSource: ConfirmationSource =
    payload.confirmationSource ?? (payload.parentVerified ? 'parent_single' : 'ai');
  const nextParentVerified =
    resolvedSource === 'parent_single' ||
    resolvedSource === 'parent_bulk' ||
    payload.parentVerified ||
    Boolean(prev?.parentVerified);
  const delayDays = getFirstReviewDelayDays(resolvedSource, nextVoiceAttempts);

  return {
    starsDelta,
    itemProgress: {
      itemId: payload.itemId,
      status: 'mastered',
      mastered: true,
      stars: bestStars,
      effortStars: prev?.effortStars ?? 0,
      voiceAttempts: nextVoiceAttempts,
      parentVerified: nextParentVerified,
      confirmationSource: resolvedSource,
      nextReviewAt: addDaysIso(payload.nowIso, delayDays),
      lastLatencyMs: payload.latencyMs ?? prev?.lastLatencyMs ?? null,
      lastPracticedAt: payload.nowIso,
    },
  };
}

/**
 * Count how many unverified (not yet mastered) lessons currently exist in the curriculum.
 */
export function getUnverifiedAheadCount(
  items: CurriculumItem[],
  progressMap: Record<string, ItemProgress>,
): number {
  let count = 0;
  for (const item of items) {
    const prog = progressMap[item.id];
    if (prog && prog.status === 'unverified' && !prog.mastered) {
      count++;
    }
  }
  return count;
}

/**
 * Returns true once the child has reached unverifiedCap unverified lessons
 * and must pause for parent review or AI verification.
 */
export function isBlockedByUnverifiedCap(
  items: CurriculumItem[],
  progressMap: Record<string, ItemProgress>,
  unverifiedCap: number = DEFAULT_UNVERIFIED_CAP,
): boolean {
  return getUnverifiedAheadCount(items, progressMap) >= clampUnverifiedCap(unverifiedCap);
}

/**
 * Recommend the next lesson for the child home screen.
 * Returns null if blocked by the unverified cap.
 */
export function getNextRecommendedItem(
  items: CurriculumItem[],
  progressMap: Record<string, ItemProgress>,
  unverifiedCap: number = DEFAULT_UNVERIFIED_CAP,
): CurriculumItem | null {
  if (items.length === 0) return null;
  if (isBlockedByUnverifiedCap(items, progressMap, unverifiedCap)) return null;

  const untouched = items.find((item) => !progressMap[item.id]);
  if (untouched) return untouched;
  const notMastered = items.find((item) => !progressMap[item.id]?.mastered);
  return notMastered ?? items[0] ?? null;
}

/**
 * Determine whether the player can advance from `currentItemId` to the next item in `items`.
 * Already-unlocked items (`mastered` or `unverified`) remain navigable even when capped.
 */
export function canNavigateToNextLesson(
  items: CurriculumItem[],
  progressMap: Record<string, ItemProgress>,
  currentItemId: string,
  unverifiedCap: number = DEFAULT_UNVERIFIED_CAP,
): CurriculumItem | null {
  const currentIndex = items.findIndex((i) => i.id === currentItemId);
  if (currentIndex < 0 || currentIndex + 1 >= items.length) return null;

  const candidate = items[currentIndex + 1]!;
  const candidateProg = progressMap[candidate.id];
  if (candidateProg && (candidateProg.mastered || candidateProg.status === 'unverified')) {
    return candidate;
  }

  if (!isBlockedByUnverifiedCap(items, progressMap, unverifiedCap)) {
    const recommended = getNextRecommendedItem(items, progressMap, unverifiedCap);
    if (recommended?.id === candidate.id) {
      return candidate;
    }
  }

  return null;
}

/**
 * Pure transition helper for completing a lesson without AI/parent verification.
 * Safe to compute outside React setState (e.g. under React StrictMode).
 */
export function computeUnverifiedCompletion(params: {
  items: CurriculumItem[];
  progressByItem: Record<string, ItemProgress>;
  totalEffortStars: number;
  unverifiedCap: number;
  itemId: string;
  nowIso: string;
}): {
  itemProgress: ItemProgress;
  effortStarsDelta: number;
  nextProgressByItem: Record<string, ItemProgress>;
  nextTotalEffortStars: number;
  blockedByCap: boolean;
  nextRecommendedItem: CurriculumItem | null;
} {
  const { itemProgress, effortStarsDelta } = applyUnverifiedAttempt(
    params.progressByItem[params.itemId],
    params.itemId,
    params.nowIso,
  );
  const nextProgressByItem: Record<string, ItemProgress> = {
    ...params.progressByItem,
    [params.itemId]: itemProgress,
  };
  const nextTotalEffortStars = params.totalEffortStars + effortStarsDelta;
  const blockedByCap = isBlockedByUnverifiedCap(
    params.items,
    nextProgressByItem,
    params.unverifiedCap,
  );
  const nextRecommendedItem = getNextRecommendedItem(
    params.items,
    nextProgressByItem,
    params.unverifiedCap,
  );

  return {
    itemProgress,
    effortStarsDelta,
    nextProgressByItem,
    nextTotalEffortStars,
    blockedByCap,
    nextRecommendedItem,
  };
}

/**
 * Pure transition helper for completing or upgrading a lesson with AI or parent verification.
 * Safe to compute outside React setState (e.g. under React StrictMode).
 */
export function computeVerifiedCompletion(params: {
  items: CurriculumItem[];
  progressByItem: Record<string, ItemProgress>;
  totalStars: number;
  unverifiedCap: number;
  itemId: string;
  starsEarned: number;
  voiceAttemptsDelta: number;
  parentVerified: boolean;
  confirmationSource?: ConfirmationSource;
  latencyMs: number | null;
  nowIso: string;
}): {
  itemProgress: ItemProgress;
  starsDelta: number;
  nextProgressByItem: Record<string, ItemProgress>;
  nextTotalStars: number;
  blockedByCap: boolean;
  nextRecommendedItem: CurriculumItem | null;
} {
  const { itemProgress, starsDelta } = applyVerifiedCompletion(params.progressByItem[params.itemId], {
    itemId: params.itemId,
    starsEarned: params.starsEarned,
    voiceAttemptsDelta: params.voiceAttemptsDelta,
    parentVerified: params.parentVerified,
    confirmationSource: params.confirmationSource,
    latencyMs: params.latencyMs,
    nowIso: params.nowIso,
  });
  const nextProgressByItem: Record<string, ItemProgress> = {
    ...params.progressByItem,
    [params.itemId]: itemProgress,
  };
  const nextTotalStars = params.totalStars + starsDelta;
  const blockedByCap = isBlockedByUnverifiedCap(
    params.items,
    nextProgressByItem,
    params.unverifiedCap,
  );
  const nextRecommendedItem = getNextRecommendedItem(
    params.items,
    nextProgressByItem,
    params.unverifiedCap,
  );

  return {
    itemProgress,
    starsDelta,
    nextProgressByItem,
    nextTotalStars,
    blockedByCap,
    nextRecommendedItem,
  };
}

/**
 * Parent "Yana mashq qilsin" transition:
 * Resets an unverified lesson back to not-completed so the child practices it again.
 * Decrements unverifiedAheadCount by 1 without modifying unverifiedCap and never
 * unlocks lessons beyond masteredCount + unverifiedCap.
 */
export function applyNeedsMorePractice(params: {
  items: CurriculumItem[];
  progressByItem: Record<string, ItemProgress>;
  unverifiedCap: number;
  itemId: string;
}): {
  applied: boolean;
  nextProgressByItem: Record<string, ItemProgress>;
  unverifiedAheadCount: number;
  blockedByCap: boolean;
  nextRecommendedItem: CurriculumItem | null;
} {
  const current = params.progressByItem[params.itemId];
  if (!current || current.mastered || current.status !== 'unverified') {
    return {
      applied: false,
      nextProgressByItem: params.progressByItem,
      unverifiedAheadCount: getUnverifiedAheadCount(params.items, params.progressByItem),
      blockedByCap: isBlockedByUnverifiedCap(params.items, params.progressByItem, params.unverifiedCap),
      nextRecommendedItem: getNextRecommendedItem(params.items, params.progressByItem, params.unverifiedCap),
    };
  }

  const { [params.itemId]: _removed, ...nextProgressByItem } = params.progressByItem;
  return {
    applied: true,
    nextProgressByItem,
    unverifiedAheadCount: getUnverifiedAheadCount(params.items, nextProgressByItem),
    blockedByCap: isBlockedByUnverifiedCap(params.items, nextProgressByItem, params.unverifiedCap),
    nextRecommendedItem: getNextRecommendedItem(params.items, nextProgressByItem, params.unverifiedCap),
  };
}

/**
 * Parent "Hammasini tasdiqlash" transition:
 * Requires PIN-unlocked parent area AND explicit dialog confirmation.
 * Marks all unverified lessons as mastered with confirmationSource = 'parent_bulk'
 * and schedules their first spaced review after 1 day.
 */
export function computeBulkParentConfirmation(params: {
  parentUnlocked: boolean;
  confirmedByDialog: boolean;
  items: CurriculumItem[];
  progressByItem: Record<string, ItemProgress>;
  totalStars: number;
  unverifiedCap: number;
  nowIso: string;
}): {
  applied: boolean;
  confirmedItemIds: string[];
  starsDelta: number;
  nextProgressByItem: Record<string, ItemProgress>;
  nextTotalStars: number;
  blockedByCap: boolean;
  nextRecommendedItem: CurriculumItem | null;
} {
  if (!params.parentUnlocked || !params.confirmedByDialog) {
    return {
      applied: false,
      confirmedItemIds: [],
      starsDelta: 0,
      nextProgressByItem: params.progressByItem,
      nextTotalStars: params.totalStars,
      blockedByCap: isBlockedByUnverifiedCap(params.items, params.progressByItem, params.unverifiedCap),
      nextRecommendedItem: getNextRecommendedItem(params.items, params.progressByItem, params.unverifiedCap),
    };
  }

  const nextProgressByItem: Record<string, ItemProgress> = { ...params.progressByItem };
  const confirmedItemIds: string[] = [];
  let starsDeltaTotal = 0;

  for (const item of params.items) {
    const prev = nextProgressByItem[item.id];
    if (prev && prev.status === 'unverified' && !prev.mastered) {
      const { itemProgress, starsDelta } = applyVerifiedCompletion(prev, {
        itemId: item.id,
        starsEarned: 3,
        voiceAttemptsDelta: 0,
        parentVerified: true,
        confirmationSource: 'parent_bulk',
        latencyMs: null,
        nowIso: params.nowIso,
      });
      nextProgressByItem[item.id] = itemProgress;
      confirmedItemIds.push(item.id);
      starsDeltaTotal += starsDelta;
    }
  }

  if (confirmedItemIds.length === 0) {
    return {
      applied: false,
      confirmedItemIds: [],
      starsDelta: 0,
      nextProgressByItem: params.progressByItem,
      nextTotalStars: params.totalStars,
      blockedByCap: isBlockedByUnverifiedCap(params.items, params.progressByItem, params.unverifiedCap),
      nextRecommendedItem: getNextRecommendedItem(params.items, params.progressByItem, params.unverifiedCap),
    };
  }

  return {
    applied: true,
    confirmedItemIds,
    starsDelta: starsDeltaTotal,
    nextProgressByItem,
    nextTotalStars: params.totalStars + starsDeltaTotal,
    blockedByCap: isBlockedByUnverifiedCap(params.items, nextProgressByItem, params.unverifiedCap),
    nextRecommendedItem: getNextRecommendedItem(params.items, nextProgressByItem, params.unverifiedCap),
  };
}

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Pick 3 deterministic choices (target + 2 distractors) for Step 2 "Eshitib Top".
 */
export function getDistractors(targetItem: CurriculumItem, allItems: CurriculumItem[]): CurriculumItem[] {
  const others = allItems.filter((item) => item.id !== targetItem.id);
  const ranked = [...others].sort((a, b) => {
    const sameKindA = a.kind === targetItem.kind ? 0 : 1;
    const sameKindB = b.kind === targetItem.kind ? 0 : 1;
    if (sameKindA !== sameKindB) return sameKindA - sameKindB;
    const stageDiffA = Math.abs(a.stage - targetItem.stage);
    const stageDiffB = Math.abs(b.stage - targetItem.stage);
    if (stageDiffA !== stageDiffB) return stageDiffA - stageDiffB;
    return hashString(`${targetItem.id}:${a.id}`) - hashString(`${targetItem.id}:${b.id}`);
  });

  const picked = [targetItem, ...ranked.slice(0, 2)];
  return picked.sort(
    (a, b) => hashString(`order:${targetItem.id}:${a.id}`) - hashString(`order:${targetItem.id}:${b.id}`),
  );
}

function getEffectiveSource(p: ItemProgress): ConfirmationSource {
  return p.confirmationSource ?? (p.parentVerified ? 'parent_single' : 'ai');
}

function getEffectiveDueMs(p: ItemProgress): number {
  const source = getEffectiveSource(p);
  const dueIso = p.nextReviewAt ?? addDaysIso(p.lastPracticedAt, getFirstReviewDelayDays(source, p.voiceAttempts));
  const ms = Date.parse(dueIso);
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * Spaced repetition review queue: includes only verified/mastered lessons where
 * extra attempts or parent confirmation were recorded. Unverified child attempts are excluded.
 * When `nowIso` is provided, returns only items whose `nextReviewAt` is due (`<= nowIso`),
 * so bulk-confirmed items (`parent_bulk`) surface after 1 day while single-confirmed items surface after 3 days.
 */
export function getReviewQueue(
  items: CurriculumItem[],
  progressMap: Record<string, ItemProgress>,
  nowIso?: string,
): CurriculumItem[] {
  const nowMs = nowIso !== undefined ? Date.parse(nowIso) : null;

  const candidates = items.filter((item) => {
    const p = progressMap[item.id];
    if (!p || !p.mastered) return false;
    const source = getEffectiveSource(p);
    const eligible = p.voiceAttempts > 1 || p.parentVerified || source === 'parent_bulk';
    if (!eligible) return false;
    if (nowMs !== null && !Number.isNaN(nowMs)) {
      return getEffectiveDueMs(p) <= nowMs;
    }
    return true;
  });

  return [...candidates].sort((a, b) => {
    const pa = progressMap[a.id]!;
    const pb = progressMap[b.id]!;
    const dueDiff = getEffectiveDueMs(pa) - getEffectiveDueMs(pb);
    if (dueDiff !== 0) return dueDiff;
    if (pa.voiceAttempts !== pb.voiceAttempts) return pb.voiceAttempts - pa.voiceAttempts;
    return pa.lastPracticedAt.localeCompare(pb.lastPracticedAt);
  });
}

// ============================================================================
// Alifbo 2.2 — Mastery Levels, Dynamic Fluency Timing & Diagnostic Analytics
// ============================================================================

export interface ReadingThresholds {
  readonly maxReactionMsForFluent: number;
  readonly masteredBaseMs: number;
  readonly masteredPerSyllableMs: number;
  readonly syllableBaseMs: number;
  readonly syllablePerSyllableMs: number;
  readonly interWordAllowanceMs: number;
  readonly visualSplitDelayMs: number;
  readonly audioHintDelayMs: number;
  readonly minSttConfidence: number;
  readonly maxLowConfidenceRetries: number;
  readonly offlineStreakForSyllable: number;
  readonly masteredReviewInitialDays: number;
  readonly masteredReviewMultiplier: number;
  readonly syllableReviewDays: number;
  readonly minWordsForErrorRate: number;
  readonly problemLetterErrorRateThreshold: number;
}

export const READING_THRESHOLDS: ReadingThresholds = {
  maxReactionMsForFluent: 3500,
  masteredBaseMs: 650,
  masteredPerSyllableMs: 450,
  syllableBaseMs: 1200,
  syllablePerSyllableMs: 900,
  interWordAllowanceMs: 350,
  visualSplitDelayMs: 4500,
  audioHintDelayMs: 8000,
  minSttConfidence: 0.45,
  maxLowConfidenceRetries: 2,
  offlineStreakForSyllable: 2,
  masteredReviewInitialDays: 3,
  masteredReviewMultiplier: 2.5,
  syllableReviewDays: 1,
  minWordsForErrorRate: 3,
  problemLetterErrorRateThreshold: 0.4,
} as const;

export type MasteryStatus = 'new' | 'assisted' | 'syllable' | 'mastered';
export type SpokenCadence = 'fluent' | 'syllable' | 'spelled_out';

export interface WordProgress {
  wordId: string;
  status: MasteryStatus;
  reviewIntervalDays: number;
  nextReviewDate: string; // YYYY-MM-DD
  attemptCount: number;
  assistedCount: number;
  offlineCorrectStreak?: number;
  fluentStreak?: number;
  lastReactionMs?: number;
  lastArticulationMs?: number;
  pendingVoiceVerify?: boolean;
}

export interface ReadingAttemptInput {
  syllableCount: number;
  wordCount?: number;
  reactionMs: number;
  articulationMs: number;
  usedVisualSplit: boolean;
  usedAudioHint: boolean;
  isOfflineFallback?: boolean;
  offlineWrongTaps?: number;
  spokenCadence?: SpokenCadence;
  isCorrect: boolean;
  previousStatus?: MasteryStatus;
  previousIntervalDays?: number;
  previousOfflineStreak?: number;
  previousFluentStreak?: number;
}

export interface ReadingAttemptEvaluation {
  status: MasteryStatus;
  nextIntervalDays: number;
  pendingVoiceVerify: boolean;
  nextOfflineStreak: number;
  nextFluentStreak: number;
}

/** Add `days` to a YYYY-MM-DD calendar date string without timezone drift. */
export function addLocalDays(baseDateStr: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(baseDateStr.trim());
  const now = new Date();
  const baseUtcMs = match
    ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const target = new Date(baseUtcMs + Math.round(days) * ONE_DAY_MS);
  const y = target.getUTCFullYear();
  const m = String(target.getUTCMonth() + 1).padStart(2, '0');
  const d = String(target.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Evaluate a child's Stage 3 reading attempt into 4 mastery states (`new` | `assisted` | `syllable` | `mastered`).
 * Separates scaffolding-assisted decoding and offline 4-picture fallback from verified fluent mastery.
 */
export function evaluateReadingAttempt(
  input: ReadingAttemptInput,
  thresholds: ReadingThresholds = READING_THRESHOLDS,
): ReadingAttemptEvaluation {
  if (!input.isCorrect || input.usedAudioHint || input.spokenCadence === 'spelled_out') {
    return {
      status: 'assisted',
      nextIntervalDays: 0,
      pendingVoiceVerify: false,
      nextOfflineStreak: 0,
      nextFluentStreak: 0,
    };
  }

  // Offline 4-picture fallback never grants mastered and requires 2 clean passes for syllable
  if (input.isOfflineFallback) {
    if ((input.offlineWrongTaps ?? 0) > 0) {
      return {
        status: 'assisted',
        nextIntervalDays: 0,
        pendingVoiceVerify: true,
        nextOfflineStreak: 0,
        nextFluentStreak: 0,
      };
    }
    const nextOfflineStreak = (input.previousOfflineStreak ?? 0) + 1;
    if (nextOfflineStreak >= thresholds.offlineStreakForSyllable) {
      return {
        status: 'syllable',
        nextIntervalDays: thresholds.syllableReviewDays,
        pendingVoiceVerify: true,
        nextOfflineStreak,
        nextFluentStreak: 0,
      };
    }
    return {
      status: 'assisted',
      nextIntervalDays: 0,
      pendingVoiceVerify: true,
      nextOfflineStreak,
      nextFluentStreak: 0,
    };
  }

  const N = Math.max(1, input.syllableCount);
  const words = Math.max(1, input.wordCount ?? 1);
  const interWordAllowanceMs = (words - 1) * thresholds.interWordAllowanceMs;

  const masteredLimitMs =
    thresholds.masteredBaseMs + N * thresholds.masteredPerSyllableMs + interWordAllowanceMs;
  const syllableLimitMs =
    thresholds.syllableBaseMs + N * thresholds.syllablePerSyllableMs + interWordAllowanceMs;

  const isIndependentFluent = !input.usedVisualSplit && input.spokenCadence !== 'syllable';

  // Fast independent fluency
  if (
    isIndependentFluent &&
    input.reactionMs <= thresholds.maxReactionMsForFluent &&
    input.articulationMs <= masteredLimitMs
  ) {
    const prevInterval = input.previousIntervalDays ?? 0;
    const nextInterval =
      prevInterval >= thresholds.masteredReviewInitialDays
        ? Math.round(prevInterval * thresholds.masteredReviewMultiplier)
        : thresholds.masteredReviewInitialDays;
    return {
      status: 'mastered',
      nextIntervalDays: nextInterval,
      pendingVoiceVerify: false,
      nextOfflineStreak: 0,
      nextFluentStreak: (input.previousFluentStreak ?? 0) + 1,
    };
  }

  // Fairness safeguard: consistent careful independent reading across 2 sessions earns mastered
  if (
    isIndependentFluent &&
    input.articulationMs <= syllableLimitMs &&
    input.previousStatus === 'syllable' &&
    (input.previousFluentStreak ?? 0) >= 1
  ) {
    return {
      status: 'mastered',
      nextIntervalDays: thresholds.masteredReviewInitialDays,
      pendingVoiceVerify: false,
      nextOfflineStreak: 0,
      nextFluentStreak: (input.previousFluentStreak ?? 0) + 1,
    };
  }

  if (input.articulationMs <= syllableLimitMs) {
    return {
      status: 'syllable',
      nextIntervalDays: thresholds.syllableReviewDays,
      pendingVoiceVerify: false,
      nextOfflineStreak: 0,
      nextFluentStreak: isIndependentFluent ? (input.previousFluentStreak ?? 0) + 1 : 0,
    };
  }

  return {
    status: 'assisted',
    nextIntervalDays: 0,
    pendingVoiceVerify: false,
    nextOfflineStreak: 0,
    nextFluentStreak: 0,
  };
}

/** Pure transition helper producing the updated WordProgress after a reading attempt. */
export function applyWordReadingAttempt(
  prev: WordProgress | undefined,
  wordId: string,
  evalRes: ReadingAttemptEvaluation,
  meta: { todayStr: string; reactionMs?: number; articulationMs?: number },
): WordProgress {
  return {
    wordId,
    status: evalRes.status,
    reviewIntervalDays: evalRes.nextIntervalDays,
    nextReviewDate: addLocalDays(meta.todayStr, evalRes.nextIntervalDays),
    attemptCount: (prev?.attemptCount ?? 0) + 1,
    assistedCount: (prev?.assistedCount ?? 0) + (evalRes.status === 'assisted' ? 1 : 0),
    offlineCorrectStreak: evalRes.nextOfflineStreak,
    fluentStreak: evalRes.nextFluentStreak,
    lastReactionMs: meta.reactionMs ?? prev?.lastReactionMs,
    lastArticulationMs: meta.articulationMs ?? prev?.lastArticulationMs,
    pendingVoiceVerify: evalRes.pendingVoiceVerify,
  };
}

/** PIN-authenticated parent verification for offline-practiced words awaiting confirmation. */
export function applyParentWordVerification(
  prev: WordProgress | undefined,
  wordId: string,
  confirmedMastered: boolean,
  todayStr: string,
  thresholds: ReadingThresholds = READING_THRESHOLDS,
): WordProgress {
  if (confirmedMastered) {
    const prevInterval = prev?.reviewIntervalDays ?? 0;
    const nextInterval =
      prev?.status === 'mastered' && prevInterval >= thresholds.masteredReviewInitialDays
        ? Math.round(prevInterval * thresholds.masteredReviewMultiplier)
        : thresholds.masteredReviewInitialDays;
    return {
      wordId,
      status: 'mastered',
      reviewIntervalDays: nextInterval,
      nextReviewDate: addLocalDays(todayStr, nextInterval),
      attemptCount: Math.max(1, prev?.attemptCount ?? 1),
      assistedCount: prev?.assistedCount ?? 0,
      offlineCorrectStreak: 0,
      fluentStreak: (prev?.fluentStreak ?? 0) + 1,
      lastReactionMs: prev?.lastReactionMs,
      lastArticulationMs: prev?.lastArticulationMs,
      pendingVoiceVerify: false,
    };
  }

  return {
    wordId,
    status: 'assisted',
    reviewIntervalDays: 0,
    nextReviewDate: todayStr,
    attemptCount: Math.max(1, prev?.attemptCount ?? 1),
    assistedCount: (prev?.assistedCount ?? 0) + 1,
    offlineCorrectStreak: 0,
    fluentStreak: 0,
    lastReactionMs: prev?.lastReactionMs,
    lastArticulationMs: prev?.lastArticulationMs,
    pendingVoiceVerify: false,
  };
}

export function isConfirmedAssistedWord(prog: WordProgress | undefined): boolean {
  return Boolean(prog && prog.status === 'assisted' && !prog.pendingVoiceVerify);
}

export interface ProblemGraphemeStat {
  grapheme: string;
  attemptedWords: number;
  assistedWords: number;
  errorRate: number;
}

/**
 * Identify up to top-5 truly struggling graphemes using relative error rate:
 * ErrorRate(L) = AssistedWordsWith(L) / AttemptedWordsWith(L) >= 0.40 (min 3 words).
 * Only counts words confirmed as assisted (`status === 'assisted' && !pendingVoiceVerify`),
 * excluding offline words awaiting parent verification.
 */
export function computeProblemGraphemes(
  wordProgressMap: Record<string, WordProgress>,
  pool: WordPoolItem[],
  thresholds: ReadingThresholds = READING_THRESHOLDS,
): ProblemGraphemeStat[] {
  const counts = new Map<string, { attempted: number; assisted: number }>();

  for (const item of pool) {
    const prog = wordProgressMap[item.id];
    if (!prog || prog.attemptCount <= 0 || prog.status === 'new') continue;

    const uniqueGraphemes = new Set(tokenizeGraphemes(item.text));
    for (const g of uniqueGraphemes) {
      const entry = counts.get(g) ?? { attempted: 0, assisted: 0 };
      entry.attempted += 1;
      if (isConfirmedAssistedWord(prog)) {
        entry.assisted += 1;
      }
      counts.set(g, entry);
    }
  }

  const results: ProblemGraphemeStat[] = [];
  for (const [grapheme, { attempted, assisted }] of counts.entries()) {
    if (attempted < thresholds.minWordsForErrorRate) continue;
    const errorRate = assisted / attempted;
    if (errorRate >= thresholds.problemLetterErrorRateThreshold) {
      results.push({
        grapheme,
        attemptedWords: attempted,
        assistedWords: assisted,
        errorRate,
      });
    }
  }

  return results
    .sort((a, b) => b.errorRate - a.errorRate || b.assistedWords - a.assistedWords || a.grapheme.localeCompare(b.grapheme))
    .slice(0, 5);
}

/** Compute average reading speed in seconds (0.1s precision) across the last 20 attempts. */
export function computeAverageReadingSpeedSec(recentReadingTimesMs: number[]): number | null {
  const valid = recentReadingTimesMs
    .slice(-20)
    .filter((ms) => typeof ms === 'number' && Number.isFinite(ms) && ms > 0);
  if (valid.length === 0) return null;
  const avgMs = valid.reduce((sum, ms) => sum + ms, 0) / valid.length;
  return Math.round((avgMs / 1000) * 10) / 10;
}
