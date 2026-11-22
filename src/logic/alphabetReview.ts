import { ALIFBE_LETTERS_29, type AlifbeLetterInfo } from '../data/curriculum';
import { fisherYatesShuffle, shuffleOptionsWithAntiStreak } from './optionShuffle';

export type LetterMasteryStatus = 'new' | 'practiced' | 'mastered';

export interface LetterMasteryEntry {
  letter: string;
  status: LetterMasteryStatus;
  correctCount: number;
  streak: number;
  lastReviewedAt: string;
}

export const DEFAULT_ALPHABET_ROUND_SIZE = 5;

/**
 * Select a sequential 5-letter queue for the interactive alphabet review game:
 * 1) Tapped-for-help unmastered letters (highest tap count first)
 * 2) Remaining unmastered letters in 1-sinf Alifbe textbook sequence
 * 3) Oldest mastered letters as review backfill if fewer than `roundSize` remain
 */
export function selectAlphabetReviewQueue(params: {
  catalog?: AlifbeLetterInfo[];
  letterHintCounts: Record<string, number>;
  letterMastery: Record<string, LetterMasteryEntry>;
  roundSize?: number;
}): AlifbeLetterInfo[] {
  const catalog = params.catalog ?? ALIFBE_LETTERS_29;
  const roundSize = Math.max(1, params.roundSize ?? DEFAULT_ALPHABET_ROUND_SIZE);
  if (catalog.length === 0) return [];

  const catalogIndex = new Map<string, number>();
  catalog.forEach((entry, idx) => catalogIndex.set(entry.letter, idx));

  const tappedUnmastered: AlifbeLetterInfo[] = [];
  const otherUnmastered: AlifbeLetterInfo[] = [];
  const mastered: AlifbeLetterInfo[] = [];

  for (const entry of catalog) {
    const mastery = params.letterMastery[entry.letter];
    if (mastery?.status === 'mastered') {
      mastered.push(entry);
      continue;
    }
    const hintCount = params.letterHintCounts[entry.letter] ?? 0;
    if (hintCount > 0) {
      tappedUnmastered.push(entry);
    } else {
      otherUnmastered.push(entry);
    }
  }

  tappedUnmastered.sort((a, b) => {
    const tapDiff =
      (params.letterHintCounts[b.letter] ?? 0) - (params.letterHintCounts[a.letter] ?? 0);
    if (tapDiff !== 0) return tapDiff;
    return (catalogIndex.get(a.letter) ?? 0) - (catalogIndex.get(b.letter) ?? 0);
  });

  mastered.sort((a, b) => {
    const dateA = params.letterMastery[a.letter]?.lastReviewedAt ?? '';
    const dateB = params.letterMastery[b.letter]?.lastReviewedAt ?? '';
    const dateDiff = dateA.localeCompare(dateB);
    if (dateDiff !== 0) return dateDiff;
    return (catalogIndex.get(a.letter) ?? 0) - (catalogIndex.get(b.letter) ?? 0);
  });

  const combined: AlifbeLetterInfo[] = [];
  const used = new Set<string>();

  for (const entry of [...tappedUnmastered, ...otherUnmastered, ...mastered]) {
    if (combined.length >= roundSize) break;
    if (used.has(entry.letter)) continue;
    used.add(entry.letter);
    combined.push(entry);
  }

  return combined;
}

/**
 * Pick 2 distinct distractors (preferring the same letter category) and shuffle
 * via Fisher–Yates with anti-streak protection alongside `target` for 3-option quiz steps.
 */
export function buildLetterQuizChoices(
  target: AlifbeLetterInfo,
  catalog: AlifbeLetterInfo[] = ALIFBE_LETTERS_29,
  _seed?: string,
  previousCorrectIndex: number | null = null,
  rng: () => number = Math.random,
): AlifbeLetterInfo[] {
  const sameCategory = catalog.filter(
    (entry) =>
      entry.letter !== target.letter &&
      entry.exampleEmoji !== target.exampleEmoji &&
      entry.category === target.category,
  );
  const otherCategory = catalog.filter(
    (entry) =>
      entry.letter !== target.letter &&
      entry.exampleEmoji !== target.exampleEmoji &&
      entry.category !== target.category,
  );

  const orderedPool = [
    ...fisherYatesShuffle(sameCategory, rng),
    ...fisherYatesShuffle(otherCategory, rng),
  ];

  const distractors: AlifbeLetterInfo[] = [];
  const usedLetters = new Set<string>([target.letter]);
  const usedEmojis = new Set<string>([target.exampleEmoji]);

  for (const cand of orderedPool) {
    if (distractors.length >= 2) break;
    if (usedLetters.has(cand.letter) || usedEmojis.has(cand.exampleEmoji)) continue;
    usedLetters.add(cand.letter);
    usedEmojis.add(cand.exampleEmoji);
    distractors.push(cand);
  }

  return shuffleOptionsWithAntiStreak(
    [target, ...distractors],
    (entry) => entry.letter === target.letter,
    previousCorrectIndex,
    rng,
  );
}

/**
 * Update per-letter mastery after completing the 3-step sequential letter review.
 * Never demotes an already-mastered letter; promotes on clean Voice AI pass or 2 clean offline passes.
 */
export function applyLetterReviewResult(
  prev: LetterMasteryEntry | undefined,
  params: {
    letter: string;
    perfectRound: boolean;
    usedVoiceAi: boolean;
    todayStr: string;
  },
): LetterMasteryEntry {
  const correctCount = (prev?.correctCount ?? 0) + 1;
  const streak = params.perfectRound ? (prev?.streak ?? 0) + 1 : 0;
  const alreadyMastered = prev?.status === 'mastered';
  const promoted = params.perfectRound && (params.usedVoiceAi || streak >= 2);
  const status: LetterMasteryStatus =
    alreadyMastered || promoted ? 'mastered' : 'practiced';

  return {
    letter: params.letter,
    status,
    correctCount,
    streak,
    lastReviewedAt: params.todayStr,
  };
}

/** Compute overall mastery counts and percentage across the 30-item Alifbe catalog. */
export function getAlphabetMasterySummary(
  letterMastery: Record<string, LetterMasteryEntry>,
  catalog: AlifbeLetterInfo[] = ALIFBE_LETTERS_29,
): {
  total: number;
  masteredCount: number;
  practicedCount: number;
  pct: number;
} {
  const total = catalog.length;
  let masteredCount = 0;
  let practicedCount = 0;

  for (const entry of catalog) {
    const st = letterMastery[entry.letter]?.status;
    if (st === 'mastered') {
      masteredCount += 1;
    } else if (st === 'practiced') {
      practicedCount += 1;
    }
  }

  const pct = total > 0 ? Math.round((masteredCount / total) * 100) : 0;
  return { total, masteredCount, practicedCount, pct };
}
