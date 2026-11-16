import type { CurriculumItem } from '../data/curriculum';

export const MAX_UNVERIFIED_AHEAD = 3;

export type LessonStatus = 'mastered' | 'unverified';

export interface ItemProgress {
  itemId: string;
  status: LessonStatus;
  mastered: boolean;
  stars: number;
  effortStars: number;
  voiceAttempts: number;
  parentVerified: boolean;
  lastLatencyMs: number | null;
  lastPracticedAt: string; // ISO timestamp for ordering only; never derive calendar dates
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

/**
 * Evaluate child's speech recognition result using non-punitive rules.
 */
export function evaluateSpeechResult(
  expected: string,
  acceptAliases: string[],
  transcript: string,
  isSilence: boolean,
  attemptNumber: number,
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

  if (acceptedSet.has(normTranscript)) {
    const starsEarned = attemptNumber <= 1 ? 3 : attemptNumber === 2 ? 2 : 1;
    return {
      outcome: 'accepted',
      messageUz: 'Barakalla! To‘g‘ri o‘qidingiz!',
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
      lastLatencyMs: prev?.lastLatencyMs ?? null,
      lastPracticedAt: nowIso,
    },
  };
}

/**
 * Record AI acceptance or PIN-authorized parent confirmation.
 * Updates mastery status and mastery stars.
 */
export function applyVerifiedCompletion(
  prev: ItemProgress | undefined,
  payload: {
    itemId: string;
    starsEarned: number;
    voiceAttemptsDelta: number;
    parentVerified: boolean;
    latencyMs: number | null;
    nowIso: string;
  },
): { itemProgress: ItemProgress; starsDelta: number } {
  const prevStars = prev?.stars ?? 0;
  const bestStars = Math.max(prevStars, payload.starsEarned);
  const starsDelta = Math.max(0, bestStars - prevStars);

  return {
    starsDelta,
    itemProgress: {
      itemId: payload.itemId,
      status: 'mastered',
      mastered: true,
      stars: bestStars,
      effortStars: prev?.effortStars ?? 0,
      voiceAttempts: (prev?.voiceAttempts ?? 0) + payload.voiceAttemptsDelta,
      parentVerified: payload.parentVerified || Boolean(prev?.parentVerified),
      lastLatencyMs: payload.latencyMs ?? prev?.lastLatencyMs ?? null,
      lastPracticedAt: payload.nowIso,
    },
  };
}

/**
 * Count how many unverified lessons exist after the last parent/AI-confirmed (mastered) lesson.
 */
export function getUnverifiedAheadCount(
  items: CurriculumItem[],
  progressMap: Record<string, ItemProgress>,
): number {
  let lastMasteredIdx = -1;
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (progressMap[item.id]?.mastered) {
      lastMasteredIdx = i;
    }
  }

  let count = 0;
  for (let i = lastMasteredIdx + 1; i < items.length; i++) {
    const item = items[i]!;
    const prog = progressMap[item.id];
    if (prog && prog.status === 'unverified' && !prog.mastered) {
      count++;
    }
  }
  return count;
}

/**
 * Returns true once the child has completed MAX_UNVERIFIED_AHEAD unverified lessons
 * past the last mastered lesson and must pause for parent review.
 */
export function isBlockedByUnverifiedCap(
  items: CurriculumItem[],
  progressMap: Record<string, ItemProgress>,
): boolean {
  return getUnverifiedAheadCount(items, progressMap) >= MAX_UNVERIFIED_AHEAD;
}

/**
 * Recommend the next lesson for the child home screen.
 * Returns null if blocked by the unverified cap (MAX_UNVERIFIED_AHEAD).
 */
export function getNextRecommendedItem(
  items: CurriculumItem[],
  progressMap: Record<string, ItemProgress>,
): CurriculumItem | null {
  if (items.length === 0) return null;
  if (isBlockedByUnverifiedCap(items, progressMap)) return null;

  const untouched = items.find((item) => !progressMap[item.id]);
  if (untouched) return untouched;
  const notMastered = items.find((item) => !progressMap[item.id]?.mastered);
  return notMastered ?? items[0] ?? null;
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

/**
 * Spaced repetition review queue: includes only verified/mastered lessons where
 * extra attempts or parent confirmation were recorded. Unverified child attempts are excluded.
 */
export function getReviewQueue(
  items: CurriculumItem[],
  progressMap: Record<string, ItemProgress>,
): CurriculumItem[] {
  const candidates = items.filter((item) => {
    const p = progressMap[item.id];
    if (!p || !p.mastered) return false;
    return p.voiceAttempts > 1 || p.parentVerified;
  });

  return [...candidates].sort((a, b) => {
    const pa = progressMap[a.id]!;
    const pb = progressMap[b.id]!;
    if (pa.voiceAttempts !== pb.voiceAttempts) return pb.voiceAttempts - pa.voiceAttempts;
    return pa.lastPracticedAt.localeCompare(pb.lastPracticedAt);
  });
}
