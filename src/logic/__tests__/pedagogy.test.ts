import { describe, expect, it } from 'vitest';
import { CURRICULUM_ITEMS, type CurriculumItem } from '../../data/curriculum';
import { createInitialState } from '../../storage/progressStorage';
import {
  isParentSessionExpired,
  PARENT_SESSION_TIMEOUT_MS,
  shouldCloseParentSessionOnEvent,
} from '../parentSession';
import {
  addDaysIso,
  applyNeedsMorePractice,
  applyUnverifiedAttempt,
  applyVerifiedCompletion,
  canNavigateToNextLesson,
  clampUnverifiedCap,
  computeBulkParentConfirmation,
  computeUnverifiedCompletion,
  computeVerifiedCompletion,
  createInitialEarChoiceState,
  DEFAULT_UNVERIFIED_CAP,
  EAR_ADVANCE_MIN_MS,
  evaluateEarChoice,
  evaluateSpeechResult,
  evaluateUnverifiedSelfConfirm,
  getDistractors,
  getNextRecommendedItem,
  getReviewQueue,
  getUnverifiedAheadCount,
  isBlockedByUnverifiedCap,
  MAX_UNVERIFIED_AHEAD,
  MAX_UNVERIFIED_CAP,
  MIN_UNVERIFIED_CAP,
  normalizeUzbek,
  UNVERIFIED_PRAISE_MIN_MS,
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
    expect(shouldCloseParentSessionOnEvent('parent_area_exited')).toBe(true);
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

describe('Phase A1: Step 2 "Eshitib top" choice locking and double-tap protection', () => {
  it('never locks on wrong choice, locks all options on correct choice, and ignores double taps', () => {
    expect(EAR_ADVANCE_MIN_MS).toBeGreaterThanOrEqual(1200);
    let state = createInitialEarChoiceState();
    expect(state.locked).toBe(false);

    // Wrong choice does not lock options
    const wrong = evaluateEarChoice(state, 'a', 'o');
    expect(wrong.outcome).toBe('wrong');
    expect(wrong.shouldAdvance).toBe(false);
    expect(wrong.state.locked).toBe(false);
    expect(wrong.state.wrongChoiceId).toBe('o');
    state = wrong.state;

    // Correct choice locks all options and signals advance
    const correct = evaluateEarChoice(state, 'a', 'a');
    expect(correct.outcome).toBe('correct');
    expect(correct.shouldAdvance).toBe(true);
    expect(correct.state.locked).toBe(true);
    expect(correct.state.wrongChoiceId).toBeNull();
    state = correct.state;

    // Subsequent tap on another option or double-tap on target is ignored and never unlocks
    const afterWrong = evaluateEarChoice(state, 'a', 'i');
    expect(afterWrong.outcome).toBe('ignored_locked');
    expect(afterWrong.shouldAdvance).toBe(false);
    expect(afterWrong.state).toEqual(state);

    const doubleTap = evaluateEarChoice(state, 'a', 'a');
    expect(doubleTap.outcome).toBe('ignored_locked');
    expect(doubleTap.shouldAdvance).toBe(false);
    expect(doubleTap.state).toEqual(state);
  });
});

describe('Phase A4: configurable cap, unverified replay upgrade, and StrictMode-safe transitions', () => {
  it('clamps unverified cap to 1..10 with default 3 and applies custom caps', () => {
    expect(DEFAULT_UNVERIFIED_CAP).toBe(3);
    expect(MIN_UNVERIFIED_CAP).toBe(1);
    expect(MAX_UNVERIFIED_CAP).toBe(10);
    expect(clampUnverifiedCap(0)).toBe(1);
    expect(clampUnverifiedCap(-4)).toBe(1);
    expect(clampUnverifiedCap(15)).toBe(10);
    expect(clampUnverifiedCap(Number.NaN)).toBe(3);
    expect(clampUnverifiedCap(5)).toBe(5);

    const oneUnverified: Record<string, ItemProgress> = {
      a: applyUnverifiedAttempt(undefined, 'a', '2026-11-17T06:00:00Z').itemProgress,
    };
    expect(isBlockedByUnverifiedCap(CURRICULUM_ITEMS, oneUnverified, 1)).toBe(true);
    expect(getNextRecommendedItem(CURRICULUM_ITEMS, oneUnverified, 1)).toBeNull();
    expect(isBlockedByUnverifiedCap(CURRICULUM_ITEMS, oneUnverified, 3)).toBe(false);
    expect(getNextRecommendedItem(CURRICULUM_ITEMS, oneUnverified, 3)?.id).toBe('o');
  });

  it('upgrades a replayed unverified lesson via AI acceptance, removes it from cap count, and unblocks navigation', () => {
    const progressMap: Record<string, ItemProgress> = {
      a: applyVerifiedCompletion(undefined, {
        itemId: 'a',
        starsEarned: 3,
        voiceAttemptsDelta: 1,
        parentVerified: false,
        latencyMs: 60,
        nowIso: '2026-11-17T06:00:00Z',
      }).itemProgress,
      o: applyVerifiedCompletion(undefined, {
        itemId: 'o',
        starsEarned: 3,
        voiceAttemptsDelta: 1,
        parentVerified: false,
        latencyMs: 65,
        nowIso: '2026-11-17T06:01:00Z',
      }).itemProgress,
      i: applyUnverifiedAttempt(undefined, 'i', '2026-11-17T06:02:00Z').itemProgress,
      u: applyUnverifiedAttempt(undefined, 'u', '2026-11-17T06:03:00Z').itemProgress,
      e: applyUnverifiedAttempt(undefined, 'e', '2026-11-17T06:04:00Z').itemProgress,
    };

    expect(getUnverifiedAheadCount(CURRICULUM_ITEMS, progressMap)).toBe(3);
    expect(isBlockedByUnverifiedCap(CURRICULUM_ITEMS, progressMap, 3)).toBe(true);

    // Already-unlocked lessons remain navigable from A->O->I->U->E even while capped; E->OI is locked
    expect(canNavigateToNextLesson(CURRICULUM_ITEMS, progressMap, 'a', 3)?.id).toBe('o');
    expect(canNavigateToNextLesson(CURRICULUM_ITEMS, progressMap, 'o', 3)?.id).toBe('i');
    expect(canNavigateToNextLesson(CURRICULUM_ITEMS, progressMap, 'e', 3)).toBeNull();

    // Replay 'e' while AI is online and accepted -> upgrades to mastered & drops unverified count to 2
    const upgraded = computeVerifiedCompletion({
      items: CURRICULUM_ITEMS,
      progressByItem: progressMap,
      totalStars: 6,
      unverifiedCap: 3,
      itemId: 'e',
      starsEarned: 3,
      voiceAttemptsDelta: 1,
      parentVerified: false,
      latencyMs: 70,
      nowIso: '2026-11-17T06:05:00Z',
    });

    expect(upgraded.itemProgress.mastered).toBe(true);
    expect(upgraded.itemProgress.status).toBe('mastered');
    expect(getUnverifiedAheadCount(CURRICULUM_ITEMS, upgraded.nextProgressByItem)).toBe(2);
    expect(upgraded.blockedByCap).toBe(false);
    expect(upgraded.nextRecommendedItem?.id).toBe('oi');
    expect(canNavigateToNextLesson(CURRICULUM_ITEMS, upgraded.nextProgressByItem, 'e', 3)?.id).toBe('oi');
  });

  it('computes pure transitions identically under StrictMode double invocation without mutating inputs', () => {
    const existingItem = Object.freeze(
      applyUnverifiedAttempt(undefined, 'a', '2026-11-17T06:00:00Z').itemProgress,
    );
    const frozenMap = Object.freeze({ a: existingItem }) as Record<string, ItemProgress>;
    const snapshot = JSON.stringify(frozenMap);

    // 1) computeUnverifiedCompletion called twice on the same prev snapshot (StrictMode updater replay)
    const u1 = computeUnverifiedCompletion({
      items: CURRICULUM_ITEMS,
      progressByItem: frozenMap,
      totalEffortStars: 1,
      unverifiedCap: 3,
      itemId: 'o',
      nowIso: '2026-11-17T06:10:00Z',
    });
    const u2 = computeUnverifiedCompletion({
      items: CURRICULUM_ITEMS,
      progressByItem: frozenMap,
      totalEffortStars: 1,
      unverifiedCap: 3,
      itemId: 'o',
      nowIso: '2026-11-17T06:10:00Z',
    });

    expect(JSON.stringify(frozenMap)).toBe(snapshot);
    expect(u1).toEqual(u2);
    expect(u1.nextTotalEffortStars).toBe(2);
    expect(u1.nextRecommendedItem?.id).toBe('i');

    // 2) computeVerifiedCompletion called twice on the same prev snapshot (StrictMode updater replay)
    const v1 = computeVerifiedCompletion({
      items: CURRICULUM_ITEMS,
      progressByItem: frozenMap,
      totalStars: 0,
      unverifiedCap: 3,
      itemId: 'a',
      starsEarned: 3,
      voiceAttemptsDelta: 1,
      parentVerified: false,
      latencyMs: 65,
      nowIso: '2026-11-17T06:12:00Z',
    });
    const v2 = computeVerifiedCompletion({
      items: CURRICULUM_ITEMS,
      progressByItem: frozenMap,
      totalStars: 0,
      unverifiedCap: 3,
      itemId: 'a',
      starsEarned: 3,
      voiceAttemptsDelta: 1,
      parentVerified: false,
      latencyMs: 65,
      nowIso: '2026-11-17T06:12:00Z',
    });

    expect(JSON.stringify(frozenMap)).toBe(snapshot);
    expect(v1).toEqual(v2);
    expect(v1.nextTotalStars).toBe(3);
    expect(v1.itemProgress.voiceAttempts).toBe(1);
    expect(v1.itemProgress.mastered).toBe(true);
    expect(v1.nextRecommendedItem?.id).toBe('o');
  });
});

describe('Phase A5: Step 4 offline self-confirm praise pause & double-tap protection', () => {
  it('allows first offline tap, enforces >= 1.2s praise minimum, ignores double taps, and blocks when AI is online', () => {
    expect(UNVERIFIED_PRAISE_MIN_MS).toBeGreaterThanOrEqual(1200);

    const firstTap = evaluateUnverifiedSelfConfirm({
      aiOnline: false,
      parentSessionActive: false,
      completedKind: null,
    });
    expect(firstTap).toEqual({
      allowed: true,
      reason: 'confirmed_effort',
      nextCompletedKind: 'unverified',
      starsEarned: 1,
      shouldScheduleAdvance: true,
    });

    const doubleTap = evaluateUnverifiedSelfConfirm({
      aiOnline: false,
      parentSessionActive: false,
      completedKind: 'unverified',
    });
    expect(doubleTap).toEqual({
      allowed: false,
      reason: 'ignored_double_tap',
      nextCompletedKind: 'unverified',
      starsEarned: 0,
      shouldScheduleAdvance: false,
    });

    const blockedOnline = evaluateUnverifiedSelfConfirm({
      aiOnline: true,
      parentSessionActive: false,
      completedKind: null,
    });
    expect(blockedOnline.allowed).toBe(false);
    expect(blockedOnline.reason).toBe('online_or_parent_mode');

    const blockedParentMode = evaluateUnverifiedSelfConfirm({
      aiOnline: false,
      parentSessionActive: true,
      completedKind: null,
    });
    expect(blockedParentMode.allowed).toBe(false);
    expect(blockedParentMode.reason).toBe('online_or_parent_mode');
  });
});

describe('Phase B: "Yana mashq qilsin", confirmation sources, and 1-day bulk spaced review', () => {
  it('resets an unverified lesson to not-completed on "Yana mashq qilsin" without letting a parent bypass the cap', () => {
    const baseMap: Record<string, ItemProgress> = {
      a: applyVerifiedCompletion(undefined, {
        itemId: 'a',
        starsEarned: 3,
        voiceAttemptsDelta: 1,
        parentVerified: true,
        confirmationSource: 'parent_single',
        latencyMs: null,
        nowIso: '2026-11-17T06:00:00.000Z',
      }).itemProgress,
      o: applyVerifiedCompletion(undefined, {
        itemId: 'o',
        starsEarned: 3,
        voiceAttemptsDelta: 1,
        parentVerified: true,
        confirmationSource: 'parent_single',
        latencyMs: null,
        nowIso: '2026-11-17T06:01:00.000Z',
      }).itemProgress,
      i: applyUnverifiedAttempt(undefined, 'i', '2026-11-17T06:02:00.000Z').itemProgress,
      u: applyUnverifiedAttempt(undefined, 'u', '2026-11-17T06:03:00.000Z').itemProgress,
      e: applyUnverifiedAttempt(undefined, 'e', '2026-11-17T06:04:00.000Z').itemProgress,
    };

    expect(getUnverifiedAheadCount(CURRICULUM_ITEMS, baseMap)).toBe(3);
    expect(isBlockedByUnverifiedCap(CURRICULUM_ITEMS, baseMap, 3)).toBe(true);
    expect(getNextRecommendedItem(CURRICULUM_ITEMS, baseMap, 3)).toBeNull();

    // 1) Parent marks 'i' as "Yana mashq qilsin": resets 'i' to undefined, drops count 3 -> 2, and recommends 'i' (NOT 'oi'!)
    const resetI = applyNeedsMorePractice({
      items: CURRICULUM_ITEMS,
      progressByItem: baseMap,
      unverifiedCap: 3,
      itemId: 'i',
    });
    expect(resetI.applied).toBe(true);
    expect(resetI.nextProgressByItem.i).toBeUndefined();
    expect(resetI.unverifiedAheadCount).toBe(2);
    expect(resetI.blockedByCap).toBe(false);
    expect(resetI.nextRecommendedItem?.id).toBe('i');
    expect(canNavigateToNextLesson(CURRICULUM_ITEMS, resetI.nextProgressByItem, 'e', 3)).toBeNull();

    // 2) Child completes 'i' offline again -> cap is immediately 3/3 again, 'oi' stays locked
    const recompletedI = computeUnverifiedCompletion({
      items: CURRICULUM_ITEMS,
      progressByItem: resetI.nextProgressByItem,
      totalEffortStars: 3,
      unverifiedCap: 3,
      itemId: 'i',
      nowIso: '2026-11-17T06:06:00.000Z',
    });
    expect(recompletedI.blockedByCap).toBe(true);
    expect(recompletedI.nextRecommendedItem).toBeNull();
    expect(canNavigateToNextLesson(CURRICULUM_ITEMS, recompletedI.nextProgressByItem, 'e', 3)).toBeNull();

    // 3) Parent marks 'e' (last unverified item) as "Yana mashq qilsin": recommends 'e', 'oi' still locked
    const resetE = applyNeedsMorePractice({
      items: CURRICULUM_ITEMS,
      progressByItem: baseMap,
      unverifiedCap: 3,
      itemId: 'e',
    });
    expect(resetE.applied).toBe(true);
    expect(resetE.nextProgressByItem.e).toBeUndefined();
    expect(resetE.unverifiedAheadCount).toBe(2);
    expect(resetE.nextRecommendedItem?.id).toBe('e');
    expect(canNavigateToNextLesson(CURRICULUM_ITEMS, resetE.nextProgressByItem, 'u', 3)?.id).toBe('e');
    expect(canNavigateToNextLesson(CURRICULUM_ITEMS, resetE.nextProgressByItem, 'e', 3)).toBeNull();

    // 4) Resetting all three unverified lessons drops count to 0, recommends 'i', and 'oi' remains locked
    let cleared = baseMap;
    for (const id of ['i', 'u', 'e']) {
      cleared = applyNeedsMorePractice({
        items: CURRICULUM_ITEMS,
        progressByItem: cleared,
        unverifiedCap: 3,
        itemId: id,
      }).nextProgressByItem;
    }
    expect(getUnverifiedAheadCount(CURRICULUM_ITEMS, cleared)).toBe(0);
    expect(getNextRecommendedItem(CURRICULUM_ITEMS, cleared, 3)?.id).toBe('i');
    expect(canNavigateToNextLesson(CURRICULUM_ITEMS, cleared, 'e', 3)).toBeNull();

    // 5) Calling "Yana mashq qilsin" on already mastered 'a' is a no-op
    const noOpMastered = applyNeedsMorePractice({
      items: CURRICULUM_ITEMS,
      progressByItem: baseMap,
      unverifiedCap: 3,
      itemId: 'a',
    });
    expect(noOpMastered.applied).toBe(false);
    expect(noOpMastered.nextProgressByItem.a?.mastered).toBe(true);
  });

  it('stores confirmationSource (ai, parent_single, parent_bulk) and enforces PIN + dialog guards on bulk confirm', () => {
    const aiProg = applyVerifiedCompletion(undefined, {
      itemId: 'a',
      starsEarned: 3,
      voiceAttemptsDelta: 1,
      parentVerified: false,
      confirmationSource: 'ai',
      latencyMs: 55,
      nowIso: '2026-11-17T08:00:00.000Z',
    }).itemProgress;
    expect(aiProg.confirmationSource).toBe('ai');
    expect(aiProg.parentVerified).toBe(false);

    const singleProg = applyVerifiedCompletion(
      applyUnverifiedAttempt(undefined, 'o', '2026-11-17T07:00:00.000Z').itemProgress,
      {
        itemId: 'o',
        starsEarned: 3,
        voiceAttemptsDelta: 0,
        parentVerified: true,
        confirmationSource: 'parent_single',
        latencyMs: null,
        nowIso: '2026-11-17T08:00:00.000Z',
      },
    ).itemProgress;
    expect(singleProg.confirmationSource).toBe('parent_single');
    expect(singleProg.parentVerified).toBe(true);

    const unverifiedMap: Record<string, ItemProgress> = {
      i: applyUnverifiedAttempt(undefined, 'i', '2026-11-17T07:10:00.000Z').itemProgress,
      u: applyUnverifiedAttempt(undefined, 'u', '2026-11-17T07:15:00.000Z').itemProgress,
    };

    // Guard 1: parentUnlocked === false -> rejected
    const blockedNoPin = computeBulkParentConfirmation({
      parentUnlocked: false,
      confirmedByDialog: true,
      items: CURRICULUM_ITEMS,
      progressByItem: unverifiedMap,
      totalStars: 6,
      unverifiedCap: 3,
      nowIso: '2026-11-17T08:00:00.000Z',
    });
    expect(blockedNoPin.applied).toBe(false);
    expect(blockedNoPin.confirmedItemIds).toEqual([]);
    expect(blockedNoPin.nextProgressByItem.i?.mastered).toBe(false);

    // Guard 2: confirmedByDialog === false -> rejected
    const blockedNoDialog = computeBulkParentConfirmation({
      parentUnlocked: true,
      confirmedByDialog: false,
      items: CURRICULUM_ITEMS,
      progressByItem: unverifiedMap,
      totalStars: 6,
      unverifiedCap: 3,
      nowIso: '2026-11-17T08:00:00.000Z',
    });
    expect(blockedNoDialog.applied).toBe(false);
    expect(blockedNoDialog.nextProgressByItem.u?.mastered).toBe(false);

    // Both PIN unlocked and dialog confirmed -> confirms all unverified items as parent_bulk with 1-day review
    const bulkApplied = computeBulkParentConfirmation({
      parentUnlocked: true,
      confirmedByDialog: true,
      items: CURRICULUM_ITEMS,
      progressByItem: unverifiedMap,
      totalStars: 6,
      unverifiedCap: 3,
      nowIso: '2026-11-17T08:00:00.000Z',
    });
    expect(bulkApplied.applied).toBe(true);
    expect(bulkApplied.confirmedItemIds).toEqual(['i', 'u']);
    expect(bulkApplied.starsDelta).toBe(6);
    expect(bulkApplied.nextTotalStars).toBe(12);
    expect(bulkApplied.nextProgressByItem.i?.confirmationSource).toBe('parent_bulk');
    expect(bulkApplied.nextProgressByItem.u?.confirmationSource).toBe('parent_bulk');
    expect(bulkApplied.nextProgressByItem.i?.nextReviewAt).toBe(
      addDaysIso('2026-11-17T08:00:00.000Z', 1),
    );
  });

  it('starts spaced review after 1 day for bulk-confirmed items vs 3 days for single-confirmed items', () => {
    const t0 = '2026-11-17T08:00:00.000Z';
    const map: Record<string, ItemProgress> = {
      a: applyVerifiedCompletion(undefined, {
        itemId: 'a',
        starsEarned: 3,
        voiceAttemptsDelta: 0,
        parentVerified: true,
        confirmationSource: 'parent_single',
        latencyMs: null,
        nowIso: t0,
      }).itemProgress,
      o: applyVerifiedCompletion(undefined, {
        itemId: 'o',
        starsEarned: 3,
        voiceAttemptsDelta: 0,
        parentVerified: true,
        confirmationSource: 'parent_bulk',
        latencyMs: null,
        nowIso: t0,
      }).itemProgress,
    };

    // Same day (+12h): neither is due yet
    expect(
      getReviewQueue(CURRICULUM_ITEMS, map, '2026-11-17T20:00:00.000Z').map((x) => x.id),
    ).toEqual([]);

    // After 1 day: bulk-confirmed 'o' becomes due first
    expect(
      getReviewQueue(CURRICULUM_ITEMS, map, '2026-11-18T08:00:01.000Z').map((x) => x.id),
    ).toEqual(['o']);

    // After 3 days: both due, with bulk-confirmed 'o' still prioritized ahead of 'a'
    expect(
      getReviewQueue(CURRICULUM_ITEMS, map, '2026-11-20T08:00:01.000Z').map((x) => x.id),
    ).toEqual(['o', 'a']);
  });
});
