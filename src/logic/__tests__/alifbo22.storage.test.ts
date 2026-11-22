import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  computeIntegrityChecksum,
  createInitialState,
  exportProgressJson,
  importProgressJson,
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

describe('Alifbo 2.2 JSON backup export/import, checksum integrity & legacy migrations', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips full state and wordProgress via exportProgressJson & importProgressJson', () => {
    const state = {
      ...createInitialState(),
      profile: { name: 'Zukko', avatarId: 'owl', dailyGoalXp: 60 },
      seenWordIds: ['kitob', 'lola'],
      recentReadingTimesMs: [1900, 2300],
      wordProgress: {
        kitob: {
          wordId: 'kitob',
          status: 'mastered' as const,
          reviewIntervalDays: 3,
          nextReviewDate: '2026-11-22',
          attemptCount: 2,
          assistedCount: 0,
          offlineCorrectStreak: 0,
          fluentStreak: 2,
          lastReactionMs: 900,
          lastArticulationMs: 1100,
          pendingVoiceVerify: false,
        },
      },
    };

    const jsonStr = exportProgressJson(state, '2026-11-19T06:00:00.000Z');
    const rawParsed = JSON.parse(jsonStr) as Record<string, unknown>;
    expect(rawParsed.exportFormatVersion).toBe('2.2');
    expect(rawParsed.schemaVersion).toBe('2.1');
    expect(typeof rawParsed.checksum).toBe('string');

    const imported = importProgressJson(jsonStr, '2026-11-19');
    expect(imported.ok).toBe(true);
    if (imported.ok) {
      expect(imported.state.wordProgress.kitob?.status).toBe('mastered');
      expect(imported.state.recentReadingTimesMs).toEqual([1900, 2300]);
      expect(imported.state.profile.name).toBe('Zukko');
    }
  });

  it('rejects corrupted or tampered JSON backups via checksum verification', () => {
    const state = createInitialState();
    const jsonStr = exportProgressJson(state, '2026-11-19T06:00:00.000Z');
    const obj = JSON.parse(jsonStr) as Record<string, unknown>;
    (obj.state as Record<string, unknown>).totalStars = 9999;

    const tampered = importProgressJson(JSON.stringify(obj), '2026-11-19');
    expect(tampered.ok).toBe(false);

    const invalidJson = importProgressJson('{not valid json');
    expect(invalidJson.ok).toBe(false);
  });

  it('migrates legacy Alifbo 1.0 completed:true entries to syllable + pendingVoiceVerify:true (never mastered)', () => {
    const unsignedV21 = {
      schemaVersion: '2.1',
      exportedAt: '2026-11-19T06:00:00.000Z',
      wordProgress: {
        ona: { completed: true },
        kitob: { completed: true },
      },
    };
    const checksum = computeIntegrityChecksum(unsignedV21);
    const imported = importProgressJson(JSON.stringify({ ...unsignedV21, checksum }), '2026-11-19');

    expect(imported.ok).toBe(true);
    if (imported.ok) {
      expect(imported.migratedLegacyCount).toBe(2);
      expect(imported.state.wordProgress.ona).toMatchObject({
        wordId: 'ona',
        status: 'syllable',
        pendingVoiceVerify: true,
        nextReviewDate: '2026-11-19',
        reviewIntervalDays: 0,
      });
      expect(imported.state.wordProgress.kitob?.status).toBe('syllable');
      expect(imported.state.seenWordIds).toEqual(['ona', 'kitob']);
    }

    // Also supports bare legacy object without v2.1 envelope
    const bareLegacy = importProgressJson(
      JSON.stringify({
        progressByItem: {
          lola: { completed: true },
        },
      }),
      '2026-11-19',
    );
    expect(bareLegacy.ok).toBe(true);
    if (bareLegacy.ok) {
      expect(bareLegacy.state.wordProgress.lola?.status).toBe('syllable');
      expect(bareLegacy.state.wordProgress.lola?.pendingVoiceVerify).toBe(true);
    }
  });

  it('migrates Alifbo 2.0 localStorage fixtures lacking wordProgress while preserving schemaVersion 3', () => {
    const mockStorage = createMockLocalStorage();
    vi.stubGlobal('window', { localStorage: mockStorage });

    const alifbo20Fixture = {
      schemaVersion: 3,
      pinSalt: 'salt_20',
      pinHash: 'hash_20',
      recoveryCodeHash: 'rec_20',
      pinLockout: { failedAttempts: 0, lockedUntilMs: null },
      profile: { name: 'Bolajon', avatarId: 'fox', dailyGoalXp: 60 },
      progressByItem: {},
      totalStars: 5,
      totalEffortStars: 3,
      practiceDates: ['2026-11-18'],
      recentLatenciesMs: [40],
      seenWordIds: ['kitob', 'lola'],
    };

    mockStorage.setItem('alifbo_app_state_v3', JSON.stringify(alifbo20Fixture));
    const loaded = loadAlifboState();
    expect(loaded.recoveredCorruptData).toBe(false);
    expect(loaded.state.schemaVersion).toBe(3);
    expect(loaded.state.wordProgress.kitob?.status).toBe('syllable');
    expect(loaded.state.wordProgress.kitob?.pendingVoiceVerify).toBe(true);
    expect(loaded.state.wordProgress.lola?.status).toBe('syllable');

    saveAlifboState(loaded.state);
    const reloaded = loadAlifboState();
    expect(reloaded.state.wordProgress.kitob?.pendingVoiceVerify).toBe(true);
  });

  it('auto-generates and persists a stable 8-digit numeric publicId once for legacy localStorage profiles', () => {
    const mockStorage = createMockLocalStorage();
    vi.stubGlobal('window', { localStorage: mockStorage });

    const base = createInitialState();
    const withoutPublicId = {
      ...base,
      account: {
        id: 'acc_legacy123',
        contact: '+998901112233',
        createdAt: '2026-10-01T08:00:00.000Z',
        signedInAt: '2026-10-01T08:00:00.000Z',
      },
    };
    mockStorage.setItem('alifbo_app_state_v3', JSON.stringify(withoutPublicId));

    const firstLoad = loadAlifboState();
    expect(firstLoad.recoveredCorruptData).toBe(false);
    const assignedId = firstLoad.state.account?.publicId ?? '';
    expect(assignedId).toMatch(/^[1-9]\d{7}$/);

    // Must already be persisted back to localStorage so reload keeps the exact same ID
    const secondLoad = loadAlifboState();
    expect(secondLoad.state.account?.publicId).toBe(assignedId);

    // Legacy ALF-XXXX-XXXX publicId is also migrated once to an 8-digit numeric publicId
    const withOldPrefix = {
      ...base,
      account: {
        id: 'acc_old_prefix',
        publicId: 'ALF-ABCD-2345',
        contact: 'parent@example.uz',
        createdAt: '2026-10-02T08:00:00.000Z',
        signedInAt: '2026-10-02T08:00:00.000Z',
      },
    };
    mockStorage.setItem('alifbo_app_state_v3', JSON.stringify(withOldPrefix));

    const migratedLoad = loadAlifboState();
    const migratedId = migratedLoad.state.account?.publicId ?? '';
    expect(migratedId).toMatch(/^[1-9]\d{7}$/);
    expect(loadAlifboState().state.account?.publicId).toBe(migratedId);
  });
});
