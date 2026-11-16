import type { CurriculumItem } from '../data/curriculum';
import { getLocalDateString, type AlifboState } from '../storage/progressStorage';

export interface AvatarOption {
  id: string;
  emoji: string;
  label: string;
  bg: string;
  border: string;
}

export const AVATAR_OPTIONS: AvatarOption[] = [
  { id: 'fox', emoji: '🦊', label: 'Tulki', bg: '#fff3e0', border: '#ff9600' },
  { id: 'lion', emoji: '🦁', label: 'Sher', bg: '#fef9c3', border: '#eab308' },
  { id: 'panda', emoji: '🐼', label: 'Panda', bg: '#f1f5f9', border: '#64748b' },
  { id: 'rabbit', emoji: '🐰', label: 'Quyon', bg: '#fce7f3', border: '#ec4899' },
  { id: 'tiger', emoji: '🐯', label: 'Yo‘lbars', bg: '#ffedd5', border: '#f97316' },
  { id: 'unicorn', emoji: '🦄', label: 'Yakkashox', bg: '#f3e8ff', border: '#a855f7' },
  { id: 'astronaut', emoji: '🚀', label: 'Kosmonavt', bg: '#e0f2fe', border: '#0284c7' },
  { id: 'owl', emoji: '🦉', label: 'Boyo‘g‘li', bg: '#ecfdf5', border: '#10b981' },
];

export const DAILY_GOAL_OPTIONS = [30, 60, 100] as const;

export function getAvatarOption(avatarId: string): AvatarOption {
  return AVATAR_OPTIONS.find((a) => a.id === avatarId) ?? AVATAR_OPTIONS[0]!;
}

export function calculateTotalXp(totalStars: number, totalEffortStars: number): number {
  return totalStars * 20 + totalEffortStars * 5;
}

export interface LevelInfo {
  level: number;
  title: string;
  icon: string;
  xpInLevel: number;
  levelSpanXp: number;
  pct: number;
  xpToNext: number;
}

const LEVEL_THRESHOLDS = [
  { level: 1, minXp: 0, nextXp: 100, title: 'Harf izlovchi', icon: '🌱' },
  { level: 2, minXp: 100, nextXp: 300, title: 'Tovush ustasi', icon: '✨' },
  { level: 3, minXp: 300, nextXp: 600, title: 'Bo‘g‘in ustasi', icon: '🌲' },
  { level: 4, minXp: 600, nextXp: 1000, title: 'So‘z sayyohi', icon: '🚀' },
  { level: 5, minXp: 1000, nextXp: 1600, title: 'Yosh kitobxon', icon: '📚' },
  { level: 6, minXp: 1600, nextXp: 2400, title: 'Alifbo chempioni', icon: '👑' },
];

export function getLevelInfo(xp: number): LevelInfo {
  const safeXp = Math.max(0, xp);
  let tier = LEVEL_THRESHOLDS[0]!;
  for (const candidate of LEVEL_THRESHOLDS) {
    if (safeXp >= candidate.minXp) {
      tier = candidate;
    }
  }
  const span = Math.max(1, tier.nextXp - tier.minXp);
  const inLevel = Math.min(span, Math.max(0, safeXp - tier.minXp));
  const pct = tier.level === 6 && safeXp >= tier.nextXp ? 100 : Math.min(100, Math.round((inLevel / span) * 100));
  const xpToNext = Math.max(0, tier.nextXp - safeXp);

  return {
    level: tier.level,
    title: tier.title,
    icon: tier.icon,
    xpInLevel: inLevel,
    levelSpanXp: span,
    pct,
    xpToNext,
  };
}

export interface WeekStreakDay {
  dateStr: string;
  shortLabelUz: string;
  active: boolean;
  isToday: boolean;
}

const UZ_SHORT_WEEKDAYS = ['Ya', 'Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh'];

export function buildWeekStreakDays(practiceDates: string[], today: Date = new Date()): WeekStreakDay[] {
  const practicedSet = new Set(practiceDates);
  const todayStr = getLocalDateString(today);
  const days: WeekStreakDay[] = [];

  for (let offset = 6; offset >= 0; offset--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
    const dateStr = getLocalDateString(d);
    days.push({
      dateStr,
      shortLabelUz: UZ_SHORT_WEEKDAYS[d.getDay()] ?? 'Ku',
      active: practicedSet.has(dateStr),
      isToday: dateStr === todayStr,
    });
  }
  return days;
}

export interface AchievementBadge {
  id: string;
  icon: string;
  titleUz: string;
  descUz: string;
  current: number;
  target: number;
  unlocked: boolean;
}

export function getAchievements(items: CurriculumItem[], state: AlifboState): AchievementBadge[] {
  const masteredItems = items.filter((item) => state.progressByItem[item.id]?.mastered);
  const stage1Items = items.filter((item) => item.stage === 1);
  const stage1Mastered = stage1Items.filter((item) => state.progressByItem[item.id]?.mastered).length;
  const masteredSyllables = masteredItems.filter((item) => item.kind === 'syllable').length;
  const masteredWords = masteredItems.filter((item) => item.kind === 'word').length;
  const threeStarCount = masteredItems.filter((item) => (state.progressByItem[item.id]?.stars ?? 0) >= 3).length;
  const totalXp = calculateTotalXp(state.totalStars, state.totalEffortStars);
  const streakCount = state.practiceDates.length;

  const specs: Array<Omit<AchievementBadge, 'unlocked'>> = [
    {
      id: 'first_step',
      icon: '🎯',
      titleUz: 'Ilk qadam',
      descUz: 'Birinchi darsni muvaffaqiyatli tugating',
      current: Math.min(1, masteredItems.length),
      target: 1,
    },
    {
      id: 'vowel_island',
      icon: '🏝️',
      titleUz: 'Unlilar qiroli',
      descUz: '1-oroldagi barcha 7 darsni yakunlang',
      current: stage1Mastered,
      target: Math.max(1, stage1Items.length),
    },
    {
      id: 'syllable_master',
      icon: '🧩',
      titleUz: 'Bo‘g‘in ustasi',
      descUz: '10 ta bo‘g‘inni o‘zlashtiring',
      current: Math.min(10, masteredSyllables),
      target: 10,
    },
    {
      id: 'word_reader',
      icon: '📖',
      titleUz: 'So‘z bilimdoni',
      descUz: '8 ta so‘zni to‘g‘ri o‘qing',
      current: Math.min(8, masteredWords),
      target: 8,
    },
    {
      id: 'streak_3',
      icon: '🔥',
      titleUz: '3 kunlik olov',
      descUz: '3 kun mashg‘ulot bajaring',
      current: Math.min(3, streakCount),
      target: 3,
    },
    {
      id: 'xp_300',
      icon: '⚡',
      titleUz: '300 XP kuch',
      descUz: 'Jami 300 XP ball to‘plang',
      current: Math.min(300, totalXp),
      target: 300,
    },
    {
      id: 'perfect_five',
      icon: '🌟',
      titleUz: 'Oltin yulduzlar',
      descUz: '5 ta darsni 3 yulduz bilan o‘ting',
      current: Math.min(5, threeStarCount),
      target: 5,
    },
    {
      id: 'champion_48',
      icon: '👑',
      titleUz: 'Alifbo chempioni',
      descUz: 'Barcha 48 ta darsni zabt eting',
      current: masteredItems.length,
      target: items.length,
    },
  ];

  return specs.map((spec) => ({
    ...spec,
    unlocked: spec.current >= spec.target,
  }));
}
