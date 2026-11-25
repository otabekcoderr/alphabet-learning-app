import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getDisplayablePublicId,
  GUEST_TRIAL_ACCOUNT_ID,
  isGuestAccount,
  isValidAccountPublicId,
} from '../auth';
import { buildParentNotifications } from '../notifications';
import {
  consumeGuestMigrationSnapshot,
  createInitialState,
  GUEST_MIGRATION_STORAGE_KEY,
  GUEST_MIGRATION_TTL_MS,
  loadAlifboState,
  mergeAlifboStates,
  saveAlifboState,
  stageGuestMigrationSnapshot,
} from '../../storage/progressStorage';
import {
  GET as notificationsGet,
  POST as notificationsPost,
  resetAdminAlertRateLimiter,
} from '../../../api/notifications';
import {
  canRegisterWebhookForOrigin,
  ensureTelegramWebhookRegistered,
  getTashkentDateString,
  getTashkentHour,
} from '../../../api/_lib/telegramBot';
import { GET as telegramWebhookGet } from '../../../api/telegram-webhook';

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

describe('Alifbo 2.3 Phase 1 — Guest Trial ID, CRDT Merge, Notifications & @alifbo_uz_robot Reminders', () => {
  const originalEnv = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_ADMIN_CHAT_ID: process.env.TELEGRAM_ADMIN_CHAT_ID,
    CRON_SECRET: process.env.CRON_SECRET,
    DATABASE_URL: process.env.DATABASE_URL,
    PUBLIC_APP_URL: process.env.PUBLIC_APP_URL,
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV,
  };

  afterEach(() => {
    resetAdminAlertRateLimiter();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const [key, val] of Object.entries(originalEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  it('hides and strips any fake 8-digit publicId on Guest Trial accounts across reloads', () => {
    const mockStorage = createMockLocalStorage();
    vi.stubGlobal('window', { localStorage: mockStorage });

    const legacyGuestState = {
      ...createInitialState(),
      account: {
        id: GUEST_TRIAL_ACCOUNT_ID,
        publicId: '48291034',
        contact: 'Sinov rejimi',
        createdAt: '2026-11-24T10:00:00.000Z',
        signedInAt: '2026-11-24T10:00:00.000Z',
      },
    };
    saveAlifboState(legacyGuestState);

    const loaded = loadAlifboState();
    expect(loaded.recoveredCorruptData).toBe(false);
    expect(isGuestAccount(loaded.state.account)).toBe(true);
    expect(loaded.state.account?.publicId).toBeUndefined();
    expect(getDisplayablePublicId(loaded.state.account)).toBeUndefined();
    expect(loaded.state.progressOwnerId).toBe(GUEST_TRIAL_ACCOUNT_ID);

    // Cleaned state persisted without fake ID
    const persisted = JSON.parse(mockStorage.getItem('alifbo_app_state_v3') ?? '{}') as {
      account?: { publicId?: string };
    };
    expect(persisted.account?.publicId).toBeUndefined();
  });

  it('migrates 100% of Guest Trial progress and surveyData to a brand-new permanent account with 8-digit publicId', () => {
    const guest = createInitialState();
    guest.account = {
      id: GUEST_TRIAL_ACCOUNT_ID,
      isGuest: true,
      contact: 'Sinov rejimi',
      createdAt: '2026-11-24T10:00:00.000Z',
      signedInAt: '2026-11-24T10:00:00.000Z',
    };
    guest.progressOwnerId = GUEST_TRIAL_ACCOUNT_ID;
    guest.profile = { name: 'Madina', avatarId: 'owl', dailyGoalXp: 60 };
    guest.totalStars = 9;
    guest.totalEffortStars = 3;
    guest.completedSessionsCount = 2;
    guest.seenWordIds = ['ona', 'non'];
    guest.practiceDates = ['2026-11-24'];
    guest.wordProgress = {
      ona: {
        wordId: 'ona',
        status: 'mastered',
        reviewIntervalDays: 3,
        nextReviewDate: '2026-11-27',
        attemptCount: 1,
        assistedCount: 0,
      },
      non: {
        wordId: 'non',
        status: 'syllable',
        reviewIntervalDays: 1,
        nextReviewDate: '2026-11-25',
        attemptCount: 2,
        assistedCount: 0,
        pendingVoiceVerify: true,
      },
    };
    guest.surveyData = {
      completedAt: '2026-11-24T10:00:00.000Z',
      ageGroup: '6-7',
      readingChallenge: 'blending',
      dailyLimitMinutes: 15,
      desiredFutureSubjects: [],
    };

    const result = mergeAlifboStates({
      remoteState: null,
      guestState: guest,
      session: {
        id: 'user-uuid-1234',
        publicId: '73829104',
        contact: '@madina_parent',
        createdAt: '2026-11-25T06:00:00.000Z',
        signedInAt: '2026-11-25T06:00:00.000Z',
        provider: 'telegram',
      },
      childName: 'Bolajon',
      avatarId: 'fox',
    });

    expect(result.didMergeGuest).toBe(true);
    expect(isGuestAccount(result.state.account)).toBe(false);
    expect(isValidAccountPublicId(result.state.account?.publicId)).toBe(true);
    expect(result.state.account?.publicId).toBe('73829104');
    expect(result.state.progressOwnerId).toBe('user-uuid-1234');
    expect(result.state.pendingRemoteSync).toBe(true);
    expect(result.state.totalStars).toBe(9);
    expect(result.state.totalEffortStars).toBe(3);
    expect(result.state.seenWordIds).toEqual(['ona', 'non']);
    expect(result.state.wordProgress.ona?.status).toBe('mastered');
    expect(result.state.wordProgress.non?.status).toBe('syllable');
    expect(result.state.surveyData?.readingChallenge).toBe('blending');
    expect(result.state.profile.name).toBe('Madina');
    expect(result.state.profile.avatarId).toBe('owl');
  });

  it('CRDT-merges Guest progress into an existing cloud account without overwriting higher remote mastery', () => {
    const remote = createInitialState();
    remote.account = {
      id: 'user-uuid-999',
      publicId: '11223344',
      contact: 'parent@example.uz',
      createdAt: '2026-10-01T10:00:00.000Z',
      signedInAt: '2026-11-20T10:00:00.000Z',
      provider: 'google',
    };
    remote.profile = { name: 'Ali', avatarId: 'lion', dailyGoalXp: 60 };
    remote.totalStars = 15;
    remote.seenWordIds = ['ona', 'olma'];
    remote.practiceDates = ['2026-11-20', '2026-11-21'];
    remote.completedSessionsCount = 4;
    remote.wordProgress = {
      ona: {
        wordId: 'ona',
        status: 'mastered',
        reviewIntervalDays: 7,
        nextReviewDate: '2026-11-28',
        attemptCount: 2,
        assistedCount: 0,
      },
    };
    remote.letterMastery = {
      A: {
        letter: 'A',
        status: 'mastered',
        correctCount: 4,
        streak: 3,
        lastReviewedAt: '2026-11-21',
      },
    };

    const guest = createInitialState();
    guest.account = {
      id: GUEST_TRIAL_ACCOUNT_ID,
      isGuest: true,
      contact: 'Sinov rejimi',
      createdAt: '2026-11-25T05:00:00.000Z',
      signedInAt: '2026-11-25T05:00:00.000Z',
    };
    guest.seenWordIds = ['ona', 'non'];
    guest.practiceDates = ['2026-11-25'];
    guest.completedSessionsCount = 1;
    guest.totalStars = 3;
    guest.wordProgress = {
      ona: {
        wordId: 'ona',
        status: 'assisted',
        reviewIntervalDays: 0,
        nextReviewDate: '2026-11-25',
        attemptCount: 1,
        assistedCount: 1,
      },
      non: {
        wordId: 'non',
        status: 'mastered',
        reviewIntervalDays: 3,
        nextReviewDate: '2026-11-28',
        attemptCount: 1,
        assistedCount: 0,
      },
    };
    guest.letterMastery = {
      A: {
        letter: 'A',
        status: 'practiced',
        correctCount: 1,
        streak: 1,
        lastReviewedAt: '2026-11-25',
      },
      O: {
        letter: 'O',
        status: 'mastered',
        correctCount: 2,
        streak: 2,
        lastReviewedAt: '2026-11-25',
      },
    };

    const merged = mergeAlifboStates({
      remoteState: remote,
      guestState: guest,
      session: remote.account,
    });

    expect(merged.didMergeGuest).toBe(true);
    expect(merged.state.pendingRemoteSync).toBe(true);
    // Remote mastered 'ona' is NOT downgraded by Guest 'assisted'
    expect(merged.state.wordProgress.ona?.status).toBe('mastered');
    // Guest 'non' mastered is preserved
    expect(merged.state.wordProgress.non?.status).toBe('mastered');
    // Letter mastery keeps A as mastered and adds O
    expect(merged.state.letterMastery.A?.status).toBe('mastered');
    expect(merged.state.letterMastery.O?.status).toBe('mastered');
    // Union sets
    expect(merged.state.seenWordIds).toEqual(['ona', 'olma', 'non']);
    expect(merged.state.practiceDates).toEqual(['2026-11-20', '2026-11-21', '2026-11-25']);
    expect(merged.state.completedSessionsCount).toBe(5);
    expect(merged.state.totalStars).toBe(18);
  });

  it('stages and consumes Guest OAuth snapshot once with 30-min TTL protection', () => {
    const mockStorage = createMockLocalStorage();
    vi.stubGlobal('window', { localStorage: mockStorage });

    const guest = createInitialState();
    guest.account = {
      id: GUEST_TRIAL_ACCOUNT_ID,
      isGuest: true,
      contact: 'Sinov rejimi',
      createdAt: '2026-11-25T05:00:00.000Z',
      signedInAt: '2026-11-25T05:00:00.000Z',
    };
    guest.progressOwnerId = GUEST_TRIAL_ACCOUNT_ID;
    guest.totalStars = 6;

    expect(stageGuestMigrationSnapshot(guest, 1_000_000)).toBe(true);
    expect(mockStorage.getItem(GUEST_MIGRATION_STORAGE_KEY)).toBeTruthy();

    // Expired snapshot returns null and cleans up
    expect(
      consumeGuestMigrationSnapshot(1_000_000 + GUEST_MIGRATION_TTL_MS + 1),
    ).toBeNull();
    expect(mockStorage.getItem(GUEST_MIGRATION_STORAGE_KEY)).toBeNull();

    // Valid snapshot consumes once
    expect(stageGuestMigrationSnapshot(guest, 2_000_000)).toBe(true);
    const consumed = consumeGuestMigrationSnapshot(2_005_000);
    expect(consumed?.totalStars).toBe(6);
    expect(consumeGuestMigrationSnapshot(2_006_000)).toBeNull();
  });

  it('builds prioritized Parent Notifications for Guest warning, pending verify, and Telegram connect', () => {
    const guest = createInitialState();
    guest.account = {
      id: GUEST_TRIAL_ACCOUNT_ID,
      isGuest: true,
      contact: 'Sinov rejimi',
      createdAt: '2026-11-25T05:00:00.000Z',
      signedInAt: '2026-11-25T05:00:00.000Z',
    };
    guest.totalStars = 4;
    guest.wordProgress = {
      ona: {
        wordId: 'ona',
        status: 'syllable',
        reviewIntervalDays: 1,
        nextReviewDate: '2026-11-26',
        attemptCount: 1,
        assistedCount: 0,
        pendingVoiceVerify: true,
      },
    };

    const guestNotifs = buildParentNotifications({
      state: guest,
      remoteSettings: null,
    });
    expect(guestNotifs.map((n) => n.kind)).toContain('guest_save_warning');
    expect(guestNotifs.map((n) => n.kind)).toContain('pending_parent_verify');
    expect(guestNotifs.every((n) => n.unread)).toBe(true);

    // Registered Google user without Telegram bot linked
    const googleState = {
      ...guest,
      account: {
        id: 'user-g-1',
        publicId: '55667788',
        contact: 'ali@example.uz',
        createdAt: '2026-11-25T05:00:00.000Z',
        signedInAt: '2026-11-25T05:00:00.000Z',
        provider: 'google' as const,
      },
      readNotificationIds: ['local:telegram_reminder_connect'],
    };
    const googleNotifs = buildParentNotifications({
      state: googleState,
      remoteSettings: {
        telegramLinked: false,
        telegramUsername: null,
        reminderEnabled: true,
        reminderHour: 19,
        botBlocked: false,
        botUsername: 'alifbo_uz_robot',
      },
    });
    expect(googleNotifs.map((n) => n.kind)).not.toContain('guest_save_warning');
    const tgItem = googleNotifs.find((n) => n.kind === 'telegram_reminder_connect');
    expect(tgItem?.unread).toBe(false);
  });

  it('prevents Preview deployments from overwriting production Telegram webhook and protects GET /api/telegram/setup', async () => {
    process.env.TELEGRAM_BOT_TOKEN = '9100660571:sample_bot_token';
    process.env.VERCEL = '1';
    process.env.VERCEL_ENV = 'preview';
    delete process.env.PUBLIC_APP_URL;

    expect(canRegisterWebhookForOrigin('https://alifbo-git-feat-test.vercel.app')).toBe(false);
    const previewRes = await ensureTelegramWebhookRegistered(
      '9100660571:sample_bot_token',
      'https://alifbo-git-feat-test.vercel.app',
    );
    expect(previewRes.ok).toBe(false);
    expect(previewRes.reason).toBe('preview_env_skipped');

    process.env.CRON_SECRET = 'super_secret_cron_token_2026';
    const unauthorizedSetup = await telegramWebhookGet(
      new Request('https://alifbo-eight.vercel.app/api/telegram-webhook'),
    );
    expect(unauthorizedSetup.status).toBe(401);
  });

  it('validates CRON_SECRET on /api/cron/daily-reminder and forwards server-only admin-alert', async () => {
    process.env.CRON_SECRET = 'cron_secret_test_value_12345';
    process.env.TELEGRAM_BOT_TOKEN = '9100660571:sample_bot_token';
    process.env.TELEGRAM_ADMIN_CHAT_ID = '-100123456';
    delete process.env.DATABASE_URL;

    const badCron = await notificationsGet(
      new Request('https://alifbo-eight.vercel.app/api/notifications?action=cron-daily-reminder', {
        headers: { Authorization: 'Bearer wrong_secret' },
      }),
    );
    expect(badCron.status).toBe(401);

    const fetchStub = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchStub);

    const adminAlertRes = await notificationsPost(
      new Request('https://alifbo-eight.vercel.app/api/notifications?action=admin-alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: 'onboarding',
          text: 'ALIFBO — Test onboarding xabari',
        }),
      }),
    );
    expect(adminAlertRes.status).toBe(200);
    expect(fetchStub).toHaveBeenCalledTimes(1);

    // Verify Tashkent timezone helpers return valid YYYY-MM-DD and 0..23 hour
    const sampleDate = new Date('2026-11-25T20:30:00.000Z'); // 01:30 next day in UTC+5
    expect(getTashkentDateString(sampleDate)).toBe('2026-11-26');
    expect(getTashkentHour(sampleDate)).toBe(1);
  });

  it('enforces Vercel Hobby <= 12 serverless functions and zero VITE_TG_BOT_TOKEN leaks', async () => {
    const fsMod = 'node:fs';
    const pathMod = 'node:path';
    const fs = (await import(/* @vite-ignore */ fsMod)) as {
      readdirSync(dir: string, opts?: { withFileTypes: true }): Array<{
        name: string;
        isDirectory(): boolean;
        isFile(): boolean;
      }>;
      readFileSync(path: string, enc: string): string;
    };
    const path = (await import(/* @vite-ignore */ pathMod)) as {
      join(...parts: string[]): string;
      resolve(...parts: string[]): string;
    };

    const projectRoot = path.resolve(__dirname, '../../../');
    const apiDir = path.join(projectRoot, 'api');

    function countApiEndpoints(dir: string): number {
      let total = 0;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (entry.name === '_lib') continue;
          total += countApiEndpoints(path.join(dir, entry.name));
        } else if (entry.isFile() && entry.name.endsWith('.ts')) {
          total++;
        }
      }
      return total;
    }

    const endpointCount = countApiEndpoints(apiDir);
    expect(endpointCount).toBeLessThanOrEqual(12);
    expect(endpointCount).toBe(10);

    const envExample = fs.readFileSync(path.join(projectRoot, '.env.example'), 'utf8');
    expect(envExample).not.toContain('VITE_TG_BOT_TOKEN');

    const tgServiceSrc = fs.readFileSync(
      path.join(projectRoot, 'src', 'services', 'telegramService.ts'),
      'utf8',
    );
    expect(tgServiceSrc).not.toContain('VITE_TG_BOT_TOKEN');
    expect(tgServiceSrc).not.toContain('api.telegram.org');
  });
});
