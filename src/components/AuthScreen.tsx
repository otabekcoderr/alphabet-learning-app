import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  authenticateWithTelegramWebApp,
  DEFAULT_TELEGRAM_BOT_USERNAME,
  fetchAuthProviders,
  hasRegisteredParentAccounts,
  pollTelegramAuthStatus,
  sanitizeTelegramBotUsername,
  startTelegramDeepLinkAuth,
  type AuthProvidersStatus,
  type ParentAccountSession,
} from '../logic/auth';
import { playFeedbackChime } from '../utils/audioRecorder';
import { getTelegramWebAppInitData, isTelegramWebAppContext } from '../utils/telegramWebApp';
import { ArrowLeft } from './Icons';
import { StorybookBackdrop } from './StorybookBackdrop';

interface AuthScreenProps {
  initialMode?: 'signup' | 'login';
  initialError?: string | null;
  isGuestUpgrade?: boolean;
  defaultChildName?: string;
  defaultAvatarId?: string;
  backButtonLabelUz?: string;
  onBeforeExternalRedirect?: () => void;
  onBackToWelcome?: () => void;
  onAuthenticated: (payload: {
    session: ParentAccountSession;
    childName: string;
    avatarId: string;
    isNewSignup: boolean;
    remoteState?: unknown | null;
    isRemote?: boolean;
  }) => void;
}

type AuthMode = 'signup' | 'login';

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.4c-.2 1.2-1.5 3.6-5.4 3.6-3.2 0-5.9-2.7-5.9-6s2.7-6 5.9-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.1 14.6 2.2 12 2.2 6.6 2.2 2.2 6.6 2.2 12s4.4 9.8 9.8 9.8c5.7 0 9.4-4 9.4-9.6 0-.6-.1-1.1-.2-1.6H12Z"
      />
      <path
        fill="#34A853"
        d="M3.3 7.5 6.5 9.9C7.4 7.7 9.5 6.1 12 6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.1 14.6 2.2 12 2.2 8.2 2.2 4.9 4.4 3.3 7.5Z"
      />
      <path
        fill="#FBBC05"
        d="M12 21.8c2.6 0 4.8-.9 6.4-2.3l-3-2.4c-.8.6-1.9 1-3.4 1-2.6 0-4.8-1.7-5.6-4.1l-3.2 2.5c1.6 3.2 4.9 5.3 8.8 5.3Z"
      />
      <path
        fill="#4285F4"
        d="M21.4 12.2c0-.6-.1-1.1-.2-1.6H12v3.9h5.4c-.3 1.3-1 2.4-2 3.1l3 2.4c1.8-1.6 3-4.1 3-7.8Z"
      />
    </svg>
  );
}

function TelegramIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M21.9 4.4c.3-1.2-.8-2.2-1.9-1.7L2.6 9.8c-1.2.5-1.1 2.2.1 2.6l4.4 1.4 1.7 5.3c.3 1 1.6 1.3 2.3.5l2.5-2.6 4.7 3.5c.9.7 2.2.2 2.5-.9l3.1-15.2ZM8.8 13.4l8.8-5.6c.2-.1.4.2.2.3l-7.2 6.6-.3 3.2-1.5-4.5Z"
      />
    </svg>
  );
}

/**
 * Full-screen Sign Up / Sign In gate offering frictionless Telegram & Google auth only.
 */
export function AuthScreen({
  initialMode,
  initialError = null,
  isGuestUpgrade = false,
  defaultChildName = '',
  defaultAvatarId = '',
  backButtonLabelUz = 'Bosh ekran',
  onBeforeExternalRedirect,
  onBackToWelcome,
  onAuthenticated,
}: AuthScreenProps) {
  const [mode, setMode] = useState<AuthMode>(() =>
    initialMode ?? (hasRegisteredParentAccounts() ? 'login' : 'signup'),
  );
  const [error, setError] = useState<string | null>(initialError);
  const [providers, setProviders] = useState<AuthProvidersStatus | null>(null);
  const [tgBotOpen, setTgBotOpen] = useState(false);
  const [tgStarting, setTgStarting] = useState(false);
  const [tgToken, setTgToken] = useState<string | null>(null);
  const [tgDeepLink, setTgDeepLink] = useState<string | null>(null);
  const [tgStatus, setTgStatus] = useState<'idle' | 'waiting' | 'expired'>('idle');
  const tgPollBusyRef = useRef(false);
  const onAuthenticatedRef = useRef(onAuthenticated);
  onAuthenticatedRef.current = onAuthenticated;

  const resolvedBotUsername =
    sanitizeTelegramBotUsername(
      providers?.telegramBotUsername || import.meta.env.VITE_TELEGRAM_BOT_USERNAME,
    ) || DEFAULT_TELEGRAM_BOT_USERNAME;

  const resetTelegramFlow = useCallback((closeCard = false) => {
    setTgToken(null);
    setTgDeepLink(null);
    setTgStatus('idle');
    setTgStarting(false);
    tgPollBusyRef.current = false;
    if (closeCard) {
      setTgBotOpen(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void fetchAuthProviders().then((res) => {
      if (active) setProviders(res);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (initialError) {
      setError(initialError);
    }
  }, [initialError]);

  useEffect(() => {
    if (!tgBotOpen || !tgToken || tgStatus !== 'waiting') {
      return;
    }
    let active = true;

    const checkOnce = async () => {
      if (!active || tgPollBusyRef.current) return;
      tgPollBusyRef.current = true;
      try {
        const res = await pollTelegramAuthStatus(tgToken);
        if (!active || !res.ok) return;

        if (res.status === 'approved') {
          setTgStatus('idle');
          setTgToken(null);
          setTgDeepLink(null);
          playFeedbackChime('chime');
          onAuthenticatedRef.current({
            session: res.session,
            childName: res.childName,
            avatarId: res.avatarId,
            isNewSignup: res.isNewSignup,
            remoteState: res.state,
            isRemote: res.dbSynced,
          });
          return;
        }

        if (res.status === 'expired') {
          setTgStatus('expired');
          setTgToken(null);
          setError('Havola muddati tugadi. «Yangi havola olish» tugmasini bosing.');
        }
      } finally {
        tgPollBusyRef.current = false;
      }
    };

    const timerId = window.setInterval(() => {
      void checkOnce();
    }, 2000);

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        void checkOnce();
      }
    };
    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    return () => {
      active = false;
      window.clearInterval(timerId);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [tgBotOpen, tgToken, tgStatus]);

  const switchMode = (nextMode: AuthMode) => {
    playFeedbackChime('pop');
    setMode(nextMode);
    setError(null);
    resetTelegramFlow(true);
  };

  const handleGoogleClick = () => {
    if (tgStarting) return;
    setError(null);

    if (!providers?.dbConfigured) {
      playFeedbackChime('soft-bonk');
      setError(
        "Google orqali kirish uchun avval Vercel loyihasiga Neon ma'lumotlar bazasi ulanishi kerak.",
      );
      return;
    }

    if (!providers.google) {
      playFeedbackChime('soft-bonk');
      setError(
        'Google orqali kirish hali yoqilmagan: Vercel sozlamalariga GOOGLE_CLIENT_ID va GOOGLE_CLIENT_SECRET qo‘shilishi kerak.',
      );
      return;
    }

    playFeedbackChime('pop');
    onBeforeExternalRedirect?.();
    const params = new URLSearchParams();
    const effectiveChildName = defaultChildName.trim();
    const effectiveAvatarId = defaultAvatarId.trim();
    if (isGuestUpgrade) {
      if (effectiveChildName) params.set('childName', effectiveChildName);
      if (effectiveAvatarId) params.set('avatarId', effectiveAvatarId);
    }
    const qs = params.toString();
    window.location.href = qs ? `/api/auth/google?${qs}` : '/api/auth/google';
  };

  const startDeepLinkFlow = async () => {
    if (tgStarting) return;
    setError(null);

    const effectiveChildName = defaultChildName.trim();
    const effectiveAvatarId = defaultAvatarId.trim();

    // Zero-click WebApp auth when running inside Telegram Mini App
    const webAppInitData = isTelegramWebAppContext() ? getTelegramWebAppInitData() : '';
    if (webAppInitData) {
      playFeedbackChime('pop');
      setTgStarting(true);
      const res = await authenticateWithTelegramWebApp({
        initData: webAppInitData,
        childName: isGuestUpgrade && effectiveChildName ? effectiveChildName : undefined,
        avatarId: isGuestUpgrade && effectiveAvatarId ? effectiveAvatarId : undefined,
      });
      setTgStarting(false);
      if (res.ok) {
        playFeedbackChime('chime');
        onAuthenticated({
          session: res.session,
          childName: res.childName,
          avatarId: res.avatarId,
          isNewSignup: res.isNewSignup,
          remoteState: res.state,
          isRemote: res.dbSynced ?? true,
        });
        return;
      }
      playFeedbackChime('soft-bonk');
      setError(res.errorUz);
      return;
    }

    if (providers === null) {
      return;
    }

    const canUseStore = providers.telegramStoreConfigured ?? providers.dbConfigured;
    if (!canUseStore) {
      playFeedbackChime('soft-bonk');
      setError(
        "Telegram orqali kirish uchun avval Vercel loyihasiga Neon ma'lumotlar bazasi yoki KV xotira ulanishi kerak.",
      );
      return;
    }

    if (!providers.telegram) {
      playFeedbackChime('soft-bonk');
      setError(
        'Telegram orqali kirish hali yoqilmagan: Vercel sozlamalariga TELEGRAM_BOT_TOKEN qo‘shilishi kerak.',
      );
      return;
    }

    playFeedbackChime('pop');
    setTgStarting(true);
    setTgBotOpen(true);
    setTgStatus('idle');
    setTgToken(null);
    setTgDeepLink(null);

    const res = await startTelegramDeepLinkAuth({
      mode,
      childName: isGuestUpgrade && effectiveChildName ? effectiveChildName : undefined,
      avatarId: isGuestUpgrade && effectiveAvatarId ? effectiveAvatarId : undefined,
    });
    setTgStarting(false);

    if (!res.ok) {
      playFeedbackChime('soft-bonk');
      setError(res.errorUz);
      return;
    }

    setTgToken(res.token);
    setTgDeepLink(res.deepLink);
    setTgStatus('waiting');

    window.open(res.deepLink, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="fullscreen-flow-shell">
      <StorybookBackdrop />

      <div className="fullscreen-flow-topbar">
        <div className="fullscreen-flow-brand">
          <img src="/images/logo.webp" alt="Alifbo" className="brand-logo-img" draggable={false} />
        </div>
        {onBackToWelcome && (
          <button
            type="button"
            className="btn-3d-cream btn-compact btn-with-icon"
            onClick={() => {
              playFeedbackChime('pop');
              onBackToWelcome();
            }}
          >
            <ArrowLeft size={16} />
            <span>{backButtonLabelUz}</span>
          </button>
        )}
      </div>

      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 280, damping: 24 }}
        className="fullscreen-flow-card auth-flow-card"
        aria-labelledby="auth-screen-title"
      >
        {isGuestUpgrade && (
          <div className="feedback-banner feedback-success" style={{ marginBottom: 12 }}>
            Sinov rejimidagi barcha yulduzlar va o‘qilgan so‘zlar hisobingizga avtomatik
            ko‘chiriladi hamda doimiy 8 xonali ID beriladi.
          </div>
        )}
        <div className="auth-tabs" role="tablist" aria-label="Hisob amallari">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'signup'}
            className={`auth-tab-btn ${mode === 'signup' ? 'auth-tab-active' : ''}`}
            onClick={() => switchMode('signup')}
          >
            Ro‘yxatdan o‘tish
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            className={`auth-tab-btn ${mode === 'login' ? 'auth-tab-active' : ''}`}
            onClick={() => switchMode('login')}
          >
            Kirish
          </button>
        </div>

        <h1 id="auth-screen-title" className="fullscreen-flow-title">
          {mode === 'signup' ? 'Tezkor ro‘yxatdan o‘tish' : 'Hisobga kirish'}
        </h1>
        <p className="onboarding-text">
          {mode === 'signup'
            ? 'Telegram yoki Google orqali bir zumda hisob oching — parol va ortiqcha ma’lumot kiritish shart emas.'
            : 'Telegram yoki Google orqali hisobingizga kiring.'}
        </p>

        <div className="auth-social-section">
          <div className="auth-social-grid">
            <button
              type="button"
              className="auth-social-btn auth-social-btn-telegram"
              onClick={() => void startDeepLinkFlow()}
              disabled={providers === null || tgStarting}
              aria-expanded={tgBotOpen}
            >
              <TelegramIcon />
              <span>
                {providers === null
                  ? 'Telegram tekshirilmoqda...'
                  : tgStarting
                    ? 'Telegram ulanmoqda...'
                    : `Telegram orqali ${mode === 'signup' ? 'ro‘yxatdan o‘tish' : 'kirish'}`}
              </span>
            </button>

            <button
              type="button"
              className="auth-social-btn auth-social-btn-google"
              onClick={handleGoogleClick}
              disabled={tgStarting}
            >
              <GoogleIcon />
              <span>Google orqali {mode === 'signup' ? 'ro‘yxatdan o‘tish' : 'kirish'}</span>
            </button>

            {tgBotOpen && providers?.telegram && (
              <div
                className="telegram-bot-auth-card"
                role="region"
                aria-label="Telegram bot orqali tezkor kirish"
              >
                {tgStarting && (
                  <div className="telegram-waiting-status">
                    <span className="telegram-waiting-dot" aria-hidden="true" />
                    <span>Bir martalik Telegram havolasi tayyorlanmoqda...</span>
                  </div>
                )}

                {!tgStarting && tgDeepLink && tgStatus === 'waiting' && (
                  <>
                    <div className="telegram-waiting-status">
                      <span className="telegram-waiting-dot" aria-hidden="true" />
                      <span>
                        Telegram ilovasida <strong>@{resolvedBotUsername}</strong> botini ochib{' '}
                        <strong>«Start»</strong> tugmasini bosing — saytga avtomatik kirasiz.
                      </span>
                    </div>
                    <a
                      href={tgDeepLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="telegram-open-bot-btn"
                      onClick={() => playFeedbackChime('pop')}
                    >
                      <TelegramIcon />
                      <span>Telegram botni ochish (@{resolvedBotUsername})</span>
                    </a>
                    <div className="telegram-waiting-actions">
                      <button
                        type="button"
                        className="btn-3d-cream btn-compact"
                        onClick={() => void startDeepLinkFlow()}
                        disabled={tgStarting}
                      >
                        Yangi havola olish
                      </button>
                      <button
                        type="button"
                        className="btn-3d-cream btn-compact"
                        onClick={() => {
                          playFeedbackChime('pop');
                          setError(null);
                          resetTelegramFlow(true);
                        }}
                      >
                        Bekor qilish
                      </button>
                    </div>
                  </>
                )}

                {!tgStarting && tgStatus === 'expired' && (
                  <div className="telegram-waiting-actions">
                    <button
                      type="button"
                      className="telegram-open-bot-btn"
                      onClick={() => void startDeepLinkFlow()}
                    >
                      <TelegramIcon />
                      <span>Yangi havola olish</span>
                    </button>
                  </div>
                )}

                {error && (
                  <motion.div
                    initial={{ x: -6 }}
                    animate={{ x: [0, -6, 6, -4, 4, 0] }}
                    transition={{ duration: 0.35 }}
                    className="feedback-banner feedback-gentle"
                  >
                    {error}
                  </motion.div>
                )}
              </div>
            )}
          </div>
        </div>

        {error && !tgBotOpen && (
          <motion.div
            initial={{ x: -6 }}
            animate={{ x: [0, -6, 6, -4, 4, 0] }}
            transition={{ duration: 0.35 }}
            className="feedback-banner feedback-gentle"
            style={{ marginTop: 12 }}
          >
            {error}
          </motion.div>
        )}

        <p className="muted-text" style={{ marginTop: 14, marginBottom: 0, fontSize: 13 }}>
          Qahramoningiz — <strong>Zukko Tulki</strong>! O‘yin ichida bolaning taxallusi va rasmini
          istalgan payt tasodifiy belgilashingiz yoki o‘zgartirishingiz mumkin.
        </p>
      </motion.section>
    </div>
  );
}
