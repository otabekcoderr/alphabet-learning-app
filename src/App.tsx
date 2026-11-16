import { useCallback, useEffect, useMemo, useState } from 'react';
import { CURRICULUM_ITEMS, type CurriculumItem } from './data/curriculum';
import { calculateTotalXp, getAvatarOption } from './logic/gamification';
import {
  isParentSessionExpired,
  PARENT_SESSION_TIMEOUT_MS,
  shouldCloseParentSessionOnEvent,
} from './logic/parentSession';
import {
  applyUnverifiedAttempt,
  applyVerifiedCompletion,
  getNextRecommendedItem,
  getReviewQueue,
  isBlockedByUnverifiedCap,
} from './logic/pedagogy';
import { clearPinLockout } from './logic/pin';
import {
  createInitialState,
  loadAlifboState,
  recordPracticeDate,
  saveAlifboState,
  type AlifboState,
  type ChildProfileData,
} from './storage/progressStorage';
import { ChildHome } from './components/ChildHome';
import { ChildProfile } from './components/ChildProfile';
import { LessonPlayer } from './components/LessonPlayer';
import { ParentCorner } from './components/ParentCorner';
import { PinModal } from './components/PinModal';

type ViewTab = 'home' | 'profile' | 'lesson' | 'parent';

export function App() {
  const [loaded] = useState(() => loadAlifboState());
  const [state, setState] = useState<AlifboState>(loaded.state);
  const [tab, setTab] = useState<ViewTab>('home');
  const [activeItem, setActiveItem] = useState<CurriculumItem | null>(null);
  const [aiOnline, setAiOnline] = useState<boolean>(false);
  const [pinModalOpen, setPinModalOpen] = useState<boolean>(false);
  const [parentUnlocked, setParentUnlocked] = useState<boolean>(false);

  // Ephemeral in-memory only; never persisted in localStorage.
  const [parentSessionActive, setParentSessionActive] = useState<boolean>(false);
  const [parentSessionLastActiveMs, setParentSessionLastActiveMs] = useState<number | null>(null);

  useEffect(() => {
    saveAlifboState(state);
  }, [state]);

  useEffect(() => {
    let active = true;
    const checkHealth = async () => {
      try {
        const res = await fetch('/api/health');
        const data = (await res.json()) as { ok?: boolean };
        if (active) setAiOnline(Boolean(res.ok && data.ok));
      } catch {
        if (active) setAiOnline(false);
      }
    };
    void checkHealth();
    const timer = window.setInterval(() => void checkHealth(), 10_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const closeParentSession = useCallback(() => {
    setParentSessionActive(false);
    setParentSessionLastActiveMs(null);
  }, []);

  useEffect(() => {
    if (!parentSessionActive) return;

    const refreshActivity = () => {
      setParentSessionLastActiveMs(Date.now());
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden' && shouldCloseParentSessionOnEvent('visibility_hidden')) {
        closeParentSession();
      }
    };

    const handleBlur = () => {
      if (shouldCloseParentSessionOnEvent('window_blur')) {
        closeParentSession();
      }
    };

    const timer = window.setInterval(() => {
      if (isParentSessionExpired(parentSessionLastActiveMs, Date.now(), PARENT_SESSION_TIMEOUT_MS)) {
        closeParentSession();
      }
    }, 5_000);

    window.addEventListener('pointerdown', refreshActivity);
    window.addEventListener('keydown', refreshActivity);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pointerdown', refreshActivity);
      window.removeEventListener('keydown', refreshActivity);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [parentSessionActive, parentSessionLastActiveMs, closeParentSession]);

  const reviewQueue = useMemo(() => getReviewQueue(CURRICULUM_ITEMS, state.progressByItem), [state.progressByItem]);
  const blockedByUnverifiedCap = useMemo(
    () => isBlockedByUnverifiedCap(CURRICULUM_ITEMS, state.progressByItem),
    [state.progressByItem],
  );
  const recommendedItem = useMemo(
    () => getNextRecommendedItem(CURRICULUM_ITEMS, state.progressByItem),
    [state.progressByItem],
  );

  const handleSelectItem = useCallback((item: CurriculumItem) => {
    setActiveItem(item);
    setTab('lesson');
  }, []);

  const handleVerifiedComplete = useCallback(
    (payload: {
      itemId: string;
      starsEarned: number;
      voiceAttemptsDelta: number;
      parentVerified: boolean;
      latencyMs: number | null;
    }) => {
      setState((prev) => {
        const { itemProgress, starsDelta } = applyVerifiedCompletion(prev.progressByItem[payload.itemId], {
          ...payload,
          nowIso: new Date().toISOString(),
        });
        const nextLatencies =
          payload.latencyMs !== null
            ? [...prev.recentLatenciesMs, payload.latencyMs].slice(-30)
            : prev.recentLatenciesMs;

        return {
          ...prev,
          totalStars: prev.totalStars + starsDelta,
          practiceDates: recordPracticeDate(prev.practiceDates),
          recentLatenciesMs: nextLatencies,
          progressByItem: {
            ...prev.progressByItem,
            [payload.itemId]: itemProgress,
          },
        };
      });

      if (payload.parentVerified && shouldCloseParentSessionOnEvent('lesson_completed')) {
        closeParentSession();
      }
    },
    [closeParentSession],
  );

  const handleUnverifiedComplete = useCallback(
    (itemId: string) => {
      let nextRecommended: CurriculumItem | null = null;
      let nextBlocked = false;

      setState((prev) => {
        const { itemProgress, effortStarsDelta } = applyUnverifiedAttempt(
          prev.progressByItem[itemId],
          itemId,
          new Date().toISOString(),
        );
        const nextProgressMap = {
          ...prev.progressByItem,
          [itemId]: itemProgress,
        };
        nextBlocked = isBlockedByUnverifiedCap(CURRICULUM_ITEMS, nextProgressMap);
        nextRecommended = getNextRecommendedItem(CURRICULUM_ITEMS, nextProgressMap);

        return {
          ...prev,
          totalEffortStars: prev.totalEffortStars + effortStarsDelta,
          practiceDates: recordPracticeDate(prev.practiceDates),
          progressByItem: nextProgressMap,
        };
      });

      if (shouldCloseParentSessionOnEvent('lesson_completed')) {
        closeParentSession();
      }

      if (nextBlocked || !nextRecommended) {
        setTab('home');
      } else {
        setActiveItem(nextRecommended);
      }
    },
    [closeParentSession],
  );

  const handleConfirmUnverified = useCallback((itemId: string) => {
    setState((prev) => {
      const { itemProgress, starsDelta } = applyVerifiedCompletion(prev.progressByItem[itemId], {
        itemId,
        starsEarned: 3,
        voiceAttemptsDelta: 0,
        parentVerified: true,
        latencyMs: null,
        nowIso: new Date().toISOString(),
      });
      return {
        ...prev,
        totalStars: prev.totalStars + starsDelta,
        practiceDates: recordPracticeDate(prev.practiceDates),
        progressByItem: {
          ...prev.progressByItem,
          [itemId]: itemProgress,
        },
      };
    });
  }, []);

  const handleOpenParentButton = () => {
    if (parentUnlocked) {
      setTab(tab === 'parent' ? 'home' : 'parent');
    } else {
      setPinModalOpen(true);
    }
  };

  const handleUpdateProfile = useCallback((profile: ChildProfileData) => {
    setState((prev) => ({ ...prev, profile }));
  }, []);

  const switchChildTab = (nextTab: 'home' | 'profile') => {
    if (tab === 'lesson' && shouldCloseParentSessionOnEvent('lesson_exited')) {
      closeParentSession();
    }
    setTab(nextTab);
  };

  const activeIndex = activeItem ? CURRICULUM_ITEMS.findIndex((i) => i.id === activeItem.id) : -1;
  const nextItem =
    activeIndex >= 0 && activeIndex + 1 < CURRICULUM_ITEMS.length
      ? (CURRICULUM_ITEMS[activeIndex + 1] ?? null)
      : null;
  const totalXp = calculateTotalXp(state.totalStars, state.totalEffortStars);
  const activeAvatar = getAvatarOption(state.profile.avatarId);

  return (
    <div className="app-shell">
      <header className="app-header">
        <button
          type="button"
          className="brand"
          onClick={() => switchChildTab('home')}
        >
          <span className="brand-logo" aria-hidden="true">
            <span className="char-vowel">A</span>
            <span className="char-consonant">B</span>
          </span>
          <span className="brand-text">
            <strong>Alifbo</strong>
            <span className="brand-sub">Harflar va bo‘g‘inlar mashqlari</span>
          </span>
        </button>

        <div className="header-controls">
          <span className="streak-badge" aria-label="Mashg'ulot kunlari">
            🔥 {state.practiceDates.length}
          </span>
          <span className="xp-header-badge" aria-label="Jami XP ballar">
            ⚡ {totalXp} XP
          </span>
          <span className="stars-badge" aria-label="O'zlashtirish yulduzlari">
            ⭐ {state.totalStars}
          </span>

          <nav className="primary-nav" aria-label="Asosiy bo‘limlar">
            <button
              type="button"
              className={`nav-btn ${tab === 'home' ? 'nav-active' : ''}`}
              onClick={() => switchChildTab('home')}
            >
              🗺️ Xarita
            </button>
            <button
              type="button"
              className={`nav-btn ${tab === 'profile' ? 'nav-active' : ''}`}
              onClick={() => switchChildTab('profile')}
            >
              <span aria-hidden="true">{activeAvatar.emoji}</span> Profil
            </button>
            <button
              type="button"
              className={`nav-btn ${tab === 'parent' ? 'nav-active-parent' : ''}`}
              onClick={handleOpenParentButton}
            >
              {tab === 'parent' ? '🏠 Bolalar' : '🔒 Ota-ona'}
            </button>
          </nav>
        </div>
      </header>

      {loaded.recoveredCorruptData && (
        <div className="corrupt-banner">
          Saqlangan ma’lumot buzilgani uchun zaxiraga olindi va ilova yangidan boshlandi.
        </div>
      )}

      <main className="app-main">
        {tab === 'home' && (
          <ChildHome
            recommendedItem={recommendedItem}
            progressByItem={state.progressByItem}
            totalStars={state.totalStars}
            totalEffortStars={state.totalEffortStars}
            dailyGoalXp={state.profile.dailyGoalXp}
            childName={state.profile.name}
            streakDays={state.practiceDates.length}
            blockedByUnverifiedCap={blockedByUnverifiedCap}
            parentSessionActive={parentSessionActive}
            onStartLesson={handleSelectItem}
            onExitParentSession={closeParentSession}
          />
        )}

        {tab === 'profile' && (
          <ChildProfile
            state={state}
            onUpdateProfile={handleUpdateProfile}
            onStartLesson={handleSelectItem}
          />
        )}

        {tab === 'lesson' && activeItem && (
          <LessonPlayer
            item={activeItem}
            parentSessionActive={parentSessionActive}
            aiOnline={aiOnline}
            onBack={() => switchChildTab('home')}
            onVerifiedComplete={handleVerifiedComplete}
            onUnverifiedComplete={handleUnverifiedComplete}
            onNextItem={() => {
              if (nextItem && !blockedByUnverifiedCap) {
                setActiveItem(nextItem);
              } else {
                setTab('home');
              }
            }}
            hasNextItem={Boolean(nextItem) && !blockedByUnverifiedCap}
          />
        )}

        {tab === 'parent' && parentUnlocked && (
          <ParentCorner
            state={state}
            aiOnline={aiOnline}
            parentSessionActive={parentSessionActive}
            reviewQueue={reviewQueue}
            onToggleParentSession={() => {
              if (parentSessionActive) {
                closeParentSession();
              } else {
                setParentSessionActive(true);
                setParentSessionLastActiveMs(Date.now());
              }
            }}
            onConfirmUnverified={handleConfirmUnverified}
            onSelectItem={handleSelectItem}
            onStartReview={() => {
              if (reviewQueue[0]) handleSelectItem(reviewQueue[0]);
            }}
            onUpdatePinHash={(newHash, lockout) =>
              setState((prev) => ({ ...prev, pinHash: newHash, pinLockout: lockout }))
            }
            onUpdateLockout={(lockout) => setState((prev) => ({ ...prev, pinLockout: lockout }))}
            onResetProgress={() => {
              closeParentSession();
              setState((prev) => ({
                ...createInitialState(),
                profile: prev.profile,
                pinSalt: prev.pinSalt,
                pinHash: prev.pinHash,
                recoveryCodeHash: prev.recoveryCodeHash,
              }));
            }}
            onLockParentArea={() => {
              setParentUnlocked(false);
              setTab('home');
            }}
          />
        )}
      </main>

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
            closeParentSession();
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
