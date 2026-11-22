import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  formatAccountPublicId,
  generateAccountPublicId as generateServerAccountPublicId,
  isValidAccountPublicId as isValidServerAccountPublicId,
} from '../../../api/_lib/crypto';
import {
  analyzeWavSilence,
  detectAudioFormat,
  evaluateSttMatch,
  normalizeUzbekServer,
} from '../../../api/_lib/stt';
import { resetMemoryTelegramAuthStore } from '../../../api/_lib/telegramAuthStore';
import {
  createTelegramLoginToken,
  deriveTelegramWebhookSecret,
  generateSixDigitCode,
  hashTelegramAuthCode,
  isPublicHttpsOrigin,
  verifyTelegramLoginToken,
} from '../../../api/_lib/telegramBot';
import {
  DELETE as authSessionDelete,
  GET as authSessionGet,
  POST as authSessionPost,
} from '../../../api/auth/session';
import {
  GET as telegramAuthGet,
  POST as telegramAuthPost,
} from '../../../api/auth/telegram';
import {
  GET as telegramWebhookGet,
  POST as telegramWebhookPost,
} from '../../../api/telegram-webhook';

function buildPcm16MonoWav(samples: Int16Array, sampleRate = 16_000): Buffer {
  const dataBytes = samples.length * 2;
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
  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE(samples[i] ?? 0, 44 + i * 2);
  }
  return buf;
}

describe('Cloud STT, Server Public IDs, and Telegram Bot Auth helpers', () => {
  const originalEnv = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_BOT_USERNAME: process.env.TELEGRAM_BOT_USERNAME,
    TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET,
    DATABASE_URL: process.env.DATABASE_URL,
    VERCEL: process.env.VERCEL,
    SESSION_SECRET: process.env.SESSION_SECRET,
  };

  afterEach(() => {
    resetMemoryTelegramAuthStore();
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
  it('detects pure-silence WAV, non-silent sine WAV, and skips non-WAV buffers', () => {
    const silentSamples = new Int16Array(8000);
    const silentWav = buildPcm16MonoWav(silentSamples);
    const silentRes = analyzeWavSilence(silentWav);
    expect(silentRes.isWav).toBe(true);
    expect(silentRes.isSilence).toBe(true);
    expect(silentRes.origMs).toBe(500);
    expect(silentRes.trimmedMs).toBe(0);

    const sineSamples = new Int16Array(8000);
    for (let i = 0; i < sineSamples.length; i++) {
      sineSamples[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / 16_000) * 0.3 * 32767);
    }
    const sineWav = buildPcm16MonoWav(sineSamples);
    const sineRes = analyzeWavSilence(sineWav);
    expect(sineRes.isWav).toBe(true);
    expect(sineRes.isSilence).toBe(false);
    expect(sineRes.trimmedMs).toBeGreaterThan(0);

    const mp3Buf = Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x00mock-mp3-data', 'binary');
    const mp3Res = analyzeWavSilence(mp3Buf);
    expect(mp3Res).toEqual({
      isWav: false,
      isSilence: false,
      origMs: 0,
      trimmedMs: 0,
      maxRms: 0,
    });
    expect(detectAudioFormat(silentWav)).toEqual({ mime: 'audio/wav', ext: 'wav' });
    expect(detectAudioFormat(mp3Buf)).toEqual({ mime: 'audio/mpeg', ext: 'mp3' });
  });

  it('normalizes Uzbek STT transcripts and matches expected words, spaced syllables, and apostrophes', () => {
    expect(normalizeUzbekServer('Anor!')).toBe('anor');
    expect(normalizeUzbekServer('O‘rdak')).toBe("o'rdak");

    expect(evaluateSttMatch('Anor.', 'anor', ['anor'])).toEqual({
      normalized: 'anor',
      accepted: true,
    });
    expect(evaluateSttMatch('O na', 'ona', ['ona'])).toEqual({
      normalized: 'o na',
      accepted: true,
    });
    expect(evaluateSttMatch('O‘rdak!', "o'rdak", ['ordak'])).toEqual({
      normalized: "o'rdak",
      accepted: true,
    });
    expect(evaluateSttMatch('kitob', 'anor', ['anor'])).toEqual({
      normalized: 'kitob',
      accepted: false,
    });
  });

  it('generates collision-free 8-digit numeric server public account IDs', () => {
    const generated = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const id = generateServerAccountPublicId();
      expect(isValidServerAccountPublicId(id)).toBe(true);
      expect(id).toMatch(/^[1-9]\d{7}$/);
      expect(formatAccountPublicId(id)).toMatch(/^[1-9]\d{3}-\d{4}$/);
      generated.add(id);
    }
    expect(generated.size).toBe(100);
    expect(isValidServerAccountPublicId('ALF-2345-6789')).toBe(false);
    expect(formatAccountPublicId('48291034')).toBe('4829-1034');
  });

  it('creates and verifies HMAC-signed Telegram deep-link login tokens within Telegram 64-char limit', () => {
    const botToken = '9100660571:sample_bot_token';
    for (let i = 0; i < 50; i++) {
      const token = createTelegramLoginToken(botToken);
      expect(`auth_${token}`.length).toBeLessThanOrEqual(64);
      expect(verifyTelegramLoginToken(token, botToken)).toBe(true);
      expect(verifyTelegramLoginToken(`${token}x`, botToken)).toBe(false);
      expect(verifyTelegramLoginToken(token, '9100660571:wrong_token')).toBe(false);
    }
    expect(verifyTelegramLoginToken('invalid', botToken)).toBe(false);
  });

  it('runs end-to-end Telegram Bot Deep-Link start -> webhook approval -> status polling -> replay protection', async () => {
    const botToken = '9100660571:sample_bot_token';
    process.env.TELEGRAM_BOT_TOKEN = botToken;
    process.env.TELEGRAM_BOT_USERNAME = 'alifbo_uz_robot';
    process.env.SESSION_SECRET = 'test_alifbo_session_secret';
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    delete process.env.DATABASE_URL;
    delete process.env.VERCEL;

    const sentTelegramMessages: Array<{ chat_id: number | string; text: string }> = [];
    const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/sendMessage') && typeof init?.body === 'string') {
        sentTelegramMessages.push(
          JSON.parse(init.body) as { chat_id: number | string; text: string },
        );
      }
      return new Response(JSON.stringify({ ok: true, result: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchStub);

    // 1. Start deep-link auth flow
    const startRes = await telegramAuthPost(
      new Request('http://localhost:5173/api/auth/telegram?action=start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ childName: 'Madina', avatarId: 'owl' }),
      }),
    );
    expect(startRes.status).toBe(200);
    const startJson = (await startRes.json()) as {
      ok: boolean;
      token: string;
      deepLink: string;
      botUsername: string;
    };
    expect(startJson.ok).toBe(true);
    expect(startJson.botUsername).toBe('alifbo_uz_robot');
    expect(startJson.deepLink).toBe(
      `https://t.me/alifbo_uz_robot?start=auth_${encodeURIComponent(startJson.token)}`,
    );

    // 2. Status before user taps Start in Telegram -> pending
    const pendingRes = await telegramAuthGet(
      new Request(
        `http://localhost:5173/api/auth/telegram?action=status&token=${encodeURIComponent(startJson.token)}`,
      ),
    );
    expect(pendingRes.status).toBe(200);
    expect(await pendingRes.json()).toEqual({ ok: true, status: 'pending' });

    // 3. Reject webhook call with invalid secret token
    const badWebhookRes = await telegramWebhookPost(
      new Request('http://localhost:5173/api/telegram-webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-telegram-bot-api-secret-token': 'wrong-secret',
        },
        body: JSON.stringify({}),
      }),
    );
    expect(badWebhookRes.status).toBe(403);

    // 4. Valid webhook update `/start auth_<token>` approves session and sends confirmation text
    const webhookSecret = deriveTelegramWebhookSecret(botToken);
    const webhookRes = await telegramWebhookPost(
      new Request('https://alifbo-eight.vercel.app/api/telegram-webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-telegram-bot-api-secret-token': webhookSecret,
        },
        body: JSON.stringify({
          update_id: 1001,
          message: {
            message_id: 12,
            chat: { id: 987654321, type: 'private' },
            from: {
              id: 987654321,
              is_bot: false,
              first_name: 'Aziza',
              username: 'aziza_uz',
            },
            text: `/start auth_${startJson.token}`,
          },
        }),
      }),
    );
    expect(webhookRes.status).toBe(200);
    expect(sentTelegramMessages).toHaveLength(1);
    expect(sentTelegramMessages[0]?.chat_id).toBe(987654321);
    expect(sentTelegramMessages[0]?.text).toBe(
      '✅ Kirish tasdiqlandi! Endi saytga qaytishingiz mumkin.',
    );

    // 5. Polling /api/auth/telegram?action=status returns approved session + Set-Cookie + 8-digit publicId
    const approvedRes = await telegramAuthGet(
      new Request(
        `http://localhost:5173/api/auth/telegram?action=status&token=${encodeURIComponent(startJson.token)}`,
      ),
    );
    expect(approvedRes.status).toBe(200);
    expect(approvedRes.headers.get('set-cookie')).toContain('alifbo_session=');
    const approvedJson = (await approvedRes.json()) as {
      ok: boolean;
      status: string;
      childName: string;
      avatarId: string;
      session: { id: string; publicId: string; contact: string; provider: string };
    };
    expect(approvedJson.ok).toBe(true);
    expect(approvedJson.status).toBe('approved');
    expect(approvedJson.childName).toBe('Madina');
    expect(approvedJson.avatarId).toBe('owl');
    expect(approvedJson.session.provider).toBe('telegram');
    expect(approvedJson.session.contact).toBe('@aziza_uz');
    expect(approvedJson.session.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(approvedJson.session.publicId).toMatch(/^[1-9]\d{7}$/);

    // 6. Replaying the same token after consumption is blocked (`expired`)
    const replayRes = await telegramAuthGet(
      new Request(
        `http://localhost:5173/api/auth/telegram?action=status&token=${encodeURIComponent(startJson.token)}`,
      ),
    );
    expect(replayRes.status).toBe(200);
    expect(await replayRes.json()).toEqual({ ok: true, status: 'expired' });
  });

  it('generates valid 6-digit Telegram OTP codes, deterministic hashes, and valid webhook secrets', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateSixDigitCode();
      expect(code).toMatch(/^\d{6}$/);
      const num = Number(code);
      expect(num).toBeGreaterThanOrEqual(100_000);
      expect(num).toBeLessThanOrEqual(999_999);
    }

    const hashA = hashTelegramAuthCode('123456', '9100:tokenA');
    const hashB = hashTelegramAuthCode('123456', '9100:tokenA');
    const hashDiffCode = hashTelegramAuthCode('654321', '9100:tokenA');
    const hashDiffToken = hashTelegramAuthCode('123456', '9100:tokenB');
    expect(hashA).toBe(hashB);
    expect(hashA).not.toBe(hashDiffCode);
    expect(hashA).not.toBe(hashDiffToken);

    const secret = deriveTelegramWebhookSecret('9100660571:sample_bot_token');
    expect(secret).toMatch(/^[A-Za-z0-9_-]{1,256}$/);

    expect(isPublicHttpsOrigin('https://alifbo-eight.vercel.app')).toBe(true);
    expect(isPublicHttpsOrigin('http://localhost:5173')).toBe(false);
    expect(isPublicHttpsOrigin('https://127.0.0.1:8765')).toBe(false);
  });

  it('routes consolidated telegram, session, and webhook handlers properly', async () => {
    process.env.TELEGRAM_BOT_TOKEN = '9100660571:sample_bot_token';
    process.env.TELEGRAM_BOT_USERNAME = 'alifbo_uz_robot';
    delete process.env.DATABASE_URL;
    delete process.env.VERCEL;

    // Telegram auth consolidated GET/POST validation & GET ?action=start
    const tgGetBad = await telegramAuthGet(
      new Request('http://localhost:5173/api/auth/telegram?action=unknown'),
    );
    expect(tgGetBad.status).toBe(400);

    const tgPostBad = await telegramAuthPost(
      new Request('http://localhost:5173/api/auth/telegram?action=unknown', {
        method: 'POST',
      }),
    );
    expect(tgPostBad.status).toBe(400);

    const tgStartGet = await telegramAuthGet(
      new Request('http://localhost:5173/api/auth/telegram?action=start&childName=Ali&avatarId=fox'),
    );
    expect(tgStartGet.status).toBe(200);
    const tgStartGetJson = (await tgStartGet.json()) as {
      ok: boolean;
      deepLink: string;
      token: string;
    };
    expect(tgStartGetJson.ok).toBe(true);
    expect(tgStartGetJson.deepLink).toContain(`?start=auth_${encodeURIComponent(tgStartGetJson.token)}`);

    // Session consolidated endpoint: providers, me (explicit + default), logout (POST + DELETE), invalid action
    const providersRes = await authSessionGet(
      new Request('http://localhost:5173/api/auth/session?action=providers'),
    );
    expect(providersRes.status).toBe(200);
    const providersJson = (await providersRes.json()) as {
      ok: boolean;
      dbConfigured: boolean;
      telegram: boolean;
      telegramBotUsername: string | null;
    };
    expect(providersJson.ok).toBe(true);
    expect(providersJson.dbConfigured).toBe(false);
    expect(providersJson.telegram).toBe(true);
    expect(providersJson.telegramBotUsername).toBe('alifbo_uz_robot');

    const meDefaultRes = await authSessionGet(
      new Request('http://localhost:5173/api/auth/session'),
    );
    expect(meDefaultRes.status).toBe(200);
    expect(await meDefaultRes.json()).toEqual({
      ok: true,
      authenticated: false,
      dbConfigured: false,
    });

    const meExplicitRes = await authSessionGet(
      new Request('http://localhost:5173/api/auth/session?action=me'),
    );
    expect(meExplicitRes.status).toBe(200);
    expect(await meExplicitRes.json()).toEqual({
      ok: true,
      authenticated: false,
      dbConfigured: false,
    });

    const sessionGetBad = await authSessionGet(
      new Request('http://localhost:5173/api/auth/session?action=invalid'),
    );
    expect(sessionGetBad.status).toBe(400);

    const sessionPostBad = await authSessionPost(
      new Request('http://localhost:5173/api/auth/session?action=invalid', {
        method: 'POST',
      }),
    );
    expect(sessionPostBad.status).toBe(400);

    const logoutPostRes = await authSessionPost(
      new Request('http://localhost:5173/api/auth/session?action=logout', {
        method: 'POST',
      }),
    );
    expect(logoutPostRes.status).toBe(200);
    expect(logoutPostRes.headers.get('set-cookie')).toContain('alifbo_session=;');

    const logoutDeleteRes = await authSessionDelete(
      new Request('http://localhost:5173/api/auth/session', {
        method: 'DELETE',
      }),
    );
    expect(logoutDeleteRes.status).toBe(200);
    expect(logoutDeleteRes.headers.get('set-cookie')).toContain('alifbo_session=;');

    // Telegram webhook GET setup returns 503 when TELEGRAM_BOT_TOKEN is unset
    delete process.env.TELEGRAM_BOT_TOKEN;
    const setupUnconfiguredRes = await telegramWebhookGet(
      new Request('http://localhost:5173/api/telegram-webhook'),
    );
    expect(setupUnconfiguredRes.status).toBe(503);
  });
});
