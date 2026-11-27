import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { motion } from 'framer-motion';
import { ASSET_LICENSE_MANIFEST } from '../data/assetManifest';
import {
  ALIFBE_LETTERS_29,
  DYNAMIC_WORD_POOL,
  formatGraphemeForScript,
  READING_WORLDS,
} from '../data/curriculum';
import { getAlphabetMasterySummary } from '../logic/alphabetReview';
import { getDisplayablePublicId, isGuestAccount } from '../logic/auth';
import { getOnboardingOptionLabels } from '../logic/onboarding';
import {
  buildParentNotifications,
  fetchNotificationsData,
  saveReminderSettingsApi,
  type AppNotificationAction,
  type RemoteReminderSettings,
  type ServerNotificationDto,
} from '../logic/notifications';
import {
  AVATAR_OPTIONS,
  buildWeekStreakDays,
  createRandomChildProfile,
  getAvatarOption,
  NICKNAME_PRESETS,
} from '../logic/gamification';
import {
  computeAverageReadingSpeedSec,
  computeProblemGraphemes,
  isConfirmedAssistedWord,
} from '../logic/pedagogy';
import { changePin, type PinLockoutState } from '../logic/pin';
import {
  clampDailyLimitMinutes,
  DAILY_LIMIT_OPTIONS,
  getStrugglingLettersSummary,
  type ScreenTimeStatus,
} from '../logic/wordPoolEngine';
import {
  exportProgressJson,
  getLocalDateString,
  importProgressJson,
  MAX_IMPORT_JSON_BYTES,
  type AlifboState,
  type ChildProfileData,
} from '../storage/progressStorage';
import {
  playFeedbackChime,
  SttRequestError,
  verifyAudioWithStt,
  type SttApiResponse,
} from '../utils/audioRecorder';
import { AccountIdBadge } from './AccountIdBadge';
import { AvatarVisual } from './AvatarVisual';
import { FeedbackModal } from './FeedbackModal';
import { GameVisual } from './GameVisual';
import { GuestSaveBanner } from './GuestSaveBanner';
import {
  ArrowLeft,
  BarChart3,
  Bell,
  Calendar,
  Check,
  Clock,
  Cloud,
  Download,
  Flame,
  LogOut,
  MessageCircle,
  RotateCcw,
  Settings,
  ShieldCheck,
  Timer,
  Trash2,
  Trophy,
  Upload,
} from './Icons';
import { MascotSvg } from './MascotSvg';
import {
  ParentNotificationsPanel,
  TelegramReminderCard,
} from './ParentNotificationsPanel';
import { PwaInstallBanner } from './PwaInstallBanner';
import { StorybookBackdrop } from './StorybookBackdrop';

function handleMaskedPinInputChange(prevPin: string, nextRawValue: string): string {
  const addedDigits = nextRawValue.replace(/[●\D]/g, '');
  if (addedDigits.length > 0) {
    return (prevPin + addedDigits).slice(0, 4);
  }
  const bulletCount = (nextRawValue.match(/●/g) ?? []).length;
  if (bulletCount < prevPin.length) {
    return prevPin.slice(0, bulletCount);
  }
  return prevPin;
}

export type ParentTab = 'today' | 'diagnostics' | 'achievements' | 'settings';

interface ParentCornerProps {
  state: AlifboState;
  aiOnline: boolean;
  screenTime: ScreenTimeStatus;
  onExitToChildHome?: () => void;
  onUpdateProfile: (profile: ChildProfileData) => void;
  onUpdateDailyLimit: (minutes: 10 | 15 | 20) => void;
  onUpdateActiveWorld: (worldId: 1 | 2 | 3 | 4 | 5) => void;
  onResetTodayTimer: () => void;
  onOpenSurvey: () => void;
  onReplayOnboarding: () => void;
  onUpdatePinHash: (newHash: string, lockout: PinLockoutState) => void;
  onUpdateLockout: (lockout: PinLockoutState) => void;
  onParentVerifyWord: (wordId: string, confirmedMastered: boolean) => void;
  onImportState: (imported: AlifboState) => void;
  onToggleBismillahAlhamdulillah: (enabled: boolean) => void;
  onResetProgress: () => void;
  onSignOut: () => void;
  onOpenGuestUpgrade: () => void;
  onMarkNotificationsRead: (ids: string[]) => void;
}

const CHALLENGE_LABELS: Record<string, string> = {
  slow_spelling: 'Harflab-bo‘g‘inlab sekin o‘qiydi',
  blending: 'Harflarni biladi, bo‘g‘in ulashga qiynaladi',
  forgets_letters: 'Ba’zi harflarni unutib qo‘yadi',
  comprehension: 'Uzun so‘zlar va qisqa gaplarni mashq qiladi',
};

const SUBJECT_LABELS: Record<string, string> = {
  math: 'Matematika',
  drawing: 'Chizmachilik',
  handwriting: 'Husnixat',
  english: 'Ingliz tili',
};

const LETTER_BADGE_COLORS = ['badge-letter-orange', 'badge-letter-amber', 'badge-letter-coral'] as const;
const WORD_PILL_COLORS = ['pill-tint-emerald', 'pill-tint-amber', 'pill-tint-coral'] as const;

export function ParentCorner({
  state,
  aiOnline,
  screenTime,
  onExitToChildHome,
  onUpdateProfile,
  onUpdateDailyLimit,
  onUpdateActiveWorld,
  onResetTodayTimer,
  onOpenSurvey,
  onReplayOnboarding,
  onUpdatePinHash,
  onUpdateLockout,
  onParentVerifyWord,
  onImportState,
  onToggleBismillahAlhamdulillah,
  onResetProgress,
  onSignOut,
  onOpenGuestUpgrade,
  onMarkNotificationsRead,
}: ParentCornerProps) {
  const [activeTab, setActiveTab] = useState<ParentTab>('today');
  const [diagResult, setDiagResult] = useState<SttApiResponse | null>(null);
  const [diagError, setDiagError] = useState<string | null>(null);
  const [diagBusy, setDiagBusy] = useState(false);

  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinMsg, setPinMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [backupMsg, setBackupMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifDbConfigured, setNotifDbConfigured] = useState(false);
  const [serverNotifications, setServerNotifications] = useState<ServerNotificationDto[]>([]);
  const [reminderSettings, setReminderSettings] = useState<RemoteReminderSettings | null>(null);

  const isGuest = isGuestAccount(state.account);
  const displayPublicId = getDisplayablePublicId(state.account);

  const refreshNotificationCenter = useCallback(async () => {
    if (isGuest) {
      setNotifDbConfigured(false);
      setServerNotifications([]);
      setReminderSettings(null);
      return;
    }
    const res = await fetchNotificationsData();
    if (res.ok) {
      setNotifDbConfigured(res.dbConfigured);
      setServerNotifications(res.notifications);
      setReminderSettings(res.settings);
    }
  }, [isGuest]);

  useEffect(() => {
    void refreshNotificationCenter();
  }, [refreshNotificationCenter]);

  const notifications = useMemo(
    () =>
      buildParentNotifications({
        state,
        remoteSettings: reminderSettings,
        serverNotifications,
      }),
    [state, reminderSettings, serverNotifications],
  );
  const unreadNotifCount = useMemo(
    () => notifications.filter((n) => n.unread).length,
    [notifications],
  );

  const handleMarkNotificationsRead = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      onMarkNotificationsRead(ids);
      const serverIds = ids.filter((id) => !id.startsWith('local:'));
      if (serverIds.length > 0 && !isGuest) {
        void saveReminderSettingsApi({ markReadIds: serverIds });
      }
    },
    [isGuest, onMarkNotificationsRead],
  );

  const handleNotificationAction = useCallback(
    (action: AppNotificationAction) => {
      if (action === 'open_guest_upgrade') {
        onOpenGuestUpgrade();
        return;
      }
      if (action === 'open_verify_tab') {
        setActiveTab('today');
        return;
      }
      if (action === 'open_diagnostics') {
        setActiveTab('diagnostics');
        return;
      }
      if (action === 'connect_telegram') {
        setActiveTab('settings');
      }
    },
    [onOpenGuestUpgrade],
  );

  const weekDays = buildWeekStreakDays(state.practiceDates);
  const activeAvatar = getAvatarOption(state.profile.avatarId);
  const practicedToday = state.practiceDates.includes(getLocalDateString());
  const strugglingLetters = getStrugglingLettersSummary(state.letterHintCounts);
  const alphabetSummary = getAlphabetMasterySummary(state.letterMastery);
  const masteredAlphabetEntries = ALIFBE_LETTERS_29.filter(
    (entry) => state.letterMastery[entry.letter]?.status === 'mastered',
  );
  const seenSet = new Set(state.seenWordIds);
  const seenWords = DYNAMIC_WORD_POOL.filter((item) => seenSet.has(item.id));
  const masteredCount = DYNAMIC_WORD_POOL.filter(
    (item) => state.wordProgress[item.id]?.status === 'mastered',
  ).length;
  const masteredPct = DYNAMIC_WORD_POOL.length
    ? Math.round((masteredCount / DYNAMIC_WORD_POOL.length) * 100)
    : 0;
  const pendingVerifyItems = DYNAMIC_WORD_POOL.filter((item) => {
    const prog = state.wordProgress[item.id];
    return Boolean(prog?.pendingVoiceVerify) && prog?.status !== 'mastered';
  });
  const assistedItems = DYNAMIC_WORD_POOL.filter((item) =>
    isConfirmedAssistedWord(state.wordProgress[item.id]),
  );
  const problemGraphemes = computeProblemGraphemes(state.wordProgress, DYNAMIC_WORD_POOL);
  const avgSpeedSec = computeAverageReadingSpeedSec(state.recentReadingTimesMs);
  const avgLatency =
    state.recentLatenciesMs.length > 0
      ? Math.round(
          state.recentLatenciesMs.reduce((a, b) => a + b, 0) / state.recentLatenciesMs.length,
        )
      : null;

  const headlineProblemLetters: string[] =
    problemGraphemes.length > 0
      ? problemGraphemes
          .slice(0, 5)
          .map((g) => formatGraphemeForScript(g.grapheme, 'standard_latin').toUpperCase())
      : strugglingLetters.slice(0, 5).map((l) => l.letter.toUpperCase());

  const firstPendingWord = pendingVerifyItems[0] ?? null;

  const handleExportBackup = () => {
    try {
      const jsonStr = exportProgressJson(state);
      const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `alifbo-backup-${getLocalDateString()}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      setBackupMsg({
        ok: true,
        text: 'Zaxira nusxa muvaffaqiyatli yuklab olindi.',
      });
    } catch {
      setBackupMsg({
        ok: false,
        text: 'Zaxira faylini yaratishda xatolik yuz berdi.',
      });
    }
  };

  const handleImportBackup = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_IMPORT_JSON_BYTES) {
      setBackupMsg({ ok: false, text: 'Zaxira fayli hajmi juda katta (maksimum 512 KB).' });
      return;
    }
    try {
      const text = await file.text();
      const result = importProgressJson(text, getLocalDateString());
      if (!result.ok) {
        setBackupMsg({ ok: false, text: result.errorUz });
        return;
      }
      onImportState(result.state);
      setBackupMsg({
        ok: true,
        text:
          result.migratedLegacyCount > 0
            ? `Zaxira tiklandi! ${result.migratedLegacyCount} ta eski yozuv ovozli tasdiq uchun tayyorlandi.`
            : 'Zaxira nusxa muvaffaqiyatli tiklandi!',
      });
    } catch {
      setBackupMsg({ ok: false, text: 'Faylni o‘qishda xatolik yuz berdi.' });
    }
  };

  const runDiagnosticSample = async () => {
    setDiagBusy(true);
    setDiagError(null);
    setDiagResult(null);
    try {
      const sampleRes = await fetch('/audio/sound_ona.mp3');
      const blob = await sampleRes.blob();
      const sttRes = await verifyAudioWithStt(blob, 'ONA', ['ona']);
      setDiagResult(sttRes);
    } catch (err) {
      if (err instanceof SttRequestError && err.reason) {
        const statusPart = err.upstreamStatus ? `, HTTP ${err.upstreamStatus}` : '';
        setDiagError(
          `${err.message} (${err.provider ?? 'stt'}, ${err.reason}${statusPart})`,
        );
      } else {
        setDiagError(err instanceof Error ? err.message : 'Lokal ovoz serveriga ulanib bo‘lmadi');
      }
    } finally {
      setDiagBusy(false);
    }
  };

  const handlePinChange = () => {
    const res = changePin({
      salt: state.pinSalt,
      storedHash: state.pinHash,
      currentPin: currentPin.trim(),
      newPin: newPin.trim(),
      confirmPin: confirmPin.trim(),
      lockout: state.pinLockout,
      nowMs: Date.now(),
    });
    onUpdateLockout(res.lockout);

    if (!res.ok) {
      playFeedbackChime('soft-bonk');
      setPinMsg({ ok: false, text: res.errorUz });
      return;
    }
    playFeedbackChime('chime');
    onUpdatePinHash(res.pinHash, res.lockout);
    setCurrentPin('');
    setNewPin('');
    setConfirmPin('');
    setPinMsg({ ok: true, text: 'PIN-kod muvaffaqiyatli yangilandi.' });
  };

  const navItems: Array<{
    id: ParentTab;
    label: string;
    badge?: number;
    icon: JSX.Element;
  }> = [
    { id: 'today', label: 'Bugun', icon: <Calendar size={17} /> },
    {
      id: 'diagnostics',
      label: 'Diagnostika',
      icon: <BarChart3 size={17} />,
      badge:
        pendingVerifyItems.length > 0
          ? pendingVerifyItems.length
          : problemGraphemes.length > 0
            ? problemGraphemes.length
            : undefined,
    },
    { id: 'achievements', label: 'O‘sish', icon: <Trophy size={17} /> },
    { id: 'settings', label: 'Sozlamalar', icon: <Settings size={17} /> },
  ];

  return (
    <div className="parent-page-shell">
      <StorybookBackdrop variant="parent" />

      {/* Top Header matching Mockup 11 */}
      <header className="parent-topbar">
        <div className="parent-topbar-left">
          <img src="/images/logo.webp" alt="Alifbo" className="brand-logo-img" draggable={false} />
          <h1 className="parent-topbar-title">Ota-ona kuzatuvi</h1>
        </div>

        <nav className="parent-inline-tabs" aria-label="Ota-ona bo‘limlari">
          {navItems.map((nav) => (
            <button
              key={nav.id}
              type="button"
              className={`parent-inline-tab ${
                activeTab === nav.id ? 'parent-inline-tab-active' : ''
              }`}
              aria-current={activeTab === nav.id ? 'page' : undefined}
              onClick={() => {
                playFeedbackChime('pop');
                setActiveTab(nav.id);
              }}
            >
              <span>{nav.label}</span>
              {nav.badge !== undefined && (
                <span className="parent-tab-badge">{nav.badge}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="parent-topbar-actions">
          <button
            type="button"
            className="btn-3d-cream btn-compact btn-with-icon nav-btn notif-bell-btn parent-topbar-icon-btn"
            aria-label={`Bildirishnomalar${unreadNotifCount > 0 ? ` (${unreadNotifCount} ta yangi)` : ''}`}
            onClick={() => {
              playFeedbackChime('pop');
              setNotificationsOpen(true);
            }}
          >
            <Bell size={16} />
            <span className="parent-topbar-action-label">Bildirishnomalar</span>
            {unreadNotifCount > 0 && (
              <span className="notif-unread-badge">{unreadNotifCount}</span>
            )}
          </button>

          <button
            type="button"
            className="btn-3d-cream btn-compact btn-with-icon nav-btn parent-topbar-icon-btn"
            aria-label="Fikr bildirish"
            onClick={() => {
              playFeedbackChime('pop');
              setFeedbackOpen(true);
            }}
          >
            <MessageCircle size={16} />
            <span className="parent-topbar-action-label">Fikr bildirish</span>
          </button>

          {onExitToChildHome && (
            <button
              type="button"
              className="btn-3d-emerald btn-compact btn-with-icon nav-btn"
              onClick={() => {
                playFeedbackChime('pop');
                onExitToChildHome();
              }}
            >
              <ArrowLeft size={17} strokeWidth={2.6} />
              <span>Bolalar ekrani</span>
            </button>
          )}
        </div>
      </header>

      <div className="parent-content-wrap">
        {!aiOnline && (
          <section className="parent-card parent-offline-banner" role="alert">
            <h3>Ovozli tekshiruv hozircha o‘chiq — rasmli mashq rejimi faol</h3>
            <p className="muted-text" style={{ margin: 0 }}>
              Farzandingiz barcha mashqlarni rasmlar yordamida bemalol bajara oladi. Ovozli tekshiruvni
              yoqish bo‘yicha qo‘llanma <strong>«Sozlamalar → Qo‘shimcha ma’lumot»</strong> ichida.
            </p>
          </section>
        )}

        {activeTab === 'today' && (
          <div className="parent-tab-pane">
            {isGuest && (
              <GuestSaveBanner
                variant="card"
                practicedCount={Object.keys(state.wordProgress).length}
                totalStars={state.totalStars + state.totalEffortStars}
                onSaveAccount={onOpenGuestUpgrade}
              />
            )}

            {!isGuest && displayPublicId && (
              <section className="parent-card parent-profile-strip" aria-label="Foydalanuvchi profili va ID">
                <div className="parent-profile-strip-left">
                  <div
                    className="parent-profile-avatar"
                    style={{ backgroundColor: activeAvatar.bg, borderColor: activeAvatar.border }}
                    aria-hidden="true"
                  >
                    <AvatarVisual avatarId={activeAvatar.id} size={38} />
                  </div>
                  <div>
                    <strong className="parent-profile-name">
                      {state.profile.name.trim() || 'Bolajon'}
                    </strong>
                    <div className="muted-text" style={{ fontSize: 12.5 }}>
                      {activeAvatar.label} · {state.account?.contact}
                    </div>
                  </div>
                </div>
                <AccountIdBadge publicId={displayPublicId} label="Foydalanuvchi ID:" />
              </section>
            )}

            {/* Mockup 11: 2x2 Diagnostic Metrics Grid */}
            <div className="parent-2x2-grid">
              {/* Card 1: Mustaqil o'qilgan so'zlar */}
              <motion.section
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="parent-diag-card"
              >
                <h2 className="parent-diag-label">Mustaqil o‘qilgan so‘zlar</h2>
                <div className="parent-diag-value">
                  <span className="parent-diag-big">{masteredCount}</span>
                  <span className="parent-diag-total"> / {DYNAMIC_WORD_POOL.length}</span>
                </div>
                <div className="parent-progress-track" aria-hidden="true">
                  <div
                    className="parent-progress-fill"
                    style={{ width: `${masteredPct}%` }}
                  />
                </div>
              </motion.section>

              {/* Card 2: O'rtacha o'qish tezligi */}
              <motion.section
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 }}
                className="parent-diag-card"
              >
                <h2 className="parent-diag-label">O‘rtacha o‘qish tezligi</h2>
                <div className="parent-diag-speed-row">
                  <Timer size={38} className="parent-timer-icon" strokeWidth={2.4} />
                  {avgSpeedSec !== null ? (
                    <span className="parent-diag-big">{`${avgSpeedSec.toFixed(1)} soniya`}</span>
                  ) : (
                    <span className="parent-diag-offline-note">Ovozli rejimda o‘lchanadi</span>
                  )}
                </div>
              </motion.section>

              {/* Card 3: Ko'p qiynalgan harflar */}
              <motion.section
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="parent-diag-card"
              >
                <h2 className="parent-diag-label">Ko‘p qiynalgan harflar</h2>
                {headlineProblemLetters.length === 0 ? (
                  <p className="muted-text" style={{ margin: '6px 0 0', fontSize: 14 }}>
                    Hozircha qiynalgan harflar aniqlanmadi — ajoyib!
                  </p>
                ) : (
                  <div className="parent-letter-badges-row">
                    {headlineProblemLetters.map((letter, idx) => (
                      <span
                        key={letter}
                        className={`parent-letter-badge ${
                          LETTER_BADGE_COLORS[idx % LETTER_BADGE_COLORS.length]
                        }`}
                      >
                        {letter}
                      </span>
                    ))}
                  </div>
                )}
              </motion.section>

              {/* Card 4: Uyda mashq qilish so'zlari */}
              <motion.section
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="parent-diag-card"
              >
                <h2 className="parent-diag-label">Uyda mashq qilish so‘zlari</h2>
                {assistedItems.length === 0 ? (
                  <p className="muted-text" style={{ margin: '6px 0 0', fontSize: 14 }}>
                    Hozircha qo‘shimcha mashq so‘zlari yo‘q!
                  </p>
                ) : (
                  <div className="parent-word-pills-row">
                    {assistedItems.slice(0, 6).map((item, idx) => (
                      <span
                        key={item.id}
                        className={`parent-syllable-pill ${
                          WORD_PILL_COLORS[idx % WORD_PILL_COLORS.length]
                        }`}
                      >
                        {item.kind === 'word' ? item.syllables.join('-') : item.text}
                      </span>
                    ))}
                  </div>
                )}
              </motion.section>
            </div>

            {/* Full-Width Bottom Verification Card (Ota-ona tasdig'i) */}
            <motion.section
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="parent-verify-hero-card"
            >
              <span className="parent-verify-subtitle">Ota-ona tasdig‘i</span>
              {firstPendingWord ? (
                <>
                  <div className="parent-verify-word">{firstPendingWord.text}</div>
                  {pendingVerifyItems.length > 1 && (
                    <span className="muted-text" style={{ fontSize: 13, fontWeight: 700 }}>
                      Yana {pendingVerifyItems.length - 1} ta so‘z tasdiq kutmoqda
                    </span>
                  )}
                  <div className="parent-verify-actions">
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.96 }}
                      className="btn-3d-emerald btn-with-icon"
                      onClick={() => {
                        playFeedbackChime('chime');
                        onParentVerifyWord(firstPendingWord.id, true);
                      }}
                    >
                      <Check size={19} strokeWidth={2.8} />
                      <span>Ravon o‘qidi</span>
                      <span className="verify-star-bonus">+3 ⭐</span>
                    </motion.button>
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.96 }}
                      className="btn-3d-orange"
                      onClick={() => {
                        playFeedbackChime('pop');
                        onParentVerifyWord(firstPendingWord.id, false);
                      }}
                    >
                      Yana mashq
                    </motion.button>
                  </div>
                </>
              ) : (
                <div className="parent-verify-empty">
                  <ShieldCheck size={28} color="#059669" />
                  <span>Tasdiq kutayotgan so‘zlar hozircha yo‘q — barcha so‘zlar ko‘rib chiqilgan!</span>
                </div>
              )}
            </motion.section>

            {/* Quick Summary Cards (Screen Time, Active World, Survey) */}
            <div className="parent-cards-grid">
              <section className="parent-card parent-summary-card">
                <h3 className="parent-card-h3-icon">
                  <Clock size={18} />
                  <span>Sog‘lom ekran vaqti</span>
                </h3>
                <p className="parent-card-line">
                  Bugun mashq qilindi:{' '}
                  <strong>
                    {Math.floor(screenTime.practicedSeconds / 60)} / {screenTime.dailyLimitMinutes}{' '}
                    daqiqa
                  </strong>
                </p>
                <p className="parent-card-line">
                  Holat:{' '}
                  <strong>
                    {screenTime.isLimitReached
                      ? 'Qahramon dam olmoqda (kunlik me’yor bajarildi)'
                      : `${screenTime.remainingMinutes} daqiqa qoldi`}
                  </strong>
                </p>
                {screenTime.practicedSeconds > 0 && (
                  <button
                    type="button"
                    className="btn-3d-cream btn-compact btn-with-icon parent-card-btn"
                    onClick={onResetTodayTimer}
                  >
                    <RotateCcw size={15} />
                    <span>Bugungi vaqtni yangilash</span>
                  </button>
                )}
              </section>

              <section className="parent-card parent-summary-card">
                <h3>Faol Olam tanlovi</h3>
                <p className="muted-text" style={{ margin: 0, fontSize: 13 }}>
                  Bolaning bosh ekranida birinchi tavsiya etiladigan o‘qish olami:
                </p>
                <select
                  className="parent-select"
                  value={state.activeWorldId}
                  onChange={(e) =>
                    onUpdateActiveWorld(Number(e.target.value) as 1 | 2 | 3 | 4 | 5)
                  }
                  aria-label="Faol olamni tanlash"
                >
                  {READING_WORLDS.map((world) => (
                    <option key={world.worldId} value={world.worldId}>
                      {world.titleUz}
                    </option>
                  ))}
                </select>
                <p className="parent-card-line" style={{ marginTop: 4 }}>
                  Bugungi faollik: <strong>{practicedToday ? 'Faol' : 'Hali boshlanmadi'}</strong>
                </p>
              </section>

              <section className="parent-card parent-summary-card">
                <h3>Boshlang‘ich so‘rovnoma</h3>
                {state.surveyData ? (
                  state.surveyData.childStage &&
                  state.surveyData.previousAttempt &&
                  state.surveyData.biggestDifficulty ? (
                    (() => {
                      const labels = getOnboardingOptionLabels({
                        childStage: state.surveyData.childStage,
                        previousAttempt: state.surveyData.previousAttempt,
                        biggestDifficulty: state.surveyData.biggestDifficulty,
                      });
                      return (
                        <>
                          <p className="parent-card-line">
                            Bosqich: <strong>{labels.childStageLabel}</strong>
                          </p>
                          <p className="parent-card-line">
                            Asosiy qiyinchilik: <strong>{labels.biggestDifficultyLabel}</strong>
                          </p>
                        </>
                      );
                    })()
                  ) : (
                    <>
                      <p className="parent-card-line">
                        Yosh guruhi: <strong>{state.surveyData.ageGroup} yosh</strong>
                      </p>
                      <p className="parent-card-line">
                        Asosiy e’tibor:{' '}
                        <strong>{CHALLENGE_LABELS[state.surveyData.readingChallenge] ?? '—'}</strong>
                      </p>
                    </>
                  )
                ) : (
                  <p className="muted-text">So‘rovnoma hali to‘ldirilmagan.</p>
                )}
                <button
                  type="button"
                  className="btn-3d-cream btn-compact parent-card-btn"
                  onClick={onOpenSurvey}
                >
                  So‘rovnomani tahrirlash
                </button>
              </section>
            </div>
          </div>
        )}

        {activeTab === 'diagnostics' && (
          <div className="parent-tab-pane">
            <h2 className="parent-page-heading">O‘qish Diagnostikasi (Alifbo 2.2)</h2>

            <section className="parent-card">
              <div className="parent-analytics-grid">
                <div className="analytics-stat-box">
                  <span className="muted-text">Mustaqil o‘qilgan so‘zlar</span>
                  <strong>
                    {masteredCount} / {DYNAMIC_WORD_POOL.length} ({masteredPct}%)
                  </strong>
                </div>
                <div className="analytics-stat-box">
                  <span className="muted-text">O‘rtacha o‘qish tezligi</span>
                  <strong>
                    {avgSpeedSec !== null
                      ? `${avgSpeedSec.toFixed(1)} soniya`
                      : 'Ovozli rejimda o‘lchanadi'}
                  </strong>
                </div>
                <div className="analytics-stat-box">
                  <span className="muted-text">Uyda mashq qilish</span>
                  <strong>{assistedItems.length} ta so‘z</strong>
                </div>
                <div className="analytics-stat-box">
                  <span className="muted-text">Ko‘p qiynalgan harflar</span>
                  <strong>{problemGraphemes.length} ta</strong>
                </div>
              </div>
            </section>

            {pendingVerifyItems.length > 0 && (
              <section className="parent-card">
                <h3>Ota-ona tasdig‘ini kutayotgan so‘zlar ({pendingVerifyItems.length} ta)</h3>
                <p className="muted-text" style={{ marginTop: 0 }}>
                  Bola ovoz serverisiz rasmli tekshiruvda topgan so‘zlar. Agar bola so‘zni mustaqil
                  ravon o‘qiy olsa, tasdiqlang:
                </p>
                <div className="verify-inbox-list">
                  {pendingVerifyItems.map((item) => (
                    <article key={item.id} className="verify-inbox-card">
                      <div className="verify-card-top">
                        <span className="verify-lesson-pill">
                          <GameVisual emoji={item.emoji} wordId={item.id} size={22} /> {item.text} (
                          {item.kind === 'word' ? item.syllables.join('-') : 'Gap'})
                        </span>
                        <div className="verify-action-row">
                          <button
                            type="button"
                            className="btn-3d-emerald btn-compact btn-with-icon"
                            onClick={() => {
                              playFeedbackChime('chime');
                              onParentVerifyWord(item.id, true);
                            }}
                          >
                            <Check size={15} strokeWidth={2.8} />
                            <span>Ravon o‘qidi</span>
                            <span className="verify-star-bonus">+3 ⭐</span>
                          </button>
                          <button
                            type="button"
                            className="btn-3d-orange btn-compact"
                            onClick={() => {
                              playFeedbackChime('pop');
                              onParentVerifyWord(item.id, false);
                            }}
                          >
                            Yana mashq qilsin
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}

            <section className="parent-card">
              <h3>Uyda mashq qilish ro‘yxati ({assistedItems.length} ta)</h3>
              <p className="muted-text" style={{ marginTop: 0 }}>
                Yordam bilan yoki hijjalab o‘qilgan so‘zlar — bola bilan bo‘g‘inlarga bo‘lib
                takrorlang:
              </p>
              {assistedItems.length === 0 ? (
                <p className="muted-text">Hozircha qiynalgan so‘zlar yo‘q — ajoyib!</p>
              ) : (
                <div className="round-summary-words" style={{ justifyContent: 'flex-start' }}>
                  {assistedItems.map((item) => (
                    <span key={item.id} className="round-word-pill status-badge-assisted">
                      <GameVisual emoji={item.emoji} wordId={item.id} size={20} />{' '}
                      {item.kind === 'word' ? item.syllables.join('-') : item.text}
                    </span>
                  ))}
                </div>
              )}
            </section>

            <section className="parent-card">
              <h3>Ko‘p qiynalgan harflar</h3>
              <p className="muted-text" style={{ marginTop: 0 }}>
                Farzandingiz bir necha so‘zda qayta-qayta qiynalgan harf va harf birikmalari:
              </p>
              {problemGraphemes.length === 0 ? (
                <div className="verify-empty-state">
                  <p style={{ margin: 0, fontWeight: 700 }}>
                    Hozircha ko‘p qiynalgan harflar aniqlanmadi — ajoyib!
                  </p>
                </div>
              ) : (
                <div className="verify-inbox-list">
                  {problemGraphemes.map((stat) => {
                    const label = formatGraphemeForScript(stat.grapheme, 'standard_latin').toUpperCase();
                    const pct = Math.round(stat.errorRate * 100);
                    return (
                      <article key={stat.grapheme} className="verify-inbox-card">
                        <div className="verify-card-top">
                          <span className="verify-lesson-pill">Harf: {label}</span>
                          <span className="hero-stat-chip chip-streak">
                            {pct}% qiyinchilik ({stat.assistedWords}/{stat.attemptedWords} so‘zda)
                          </span>
                        </div>
                        <p style={{ margin: 0, fontSize: 14 }}>
                          Bugun «{label}» tovushi ishtirokidagi 2–3 ta so‘zni birga bo‘g‘inlab mashq
                          qiling.
                        </p>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="parent-card">
              <h3>Alifbo harflari mustahkamlanishi</h3>
              <p className="muted-text" style={{ marginTop: 0 }}>
                Mustahkamlangan harflar:{' '}
                <strong>
                  {alphabetSummary.masteredCount} / {alphabetSummary.total} ({alphabetSummary.pct}%)
                </strong>
                {alphabetSummary.practicedCount > 0
                  ? ` · Mashqda: ${alphabetSummary.practicedCount} ta`
                  : ''}
              </p>
              <div className="parent-progress-track" aria-hidden="true" style={{ marginBottom: 12 }}>
                <div
                  className="parent-progress-fill"
                  style={{ width: `${alphabetSummary.pct}%` }}
                />
              </div>
              {masteredAlphabetEntries.length === 0 ? (
                <p className="muted-text" style={{ margin: 0 }}>
                  Hali «Harflarni takrorlash» o‘yini orqali mustahkamlangan harflar yo‘q.
                </p>
              ) : (
                <div className="round-summary-words" style={{ justifyContent: 'flex-start' }}>
                  {masteredAlphabetEntries.map((entry) => (
                    <span key={entry.letter} className="round-word-pill status-badge-mastered">
                      <GameVisual emoji={entry.exampleEmoji} letter={entry.letter} size={20} />{' '}
                      {entry.display}
                    </span>
                  ))}
                </div>
              )}
            </section>

            <section className="parent-card">
              <h3>Harf eslatmasi bosilganlar (Tezkor eslash)</h3>
              {strugglingLetters.length === 0 ? (
                <div className="verify-empty-state">
                  <p style={{ margin: 0, fontWeight: 700 }}>
                    Hozircha harf eslatmasi bosilmagan!
                  </p>
                </div>
              ) : (
                <div className="verify-inbox-list">
                  {strugglingLetters.map((entry) => (
                    <article key={entry.letter} className="verify-inbox-card">
                      <div className="verify-card-top">
                        <span className="verify-lesson-pill">
                          <GameVisual
                            emoji={entry.exampleEmoji}
                            letter={entry.letter}
                            size={20}
                          />{' '}
                          {entry.display}
                        </span>
                        <span className="hero-stat-chip chip-streak">
                          {entry.tapCount} marta eslatma bosildi
                        </span>
                      </div>
                      <p style={{ margin: 0, fontSize: 14 }}>{entry.coachingTipUz}</p>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="parent-card">
              <h3>Yaqinda o‘qilgan so‘zlar ({seenWords.length} ta)</h3>
              {seenWords.length === 0 ? (
                <p className="muted-text">Hali so‘z o‘yinlari boshlanmadi.</p>
              ) : (
                <div className="round-summary-words" style={{ justifyContent: 'flex-start' }}>
                  {seenWords.map((w) => (
                    <span key={w.id} className="round-word-pill">
                      <GameVisual emoji={w.emoji} wordId={w.id} size={20} /> {w.text}
                    </span>
                  ))}
                </div>
              )}
            </section>

            {state.surveyData && (
              <section className="parent-card">
                <h3>Kelajakda kutilayotgan yo‘nalishlar (So‘rovnoma)</h3>
                {state.surveyData.desiredFutureSubjects.length === 0 ? (
                  <p className="muted-text" style={{ margin: 0 }}>
                    Tanlanmagan
                  </p>
                ) : (
                  <div className="round-summary-words" style={{ justifyContent: 'flex-start' }}>
                    {state.surveyData.desiredFutureSubjects.map((sub) => (
                      <span key={sub} className="round-word-pill">
                        {SUBJECT_LABELS[sub] ?? sub}
                      </span>
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        )}

        {activeTab === 'achievements' && (
          <div className="parent-tab-pane">
            <h2 className="parent-page-heading">O‘sish va Faollik</h2>

            <section className="parent-card">
              <div className="effort-mastery-split">
                <div className="split-box split-effort">
                  <span className="split-badge">Mustaqil o‘qilgan so‘zlar</span>
                  <strong className="split-big">
                    {masteredCount} / {DYNAMIC_WORD_POOL.length} ta ({masteredPct}%)
                  </strong>
                  <p className="muted-text">
                    Mashq qilindi: {seenWords.length} ta · Jami yulduz:{' '}
                    {state.totalStars + state.totalEffortStars}
                  </p>
                </div>

                <div className="split-box split-mastery">
                  <span className="split-badge">5 ta Olam qamrovi</span>
                  <strong className="split-big">
                    {
                      READING_WORLDS.filter((w) =>
                        DYNAMIC_WORD_POOL.some(
                          (item) => item.worldId === w.worldId && seenSet.has(item.id),
                        ),
                      ).length
                    }{' '}
                    / 5 olam
                  </strong>
                  <p className="muted-text">Faol kunlar: {state.practiceDates.length} kun</p>
                </div>
              </div>
            </section>

            <section className="parent-card">
              <div className="section-heading-row">
                <h3>Oxirgi 7 kunlik faollik</h3>
                <span className="section-meta-pill">
                  <Flame size={14} /> {state.practiceDates.length} kun jami
                </span>
              </div>
              <div className="week-streak-strip">
                {weekDays.map((day) => (
                  <div
                    key={day.dateStr}
                    className={`week-day-pill ${day.active ? 'week-day-active' : ''} ${
                      day.isToday ? 'week-day-today' : ''
                    }`}
                  >
                    <span className="week-day-label">{day.shortLabelUz}</span>
                    <span className="week-day-circle" aria-hidden="true">
                      {day.active ? <Flame size={14} /> : day.isToday ? '•' : ''}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="parent-tab-pane">
            <h2 className="parent-page-heading">Sozlamalar</h2>

            <section className="parent-card">
              <h3 className="parent-card-h3-icon">
                <MascotSvg size={26} />
                <span>Bola taxallusi va rasmi</span>
              </h3>
              <div className="nickname-presets-row">
                <button
                  type="button"
                  className="btn-3d-gold btn-compact btn-with-icon"
                  onClick={() => {
                    playFeedbackChime('marimba');
                    const next = createRandomChildProfile(Math.random, state.profile);
                    onUpdateProfile({
                      ...state.profile,
                      name: next.name,
                      avatarId: next.avatarId,
                    });
                  }}
                >
                  <RotateCcw size={14} />
                  <span>Tasodifiy belgilash</span>
                </button>
                {NICKNAME_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={`btn-3d-cream btn-compact ${
                      state.profile.name === preset ? 'preset-active' : ''
                    }`}
                    onClick={() => onUpdateProfile({ ...state.profile, name: preset })}
                  >
                    {preset}
                  </button>
                ))}
              </div>

              <label className="pin-label" style={{ marginTop: 12 }}>
                Taxallus (haqiqiy ism yozmang)
                <input
                  type="text"
                  maxLength={20}
                  value={state.profile.name}
                  className="parent-text-input"
                  onChange={(e) => onUpdateProfile({ ...state.profile, name: e.target.value })}
                />
              </label>

              <div
                className="avatar-picker-grid"
                role="radiogroup"
                aria-label="Belgi tanlash"
                style={{ marginTop: 14 }}
              >
                {AVATAR_OPTIONS.map((av) => {
                  const selected = av.id === state.profile.avatarId;
                  return (
                    <button
                      key={av.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={`avatar-choice-btn ${selected ? 'avatar-choice-selected' : ''}`}
                      style={{
                        backgroundColor: av.bg,
                        borderColor: selected ? '#059669' : av.border,
                      }}
                      onClick={() => onUpdateProfile({ ...state.profile, avatarId: av.id })}
                    >
                      <span className="avatar-choice-emoji avatar-visual-wrap" aria-hidden="true">
                        <AvatarVisual avatarId={av.id} size={36} />
                      </span>
                      <span className="avatar-choice-label">{av.label}</span>
                    </button>
                  );
                })}
              </div>
              {!isGuest && displayPublicId && (
                <div style={{ marginTop: 12 }}>
                  <AccountIdBadge publicId={displayPublicId} label="Foydalanuvchi ID:" />
                </div>
              )}
            </section>

            <section className="parent-card">
              <div className="parent-toggle-row">
                <div className="parent-toggle-copy">
                  <strong id="bismillah-toggle-label">
                    Bismillah va Alhamdulillah eslatmasi
                  </strong>
                  <p className="muted-text" style={{ margin: '4px 0 0' }}>
                    Mashq boshida «Bismillah», yakunida «Alhamdulillah» eslatmasi hamda ustoz
                    ovozli yo‘l-yo‘rig‘ini ko‘rsatish.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={state.bismillahAlhamdulillahEnabled}
                  aria-labelledby="bismillah-toggle-label"
                  className={`parent-toggle-switch ${
                    state.bismillahAlhamdulillahEnabled ? 'parent-toggle-switch-on' : ''
                  }`}
                  onClick={() => {
                    playFeedbackChime('pop');
                    onToggleBismillahAlhamdulillah(!state.bismillahAlhamdulillahEnabled);
                  }}
                >
                  <span className="parent-toggle-thumb" aria-hidden="true" />
                  <span className="parent-toggle-state-text">
                    {state.bismillahAlhamdulillahEnabled ? 'Yoqilgan' : 'O‘chirilgan'}
                  </span>
                </button>
              </div>
            </section>

            <section className="parent-card">
              <div className="parent-session-box" style={{ marginTop: 0 }}>
                <div>
                  <label htmlFor="daily-limit-select">
                    <strong>Kunlik sog‘lom ekran vaqti: {state.dailyLimitMinutes} daqiqa</strong>
                  </label>
                  <p className="muted-text">
                    Bola telefonga bog‘lanib qolmasligi uchun vaqt tugaganda qahramon uyquga ketadi.
                    ({activeAvatar.mascotName}: {state.profile.name})
                  </p>
                </div>
                <select
                  id="daily-limit-select"
                  className="parent-select parent-select-auto"
                  value={state.dailyLimitMinutes}
                  onChange={(e) =>
                    onUpdateDailyLimit(clampDailyLimitMinutes(Number(e.target.value)))
                  }
                >
                  {DAILY_LIMIT_OPTIONS.map((mins) => (
                    <option key={mins} value={mins}>
                      {mins} daqiqa {mins === 15 ? '(Tavsiya)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ marginTop: 12 }}>
                <button type="button" className="btn-3d-cream btn-compact" onClick={onReplayOnboarding}>
                  Tanishtiruvni qayta ko‘rish
                </button>
              </div>
            </section>

            <section className="parent-card">
              <h3>PIN-kodni o‘zgartirish</h3>
              <div className="pin-change-form">
                <input
                  type="text"
                  name="alifbo_pin_current"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-form-type="other"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="Amaldagi PIN"
                  aria-label="Amaldagi PIN"
                  value={'●'.repeat(currentPin.length)}
                  onKeyDown={(e) => {
                    if (/^[0-9]$/.test(e.key)) {
                      e.preventDefault();
                      setCurrentPin((prev) => (prev.length < 4 ? `${prev}${e.key}` : prev));
                    } else if (e.key === 'Backspace') {
                      e.preventDefault();
                      setCurrentPin((prev) => prev.slice(0, -1));
                    }
                  }}
                  onChange={(e) => setCurrentPin((prev) => handleMaskedPinInputChange(prev, e.target.value))}
                  className="pin-input-sm"
                />
                <input
                  type="text"
                  name="alifbo_pin_new"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-form-type="other"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="Yangi PIN (4 raqam)"
                  aria-label="Yangi PIN"
                  value={'●'.repeat(newPin.length)}
                  onKeyDown={(e) => {
                    if (/^[0-9]$/.test(e.key)) {
                      e.preventDefault();
                      setNewPin((prev) => (prev.length < 4 ? `${prev}${e.key}` : prev));
                    } else if (e.key === 'Backspace') {
                      e.preventDefault();
                      setNewPin((prev) => prev.slice(0, -1));
                    }
                  }}
                  onChange={(e) => setNewPin((prev) => handleMaskedPinInputChange(prev, e.target.value))}
                  className="pin-input-sm"
                />
                <input
                  type="text"
                  name="alifbo_pin_confirm"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-form-type="other"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="Yangi PIN tasdig‘i"
                  aria-label="Yangi PIN tasdig‘i"
                  value={'●'.repeat(confirmPin.length)}
                  onKeyDown={(e) => {
                    if (/^[0-9]$/.test(e.key)) {
                      e.preventDefault();
                      setConfirmPin((prev) => (prev.length < 4 ? `${prev}${e.key}` : prev));
                    } else if (e.key === 'Backspace') {
                      e.preventDefault();
                      setConfirmPin((prev) => prev.slice(0, -1));
                    } else if (e.key === 'Enter') {
                      e.preventDefault();
                      handlePinChange();
                    }
                  }}
                  onChange={(e) => setConfirmPin((prev) => handleMaskedPinInputChange(prev, e.target.value))}
                  className="pin-input-sm"
                />
                <button type="button" className="btn-3d-emerald btn-compact" onClick={handlePinChange}>
                  PIN-kodni yangilash
                </button>
              </div>
              {pinMsg && (
                <div
                  className={`feedback-banner ${pinMsg.ok ? 'feedback-success' : 'feedback-gentle'}`}
                  style={{ marginTop: 10 }}
                >
                  {pinMsg.text}
                </div>
              )}
            </section>

            <PwaInstallBanner variant="settings" />

            <section className="parent-card">
              <h3>Natijalarni faylga saqlash va qayta yuklash</h3>
              <p className="muted-text" style={{ marginTop: 0 }}>
                Farzandingizning o‘quv natijalarini faylga saqlab qo‘ying yoki boshqa qurilmaga
                osongina ko‘chiring.
              </p>
              <div className="backup-actions-row">
                <button
                  type="button"
                  className="btn-3d-cream btn-compact btn-with-icon"
                  onClick={handleExportBackup}
                >
                  <Download size={16} />
                  <span>Natijalarni faylga saqlash</span>
                </button>
                <label className="btn-3d-cream btn-compact btn-with-icon file-upload-label">
                  <Upload size={16} />
                  <span>Fayldan qayta yuklash</span>
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={(e) => void handleImportBackup(e)}
                    style={{ display: 'none' }}
                  />
                </label>
              </div>
              {backupMsg && (
                <div
                  className={`feedback-banner ${
                    backupMsg.ok ? 'feedback-success' : 'feedback-gentle'
                  }`}
                  style={{ marginTop: 10 }}
                >
                  {backupMsg.text}
                </div>
              )}
            </section>

            <TelegramReminderCard
              isGuest={isGuest}
              dbConfigured={notifDbConfigured}
              settings={reminderSettings}
              onSettingsUpdated={setReminderSettings}
              onRefreshCenter={refreshNotificationCenter}
              onOpenGuestUpgrade={onOpenGuestUpgrade}
            />

            <section className="parent-card">
              <h3>Hisob</h3>
              {isGuest ? (
                <>
                  <p className="muted-text" style={{ marginTop: 0 }}>
                    Faol rejim: <strong>Sinov rejimi (Natijalar faqat shu qurilmada saqlanadi)</strong>
                  </p>
                  <div className="parent-account-actions-row">
                    <button
                      type="button"
                      className="btn-3d-emerald btn-compact btn-with-icon"
                      onClick={onOpenGuestUpgrade}
                    >
                      <Cloud size={16} />
                      <span>Hisob yaratib saqlash (Telegram / Google)</span>
                    </button>
                    <button
                      type="button"
                      className="btn-3d-cream btn-compact btn-with-icon"
                      onClick={onSignOut}
                    >
                      <LogOut size={16} />
                      <span>Sinov rejimidan chiqish</span>
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="muted-text" style={{ marginTop: 0 }}>
                    Faol hisob: <strong>{state.account?.contact ?? '—'}</strong>
                  </p>
                  {displayPublicId && (
                    <AccountIdBadge publicId={displayPublicId} label="Hisob ID:" />
                  )}
                  <button
                    type="button"
                    className="btn-3d-cream btn-compact btn-with-icon"
                    onClick={onSignOut}
                  >
                    <LogOut size={16} />
                    <span>Hisobdan chiqish</span>
                  </button>
                </>
              )}
            </section>

            <section className="parent-card">
              <details className="tech-accordion">
                <summary className="tech-accordion-summary">Qo‘shimcha texnik ma’lumot</summary>
                <div className="tech-accordion-body">
                  <div className="tech-status-bar">
                    <span className={`ai-badge ${aiOnline ? 'ai-ready' : 'ai-offline'}`}>
                      {aiOnline ? 'Ovozli tekshiruv tayyor' : 'Ovozli tekshiruv o‘chiq'}
                    </span>
                    <span className="muted-text">
                      O‘rtacha javob tezligi:{' '}
                      <strong>{avgLatency !== null ? `${avgLatency} ms` : '—'}</strong> · Jami:{' '}
                      {DYNAMIC_WORD_POOL.length} ta so‘z va mashq
                    </span>
                    <button
                      type="button"
                      disabled={!aiOnline || diagBusy}
                      className="btn-3d-emerald btn-compact"
                      onClick={() => void runDiagnosticSample()}
                    >
                      {diagBusy ? 'Tekshirilmoqda...' : 'Sinov ovoz'}
                    </button>
                  </div>

                  {!aiOnline && (
                    <ol className="parent-offline-steps" style={{ marginTop: 12 }}>
                      <li>
                        Ovozli tekshiruv onlayn bulutli server orqali ishlaydi; lokal ishlab
                        chiqishda kompyuterda <code>npm run dev:all</code> buyrug‘ini ishga
                        tushiring.
                      </li>
                      <li>
                        Ovoz serveri ishlamayotganda ilova avtomatik ravishda rasmli mashq rejimida
                        davom etadi.
                      </li>
                    </ol>
                  )}

                  {diagResult && (
                    <div className="feedback-banner feedback-success" style={{ marginTop: 12 }}>
                      Sinov ovoz («ONA») natijasi:{' '}
                      <strong>{diagResult.accepted ? 'Qabul qilindi' : 'Rad etildi'}</strong> · Tezlik:{' '}
                      <strong>{diagResult.latency_ms} ms</strong>
                    </div>
                  )}
                  {diagError && (
                    <div className="feedback-banner feedback-gentle" style={{ marginTop: 12 }}>
                      {diagError}
                    </div>
                  )}

                  <h4 style={{ marginTop: 18, marginBottom: 8 }}>Aktivlar va Litsenziyalar Manifesti</h4>
                  <div className="manifest-list">
                    {ASSET_LICENSE_MANIFEST.map((entry) => (
                      <div key={entry.id} className="manifest-item">
                        <strong>{entry.nameUz}</strong>
                        <div className="muted-text">
                          Yo‘l: <code>{entry.path}</code>
                        </div>
                        <div className="muted-text">Kelib chiqishi: {entry.originUz}</div>
                        <div className="muted-text">Litsenziya: {entry.license}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </details>
            </section>

            <section className="parent-card danger-zone-card">
              <h3 className="danger-zone-title">Xavfli amal</h3>
              <p className="muted-text" style={{ marginTop: 0 }}>
                Farzandingizning barcha yulduzchalari, o‘qilgan so‘zlari va mashq tarixi butunlay
                o‘chiriladi. PIN-kod va hisob saqlanib qoladi.
              </p>
              {!confirmReset ? (
                <button
                  type="button"
                  className="btn-reset btn-with-icon"
                  onClick={() => setConfirmReset(true)}
                >
                  <Trash2 size={16} />
                  <span>Barcha natijalarni tozalash</span>
                </button>
              ) : (
                <div className="danger-confirm-row">
                  <button
                    type="button"
                    className="btn-reset"
                    onClick={() => {
                      setConfirmReset(false);
                      onResetProgress();
                    }}
                  >
                    Ha, barchasini tozalash
                  </button>
                  <button
                    type="button"
                    className="btn-3d-cream btn-compact"
                    onClick={() => setConfirmReset(false)}
                  >
                    Bekor qilish
                  </button>
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      {/* Mobile Bottom Nav */}
      <nav className="parent-bottom-nav" aria-label="Ota-ona pastki menyusi">
        {navItems.map((nav) => (
          <button
            key={nav.id}
            type="button"
            className={`parent-bottom-tab ${
              activeTab === nav.id ? 'parent-bottom-tab-active' : ''
            }`}
            aria-current={activeTab === nav.id ? 'page' : undefined}
            onClick={() => {
              playFeedbackChime('pop');
              setActiveTab(nav.id);
            }}
          >
            <span className="parent-bottom-icon" aria-hidden="true">
              {nav.icon}
              {nav.badge !== undefined && <span className="parent-bottom-dot">{nav.badge}</span>}
            </span>
            <span className="parent-bottom-label">{nav.label}</span>
          </button>
        ))}
      </nav>
      <FeedbackModal
        isOpen={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        childName={state.profile.name}
        publicId={displayPublicId}
        isGuest={isGuest}
        sessionsCompleted={state.completedSessionsCount}
      />
      <ParentNotificationsPanel
        isOpen={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        isGuest={isGuest}
        dbConfigured={notifDbConfigured}
        notifications={notifications}
        settings={reminderSettings}
        onSettingsUpdated={setReminderSettings}
        onRefreshCenter={refreshNotificationCenter}
        onMarkAllRead={handleMarkNotificationsRead}
        onNotificationAction={handleNotificationAction}
        onOpenGuestUpgrade={onOpenGuestUpgrade}
      />
    </div>
  );
}
