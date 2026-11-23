import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DYNAMIC_WORD_POOL,
  READING_WORLDS,
} from './data/curriculum';
import { applyLetterReviewResult } from './logic/alphabetReview';
import { startAsrHealthPolling } from './logic/asrHealth';
import {
  fetchCurrentSession,
  generateAccountPublicId,
  isValidAccountPublicId,
  logoutRemoteSession,
  saveRemoteState,
} from './logic/auth';
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
  createDefaultProfile,
  createInitialState,
  getLocalDateString,
  hydrateAlifboState,
  loadAlifboState,
  recordPracticeDate,
  saveAlifboState,
  type AlifboState,
  type ChildProfileData,
} from './storage/progressStorage';
import { AlphabetRecallDrawer } from './components/AlphabetRecallDrawer';
import { AuthScreen } from './components/AuthScreen';
import { BismillahStartCard } from './components/BismillahAlhamdulillah';
import { ChildHome } from './components/ChildHome';
import { Lock, Star } from './components/Icons';
import { LessonPlayer, type WordAttemptReport } from './components/LessonPlayer';
import { OnboardingSurveyPage } from './components/OnboardingSurveyPage';
import { ParentCorner } from './components/ParentCorner';
import { ParentOnboardingModal } from './components/ParentOnboardingModal';
import { PinModal } from './components/PinModal';
import { StorybookBackdrop } from './components/StorybookBackdrop';
import { WelcomeScreen } from './components/WelcomeScreen';
import { playFeedbackChime } from './utils/audioRecorder';

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

  useEffect(() => {
    saveAlifboState(state);
  }, [state]);

  // Restore remote session from HttpOnly cookie + handle OAuth redirect callbacks
  useEffect(() => {
    let active = true;
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
          publicId: isValidAccountPublicId(res.session.publicId)
            ? res.session.publicId
            : generateAccountPublicId(),
        };
        setRemoteSessionActive(true);
        setAuthUrlError(null);
        const hydrated = hydrateAlifboState(res.state);
        skipNextRemoteSyncRef.current = true;
        setState((prev) => {
          if (hydrated) {
            return {
              ...hydrated,
              account: remoteSession,
              profile: {
                ...hydrated.profile,
                name: res.childName || hydrated.profile.name,
                avatarId: res.avatarId || hydrated.profile.avatarId,
              },
            };
          }
          if (prev.account && prev.account.id === remoteSession.id) {
            return {
              ...prev,
              account: remoteSession,
              profile: {
                ...prev.profile,
                name: res.childName || prev.profile.name,
                avatarId: res.avatarId || prev.profile.avatarId,
              },
            };
          }
          return {
            ...createInitialState(),
            account: remoteSession,
            profile: {
              ...createDefaultProfile(),
              name: res.childName || 'Bolajon',
              avatarId: res.avatarId || 'fox',
            },
            surveyData: null,
          };
        });
      }
    });

    return () => {
      active = false;
    };
  }, []);

  // Debounced sync of authenticated state to Neon Postgres
  useEffect(() => {
    if (!remoteSessionActive || !state.account || state.account.id === 'guest_trial') {
      return;
    }
    if (skipNextRemoteSyncRef.current) {
      skipNextRemoteSyncRef.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      void saveRemoteState(state);
    }, 1500);
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

  // Track healthy daily screen-time while child is playing a reading round
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
    setParentUnlocked(false);
    setPinModalOpen(false);
    setOnboardingModal({ open: false, isReplay: false });
    setEditingSurvey(false);
    setRemoteSessionActive(false);
    setAuthUrlError(null);
    setBismillahPending(false);
    setTab('home');
    setGateView({ screen: 'welcome' });
    setState((prev) => ({ ...prev, account: null }));
    void logoutRemoteSession();
  }, []);

  const handleStartGuestTrial = useCallback(() => {
    const nowIso = new Date().toISOString();
    setState((prev) => ({
      ...prev,
      account: {
        id: 'guest_trial',
        publicId: isValidAccountPublicId(prev.account?.publicId)
          ? prev.account.publicId
          : generateAccountPublicId(),
        contact: 'Sinov rejimi',
        createdAt: nowIso,
        signedInAt: nowIso,
      },
      profile: {
        ...prev.profile,
        name: prev.profile.name || 'Bolajon',
        avatarId: prev.profile.avatarId || 'fox',
      },
    }));
    setTab('home');
  }, []);

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
      <AuthScreen
        initialMode={gateView.mode}
        initialError={authUrlError}
        onBackToWelcome={() => {
          setAuthUrlError(null);
          setGateView({ screen: 'welcome' });
        }}
        onAuthenticated={({
          session,
          childName,
          avatarId,
          isNewSignup,
          remoteState,
          isRemote,
        }) => {
          setAuthUrlError(null);
          if (isRemote) {
            setRemoteSessionActive(true);
            skipNextRemoteSyncRef.current = true;
          } else {
            setRemoteSessionActive(false);
          }

          const normalizedSession = {
            ...session,
            publicId: isValidAccountPublicId(session.publicId)
              ? session.publicId
              : generateAccountPublicId(),
          };

          const hydrated = isRemote ? hydrateAlifboState(remoteState) : null;
          setState((prev) => {
            if (hydrated) {
              return {
                ...hydrated,
                account: normalizedSession,
                profile: {
                  ...hydrated.profile,
                  name: childName || hydrated.profile.name,
                  avatarId: avatarId || hydrated.profile.avatarId,
                },
              };
            }
            const isSameAccount = prev.account?.id === normalizedSession.id;
            const base = isRemote && !isSameAccount ? createInitialState() : prev;
            return {
              ...base,
              account: normalizedSession,
              profile: {
                ...base.profile,
                name: childName || base.profile.name,
                avatarId: avatarId || base.profile.avatarId,
              },
              surveyData: isNewSignup ? null : base.surveyData,
            };
          });
          setTab('home');
        }}
      />
    );
  }

  // Gate 2: Full-screen 4-step Onboarding before ChildHome renders
  if (state.surveyData === null || editingSurvey) {
    return (
      <OnboardingSurveyPage
        childName={state.profile.name}
        avatarId={state.profile.avatarId}
        publicId={state.account?.publicId}
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
          if (state.account?.id === 'guest_trial') {
            setGateView({ screen: 'welcome' });
            setState((prev) => ({ ...prev, account: null }));
            return;
          }
          handleSignOut();
          setGateView({ screen: 'auth', mode: 'signup' });
        }}
      />
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
          onContinue={() => setBismillahPending(false)}
          onBack={goToChildHome}
        />
      );
    }

    return (
      <LessonPlayer
        key={lessonSessionKey}
        sessionItems={sessionItems}
        wordProgressMap={state.wordProgress}
        worldTitle={activeRoundWorld.titleUz}
        avatarId={state.profile.avatarId}
        aiOnline={aiOnline}
        bismillahAlhamdulillahEnabled={state.bismillahAlhamdulillahEnabled}
        completedSessionsCount={state.completedSessionsCount}
        childName={state.profile.name}
        publicId={state.account?.publicId}
        onLetterHintTap={handleLetterHintTap}
        onWordCompleted={handleWordCompleted}
        onRoundFinished={handleRoundFinished}
        onPlayAnotherRound={() =>
          startWorldRound(
            roundWorldId,
            sessionItems.map((entry) => entry.item.id),
          )
        }
        onBack={goToChildHome}
      />
    );
  }

  // Full-screen Uzbek Alphabet 29-letter chart & game view (Mockup 06)
  if (tab === 'alphabet') {
    return (
      <AlphabetRecallDrawer
        letterHintCounts={state.letterHintCounts}
        letterMastery={state.letterMastery}
        avatarId={state.profile.avatarId}
        aiOnline={aiOnline}
        totalStars={totalStarsAll}
        onLetterHintTap={handleLetterHintTap}
        onLetterReviewed={handleLetterReviewed}
        onClose={() => setTab('home')}
      />
    );
  }

  // Full-screen Parent Corner view (Mockup 11)
  if (tab === 'parent' && parentUnlocked) {
    return (
      <ParentCorner
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
          }));
        }}
        onSignOut={handleSignOut}
      />
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
          publicId={state.account?.publicId}
          seenWordIds={state.seenWordIds}
          masteredWordsCount={masteredWordsCount}
          activeWorldId={state.activeWorldId}
          screenTime={screenTime}
          onStartWorldRound={startWorldRound}
          onOpenAlphabetRecall={() => setTab('alphabet')}
        />
      </main>

      {onboardingModal.open && (
        <ParentOnboardingModal
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
      )}

      {pinModalOpen && (
        <PinModal
          pinSalt={state.pinSalt}
          existingPinHash={state.pinHash}
          recoveryCodeHash={state.recoveryCodeHash}
          lockout={state.pinLockout}
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
      )}
    </div>
  );
}

export default App;
