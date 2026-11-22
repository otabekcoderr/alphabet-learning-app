import { afterEach, describe, expect, it, vi } from 'vitest';
import { CURRICULUM_ITEMS, CURRICULUM_STAGES } from '../../data/curriculum';
import {
  AVATAR_OPTIONS,
  buildWeekStreakDays,
  calculateTotalXp,
  DAILY_GOAL_OPTIONS,
  getAchievements,
  getAvatarOption,
  getLevelInfo,
  getNewlyUnlockedStageRewards,
  getParentAchievementsSummary,
  getStageEffortCount,
  isStageEffortComplete,
  markStageRewardsShown,
} from '../gamification';
import { applyUnverifiedAttempt, applyVerifiedCompletion, type ItemProgress } from '../pedagogy';
import {
  createInitialState,
  loadAlifboState,
  PRE_PHASE_A_BACKUP_KEY,
  PRE_PHASE_B_BACKUP_KEY,
  recordPracticeDate,
  saveAlifboState,
} from '../../storage/progressStorage';
import { encodeWav16k, normalizeAudioPeak } from '../../utils/audioRecorder';

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

describe('gamification logic', () => {
  it('calculates total XP from mastery stars and effort stars', () => {
    expect(calculateTotalXp(0, 0)).toBe(0);
    expect(calculateTotalXp(3, 2)).toBe(3 * 20 + 2 * 5);
    expect(DAILY_GOAL_OPTIONS).toEqual([30, 60, 100]);
  });

  it('computes level info across all 6 tiers from 0 XP to 3000 XP', () => {
    const l1 = getLevelInfo(0);
    expect(l1.level).toBe(1);
    expect(l1.xpInLevel).toBe(0);
    expect(l1.pct).toBe(0);
    expect(l1.xpToNext).toBe(100);

    const l2 = getLevelInfo(100);
    expect(l2.level).toBe(2);
    expect(l2.xpInLevel).toBe(0);
    expect(l2.levelSpanXp).toBe(200);
    expect(l2.xpToNext).toBe(200);

    expect(getLevelInfo(300).level).toBe(3);
    expect(getLevelInfo(600).level).toBe(4);
    expect(getLevelInfo(1000).level).toBe(5);

    const l6Mid = getLevelInfo(2000);
    expect(l6Mid.level).toBe(6);
    expect(l6Mid.pct).toBe(50);
    expect(l6Mid.xpToNext).toBe(400);

    const l6Max = getLevelInfo(3000);
    expect(l6Max.level).toBe(6);
    expect(l6Max.pct).toBe(100);
    expect(l6Max.xpToNext).toBe(0);
  });

  it('resolves all 8 avatar options and falls back to fox on unknown IDs', () => {
    expect(AVATAR_OPTIONS).toHaveLength(8);
    for (const option of AVATAR_OPTIONS) {
      expect(getAvatarOption(option.id)).toEqual(option);
    }
    expect(getAvatarOption('unknown_avatar_xyz').id).toBe('fox');
  });

  it('builds a 7-day streak calendar ending on today with accurate active and isToday flags', () => {
    const today = new Date(2026, 10, 16);
    const days = buildWeekStreakDays(['2026-11-10', '2026-11-14', '2026-11-16'], today);
    expect(days).toHaveLength(7);
    expect(days[0]?.dateStr).toBe('2026-11-10');
    expect(days[6]?.dateStr).toBe('2026-11-16');

    expect(days.filter((d) => d.active).map((d) => d.dateStr)).toEqual([
      '2026-11-10',
      '2026-11-14',
      '2026-11-16',
    ]);
    expect(days.filter((d) => d.isToday).map((d) => d.dateStr)).toEqual(['2026-11-16']);
  });

  it('tracks all 8 achievement badges from empty state through Stage 1/mixed progress to 48/48 mastery', () => {
    const emptyState = createInitialState();
    const lockedBadges = getAchievements(CURRICULUM_ITEMS, emptyState);
    expect(lockedBadges).toHaveLength(8);
    expect(lockedBadges.every((b) => !b.unlocked && b.current === 0)).toBe(true);

    // Master all Stage 1 items (7 items), first 8 syllables total across stages, and 8 words
    const partialProgress: Record<string, ItemProgress> = {};
    const stage1 = CURRICULUM_ITEMS.filter((i) => i.stage === 1);
    const syllables = CURRICULUM_ITEMS.filter((i) => i.kind === 'syllable').slice(0, 10);
    const words = CURRICULUM_ITEMS.filter((i) => i.kind === 'word').slice(0, 8);

    const selectedIds = new Set([...stage1, ...syllables, ...words].map((i) => i.id));
    let starsSum = 0;
    for (const id of selectedIds) {
      partialProgress[id] = applyVerifiedCompletion(undefined, {
        itemId: id,
        starsEarned: 3,
        voiceAttemptsDelta: 1,
        parentVerified: false,
        latencyMs: 65,
        nowIso: '2026-11-16T08:00:00Z',
      }).itemProgress;
      starsSum += 3;
    }

    const midState = {
      ...emptyState,
      progressByItem: partialProgress,
      totalStars: starsSum,
      practiceDates: ['2026-11-14', '2026-11-15', '2026-11-16'],
    };
    const midBadges = getAchievements(CURRICULUM_ITEMS, midState);
    const unlockedIds = midBadges.filter((b) => b.unlocked).map((b) => b.id);
    expect(unlockedIds).toEqual([
      'first_step',
      'vowel_island',
      'syllable_master',
      'word_reader',
      'streak_3',
      'xp_300',
      'perfect_five',
    ]);
    expect(midBadges.find((b) => b.id === 'champion_48')?.unlocked).toBe(false);

    // Master all 48 items
    const fullProgress: Record<string, ItemProgress> = {};
    for (const item of CURRICULUM_ITEMS) {
      fullProgress[item.id] = applyVerifiedCompletion(undefined, {
        itemId: item.id,
        starsEarned: 3,
        voiceAttemptsDelta: 1,
        parentVerified: false,
        latencyMs: 60,
        nowIso: '2026-11-16T09:00:00Z',
      }).itemProgress;
    }
    const fullState = {
      ...midState,
      progressByItem: fullProgress,
      totalStars: CURRICULUM_ITEMS.length * 3,
    };
    const fullBadges = getAchievements(CURRICULUM_ITEMS, fullState);
    expect(fullBadges.every((b) => b.unlocked)).toBe(true);
  });
});

describe('progressStorage persistence, profile backfill, and corruption recovery', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates initial state with default profile and persists round-trips via localStorage', () => {
    const mockStorage = createMockLocalStorage();
    vi.stubGlobal('window', { localStorage: mockStorage });

    const initial = createInitialState();
    expect(initial.profile).toEqual({ name: 'Bolajon', avatarId: 'fox', dailyGoalXp: 60 });

    const updated = {
      ...initial,
      profile: { name: 'Ali', avatarId: 'lion', dailyGoalXp: 100 },
      practiceDates: recordPracticeDate(initial.practiceDates, '2026-11-16'),
      totalStars: 9,
    };
    saveAlifboState(updated);

    const loaded = loadAlifboState();
    expect(loaded.recoveredCorruptData).toBe(false);
    expect(loaded.state).toEqual(updated);
  });

  it('backfills default profile seamlessly on legacy v3 state without triggering corrupt recovery', () => {
    const mockStorage = createMockLocalStorage();
    vi.stubGlobal('window', { localStorage: mockStorage });

    const legacyV3WithoutProfile = {
      schemaVersion: 3,
      pinSalt: null,
      pinHash: null,
      recoveryCodeHash: null,
      pinLockout: { failedAttempts: 0, lockedUntilMs: null },
      progressByItem: {},
      totalStars: 6,
      totalEffortStars: 1,
      practiceDates: ['2026-11-15'],
      recentLatenciesMs: [72],
    };
    mockStorage.setItem('alifbo_app_state_v3', JSON.stringify(legacyV3WithoutProfile));

    const loaded = loadAlifboState();
    expect(loaded.recoveredCorruptData).toBe(false);
    expect(loaded.state.totalStars).toBe(6);
    expect(loaded.state.profile).toEqual({ name: 'Bolajon', avatarId: 'fox', dailyGoalXp: 60 });
    expect(loaded.state.shownStageRewards).toEqual([]);
    expect(loaded.state.unverifiedCap).toBe(3);
  });

  it('Phase A storage safety: copies raw v3 state to alifbo_backup_before_phase_a and migrates without losing completed lessons', () => {
    const mockStorage = createMockLocalStorage();
    vi.stubGlobal('window', { localStorage: mockStorage });

    const prePhaseAV3Fixture = {
      schemaVersion: 3,
      pinSalt: 'salt123',
      pinHash: 'hash456',
      recoveryCodeHash: 'rec789',
      pinLockout: { failedAttempts: 0, lockedUntilMs: null },
      profile: { name: 'Madina', avatarId: 'owl', dailyGoalXp: 60 },
      progressByItem: {
        a: applyVerifiedCompletion(undefined, {
          itemId: 'a',
          starsEarned: 3,
          voiceAttemptsDelta: 1,
          parentVerified: true,
          latencyMs: null,
          nowIso: '2026-11-16T07:00:00Z',
        }).itemProgress,
        o: applyVerifiedCompletion(undefined, {
          itemId: 'o',
          starsEarned: 3,
          voiceAttemptsDelta: 1,
          parentVerified: true,
          latencyMs: null,
          nowIso: '2026-11-16T07:05:00Z',
        }).itemProgress,
        i: applyUnverifiedAttempt(undefined, 'i', '2026-11-16T07:10:00Z').itemProgress,
        u: applyUnverifiedAttempt(undefined, 'u', '2026-11-16T07:15:00Z').itemProgress,
        e: applyUnverifiedAttempt(undefined, 'e', '2026-11-16T07:20:00Z').itemProgress,
      },
      totalStars: 6,
      totalEffortStars: 3,
      practiceDates: ['2026-11-16'],
      recentLatenciesMs: [55],
    };
    const rawFixture = JSON.stringify(prePhaseAV3Fixture);
    mockStorage.setItem('alifbo_app_state_v3', rawFixture);

    const loaded = loadAlifboState();
    expect(loaded.recoveredCorruptData).toBe(false);
    expect(mockStorage.getItem(PRE_PHASE_A_BACKUP_KEY)).toBe(rawFixture);
    expect(Object.keys(loaded.state.progressByItem)).toEqual(['a', 'o', 'i', 'u', 'e']);
    expect(loaded.state.totalStars).toBe(6);
    expect(loaded.state.totalEffortStars).toBe(3);
    expect(loaded.state.pinHash).toBe('hash456');
    expect(loaded.state.profile.name).toBe('Madina');
    expect(loaded.state.shownStageRewards).toEqual([]);
    expect(loaded.state.unverifiedCap).toBe(3);

    // Consecutive loads after saving migrated/updated state must NEVER overwrite alifbo_backup_before_phase_a
    const mutatedState = { ...loaded.state, unverifiedCap: 5, shownStageRewards: [1], totalStars: 99 };
    saveAlifboState(mutatedState);
    const secondLoad = loadAlifboState();
    expect(secondLoad.recoveredCorruptData).toBe(false);
    expect(secondLoad.state.unverifiedCap).toBe(5);
    expect(secondLoad.state.shownStageRewards).toEqual([1]);
    expect(secondLoad.state.totalStars).toBe(99);
    expect(mockStorage.getItem(PRE_PHASE_A_BACKUP_KEY)).toBe(rawFixture);

    const thirdLoad = loadAlifboState();
    expect(thirdLoad.state.totalStars).toBe(99);
    expect(mockStorage.getItem(PRE_PHASE_A_BACKUP_KEY)).toBe(rawFixture);
    expect(mockStorage.getItem(PRE_PHASE_A_BACKUP_KEY)).not.toBe(
      mockStorage.getItem('alifbo_app_state_v3'),
    );
  });

  it('Phase A2: awards stage reward on effort completion regardless of verification, shows once, and keeps mastery separate', () => {
    const mockStorage = createMockLocalStorage();
    vi.stubGlobal('window', { localStorage: mockStorage });

    const stage1Items = CURRICULUM_ITEMS.filter((item) => item.stage === 1);
    const progressByItem: Record<string, ItemProgress> = {};
    for (const item of stage1Items) {
      progressByItem[item.id] = applyUnverifiedAttempt(
        undefined,
        item.id,
        '2026-11-17T08:00:00Z',
      ).itemProgress;
    }

    expect(getStageEffortCount(1, CURRICULUM_ITEMS, progressByItem)).toBe(stage1Items.length);
    expect(isStageEffortComplete(1, CURRICULUM_ITEMS, progressByItem)).toBe(true);

    // Mastery stays separate: no item is mastered yet, so vowel_island mastery badge stays locked
    const stateEffortOnly = {
      ...createInitialState(),
      progressByItem,
      totalEffortStars: stage1Items.length,
    };
    const vowelMasteryBadge = getAchievements(CURRICULUM_ITEMS, stateEffortOnly).find(
      (b) => b.id === 'vowel_island',
    );
    expect(vowelMasteryBadge?.unlocked).toBe(false);
    expect(vowelMasteryBadge?.current).toBe(0);

    // Reward unlocks once for stage 1
    const newlyUnlocked = getNewlyUnlockedStageRewards(
      CURRICULUM_STAGES,
      CURRICULUM_ITEMS,
      progressByItem,
      stateEffortOnly.shownStageRewards,
    );
    expect(newlyUnlocked).toEqual([1]);

    // Persisting shownStageRewards prevents showing stage 1 reward again even after replay or reload
    const persisted = {
      ...stateEffortOnly,
      shownStageRewards: markStageRewardsShown(stateEffortOnly.shownStageRewards, newlyUnlocked),
    };
    saveAlifboState(persisted);
    const reloaded = loadAlifboState();
    expect(reloaded.state.shownStageRewards).toEqual([1]);

    // Replay a lesson in stage 1 (effort or AI verified) -> stage 1 reward must never trigger again
    const replayedProgress = {
      ...reloaded.state.progressByItem,
      a: applyVerifiedCompletion(reloaded.state.progressByItem.a, {
        itemId: 'a',
        starsEarned: 3,
        voiceAttemptsDelta: 1,
        parentVerified: false,
        latencyMs: 50,
        nowIso: '2026-11-17T08:05:00Z',
      }).itemProgress,
    };
    expect(
      getNewlyUnlockedStageRewards(
        CURRICULUM_STAGES,
        CURRICULUM_ITEMS,
        replayedProgress,
        reloaded.state.shownStageRewards,
      ),
    ).toEqual([]);
  });

  it('backs up corrupt JSON or invalid schema and resets cleanly to initial state', () => {
    const mockStorage = createMockLocalStorage();
    vi.stubGlobal('window', { localStorage: mockStorage });

    mockStorage.setItem('alifbo_app_state_v3', '{corrupt json!!!');
    const badJsonResult = loadAlifboState();
    expect(badJsonResult.recoveredCorruptData).toBe(true);
    expect(badJsonResult.state).toEqual(createInitialState());

    const keys = Array.from({ length: mockStorage.length }, (_, i) => mockStorage.key(i) ?? '');
    const backupKey = keys.find((k) => k.startsWith('alifbo_app_state_backup_'));
    expect(backupKey).toBeDefined();
    expect(mockStorage.getItem(backupKey!)).toBe('{corrupt json!!!');

    // Also test valid JSON with wrong schemaVersion
    mockStorage.clear();
    mockStorage.setItem('alifbo_app_state_v3', JSON.stringify({ schemaVersion: 99 }));
    const wrongSchemaResult = loadAlifboState();
    expect(wrongSchemaResult.recoveredCorruptData).toBe(true);
    expect(wrongSchemaResult.state).toEqual(createInitialState());
  });

  it('Phase B: parentOnboardingDone defaults safely to false and migrates both v3 and post-Phase-A fixtures keeping backups intact', () => {
    const mockStorage = createMockLocalStorage();
    vi.stubGlobal('window', { localStorage: mockStorage });

    expect(createInitialState().parentOnboardingDone).toBe(false);

    // 1) Pre-Phase-A v3 fixture (missing shownStageRewards, unverifiedCap, parentOnboardingDone, confirmationSource)
    const legacyV3Fixture = {
      schemaVersion: 3,
      pinSalt: 'salt_v3',
      pinHash: 'hash_v3',
      recoveryCodeHash: 'rec_v3',
      pinLockout: { failedAttempts: 0, lockedUntilMs: null },
      profile: { name: 'Bolajon', avatarId: 'fox', dailyGoalXp: 60 },
      progressByItem: {
        a: {
          itemId: 'a',
          status: 'mastered',
          mastered: true,
          stars: 3,
          effortStars: 0,
          voiceAttempts: 1,
          parentVerified: true,
          lastLatencyMs: null,
          lastPracticedAt: '2026-11-15T08:00:00.000Z',
        },
        i: {
          itemId: 'i',
          status: 'unverified',
          mastered: false,
          stars: 0,
          effortStars: 1,
          voiceAttempts: 0,
          parentVerified: false,
          lastLatencyMs: null,
          lastPracticedAt: '2026-11-15T08:05:00.000Z',
        },
      },
      totalStars: 3,
      totalEffortStars: 1,
      practiceDates: ['2026-11-15'],
      recentLatenciesMs: [],
    };
    const rawV3 = JSON.stringify(legacyV3Fixture);
    mockStorage.setItem('alifbo_app_state_v3', rawV3);

    const loadedV3 = loadAlifboState();
    expect(loadedV3.recoveredCorruptData).toBe(false);
    expect(loadedV3.state.parentOnboardingDone).toBe(false);
    expect(loadedV3.state.unverifiedCap).toBe(3);
    expect(loadedV3.state.shownStageRewards).toEqual([]);
    expect(loadedV3.state.progressByItem.a?.confirmationSource).toBe('parent_single');
    expect(loadedV3.state.progressByItem.a?.nextReviewAt).toBe('2026-11-18T08:00:00.000Z');
    expect(loadedV3.state.progressByItem.i?.confirmationSource).toBeNull();
    expect(mockStorage.getItem(PRE_PHASE_A_BACKUP_KEY)).toBe(rawV3);
    expect(mockStorage.getItem(PRE_PHASE_B_BACKUP_KEY)).toBe(rawV3);

    // 2) Post-Phase-A fixture (already has alifbo_backup_before_phase_a, shownStageRewards, unverifiedCap; lacks parentOnboardingDone)
    mockStorage.clear();
    const earlierPrePhaseASnapshot = '{"schemaVersion":3,"marker":"pre-phase-a"}';
    mockStorage.setItem(PRE_PHASE_A_BACKUP_KEY, earlierPrePhaseASnapshot);

    const postPhaseAFixture = {
      schemaVersion: 3,
      pinSalt: 'salt_a',
      pinHash: 'hash_a',
      recoveryCodeHash: 'rec_a',
      pinLockout: { failedAttempts: 0, lockedUntilMs: null },
      profile: { name: 'Yulduzcha', avatarId: 'rabbit', dailyGoalXp: 60 },
      progressByItem: {
        a: {
          itemId: 'a',
          status: 'mastered',
          mastered: true,
          stars: 3,
          effortStars: 0,
          voiceAttempts: 2,
          parentVerified: false,
          lastLatencyMs: 60,
          lastPracticedAt: '2026-11-16T09:00:00.000Z',
        },
        o: {
          itemId: 'o',
          status: 'mastered',
          mastered: true,
          stars: 3,
          effortStars: 0,
          voiceAttempts: 0,
          parentVerified: true,
          lastLatencyMs: null,
          lastPracticedAt: '2026-11-16T09:05:00.000Z',
        },
        i: applyUnverifiedAttempt(undefined, 'i', '2026-11-16T09:10:00.000Z').itemProgress,
      },
      totalStars: 6,
      totalEffortStars: 1,
      practiceDates: ['2026-11-16'],
      recentLatenciesMs: [60],
      shownStageRewards: [1],
      unverifiedCap: 4,
    };
    const rawPostA = JSON.stringify(postPhaseAFixture);
    mockStorage.setItem('alifbo_app_state_v3', rawPostA);

    const loadedPostA = loadAlifboState();
    expect(loadedPostA.recoveredCorruptData).toBe(false);
    expect(loadedPostA.state.parentOnboardingDone).toBe(false);
    expect(loadedPostA.state.shownStageRewards).toEqual([1]);
    expect(loadedPostA.state.unverifiedCap).toBe(4);
    expect(loadedPostA.state.progressByItem.a?.confirmationSource).toBe('ai');
    expect(loadedPostA.state.progressByItem.o?.confirmationSource).toBe('parent_single');
    expect(loadedPostA.state.progressByItem.i?.confirmationSource).toBeNull();
    expect(mockStorage.getItem(PRE_PHASE_A_BACKUP_KEY)).toBe(earlierPrePhaseASnapshot);
    expect(mockStorage.getItem(PRE_PHASE_B_BACKUP_KEY)).toBe(rawPostA);

    // Subsequent saves/loads must preserve both backup keys untouched
    saveAlifboState({ ...loadedPostA.state, parentOnboardingDone: true });
    const reloaded = loadAlifboState();
    expect(reloaded.state.parentOnboardingDone).toBe(true);
    expect(mockStorage.getItem(PRE_PHASE_A_BACKUP_KEY)).toBe(earlierPrePhaseASnapshot);
    expect(mockStorage.getItem(PRE_PHASE_B_BACKUP_KEY)).toBe(rawPostA);
  });

  it('Phase B: separates "mashq qildi" (effort) from "ota-ona tasdiqladi" (mastery) in parent achievements summary', () => {
    const state = {
      ...createInitialState(),
      totalStars: 6,
      totalEffortStars: 3,
      practiceDates: ['2026-11-16', '2026-11-17'],
      progressByItem: {
        a: applyVerifiedCompletion(undefined, {
          itemId: 'a',
          starsEarned: 3,
          voiceAttemptsDelta: 1,
          parentVerified: false,
          confirmationSource: 'ai',
          latencyMs: 55,
          nowIso: '2026-11-17T08:00:00.000Z',
        }).itemProgress,
        o: applyVerifiedCompletion(undefined, {
          itemId: 'o',
          starsEarned: 3,
          voiceAttemptsDelta: 0,
          parentVerified: true,
          confirmationSource: 'parent_single',
          latencyMs: null,
          nowIso: '2026-11-17T08:02:00.000Z',
        }).itemProgress,
        i: applyUnverifiedAttempt(undefined, 'i', '2026-11-17T08:05:00.000Z').itemProgress,
        u: applyUnverifiedAttempt(undefined, 'u', '2026-11-17T08:06:00.000Z').itemProgress,
        e: applyUnverifiedAttempt(undefined, 'e', '2026-11-17T08:07:00.000Z').itemProgress,
      },
    };

    const summary = getParentAchievementsSummary(CURRICULUM_ITEMS, state);
    expect(summary).toEqual({
      totalLessons: 48,
      effortCompletedCount: 5,
      totalEffortStars: 3,
      masteredCount: 2,
      parentConfirmedCount: 1,
      aiConfirmedCount: 1,
      totalMasteryStars: 6,
      practiceDaysCount: 2,
      unlockedStagesCount: 0,
    });
  });
});

describe('audioRecorder peak normalization & 16kHz mono WAV encoding', () => {
  it('boosts quiet audio peaks within gain limit while leaving silence and loud clips untouched', () => {
    const silence = new Float32Array([0.002, -0.004, 0.001]);
    expect(normalizeAudioPeak(silence)).toBe(silence);

    const loud = new Float32Array([0.85, -0.5, 0.1]);
    expect(normalizeAudioPeak(loud)).toBe(loud);

    const veryQuiet = new Float32Array([0.05, -0.025, 0.01]);
    const maxGained = normalizeAudioPeak(veryQuiet, 0.75, 6.0);
    expect(maxGained[0]).toBeCloseTo(0.3, 4);
    expect(maxGained[1]).toBeCloseTo(-0.15, 4);

    const moderate = new Float32Array([0.25, -0.1, 0.0]);
    const normalized = normalizeAudioPeak(moderate, 0.75, 6.0);
    expect(normalized[0]).toBeCloseTo(0.75, 4);
    expect(normalized[1]).toBeCloseTo(-0.3, 4);
  });

  it('encodes 16kHz mono PCM16 RIFF/WAVE headers and exact payload byte length', async () => {
    const samples = new Float32Array(1600);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.sin((2 * Math.PI * 440 * i) / 16000) * 0.5;
    }
    const blob = encodeWav16k(samples);
    expect(blob.type).toBe('audio/wav');

    const buf = await blob.arrayBuffer();
    expect(buf.byteLength).toBe(44 + samples.length * 2);

    const view = new DataView(buf);
    const readTag = (offset: number) =>
      String.fromCharCode(
        view.getUint8(offset),
        view.getUint8(offset + 1),
        view.getUint8(offset + 2),
        view.getUint8(offset + 3),
      );

    expect(readTag(0)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(36 + samples.length * 2);
    expect(readTag(8)).toBe('WAVE');
    expect(readTag(12)).toBe('fmt ');
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(28, true)).toBe(32_000);
    expect(view.getUint16(32, true)).toBe(2);
    expect(view.getUint16(34, true)).toBe(16);
    expect(readTag(36)).toBe('data');
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
  });
});
