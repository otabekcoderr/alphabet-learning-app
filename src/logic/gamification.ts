import type { CurriculumItem } from '../data/curriculum';
import { getLocalDateString, type AlifboState } from '../storage/progressStorage';
import type { ItemProgress } from './pedagogy';

export interface AvatarOption {
  id: string;
  emoji: string;
  label: string;
  mascotName: string;
  bg: string;
  border: string;
}

export const AVATAR_OPTIONS: AvatarOption[] = [
  { id: 'fox', emoji: '🦊', label: 'Tulki', mascotName: 'Zukko Tulki', bg: '#fff3e0', border: '#ff9600' },
  { id: 'lion', emoji: '🦁', label: 'Sher', mascotName: 'Jasur Sher', bg: '#fef9c3', border: '#eab308' },
  { id: 'panda', emoji: '🐼', label: 'Panda', mascotName: 'Quvnoq Panda', bg: '#f1f5f9', border: '#64748b' },
  { id: 'rabbit', emoji: '🐰', label: 'Quyon', mascotName: 'Chaqqon Quyon', bg: '#fce7f3', border: '#ec4899' },
  { id: 'tiger', emoji: '🐯', label: 'Yo‘lbars', mascotName: 'Epchil Yo‘lbars', bg: '#ffedd5', border: '#f97316' },
  { id: 'unicorn', emoji: '🦄', label: 'Yakkashox', mascotName: 'Sehrli Yakkashox', bg: '#f3e8ff', border: '#a855f7' },
  { id: 'astronaut', emoji: '🚀', label: 'Kosmonavt', mascotName: 'Yosh Kosmonavt', bg: '#e0f2fe', border: '#0284c7' },
  { id: 'owl', emoji: '🦉', label: 'Boyo‘g‘li', mascotName: 'Bilimdon Boyo‘g‘li', bg: '#ecfdf5', border: '#10b981' },
];

export interface MascotPresentation {
  avatarId: string;
  name: string;
  emoji: string;
  usesFoxSvg: boolean;
}

export function resolveMascotPresentation(params: {
  avatarId?: string;
  explicitName?: string;
}): MascotPresentation {
  const trimmedName = (params.explicitName ?? '').trim();
  if (trimmedName.toLowerCase() === 'zukko tulki') {
    const fox = AVATAR_OPTIONS[0]!;
    return {
      avatarId: 'fox',
      name: fox.mascotName,
      emoji: fox.emoji,
      usesFoxSvg: true,
    };
  }
  const option = getAvatarOption(params.avatarId ?? 'fox');
  return {
    avatarId: option.id,
    name: trimmedName || option.mascotName,
    emoji: option.emoji,
    usesFoxSvg: option.id === 'fox',
  };
}

export const DAILY_GOAL_OPTIONS = [30, 60, 100] as const;

export const NICKNAME_PRESETS = ['Bolajon', 'Yulduzcha', 'Zukko', 'Kitobxon'] as const;

export const RANDOM_NICKNAME_POOL = [
  'Bolajon',
  'Yulduzcha',
  'Zukko',
  'Kitobxon',
  'Bilimdon',
  'Chaqqon',
  'Quvnoq',
  'Quyoshcha',
] as const;

/** Pick a random child nickname and profile picture, avoiding repeating the current pair when possible. */
export function createRandomChildProfile(
  rng: () => number = Math.random,
  current?: { name?: string; avatarId?: string },
): { name: string; avatarId: string } {
  const namePool = RANDOM_NICKNAME_POOL.filter((n) => n !== current?.name);
  const names = namePool.length > 0 ? namePool : RANDOM_NICKNAME_POOL;
  const avatarPool = AVATAR_OPTIONS.filter((a) => a.id !== current?.avatarId);
  const avatars = avatarPool.length > 0 ? avatarPool : AVATAR_OPTIONS;

  const nameIdx = Math.min(names.length - 1, Math.max(0, Math.floor(rng() * names.length)));
  const avatarIdx = Math.min(avatars.length - 1, Math.max(0, Math.floor(rng() * avatars.length)));

  return {
    name: names[nameIdx] ?? 'Zukko',
    avatarId: avatars[avatarIdx]?.id ?? 'fox',
  };
}

export interface ParentAchievementsSummary {
  totalLessons: number;
  effortCompletedCount: number;
  totalEffortStars: number;
  masteredCount: number;
  parentConfirmedCount: number;
  aiConfirmedCount: number;
  totalMasteryStars: number;
  practiceDaysCount: number;
  unlockedStagesCount: number;
}

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
      icon: '✨',
      titleUz: '15 yulduzli kuch',
      descUz: 'Jami 15 ta tasdiqlangan yulduz to‘plang',
      current: Math.min(15, state.totalStars),
      target: 15,
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

export function getParentAchievementsSummary(
  items: CurriculumItem[],
  state: AlifboState,
): ParentAchievementsSummary {
  let effortCompletedCount = 0;
  let masteredCount = 0;
  let parentConfirmedCount = 0;
  let aiConfirmedCount = 0;

  for (const item of items) {
    const p = state.progressByItem[item.id];
    if (isItemCompletedByEffort(p)) {
      effortCompletedCount++;
    }
    if (p?.mastered) {
      masteredCount++;
      const isParent =
        p.confirmationSource === 'parent_single' ||
        p.confirmationSource === 'parent_bulk' ||
        (p.confirmationSource !== 'ai' && p.parentVerified);
      if (isParent) {
        parentConfirmedCount++;
      } else {
        aiConfirmedCount++;
      }
    }
  }

  const stageNumbers = Array.from(new Set(items.map((item) => item.stage)));
  let unlockedStagesCount = 0;
  for (const stageNum of stageNumbers) {
    if (isStageEffortComplete(stageNum, items, state.progressByItem)) {
      unlockedStagesCount++;
    }
  }

  return {
    totalLessons: items.length,
    effortCompletedCount,
    totalEffortStars: state.totalEffortStars,
    masteredCount,
    parentConfirmedCount,
    aiConfirmedCount,
    totalMasteryStars: state.totalStars,
    practiceDaysCount: state.practiceDates.length,
    unlockedStagesCount,
  };
}

export function isItemCompletedByEffort(progress: ItemProgress | undefined): boolean {
  return Boolean(
    progress &&
      (progress.mastered ||
        progress.status === 'unverified' ||
        progress.effortStars > 0 ||
        progress.stars > 0),
  );
}

export function getStageEffortCount(
  stageNumber: number,
  items: CurriculumItem[],
  progressByItem: Record<string, ItemProgress>,
): number {
  let count = 0;
  for (const item of items) {
    if (item.stage === stageNumber && isItemCompletedByEffort(progressByItem[item.id])) {
      count++;
    }
  }
  return count;
}

export function isStageEffortComplete(
  stageNumber: number,
  items: CurriculumItem[],
  progressByItem: Record<string, ItemProgress>,
): boolean {
  const stageItems = items.filter((item) => item.stage === stageNumber);
  return stageItems.length > 0 && stageItems.every((item) => isItemCompletedByEffort(progressByItem[item.id]));
}

export function getNewlyUnlockedStageRewards(
  stages: Array<{ stage: number }>,
  items: CurriculumItem[],
  progressByItem: Record<string, ItemProgress>,
  shownStageRewards: number[],
): number[] {
  const shownSet = new Set(shownStageRewards);
  const newlyUnlocked: number[] = [];
  for (const stage of stages) {
    if (!shownSet.has(stage.stage) && isStageEffortComplete(stage.stage, items, progressByItem)) {
      newlyUnlocked.push(stage.stage);
    }
  }
  return newlyUnlocked;
}

export function markStageRewardsShown(shownStageRewards: number[], newlyShown: number[]): number[] {
  return Array.from(new Set([...shownStageRewards, ...newlyShown])).sort((a, b) => a - b);
}
