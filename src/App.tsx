import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DYNAMIC_WORD_POOL,
  READING_WORLDS,
} from './data/curriculum';
import { applyLetterReviewResult } from './logic/alphabetReview';
import { startAsrHealthPolling } from './logic/asrHealth';
import {
  fetchCurrentSession,
  generateAccountPublicId,
  getDisplayablePublicId,
  GUEST_TRIAL_ACCOUNT_ID,
  isGuestAccount,
  isValidAccountPublicId,
  logoutRemoteSession,
  saveRemoteState,
} from './logic/auth';
import { flushPendingTelegramMessages } from './services/telegramService';
import {
  applyParentWordVerification,
  applyWordReadingAttempt,
} from './logic/pedagogy';
import { clearPinLockout } from './logic/pin';
import {
  addPracticedSeconds,
  clampDailyLimitMinutes,
  evaluateScreenTimeLimit,
  recordLetterHintTap,
  selectAdaptiveSessionWords,
  type AdaptiveSessionWord,
} from './logic/wordPoolEngine';
import {
  clearGuestMigrationSnapshot,
  clearPendingPinReset,
  consumeGuestMigrationSnapshot,
  consumePendingPinReset,
  createInitialState,
  getLocalDateString,
  hydrateAlifboState,
  loadAlifboState,
  mergeAlifboStates,
  recordPracticeDate,
  saveAlifboState,
  stageGuestMigrationSnapshot,
  stagePendingPinReset,
  type AlifboState,
  type ChildProfileData,
} from './storage/progressStorage';
import { BISMILLAH_AUDIO_PATH, BismillahStartCard } from './components/BismillahAlhamdulillah';
import { ChildHome } from './components/ChildHome';
import { Lock, Star } from './components/Icons';
import type { WordAttemptReport } from './components/LessonPlayer';
import { StorybookBackdrop } from './components/StorybookBackdrop';
import { WelcomeScreen } from './components/WelcomeScreen';
import { playFeedbackChime, preloadLessonSessionAudio, startGestureAudioClip } from './utils/audioRecorder';
import { setPwaReloadDeferral } from './utils/pwa';

const LazyAlphabetRecallDrawer = lazy(() =>
  import('./components/AlphabetRecallDrawer').then((m) => ({ default: m.AlphabetRecallDrawer })),
);
const LazyAuthScreen = lazy(() =>
  import('./components/AuthScreen').then((m) => ({ default: m.AuthScreen })),
);
const LazyLessonPlayer = lazy(() =>
  import('./components/LessonPlayer').then((m) => ({ default: m.LessonPlayer })),
);
const LazyOnboardingSurveyPage = lazy(() =>
  import('./components/OnboardingSurveyPage').then((m) => ({ default: m.OnboardingSurveyPage })),
);
const LazyParentCorner = lazy(() =>
  import('./components/ParentCorner').then((m) => ({ default: m.ParentCorner })),
);
const LazyParentOnboardingModal = lazy(() =>
  import('./components/ParentOnboardingModal').then((m) => ({ default: m.ParentOnboardingModal })),
);
const LazyPinModal = lazy(() =>
  import('./components/PinModal').then((m) => ({ default: m.PinModal })),
);

function ScreenLoadingFallback() {
  return (
    <div className="screen-loading-fallback" role="status" aria-live="polite">
      <div className="screen-loading-card">
        <span className="screen-loading-spinner" aria-hidden="true" />
        <span>Yuklanmoqda...</span>
      </div>
    </div>
  );
}

type ViewTab = 'home' | 'alphabet' | 'lesson' | 'parent';
type GateView = { screen: 'welcome' } | { screen: 'auth'; mode: 'signup' | 'login' };

function mapAuthErrorCodeToUz(code: string): string {
  switch (code) {
    case 'db_not_configured':
      return "Ma'lumotlar bazasi hali ulanmagan.";
    case 'google_not_configured':
      return 'Google orqali kirish hali sozlanmagan (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET kerak).';
    case 'google_cancelled':
      return 'Google orqali kirish bekor qilindi.';
    case 'google_state_invalid':
      return 'Google xavfsizlik tekshiruvi muddati tugadi. Qaytadan urinib ko‘ring.';
    case 'telegram_not_configured':
      return 'Telegram orqali kirish hali sozlanmagan (TELEGRAM_BOT_TOKEN va TELEGRAM_BOT_USERNAME kerak).';
    case 'telegram_invalid':
    case 'telegram_code_invalid':
      return 'Kod noto‘g‘ri yoki muddati tugagan. Telegram botdan /kod orqali yangi kod oling.';
    case 'telegram_code_format':
      return 'Bot yuborgan 6 xonali raqamli kodni kiriting.';
    case 'telegram_db_failed':
    case 'telegram_server_error':
      return 'Telegram orqali kirishda server xatoligi yuz berdi. Keyinroq urinib ko‘ring.';
    default:
      return 'Hisobga kirishda xatolik yuz berdi. Qaytadan urinib ko‘ring.';
  }
}

export function App() {
  const [loaded] = useState(() => loadAlifboState());
  const [state, setState] = useState<AlifboState>(() => loaded.state);
  const [gateView, setGateView] = useState<GateView>({ screen: 'welcome' });
  const [authUrlError, setAuthUrlError] = useState<string | null>(null);
  const [remoteSessionActive, setRemoteSessionActive] = useState<boolean>(false);
  const skipNextRemoteSyncRef = useRef<boolean>(false);
  const [tab, setTab] = useState<ViewTab>('home');
  const [bismillahPending, setBismillahPending] = useState<boolean>(false);
  const [sessionItems, setSessionItems] = useState<AdaptiveSessionWord[]>([]);
  const [lessonSessionKey, setLessonSessionKey] = useState(0);
  const [roundWorldId, setRoundWorldId] = useState<1 | 2 | 3 | 4 | 5>(() => {
    const id = loaded.state.activeWorldId;
    return id >= 1 && id <= 5 ? (id as 1 | 2 | 3 | 4 | 5) : 1;
  });
  const [aiOnline, setAiOnline] = useState<boolean>(false);
  const [editingSurvey, setEditingSurvey] = useState<boolean>(false);
  const [pinModalOpen, setPinModalOpen] = useState<boolean>(false);
  const [onboardingModal, setOnboardingModal] = useState<{ open: boolean; isReplay: boolean }>({
    open: false,
    isReplay: false,
  });
  const [parentUnlocked, setParentUnlocked] = useState<boolean>(false);
  const [upgradeAuthOpen, setUpgradeAuthOpen] = useState<boolean>(false);
  const [pinResetAuthOpen, setPinResetAuthOpen] = useState<boolean>(false);

  useEffect(() => {
    saveAlifboState(state);
  }, [state]);

  // Restore remote session from HttpOnly cookie + handle OAuth redirect callbacks & Guest migration
  useEffect(() => {
    let active = true;
    void flushPendingTelegramMessages();

    const params = new URLSearchParams(window.location.search);
    const authParam = params.get('auth');
    const authErrorParam = params.get('auth_error');

    if (authParam || authErrorParam) {
      window.history.replaceState({}, '', window.location.pathname);
    }

    if (authErrorParam) {
      setAuthUrlError(mapAuthErrorCodeToUz(authErrorParam));
      setGateView({ screen: 'auth', mode: 'login' });
    }

    void fetchCurrentSession().then((res) => {
      if (!active) return;
      if (res.authenticated && res.session) {
        const remoteSession = {
          ...res.session,
          isGuest: false,
          publicId: isValidAccountPublicId(res.session.publicId)
            ? res.session.publicId
            : generateAccountPublicId(),
        };
        const stagedGuest = consumeGuestMigrationSnapshot();
        const shouldResetPin = consumePendingPinReset(remoteSession.id);
        setRemoteSessionActive(true);
        setAuthUrlError(null);
        setUpgradeAuthOpen(false);
        setPinResetAuthOpen(false);
        const hydrated = hydrateAlifboState(res.state);

        setState((prev) => {
          const guestSource =
            stagedGuest ??
            (isGuestAccount(prev.account) || prev.progressOwnerId === GUEST_TRIAL_ACCOUNT_ID
              ? prev
              : null);
          const merged = mergeAlifboStates({
            remoteState: hydrated,
            guestState: guestSource,
            session: remoteSession,
            childName: res.childName,
            avatarId: res.avatarId,
          });
          if (shouldResetPin) {
            return {
              ...merged.state,
              pinSalt: null,
              pinHash: null,
              recoveryCodeHash: null,
              pinLockout: clearPinLockout(),
            };
          }
          if (!merged.state.pendingRemoteSync) {
            skipNextRemoteSyncRef.current = true;
          }
          return merged.state;
        });
        if (shouldResetPin) {
          setPinModalOpen(true);
        }
      } else {
        clearGuestMigrationSnapshot();
        clearPendingPinReset();
      }
    });

    return () => {
      active = false;
    };
  }, []);

  // Sync authenticated state to Neon Postgres (immediately after Guest migration, debounced otherwise)
  useEffect(() => {
    if (!remoteSessionActive || !state.account || isGuestAccount(state.account)) {
      return;
    }
    if (skipNextRemoteSyncRef.current) {
      skipNextRemoteSyncRef.current = false;
      return;
    }
    const delayMs = state.pendingRemoteSync ? 0 : 1500;
    const timer = window.setTimeout(() => {
      void saveRemoteState(state).then((ok) => {
        if (ok && state.pendingRemoteSync) {
          skipNextRemoteSyncRef.current = true;
          setState((prev) => (prev.pendingRemoteSync ? { ...prev, pendingRemoteSync: false } : prev));
        }
      });
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [remoteSessionActive, state]);

  // Check ASR health on load (single check on hosted/production origins; periodic polling locally or with VITE_ASR_URL)
  useEffect(() => {
    return startAsrHealthPolling({
      hostname: window.location.hostname,
      configuredAsrUrl: import.meta.env.VITE_ASR_URL,
      onStatus: setAiOnline,
    });
  }, []);

  // Track healthy daily screen-time while child is playing a reading round,
  // and defer SW deploy reloads until the child exits the active lesson.
  useEffect(() => {
    setPwaReloadDeferral(tab === 'lesson');
  }, [tab]);

  useEffect(() => {
    if (tab !== 'lesson' || bismillahPending) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const today = getLocalDateString();
      setState((prev) => ({
        ...prev,
        ...addPracticedSeconds({
          dailyPracticeDate: prev.dailyPracticeDate,
          todayDateStr: today,
          todayPracticedSeconds: prev.todayPracticedSeconds,
          deltaSeconds: 5,
        }),
      }));
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [tab, bismillahPending]);

  const todayDateStr = getLocalDateString();
  const screenTime = useMemo(
    () =>
      evaluateScreenTimeLimit({
        dailyLimitMinutes: state.dailyLimitMinutes,
        dailyPracticeDate: state.dailyPracticeDate,
        todayDateStr,
        todayPracticedSeconds: state.todayPracticedSeconds,
      }),
    [state.dailyLimitMinutes, state.dailyPracticeDate, todayDateStr, state.todayPracticedSeconds],
  );

  const startWorldRound = useCallback(
    (worldId: 1 | 2 | 3 | 4 | 5, recentSessionWordIds?: readonly string[]) => {
      const items = selectAdaptiveSessionWords({
        worldId,
        pool: DYNAMIC_WORD_POOL,
        wordProgressMap: state.wordProgress,
        todayStr: getLocalDateString(),
        letterHintCounts: state.letterHintCounts,
        recentSessionWordIds,
      });
      if (state.bismillahAlhamdulillahEnabled) {
        try {
          startGestureAudioClip(BISMILLAH_AUDIO_PATH);
        } catch {
          // Audio playback must never block Bismillah screen transition
        }
      }
      void preloadLessonSessionAudio(
        items.map((entry) => entry.item),
        { includeAlhamdulillah: state.bismillahAlhamdulillahEnabled },
      );
      setRoundWorldId(worldId);
      setSessionItems(items);
      setLessonSessionKey((prev) => prev + 1);
      setBismillahPending(state.bismillahAlhamdulillahEnabled);
      setState((prev) => ({ ...prev, activeWorldId: worldId }));
      setTab('lesson');
    },
    [state.wordProgress, state.letterHintCounts, state.bismillahAlhamdulillahEnabled],
  );

  const handleRoundFinished = useCallback(() => {
    setState((prev) => ({
      ...prev,
      completedSessionsCount: prev.completedSessionsCount + 1,
    }));
  }, []);

  const handleLetterHintTap = useCallback((letter: string) => {
    setState((prev) => ({
      ...prev,
      letterHintCounts: recordLetterHintTap(prev.letterHintCounts, letter),
    }));
  }, []);

  const handleLetterReviewed = useCallback(
    (payload: {
      letter: string;
      perfectRound: boolean;
      usedVoiceAi: boolean;
      starsEarned: number;
    }) => {
      const todayStr = getLocalDateString();
      setState((prev) => {
        const nextEntry = applyLetterReviewResult(prev.letterMastery[payload.letter], {
          letter: payload.letter,
          perfectRound: payload.perfectRound,
          usedVoiceAi: payload.usedVoiceAi,
          todayStr,
        });
        return {
          ...prev,
          letterMastery: {
            ...prev.letterMastery,
            [payload.letter]: nextEntry,
          },
          totalStars: payload.usedVoiceAi ? prev.totalStars + payload.starsEarned : prev.totalStars,
          totalEffortStars: payload.usedVoiceAi
            ? prev.totalEffortStars
            : prev.totalEffortStars + payload.starsEarned,
          practiceDates: recordPracticeDate(prev.practiceDates, todayStr),
        };
      });
    },
    [],
  );

  const handleWordCompleted = useCallback((report: WordAttemptReport) => {
    const todayStr = getLocalDateString();
    setState((prev) => {
      const prevWordProg = prev.wordProgress[report.item.id];
      const nextWordProg = applyWordReadingAttempt(
        prevWordProg,
        report.item.id,
        report.evaluation,
        {
          todayStr,
          reactionMs: report.reactionMs,
          articulationMs: report.articulationMs,
        },
      );
      const nextWordProgress = {
        ...prev.wordProgress,
        [report.item.id]: nextWordProg,
      };
      const nextSeen = prev.seenWordIds.includes(report.item.id)
        ? prev.seenWordIds
        : [...prev.seenWordIds, report.item.id];
      const nextLatencies =
        report.latencyMs !== null
          ? [...prev.recentLatenciesMs, report.latencyMs].slice(-30)
          : prev.recentLatenciesMs;
      const nextReadingTimes = report.usedVoiceAi
        ? [...prev.recentReadingTimesMs, report.reactionMs + report.articulationMs].slice(-20)
        : prev.recentReadingTimesMs;
      const earnedVerifiedMasteryStars =
        report.usedVoiceAi && report.evaluation.status !== 'assisted';

      return {
        ...prev,
        wordProgress: nextWordProgress,
        seenWordIds: nextSeen,
        totalStars: earnedVerifiedMasteryStars
          ? prev.totalStars + report.starsEarned
          : prev.totalStars,
        totalEffortStars: earnedVerifiedMasteryStars
          ? prev.totalEffortStars
          : prev.totalEffortStars + report.starsEarned,
        practiceDates: recordPracticeDate(prev.practiceDates),
        recentLatenciesMs: nextLatencies,
        recentReadingTimesMs: nextReadingTimes,
      };
    });
  }, []);

  const handleParentVerifyWord = useCallback((wordId: string, confirmedMastered: boolean) => {
    const todayStr = getLocalDateString();
    setState((prev) => {
      const updatedProg = applyParentWordVerification(
        prev.wordProgress[wordId],
        wordId,
        confirmedMastered,
        todayStr,
      );
      return {
        ...prev,
        wordProgress: {
          ...prev.wordProgress,
          [wordId]: updatedProg,
        },
        totalStars: confirmedMastered ? prev.totalStars + 3 : prev.totalStars,
      };
    });
  }, []);

  const handleImportState = useCallback((imported: AlifboState) => {
    setState((prev) => ({
      ...imported,
      account: prev.account ?? imported.account,
      pinSalt: prev.pinHash ? prev.pinSalt : imported.pinSalt,
      pinHash: prev.pinHash ?? imported.pinHash,
      recoveryCodeHash: prev.pinHash ? prev.recoveryCodeHash : imported.recoveryCodeHash,
      pinLockout: prev.pinHash ? prev.pinLockout : imported.pinLockout,
      parentOnboardingDone: prev.parentOnboardingDone || imported.parentOnboardingDone,
    }));
  }, []);

  const exitParentAreaToChildHome = useCallback(() => {
    playFeedbackChime('pop');
    setParentUnlocked(false);
    setTab('home');
  }, []);

  const goToChildHome = useCallback(() => {
    playFeedbackChime('pop');
    setBismillahPending(false);
    if (tab === 'parent') {
      exitParentAreaToChildHome();
      return;
    }
    setTab('home');
  }, [tab, exitParentAreaToChildHome]);

  const handleOpenParentButton = () => {
    playFeedbackChime('pop');
    if (tab === 'parent') {
      exitParentAreaToChildHome();
      return;
    }
    if (parentUnlocked) {
      setTab('parent');
      return;
    }
    if (!state.parentOnboardingDone) {
      setOnboardingModal({ open: true, isReplay: false });
      return;
    }
    setPinModalOpen(true);
  };

  const handleUpdateProfile = useCallback((profile: ChildProfileData) => {
    setState((prev) => ({ ...prev, profile }));
  }, []);

  const handleSignOut = useCallback(() => {
    const wasPermanentRemote = remoteSessionActive && !isGuestAccount(state.account);
    const snapshotToFlush = state;
    setParentUnlocked(false);
    setPinModalOpen(false);
    setOnboardingModal({ open: false, isReplay: false });
    setEditingSurvey(false);
    setUpgradeAuthOpen(false);
    setPinResetAuthOpen(false);
    setRemoteSessionActive(false);
    setAuthUrlError(null);
    setBismillahPending(false);
    setTab('home');
    setGateView({ screen: 'welcome' });
    clearGuestMigrationSnapshot();
    clearPendingPinReset();
    setState(createInitialState());
    if (wasPermanentRemote) {
      void saveRemoteState(snapshotToFlush).finally(() => {
        void logoutRemoteSession();
      });
    } else {
      void logoutRemoteSession();
    }
  }, [remoteSessionActive, state]);

  const handleStartGuestTrial = useCallback(() => {
    const nowIso = new Date().toISOString();
    setUpgradeAuthOpen(false);
    setState((prev) => ({
      ...prev,
      account: {
        id: GUEST_TRIAL_ACCOUNT_ID,
        isGuest: true,
        publicId: undefined,
        contact: 'Sinov rejimi',
        createdAt: nowIso,
        signedInAt: nowIso,
      },
      progressOwnerId: GUEST_TRIAL_ACCOUNT_ID,
      pendingRemoteSync: false,
      profile: {
        ...prev.profile,
        name: prev.profile.name || 'Bolajon',
        avatarId: prev.profile.avatarId || 'fox',
      },
    }));
    setTab('home');
  }, []);

  const handleAuthenticatedSuccess = useCallback(
    (payload: {
      session: NonNullable<AlifboState['account']>;
      childName: string;
      avatarId: string;
      isNewSignup: boolean;
      remoteState?: unknown | null;
      isRemote?: boolean;
    }) => {
      const { session, childName, avatarId, isNewSignup, remoteState, isRemote } = payload;
      setAuthUrlError(null);
      setUpgradeAuthOpen(false);
      clearGuestMigrationSnapshot();

      const normalizedSession = {
        ...session,
        isGuest: false,
        publicId: isValidAccountPublicId(session.publicId)
          ? session.publicId
          : generateAccountPublicId(),
      };

      const hydrated = isRemote ? hydrateAlifboState(remoteState) : null;
      if (isRemote) {
        setRemoteSessionActive(true);
      } else {
        setRemoteSessionActive(false);
      }

      setState((prev) => {
        const guestSource =
          isGuestAccount(prev.account) || prev.progressOwnerId === GUEST_TRIAL_ACCOUNT_ID
            ? prev
            : null;
        if (isRemote && !guestSource && !hydrated) {
          skipNextRemoteSyncRef.current = true;
          const fresh = createInitialState();
          return {
            ...fresh,
            account: normalizedSession,
            progressOwnerId: normalizedSession.id,
            pendingRemoteSync: false,
            profile: {
              ...fresh.profile,
              name: childName || fresh.profile.name,
              avatarId: avatarId || fresh.profile.avatarId,
            },
            surveyData: isNewSignup ? null : fresh.surveyData,
          };
        }
        const merged = mergeAlifboStates({
          remoteState: hydrated,
          guestState: guestSource,
          session: normalizedSession,
          childName,
          avatarId,
        });
        if (!merged.state.pendingRemoteSync && isRemote) {
          skipNextRemoteSyncRef.current = true;
        }
        return merged.state;
      });
      setTab('home');
    },
    [],
  );

  const isGuest = isGuestAccount(state.account);
  const displayPublicId = getDisplayablePublicId(state.account);

  const totalStarsAll = state.totalStars + state.totalEffortStars;
  const masteredWordsCount = useMemo(
    () =>
      DYNAMIC_WORD_POOL.filter((item) => state.wordProgress[item.id]?.status === 'mastered')
        .length,
    [state.wordProgress],
  );
  const activeRoundWorld =
    READING_WORLDS.find((w) => w.worldId === roundWorldId) ?? READING_WORLDS[0]!;

  // Gate 1: Welcome / Auth Screen before onboarding or main app renders
  if (state.account === null) {
    if (gateView.screen === 'welcome') {
      return (
        <WelcomeScreen
          onStartFree={() => setGateView({ screen: 'auth', mode: 'signup' })}
          onTryNow={handleStartGuestTrial}
          onLogin={() => setGateView({ screen: 'auth', mode: 'login' })}
          onOpenParents={() => setGateView({ screen: 'auth', mode: 'login' })}
        />
      );
    }

    return (
      <Suspense fallback={<ScreenLoadingFallback />}>
        <LazyAuthScreen
          initialMode={gateView.mode}
          initialError={authUrlError}
          onBackToWelcome={() => {
            setAuthUrlError(null);
            setGateView({ screen: 'welcome' });
          }}
          onAuthenticated={handleAuthenticatedSuccess}
        />
      </Suspense>
    );
  }

  // Re-authentication flow for a registered account to reset forgotten PIN without losing progress
  if (pinResetAuthOpen && !isGuest && state.account !== null) {
    const currentAcc = state.account;
    return (
      <Suspense fallback={<ScreenLoadingFallback />}>
        <LazyAuthScreen
          initialMode="login"
          initialError={authUrlError}
          backButtonLabelUz="Bolalar ekraniga qaytish"
          onBeforeExternalRedirect={() => stagePendingPinReset(currentAcc.id)}
          onBackToWelcome={() => {
            clearPendingPinReset();
            setAuthUrlError(null);
            setPinResetAuthOpen(false);
          }}
          onAuthenticated={(payload) => {
            if (payload.session.id !== currentAcc.id) {
              setAuthUrlError(
                `PIN-kodni tiklash uchun aynan joriy hisobingiz (${currentAcc.contact}) bilan kiring.`,
              );
              return;
            }
            clearPendingPinReset();
            setPinResetAuthOpen(false);
            handleAuthenticatedSuccess(payload);
            setState((prev) => ({
              ...prev,
              pinSalt: null,
              pinHash: null,
              recoveryCodeHash: null,
              pinLockout: clearPinLockout(),
            }));
            setPinModalOpen(true);
          }}
        />
      </Suspense>
    );
  }

  // Upgrade modal/screen from Guest Trial -> Permanent Account without losing current progress
  if (upgradeAuthOpen && isGuest) {
    return (
      <Suspense fallback={<ScreenLoadingFallback />}>
        <LazyAuthScreen
          initialMode="signup"
          initialError={authUrlError}
          isGuestUpgrade
          defaultChildName={state.profile.name}
          defaultAvatarId={state.profile.avatarId}
          backButtonLabelUz="Sinov rejimiga qaytish"
          onBeforeExternalRedirect={() => stageGuestMigrationSnapshot(state)}
          onBackToWelcome={() => {
            setAuthUrlError(null);
            setUpgradeAuthOpen(false);
          }}
          onAuthenticated={handleAuthenticatedSuccess}
        />
      </Suspense>
    );
  }

  // Gate 2: Full-screen 4-step Onboarding before ChildHome renders
  if (state.surveyData === null || editingSurvey) {
    return (
      <Suspense fallback={<ScreenLoadingFallback />}>
        <LazyOnboardingSurveyPage
          childName={state.profile.name}
          avatarId={state.profile.avatarId}
          publicId={displayPublicId}
          isGuest={isGuest}
          initialSurvey={editingSurvey ? state.surveyData : null}
          onComplete={({ surveyData, recommendedWorldId }) => {
            setEditingSurvey(false);
            setRoundWorldId(recommendedWorldId);
            setState((prev) => ({
              ...prev,
              surveyData,
              dailyLimitMinutes: surveyData.dailyLimitMinutes,
              activeWorldId: recommendedWorldId,
            }));
          }}
          onCancelEdit={() => {
            if (editingSurvey && state.surveyData !== null) {
              setEditingSurvey(false);
              return;
            }
            if (state.account?.id === GUEST_TRIAL_ACCOUNT_ID) {
              setGateView({ screen: 'welcome' });
              setState((prev) => ({ ...prev, account: null, progressOwnerId: null }));
              return;
            }
            handleSignOut();
            setGateView({ screen: 'auth', mode: 'signup' });
          }}
        />
      </Suspense>
    );
  }

  // Immersive full-screen Lesson view (Mockups 07, 08, 09, 10, 12)
  if (tab === 'lesson') {
    if (bismillahPending && state.bismillahAlhamdulillahEnabled) {
      return (
        <BismillahStartCard
          key={`bismillah-${lessonSessionKey}`}
          avatarId={state.profile.avatarId}
          worldTitle={activeRoundWorld.titleUz}
          aiOnline={aiOnline}
          onContinue={() => setBismillahPending(false)}
          onBack={goToChildHome}
        />
      );
    }

    return (
      <Suspense fallback={<ScreenLoadingFallback />}>
        <LazyLessonPlayer
          key={lessonSessionKey}
          sessionItems={sessionItems}
          wordProgressMap={state.wordProgress}
          worldTitle={activeRoundWorld.titleUz}
          avatarId={state.profile.avatarId}
          aiOnline={aiOnline}
          bismillahAlhamdulillahEnabled={state.bismillahAlhamdulillahEnabled}
          completedSessionsCount={state.completedSessionsCount}
          firstSessionFeedbackPrompted={state.firstSessionFeedbackPrompted}
          childName={state.profile.name}
          publicId={displayPublicId}
          isGuest={isGuest}
          onLetterHintTap={handleLetterHintTap}
          onWordCompleted={handleWordCompleted}
          onRoundFinished={handleRoundFinished}
          onFirstSessionFeedbackPrompted={() =>
            setState((prev) => ({ ...prev, firstSessionFeedbackPrompted: true }))
          }
          onPlayAnotherRound={() =>
            startWorldRound(
              roundWorldId,
              sessionItems.map((entry) => entry.item.id),
            )
          }
          onBack={goToChildHome}
        />
      </Suspense>
    );
  }

  // Full-screen Uzbek Alphabet 29-letter chart & game view (Mockup 06)
  if (tab === 'alphabet') {
    return (
      <Suspense fallback={<ScreenLoadingFallback />}>
        <LazyAlphabetRecallDrawer
          letterHintCounts={state.letterHintCounts}
          letterMastery={state.letterMastery}
          avatarId={state.profile.avatarId}
          aiOnline={aiOnline}
          totalStars={totalStarsAll}
          onLetterHintTap={handleLetterHintTap}
          onLetterReviewed={handleLetterReviewed}
          onClose={() => setTab('home')}
        />
      </Suspense>
    );
  }

  // Full-screen Parent Corner view (Mockup 11)
  if (tab === 'parent' && parentUnlocked) {
    return (
      <Suspense fallback={<ScreenLoadingFallback />}>
        <LazyParentCorner
          state={state}
          aiOnline={aiOnline}
          screenTime={screenTime}
          onExitToChildHome={exitParentAreaToChildHome}
          onUpdateProfile={handleUpdateProfile}
          onUpdateDailyLimit={(minutes) =>
            setState((prev) => ({ ...prev, dailyLimitMinutes: clampDailyLimitMinutes(minutes) }))
          }
          onUpdateActiveWorld={(worldId) =>
            setState((prev) => ({ ...prev, activeWorldId: worldId }))
          }
          onResetTodayTimer={() =>
            setState((prev) => ({
              ...prev,
              dailyPracticeDate: getLocalDateString(),
              todayPracticedSeconds: 0,
            }))
          }
          onOpenSurvey={() => setEditingSurvey(true)}
          onReplayOnboarding={() => setOnboardingModal({ open: true, isReplay: true })}
          onUpdatePinHash={(newHash, lockout) =>
            setState((prev) => ({ ...prev, pinHash: newHash, pinLockout: lockout }))
          }
          onUpdateLockout={(lockout) => setState((prev) => ({ ...prev, pinLockout: lockout }))}
          onParentVerifyWord={handleParentVerifyWord}
          onImportState={handleImportState}
          onToggleBismillahAlhamdulillah={(enabled) =>
            setState((prev) => ({ ...prev, bismillahAlhamdulillahEnabled: enabled }))
          }
          onResetProgress={() => {
            setState((prev) => ({
              ...createInitialState(),
              account: prev.account,
              profile: prev.profile,
              pinSalt: prev.pinSalt,
              pinHash: prev.pinHash,
              recoveryCodeHash: prev.recoveryCodeHash,
              dailyLimitMinutes: prev.dailyLimitMinutes,
              surveyData: prev.surveyData,
              parentOnboardingDone: prev.parentOnboardingDone,
              bismillahAlhamdulillahEnabled: prev.bismillahAlhamdulillahEnabled,
              firstSessionFeedbackPrompted: prev.firstSessionFeedbackPrompted,
            }));
          }}
          onSignOut={handleSignOut}
          onOpenGuestUpgrade={() => setUpgradeAuthOpen(true)}
          onMarkNotificationsRead={(ids) => {
            setState((prev) => ({
              ...prev,
              readNotificationIds: Array.from(new Set([...prev.readNotificationIds, ...ids])),
            }));
          }}
        />
      </Suspense>
    );
  }

  // Child Home Screen (Mockup 04 & Mobile Phone 1)
  return (
    <div className="app-shell">
      <StorybookBackdrop />

      <header className="app-header">
        <div className="app-header-left">
          <button type="button" className="brand" onClick={goToChildHome} aria-label="Alifbo Bosh sahifa">
            <img src="/images/logo.webp" alt="Alifbo" className="brand-logo-img" draggable={false} />
          </button>

          <span className="stars-pill-3d" aria-label="Jami yulduzlar">
            <Star size={18} fill="#F59E0B" color="#B45309" />
            <span>{totalStarsAll}</span>
          </span>

          <button
            type="button"
            className="abc-pill-3d nav-btn btn-hear-child"
            onClick={() => {
              playFeedbackChime('pop');
              setTab('alphabet');
            }}
            aria-label="O‘zbek Alifbosi — 29 ta harf"
          >
            <span className="abc-letter abc-a">A</span>
            <span className="abc-letter abc-b">B</span>
            <span className="abc-letter abc-c">C</span>
          </button>
        </div>

        <button
          type="button"
          className="btn-3d-cream btn-compact btn-with-icon nav-btn"
          onClick={handleOpenParentButton}
        >
          <span>Ota-onalar</span>
          <Lock size={15} color="#D97706" />
        </button>
      </header>

      {loaded.recoveredCorruptData && (
        <div className="corrupt-banner">
          Saqlangan ma’lumot buzilgani uchun zaxiraga olindi va ilova yangidan boshlandi.
        </div>
      )}

      <main className="app-main">
        <ChildHome
          childName={state.profile.name}
          avatarId={state.profile.avatarId}
          publicId={displayPublicId}
          isGuest={isGuest}
          onOpenGuestUpgrade={() => setUpgradeAuthOpen(true)}
          seenWordIds={state.seenWordIds}
          masteredWordsCount={masteredWordsCount}
          activeWorldId={state.activeWorldId}
          screenTime={screenTime}
          onStartWorldRound={startWorldRound}
          onOpenAlphabetRecall={() => setTab('alphabet')}
        />
      </main>

      {onboardingModal.open && (
        <Suspense fallback={<ScreenLoadingFallback />}>
          <LazyParentOnboardingModal
            unverifiedCap={state.unverifiedCap}
            isReplay={onboardingModal.isReplay}
            onComplete={() => {
              const wasReplay = onboardingModal.isReplay;
              setOnboardingModal({ open: false, isReplay: false });
              if (!wasReplay) {
                setState((prev) => ({ ...prev, parentOnboardingDone: true }));
                setPinModalOpen(true);
              }
            }}
            onClose={() => setOnboardingModal({ open: false, isReplay: false })}
          />
        </Suspense>
      )}

      {pinModalOpen && (
        <Suspense fallback={<ScreenLoadingFallback />}>
          <LazyPinModal
            pinSalt={state.pinSalt}
            existingPinHash={state.pinHash}
            recoveryCodeHash={state.recoveryCodeHash}
            lockout={state.pinLockout}
            isGuest={isGuest}
            accountContact={state.account?.contact}
            onRequestAccountReauth={() => {
              if (state.account && !isGuest) {
                stagePendingPinReset(state.account.id);
                setPinModalOpen(false);
                setPinResetAuthOpen(true);
              }
            }}
            onCreatePin={({ salt, pinHash, recoveryCodeHash }) =>
              setState((prev) => ({
                ...prev,
                pinSalt: salt,
                pinHash,
                recoveryCodeHash,
                pinLockout: clearPinLockout(),
              }))
            }
            onUpdatePinAfterRecovery={(newPinHash, lockout) =>
              setState((prev) => ({
                ...prev,
                pinHash: newPinHash,
                pinLockout: lockout,
              }))
            }
            onUpdateLockout={(lockout) => setState((prev) => ({ ...prev, pinLockout: lockout }))}
            onEraseAllProgressAndResetPin={() => {
              if (!isGuest) return;
              setParentUnlocked(false);
              setState(createInitialState());
            }}
            onUnlocked={() => {
              setPinModalOpen(false);
              setParentUnlocked(true);
              setTab('parent');
            }}
            onClose={() => setPinModalOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
}

export default App;
