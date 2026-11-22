import { describe, expect, it } from 'vitest';
import { DYNAMIC_WORD_POOL } from '../../data/curriculum';
import {
  addLocalDays,
  applyParentWordVerification,
  applyWordReadingAttempt,
  computeAverageReadingSpeedSec,
  computeProblemGraphemes,
  evaluateReadingAttempt,
  isConfirmedAssistedWord,
  READING_THRESHOLDS,
  type WordProgress,
} from '../pedagogy';
import {
  addPracticedSeconds,
  evaluateScreenTimeLimit,
  getOfflineFallbackEmojiChoices,
  getVisualSplitParts,
  MAX_NEW_WORDS_PER_SESSION,
  selectAdaptiveSessionWords,
} from '../wordPoolEngine';

describe('Alifbo 2.2 mastery evaluation & dynamic timing thresholds', () => {
  it('awards mastered with growing interval (3 -> 8 -> 20) only on fast independent fluent reading', () => {
    const pass1 = evaluateReadingAttempt({
      syllableCount: 2,
      reactionMs: 1800,
      articulationMs: 1400, // <= 650 + 2*450 = 1550
      usedVisualSplit: false,
      usedAudioHint: false,
      spokenCadence: 'fluent',
      isCorrect: true,
    });
    expect(pass1.status).toBe('mastered');
    expect(pass1.nextIntervalDays).toBe(3);
    expect(pass1.pendingVoiceVerify).toBe(false);

    const pass2 = evaluateReadingAttempt({
      syllableCount: 2,
      reactionMs: 1200,
      articulationMs: 1300,
      usedVisualSplit: false,
      usedAudioHint: false,
      spokenCadence: 'fluent',
      isCorrect: true,
      previousIntervalDays: 3,
    });
    expect(pass2.status).toBe('mastered');
    expect(pass2.nextIntervalDays).toBe(8);

    const pass3 = evaluateReadingAttempt({
      syllableCount: 2,
      reactionMs: 1100,
      articulationMs: 1200,
      usedVisualSplit: false,
      usedAudioHint: false,
      spokenCadence: 'fluent',
      isCorrect: true,
      previousIntervalDays: 8,
    });
    expect(pass3.nextIntervalDays).toBe(20);
  });

  it('caps at syllable when visual split was shown or cadence was syllable, and forces assisted on audio hint or spelled_out', () => {
    const splitFast = evaluateReadingAttempt({
      syllableCount: 2,
      reactionMs: 1000,
      articulationMs: 1100,
      usedVisualSplit: true,
      usedAudioHint: false,
      spokenCadence: 'fluent',
      isCorrect: true,
    });
    expect(splitFast.status).toBe('syllable');
    expect(splitFast.nextIntervalDays).toBe(1);

    const syllabicFast = evaluateReadingAttempt({
      syllableCount: 2,
      reactionMs: 1000,
      articulationMs: 1100,
      usedVisualSplit: false,
      usedAudioHint: false,
      spokenCadence: 'syllable',
      isCorrect: true,
    });
    expect(syllabicFast.status).toBe('syllable');

    const audioHintUsed = evaluateReadingAttempt({
      syllableCount: 2,
      reactionMs: 1000,
      articulationMs: 1100,
      usedVisualSplit: true,
      usedAudioHint: true,
      spokenCadence: 'fluent',
      isCorrect: true,
    });
    expect(audioHintUsed.status).toBe('assisted');
    expect(audioHintUsed.nextIntervalDays).toBe(0);

    const spelledOut = evaluateReadingAttempt({
      syllableCount: 2,
      reactionMs: 1000,
      articulationMs: 1100,
      usedVisualSplit: false,
      usedAudioHint: false,
      spokenCadence: 'spelled_out',
      isCorrect: true,
    });
    expect(spelledOut.status).toBe('assisted');
  });

  it('grants mastered after 2 consecutive careful independent passes (fairness for slower 6-7yo readers) and allows inter-word pauses in World 5 sentences', () => {
    const firstCareful = evaluateReadingAttempt({
      syllableCount: 2,
      reactionMs: 4100, // > 3500ms, within syllableLimit (3000ms art)
      articulationMs: 2400,
      usedVisualSplit: false,
      usedAudioHint: false,
      spokenCadence: 'fluent',
      isCorrect: true,
    });
    expect(firstCareful.status).toBe('syllable');
    expect(firstCareful.nextFluentStreak).toBe(1);

    const secondCareful = evaluateReadingAttempt({
      syllableCount: 2,
      reactionMs: 3900,
      articulationMs: 2200,
      usedVisualSplit: false,
      usedAudioHint: false,
      spokenCadence: 'fluent',
      isCorrect: true,
      previousStatus: 'syllable',
      previousFluentStreak: firstCareful.nextFluentStreak,
    });
    expect(secondCareful.status).toBe('mastered');
    expect(secondCareful.nextIntervalDays).toBe(3);

    // 3-word, 6-syllable World 5 sentence: masteredLimit = 650 + 6*450 + (3-1)*350 = 4050ms
    const sentenceFluent = evaluateReadingAttempt({
      syllableCount: 6,
      wordCount: 3,
      reactionMs: 2500,
      articulationMs: 3950,
      usedVisualSplit: false,
      usedAudioHint: false,
      spokenCadence: 'fluent',
      isCorrect: true,
    });
    expect(sentenceFluent.status).toBe('mastered');
  });

  it('hardens offline 4-picture fallback: never grants mastered, requires 2 clean passes for syllable, resets streak on wrong tap, and supports PIN parent verify', () => {
    const offlinePass1 = evaluateReadingAttempt({
      syllableCount: 2,
      reactionMs: 2000,
      articulationMs: 0,
      usedVisualSplit: false,
      usedAudioHint: false,
      isOfflineFallback: true,
      offlineWrongTaps: 0,
      isCorrect: true,
      previousOfflineStreak: 0,
    });
    expect(offlinePass1.status).toBe('assisted');
    expect(offlinePass1.pendingVoiceVerify).toBe(true);
    expect(offlinePass1.nextOfflineStreak).toBe(1);

    const offlinePass2 = evaluateReadingAttempt({
      syllableCount: 2,
      reactionMs: 2000,
      articulationMs: 0,
      usedVisualSplit: false,
      usedAudioHint: false,
      isOfflineFallback: true,
      offlineWrongTaps: 0,
      isCorrect: true,
      previousOfflineStreak: offlinePass1.nextOfflineStreak,
    });
    expect(offlinePass2.status).toBe('syllable');
    expect(offlinePass2.pendingVoiceVerify).toBe(true);
    expect(offlinePass2.nextIntervalDays).toBe(1);

    const offlineWithWrongTap = evaluateReadingAttempt({
      syllableCount: 2,
      reactionMs: 2000,
      articulationMs: 0,
      usedVisualSplit: false,
      usedAudioHint: false,
      isOfflineFallback: true,
      offlineWrongTaps: 1,
      isCorrect: true,
      previousOfflineStreak: 1,
    });
    expect(offlineWithWrongTap.status).toBe('assisted');
    expect(offlineWithWrongTap.nextOfflineStreak).toBe(0);

    // Parent verification resolves pendingVoiceVerify cleanly
    const wp = applyWordReadingAttempt(undefined, 'kitob', offlinePass2, { todayStr: '2026-11-19' });
    expect(wp.pendingVoiceVerify).toBe(true);
    const parentConfirmed = applyParentWordVerification(wp, 'kitob', true, '2026-11-19');
    expect(parentConfirmed.status).toBe('mastered');
    expect(parentConfirmed.pendingVoiceVerify).toBe(false);
    expect(parentConfirmed.nextReviewDate).toBe(addLocalDays('2026-11-19', 3));

    const parentRetry = applyParentWordVerification(wp, 'kitob', false, '2026-11-19');
    expect(parentRetry.status).toBe('assisted');
    expect(parentRetry.pendingVoiceVerify).toBe(false);
  });
});

describe('Alifbo 2.2 adaptive 2:2:1 session selector, offline 4 choices, diagnostics & clock protection', () => {
  it('enforces Cold-Start MAX_NEW_WORDS_PER_SESSION = 3 when no prior progress exists', () => {
    expect(MAX_NEW_WORDS_PER_SESSION).toBe(3);
    const session = selectAdaptiveSessionWords({
      worldId: 1,
      pool: DYNAMIC_WORD_POOL,
      wordProgressMap: {},
      todayStr: '2026-11-19',
    });
    expect(session).toHaveLength(3);
    expect(session.every((s) => s.sourceBucket === 'new' && !s.expressExamOnly)).toBe(true);
  });

  it('builds a 2:2:1 session, sets expressExamOnly for mastered & pendingVoiceVerify, and prioritizes pendingVoiceVerify', () => {
    const w1 = DYNAMIC_WORD_POOL.filter((i) => i.worldId === 1);
    const progressMap: Record<string, WordProgress> = {
      [w1[0]!.id]: {
        wordId: w1[0]!.id,
        status: 'assisted',
        reviewIntervalDays: 0,
        nextReviewDate: '2026-11-19',
        attemptCount: 1,
        assistedCount: 1,
      },
      [w1[1]!.id]: {
        wordId: w1[1]!.id,
        status: 'syllable',
        reviewIntervalDays: 1,
        nextReviewDate: '2026-11-19',
        attemptCount: 1,
        assistedCount: 0,
        pendingVoiceVerify: true,
      },
      [w1[2]!.id]: {
        wordId: w1[2]!.id,
        status: 'mastered',
        reviewIntervalDays: 3,
        nextReviewDate: '2026-11-19',
        attemptCount: 2,
        assistedCount: 0,
      },
      [w1[3]!.id]: {
        wordId: w1[3]!.id,
        status: 'mastered',
        reviewIntervalDays: 3,
        nextReviewDate: '2026-11-18',
        attemptCount: 1,
        assistedCount: 0,
      },
      [w1[4]!.id]: {
        wordId: w1[4]!.id,
        status: 'mastered',
        reviewIntervalDays: 3,
        nextReviewDate: '2026-11-25', // not due yet
        attemptCount: 1,
        assistedCount: 0,
      },
    };

    const session = selectAdaptiveSessionWords({
      worldId: 1,
      pool: DYNAMIC_WORD_POOL,
      wordProgressMap: progressMap,
      todayStr: '2026-11-19',
    });

    expect(session).toHaveLength(5);
    expect(session.filter((s) => s.sourceBucket === 'assisted_or_syllable')).toHaveLength(2);
    expect(session.filter((s) => s.sourceBucket === 'mastered_review')).toHaveLength(2);
    expect(session.filter((s) => s.sourceBucket === 'new')).toHaveLength(1);

    // pendingVoiceVerify item comes first and goes straight to expressExamOnly
    expect(session[0]?.item.id).toBe(w1[1]!.id);
    expect(session[0]?.expressExamOnly).toBe(true);
    // assisted item goes through full 3-stage pipeline
    expect(session[1]?.item.id).toBe(w1[0]!.id);
    expect(session[1]?.expressExamOnly).toBe(false);
    // mastered items go straight to expressExamOnly
    expect(session[2]?.expressExamOnly).toBe(true);
    expect(session[3]?.expressExamOnly).toBe(true);
    // not-due item is not included while due/new items fill the quota
    expect(session.map((s) => s.item.id)).not.toContain(w1[4]!.id);
  });

  it('returns 4 unique emoji choices for every item in Offline Fallback and falls back to parts on 1-syllable visual split', () => {
    for (const item of DYNAMIC_WORD_POOL) {
      const choices = getOfflineFallbackEmojiChoices(item, DYNAMIC_WORD_POOL);
      expect(choices).toHaveLength(4);
      expect(new Set(choices).size).toBe(4);
      expect(choices).toContain(item.emoji);
    }

    const qor = DYNAMIC_WORD_POOL.find((i) => i.id === 'qor')!;
    expect(qor.syllables).toEqual(['QOR']);
    expect(getVisualSplitParts(qor)).toEqual(['QO', 'R']);

    const kitob = DYNAMIC_WORD_POOL.find((i) => i.id === 'kitob')!;
    expect(getVisualSplitParts(kitob)).toEqual(['KI', 'TOB']);
  });

  it('computes relative problem graphemes (>=3 words, >=40% error rate) and 0.1s average speed', () => {
    // 'k' appears in 4 attempted words with 3 assisted (75% -> flagged)
    // 'o' appears in 4 attempted words with 1 assisted (25% -> NOT flagged)
    // 'z' appears in only 2 attempted words with 2 assisted (100% but <3 words -> NOT flagged)
    const map: Record<string, WordProgress> = {
      kema: { wordId: 'kema', status: 'assisted', reviewIntervalDays: 0, nextReviewDate: '2026-11-19', attemptCount: 1, assistedCount: 1 },
      kaktus: { wordId: 'kaktus', status: 'assisted', reviewIntervalDays: 0, nextReviewDate: '2026-11-19', attemptCount: 1, assistedCount: 1 },
      kosa: { wordId: 'kosa', status: 'assisted', reviewIntervalDays: 0, nextReviewDate: '2026-11-19', attemptCount: 1, assistedCount: 1 },
      kalit: { wordId: 'kalit', status: 'mastered', reviewIntervalDays: 3, nextReviewDate: '2026-11-22', attemptCount: 1, assistedCount: 0 },
      olma: { wordId: 'olma', status: 'mastered', reviewIntervalDays: 3, nextReviewDate: '2026-11-22', attemptCount: 1, assistedCount: 0 },
      lola: { wordId: 'lola', status: 'mastered', reviewIntervalDays: 3, nextReviewDate: '2026-11-22', attemptCount: 1, assistedCount: 0 },
      uzum: { wordId: 'uzum', status: 'assisted', reviewIntervalDays: 0, nextReviewDate: '2026-11-19', attemptCount: 1, assistedCount: 1 },
      uzuk: { wordId: 'uzuk', status: 'assisted', reviewIntervalDays: 0, nextReviewDate: '2026-11-19', attemptCount: 1, assistedCount: 1 },
    };

    const problems = computeProblemGraphemes(map, DYNAMIC_WORD_POOL, READING_THRESHOLDS);
    const graphemes = problems.map((p) => p.grapheme);
    expect(graphemes).toContain('k');
    expect(graphemes).not.toContain('o');
    expect(graphemes).not.toContain('z');
    expect(problems.length).toBeLessThanOrEqual(5);

    expect(computeAverageReadingSpeedSec([])).toBeNull();
    expect(computeAverageReadingSpeedSec([2100, 2400, 3000])).toBe(2.5);
  });

  it('prevents bypassing daily screen-time limit by setting system clock backwards', () => {
    const rolledBack = evaluateScreenTimeLimit({
      dailyLimitMinutes: 15,
      dailyPracticeDate: '2026-11-19',
      todayDateStr: '2026-11-18', // clock turned backward
      todayPracticedSeconds: 900,
    });
    expect(rolledBack.isLimitReached).toBe(true);
    expect(rolledBack.practicedSeconds).toBe(900);

    const addedDuringRollback = addPracticedSeconds({
      dailyPracticeDate: '2026-11-19',
      todayDateStr: '2026-11-18',
      todayPracticedSeconds: 800,
      deltaSeconds: 30,
    });
    expect(addedDuringRollback.dailyPracticeDate).toBe('2026-11-19');
    expect(addedDuringRollback.todayPracticedSeconds).toBe(830);
  });

  it('excludes offline pendingVoiceVerify words from Problem Graphemes and Home Practice List until parent rejects', () => {
    // 4 words with 'B' passed cleanly in offline 4-picture fallback (status='assisted', pendingVoiceVerify=true)
    const pendingMap: Record<string, WordProgress> = {
      bola: {
        wordId: 'bola',
        status: 'assisted',
        reviewIntervalDays: 0,
        nextReviewDate: '2026-11-21',
        attemptCount: 1,
        assistedCount: 1,
        offlineCorrectStreak: 1,
        pendingVoiceVerify: true,
      },
      bobo: {
        wordId: 'bobo',
        status: 'assisted',
        reviewIntervalDays: 0,
        nextReviewDate: '2026-11-21',
        attemptCount: 1,
        assistedCount: 1,
        offlineCorrectStreak: 1,
        pendingVoiceVerify: true,
      },
      kitob: {
        wordId: 'kitob',
        status: 'assisted',
        reviewIntervalDays: 0,
        nextReviewDate: '2026-11-21',
        attemptCount: 1,
        assistedCount: 1,
        offlineCorrectStreak: 1,
        pendingVoiceVerify: true,
      },
      bino: {
        wordId: 'bino',
        status: 'assisted',
        reviewIntervalDays: 0,
        nextReviewDate: '2026-11-21',
        attemptCount: 1,
        assistedCount: 1,
        offlineCorrectStreak: 1,
        pendingVoiceVerify: true,
      },
    };

    for (const prog of Object.values(pendingMap)) {
      expect(isConfirmedAssistedWord(prog)).toBe(false);
    }
    expect(computeProblemGraphemes(pendingMap, DYNAMIC_WORD_POOL, READING_THRESHOLDS)).toEqual([]);

    // Once parent marks those words as needing more practice (pendingVoiceVerify = false), 'b' IS flagged
    const confirmedAssistedMap: Record<string, WordProgress> = {
      bola: applyParentWordVerification(pendingMap.bola, 'bola', false, '2026-11-21'),
      bobo: applyParentWordVerification(pendingMap.bobo, 'bobo', false, '2026-11-21'),
      kitob: applyParentWordVerification(pendingMap.kitob, 'kitob', false, '2026-11-21'),
      bino: applyParentWordVerification(pendingMap.bino, 'bino', false, '2026-11-21'),
    };
    for (const prog of Object.values(confirmedAssistedMap)) {
      expect(isConfirmedAssistedWord(prog)).toBe(true);
    }
    const problems = computeProblemGraphemes(confirmedAssistedMap, DYNAMIC_WORD_POOL, READING_THRESHOLDS);
    expect(problems.map((p) => p.grapheme)).toContain('b');
  });
});
