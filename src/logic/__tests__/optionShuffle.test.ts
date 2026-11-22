import { describe, expect, it } from 'vitest';
import { ALIFBE_LETTERS_29, DYNAMIC_WORD_POOL } from '../../data/curriculum';
import { buildLetterQuizChoices } from '../alphabetReview';
import { fisherYatesShuffle, shuffleOptionsWithAntiStreak } from '../optionShuffle';
import { getOfflineFallbackEmojiChoices } from '../wordPoolEngine';

describe('Fisher–Yates & Anti-Streak option shuffling across all games', () => {
  it('distributes the correct answer evenly across all 3 and 4 slots over 200 runs without sticking to index 0', () => {
    const threeOptions = ['CORRECT', 'DIST_1', 'DIST_2'] as const;
    const threeCounts = [0, 0, 0];

    for (let i = 0; i < 200; i++) {
      const shuffled = shuffleOptionsWithAntiStreak(threeOptions, (o) => o === 'CORRECT', null);
      expect(shuffled).toHaveLength(3);
      expect(new Set(shuffled).size).toBe(3);
      const idx = shuffled.indexOf('CORRECT');
      expect(idx).toBeGreaterThanOrEqual(0);
      threeCounts[idx] = (threeCounts[idx] ?? 0) + 1;
    }
    for (const count of threeCounts) {
      expect(count).toBeGreaterThan(25);
    }

    const fourOptions = ['TARGET', 'D1', 'D2', 'D3'] as const;
    const fourCounts = [0, 0, 0, 0];

    for (let i = 0; i < 200; i++) {
      const shuffled = shuffleOptionsWithAntiStreak(fourOptions, (o) => o === 'TARGET', null);
      expect(shuffled).toHaveLength(4);
      const idx = shuffled.indexOf('TARGET');
      expect(idx).toBeGreaterThanOrEqual(0);
      fourCounts[idx] = (fourCounts[idx] ?? 0) + 1;
    }
    for (const count of fourCounts) {
      expect(count).toBeGreaterThan(18);
    }
  });

  it('never places the correct answer at the same index twice in a row across 100 consecutive questions', () => {
    const options = ['TOGRI', 'XATO_A', 'XATO_B', 'XATO_C'] as const;
    let prevIdx: number | null = null;
    let streaks = 0;

    for (let i = 0; i < 100; i++) {
      const shuffled: Array<(typeof options)[number]> = shuffleOptionsWithAntiStreak(
        options,
        (o) => o === 'TOGRI',
        prevIdx,
      );
      const currentIdx: number = shuffled.indexOf('TOGRI');
      expect(currentIdx).toBeGreaterThanOrEqual(0);
      if (prevIdx !== null && currentIdx === prevIdx) {
        streaks++;
      }
      prevIdx = currentIdx;
    }

    expect(streaks).toBe(0);
  });

  it('applies anti-streak and full-slot distribution to Offline 4-Picture Exam and Alphabet Quiz choices', () => {
    const kitob = DYNAMIC_WORD_POOL.find((w) => w.id === 'kitob')!;
    const offlineIdxCounts = [0, 0, 0, 0];
    let prevOfflineIdx: number | null = null;
    let offlineStreaks = 0;

    for (let i = 0; i < 100; i++) {
      const choices = getOfflineFallbackEmojiChoices(kitob, DYNAMIC_WORD_POOL, prevOfflineIdx);
      expect(choices).toHaveLength(4);
      const idx = choices.indexOf(kitob.emoji);
      expect(idx).toBeGreaterThanOrEqual(0);
      if (prevOfflineIdx !== null && idx === prevOfflineIdx) {
        offlineStreaks++;
      }
      offlineIdxCounts[idx] = (offlineIdxCounts[idx] ?? 0) + 1;
      prevOfflineIdx = idx;
    }

    expect(offlineStreaks).toBe(0);
    for (const c of offlineIdxCounts) {
      expect(c).toBeGreaterThan(5);
    }

    const letterA = ALIFBE_LETTERS_29.find((l) => l.letter === 'A')!;
    const quizIdxCounts = [0, 0, 0];
    let prevQuizIdx: number | null = null;
    let quizStreaks = 0;

    for (let i = 0; i < 100; i++) {
      const choices = buildLetterQuizChoices(letterA, ALIFBE_LETTERS_29, undefined, prevQuizIdx);
      expect(choices).toHaveLength(3);
      const idx = choices.findIndex((c) => c.letter === letterA.letter);
      expect(idx).toBeGreaterThanOrEqual(0);
      if (prevQuizIdx !== null && idx === prevQuizIdx) {
        quizStreaks++;
      }
      quizIdxCounts[idx] = (quizIdxCounts[idx] ?? 0) + 1;
      prevQuizIdx = idx;
    }

    expect(quizStreaks).toBe(0);
    for (const c of quizIdxCounts) {
      expect(c).toBeGreaterThan(10);
    }
  });

  it('does not mutate the input array in fisherYatesShuffle', () => {
    const source = [1, 2, 3, 4, 5];
    const snapshot = [...source];
    const shuffled = fisherYatesShuffle(source);
    expect(source).toEqual(snapshot);
    expect(shuffled.sort((a, b) => a - b)).toEqual(snapshot);
  });
});
