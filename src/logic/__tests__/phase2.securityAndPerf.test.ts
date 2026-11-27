import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GET as stateGet,
  MAX_SERVER_STARS,
  MAX_SERVER_WORD_PROGRESS_KEYS,
  PUT as statePut,
  sanitizeServerStatePayload,
} from '../../../api/state';
import { POST as notificationsPost } from '../../../api/notifications';
import { GET as googleAuthGet } from '../../../api/auth/google';
import { POST as authSessionPost } from '../../../api/auth/session';
import { POST as telegramAuthPost } from '../../../api/auth/telegram';
import { MAX_AUDIO_BYTES, POST as sttPost } from '../../../api/stt';
import { GET as ttsGet, MAX_TTS_TEXT_LENGTH, POST as ttsPost } from '../../../api/tts';
import { ensureSchema, resetSchemaCache } from '../../../api/_lib/db';
import { handleHealthCheck } from '../../../api/_lib/health';
import {
  consumeDailyGlobalBudget,
  resetMemoryRateLimits,
} from '../../../api/_lib/rateLimit';
import { consumeTelegramLinkSessionOnWebhook } from '../../../api/_lib/telegramAuthStore';
import { getOrderedAlphabetTiles } from '../../components/AlphabetRecallDrawer';
import { resolveHomeBannerMode } from '../../components/ChildHome';
import {
  clearPendingPinReset,
  consumePendingPinReset,
  createInitialState,
  exportProgressJson,
  hydrateAlifboState,
  importProgressJson,
  MAX_IMPORT_JSON_BYTES,
  MAX_STARS_BOUND,
  PENDING_PIN_RESET_STORAGE_KEY,
  PENDING_PIN_RESET_TTL_MS,
  stagePendingPinReset,
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

function buildSineWav(durationMs: number, sampleRate = 16_000): Buffer {
  const sampleCount = Math.floor((sampleRate * durationMs) / 1000);
  const dataBytes = sampleCount * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < sampleCount; i++) {
    const val = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.25 * 32767);
    buf.writeInt16LE(val, 44 + i * 2);
  }
  return buf;
}

describe('Alifbo 2.3 Phase 2 — Security Shield, Cost Guardrails, 8/12 Consolidation & Import Bounds', () => {
  const originalEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_ADMIN_CHAT_ID: process.env.TELEGRAM_ADMIN_CHAT_ID,
    VOICELAB_API_KEY: process.env.VOICELAB_API_KEY,
    UZBEKVOICE_API_KEY: process.env.UZBEKVOICE_API_KEY,
    STT_BACKEND_URL: process.env.STT_BACKEND_URL,
    STT_DAILY_GLOBAL_CAP: process.env.STT_DAILY_GLOBAL_CAP,
    TTS_DAILY_GLOBAL_CAP: process.env.TTS_DAILY_GLOBAL_CAP,
    KV_REST_API_URL: process.env.KV_REST_API_URL,
    KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN,
    VERCEL: process.env.VERCEL,
  };

  afterEach(() => {
    resetMemoryRateLimits();
    resetSchemaCache();
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

  it('consolidates /api/health -> /api/state?action=health and /api/auth/google + callback into 8 endpoints', async () => {
    delete process.env.STT_BACKEND_URL;
    delete process.env.UZBEKVOICE_API_KEY;
    process.env.VOICELAB_API_KEY = 'vlk_test';
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/alifbo';
    process.env.GOOGLE_CLIENT_ID = 'google-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';

    const directHealth = await handleHealthCheck();
    const stateHealth = await stateGet(new Request('https://alifbo-eight.vercel.app/api/state?action=health'));
    expect(stateHealth.status).toBe(200);
    expect(await stateHealth.json()).toEqual(await directHealth.json());

    const startRes = await googleAuthGet(
      new Request('https://alifbo-eight.vercel.app/api/auth/google?childName=Ali&avatarId=lion'),
    );
    expect(startRes.status).toBe(302);
    expect(startRes.headers.get('location')).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    expect(startRes.headers.get('set-cookie')).toContain('alifbo_oauth_state=');

    const callbackCancelRes = await googleAuthGet(
      new Request('https://alifbo-eight.vercel.app/api/auth/google?action=callback&error=access_denied'),
    );
    expect(callbackCancelRes.status).toBe(302);
    expect(callbackCancelRes.headers.get('location')).toBe(
      'https://alifbo-eight.vercel.app/?auth_error=google_cancelled',
    );
    expect(callbackCancelRes.headers.get('set-cookie')).toContain('alifbo_oauth_state=;');

    const fsMod = 'node:fs';
    const pathMod = 'node:path';
    const fs = (await import(/* @vite-ignore */ fsMod)) as {
      existsSync(path: string): boolean;
      readFileSync(path: string, enc: string): string;
      readdirSync(dir: string, opts?: { withFileTypes: true }): Array<{
        name: string;
        isDirectory(): boolean;
        isFile(): boolean;
      }>;
    };
    const path = (await import(/* @vite-ignore */ pathMod)) as {
      join(...parts: string[]): string;
      resolve(...parts: string[]): string;
    };

    const projectRoot = path.resolve(__dirname, '../../../');
    const vercelJson = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'vercel.json'), 'utf8'),
    ) as { rewrites: Array<{ source: string; destination: string }> };

    expect(vercelJson.rewrites).toEqual(
      expect.arrayContaining([
        { source: '/api/health', destination: '/api/state?action=health' },
        { source: '/api/auth/google/callback', destination: '/api/auth/google?action=callback' },
      ]),
    );

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

    expect(countApiEndpoints(path.join(projectRoot, 'api'))).toBe(8);
    expect(fs.existsSync(path.join(projectRoot, 'src/components/ChildProfile.tsx'))).toBe(false);
    expect(fs.existsSync(path.join(projectRoot, 'src/components/StageMap.tsx'))).toBe(false);
  });

  it('enforces /api/stt payload size, duration, origin guard, and 429 rate-limits', async () => {
    delete process.env.DATABASE_URL;
    delete process.env.STT_BACKEND_URL;
    delete process.env.VOICELAB_API_KEY;
    process.env.UZBEKVOICE_API_KEY = 'uzv_test_key';

    // Cross-origin rejection
    const sampleWav = buildSineWav(500);
    const evilOriginRes = await sttPost(
      new Request('https://alifbo-eight.vercel.app/api/stt?expected=ANOR', {
        method: 'POST',
        headers: {
          'Content-Type': 'audio/wav',
          Origin: 'https://evil.example',
        },
        body: new Uint8Array(sampleWav),
      }),
    );
    expect(evilOriginRes.status).toBe(403);

    // Oversized (> 1.5 MB) payload rejection
    const oversized = Buffer.alloc(MAX_AUDIO_BYTES + 100);
    const bigRes = await sttPost(
      new Request('https://alifbo-eight.vercel.app/api/stt?expected=ANOR', {
        method: 'POST',
        headers: { 'Content-Type': 'audio/wav' },
        body: new Uint8Array(oversized),
      }),
    );
    expect(bigRes.status).toBe(413);

    // Over-duration (> 15s) WAV rejection
    const longWav = buildSineWav(16_000);
    const longRes = await sttPost(
      new Request('https://alifbo-eight.vercel.app/api/stt?expected=ANOR', {
        method: 'POST',
        headers: { 'Content-Type': 'audio/wav' },
        body: new Uint8Array(longWav),
      }),
    );
    expect(longRes.status).toBe(400);

    // 20/min burst limit -> 21st request returns 429 with Retry-After
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ id: 't1', status: 'SUCCESS', result: { text: 'anor' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    for (let i = 0; i < 20; i++) {
      const okRes = await sttPost(
        new Request('https://alifbo-eight.vercel.app/api/stt?expected=ANOR&accept=anor', {
          method: 'POST',
          headers: {
            'Content-Type': 'audio/wav',
            'x-forwarded-for': '203.0.113.10',
          },
          body: new Uint8Array(sampleWav),
        }),
      );
      expect(okRes.status).toBe(200);
    }

    const limitedRes = await sttPost(
      new Request('https://alifbo-eight.vercel.app/api/stt?expected=ANOR&accept=anor', {
        method: 'POST',
        headers: {
          'Content-Type': 'audio/wav',
          'x-forwarded-for': '203.0.113.10',
        },
        body: new Uint8Array(sampleWav),
      }),
    );
    expect(limitedRes.status).toBe(429);
    expect(limitedRes.headers.get('retry-after')).toBeTruthy();
    expect(await limitedRes.json()).toMatchObject({ ok: false, reason: 'rate_limited' });
  });

  it('protects /api/tts against hotlinking, cross-origin, oversized text, and alerts once at 80% global budget', async () => {
    delete process.env.DATABASE_URL;
    process.env.VOICELAB_API_KEY = 'vlk_test_key';
    process.env.TELEGRAM_BOT_TOKEN = '9100660571:sample_bot_token';
    process.env.TELEGRAM_ADMIN_CHAT_ID = '-100123456';

    // Bare unauthenticated GET without Origin/Referer is blocked (anti-hotlink)
    const bareGetRes = await ttsGet(
      new Request('https://alifbo-eight.vercel.app/api/tts?text=Salom'),
    );
    expect(bareGetRes.status).toBe(403);

    // Cross-origin POST is blocked
    const evilPostRes = await ttsPost(
      new Request('https://alifbo-eight.vercel.app/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://third-party.example',
        },
        body: JSON.stringify({ text: 'Salom' }),
      }),
    );
    expect(evilPostRes.status).toBe(403);

    // Text > 300 chars is rejected
    const tooLongRes = await ttsPost(
      new Request('https://alifbo-eight.vercel.app/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://alifbo-eight.vercel.app',
        },
        body: JSON.stringify({ text: 'a'.repeat(MAX_TTS_TEXT_LENGTH + 1) }),
      }),
    );
    expect(tooLongRes.status).toBe(400);

    // Same-origin POST succeeds with Cache-Control: private
    const mockWav = buildSineWav(200);
    const telegramAlerts: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/sendMessage') && typeof init?.body === 'string') {
          telegramAlerts.push(init.body);
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return new Response(new Uint8Array(mockWav), { status: 200 });
      }),
    );

    const validPost = await ttsPost(
      new Request('https://alifbo-eight.vercel.app/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://alifbo-eight.vercel.app',
        },
        body: JSON.stringify({ text: 'Salom' }),
      }),
    );
    expect(validPost.status).toBe(200);
    expect(validPost.headers.get('cache-control')).toBe('private, max-age=86400');

    // 80% global budget triggers Telegram alert exactly once
    resetMemoryRateLimits();
    for (let i = 1; i <= 10; i++) {
      const b = await consumeDailyGlobalBudget({
        service: 'tts',
        dailyCap: 10,
        now: new Date('2026-11-25T10:00:00.000Z'),
      });
      expect(b.allowed).toBe(true);
    }
    const over = await consumeDailyGlobalBudget({
      service: 'tts',
      dailyCap: 10,
      now: new Date('2026-11-25T10:00:00.000Z'),
    });
    expect(over.allowed).toBe(false);
    expect(telegramAlerts).toHaveLength(1);
    expect(telegramAlerts[0]).toContain('80%');
  });

  it('rate-limits auth login brute-force and Telegram 6-digit OTP guessing with HTTP 429', async () => {
    delete process.env.DATABASE_URL;
    process.env.TELEGRAM_BOT_TOKEN = '9100660571:sample_bot_token';

    // When DB is set to dummy URL, rateLimit runs before SQL or falls back cleanly when DB fails
    process.env.DATABASE_URL = 'postgres://user:pass@127.0.0.1:1/unreachable';

    for (let i = 0; i < 6; i++) {
      const codeRes = await telegramAuthPost(
        new Request('https://alifbo-eight.vercel.app/api/auth/telegram', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': '198.51.100.77',
          },
          body: JSON.stringify({ code: '123456' }),
        }),
      );
      expect(codeRes.status).not.toBe(429);
    }
    const codeBlocked = await telegramAuthPost(
      new Request('https://alifbo-eight.vercel.app/api/auth/telegram', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '198.51.100.77',
        },
        body: JSON.stringify({ code: '123456' }),
      }),
    );
    expect(codeBlocked.status).toBe(429);

    for (let i = 0; i < 6; i++) {
      const loginRes = await authSessionPost(
        new Request('https://alifbo-eight.vercel.app/api/auth/session?action=login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': `198.51.100.${10 + i}`,
          },
          body: JSON.stringify({ contact: 'parent@example.uz', password: 'wrong' }),
        }),
      );
      expect(loginRes.status).not.toBe(429);
    }
    const loginContactBlocked = await authSessionPost(
      new Request('https://alifbo-eight.vercel.app/api/auth/session?action=login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '198.51.100.99',
        },
        body: JSON.stringify({ contact: 'parent@example.uz', password: 'wrong' }),
      }),
    );
    expect(loginContactBlocked.status).toBe(429);
  });

  it('stages/consumes registered PIN reset markers safely and enforces JSON import size & star bounds', () => {
    const mockStorage = createMockLocalStorage();
    vi.stubGlobal('window', { localStorage: mockStorage });

    stagePendingPinReset('acc-123', 1_000_000);
    expect(mockStorage.getItem(PENDING_PIN_RESET_STORAGE_KEY)).toBeTruthy();

    // Wrong account cannot consume and marker clears safely
    expect(consumePendingPinReset('acc-other', 1_001_000)).toBe(false);

    // Expired marker fails
    stagePendingPinReset('acc-123', 1_000_000);
    expect(consumePendingPinReset('acc-123', 1_000_000 + PENDING_PIN_RESET_TTL_MS + 1)).toBe(false);

    // Valid matching account consumes once
    stagePendingPinReset('acc-123', 2_000_000);
    expect(consumePendingPinReset('acc-123', 2_010_000)).toBe(true);
    expect(consumePendingPinReset('acc-123', 2_011_000)).toBe(false);

    clearPendingPinReset();

    // JSON > 512 KB rejected
    const oversizedJson = JSON.stringify({ filler: 'x'.repeat(MAX_IMPORT_JSON_BYTES + 100) });
    const oversizeImport = importProgressJson(oversizedJson);
    expect(oversizeImport.ok).toBe(false);

    // Valid export with inflated numeric values gets clamped on hydrate/import
    const inflated = {
      ...createInitialState(),
      totalStars: 999_999_999,
      totalEffortStars: -40,
      todayPracticedSeconds: 999_999,
      completedSessionsCount: 999_999,
    };
    const exported = exportProgressJson(inflated, '2026-11-25T05:00:00.000Z');
    const imported = importProgressJson(exported, '2026-11-25');
    expect(imported.ok).toBe(true);
    if (imported.ok) {
      expect(imported.state.totalStars).toBe(MAX_STARS_BOUND);
      expect(imported.state.totalEffortStars).toBe(0);
      expect(imported.state.todayPracticedSeconds).toBe(86_400);
      expect(imported.state.completedSessionsCount).toBe(100_000);
    }

    const hydrated = hydrateAlifboState(inflated);
    expect(hydrated?.totalStars).toBe(MAX_STARS_BOUND);
    expect(hydrated?.todayPracticedSeconds).toBe(86_400);
  });

  it('hardens api/notifications and api/state against cross-origin CSRF, burst spam, and inflated state payloads', async () => {
    delete process.env.DATABASE_URL;
    process.env.TELEGRAM_BOT_TOKEN = '9100660571:sample_bot_token';
    process.env.TELEGRAM_ADMIN_CHAT_ID = '-100123456';

    for (const action of ['admin-alert', 'settings', 'telegram-link', 'telegram-unlink']) {
      const evilRes = await notificationsPost(
        new Request(`https://alifbo-eight.vercel.app/api/notifications?action=${action}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://evil.example',
          },
          body: JSON.stringify({ text: 'ALIFBO — Cross-origin probe' }),
        }),
      );
      expect(evilRes.status).toBe(403);
    }

    const evilStatePut = await statePut(
      new Request('https://alifbo-eight.vercel.app/api/state', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://evil.example',
        },
        body: JSON.stringify({ state: { totalStars: 99 } }),
      }),
    );
    expect(evilStatePut.status).toBe(403);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    for (let i = 0; i < 8; i++) {
      const okRes = await notificationsPost(
        new Request('https://alifbo-eight.vercel.app/api/notifications?action=admin-alert', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://alifbo-eight.vercel.app',
            'x-forwarded-for': '203.0.113.55',
          },
          body: JSON.stringify({ text: `ALIFBO — Valid alert ${i}` }),
        }),
      );
      expect(okRes.status).toBe(200);
    }

    const blockedAlert = await notificationsPost(
      new Request('https://alifbo-eight.vercel.app/api/notifications?action=admin-alert', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://alifbo-eight.vercel.app',
          'x-forwarded-for': '203.0.113.55',
        },
        body: JSON.stringify({ text: 'ALIFBO — Burst alert 9' }),
      }),
    );
    expect(blockedAlert.status).toBe(429);
    expect(blockedAlert.headers.get('retry-after')).toBeTruthy();

    const oversizedWordProgress: Record<string, { status: string }> = {};
    for (let i = 0; i < MAX_SERVER_WORD_PROGRESS_KEYS + 50; i++) {
      oversizedWordProgress[`w_${i}`] = { status: 'mastered' };
    }
    const sanitized = sanitizeServerStatePayload(
      {
        totalStars: 999_999,
        totalEffortStars: -15,
        todayPracticedSeconds: 500_000,
        completedSessionsCount: 999_999,
        practiceDates: ['2026-11-25', '2099-01-01', '2026-11-25'],
        wordProgress: oversizedWordProgress,
      },
      '2026-11-26',
    );
    expect(sanitized.totalStars).toBe(MAX_SERVER_STARS);
    expect(sanitized.totalEffortStars).toBe(0);
    expect(sanitized.todayPracticedSeconds).toBe(86_400);
    expect(sanitized.completedSessionsCount).toBe(100_000);
    expect(sanitized.practiceDates).toEqual(['2026-11-25', '2026-11-26']);
    expect(Object.keys(sanitized.wordProgress as Record<string, unknown>)).toHaveLength(
      MAX_SERVER_WORD_PROGRESS_KEYS,
    );
  });

  it('uses NX atomic lock for KV tg_link consumption and fast-paths ensureSchema() in 1 query', async () => {
    delete process.env.DATABASE_URL;
    process.env.KV_REST_API_URL = 'https://kv.example.upstash.io';
    process.env.KV_REST_API_TOKEN = 'kv-secret';

    const linkPayload = JSON.stringify({
      status: 'pending_link',
      linkUserId: 'user-77',
      childName: null,
      avatarId: null,
      telegramId: null,
      telegramUsername: null,
      firstName: '',
      lastName: '',
      expiresAtMs: Date.now() + 60_000,
      consumedAtMs: null,
    });
    const kvCommands: string[][] = [];
    let nxClaimed = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const cmd = JSON.parse(String(init?.body ?? '[]')) as string[];
        kvCommands.push(cmd);
        if (cmd[0] === 'GET') {
          return new Response(JSON.stringify({ result: linkPayload }), { status: 200 });
        }
        if (cmd[0] === 'SET' && cmd.includes('NX')) {
          if (nxClaimed) {
            return new Response(JSON.stringify({ result: null }), { status: 200 });
          }
          nxClaimed = true;
          return new Response(JSON.stringify({ result: 'OK' }), { status: 200 });
        }
        return new Response(JSON.stringify({ result: 1 }), { status: 200 });
      }),
    );

    const firstConsume = await consumeTelegramLinkSessionOnWebhook({ tokenHash: 'hash_abc' });
    const secondConsume = await consumeTelegramLinkSessionOnWebhook({ tokenHash: 'hash_abc' });
    expect(firstConsume).toEqual({ ok: true, userId: 'user-77' });
    expect(secondConsume).toEqual({ ok: false, reason: 'expired_or_invalid' });
    expect(kvCommands.some((c) => c[0] === 'SET' && c[1] === 'tg_link_claimed:hash_abc' && c[3] === 'NX')).toBe(
      true,
    );

    const fastSql = vi.fn(async () => [
      {
        users_tbl: 'users',
        states_tbl: 'user_states',
        tg_codes_tbl: 'telegram_auth_codes',
        tg_login_tbl: 'telegram_login_sessions',
        notifs_tbl: 'parent_notifications',
        limits_tbl: 'api_rate_limits',
        has_users_v23: true,
        has_tg_link_col: true,
      },
    ]);
    await ensureSchema(fastSql as unknown as Parameters<typeof ensureSchema>[0]);
    expect(fastSql).toHaveBeenCalledTimes(1);

    const coldSql = vi
      .fn()
      .mockResolvedValueOnce([{ users_tbl: 'users', states_tbl: null }])
      .mockResolvedValue([]);
    await ensureSchema(coldSql as unknown as Parameters<typeof ensureSchema>[0]);
    expect(coldSql.mock.calls.length).toBeGreaterThan(10);
  });

  it('builds a 30-tile mobile-friendly alphabet grid, non-stacking home banners, and clean sticky CSS', async () => {
    const tiles = getOrderedAlphabetTiles();
    expect(tiles).toHaveLength(30);
    expect(tiles[29]?.letter).toBe('’');
    expect(tiles[29]?.category).toBe('mark');

    expect(
      resolveHomeBannerMode({
        isGuest: true,
        hasGuestUpgrade: true,
        seenWordsCount: 0,
        masteredWordsCount: 0,
      }),
    ).toBe('pwa');
    expect(
      resolveHomeBannerMode({
        isGuest: true,
        hasGuestUpgrade: true,
        seenWordsCount: 1,
        masteredWordsCount: 0,
      }),
    ).toBe('guest');
    expect(
      resolveHomeBannerMode({
        isGuest: false,
        hasGuestUpgrade: true,
        seenWordsCount: 5,
        masteredWordsCount: 2,
      }),
    ).toBe('pwa');

    const fsMod = 'node:fs';
    const pathMod = 'node:path';
    const fs = (await import(/* @vite-ignore */ fsMod)) as {
      readFileSync(path: string, enc: string): string;
    };
    const path = (await import(/* @vite-ignore */ pathMod)) as {
      join(...parts: string[]): string;
      resolve(...parts: string[]): string;
    };
    const projectRoot = path.resolve(__dirname, '../../../');
    const cssText = fs.readFileSync(path.join(projectRoot, 'src/index.css'), 'utf8');
    expect(cssText).toContain('overflow-x: clip;');
    expect(cssText).toContain('.alphabet-segmented-tabs');
    expect(cssText).toContain('.mic-btn-big');
    expect(cssText).toContain('.home-mascot-top-grid');
    expect(cssText).toContain('.alphabet-main-content');
    expect(cssText).toContain('grid-auto-rows');

    const animatedCharSrc = fs.readFileSync(
      path.join(projectRoot, 'src/components/AnimatedCharacter.tsx'),
      'utf8',
    );
    expect(animatedCharSrc).toContain('--char-size');
    expect(animatedCharSrc).not.toContain('size * 0.9');

    const welcomeSrc = fs.readFileSync(
      path.join(projectRoot, 'src/components/WelcomeScreen.tsx'),
      'utf8',
    );
    expect(welcomeSrc).not.toContain('Slayder');
  });
});
