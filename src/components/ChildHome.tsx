import { useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  DYNAMIC_WORD_POOL,
  READING_WORLDS,
  type ReadingWorld,
} from '../data/curriculum';
import { getAvatarOption } from '../logic/gamification';
import type { ScreenTimeStatus } from '../logic/wordPoolEngine';
import {
  playFeedbackChime,
  playInstructionAudio,
  playInstructionAutoOnEntry,
} from '../utils/audioRecorder';
import { AccountIdBadge } from './AccountIdBadge';
import { AnimatedCharacter } from './AnimatedCharacter';
import { Clock, Play, Star } from './Icons';
import { WorldIslandArt } from './WorldIslandArt';

interface ChildHomeProps {
  childName: string;
  avatarId: string;
  publicId?: string;
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

export function ChildHome({
  childName,
  avatarId,
  publicId,
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

  const handlePlayGreeting = () => {
    void playInstructionAudio(
      screenTime.isLimitReached ? 'instr_home_sleep' : 'instr_home_welcome',
    );
  };

  useEffect(() => {
    const key = screenTime.isLimitReached ? 'instr_home_sleep' : 'instr_home_welcome';
    return playInstructionAutoOnEntry(key);
  }, [screenTime.isLimitReached]);

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
            avatarId={avatar.id}
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
          <div className="home-mascot-stage">
            <AnimatedCharacter
              mood="idle"
              size={188}
              avatarId={avatar.id}
              layout="stacked"
              bubblePosition="top"
              speechText={`Salom, ${displayName}! Keling, o‘qiymiz!`}
              onReplaySpeech={handlePlayGreeting}
            />
          </div>

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

          {publicId && (
            <AccountIdBadge publicId={publicId} label="ID:" variant="compact" />
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

      {/* Right 65% Panel: 5-World Adventure Map */}
      <section className="home-map-column" aria-label="5 ta o‘qish olami sarguzasht xaritasi">
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
    </div>
  );
}
