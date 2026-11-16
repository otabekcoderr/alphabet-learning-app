import { CURRICULUM_ITEMS, getLetterCategory, type CurriculumItem } from '../data/curriculum';
import {
  AVATAR_OPTIONS,
  buildWeekStreakDays,
  calculateTotalXp,
  DAILY_GOAL_OPTIONS,
  getAchievements,
  getAvatarOption,
  getLevelInfo,
} from '../logic/gamification';
import type { AlifboState, ChildProfileData } from '../storage/progressStorage';
import { playAudioClip } from '../utils/audioRecorder';

interface ChildProfileProps {
  state: AlifboState;
  onUpdateProfile: (profile: ChildProfileData) => void;
  onStartLesson: (item: CurriculumItem) => void;
}

export function ChildProfile({ state, onUpdateProfile, onStartLesson }: ChildProfileProps) {
  const { profile } = state;
  const activeAvatar = getAvatarOption(profile.avatarId);
  const totalXp = calculateTotalXp(state.totalStars, state.totalEffortStars);
  const levelInfo = getLevelInfo(totalXp);
  const weekDays = buildWeekStreakDays(state.practiceDates);
  const achievements = getAchievements(CURRICULUM_ITEMS, state);
  const unlockedCount = achievements.filter((b) => b.unlocked).length;
  const masteredItems = CURRICULUM_ITEMS.filter((item) => state.progressByItem[item.id]?.mastered);
  const totalStarsEarned = state.totalStars + state.totalEffortStars;
  const dailyXpProgress = Math.min(totalXp, profile.dailyGoalXp);
  const dailyGoalPct = profile.dailyGoalXp > 0 ? Math.min(100, Math.round((dailyXpProgress / profile.dailyGoalXp) * 100)) : 0;

  return (
    <div className="profile-shell">
      <section className="profile-hero-card">
        <div className="profile-identity-row">
          <div
            className="profile-avatar-large"
            style={{ backgroundColor: activeAvatar.bg, borderColor: activeAvatar.border }}
            aria-label={`Tanlangan qahramon: ${activeAvatar.label}`}
          >
            <span aria-hidden="true">{activeAvatar.emoji}</span>
          </div>

          <div className="profile-identity-fields">
            <div className="profile-level-row">
              <span className="level-pill">
                {levelInfo.icon} {levelInfo.level}-daraja · {levelInfo.title}
              </span>
              <span className="xp-pill">⚡ {totalXp} XP</span>
            </div>

            <label className="profile-name-label" htmlFor="child-name-input">
              O‘quvchi ismi
            </label>
            <input
              id="child-name-input"
              type="text"
              maxLength={24}
              value={profile.name}
              placeholder="Ismingizni yozing"
              className="profile-name-input"
              onChange={(e) => onUpdateProfile({ ...profile, name: e.target.value })}
            />

            <div className="level-progress-wrap">
              <div className="level-progress-meta">
                <span>Keyingi darajagacha</span>
                <strong>
                  {levelInfo.xpToNext > 0 ? `Yana ${levelInfo.xpToNext} XP` : 'Eng yuqori daraja! 👑'}
                </strong>
              </div>
              <div
                className="xp-progress-track"
                role="progressbar"
                aria-label="Daraja taraqqiyoti"
                aria-valuenow={levelInfo.pct}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div className="xp-progress-fill" style={{ width: `${levelInfo.pct}%` }}>
                  <span className="duo-progress-shine" aria-hidden="true" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="profile-customize-grid">
          <div className="customize-panel">
            <h3>🎭 Qahramonni tanlang</h3>
            <div className="avatar-picker-grid" role="radiogroup" aria-label="Qahramon tanlash">
              {AVATAR_OPTIONS.map((av) => {
                const selected = av.id === profile.avatarId;
                return (
                  <button
                    key={av.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`avatar-choice-btn ${selected ? 'avatar-choice-selected' : ''}`}
                    style={{ backgroundColor: av.bg, borderColor: selected ? '#58cc02' : av.border }}
                    onClick={() => onUpdateProfile({ ...profile, avatarId: av.id })}
                  >
                    <span className="avatar-choice-emoji" aria-hidden="true">
                      {av.emoji}
                    </span>
                    <span className="avatar-choice-label">{av.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="customize-panel">
            <h3>🎯 Kunlik XP maqsadi</h3>
            <p className="muted-text" style={{ marginTop: 0, fontSize: 13 }}>
              Har kuni kamida qancha XP to‘plashni maqsad qilasiz?
            </p>
            <div className="goal-selector-row" role="radiogroup" aria-label="Kunlik XP maqsadi">
              {DAILY_GOAL_OPTIONS.map((goal) => {
                const active = profile.dailyGoalXp === goal;
                return (
                  <button
                    key={goal}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`goal-option-btn ${active ? 'goal-option-active' : ''}`}
                    onClick={() => onUpdateProfile({ ...profile, dailyGoalXp: goal })}
                  >
                    <strong>⚡ {goal} XP</strong>
                    <span>{goal === 30 ? 'Yengil' : goal === 60 ? 'O‘rtacha' : 'Faol'}</span>
                  </button>
                );
              })}
            </div>
            <div className="daily-goal-mini">
              <div className="level-progress-meta">
                <span>Kunlik maqsad holati</span>
                <strong>
                  {dailyXpProgress}/{profile.dailyGoalXp} XP ({dailyGoalPct}%)
                </strong>
              </div>
              <div className="xp-progress-track">
                <div className="xp-progress-fill" style={{ width: `${dailyGoalPct}%` }} />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="profile-stats-grid" aria-label="Asosiy ko‘rsatkichlar">
        <div className="profile-stat-card stat-streak">
          <span className="profile-stat-icon" aria-hidden="true">
            🔥
          </span>
          <strong className="profile-stat-value">{state.practiceDates.length} kun</strong>
          <span className="profile-stat-title">Mashg‘ulot seriyasi</span>
        </div>
        <div className="profile-stat-card stat-xp">
          <span className="profile-stat-icon" aria-hidden="true">
            ⚡
          </span>
          <strong className="profile-stat-value">{totalXp} XP</strong>
          <span className="profile-stat-title">Jami tajriba bali</span>
        </div>
        <div className="profile-stat-card stat-stars">
          <span className="profile-stat-icon" aria-hidden="true">
            ⭐
          </span>
          <strong className="profile-stat-value">{totalStarsEarned}</strong>
          <span className="profile-stat-title">To‘plangan yulduzlar</span>
        </div>
        <div className="profile-stat-card stat-mastered">
          <span className="profile-stat-icon" aria-hidden="true">
            🏆
          </span>
          <strong className="profile-stat-value">
            {masteredItems.length} / {CURRICULUM_ITEMS.length}
          </strong>
          <span className="profile-stat-title">O‘zlashtirilgan dars</span>
        </div>
      </section>

      <section className="profile-section-card">
        <div className="section-heading-row">
          <h3>📅 Oxirgi 7 kunlik faollik</h3>
          <span className="section-meta-pill">🔥 {state.practiceDates.length} kun jami</span>
        </div>
        <div className="week-streak-strip">
          {weekDays.map((day) => (
            <div
              key={day.dateStr}
              className={`week-day-pill ${day.active ? 'week-day-active' : ''} ${day.isToday ? 'week-day-today' : ''}`}
            >
              <span className="week-day-label">{day.shortLabelUz}</span>
              <span className="week-day-circle" aria-hidden="true">
                {day.active ? '🔥' : day.isToday ? '•' : ''}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="profile-section-card">
        <div className="section-heading-row">
          <h3>🏅 Yutuqlar va Nishonlar</h3>
          <span className="section-meta-pill">
            {unlockedCount} / {achievements.length} ochildi
          </span>
        </div>
        <div className="achievements-grid">
          {achievements.map((badge) => {
            const pct = Math.min(100, Math.round((badge.current / Math.max(1, badge.target)) * 100));
            return (
              <div
                key={badge.id}
                className={`achievement-card ${badge.unlocked ? 'achievement-unlocked' : 'achievement-locked'}`}
              >
                <div className="achievement-top">
                  <span className="achievement-icon" aria-hidden="true">
                    {badge.icon}
                  </span>
                  <span className="achievement-status-tag">
                    {badge.unlocked ? '✅ Ochildi' : `${badge.current}/${badge.target}`}
                  </span>
                </div>
                <strong className="achievement-title">{badge.titleUz}</strong>
                <p className="achievement-desc">{badge.descUz}</p>
                <div className="achievement-bar-track" aria-hidden="true">
                  <div className="achievement-bar-fill" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="profile-section-card">
        <div className="section-heading-row">
          <h3>📚 Mening Harflarim va So‘zlarim</h3>
          <span className="section-meta-pill">{masteredItems.length} ta o‘zlashtirildi</span>
        </div>

        {masteredItems.length === 0 ? (
          <div className="collection-empty">
            <p className="muted-text">
              Hali o‘zlashtirilgan harf yoki so‘z yo‘q. Birinchi darsni boshlab kolleksiyangizni to‘ldiring!
            </p>
            {CURRICULUM_ITEMS[0] && (
              <button
                type="button"
                className="btn-primary"
                onClick={() => onStartLesson(CURRICULUM_ITEMS[0]!)}
              >
                ▶️ 1-darsni boshlash
              </button>
            )}
          </div>
        ) : (
          <div className="collection-grid">
            {masteredItems.map((item) => {
              const stars = state.progressByItem[item.id]?.stars ?? 1;
              return (
                <div key={item.id} className="collection-item-card">
                  <button
                    type="button"
                    className="collection-sound-btn"
                    onClick={() => void playAudioClip(item.audioSound)}
                    aria-label={`${item.text} tovushini eshitish`}
                  >
                    <span className="collection-text">
                      {[...item.text].map((ch, idx) => (
                        <span
                          key={`${item.id}-${ch}-${idx}`}
                          className={getLetterCategory(ch) === 'vowel' ? 'char-vowel' : 'char-consonant'}
                        >
                          {ch}
                        </span>
                      ))}
                    </span>
                    <span className="collection-meta">
                      {'⭐'.repeat(Math.max(1, stars))} · 🔊
                    </span>
                  </button>
                  <button
                    type="button"
                    className="collection-replay-link"
                    onClick={() => onStartLesson(item)}
                  >
                    Mashq →
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
