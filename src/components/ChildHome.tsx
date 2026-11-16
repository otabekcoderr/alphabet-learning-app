import { CURRICULUM_ITEMS, CURRICULUM_STAGES, getLetterCategory, type CurriculumItem } from '../data/curriculum';
import { calculateTotalXp } from '../logic/gamification';
import type { ItemProgress } from '../logic/pedagogy';
import { playAudioClip } from '../utils/audioRecorder';
import { LetterBlock } from './LetterBlock';
import { MascotSvg } from './MascotSvg';

interface ChildHomeProps {
  recommendedItem: CurriculumItem | null;
  progressByItem: Record<string, ItemProgress>;
  totalStars: number;
  totalEffortStars: number;
  dailyGoalXp: number;
  childName: string;
  streakDays: number;
  blockedByUnverifiedCap: boolean;
  parentSessionActive: boolean;
  onStartLesson: (item: CurriculumItem) => void;
  onExitParentSession: () => void;
}

interface StageTheme {
  icon: string;
  title: string;
  bgTint: string;
  borderTint: string;
}

const STAGE_THEMES: Record<number, StageTheme> = {
  1: { icon: '🏝️', title: '1-orol: Unlilar vodiysi', bgTint: '#fff5f5', borderTint: '#ffc8c8' },
  2: { icon: '🌲', title: '2-orol: Bo‘g‘inlar o‘rmoni', bgTint: '#f0f9ff', borderTint: '#bae6fd' },
  3: { icon: '🏡', title: '3-orol: Ilk so‘zlar qishlog‘i', bgTint: '#f2fde4', borderTint: '#bbf7d0' },
  4: { icon: '🌊', title: '4-orol: Shovqinli daryo', bgTint: '#fff7ed', borderTint: '#fed7aa' },
  5: { icon: '🏰', title: '5-orol: Kitobxonlar qal’asi', bgTint: '#faf5ff', borderTint: '#e9d5ff' },
};

const NODE_OFFSET_PATTERN = ['pos-center', 'pos-right', 'pos-center', 'pos-left'] as const;

export function ChildHome({
  recommendedItem,
  progressByItem,
  totalStars,
  totalEffortStars,
  dailyGoalXp,
  childName,
  streakDays,
  blockedByUnverifiedCap,
  parentSessionActive,
  onStartLesson,
  onExitParentSession,
}: ChildHomeProps) {
  const masteredTotal = CURRICULUM_ITEMS.filter((item) => progressByItem[item.id]?.mastered).length;
  const allMastered = masteredTotal === CURRICULUM_ITEMS.length;
  const totalXp = calculateTotalXp(totalStars, totalEffortStars);
  const dailyXpProgress = Math.min(totalXp, dailyGoalXp);
  const dailyGoalPct = dailyGoalXp > 0 ? Math.min(100, Math.round((dailyXpProgress / dailyGoalXp) * 100)) : 0;
  const displayName = childName.trim() || 'Bolajon';

  return (
    <div className="child-home">
      {parentSessionActive && (
        <div className="parent-session-banner">
          <span>👨‍👩‍👧 Ota-ona yonida rejimi faol</span>
          <button type="button" className="btn-exit-session" onClick={onExitParentSession}>
            Chiqish
          </button>
        </div>
      )}

      {blockedByUnverifiedCap ? (
        <section className="child-hero-card hero-pause">
          <div className="mascot-row">
            <div className="mascot-avatar-svg-wrap">
              <MascotSvg mood="listening" size={72} />
            </div>
            <div className="mascot-bubble">
              <strong>Zukko Tulki:</strong> «{displayName}, ajoyib harakat! Endi ota-onang bilan oxirgi
              darslarni tekshirib olamiz.»
            </div>
          </div>
          <div className="child-pause-emoji" aria-hidden="true">
            🌟
          </div>
          <h2 className="child-pause-title">Ota-onang bilan ko‘rib chiqamiz</h2>
          <p className="child-pause-text">
            Sen 3 ta darsni mustaqil o‘tding! Keyingi orolga o‘tish uchun ota-ona tasdig‘i kerak.
          </p>
        </section>
      ) : (
        recommendedItem && (
          <section className="child-hero-card mascot-hero-card">
            <div className="hero-stats-strip">
              <span className="hero-stat-chip chip-streak">🔥 {streakDays} kun</span>
              <span className="hero-stat-chip chip-xp">⚡ {totalXp} XP</span>
              <span className="hero-stat-chip chip-stars">⭐ {totalStars}</span>
              <span className="hero-stat-chip chip-mastered">
                🏆 {masteredTotal}/{CURRICULUM_ITEMS.length}
              </span>
            </div>

            <div className="daily-goal-card">
              <div className="daily-goal-header">
                <span>🎯 Kunlik XP maqsadi</span>
                <strong>
                  {dailyXpProgress} / {dailyGoalXp} XP
                </strong>
              </div>
              <div
                className="xp-progress-track"
                role="progressbar"
                aria-label="Kunlik XP maqsadi"
                aria-valuenow={dailyGoalPct}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div className="xp-progress-fill" style={{ width: `${dailyGoalPct}%` }}>
                  <span className="duo-progress-shine" aria-hidden="true" />
                </div>
              </div>
            </div>

            <div className="mascot-row">
              <div className="mascot-avatar-svg-wrap mascot-bounce">
                <MascotSvg mood={allMastered ? 'cheering' : 'happy'} size={72} />
              </div>
              <div className="mascot-bubble">
                {allMastered ? (
                  <span>
                    <strong>Zukko Tulki:</strong> «Barakalla, {displayName}! Barcha {CURRICULUM_ITEMS.length} ta
                    darsni zabt etding! Istagan darsni takrorlashing mumkin.»
                  </span>
                ) : (
                  <span>
                    <strong>Zukko Tulki:</strong> «Salom, {displayName}! Bugun{' '}
                    <strong>{recommendedItem.text}</strong> darsini o‘ynaymiz!»
                  </span>
                )}
              </div>
            </div>

            <span className="child-stage-chip">
              {STAGE_THEMES[recommendedItem.stage]?.title ?? `${recommendedItem.stage}-bosqich`}
            </span>

            <div className="child-preview-row">
              {recommendedItem.parts.map((part, idx) => (
                <LetterBlock
                  key={`${recommendedItem.id}-${part}-${idx}`}
                  text={part}
                  size="xl"
                  onClick={() => void playAudioClip(recommendedItem.audioSound)}
                />
              ))}
            </div>

            <div className="hero-cta-group">
              <button
                type="button"
                className="btn-hear-child"
                onClick={() => void playAudioClip(recommendedItem.audioTeacher)}
              >
                🔊 Eshitish
              </button>

              <button
                type="button"
                className="btn-continue-big"
                onClick={() => onStartLesson(recommendedItem)}
              >
                ▶️ Davom etamiz (+20 XP)
              </button>
            </div>
          </section>
        )
      )}

      <section className="adventure-map" aria-label="Sarguzasht xaritasi">
        {CURRICULUM_STAGES.map((stage) => {
          const items = CURRICULUM_ITEMS.filter((i) => i.stage === stage.stage);
          const stageMastered = items.filter((i) => progressByItem[i.id]?.mastered).length;
          const pct = items.length ? Math.round((stageMastered / items.length) * 100) : 0;
          const chestUnlocked = items.length > 0 && stageMastered === items.length;
          const theme = STAGE_THEMES[stage.stage] ?? {
            icon: '✨',
            title: stage.title,
            bgTint: '#ffffff',
            borderTint: '#e5e5e5',
          };

          return (
            <div
              key={stage.stage}
              className="island-card"
              style={{
                borderColor: theme.borderTint,
                backgroundColor: '#ffffff',
              }}
            >
              <header className="island-header" style={{ backgroundColor: stage.accentColor }}>
                <div className="island-title-wrap">
                  <span className="island-icon" aria-hidden="true">
                    {theme.icon}
                  </span>
                  <div>
                    <h3 className="island-title">{theme.title}</h3>
                    <p className="island-subtitle">{stage.subtitle}</p>
                  </div>
                </div>
                <span className="island-count-pill">
                  {stageMastered}/{items.length}
                </span>
              </header>

              <div className="island-progress-track" aria-hidden="true">
                <div
                  className="island-progress-fill"
                  style={{ width: `${pct}%`, backgroundColor: stage.accentColor }}
                />
              </div>

              <div className="path-nodes" style={{ backgroundColor: theme.bgTint }}>
                {items.map((item, idx) => {
                  const prog = progressByItem[item.id];
                  const isMastered = Boolean(prog?.mastered);
                  const isUnverified = prog?.status === 'unverified' && !isMastered;
                  const isCurrent = !blockedByUnverifiedCap && !allMastered && item.id === recommendedItem?.id;
                  const isLocked = !isMastered && !isUnverified && !isCurrent;
                  const isDisabled = isLocked || (blockedByUnverifiedCap && !isMastered);
                  const offsetClass = NODE_OFFSET_PATTERN[idx % NODE_OFFSET_PATTERN.length] ?? 'pos-center';
                  const stateClass = isMastered
                    ? 'node-mastered'
                    : isCurrent
                      ? 'node-current'
                      : isUnverified
                        ? 'node-unverified'
                        : 'node-locked';

                  const kindLabel =
                    item.kind === 'letter' ? 'Harf' : item.kind === 'syllable' ? 'Bo‘g‘in' : 'So‘z';

                  return (
                    <div key={item.id} className={`path-node-row ${offsetClass}`}>
                      <div className="path-node-holder">
                        {isCurrent && <span className="floating-start-badge">BOSHLASH!</span>}
                        {isMastered && (
                          <span className="node-crown-badge" aria-hidden="true">
                            👑
                          </span>
                        )}
                        <button
                          type="button"
                          disabled={isDisabled}
                          className={`path-node ${stateClass}`}
                          aria-label={`${item.text} (${kindLabel})${isLocked ? ' — qulflangan' : ''}`}
                          onClick={() => onStartLesson(item)}
                        >
                          {isLocked ? (
                            <span className="node-lock-icon" aria-hidden="true">
                              🔒
                            </span>
                          ) : (
                            <span className="node-main-text">
                              {[...item.text].map((ch, cIdx) => (
                                <span
                                  key={`${item.id}-${ch}-${cIdx}`}
                                  className={
                                    isCurrent
                                      ? 'node-char-current'
                                      : getLetterCategory(ch) === 'vowel'
                                        ? 'char-vowel'
                                        : 'char-consonant'
                                  }
                                >
                                  {ch}
                                </span>
                              ))}
                            </span>
                          )}

                          <span className="node-sub-badge">
                            {isMastered
                              ? '⭐'.repeat(Math.max(1, prog?.stars ?? 1))
                              : isUnverified
                                ? '🌟 Tekshiriladi'
                                : isCurrent
                                  ? '▶️'
                                  : kindLabel}
                          </span>
                        </button>
                      </div>
                    </div>
                  );
                })}

                <div className="path-node-row pos-center">
                  <div
                    className={`treasure-node ${chestUnlocked ? 'treasure-unlocked' : 'treasure-locked'}`}
                    aria-label={chestUnlocked ? `${theme.title} sandig‘i ochildi` : `${theme.title} sandig‘i`}
                  >
                    <span className="treasure-icon" aria-hidden="true">
                      {chestUnlocked ? '🎉🎁' : '🎁'}
                    </span>
                    <span className="treasure-label">
                      {chestUnlocked ? 'Sandiq ochildi!' : 'Bosqich sovg‘asi'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
