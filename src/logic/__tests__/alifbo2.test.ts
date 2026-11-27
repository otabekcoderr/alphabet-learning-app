import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ALIFBE_LETTERS_29,
  DYNAMIC_WORD_POOL,
  READING_WORLDS,
  tokenizeUzbekLetters,
} from '../../data/curriculum';
import {
  createInitialState,
  loadAlifboState,
  saveAlifboState,
  type SurveyData,
} from '../../storage/progressStorage';
import {
  createMicAutoStopState,
  SPELLING_FRIENDLY_MIC_CONFIG,
  stepMicAutoStop,
} from '../micAutoStop';
import { evaluateSpeechResult } from '../pedagogy';
import {
  addPracticedSeconds,
  advanceVoiceDialogState,
  createInitialVoiceDialogState,
  evaluateScreenTimeLimit,
  evaluateSpelledOrSpokenAttempt,
  getGameModeForRoundIndex,
  getStrugglingLettersSummary,
  recordLetterHintTap,
  selectDynamicRound,
  triggerMotivationalAssist,
} from '../wordPoolEngine';

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

describe('Alifbo 2.0 curriculum: 1-sinf Alifbe sequence, 5 worlds & 125+ word pool', () => {
  it('contains all 29 Uzbek letters + tutuq belgisi in 1-sinf Alifbe textbook sequence', () => {
    expect(ALIFBE_LETTERS_29).toHaveLength(30);
    expect(ALIFBE_LETTERS_29.map((l) => l.letter)).toEqual([
      'O', 'A', 'N', 'I', 'M', 'T', 'L', 'B', 'K', 'R',
      'U', 'S', 'D', 'E', 'Z', 'SH', 'V', 'Y', 'G', 'NG',
      "O'", 'CH', 'Q', "G'", 'H', 'J', 'X', 'F', 'P', '’',
    ]);
    for (const entry of ALIFBE_LETTERS_29) {
      expect(entry.soundTextUz.length).toBeGreaterThan(0);
      expect(entry.exampleWord.length).toBeGreaterThan(0);
      expect(entry.exampleEmoji.length).toBeGreaterThan(0);
      expect(entry.phoneticTtsPrompt.length).toBeGreaterThan(0);
    }
  });

  it('has 5 reading worlds and >= 125 unique items (>= 25 per world) including World 5 sentences', () => {
    expect(READING_WORLDS).toHaveLength(5);
    expect(DYNAMIC_WORD_POOL.length).toBeGreaterThanOrEqual(125);

    const uniqueIds = new Set(DYNAMIC_WORD_POOL.map((item) => item.id));
    expect(uniqueIds.size).toBe(DYNAMIC_WORD_POOL.length);

    for (const world of READING_WORLDS) {
      const items = DYNAMIC_WORD_POOL.filter((item) => item.worldId === world.worldId);
      expect(items.length).toBeGreaterThanOrEqual(24);
      for (const item of items) {
        expect(item.parts.length).toBeGreaterThanOrEqual(2);
        expect(item.distractorEmojis).toHaveLength(2);
        expect(item.distractorEmojis).not.toContain(item.emoji);
        expect(item.distractorParts.length).toBeGreaterThanOrEqual(2);
        expect(item.accept.length).toBeGreaterThanOrEqual(1);
      }
    }

    const world5Sentences = DYNAMIC_WORD_POOL.filter(
      (item) => item.worldId === 5 && item.kind === 'sentence',
    );
    expect(world5Sentences.length).toBeGreaterThanOrEqual(25);
  });

  it('tokenizes Uzbek digraphs (Sh, Ch, Ng, O‘, G‘) accurately', () => {
    expect(tokenizeUzbekLetters('O‘RDAK')).toEqual(["O'", 'R', 'D', 'A', 'K']);
    expect(tokenizeUzbekLetters('SHIRMON')).toEqual(['SH', 'I', 'R', 'M', 'O', 'N']);
    expect(tokenizeUzbekLetters('CHOYNAK')).toEqual(['CH', 'O', 'Y', 'N', 'A', 'K']);
    expect(tokenizeUzbekLetters('G‘OZ')).toEqual(["G'", 'O', 'Z']);
    expect(tokenizeUzbekLetters('A’LO')).toEqual(['A', '’', 'L', 'O']);
  });
});

describe('Alifbo 2.0 dynamic word pool non-repetition & struggling-letter focus', () => {
  it('never repeats already-seen words while unseen words remain in the world', () => {
    const world2 = DYNAMIC_WORD_POOL.filter((i) => i.worldId === 2);
    let seenWordIds: string[] = [];
    const roundsSeen: string[] = [];

    for (let r = 0; r < 5; r++) {
      const res = selectDynamicRound({
        worldId: 2,
        pool: DYNAMIC_WORD_POOL,
        seenWordIds,
        letterHintCounts: {},
        roundSize: 5,
      });
      expect(res.resetCycle).toBe(false);
      expect(res.items).toHaveLength(5);
      for (const item of res.items) {
        expect(seenWordIds).not.toContain(item.id);
        roundsSeen.push(item.id);
      }
      seenWordIds = [...seenWordIds, ...res.items.map((i) => i.id)];
    }

    expect(new Set(roundsSeen).size).toBe(25);
    expect(world2.length).toBe(27);

    // 6th round picks the 2 remaining unseen words first and fills the rest from least-recently-seen
    const finalRound = selectDynamicRound({
      worldId: 2,
      pool: DYNAMIC_WORD_POOL,
      seenWordIds,
      letterHintCounts: {},
      roundSize: 5,
    });
    expect(finalRound.resetCycle).toBe(true);
    expect(finalRound.items).toHaveLength(5);
    expect(seenWordIds).not.toContain(finalRound.items[0]!.id);
  });

  it('prioritizes unseen words containing letters the child tapped for recall', () => {
    const round = selectDynamicRound({
      worldId: 3,
      pool: DYNAMIC_WORD_POOL,
      seenWordIds: [],
      letterHintCounts: { "O'": 5, CH: 3 },
      roundSize: 5,
    });
    expect(round.items).toHaveLength(5);
    const hasStrugglingLetters = round.items.some(
      (item) => item.letters.includes("O'") || item.letters.includes('CH'),
    );
    expect(hasStrugglingLetters).toBe(true);
  });

  it('rotates interactive game modes cleanly across round indices', () => {
    const modes = [0, 1, 2, 3, 4].map((idx) => getGameModeForRoundIndex(idx));
    expect(modes).toEqual(['spotlight', 'constructor', 'bubbles', 'spotlight', 'constructor']);
  });
});

describe('Spelled-out child reading ("k i ki t o b tob kitob") & two-turn Voice Dialog', () => {
  it('accepts spelled/syllabic reading in both evaluateSpelledOrSpokenAttempt and evaluateSpeechResult', () => {
    const kitob = DYNAMIC_WORD_POOL.find((i) => i.id === 'kitob')!;
    const spelled = evaluateSpelledOrSpokenAttempt({
      targetText: kitob.text,
      parts: kitob.parts,
      acceptAliases: kitob.accept,
      transcript: 'k i ki t o b tob kitob',
      isSilence: false,
    });
    expect(spelled.outcome).toBe('accepted');
    expect(spelled.matchedMode).toBe('spelled_or_syllabic');

    const syllabicOnly = evaluateSpelledOrSpokenAttempt({
      targetText: kitob.text,
      parts: kitob.parts,
      acceptAliases: kitob.accept,
      transcript: 'k i ki t o b tob',
      isSilence: false,
    });
    expect(syllabicOnly.outcome).toBe('accepted');
    expect(syllabicOnly.matchedMode).toBe('spelled_or_syllabic');

    const legacyEval = evaluateSpeechResult(
      'KITOB',
      ['kitob', 'kitop'],
      'k i ki t o b tob kitob',
      false,
      1,
      ['KI', 'TOB'],
    );
    expect(legacyEval.outcome).toBe('accepted');
    expect(legacyEval.starsEarned).toBe(3);

    const wrongEval = evaluateSpelledOrSpokenAttempt({
      targetText: kitob.text,
      parts: kitob.parts,
      acceptAliases: kitob.accept,
      transcript: 'olma',
      isSilence: false,
    });
    expect(wrongEval.outcome).toBe('try_again');

    const silenceEval = evaluateSpelledOrSpokenAttempt({
      targetText: kitob.text,
      parts: kitob.parts,
      acceptAliases: kitob.accept,
      transcript: '',
      isSilence: true,
    });
    expect(silenceEval.outcome).toBe('silence');
  });

  it('runs the two-turn dialog: "Bu nima?" -> "Qaytaring!" -> completed_success', () => {
    const kitob = DYNAMIC_WORD_POOL.find((i) => i.id === 'kitob')!;
    let state = createInitialVoiceDialogState(kitob);
    expect(state.phase).toBe('ask_what_is_it');
    expect(state.isFinished).toBe(false);

    // Child answers Turn 1 by spelling aloud: "k i ki t o b tob kitob"
    state = advanceVoiceDialogState(state, kitob, 'k i ki t o b tob kitob', false);
    expect(state.phase).toBe('cheer_and_repeat');
    expect(state.characterMood).toBe('celebrating');
    expect(state.isFinished).toBe(false);

    // Child repeats smoothly in Turn 2
    state = advanceVoiceDialogState(state, kitob, 'kitob', false);
    expect(state.phase).toBe('completed_success');
    expect(state.starsAwarded).toBe(3);
    expect(state.isFinished).toBe(true);
  });

  it('transitions gently to motivational_assist after 2 missed tries without ever blocking the child', () => {
    const kitob = DYNAMIC_WORD_POOL.find((i) => i.id === 'kitob')!;
    let state = createInitialVoiceDialogState(kitob);

    state = advanceVoiceDialogState(state, kitob, 'olma', false);
    expect(state.phase).toBe('ask_what_is_it');
    expect(state.attemptsInPhase).toBe(1);
    expect(state.characterMood).toBe('encouraging');
    expect(state.isFinished).toBe(false);

    state = advanceVoiceDialogState(state, kitob, 'olma', false);
    expect(state.phase).toBe('motivational_assist');
    expect(state.starsAwarded).toBe(2);
    expect(state.isFinished).toBe(true);

    const directAssist = triggerMotivationalAssist(kitob);
    expect(directAssist.phase).toBe('motivational_assist');
    expect(directAssist.isFinished).toBe(true);
  });

  it('allows longer inter-syllable pauses in SPELLING_FRIENDLY_MIC_CONFIG', () => {
    let st = createMicAutoStopState(SPELLING_FRIENDLY_MIC_CONFIG);
    // Calibrate noise at 0..250ms
    for (let t = 50; t < 300; t += 50) {
      st = stepMicAutoStop(st, 0.005, t, SPELLING_FRIENDLY_MIC_CONFIG).state;
    }
    // Child says "ki" at 500ms
    st = stepMicAutoStop(st, 0.09, 500, SPELLING_FRIENDLY_MIC_CONFIG).state;
    expect(st.speechStarted).toBe(true);

    // 1.5s pause between "ki" and "tob" (2000ms elapsed) must NOT stop prematurely
    const midPause = stepMicAutoStop(st, 0.004, 2000, SPELLING_FRIENDLY_MIC_CONFIG);
    expect(midPause.action).toBe('continue');

    // Only after 1.95s+ post-speech silence (2460ms) does it stop cleanly
    const finalStop = stepMicAutoStop(midPause.state, 0.004, 2460, SPELLING_FRIENDLY_MIC_CONFIG);
    expect(finalStop.action).toBe('stop_silence_after_speech');
  });
});

describe('Healthy daily screen-time limit, struggling-letter diagnostics & storage persistence', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('tracks daily screen time and resets cleanly on a new calendar date', () => {
    const added = addPracticedSeconds({
      dailyPracticeDate: '2026-11-18',
      todayDateStr: '2026-11-18',
      todayPracticedSeconds: 880,
      deltaSeconds: 20,
    });
    expect(added.todayPracticedSeconds).toBe(900);

    const reached = evaluateScreenTimeLimit({
      dailyLimitMinutes: 15,
      dailyPracticeDate: '2026-11-18',
      todayDateStr: '2026-11-18',
      todayPracticedSeconds: added.todayPracticedSeconds,
    });
    expect(reached.isLimitReached).toBe(true);
    expect(reached.progressPct).toBe(100);
    expect(reached.remainingMinutes).toBe(0);

    // Next day automatically resets used time to 0
    const nextDay = evaluateScreenTimeLimit({
      dailyLimitMinutes: 15,
      dailyPracticeDate: '2026-11-18',
      todayDateStr: '2026-11-19',
      todayPracticedSeconds: 900,
    });
    expect(nextDay.isLimitReached).toBe(false);
    expect(nextDay.practicedSeconds).toBe(0);
    expect(nextDay.remainingMinutes).toBe(15);
  });

  it('records letter recall taps and formats parent diagnostic summary', () => {
    let counts: Record<string, number> = {};
    counts = recordLetterHintTap(counts, 'B');
    counts = recordLetterHintTap(counts, 'B');
    counts = recordLetterHintTap(counts, 'O‘');
    counts = recordLetterHintTap(counts, 'SH');

    const summary = getStrugglingLettersSummary(counts);
    expect(summary.map((s) => `${s.letter}:${s.tapCount}`)).toEqual(['B:2', "O':1", 'SH:1']);
    expect(summary[0]!.coachingTipUz).toContain('B b');
  });

  it('persists surveyData, seenWordIds, letterHintCounts, and dailyLimitMinutes across reloads', () => {
    const mockStorage = createMockLocalStorage();
    vi.stubGlobal('window', { localStorage: mockStorage });

    const survey: SurveyData = {
      completedAt: '2026-11-18T10:00:00.000Z',
      ageGroup: '6-7',
      readingChallenge: 'slow_spelling',
      dailyLimitMinutes: 15,
      desiredFutureSubjects: ['math', 'drawing'],
    };

    const state = {
      ...createInitialState(),
      seenWordIds: ['kitob', 'lola'],
      letterHintCounts: { B: 3, SH: 1 },
      dailyLimitMinutes: 20 as const,
      dailyPracticeDate: '2026-11-18',
      todayPracticedSeconds: 180,
      activeWorldId: 2,
      surveyData: survey,
    };

    saveAlifboState(state);
    const loaded = loadAlifboState();
    expect(loaded.recoveredCorruptData).toBe(false);
    expect(loaded.state.seenWordIds).toEqual(['kitob', 'lola']);
    expect(loaded.state.letterHintCounts).toEqual({ B: 3, SH: 1 });
    expect(loaded.state.dailyLimitMinutes).toBe(20);
    expect(loaded.state.todayPracticedSeconds).toBe(180);
    expect(loaded.state.activeWorldId).toBe(2);
    expect(loaded.state.surveyData).toEqual(survey);
  });
});
