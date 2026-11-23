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
 * Shuffle an alphabet round queue via Fisher–Yates while avoiding repeating the exact
 * previous round order and avoiding boundary repeats (next[0] === prev[last]).
 */
export function shuffleAlphabetQueue(
  queue: readonly AlifbeLetterInfo[],
  previousRoundLetters: readonly string[] = [],
  rng: () => number = Math.random,
): AlifbeLetterInfo[] {
  if (queue.length <= 1) return [...queue];

  const prevLast =
    previousRoundLetters.length > 0
      ? (previousRoundLetters[previousRoundLetters.length - 1] ?? null)
      : null;
  const isSameAsPrev = (candidate: readonly AlifbeLetterInfo[]) =>
    previousRoundLetters.length === candidate.length &&
    candidate.every((entry, idx) => entry.letter === previousRoundLetters[idx]);

  for (let attempt = 0; attempt < 16; attempt++) {
    const candidate = fisherYatesShuffle(queue, rng);
    if (!isSameAsPrev(candidate) && (prevLast === null || candidate[0]!.letter !== prevLast)) {
      return candidate;
    }
  }

  for (let shift = 1; shift < queue.length; shift++) {
    const rotated = [...queue.slice(shift), ...queue.slice(0, shift)];
    if (!isSameAsPrev(rotated) && (prevLast === null || rotated[0]!.letter !== prevLast)) {
      return rotated;
    }
  }

  const fallback = [...queue.slice(1), queue[0]!];
  if (isSameAsPrev(fallback) && fallback.length > 1) {
    const tmp = fallback[0]!;
    fallback[0] = fallback[fallback.length - 1]!;
    fallback[fallback.length - 1] = tmp;
  }
  return fallback;
}

/**
 * Select a 5-letter queue for the interactive alphabet review game:
 * 1) Tapped-for-help unmastered letters (highest tap count first)
 * 2) Remaining unmastered letters in 1-sinf Alifbe textbook sequence (preferring letters not in `previousRoundLetters`)
 * 3) Oldest mastered letters as review backfill if fewer than `roundSize` remain
 * Optional `shuffleQueue` shuffles the selected round to prevent positional memorization.
 */
export function selectAlphabetReviewQueue(params: {
  catalog?: AlifbeLetterInfo[];
  letterHintCounts: Record<string, number>;
  letterMastery: Record<string, LetterMasteryEntry>;
  roundSize?: number;
  previousRoundLetters?: readonly string[];
  shuffleQueue?: boolean;
  rng?: () => number;
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

  let orderedOtherUnmastered = otherUnmastered;
  let orderedMastered = mastered;
  if (params.previousRoundLetters && params.previousRoundLetters.length > 0) {
    const recentSet = new Set(params.previousRoundLetters);
    orderedOtherUnmastered = [
      ...otherUnmastered.filter((entry) => !recentSet.has(entry.letter)),
      ...otherUnmastered.filter((entry) => recentSet.has(entry.letter)),
    ];
    orderedMastered = [
      ...mastered.filter((entry) => !recentSet.has(entry.letter)),
      ...mastered.filter((entry) => recentSet.has(entry.letter)),
    ];
  }

  const combined: AlifbeLetterInfo[] = [];
  const used = new Set<string>();

  for (const entry of [...tappedUnmastered, ...orderedOtherUnmastered, ...orderedMastered]) {
    if (combined.length >= roundSize) break;
    if (used.has(entry.letter)) continue;
    used.add(entry.letter);
    combined.push(entry);
  }

  if (params.shuffleQueue) {
    return shuffleAlphabetQueue(combined, params.previousRoundLetters, params.rng);
  }
  return combined;
}

export interface LetterQuizAntiRepeatOptions {
  previousSameStepCorrectIndex?: number | null;
  sameStepRepeatStreak?: number;
  recentDistractorLetters?: readonly string[];
}

/**
 * Pick 2 distinct distractors (preferring fresh distractors in the same letter category) and
 * shuffle via Fisher–Yates with anti-streak protection alongside `target` for 3-option quiz steps.
 */
export function buildLetterQuizChoices(
  target: AlifbeLetterInfo,
  catalog: AlifbeLetterInfo[] = ALIFBE_LETTERS_29,
  _seed?: string,
  previousCorrectIndex: number | null = null,
  rng: () => number = Math.random,
  antiRepeat?: LetterQuizAntiRepeatOptions,
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

  const recentDistSet = new Set(antiRepeat?.recentDistractorLetters ?? []);
  const freshSame = sameCategory.filter((entry) => !recentDistSet.has(entry.letter));
  const recentSame = sameCategory.filter((entry) => recentDistSet.has(entry.letter));
  const freshOther = otherCategory.filter((entry) => !recentDistSet.has(entry.letter));
  const recentOther = otherCategory.filter((entry) => recentDistSet.has(entry.letter));

  const orderedPool = [
    ...fisherYatesShuffle(freshSame, rng),
    ...fisherYatesShuffle(freshOther, rng),
    ...fisherYatesShuffle(recentSame, rng),
    ...fisherYatesShuffle(recentOther, rng),
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

  const shuffled = shuffleOptionsWithAntiStreak(
    [target, ...distractors],
    (entry) => entry.letter === target.letter,
    previousCorrectIndex,
    rng,
  );

  const prevSameIdx = antiRepeat?.previousSameStepCorrectIndex;
  if (
    shuffled.length >= 3 &&
    prevSameIdx !== null &&
    prevSameIdx !== undefined &&
    prevSameIdx >= 0 &&
    prevSameIdx < shuffled.length &&
    prevSameIdx !== previousCorrectIndex
  ) {
    const currentIdx = shuffled.findIndex((entry) => entry.letter === target.letter);
    if (currentIdx === prevSameIdx) {
      const altIndices: number[] = [];
      for (let i = 0; i < shuffled.length; i++) {
        if (i !== currentIdx && i !== previousCorrectIndex && i !== prevSameIdx) {
          altIndices.push(i);
        }
      }
      const shouldBreakRepeat =
        (antiRepeat?.sameStepRepeatStreak ?? 0) >= 1 || rng() < 0.75;
      if (altIndices.length > 0 && shouldBreakRepeat) {
        const raw = rng();
        const clamped = Number.isFinite(raw) ? Math.min(0.999999999999, Math.max(0, raw)) : 0;
        const swapIdx = altIndices[Math.floor(clamped * altIndices.length)]!;
        const tmp = shuffled[currentIdx]!;
        shuffled[currentIdx] = shuffled[swapIdx]!;
        shuffled[swapIdx] = tmp;
      }
    }
  }

  return shuffled;
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
