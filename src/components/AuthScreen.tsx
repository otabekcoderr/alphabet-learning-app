import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import {
  authenticateParentAccount,
  authenticateParentAccountRemote,
  authenticateWithTelegramCode,
  buildTelegramBotDeepLink,
  DEFAULT_TELEGRAM_BOT_USERNAME,
  fetchAuthProviders,
  hasRegisteredParentAccounts,
  normalizeTelegramAuthCode,
  pollTelegramAuthStatus,
  registerParentAccount,
  registerParentAccountRemote,
  sanitizeTelegramBotUsername,
  startTelegramDeepLinkAuth,
  type AuthProvidersStatus,
  type ParentAccountSession,
} from '../logic/auth';
import { AVATAR_OPTIONS, NICKNAME_PRESETS } from '../logic/gamification';
import { playFeedbackChime } from '../utils/audioRecorder';
import { AvatarVisual } from './AvatarVisual';
import { ArrowLeft, ArrowRight } from './Icons';
import { StorybookBackdrop } from './StorybookBackdrop';

interface AuthScreenProps {
  initialMode?: 'signup' | 'login';
  initialError?: string | null;
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
 * Full-screen Sign Up / Sign In gate rendered in the Alifbo storybook aesthetic.
 */
export function AuthScreen({
  initialMode,
  initialError = null,
  onBackToWelcome,
  onAuthenticated,
}: AuthScreenProps) {
  const [mode, setMode] = useState<AuthMode>(() =>
    initialMode ?? (hasRegisteredParentAccounts() ? 'login' : 'signup'),
  );
  const [contact, setContact] = useState('');
  const [password, setPassword] = useState('');
  const [childName, setChildName] = useState('');
  const [selectedAvatarId, setSelectedAvatarId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [submitting, setSubmitting] = useState(false);
  const [providers, setProviders] = useState<AuthProvidersStatus | null>(null);
  const [tgBotOpen, setTgBotOpen] = useState(false);
  const [tgStarting, setTgStarting] = useState(false);
  const [tgToken, setTgToken] = useState<string | null>(null);
  const [tgDeepLink, setTgDeepLink] = useState<string | null>(null);
  const [tgStatus, setTgStatus] = useState<'idle' | 'waiting' | 'expired'>('idle');
  const [tgCode, setTgCode] = useState('');
  const [tgSubmitting, setTgSubmitting] = useState(false);
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

  const canSubmitSignup =
    contact.trim().length >= 4 &&
    password.length >= 6 &&
    childName.trim().length >= 1 &&
    selectedAvatarId !== null;

  const canSubmitLogin = contact.trim().length >= 1 && password.length >= 1;

  const switchMode = (nextMode: AuthMode) => {
    playFeedbackChime('pop');
    setMode(nextMode);
    setError(null);
    resetTelegramFlow(true);
  };

  const handleGoogleClick = () => {
    if (submitting || tgSubmitting || tgStarting) return;
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
    const params = new URLSearchParams();
    if (mode === 'signup') {
      if (childName.trim()) params.set('childName', childName.trim());
      if (selectedAvatarId) params.set('avatarId', selectedAvatarId);
    }
    const qs = params.toString();
    window.location.href = qs ? `/api/auth/google?${qs}` : '/api/auth/google';
  };

  const startDeepLinkFlow = async () => {
    if (submitting || tgSubmitting || tgStarting) return;
    setError(null);

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
      childName: mode === 'signup' && childName.trim() ? childName.trim() : undefined,
      avatarId: mode === 'signup' && selectedAvatarId ? selectedAvatarId : undefined,
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

  const handleTelegramCodeSubmit = async () => {
    if (tgSubmitting || submitting || tgStarting) return;
    setError(null);

    const cleanCode = normalizeTelegramAuthCode(tgCode);
    if (cleanCode.length !== 6) {
      playFeedbackChime('soft-bonk');
      setError('Telegram bot yuborgan 6 xonali kodni kiriting.');
      return;
    }

    setTgSubmitting(true);
    const res = await authenticateWithTelegramCode({
      code: cleanCode,
      childName: mode === 'signup' && childName.trim() ? childName.trim() : undefined,
      avatarId: mode === 'signup' && selectedAvatarId ? selectedAvatarId : undefined,
    });
    setTgSubmitting(false);

    if (!res.ok) {
      playFeedbackChime('soft-bonk');
      setError(res.errorUz);
      return;
    }

    resetTelegramFlow(true);
    playFeedbackChime('chime');
    onAuthenticated({
      session: res.session,
      childName: res.childName,
      avatarId: res.avatarId,
      isNewSignup: res.isNewSignup,
      remoteState: res.state,
      isRemote: true,
    });
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting || tgSubmitting || tgStarting) return;
    resetTelegramFlow(true);
    setError(null);

    const resolvedProviders = providers ?? (await fetchAuthProviders());
    if (!providers) {
      setProviders(resolvedProviders);
    }

    if (mode === 'signup') {
      if (!selectedAvatarId) {
        playFeedbackChime('soft-bonk');
        setError('8 ta qahramondan birini tanlang.');
        return;
      }

      if (resolvedProviders.dbConfigured) {
        setSubmitting(true);
        const res = await registerParentAccountRemote({
          contact,
          password,
          childName,
          avatarId: selectedAvatarId,
        });
        setSubmitting(false);
        if (!res.ok) {
          playFeedbackChime('soft-bonk');
          setError(res.errorUz);
          return;
        }
        playFeedbackChime('chime');
        onAuthenticated({
          session: res.session,
          childName: res.childName,
          avatarId: res.avatarId,
          isNewSignup: true,
          remoteState: res.state,
          isRemote: true,
        });
        return;
      }

      const res = registerParentAccount({
        contact,
        password,
        childName,
        avatarId: selectedAvatarId,
      });
      if (!res.ok) {
        playFeedbackChime('soft-bonk');
        setError(res.errorUz);
        return;
      }
      playFeedbackChime('chime');
      onAuthenticated({
        session: res.session,
        childName: res.profile.name,
        avatarId: res.profile.avatarId,
        isNewSignup: true,
      });
      return;
    }

    if (resolvedProviders.dbConfigured) {
      setSubmitting(true);
      const res = await authenticateParentAccountRemote({ contact, password });
      setSubmitting(false);
      if (!res.ok) {
        playFeedbackChime('soft-bonk');
        setError(res.errorUz);
        return;
      }
      playFeedbackChime('chime');
      onAuthenticated({
        session: res.session,
        childName: res.childName,
        avatarId: res.avatarId,
        isNewSignup: false,
        remoteState: res.state,
        isRemote: true,
      });
      return;
    }

    const res = authenticateParentAccount({ contact, password });
    if (!res.ok) {
      playFeedbackChime('soft-bonk');
      setError(res.errorUz);
      return;
    }
    resetTelegramFlow(true);
    playFeedbackChime('chime');
    onAuthenticated({
      session: res.session,
      childName: res.childName,
      avatarId: res.avatarId,
      isNewSignup: false,
    });
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
            <span>Bosh ekran</span>
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
          {mode === 'signup' ? 'Yangi hisob va bola profili' : 'Hisobga kirish'}
        </h1>
        <p className="onboarding-text">
          {mode === 'signup'
            ? 'Google, Telegram bot yoki telefon/pochta orqali hisob yarating va farzandingiz uchun qahramonni tanlang.'
            : 'Google, Telegram bot yoki avval ro‘yxatdan o‘tgan telefon/pochta orqali kiring.'}
        </p>

        <div className="auth-social-section">
          <div className="auth-social-grid">
            <button
              type="button"
              className="auth-social-btn auth-social-btn-google"
              onClick={handleGoogleClick}
              disabled={submitting || tgSubmitting || tgStarting}
            >
              <GoogleIcon />
              <span>Google orqali {mode === 'signup' ? 'ro‘yxatdan o‘tish' : 'kirish'}</span>
            </button>

            <button
              type="button"
              className="auth-social-btn auth-social-btn-telegram"
              onClick={() => void startDeepLinkFlow()}
              disabled={providers === null || submitting || tgSubmitting || tgStarting}
              aria-expanded={tgBotOpen}
            >
              <TelegramIcon />
              <span>
                {providers === null
                  ? 'Telegram tekshirilmoqda...'
                  : tgStarting
                    ? 'Telegram havolasi tayyorlanmoqda...'
                    : `Telegram orqali ${mode === 'signup' ? 'ro‘yxatdan o‘tish' : 'kirish'}`}
              </span>
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

                {providers.dbConfigured && (
                  <details className="telegram-code-fallback">
                    <summary>Havola ochilmasa: 6 xonali kod orqali kirish</summary>
                    <div className="telegram-code-fallback-body">
                      <p className="telegram-bot-step">
                        Botga{' '}
                        <a
                          href={buildTelegramBotDeepLink(resolvedBotUsername, mode)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          @{resolvedBotUsername}
                        </a>{' '}
                        ga kirib <code>/kod</code> yuboring va olingan 6 xonali kodni kiriting:
                      </p>
                      <div className="telegram-otp-row">
                        <input
                          type="text"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          maxLength={6}
                          value={tgCode}
                          onChange={(e) => {
                            setTgCode(normalizeTelegramAuthCode(e.target.value));
                            if (error) setError(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void handleTelegramCodeSubmit();
                            }
                          }}
                          placeholder="123456"
                          className="parent-text-input telegram-otp-input"
                          aria-label="Telegram 6 xonali tasdiqlash kodi"
                        />
                        <button
                          type="button"
                          className="btn-3d-emerald btn-compact"
                          disabled={tgSubmitting || submitting || tgCode.length !== 6}
                          onClick={() => void handleTelegramCodeSubmit()}
                        >
                          {tgSubmitting ? 'Tekshirilmoqda...' : 'Kodni tasdiqlash'}
                        </button>
                      </div>
                    </div>
                  </details>
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

          <div className="auth-or-divider">
            <span>yoki telefon/pochta bilan</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="pin-form">
          <label className="pin-label">
            Telefon raqami yoki elektron pochta
            <input
              type="text"
              autoComplete="username"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="+998 90 123 45 67 yoki email@example.uz"
              className="parent-text-input auth-full-input"
            />
          </label>

          <label className="pin-label">
            {mode === 'signup' ? 'Parol (kamida 6 ta belgi)' : 'Parol'}
            <input
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••"
              className="parent-text-input auth-full-input"
            />
          </label>

          {mode === 'signup' && (
            <div className="auth-profile-section">
              <div className="auth-divider" />
              <h2 className="auth-section-heading">Bola profili</h2>

              <label className="pin-label">
                Bolaning ismi yoki taxallusi
                <input
                  type="text"
                  maxLength={20}
                  value={childName}
                  onChange={(e) => setChildName(e.target.value)}
                  placeholder="Masalan: Zukko"
                  className="parent-text-input auth-full-input"
                />
              </label>

              <div className="nickname-presets-row" aria-label="Tayyor taxalluslar">
                {NICKNAME_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={`btn-3d-cream btn-compact ${childName === preset ? 'preset-active' : ''}`}
                    onClick={() => {
                      playFeedbackChime('pop');
                      setChildName(preset);
                    }}
                  >
                    {preset}
                  </button>
                ))}
              </div>

              <div className="pin-label" style={{ marginTop: 6 }}>
                <span>Qahramonni tanlang (8 ta)</span>
                <div className="avatar-picker-grid" role="radiogroup" aria-label="Qahramon tanlash">
                  {AVATAR_OPTIONS.map((av) => {
                    const selected = av.id === selectedAvatarId;
                    return (
                      <motion.button
                        key={av.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        whileTap={{ scale: 0.94 }}
                        className={`avatar-choice-btn ${selected ? 'avatar-choice-selected' : ''}`}
                        style={{
                          backgroundColor: av.bg,
                          borderColor: selected ? '#059669' : av.border,
                        }}
                        onClick={() => {
                          playFeedbackChime('pop');
                          setSelectedAvatarId(av.id);
                        }}
                      >
                        <span className="avatar-choice-emoji avatar-visual-wrap" aria-hidden="true">
                          <AvatarVisual avatarId={av.id} size={36} />
                        </span>
                        <span className="avatar-choice-label">{av.label}</span>
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {error && !tgBotOpen && (
            <motion.div
              initial={{ x: -6 }}
              animate={{ x: [0, -6, 6, -4, 4, 0] }}
              transition={{ duration: 0.35 }}
              className="feedback-banner feedback-gentle"
            >
              {error}
            </motion.div>
          )}

          <button
            type="submit"
            className="btn-3d-emerald auth-submit-btn btn-with-icon"
            disabled={
              submitting ||
              tgSubmitting ||
              tgStarting ||
              (mode === 'signup' ? !canSubmitSignup : !canSubmitLogin)
            }
          >
            <span>
              {submitting
                ? 'Tekshirilmoqda...'
                : mode === 'signup'
                  ? 'Ro‘yxatdan o‘tish va davom etish'
                  : 'Kirish'}
            </span>
            <ArrowRight size={18} />
          </button>
        </form>
      </motion.section>
    </div>
  );
}
