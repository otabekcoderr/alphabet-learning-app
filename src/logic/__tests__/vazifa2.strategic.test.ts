import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ALHAMDULILLAH_AUDIO_PATH,
  ALHAMDULILLAH_TEXT_UZ,
  BISMILLAH_AUDIO_PATH,
  BISMILLAH_TEXT_UZ,
  isVoicePlaybackRecordingSupported,
} from '../../components/BismillahAlhamdulillah';
import {
  enforceBismillahPronunciationText,
  findStaticAudioUrlForText,
  HABIT_AUDIO_FALLBACK_TEXT,
  playAudioClipWithStatus,
  sanitizeSpeechTextForTts,
  startGestureAudioClip,
  STATIC_AUDIO_VERSION,
  stopActiveAudio,
} from '../../utils/audioRecorder';
import {
  FEEDBACK_DISAPPOINTMENT_OPTIONS,
  FEEDBACK_MIN_SESSIONS_FOR_RESULT,
  shouldAutoOpenFirstSessionFeedback,
  shouldShowResultFeedbackButton,
} from '../../components/FeedbackModal';
import {
  buildSurveyDataFromStrategic,
  getOnboardingOptionLabels,
  isStrategicStepComplete,
  loadStrategicOnboardingAnswers,
  ONBOARDING_ATTEMPT_OPTIONS,
  ONBOARDING_DIFFICULTY_OPTIONS,
  ONBOARDING_STAGE_OPTIONS,
  resolveRecommendedWorldFromStage,
  saveStrategicOnboardingAnswers,
  STRATEGIC_ONBOARDING_STORAGE_KEY,
} from '../onboarding';
import {
  flushPendingTelegramMessages,
  formatFeedbackTelegramMessage,
  formatOnboardingTelegramMessage,
  getPendingTelegramMessages,
  sendTelegramMessage,
  TG_PENDING_QUEUE_KEY,
} from '../../services/telegramService';
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

describe('Vazifa 2 — Telegram Service, Strategic Onboarding, Feedback & Bismillah/Alhamdulillah', () => {
  afterEach(() => {
    stopActiveAudio();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('queues Telegram messages in localStorage when server endpoint is unconfigured (503), network fails, or HTTP fails, and flushes later', async () => {
    const mockStorage = createMockLocalStorage();
    vi.stubGlobal('window', { localStorage: mockStorage });

    // 1. Server returns 503 (TELEGRAM_ADMIN_CHAT_ID or TELEGRAM_BOT_TOKEN not configured)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 503,
      })),
    );
    const missingEnvRes = await sendTelegramMessage('Test xabar 1', {
      category: 'onboarding',
    });
    expect(missingEnvRes).toEqual({
      ok: false,
      queuedLocally: true,
      reason: 'missing_env',
      statusCode: 503,
    });

    // 2. Network failure / blocked request
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('Network blocked');
      }),
    );
    const networkRes = await sendTelegramMessage('Test xabar 2', {
      category: 'feedback',
    });
    expect(networkRes).toEqual({
      ok: false,
      queuedLocally: true,
      reason: 'network_error',
    });

    // 3. HTTP 500 error
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
      })),
    );
    const httpRes = await sendTelegramMessage('Test xabar 3', {
      category: 'feedback',
    });
    expect(httpRes).toEqual({
      ok: false,
      queuedLocally: true,
      reason: 'http_error',
      statusCode: 500,
    });

    const queued = getPendingTelegramMessages();
    expect(queued).toHaveLength(3);
    expect(queued.map((item) => item.text)).toEqual([
      'Test xabar 1',
      'Test xabar 2',
      'Test xabar 3',
    ]);
    expect(mockStorage.getItem(TG_PENDING_QUEUE_KEY)).toBeTruthy();

    // 4. Successful server proxy call & flush of pending queue
    const fetchOkMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    }));
    vi.stubGlobal('fetch', fetchOkMock);

    const okRes = await sendTelegramMessage('Salom Telegram!', {
      category: 'onboarding',
    });
    expect(okRes).toEqual({ ok: true, queuedLocally: false });
    expect(fetchOkMock).toHaveBeenCalledWith(
      '/api/notifications/admin-alert',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          category: 'onboarding',
          text: 'Salom Telegram!',
        }),
      }),
    );

    const flushed = await flushPendingTelegramMessages();
    expect(flushed).toBe(3);
    expect(getPendingTelegramMessages()).toHaveLength(0);
  });

  it('formats onboarding and feedback Telegram messages in clean Uzbek and marks Guest mode without fake ID', () => {
    const onboardingMsg = formatOnboardingTelegramMessage({
      childStageLabel: 'Harflarni biladi, lekin so‘z o‘qiy olmaydi',
      previousAttemptsLabel: 'O‘zim kitob/alifbedan o‘rgatishga urindim',
      biggestDifficultyLabel: 'Harflarni bir-biriga qo‘shib o‘qiy olmayapti',
      contact: '@ota_ona',
      childName: 'Zukko',
      publicId: '48291034',
      completedAt: '2026-11-23T12:00:00.000Z',
    });
    expect(onboardingMsg).toContain('Onboarding');
    expect(onboardingMsg).toContain('Zukko');
    expect(onboardingMsg).toContain('48291034');
    expect(onboardingMsg).toContain('@ota_ona');

    const guestOnboarding = formatOnboardingTelegramMessage({
      childStageLabel: 'Harflarni biladi, lekin so‘z o‘qiy olmaydi',
      previousAttemptsLabel: 'O‘zim kitob/alifbedan o‘rgatishga urindim',
      biggestDifficultyLabel: 'Harflarni bir-biriga qo‘shib o‘qiy olmayapti',
      childName: 'Zukko',
      publicId: '99999999',
      isGuest: true,
    });
    expect(guestOnboarding).toContain('Holat: Sinov rejimi (Guest)');
    expect(guestOnboarding).not.toContain('99999999');

    const feedbackMsg = formatFeedbackTelegramMessage({
      disappointmentLabel: 'Juda xafa bo‘laman',
      stuckPoint: 'Bo‘g‘in poyezdi zo‘r ekan',
      recommendationNote: 'Ha, albatta tavsiya qilaman',
      sessionsCompleted: 2,
      childName: 'Madina',
      publicId: '12345678',
      submittedAt: '2026-11-23T12:10:00.000Z',
    });
    expect(feedbackMsg).toContain('Feedback');
    expect(feedbackMsg).toContain('Juda xafa bo‘laman');
    expect(feedbackMsg).toContain('Tugatilgan mashq sessiyalari: 2');
  });

  it('validates 4-step strategic onboarding options, step completion, world mapping & localStorage persistence', () => {
    const mockStorage = createMockLocalStorage();
    vi.stubGlobal('window', { localStorage: mockStorage });

    expect(ONBOARDING_STAGE_OPTIONS).toHaveLength(3);
    expect(ONBOARDING_ATTEMPT_OPTIONS).toHaveLength(4);
    expect(ONBOARDING_DIFFICULTY_OPTIONS).toHaveLength(4);

    expect(resolveRecommendedWorldFromStage('no_letters_yet')).toBe(1);
    expect(resolveRecommendedWorldFromStage('knows_letters_not_words')).toBe(1);
    expect(resolveRecommendedWorldFromStage('reads_syllables_wants_speed')).toBe(2);

    const draft = {
      childStage: null,
      previousAttempt: null,
      biggestDifficulty: null,
      contact: '',
    };
    expect(isStrategicStepComplete(1, draft)).toBe(false);
    expect(isStrategicStepComplete(2, draft)).toBe(false);
    expect(isStrategicStepComplete(3, draft)).toBe(false);
    expect(isStrategicStepComplete(4, draft)).toBe(true);

    const answers = {
      completedAt: '2026-11-23T12:00:00.000Z',
      childStage: 'knows_letters_not_words' as const,
      previousAttempt: 'youtube_or_apps' as const,
      biggestDifficulty: 'cannot_blend_letters' as const,
      contact: '+998901234567',
    };
    saveStrategicOnboardingAnswers(answers);
    expect(mockStorage.getItem(STRATEGIC_ONBOARDING_STORAGE_KEY)).toBeTruthy();
    expect(loadStrategicOnboardingAnswers()).toEqual(answers);

    const labels = getOnboardingOptionLabels(answers);
    expect(labels.childStageLabel).toBe('Harflarni biladi, lekin so‘z o‘qiy olmaydi');
    expect(labels.previousAttemptsLabel).toBe('YouTube / boshqa ilovalarni sinadik');
    expect(labels.biggestDifficultyLabel).toBe('Harflarni bir-biriga qo‘shib o‘qiy olmayapti');

    const surveyData = buildSurveyDataFromStrategic(answers);
    expect(surveyData.childStage).toBe('knows_letters_not_words');
    expect(surveyData.readingChallenge).toBe('blending');
    expect(surveyData.contact).toBe('+998901234567');
  });

  it('shows result-screen Feedback button from 1st session and triggers 2nd survey auto-prompt once after 1st completed session', () => {
    expect(FEEDBACK_MIN_SESSIONS_FOR_RESULT).toBe(1);
    expect(shouldShowResultFeedbackButton(0)).toBe(false);
    expect(shouldShowResultFeedbackButton(1)).toBe(true);
    expect(shouldShowResultFeedbackButton(2)).toBe(true);
    expect(shouldShowResultFeedbackButton(5)).toBe(true);

    // Mid-game (not roundFinished): never auto-open
    expect(
      shouldAutoOpenFirstSessionFeedback({
        completedSessionsCount: 1,
        firstSessionFeedbackPrompted: false,
        roundFinished: false,
        bismillahAlhamdulillahEnabled: true,
        alhamdulillahDone: true,
        roundPraiseDone: true,
      }),
    ).toBe(false);

    // With Bismillah/Alhamdulillah enabled: wait until alhamdulillahDone === true
    expect(
      shouldAutoOpenFirstSessionFeedback({
        completedSessionsCount: 1,
        firstSessionFeedbackPrompted: false,
        roundFinished: true,
        bismillahAlhamdulillahEnabled: true,
        alhamdulillahDone: false,
        roundPraiseDone: true,
      }),
    ).toBe(false);
    expect(
      shouldAutoOpenFirstSessionFeedback({
        completedSessionsCount: 1,
        firstSessionFeedbackPrompted: false,
        roundFinished: true,
        bismillahAlhamdulillahEnabled: true,
        alhamdulillahDone: true,
        roundPraiseDone: true,
      }),
    ).toBe(true);

    // With Bismillah/Alhamdulillah disabled: wait until roundPraiseDone === true
    expect(
      shouldAutoOpenFirstSessionFeedback({
        completedSessionsCount: 1,
        firstSessionFeedbackPrompted: false,
        roundFinished: true,
        bismillahAlhamdulillahEnabled: false,
        alhamdulillahDone: false,
        roundPraiseDone: false,
      }),
    ).toBe(false);
    expect(
      shouldAutoOpenFirstSessionFeedback({
        completedSessionsCount: 1,
        firstSessionFeedbackPrompted: false,
        roundFinished: true,
        bismillahAlhamdulillahEnabled: false,
        alhamdulillahDone: false,
        roundPraiseDone: true,
      }),
    ).toBe(true);

    // Already prompted or 2nd+ session: never auto-open again
    expect(
      shouldAutoOpenFirstSessionFeedback({
        completedSessionsCount: 1,
        firstSessionFeedbackPrompted: true,
        roundFinished: true,
        bismillahAlhamdulillahEnabled: false,
        alhamdulillahDone: false,
        roundPraiseDone: true,
      }),
    ).toBe(false);
    expect(
      shouldAutoOpenFirstSessionFeedback({
        completedSessionsCount: 2,
        firstSessionFeedbackPrompted: false,
        roundFinished: true,
        bismillahAlhamdulillahEnabled: false,
        alhamdulillahDone: false,
        roundPraiseDone: true,
      }),
    ).toBe(false);

    expect(FEEDBACK_DISAPPOINTMENT_OPTIONS.map((o) => o.label)).toEqual([
      'Juda xafa bo‘laman',
      'Biroz',
      'Farqi yo‘q',
    ]);
  });

  it('persists completedSessionsCount, bismillahAlhamdulillahEnabled, firstSessionFeedbackPrompted & strategic SurveyData in progressStorage and safely handles missing MediaRecorder', () => {
    const mockStorage = createMockLocalStorage();
    vi.stubGlobal('window', { localStorage: mockStorage });

    const initial = createInitialState();
    expect(initial.completedSessionsCount).toBe(0);
    expect(initial.bismillahAlhamdulillahEnabled).toBe(true);
    expect(initial.firstSessionFeedbackPrompted).toBe(false);

    const updated = {
      ...initial,
      completedSessionsCount: 3,
      bismillahAlhamdulillahEnabled: false,
      firstSessionFeedbackPrompted: true,
      surveyData: buildSurveyDataFromStrategic({
        completedAt: '2026-11-23T12:00:00.000Z',
        childStage: 'no_letters_yet',
        previousAttempt: 'not_started_seriously',
        biggestDifficulty: 'no_parent_time',
        contact: '',
      }),
    };
    saveAlifboState(updated);
    const loaded = loadAlifboState();
    expect(loaded.recoveredCorruptData).toBe(false);
    expect(loaded.state.completedSessionsCount).toBe(3);
    expect(loaded.state.bismillahAlhamdulillahEnabled).toBe(false);
    expect(loaded.state.firstSessionFeedbackPrompted).toBe(true);
    expect(loaded.state.surveyData?.childStage).toBe('no_letters_yet');
    expect(loaded.state.surveyData?.previousAttempt).toBe('not_started_seriously');
    expect(loaded.state.surveyData?.biggestDifficulty).toBe('no_parent_time');

    // Older v3 saved JSON omitting bismillahAlhamdulillahEnabled / firstSessionFeedbackPrompted migrates cleanly
    const legacyV3 = JSON.parse(mockStorage.getItem('alifbo_app_state_v3') ?? '{}') as Record<
      string,
      unknown
    >;
    delete legacyV3.bismillahAlhamdulillahEnabled;
    delete legacyV3.firstSessionFeedbackPrompted;
    mockStorage.setItem('alifbo_app_state_v3', JSON.stringify(legacyV3));
    const migratedLoaded = loadAlifboState();
    expect(migratedLoaded.recoveredCorruptData).toBe(false);
    expect(migratedLoaded.state.bismillahAlhamdulillahEnabled).toBe(true);
    expect(migratedLoaded.state.firstSessionFeedbackPrompted).toBe(false);

    expect(BISMILLAH_TEXT_UZ).toBe(
      'Ilming ziyoda bo‘lishi uchun, «Bismillah» deb boshla!',
    );
    expect(ALHAMDULILLAH_TEXT_UZ).toBe(
      'Barakalla, mashqlarni zo‘r bajarding! Endi Allohga hamd aytib, «Alhamdulillah» deb ayt!',
    );
    expect(BISMILLAH_AUDIO_PATH).toBe('/audio/bismillah.mp3');
    expect(ALHAMDULILLAH_AUDIO_PATH).toBe('/audio/alhamdulillah.mp3');
    expect(findStaticAudioUrlForText(BISMILLAH_TEXT_UZ)).toBe('/audio/bismillah.mp3');
    expect(findStaticAudioUrlForText(ALHAMDULILLAH_TEXT_UZ)).toBe('/audio/alhamdulillah.mp3');
    expect(isVoicePlaybackRecordingSupported()).toBe(false);
  });

  it('ensures static bismillah.mp3, alhamdulillah.mp3, letter_f.mp3 & sound_f.mp3 exist on disk and use VoiceLab lison-v2:malika in audio_review.csv', async () => {
    interface NodeFsSubset {
      existsSync(path: URL): boolean;
      statSync(path: URL): { size: number };
      readFileSync(path: URL, encoding: 'utf8'): string;
    }
    const modId = 'node:fs';
    const fs = (await import(/* @vite-ignore */ modId)) as NodeFsSubset;
    const projectRootUrl = new URL('../../../', import.meta.url);
    const audioDirUrl = new URL('public/audio/', projectRootUrl);
    const reviewCsv = fs
      .readFileSync(new URL('audio_review.csv', projectRootUrl), 'utf8')
      .replace(/^\uFEFF/, '');

    expect(reviewCsv.toLowerCase()).not.toContain('temporary');

    const expectedClips: Array<{ file: string; minBytes: number }> = [
      { file: 'bismillah.mp3', minBytes: 10_000 },
      { file: 'alhamdulillah.mp3', minBytes: 10_000 },
      { file: 'letter_f.mp3', minBytes: 5_000 },
      { file: 'sound_f.mp3', minBytes: 5_000 },
    ];

    const csvLines = reviewCsv.split(/\r?\n/);
    for (const { file, minBytes } of expectedClips) {
      const fileUrl = new URL(file, audioDirUrl);
      expect(fs.existsSync(fileUrl), `Missing audio clip: ${file}`).toBe(true);
      expect(fs.statSync(fileUrl).size, `Clip too small: ${file}`).toBeGreaterThan(minBytes);
      const matchingLine = csvLines.find((line) => line.startsWith(`public/audio/${file},`));
      expect(matchingLine, `Missing CSV row for ${file}`).toBeTruthy();
      expect(matchingLine).toContain('voicelab:lison-v2:malika');
      expect(matchingLine?.toLowerCase()).not.toContain('uzbekvoice');
    }
  });

  it('enforces "Bismillah" spelling/pronunciation text and supports mobile gesture-primed audio & autoplay-blocked fallback safely', async () => {
    expect(enforceBismillahPronunciationText('«Bismilloh» deb boshla!')).toBe(
      '«Bismillah» deb boshla!',
    );
    expect(enforceBismillahPronunciationText('bismilloh')).toBe('bismillah');
    expect(sanitizeSpeechTextForTts('🌟 «Bismilloh» deb boshla!')).toBe(
      '«Bismillah» deb boshla!',
    );
    expect(BISMILLAH_TEXT_UZ).toContain('Bismillah');
    expect(BISMILLAH_TEXT_UZ.toLowerCase()).not.toContain('bismilloh');
    expect(HABIT_AUDIO_FALLBACK_TEXT.bismillah).toContain('Bismillah');
    expect(HABIT_AUDIO_FALLBACK_TEXT.bismillah.toLowerCase()).not.toContain('bismilloh');

    // 1. Safe no-op when Audio is undefined or throws synchronously
    vi.stubGlobal('Audio', undefined);
    expect(() => startGestureAudioClip(BISMILLAH_AUDIO_PATH)).not.toThrow();
    expect(startGestureAudioClip(BISMILLAH_AUDIO_PATH)).toBe(false);
    await expect(
      playAudioClipWithStatus(BISMILLAH_AUDIO_PATH, BISMILLAH_TEXT_UZ, { adoptGestureClip: true }),
    ).resolves.toBe('unavailable');

    class ThrowingAudioMock {
      constructor() {
        throw new Error('Audio construction blocked');
      }
    }
    vi.stubGlobal('Audio', ThrowingAudioMock);
    expect(() => startGestureAudioClip(BISMILLAH_AUDIO_PATH)).not.toThrow();
    await expect(
      playAudioClipWithStatus(BISMILLAH_AUDIO_PATH, undefined, { adoptGestureClip: true }),
    ).resolves.toBe('unavailable');

    // 2. Gesture-primed clip is adopted cleanly without creating a duplicate Audio element
    const createdUrls: string[] = [];
    class PlayingAudioMock {
      src: string;
      preload = '';
      paused = false;
      currentTime = 0;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(src: string) {
        this.src = src;
        createdUrls.push(src);
      }
      setAttribute(): void {}
      play(): Promise<void> {
        queueMicrotask(() => this.onended?.());
        return Promise.resolve();
      }
      pause(): void {
        this.paused = true;
      }
    }
    vi.stubGlobal('Audio', PlayingAudioMock);
    expect(startGestureAudioClip(BISMILLAH_AUDIO_PATH)).toBe(true);
    const adoptedStatus = await playAudioClipWithStatus(
      BISMILLAH_AUDIO_PATH,
      BISMILLAH_TEXT_UZ,
      { adoptGestureClip: true },
    );
    expect(adoptedStatus).toBe('played');
    expect(createdUrls).toEqual([`${BISMILLAH_AUDIO_PATH}?v=${STATIC_AUDIO_VERSION}`]);

    // 3. NotAllowedError resolves 'autoplay_blocked' cleanly without calling /api/tts fetch
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    class BlockedAudioMock {
      src: string;
      preload = '';
      paused = true;
      currentTime = 0;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(src: string) {
        this.src = src;
      }
      play(): Promise<void> {
        const err = new Error('Autoplay blocked');
        err.name = 'NotAllowedError';
        return Promise.reject(err);
      }
      pause(): void {
        this.paused = true;
      }
    }
    vi.stubGlobal('Audio', BlockedAudioMock);
    expect(startGestureAudioClip(BISMILLAH_AUDIO_PATH)).toBe(true);
    const blockedStatus = await playAudioClipWithStatus(
      BISMILLAH_AUDIO_PATH,
      BISMILLAH_TEXT_UZ,
      { adoptGestureClip: true },
    );
    expect(blockedStatus).toBe('autoplay_blocked');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
