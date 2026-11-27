import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET as telegramAuthGet, POST as telegramAuthPost } from '../../../api/auth/telegram';
import {
  buildDailyReminderKeyboard,
  buildDailyReminderMessageText,
} from '../../../api/notifications';
import {
  createTelegramLoginToken,
  hashTelegramLoginToken,
  verifyTelegramWebAppInitData,
} from '../../../api/_lib/telegramBot';
import { resetMemoryRateLimits } from '../../../api/_lib/rateLimit';
import {
  COMING_SOON_SYLLABLE_FOREST,
  DYNAMIC_WORD_POOL,
  READING_WORLDS,
} from '../../data/curriculum';
import { resolveVisualSrc } from '../../data/wordVisuals';
import {
  getTelegramWebAppInitData,
  isTelegramWebAppContext,
  openExternalPwaBridge,
  openTelegramDeepLink,
} from '../../utils/telegramWebApp';
import { registerGuestAppVisit } from '../auth';
import { buildSyllableAcceptAliases } from '../bubbleGate';
import { AVATAR_OPTIONS, createRandomChildProfile } from '../gamification';
import { validateSttReading } from '../sttValidator';

const ROOT = path.resolve(__dirname, '..', '..', '..');

function createMockStorage(): Storage {
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

function buildSignedTelegramInitData(params: {
  botToken: string;
  authDateSec: number;
  user: Record<string, unknown>;
  queryId?: string;
}): string {
  const entries: Array<[string, string]> = [
    ['auth_date', String(params.authDateSec)],
    ['query_id', params.queryId ?? 'AAHdF6IQAAAAAN0XohDhrOrc'],
    ['user', JSON.stringify(params.user)],
  ];
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(params.botToken).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const sp = new URLSearchParams(entries);
  sp.set('hash', hash);
  return sp.toString();
}

describe('Alifbo 2.3.2 — Curriculum, Visuals, Auth Simplification, Guest Reminders & Hybrid Telegram WebApp', () => {
  const originalEnv = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    DATABASE_URL: process.env.DATABASE_URL,
    SESSION_SECRET: process.env.SESSION_SECRET,
    KV_REST_API_URL: process.env.KV_REST_API_URL,
    KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN,
  };

  afterEach(() => {
    resetMemoryRateLimits();
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

  it('removes tola from curriculum, moves kran to World 2, and accepts soft-R kran & K-RAN bubbles', () => {
    expect(DYNAMIC_WORD_POOL.find((w) => w.id === 'tola')).toBeUndefined();

    const kran = DYNAMIC_WORD_POOL.find((w) => w.id === 'kran');
    expect(kran).toBeDefined();
    expect(kran?.worldId).toBe(2);
    expect(kran?.syllables).toEqual(['KRAN']);
    expect(kran?.parts).toEqual(['K', 'RAN']);

    // Soft-R variants and spaced "ka ran" pass without forcing a hard rolled "r" (<= 12 aliases for /api/stt)
    expect(kran?.accept.length).toBeLessThanOrEqual(12);
    for (const spoken of [
      'kran',
      'kiran',
      'keran',
      'karan',
      'kuran',
      'qran',
      'gran',
      'kron',
      'kren',
      'klan',
      'kan',
      'ka ran',
    ]) {
      const res = validateSttReading({
        targetWord: kran!.text,
        parts: kran!.parts,
        syllableCount: kran!.syllables.length,
        acceptAliases: kran!.accept,
        transcript: spoken,
        isSilence: false,
      });
      expect(res.decision, `Expected "${spoken}" to pass for KRAN`).toBe('accepted');
    }

    // Bubble mode chunks for KRAN: 'K' -> 'ka'/'ke'/'ku'/'k', 'RAN' -> 'ran'/'ron'/'ren'/'lan'/'iran'
    const kAliases = buildSyllableAcceptAliases('K');
    expect(kAliases).toContain('ka');
    expect(kAliases).toContain('ke');
    expect(kAliases).toContain('ku');
    expect(
      validateSttReading({
        targetWord: 'K',
        parts: ['K'],
        syllableCount: 1,
        acceptAliases: kAliases,
        transcript: 'ka',
        isSilence: false,
      }).decision,
    ).toBe('accepted');

    const ranAliases = buildSyllableAcceptAliases('RAN');
    expect(ranAliases).toContain('ron');
    expect(ranAliases).toContain('ren');
    expect(ranAliases).toContain('lan');
    expect(ranAliases).toContain('iran');
    for (const softRan of ['ron', 'ren', 'lan', 'aran']) {
      expect(
        validateSttReading({
          targetWord: 'RAN',
          parts: ['RAN'],
          syllableCount: 1,
          acceptAliases: ranAliases,
          transcript: softRan,
          isSilence: false,
        }).decision,
        `Expected "${softRan}" to pass for RAN bubble`,
      ).toBe('accepted');
    }
  });

  it('provides a dedicated recognizable SVG for dada and keeps 1-olam title while adding Bo‘g‘inlashni o‘rgatish forest', () => {
    const dada = DYNAMIC_WORD_POOL.find((w) => w.id === 'dada')!;
    const dadaSrc = resolveVisualSrc({ emoji: dada.emoji, wordId: dada.id });
    expect(dadaSrc).toBe('/images/words/dada.svg');
    const svgPath = path.join(ROOT, 'public', dadaSrc.replace(/^\//, ''));
    expect(fs.existsSync(svgPath)).toBe(true);
    const svgBody = fs.readFileSync(svgPath, 'utf8');
    expect(svgBody).toContain('<svg');
    expect(svgBody).toContain('viewBox="0 0 128 128"');

    // Answer 4: 1-olam title remains unchanged, and Bo'g'inlashni o'rgatish is a separate coming-soon forest
    expect(READING_WORLDS[0]?.titleUz).toBe('1-olam: Ilk bo‘g‘inlar o‘rmoni');
    expect(COMING_SOON_SYLLABLE_FOREST.titleUz).toBe('Bo‘g‘inlashni o‘rgatish');
    expect(COMING_SOON_SYLLABLE_FOREST.badgeUz).toBe('Tez kunda');

    const childHomeSrc = fs.readFileSync(path.join(ROOT, 'src/components/ChildHome.tsx'), 'utf8');
    expect(childHomeSrc).toContain('COMING_SOON_SYLLABLE_FOREST');
    expect(childHomeSrc).toContain('worldId="syllable_forest"');
  });

  it('simplifies AuthScreen to Telegram & Google only, forces Zukko Tulki mascot, and supports random child name/picture', () => {
    const authSrc = fs.readFileSync(path.join(ROOT, 'src/components/AuthScreen.tsx'), 'utf8');
    expect(authSrc).not.toContain('type="password"');
    expect(authSrc).not.toContain('Bola profili');
    expect(authSrc).not.toContain('registerParentAccount');
    expect(authSrc).not.toContain('authenticateWithTelegramCode');
    expect(authSrc).toContain('auth-social-btn-telegram');
    expect(authSrc).toContain('auth-social-btn-google');

    const appSrc = fs.readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf8');
    expect(appSrc).toContain('avatarId="fox"');

    const validIds = new Set(AVATAR_OPTIONS.map((a) => a.id));
    for (let i = 0; i < 20; i++) {
      const current = { name: 'Zukko', avatarId: 'fox' };
      const next = createRandomChildProfile(Math.random, current);
      expect(next.name.length).toBeGreaterThan(0);
      expect(validIds.has(next.avatarId)).toBe(true);
      expect(next.name).not.toBe(current.name);
      expect(next.avatarId).not.toBe(current.avatarId);
    }
  });

  it('tracks Guest Trial visits across sessions, prompts on 2nd+ return visit, and reminds on every completed round', () => {
    const ls = createMockStorage();
    const ss1 = createMockStorage();

    // Visit 1: enter Guest Trial -> count = 1, no prompt yet
    const v1 = registerGuestAppVisit({
      isGuest: true,
      hasCompletedOnboarding: true,
      localStore: ls,
      sessionStore: ss1,
    });
    expect(v1).toEqual({
      visitCount: 1,
      isNewBrowserSession: true,
      shouldPromptReturnSignup: false,
    });

    // Reload within the same browser session -> count remains 1, idempotent
    const v1Reload = registerGuestAppVisit({
      isGuest: true,
      hasCompletedOnboarding: true,
      localStore: ls,
      sessionStore: ss1,
    });
    expect(v1Reload).toEqual({
      visitCount: 1,
      isNewBrowserSession: false,
      shouldPromptReturnSignup: false,
    });

    // Visit 2 (new browser/app launch with empty sessionStorage) -> prompts separately!
    const ss2 = createMockStorage();
    const v2 = registerGuestAppVisit({
      isGuest: true,
      hasCompletedOnboarding: true,
      localStore: ls,
      sessionStore: ss2,
    });
    expect(v2).toEqual({
      visitCount: 2,
      isNewBrowserSession: true,
      shouldPromptReturnSignup: true,
    });

    // After permanent sign-in -> counters clear
    const signedIn = registerGuestAppVisit({
      isGuest: false,
      hasCompletedOnboarding: true,
      localStore: ls,
      sessionStore: ss2,
    });
    expect(signedIn).toEqual({
      visitCount: 0,
      isNewBrowserSession: false,
      shouldPromptReturnSignup: false,
    });

    const lessonPlayerSrc = fs.readFileSync(path.join(ROOT, 'src/components/LessonPlayer.tsx'), 'utf8');
    expect(lessonPlayerSrc).toContain('victory-guest-reminder');
    expect(lessonPlayerSrc).toContain('isGuest && onOpenGuestUpgrade');

    const bannerSrc = fs.readFileSync(path.join(ROOT, 'src/components/GuestSaveBanner.tsx'), 'utf8');
    expect(bannerSrc).toContain('Bu raund:');
    expect(bannerSrc).toContain('hasRoundSummary');
  });

  it('formats daily Telegram reminder with exact Uzbek copy and web_app CTA (without rem_off button)', () => {
    const msg = buildDailyReminderMessageText();
    expect(msg).toBe(
      '🦊 Assalomu alaykum! Bugun farzandingiz bilan 10 daqiqa o‘qish mashqini bajaramizmi?\n\n' +
        'Zukko tulki yangi harf va so‘zlar bilan kutmoqda!',
    );

    const httpsKeyboard = buildDailyReminderKeyboard('https://alifbo-eight.vercel.app/');
    expect(httpsKeyboard).toEqual([
      [
        {
          text: '🦊 Mashqni boshlash',
          web_app: { url: 'https://alifbo-eight.vercel.app/?source=tg_reminder' },
        },
      ],
    ]);
    expect(JSON.stringify(httpsKeyboard)).not.toContain('rem_off');
    expect(JSON.stringify(httpsKeyboard)).not.toContain('Eslatmani o‘chirish');

    // Localhost HTTP does not emit invalid Telegram web_app URL
    expect(buildDailyReminderKeyboard('http://localhost:5173')).toEqual([]);
  });

  it('verifies Telegram.WebApp.initData HMAC-SHA256 cryptographically and handles POST /api/auth/telegram?action=webapp', async () => {
    const botToken = '9100660571:sample_bot_token_for_webapp';
    const nowSec = 1_764_200_000;
    const validInitData = buildSignedTelegramInitData({
      botToken,
      authDateSec: nowSec - 60,
      user: {
        id: 123456789,
        first_name: 'Dilnoza',
        last_name: 'Karimova',
        username: 'dilnoza_uz',
      },
    });

    const ok = verifyTelegramWebAppInitData(validInitData, botToken, nowSec);
    expect(ok).toEqual({
      ok: true,
      authDateSec: nowSec - 60,
      user: {
        id: '123456789',
        firstName: 'Dilnoza',
        lastName: 'Karimova',
        username: 'dilnoza_uz',
      },
    });

    // Wrong token, tampered payload, expired (>24h), and bot users must be rejected
    expect(verifyTelegramWebAppInitData(validInitData, '9100:wrong', nowSec)).toEqual({
      ok: false,
      reason: 'invalid_hash',
    });
    expect(
      verifyTelegramWebAppInitData(validInitData.replace('Dilnoza', 'Hacker'), botToken, nowSec),
    ).toEqual({
      ok: false,
      reason: 'invalid_hash',
    });
    expect(verifyTelegramWebAppInitData(validInitData, botToken, nowSec + 90_000)).toEqual({
      ok: false,
      reason: 'expired',
    });

    const botInitData = buildSignedTelegramInitData({
      botToken,
      authDateSec: nowSec - 10,
      user: { id: 777, is_bot: true, first_name: 'Bot' },
    });
    expect(verifyTelegramWebAppInitData(botInitData, botToken, nowSec)).toEqual({
      ok: false,
      reason: 'invalid_user',
    });

    // Endpoint integration test (consolidated into /api/auth/telegram?action=webapp)
    process.env.TELEGRAM_BOT_TOKEN = botToken;
    process.env.SESSION_SECRET = 'test_session_secret_232';
    delete process.env.DATABASE_URL;

    const freshInitData = buildSignedTelegramInitData({
      botToken,
      authDateSec: Math.floor(Date.now() / 1000) - 30,
      user: {
        id: 555666777,
        first_name: 'Sardor',
        username: 'sardor_uz',
      },
    });

    // Cross-origin blocked
    const evilOriginRes = await telegramAuthPost(
      new Request('https://alifbo-eight.vercel.app/api/auth/telegram?action=webapp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://evil.example',
        },
        body: JSON.stringify({ initData: freshInitData }),
      }),
    );
    expect(evilOriginRes.status).toBe(403);

    // Invalid initData returns 401
    const badInitRes = await telegramAuthPost(
      new Request('https://alifbo-eight.vercel.app/api/auth/telegram?action=webapp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://alifbo-eight.vercel.app',
        },
        body: JSON.stringify({ initData: 'hash=deadbeef' }),
      }),
    );
    expect(badInitRes.status).toBe(401);

    // Valid initData returns 200 + Set-Cookie session + Telegram user session
    const validRes = await telegramAuthPost(
      new Request('https://alifbo-eight.vercel.app/api/auth/telegram?action=webapp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://alifbo-eight.vercel.app',
        },
        body: JSON.stringify({ initData: freshInitData }),
      }),
    );
    expect(validRes.status).toBe(200);
    expect(validRes.headers.get('set-cookie')).toContain('alifbo_session=');
    const json = (await validRes.json()) as {
      ok: boolean;
      session: { provider: string; contact: string; publicId: string };
      childName: string;
      avatarId: string;
    };
    expect(json.ok).toBe(true);
    expect(json.session.provider).toBe('telegram');
    expect(json.session.contact).toBe('@sardor_uz');
    expect(json.session.publicId).toMatch(/^[1-9]\d{7}$/);
    expect(json.childName.length).toBeGreaterThan(0);
    expect(json.avatarId.length).toBeGreaterThan(0);

    // Stateless deep-link polling status also assigns valid random child profile defaults
    process.env.KV_REST_API_URL = 'https://kv.example.upstash.io';
    process.env.KV_REST_API_TOKEN = 'kv-secret';
    const loginToken = createTelegramLoginToken(botToken);
    const tokenHash = hashTelegramLoginToken(loginToken, botToken);
    const approvedSessionJson = JSON.stringify({
      status: 'approved',
      childName: null,
      avatarId: null,
      telegramId: '987654321',
      telegramUsername: 'parent_test',
      firstName: 'Aziz',
      lastName: '',
      expiresAtMs: Date.now() + 60_000,
      consumedAtMs: null,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const cmd = JSON.parse(String(init?.body ?? '[]')) as string[];
        if (cmd[0] === 'GET' && cmd[1] === `tg_login:${tokenHash}`) {
          return new Response(JSON.stringify({ result: approvedSessionJson }), { status: 200 });
        }
        return new Response(JSON.stringify({ result: 'OK' }), { status: 200 });
      }),
    );

    const statusRes = await telegramAuthGet(
      new Request(`https://alifbo-eight.vercel.app/api/auth/telegram?action=status&token=${loginToken}`),
    );
    expect(statusRes.status).toBe(200);
    const statusJson = (await statusRes.json()) as {
      ok: boolean;
      status: string;
      childName: string;
      avatarId: string;
    };
    expect(statusJson.ok).toBe(true);
    expect(statusJson.status).toBe('approved');
    expect(AVATAR_OPTIONS.some((a) => a.id === statusJson.avatarId)).toBe(true);
    expect(statusJson.childName.length).toBeGreaterThan(0);
  });

  it('detects Telegram WebApp context safely and bridges to external PWA/browser via Telegram.WebApp.openLink', () => {
    const ss = createMockStorage();
    const openLinkSpy = vi.fn();
    const openTelegramLinkSpy = vi.fn();
    vi.stubGlobal('window', {
      location: {
        origin: 'https://alifbo-eight.vercel.app',
        hash: '#tgWebAppData=auth_date%3D123%26hash%3Dabc',
      },
      sessionStorage: ss,
      Telegram: {
        WebApp: {
          initData: '',
          platform: 'android',
          openLink: openLinkSpy,
          openTelegramLink: openTelegramLinkSpy,
        },
      },
      open: vi.fn(),
    });

    expect(getTelegramWebAppInitData()).toBe('auth_date=123&hash=abc');
    expect(isTelegramWebAppContext()).toBe(true);

    openExternalPwaBridge();
    expect(openLinkSpy).toHaveBeenCalledWith('https://alifbo-eight.vercel.app');

    openTelegramDeepLink('https://t.me/alifbo_uz_robot?start=auth_test123');
    expect(openTelegramLinkSpy).toHaveBeenCalledWith(
      'https://t.me/alifbo_uz_robot?start=auth_test123',
    );

    const authSrc = fs.readFileSync(path.join(ROOT, 'src/components/AuthScreen.tsx'), 'utf8');
    expect(authSrc).toContain('openTelegramDeepLink(res.deepLink)');
    expect(authSrc).toContain('webAppErrUz = res.errorUz');

    // Regular browser (empty initData, unknown platform, empty sessionStorage) -> false
    const cleanSs = createMockStorage();
    vi.stubGlobal('window', {
      location: { origin: 'https://alifbo-eight.vercel.app', hash: '' },
      sessionStorage: cleanSs,
      Telegram: { WebApp: { initData: '', platform: 'unknown' } },
      open: vi.fn(),
    });
    expect(getTelegramWebAppInitData()).toBe('');
    expect(isTelegramWebAppContext()).toBe(false);
  });
});
