import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  COMING_SOON_SYLLABLE_FOREST,
  DYNAMIC_WORD_POOL,
  READING_WORLDS,
  type ReadingWorld,
} from '../data/curriculum';
import {
  AVATAR_OPTIONS,
  createRandomChildProfile,
  getAvatarOption,
  NICKNAME_PRESETS,
} from '../logic/gamification';
import type { ScreenTimeStatus } from '../logic/wordPoolEngine';
import {
  playFeedbackChime,
  playInstructionAudio,
  playInstructionAutoOnEntry,
  preloadAudioUrls,
} from '../utils/audioRecorder';
import { isStandaloneDisplayMode } from '../utils/pwa';
import { isTelegramWebAppContext, openExternalPwaBridge } from '../utils/telegramWebApp';
import { AccountIdBadge } from './AccountIdBadge';
import { AnimatedCharacter } from './AnimatedCharacter';
import { AvatarVisual } from './AvatarVisual';
import { GuestSaveBanner } from './GuestSaveBanner';
import {
  Clock,
  CloseIcon,
  ExternalLink,
  Play,
  RotateCcw,
  Smartphone,
  Sparkles,
  Star,
  Volume2,
} from './Icons';
import { PwaInstallBanner } from './PwaInstallBanner';
import { WorldIslandArt } from './WorldIslandArt';

interface ChildHomeProps {
  childName: string;
  avatarId: string;
  publicId?: string;
  isGuest?: boolean;
  onOpenGuestUpgrade?: () => void;
  onUpdateChildProfile?: (patch: { name: string; avatarId: string }) => void;
  seenWordIds: string[];
  masteredWordsCount?: number;
  activeWorldId: number;
  screenTime: ScreenTimeStatus;
  onStartWorldRound: (worldId: 1 | 2 | 3 | 4 | 5) => void;
  onOpenAlphabetRecall: () => void;
}

const SHORT_WORLD_TITLES: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: 'Ilk bo‘g‘inlar o‘rmoni',
  2: 'Chaqqon so‘zlar vodiysi',
  3: 'Sirli harf birikmalari',
  4: 'Ravon kitobxon qal’asi',
  5: 'Qisqa gaplar olami',
};

export function resolveHomeBannerMode(params: {
  isGuest: boolean;
  hasGuestUpgrade: boolean;
  seenWordsCount: number;
  masteredWordsCount: number;
}): 'guest' | 'pwa' {
  if (
    params.isGuest &&
    params.hasGuestUpgrade &&
    (params.seenWordsCount > 0 || params.masteredWordsCount > 0)
  ) {
    return 'guest';
  }
  return 'pwa';
}

export function ChildHome({
  childName,
  avatarId,
  publicId,
  isGuest = false,
  onOpenGuestUpgrade,
  onUpdateChildProfile,
  seenWordIds,
  masteredWordsCount = 0,
  activeWorldId,
  screenTime,
  onStartWorldRound,
  onOpenAlphabetRecall,
}: ChildHomeProps) {
  const displayName = childName.trim() || 'Bolajon';
  const avatar = getAvatarOption(avatarId);
  const seenSet = new Set(seenWordIds);
  const totalUniqueRead = DYNAMIC_WORD_POOL.filter((item) => seenSet.has(item.id)).length;
  const activeWorld: ReadingWorld =
    READING_WORLDS.find((w) => w.worldId === activeWorldId) ?? READING_WORLDS[0]!;

  const activeWorldWords = DYNAMIC_WORD_POOL.filter(
    (item) => item.worldId === activeWorld.worldId,
  );
  const activeWorldRemaining = activeWorldWords.filter((item) => !seenSet.has(item.id)).length;
  const homeBannerMode = resolveHomeBannerMode({
    isGuest,
    hasGuestUpgrade: Boolean(onOpenGuestUpgrade),
    seenWordsCount: seenWordIds.length,
    masteredWordsCount,
  });

  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [draftName, setDraftName] = useState(displayName);
  const [draftAvatarId, setDraftAvatarId] = useState(avatar.id);
  const [forestInfoOpen, setForestInfoOpen] = useState(false);

  const showTelegramPwaBridge = isTelegramWebAppContext() && !isStandaloneDisplayMode();

  const handlePlayGreeting = () => {
    void playInstructionAudio(
      screenTime.isLimitReached ? 'instr_home_sleep' : 'instr_home_welcome',
    );
  };

  useEffect(() => {
    void preloadAudioUrls([
      '/audio/instr_home_welcome.mp3',
      '/audio/instr_home_sleep.mp3',
      '/audio/bismillah.mp3',
      '/audio/instr_alpha_chart.mp3',
    ]);
  }, []);

  useEffect(() => {
    const key = screenTime.isLimitReached ? 'instr_home_sleep' : 'instr_home_welcome';
    return playInstructionAutoOnEntry(key);
  }, [screenTime.isLimitReached]);

  const openProfileEditor = () => {
    playFeedbackChime('pop');
    setDraftName(displayName);
    setDraftAvatarId(avatar.id);
    setProfileModalOpen(true);
  };

  const handleRandomizeDraftProfile = () => {
    playFeedbackChime('marimba');
    const next = createRandomChildProfile(Math.random, {
      name: draftName,
      avatarId: draftAvatarId,
    });
    setDraftName(next.name);
    setDraftAvatarId(next.avatarId);
  };

  const handleSaveDraftProfile = () => {
    if (!onUpdateChildProfile) return;
    playFeedbackChime('chime');
    onUpdateChildProfile({
      name: draftName.trim().slice(0, 20) || 'Bolajon',
      avatarId: draftAvatarId || 'fox',
    });
    setProfileModalOpen(false);
  };

  const renderIslandNode = (world: ReadingWorld, idx: number, placementClass: string) => {
    const itemsInWorld = DYNAMIC_WORD_POOL.filter((item) => item.worldId === world.worldId);
    const readCount = itemsInWorld.filter((item) => seenSet.has(item.id)).length;
    const isSelected = world.worldId === activeWorld.worldId;

    return (
      <motion.button
        key={world.worldId}
        type="button"
        initial={{ opacity: 0, y: 16, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: idx * 0.06, type: 'spring', stiffness: 280, damping: 22 }}
        whileHover={{ y: -5, scale: 1.03 }}
        whileTap={{ scale: 0.96 }}
        className={`world-card island-node ${placementClass} ${
          isSelected ? 'island-node-active' : ''
        }`}
        onClick={() => {
          playFeedbackChime('pop');
          onStartWorldRound(world.worldId);
        }}
        aria-label={`${world.worldId}-olam: ${SHORT_WORLD_TITLES[world.worldId]} (${readCount}/${itemsInWorld.length})`}
      >
        <div className="island-art-wrap">
          <WorldIslandArt worldId={world.worldId} />
          <span
            className={`island-number-badge ${isSelected ? 'island-badge-active' : ''}`}
            aria-hidden="true"
          >
            {world.worldId}
          </span>
        </div>

        <span className="island-olam-heading">{world.worldId}-olam</span>
        <span className="island-olam-sub">{SHORT_WORLD_TITLES[world.worldId]}</span>
        <span className="island-progress-pill">
          {readCount}/{itemsInWorld.length} so‘z
        </span>
      </motion.button>
    );
  };

  if (screenTime.isLimitReached) {
    return (
      <div className="child-home child-home-sleep">
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="sleep-hero-card"
        >
          <AnimatedCharacter
            mood="sleeping"
            size={156}
            avatarId="fox"
            layout="stacked"
            bubblePosition="top"
            speechText={`Barakalla, ${displayName}! Bugungi ${screenTime.dailyLimitMinutes} daqiqalik mashqni a’lo bajarding! Endi ko‘zlarimiz dam olsin.`}
            onReplaySpeech={handlePlayGreeting}
          />

          <div className="home-stats-row">
            <span className="home-stat-pill">
              <Star size={15} />
              <span>
                {masteredWordsCount}/{DYNAMIC_WORD_POOL.length} mustaqil · {totalUniqueRead} ko‘rildi
              </span>
            </span>
          </div>

          <button
            type="button"
            className="btn-3d-cream btn-hear-child"
            onClick={() => {
              playFeedbackChime('pop');
              onOpenAlphabetRecall();
            }}
          >
            Harflarni takrorlash (29 harf + ’)
          </button>
        </motion.section>
      </div>
    );
  }

  return (
    <div className="child-home-layout">
      {/* Left 35% Panel (Desktop) / Top Compact Welcome Banner (Mobile) */}
      <motion.aside
        initial={{ opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 24 }}
        className="home-mascot-column"
      >
        <div className="home-mascot-card">
          {showTelegramPwaBridge && (
            <div className="tg-pwa-bridge-bar" role="region" aria-label="Ilovada ochish">
              <div className="tg-pwa-bridge-copy">
                <Smartphone size={15} aria-hidden="true" />
                <span>O‘rnatilgan ilova bo‘lsa, unda oching</span>
              </div>
              <button
                type="button"
                className="btn-3d-cream btn-compact btn-with-icon tg-pwa-bridge-btn"
                onClick={() => {
                  playFeedbackChime('pop');
                  openExternalPwaBridge();
                }}
              >
                <ExternalLink size={14} />
                <span>Ilovada ochish</span>
              </button>
            </div>
          )}

          <div className="home-mascot-top-grid">
            <div className="home-mascot-avatar-col">
              {/* Mascot hero is strictly Zukko Tulki */}
              <AnimatedCharacter
                mood="idle"
                size={168}
                avatarId="fox"
                layout="compact"
                bubblePosition="none"
              />
            </div>

            <div className="home-mascot-info-col">
              <div className="zukko-speech-bubble home-greeting-bubble">
                <span className="zukko-speech-text">
                  {`Salom, ${displayName}! Keling, o‘qiymiz!`}
                </span>
                <button
                  type="button"
                  className="btn-bubble-audio"
                  onClick={handlePlayGreeting}
                  aria-label="Gapni qayta eshitish"
                  title="Eshitish"
                >
                  <Volume2 size={16} strokeWidth={2.5} />
                </button>
              </div>

              {onUpdateChildProfile ? (
                <div className="child-profile-chip-row">
                  <button
                    type="button"
                    className="child-profile-chip-btn"
                    onClick={openProfileEditor}
                    aria-label="Bola ismi va rasmini o‘zgartirish"
                  >
                    <span
                      className="child-profile-chip-avatar"
                      style={{ backgroundColor: avatar.bg, borderColor: avatar.border }}
                      aria-hidden="true"
                    >
                      <AvatarVisual avatarId={avatar.id} size={22} />
                    </span>
                    <span className="child-profile-chip-name">{displayName}</span>
                    <span className="child-profile-chip-edit">Rasm/Ism</span>
                  </button>
                </div>
              ) : null}

              <div className="home-active-world-meta">
                <span className="home-active-world-tag">{activeWorld.titleUz}</span>
                <p className="home-active-world-note">
                  {activeWorldRemaining > 0
                    ? `${activeWorldRemaining} ta yangi so‘z seni kutmoqda!`
                    : 'Barcha so‘zlarni birga mustahkamlaymiz!'}
                </p>
              </div>

              <div className="home-stats-row">
                <span className="home-stat-pill">
                  <Star size={14} className="stat-star-icon" />
                  <span>
                    {masteredWordsCount}/{DYNAMIC_WORD_POOL.length} mustaqil
                  </span>
                </span>
                <span className="home-stat-pill" title="Bugungi sog‘lom ekran vaqti">
                  <Clock size={14} />
                  <span>{screenTime.remainingMinutes} daq qoldi</span>
                </span>
              </div>
            </div>
          </div>

          {!isGuest && publicId && (
            <AccountIdBadge publicId={publicId} label="ID:" variant="compact" />
          )}

          {homeBannerMode === 'guest' && onOpenGuestUpgrade ? (
            <GuestSaveBanner variant="compact" onSaveAccount={onOpenGuestUpgrade} />
          ) : (
            <PwaInstallBanner variant="home" />
          )}

          <div className="daily-time-bar-wrap" aria-label="Kunlik mashq vaqti">
            <div className="daily-time-bar-track">
              <div
                className="daily-time-bar-fill"
                style={{ width: `${screenTime.progressPct}%` }}
              />
            </div>
          </div>

          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            className="btn-3d-emerald btn-continue-big home-desktop-cta"
            onClick={() => {
              playFeedbackChime('pop');
              onStartWorldRound(activeWorld.worldId);
            }}
          >
            <Play size={22} fill="currentColor" aria-hidden="true" />
            <span>O‘yinni boshlash!</span>
          </motion.button>
        </div>
      </motion.aside>

      {/* Right 65% Panel: 5-World Adventure Map + Separate Coming Soon Syllable Forest */}
      <section className="home-map-column" aria-label="O‘qish olamlari xaritasi">
        <div className="home-map-stack">
          <div className="adventure-map-board">
            {/* Winding golden dotted path connecting 1 -> 2 -> 3 -> 4 -> 5 */}
            <svg
              className="adventure-trail-svg"
              viewBox="0 0 720 560"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path
                d="M 185 110 C 310 60, 430 60, 540 120 C 620 165, 480 265, 360 285 C 235 305, 115 385, 195 455 C 295 520, 445 520, 540 465"
                fill="none"
                stroke="#FDE68A"
                strokeWidth="12"
                strokeLinecap="round"
                strokeDasharray="16 18"
              />
              <path
                d="M 185 110 C 310 60, 430 60, 540 120 C 620 165, 480 265, 360 285 C 235 305, 115 385, 195 455 C 295 520, 445 520, 540 465"
                fill="none"
                stroke="#F59E0B"
                strokeOpacity="0.45"
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray="16 18"
              />
              {/* Decorative golden trail stars */}
              {[
                { cx: 360, cy: 76 },
                { cx: 530, cy: 230 },
                { cx: 195, cy: 330 },
                { cx: 365, cy: 500 },
              ].map((pt, i) => (
                <g key={i} transform={`translate(${pt.cx - 14}, ${pt.cy - 14})`}>
                  <path
                    d="M14 2L17.4 9.1L25.2 10.2L19.6 15.7L20.9 23.5L14 19.8L7.1 23.5L8.4 15.7L2.8 10.2L10.6 9.1L14 2Z"
                    fill="#FBBF24"
                    stroke="#D97706"
                    strokeWidth="2"
                    strokeLinejoin="round"
                  />
                </g>
              ))}
            </svg>

            <div className="adventure-islands-grid">
              <div className="adventure-row-pair">
                {READING_WORLDS[0] && renderIslandNode(READING_WORLDS[0], 0, 'island-pos-1')}
                {READING_WORLDS[1] && renderIslandNode(READING_WORLDS[1], 1, 'island-pos-2')}
              </div>

              <div className="adventure-row-center">
                {READING_WORLDS[2] && renderIslandNode(READING_WORLDS[2], 2, 'island-pos-3')}
              </div>

              <div className="adventure-row-pair">
                {READING_WORLDS[3] && renderIslandNode(READING_WORLDS[3], 3, 'island-pos-4')}
                {READING_WORLDS[4] && renderIslandNode(READING_WORLDS[4], 4, 'island-pos-5')}
              </div>
            </div>
          </div>

          {/* Separate "Bo‘g‘inlashni o‘rgatish" Forest Island (Tez kunda) */}
          <div className="syllable-forest-dock">
            <motion.button
              type="button"
              whileHover={{ y: -3, scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              className="island-node island-node-coming-soon"
              onClick={() => {
                playFeedbackChime('pop');
                setForestInfoOpen(true);
              }}
              aria-label={`${COMING_SOON_SYLLABLE_FOREST.titleUz} — ${COMING_SOON_SYLLABLE_FOREST.badgeUz}`}
            >
              <div className="island-art-wrap island-art-forest">
                <WorldIslandArt worldId="syllable_forest" />
                <span className="island-coming-soon-badge">
                  <Sparkles size={12} aria-hidden="true" />
                  <span>{COMING_SOON_SYLLABLE_FOREST.badgeUz}</span>
                </span>
              </div>
              <span className="island-olam-heading">{COMING_SOON_SYLLABLE_FOREST.titleUz}</span>
              <span className="island-olam-sub">{COMING_SOON_SYLLABLE_FOREST.subtitleUz}</span>
            </motion.button>
          </div>
        </div>
      </section>

      {/* Mobile Sticky Bottom Thumb-Zone CTA */}
      <div className="mobile-sticky-thumb-zone">
        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          className="btn-3d-emerald btn-continue-big"
          onClick={() => {
            playFeedbackChime('pop');
            onStartWorldRound(activeWorld.worldId);
          }}
        >
          <Play size={22} fill="currentColor" aria-hidden="true" />
          <span>O‘yinni boshlash!</span>
        </motion.button>
      </div>

      {/* Coming Soon Forest Info Modal */}
      <AnimatePresence>
        {forestInfoOpen && (
          <div
            className="modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="syllable-forest-modal-title"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                playFeedbackChime('pop');
                setForestInfoOpen(false);
              }
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 14 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 10 }}
              className="modal-card welcome-info-modal"
            >
              <div className="modal-header-row">
                <h2 id="syllable-forest-modal-title" className="modal-title">
                  {COMING_SOON_SYLLABLE_FOREST.infoTitleUz}
                </h2>
                <button
                  type="button"
                  className="btn-circle-close"
                  onClick={() => {
                    playFeedbackChime('pop');
                    setForestInfoOpen(false);
                  }}
                  aria-label="Yopish"
                >
                  <CloseIcon size={18} />
                </button>
              </div>

              <div className="syllable-forest-modal-preview">
                <WorldIslandArt worldId="syllable_forest" />
              </div>

              <p className="welcome-info-copy">{COMING_SOON_SYLLABLE_FOREST.infoBodyUz}</p>

              <div className="syllable-forest-modal-actions">
                <button
                  type="button"
                  className="btn-3d-emerald"
                  onClick={() => {
                    playFeedbackChime('pop');
                    setForestInfoOpen(false);
                    onStartWorldRound(1);
                  }}
                >
                  1-olamdan mashq boshlash
                </button>
                <button
                  type="button"
                  className="btn-3d-cream"
                  onClick={() => {
                    playFeedbackChime('pop');
                    setForestInfoOpen(false);
                  }}
                >
                  Tushunarli
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Child In-Game Name & Picture Editor Modal (Randomize / Custom) */}
      <AnimatePresence>
        {profileModalOpen && onUpdateChildProfile && (
          <div
            className="modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="child-profile-modal-title"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                playFeedbackChime('pop');
                setProfileModalOpen(false);
              }
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 14 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 10 }}
              className="modal-card child-profile-modal"
            >
              <div className="modal-header-row">
                <h2 id="child-profile-modal-title" className="modal-title">
                  O‘yinchi ismi va rasmi
                </h2>
                <button
                  type="button"
                  className="btn-circle-close"
                  onClick={() => {
                    playFeedbackChime('pop');
                    setProfileModalOpen(false);
                  }}
                  aria-label="Yopish"
                >
                  <CloseIcon size={18} />
                </button>
              </div>

              <button
                type="button"
                className="btn-3d-gold btn-compact btn-with-icon"
                onClick={handleRandomizeDraftProfile}
              >
                <RotateCcw size={15} />
                <span>Tasodifiy belgilash</span>
              </button>

              <label className="pin-label" style={{ marginTop: 10 }}>
                O‘yindagi ism (taxallus)
                <input
                  type="text"
                  maxLength={20}
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder="Masalan: Zukko"
                  className="parent-text-input auth-full-input"
                />
              </label>

              <div className="nickname-presets-row" aria-label="Tayyor taxalluslar">
                {NICKNAME_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={`btn-3d-cream btn-compact ${draftName === preset ? 'preset-active' : ''}`}
                    onClick={() => {
                      playFeedbackChime('pop');
                      setDraftName(preset);
                    }}
                  >
                    {preset}
                  </button>
                ))}
              </div>

              <div className="avatar-picker-grid" role="radiogroup" aria-label="Rasm tanlash">
                {AVATAR_OPTIONS.map((av) => {
                  const selected = av.id === draftAvatarId;
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
                      onClick={() => {
                        playFeedbackChime('pop');
                        setDraftAvatarId(av.id);
                      }}
                    >
                      <span className="avatar-choice-emoji avatar-visual-wrap" aria-hidden="true">
                        <AvatarVisual avatarId={av.id} size={34} />
                      </span>
                      <span className="avatar-choice-label">{av.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="syllable-forest-modal-actions" style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className="btn-3d-emerald"
                  onClick={handleSaveDraftProfile}
                >
                  Saqlash
                </button>
                <button
                  type="button"
                  className="btn-3d-cream"
                  onClick={() => {
                    playFeedbackChime('pop');
                    setProfileModalOpen(false);
                  }}
                >
                  Bekor qilish
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
