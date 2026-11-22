import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALIFBE_LETTERS_29 } from '../../data/curriculum';
import {
  authenticateParentAccount,
  buildTelegramAuthDeepLink,
  buildTelegramBotDeepLink,
  formatAccountPublicId,
  generateAccountPublicId,
  generateAccountUuid,
  hasRegisteredParentAccounts,
  isValidAccountPublicId,
  normalizeTelegramAuthCode,
  registerParentAccount,
  sanitizeTelegramBotUsername,
} from '../auth';
import { isSurveyStepComplete, resolveRecommendedWorld } from '../onboarding';
import { sanitizeSpeechTextForTts, speakUzbekText } from '../../utils/audioRecorder';

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

describe('Auth, Onboarding & VoiceLab Lison v2 fixes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('maps slow_spelling and blending reading challenges strictly to World 1', () => {
    expect(resolveRecommendedWorld('slow_spelling')).toBe(1);
    expect(resolveRecommendedWorld('blending')).toBe(1);
    expect(resolveRecommendedWorld('forgets_letters')).toBe(3);
    expect(resolveRecommendedWorld('comprehension')).toBe(4);
  });

  it('enforces required selections on onboarding steps 1-3 and allows empty step 4', () => {
    const emptyDraft = {
      ageGroup: null,
      readingChallenge: null,
      dailyLimitMinutes: null,
      desiredFutureSubjects: [],
    };
    expect(isSurveyStepComplete(1, emptyDraft)).toBe(false);
    expect(isSurveyStepComplete(2, emptyDraft)).toBe(false);
    expect(isSurveyStepComplete(3, emptyDraft)).toBe(false);
    expect(isSurveyStepComplete(4, emptyDraft)).toBe(true);

    expect(
      isSurveyStepComplete(1, { ...emptyDraft, ageGroup: '6-7' }),
    ).toBe(true);
    expect(
      isSurveyStepComplete(2, { ...emptyDraft, readingChallenge: 'slow_spelling' }),
    ).toBe(true);
    expect(
      isSurveyStepComplete(3, { ...emptyDraft, dailyLimitMinutes: 15 }),
    ).toBe(true);
  });

  it('registers and authenticates parent accounts with salted hashes (never storing plain passwords)', () => {
    const mockStorage = createMockLocalStorage();
    vi.stubGlobal('window', { localStorage: mockStorage });

    expect(hasRegisteredParentAccounts()).toBe(false);

    const invalidShortPass = registerParentAccount({
      contact: '+998901234567',
      password: '123',
      childName: 'Zukko',
      avatarId: 'fox',
    });
    expect(invalidShortPass.ok).toBe(false);

    const missingAvatar = registerParentAccount({
      contact: '+998901234567',
      password: 'secret123',
      childName: 'Zukko',
      avatarId: '',
    });
    expect(missingAvatar.ok).toBe(false);

    const created = registerParentAccount({
      contact: '+998 90 123 45 67',
      password: 'parol2026',
      childName: 'Madina',
      avatarId: 'owl',
      nowIso: '2026-11-19T14:00:00.000Z',
    });
    expect(created.ok).toBe(true);
    expect(hasRegisteredParentAccounts()).toBe(true);

    const rawSaved = mockStorage.getItem('alifbo_parent_accounts_v1') ?? '';
    expect(rawSaved).not.toContain('parol2026');
    expect(rawSaved).toContain('Madina');
    expect(rawSaved).toContain('owl');

    const duplicate = registerParentAccount({
      contact: '+998901234567',
      password: 'anotherpassword',
      childName: 'Ali',
      avatarId: 'lion',
    });
    expect(duplicate.ok).toBe(false);

    const wrongPassword = authenticateParentAccount({
      contact: '+998901234567',
      password: 'wrong',
    });
    expect(wrongPassword.ok).toBe(false);

    const validLogin = authenticateParentAccount({
      contact: '+998901234567',
      password: 'parol2026',
      nowIso: '2026-11-19T15:00:00.000Z',
    });
    expect(validLogin.ok).toBe(true);
    if (created.ok) {
      expect(created.session.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(isValidAccountPublicId(created.session.publicId)).toBe(true);
      expect(created.session.publicId).toMatch(/^[1-9]\d{7}$/);

      // publicId must NEVER work as a login credential or password
      const loginWithPublicId = authenticateParentAccount({
        contact: created.session.publicId!,
        password: 'parol2026',
      });
      expect(loginWithPublicId.ok).toBe(false);

      const loginWithPublicIdAsPassword = authenticateParentAccount({
        contact: '+998901234567',
        password: created.session.publicId!,
      });
      expect(loginWithPublicIdAsPassword.ok).toBe(false);
    }
    if (validLogin.ok && created.ok) {
      expect(validLogin.childName).toBe('Madina');
      expect(validLogin.avatarId).toBe('owl');
      expect(validLogin.session.publicId).toBe(created.session.publicId);
    }

    // Legacy stored account without publicId (or old ALF- format) gets backfilled and persisted on open/login
    const storedArr = JSON.parse(mockStorage.getItem('alifbo_parent_accounts_v1') ?? '[]') as Array<
      Record<string, unknown>
    >;
    const legacyArr = storedArr.map(({ publicId: _omit, ...rest }) => rest);
    mockStorage.setItem('alifbo_parent_accounts_v1', JSON.stringify(legacyArr));
    const backfilledLogin = authenticateParentAccount({
      contact: '+998901234567',
      password: 'parol2026',
      nowIso: '2026-11-19T16:00:00.000Z',
    });
    expect(backfilledLogin.ok).toBe(true);
    if (backfilledLogin.ok) {
      expect(isValidAccountPublicId(backfilledLogin.session.publicId)).toBe(true);
      const persistedAfter = JSON.parse(
        mockStorage.getItem('alifbo_parent_accounts_v1') ?? '[]',
      ) as Array<{ publicId?: string }>;
      expect(persistedAfter[0]?.publicId).toBe(backfilledLogin.session.publicId);
    }

    // Old ALF-... publicId also migrates automatically on first load (hasRegisteredParentAccounts)
    const oldFormatArr = storedArr.map((rec) => ({ ...rec, publicId: 'ALF-2345-6789' }));
    mockStorage.setItem('alifbo_parent_accounts_v1', JSON.stringify(oldFormatArr));
    expect(hasRegisteredParentAccounts()).toBe(true);
    const migratedFromOld = JSON.parse(
      mockStorage.getItem('alifbo_parent_accounts_v1') ?? '[]',
    ) as Array<{ publicId?: string }>;
    expect(isValidAccountPublicId(migratedFromOld[0]?.publicId)).toBe(true);
  });

  it('gives every entry in ALIFBE_LETTERS_29 a unique exampleEmoji (no duplicate cloud on H and P)', () => {
    expect(ALIFBE_LETTERS_29).toHaveLength(30);
    const emojis = ALIFBE_LETTERS_29.map((entry) => entry.exampleEmoji);
    expect(new Set(emojis).size).toBe(30);

    const hEntry = ALIFBE_LETTERS_29.find((entry) => entry.letter === 'H');
    const pEntry = ALIFBE_LETTERS_29.find((entry) => entry.letter === 'P');
    expect(hEntry?.exampleEmoji).not.toBe(pEntry?.exampleEmoji);
  });

  it('strips emojis and sends speech exclusively to /api/tts without touching speechSynthesis', async () => {
    expect(sanitizeSpeechTextForTts('Salom, Bolajon! 🦊✨ «1-olam»')).toBe(
      'Salom, Bolajon! «1-olam»',
    );

    const fetchMock = vi.fn(async () => ({
      ok: true,
      headers: {
        get: (name: string) => (name.toLowerCase() === 'content-type' ? 'audio/wav' : null),
      },
      blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const speechPropAccessed = vi.fn();
    const fakeWindow: Record<string, unknown> = {};
    Object.defineProperty(fakeWindow, 'speechSynthesis', {
      get() {
        speechPropAccessed();
        return undefined;
      },
    });
    vi.stubGlobal('window', fakeWindow);

    await speakUzbekText('Salom, Bolajon! 🦊');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/tts',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ text: 'Salom, Bolajon!' }),
      }),
    );
    expect(speechPropAccessed).not.toHaveBeenCalled();
  });

  it('sanitizes Telegram bot username, builds auth deep link, normalizes OTP, and generates 8-digit numeric public IDs + UUIDs', () => {
    expect(sanitizeTelegramBotUsername('  @alifbo_uz_robot ')).toBe('alifbo_uz_robot');
    expect(sanitizeTelegramBotUsername('alifbo_uz_robot')).toBe('alifbo_uz_robot');
    expect(sanitizeTelegramBotUsername(null)).toBe('');

    expect(buildTelegramBotDeepLink('@alifbo_uz_robot', 'signup')).toBe(
      'https://t.me/alifbo_uz_robot?start=signup',
    );
    expect(buildTelegramBotDeepLink('alifbo_uz_robot')).toBe(
      'https://t.me/alifbo_uz_robot?start=login',
    );
    expect(buildTelegramAuthDeepLink('@alifbo_uz_robot', 'tok_123')).toBe(
      'https://t.me/alifbo_uz_robot?start=auth_tok_123',
    );

    expect(normalizeTelegramAuthCode(' 12-34 5678 ')).toBe('123456');
    expect(normalizeTelegramAuthCode('abc98')).toBe('98');

    const uuid = generateAccountUuid();
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const id = generateAccountPublicId();
      expect(isValidAccountPublicId(id)).toBe(true);
      expect(id).toMatch(/^[1-9]\d{7}$/);
      expect(formatAccountPublicId(id)).toMatch(/^[1-9]\d{3}-\d{4}$/);
      ids.add(id);
    }
    expect(ids.size).toBe(100);
    expect(formatAccountPublicId('48291034')).toBe('4829-1034');
    expect(isValidAccountPublicId('48291034')).toBe(true);
    expect(isValidAccountPublicId('ALF-2345-6789')).toBe(false);
    expect(isValidAccountPublicId('1234567')).toBe(false);
    expect(isValidAccountPublicId('1234abcd')).toBe(false);
    expect(isValidAccountPublicId(null)).toBe(false);
  });
});
