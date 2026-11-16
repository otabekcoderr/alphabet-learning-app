import { describe, expect, it } from 'vitest';
import { CURRICULUM_ITEMS, type CurriculumItem } from '../../data/curriculum';
import { createInitialState } from '../../storage/progressStorage';
import {
  isParentSessionExpired,
  PARENT_SESSION_TIMEOUT_MS,
  shouldCloseParentSessionOnEvent,
} from '../parentSession';
import {
  applyUnverifiedAttempt,
  applyVerifiedCompletion,
  evaluateSpeechResult,
  getDistractors,
  getNextRecommendedItem,
  getReviewQueue,
  getUnverifiedAheadCount,
  isBlockedByUnverifiedCap,
  MAX_UNVERIFIED_AHEAD,
  normalizeUzbek,
  validateCurriculumDecodability,
  type ItemProgress,
} from '../pedagogy';

describe('curriculum decodability', () => {
  it('ensures all 48 lessons in CURRICULUM_ITEMS use only letters introduced in earlier or same letter lessons', () => {
    expect(CURRICULUM_ITEMS).toHaveLength(48);
    const report = validateCurriculumDecodability(CURRICULUM_ITEMS);
    expect(report.violations).toEqual([]);
    expect(report.valid).toBe(true);
  });

  it('fails if a syllable or word uses a letter not yet introduced in a letter lesson', () => {
    const badCurriculum: CurriculumItem[] = [
      CURRICULUM_ITEMS[0]!, // A (letter)
      {
        id: 'ba',
        stage: 1,
        kind: 'syllable',
        text: 'BA',
        parts: ['B', 'A'],
        accept: ['ba'],
        coachTipUz: '',
        audioTeacher: '',
        audioSound: '',
      },
      {
        id: 'suv',
        stage: 1,
        kind: 'word',
        text: 'SUV',
        parts: ['SU', 'V'],
        accept: ['suv'],
        coachTipUz: '',
        audioTeacher: '',
        audioSound: '',
      },
    ];

    const report = validateCurriculumDecodability(badCurriculum);
    expect(report.valid).toBe(false);
    expect(report.violations.map((v) => `${v.itemId}:${v.missingLetter}`)).toEqual([
      'ba:B',
      'suv:S',
      'suv:U',
      'suv:V',
    ]);
  });
});

describe('normalizeUzbek & evaluateSpeechResult', () => {
  it('lowercases, unifies Uzbek apostrophes, and strips punctuation', () => {
    expect(normalizeUzbek('Kitob.')).toBe('kitob');
    expect(normalizeUzbek('O‘g‘il!')).toBe("o'g'il");
    expect(normalizeUzbek('  MA  ')).toBe('ma');
  });

  it('accepts exact match and phonetic aliases without penalizing silence or mismatch', () => {
    expect(evaluateSpeechResult('MA', ['ma'], 'Ma.', false, 1).outcome).toBe('accepted');
    expect(evaluateSpeechResult('KITOB', ['kitob', 'kitop'], 'kitop', false, 2).starsEarned).toBe(2);
    expect(evaluateSpeechResult('B', ['b', 'be', 'bi'], 'be', false, 1).outcome).toBe('accepted');
    expect(evaluateSpeechResult('ONA', ['ona'], '', true, 1).starsEarned).toBe(0);
    expect(evaluateSpeechResult('MA', ['ma'], 'na', false, 2).outcome).toBe('try_again');
  });
});

describe('unverified 3-lesson cap and mastery/spaced-repetition isolation', () => {
  it('child unverified path never sets mastered=true and does not change the review queue', () => {
    const existingMastered = applyVerifiedCompletion(undefined, {
      itemId: 'a',
      starsEarned: 2,
      voiceAttemptsDelta: 2,
      parentVerified: false,
      latencyMs: 70,
      nowIso: '2026-11-16T06:00:00Z',
    }).itemProgress;

    const progressMap: Record<string, ItemProgress> = { a: existingMastered };
    const queueBefore = getReviewQueue(CURRICULUM_ITEMS, progressMap).map((i) => i.id);
    expect(queueBefore).toEqual(['a']);

    // Child completes 'o' and 'i' in unverified fallback mode
    progressMap.o = applyUnverifiedAttempt(undefined, 'o', '2026-11-16T06:05:00Z').itemProgress;
    progressMap.i = applyUnverifiedAttempt(undefined, 'i', '2026-11-16T06:06:00Z').itemProgress;

    expect(progressMap.o.mastered).toBe(false);
    expect(progressMap.o.status).toBe('unverified');
    expect(progressMap.o.effortStars).toBe(1);
    expect(progressMap.o.stars).toBe(0);

    // Spaced-repetition queue must remain completely unchanged
    const queueAfter = getReviewQueue(CURRICULUM_ITEMS, progressMap).map((i) => i.id);
    expect(queueAfter).toEqual(queueBefore);
  });

  it('allows up to 3 unverified lessons ahead of last mastered lesson and blocks on the 3rd until parent confirms', () => {
    expect(MAX_UNVERIFIED_AHEAD).toBe(3);
    const progressMap: Record<string, ItemProgress> = {
      a: applyVerifiedCompletion(undefined, {
        itemId: 'a',
        starsEarned: 3,
        voiceAttemptsDelta: 1,
        parentVerified: false,
        latencyMs: 65,
        nowIso: '2026-11-16T06:00:00Z',
      }).itemProgress,
      o: applyUnverifiedAttempt(undefined, 'o', '2026-11-16T06:01:00Z').itemProgress,
      i: applyUnverifiedAttempt(undefined, 'i', '2026-11-16T06:02:00Z').itemProgress,
    };

    expect(getUnverifiedAheadCount(CURRICULUM_ITEMS, progressMap)).toBe(2);
    expect(isBlockedByUnverifiedCap(CURRICULUM_ITEMS, progressMap)).toBe(false);
    expect(getNextRecommendedItem(CURRICULUM_ITEMS, progressMap)?.id).toBe('u');

    // 3rd unverified lesson triggers stop cap
    progressMap.u = applyUnverifiedAttempt(undefined, 'u', '2026-11-16T06:03:00Z').itemProgress;
    expect(getUnverifiedAheadCount(CURRICULUM_ITEMS, progressMap)).toBe(3);
    expect(isBlockedByUnverifiedCap(CURRICULUM_ITEMS, progressMap)).toBe(true);
    expect(getNextRecommendedItem(CURRICULUM_ITEMS, progressMap)).toBeNull();

    // Parent confirms 'o' inside PIN-protected area -> unverified ahead drops to 2 and unblocks
    progressMap.o = applyVerifiedCompletion(progressMap.o, {
      itemId: 'o',
      starsEarned: 3,
      voiceAttemptsDelta: 0,
      parentVerified: true,
      latencyMs: null,
      nowIso: '2026-11-16T06:04:00Z',
    }).itemProgress;

    expect(progressMap.o.mastered).toBe(true);
    expect(getUnverifiedAheadCount(CURRICULUM_ITEMS, progressMap)).toBe(2);
    expect(isBlockedByUnverifiedCap(CURRICULUM_ITEMS, progressMap)).toBe(false);
    expect(getNextRecommendedItem(CURRICULUM_ITEMS, progressMap)?.id).toBe('e');
    expect(getReviewQueue(CURRICULUM_ITEMS, progressMap).map((x) => x.id)).toEqual(['o']);
  });

  it('AI acceptance on multiple attempts updates mastered=true and adds item to review queue', () => {
    const verified = applyVerifiedCompletion(undefined, {
      itemId: 'ma',
      starsEarned: 2,
      voiceAttemptsDelta: 2,
      parentVerified: false,
      latencyMs: 80,
      nowIso: '2026-11-16T06:10:00Z',
    }).itemProgress;

    expect(verified.mastered).toBe(true);
    expect(getReviewQueue(CURRICULUM_ITEMS, { ma: verified }).map((x) => x.id)).toEqual(['ma']);
  });
});

describe('parent session auto-off and non-persistence', () => {
  it('expires after 3 minutes of inactivity and closes on lesson end, exit, or background events', () => {
    expect(PARENT_SESSION_TIMEOUT_MS).toBe(180_000);
    expect(isParentSessionExpired(1000, 1000 + 179_999)).toBe(false);
    expect(isParentSessionExpired(1000, 1000 + 180_000)).toBe(true);
    expect(isParentSessionExpired(null, 5000)).toBe(true);

    expect(shouldCloseParentSessionOnEvent('lesson_completed')).toBe(true);
    expect(shouldCloseParentSessionOnEvent('lesson_exited')).toBe(true);
    expect(shouldCloseParentSessionOnEvent('visibility_hidden')).toBe(true);
    expect(shouldCloseParentSessionOnEvent('window_blur')).toBe(true);
  });

  it('never persists parentSessionActive in localStorage state shape', () => {
    const initial = createInitialState();
    expect('parentSessionActive' in initial).toBe(false);
  });
});

describe('getDistractors', () => {
  it('returns 3 unique options including target item', () => {
    const target = CURRICULUM_ITEMS.find((i) => i.id === 'ma')!;
    const choices = getDistractors(target, CURRICULUM_ITEMS);
    expect(choices).toHaveLength(3);
    expect(choices.map((c) => c.id)).toContain('ma');
    expect(new Set(choices.map((c) => c.id)).size).toBe(3);
  });
});
