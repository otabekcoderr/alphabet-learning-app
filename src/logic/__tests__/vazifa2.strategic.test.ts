import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ALHAMDULILLAH_AUDIO_PATH,
  ALHAMDULILLAH_TEXT_UZ,
  BISMILLAH_AUDIO_PATH,
  BISMILLAH_TEXT_UZ,
  isVoicePlaybackRecordingSupported,
} from '../../components/BismillahAlhamdulillah';
import { findStaticAudioUrlForText } from '../../utils/audioRecorder';
import {
  FEEDBACK_DISAPPOINTMENT_OPTIONS,
  FEEDBACK_MIN_SESSIONS_FOR_RESULT,
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
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('queues Telegram messages in localStorage without crashing when env is missing, network fails, or HTTP fails', async () => {
    const mockStorage = createMockLocalStorage();
    vi.stubGlobal('window', { localStorage: mockStorage });

    // 1. Missing env variables
    const missingEnvRes = await sendTelegramMessage('Test xabar 1', {
      category: 'onboarding',
      env: { botToken: '', chatId: '' },
    });
    expect(missingEnvRes).toEqual({
      ok: false,
      queuedLocally: true,
      reason: 'missing_env',
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
      env: { botToken: '123:abc', chatId: '999' },
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
      env: { botToken: '123:abc', chatId: '999' },
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

    // 4. Successful Telegram Bot API call
    const fetchOkMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    }));
    vi.stubGlobal('fetch', fetchOkMock);

    const okRes = await sendTelegramMessage('Salom Telegram!', {
      category: 'onboarding',
      env: { botToken: '12345:token', chatId: '-100777' },
    });
    expect(okRes).toEqual({ ok: true, queuedLocally: false });
    expect(fetchOkMock).toHaveBeenCalledWith(
      'https://api.telegram.org/bot12345:token/sendMessage',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          chat_id: '-100777',
          text: 'Salom Telegram!',
          disable_web_page_preview: true,
        }),
      }),
    );
  });

  it('formats onboarding and feedback Telegram messages in clean Uzbek', () => {
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

  it('enforces >= 2 completed sessions gate for result-screen Feedback button and PMF options', () => {
    expect(FEEDBACK_MIN_SESSIONS_FOR_RESULT).toBe(2);
    expect(shouldShowResultFeedbackButton(0)).toBe(false);
    expect(shouldShowResultFeedbackButton(1)).toBe(false);
    expect(shouldShowResultFeedbackButton(2)).toBe(true);
    expect(shouldShowResultFeedbackButton(5)).toBe(true);

    expect(FEEDBACK_DISAPPOINTMENT_OPTIONS.map((o) => o.label)).toEqual([
      'Juda xafa bo‘laman',
      'Biroz',
      'Farqi yo‘q',
    ]);
  });

  it('persists completedSessionsCount, bismillahAlhamdulillahEnabled & strategic SurveyData in progressStorage and safely handles missing MediaRecorder', () => {
    const mockStorage = createMockLocalStorage();
    vi.stubGlobal('window', { localStorage: mockStorage });

    const initial = createInitialState();
    expect(initial.completedSessionsCount).toBe(0);
    expect(initial.bismillahAlhamdulillahEnabled).toBe(true);

    const updated = {
      ...initial,
      completedSessionsCount: 3,
      bismillahAlhamdulillahEnabled: false,
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
    expect(loaded.state.surveyData?.childStage).toBe('no_letters_yet');
    expect(loaded.state.surveyData?.previousAttempt).toBe('not_started_seriously');
    expect(loaded.state.surveyData?.biggestDifficulty).toBe('no_parent_time');

    // Older v3 saved JSON omitting bismillahAlhamdulillahEnabled migrates cleanly to true
    const legacyV3 = JSON.parse(mockStorage.getItem('alifbo_app_state_v3') ?? '{}') as Record<
      string,
      unknown
    >;
    delete legacyV3.bismillahAlhamdulillahEnabled;
    mockStorage.setItem('alifbo_app_state_v3', JSON.stringify(legacyV3));
    const migratedLoaded = loadAlifboState();
    expect(migratedLoaded.recoveredCorruptData).toBe(false);
    expect(migratedLoaded.state.bismillahAlhamdulillahEnabled).toBe(true);

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
});
