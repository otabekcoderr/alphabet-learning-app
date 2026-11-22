import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALIFBE_LETTERS_29, DYNAMIC_WORD_POOL } from '../../data/curriculum';
import {
  applyLetterReviewResult,
  buildLetterQuizChoices,
  getAlphabetMasterySummary,
  selectAlphabetReviewQueue,
  type LetterMasteryEntry,
} from '../alphabetReview';
import {
  createMicAutoStopState,
  SENTENCE_FRIENDLY_MIC_CONFIG,
  stepMicAutoStop,
} from '../micAutoStop';
import {
  buildSentenceWordBank,
  getSentenceComprehensionPromptUz,
  getStage1GameMode,
} from '../wordPoolEngine';
import {
  createInitialState,
  loadAlifboState,
  saveAlifboState,
} from '../../storage/progressStorage';

function createMockLocalStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
  };
}

describe('Stage 1 Exercises: Alphabet Sequential Game, Train Slider & World 5 Sentence Builder', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('selects tapped unmastered letters first, follows Alifbe order, and backfills oldest mastered letters', () => {
    const masteryWithO: Record<string, LetterMasteryEntry> = {
      O: { letter: 'O', status: 'mastered', correctCount: 2, streak: 2, lastReviewedAt: '2026-11-18' },
    };

    const queue = selectAlphabetReviewQueue({
      catalog: ALIFBE_LETTERS_29,
      letterHintCounts: { CH: 4, SH: 2, O: 5 },
      letterMastery: masteryWithO,
      roundSize: 5,
    });

    // O is already mastered so CH (4 taps) and SH (2 taps) come first, then A, N, I in Alifbe order
    expect(queue.map((e) => e.letter)).toEqual(['CH', 'SH', 'A', 'N', 'I']);

    // When all 30 letters are mastered, backfills oldest lastReviewedAt first
    const allMastered: Record<string, LetterMasteryEntry> = {};
    ALIFBE_LETTERS_29.forEach((entry, idx) => {
      allMastered[entry.letter] = {
        letter: entry.letter,
        status: 'mastered',
        correctCount: 2,
        streak: 2,
        lastReviewedAt: `2026-11-${String((idx % 20) + 1).padStart(2, '0')}`,
      };
    });
    allMastered.P!.lastReviewedAt = '2026-10-01';
    allMastered.Z!.lastReviewedAt = '2026-10-02';

    const backfillQueue = selectAlphabetReviewQueue({
      catalog: ALIFBE_LETTERS_29,
      letterHintCounts: {},
      letterMastery: allMastered,
      roundSize: 5,
    });
    expect(backfillQueue).toHaveLength(5);
    expect(backfillQueue[0]?.letter).toBe('P');
    expect(backfillQueue[1]?.letter).toBe('Z');
  });

  it('builds 3 unique letter quiz choices with unique emojis including target', () => {
    for (const target of ALIFBE_LETTERS_29) {
      const choices = buildLetterQuizChoices(target, ALIFBE_LETTERS_29, `quiz:${target.letter}`);
      expect(choices).toHaveLength(3);
      expect(choices.some((c) => c.letter === target.letter)).toBe(true);
      expect(new Set(choices.map((c) => c.letter)).size).toBe(3);
      expect(new Set(choices.map((c) => c.exampleEmoji)).size).toBe(3);
    }
  });

  it('promotes letter mastery properly on Voice AI or 2 clean offline passes without demoting mastered letters', () => {
    // 1st clean offline pass -> practiced (streak 1)
    const afterOffline1 = applyLetterReviewResult(undefined, {
      letter: 'B',
      perfectRound: true,
      usedVoiceAi: false,
      todayStr: '2026-11-20',
    });
    expect(afterOffline1.status).toBe('practiced');
    expect(afterOffline1.streak).toBe(1);

    // 2nd clean offline pass -> mastered (streak 2)
    const afterOffline2 = applyLetterReviewResult(afterOffline1, {
      letter: 'B',
      perfectRound: true,
      usedVoiceAi: false,
      todayStr: '2026-11-20',
    });
    expect(afterOffline2.status).toBe('mastered');
    expect(afterOffline2.streak).toBe(2);

    // Imperfect pass on an already-mastered letter preserves mastered status
    const afterMistake = applyLetterReviewResult(afterOffline2, {
      letter: 'B',
      perfectRound: false,
      usedVoiceAi: false,
      todayStr: '2026-11-20',
    });
    expect(afterMistake.status).toBe('mastered');
    expect(afterMistake.streak).toBe(0);

    // 1st clean Voice AI pass -> immediately mastered
    const afterVoiceAi = applyLetterReviewResult(undefined, {
      letter: 'SH',
      perfectRound: true,
      usedVoiceAi: true,
      todayStr: '2026-11-20',
    });
    expect(afterVoiceAi.status).toBe('mastered');

    const summary = getAlphabetMasterySummary({ B: afterMistake, SH: afterVoiceAi });
    expect(summary).toEqual({
      total: 30,
      masteredCount: 2,
      practicedCount: 0,
      pct: 7,
    });
  });

  it('selects Stage 1 game modes: sentence_builder for World 5, train/constructor/bubbles for Worlds 1-2', () => {
    const world1Word = DYNAMIC_WORD_POOL.find((w) => w.worldId === 1)!;
    const world2Word = DYNAMIC_WORD_POOL.find((w) => w.worldId === 2)!;
    const world3TwoPart = DYNAMIC_WORD_POOL.find((w) => w.worldId === 3 && w.parts.length === 2)!;
    const world4ThreePart = DYNAMIC_WORD_POOL.find((w) => w.worldId === 4 && w.parts.length >= 3)!;
    const world5Sentence = DYNAMIC_WORD_POOL.find((w) => w.worldId === 5 && w.kind === 'sentence')!;

    expect([0, 1, 2].map((idx) => getStage1GameMode(idx, world1Word))).toEqual([
      'train',
      'constructor',
      'bubbles',
    ]);
    expect([0, 1, 2].map((idx) => getStage1GameMode(idx, world2Word))).toEqual([
      'train',
      'constructor',
      'bubbles',
    ]);
    expect(getStage1GameMode(0, world3TwoPart)).toBe('constructor');
    expect(getStage1GameMode(1, world3TwoPart)).toBe('bubbles');
    expect(getStage1GameMode(0, world4ThreePart)).toBe('bubbles');
    expect(getStage1GameMode(0, world5Sentence)).toBe('sentence_builder');
    expect(getStage1GameMode(2, world5Sentence)).toBe('sentence_builder');
  });

  it('builds shuffled sentence word banks with all target words + 1 unique distractor and comprehension prompt', () => {
    const sentences = DYNAMIC_WORD_POOL.filter((w) => w.kind === 'sentence');
    expect(sentences.length).toBeGreaterThanOrEqual(25);

    for (const sentence of sentences) {
      const bank = buildSentenceWordBank(sentence);
      const nonDistractors = bank.filter((t) => !t.isDistractor).map((t) => t.text);
      const distractors = bank.filter((t) => t.isDistractor).map((t) => t.text);

      expect(nonDistractors.sort()).toEqual([...sentence.parts].sort());
      expect(distractors).toHaveLength(1);
      expect(sentence.parts).not.toContain(distractors[0]);

      const nonDistractorInOrder = bank.filter((t) => !t.isDistractor).map((t) => t.text);
      expect(nonDistractorInOrder).not.toEqual(sentence.parts);

      expect(getSentenceComprehensionPromptUz(sentence).length).toBeGreaterThan(10);
    }
  });

  it('supports 2.0s mid-sentence pauses and 14s max duration in SENTENCE_FRIENDLY_MIC_CONFIG', () => {
    expect(SENTENCE_FRIENDLY_MIC_CONFIG.maxDurationMs).toBe(14_000);
    let st = createMicAutoStopState(SENTENCE_FRIENDLY_MIC_CONFIG);
    for (let t = 50; t < 300; t += 50) {
      st = stepMicAutoStop(st, 0.005, t, SENTENCE_FRIENDLY_MIC_CONFIG).state;
    }
    st = stepMicAutoStop(st, 0.09, 500, SENTENCE_FRIENDLY_MIC_CONFIG).state;
    expect(st.speechStarted).toBe(true);

    // 2.0s silence pause between sentence words (at 2500ms) must continue
    const midPause = stepMicAutoStop(st, 0.004, 2500, SENTENCE_FRIENDLY_MIC_CONFIG);
    expect(midPause.action).toBe('continue');

    // Stops cleanly after >= 2200ms post-speech silence (at 2750ms)
    const stopped = stepMicAutoStop(midPause.state, 0.004, 2750, SENTENCE_FRIENDLY_MIC_CONFIG);
    expect(stopped.action).toBe('stop_silence_after_speech');
  });

  it('persists letterMastery across reloads and accepts legacy v3 states missing letterMastery', () => {
    const mockStorage = createMockLocalStorage();
    vi.stubGlobal('window', { localStorage: mockStorage });

    const state = {
      ...createInitialState(),
      letterMastery: {
        O: {
          letter: 'O',
          status: 'mastered' as const,
          correctCount: 2,
          streak: 2,
          lastReviewedAt: '2026-11-20',
        },
      },
    };
    saveAlifboState(state);
    const loaded = loadAlifboState();
    expect(loaded.recoveredCorruptData).toBe(false);
    expect(loaded.state.letterMastery.O?.status).toBe('mastered');

    // Legacy v3 state lacking letterMastery loads without corruption recovery
    const legacy = JSON.parse(mockStorage.getItem('alifbo_app_state_v3')!) as Record<string, unknown>;
    delete legacy.letterMastery;
    mockStorage.setItem('alifbo_app_state_v3', JSON.stringify(legacy));
    const legacyLoaded = loadAlifboState();
    expect(legacyLoaded.recoveredCorruptData).toBe(false);
    expect(legacyLoaded.state.letterMastery).toEqual({});
  });
});
