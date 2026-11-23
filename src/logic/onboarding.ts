import type {
  FutureSubjectOption,
  OnboardingBiggestDifficulty,
  OnboardingChildStage,
  OnboardingPreviousAttempt,
  SurveyData,
} from '../storage/progressStorage';

export interface SurveyDraft {
  ageGroup: SurveyData['ageGroup'] | null;
  readingChallenge: SurveyData['readingChallenge'] | null;
  dailyLimitMinutes: SurveyData['dailyLimitMinutes'] | null;
  desiredFutureSubjects: FutureSubjectOption[];
}

/**
 * Resolve the starting world from the child's reading challenge.
 * Both beginner options ('slow_spelling' and 'blending') start in World 1.
 */
export function resolveRecommendedWorld(
  challenge: SurveyData['readingChallenge'],
): 1 | 2 | 3 | 4 | 5 {
  if (challenge === 'slow_spelling' || challenge === 'blending') return 1;
  if (challenge === 'forgets_letters') return 3;
  return 4;
}

/**
 * Enforce required selections on steps 1-3; step 4 is optional and allows an empty list.
 */
export function isSurveyStepComplete(step: 1 | 2 | 3 | 4, draft: SurveyDraft): boolean {
  if (step === 1) return draft.ageGroup !== null;
  if (step === 2) return draft.readingChallenge !== null;
  if (step === 3) return draft.dailyLimitMinutes !== null;
  return true;
}

export const STRATEGIC_ONBOARDING_STORAGE_KEY = 'alifbo_strategic_onboarding_v1';

export const ONBOARDING_STAGE_OPTIONS: ReadonlyArray<{
  id: OnboardingChildStage;
  label: string;
}> = [
  { id: 'no_letters_yet', label: 'Harflarni hali bilmaydi' },
  {
    id: 'knows_letters_not_words',
    label: 'Harflarni biladi, lekin so‘z o‘qiy olmaydi',
  },
  {
    id: 'reads_syllables_wants_speed',
    label: 'Bo‘g‘inlab o‘qiydi, tezligini oshirmoqchimiz',
  },
];

export const ONBOARDING_ATTEMPT_OPTIONS: ReadonlyArray<{
  id: OnboardingPreviousAttempt;
  label: string;
}> = [
  { id: 'self_book_alifbe', label: 'O‘zim kitob/alifbedan o‘rgatishga urindim' },
  { id: 'tutor_or_center', label: 'Repetitor yoki o‘quv markaziga berdik' },
  { id: 'youtube_or_apps', label: 'YouTube / boshqa ilovalarni sinadik' },
  { id: 'not_started_seriously', label: 'Hali jiddiy boshlamadik' },
];

export const ONBOARDING_DIFFICULTY_OPTIONS: ReadonlyArray<{
  id: OnboardingBiggestDifficulty;
  label: string;
}> = [
  { id: 'no_parent_time', label: 'Mening vaqtim yetmaydi' },
  { id: 'child_gets_bored', label: 'Bola tez zerikib qoladi' },
  { id: 'no_uzbek_quality_material', label: 'O‘zbekcha sifatli o‘yin/material yo‘q' },
  { id: 'cannot_blend_letters', label: 'Harflarni bir-biriga qo‘shib o‘qiy olmayapti' },
];

export interface StrategicOnboardingDraft {
  childStage: OnboardingChildStage | null;
  previousAttempt: OnboardingPreviousAttempt | null;
  biggestDifficulty: OnboardingBiggestDifficulty | null;
  contact: string;
}

export interface StrategicOnboardingAnswers {
  completedAt: string;
  childStage: OnboardingChildStage;
  previousAttempt: OnboardingPreviousAttempt;
  biggestDifficulty: OnboardingBiggestDifficulty;
  contact: string;
}

/**
 * Resolve recommended starting world from the strategic child stage selection.
 */
export function resolveRecommendedWorldFromStage(
  stage: OnboardingChildStage,
): 1 | 2 | 3 | 4 | 5 {
  if (stage === 'reads_syllables_wants_speed') return 2;
  return 1;
}

/**
 * Steps 1-3 require a single-tap card selection; step 4 (contact) is optional.
 */
export function isStrategicStepComplete(
  step: 1 | 2 | 3 | 4,
  draft: StrategicOnboardingDraft,
): boolean {
  if (step === 1) return draft.childStage !== null;
  if (step === 2) return draft.previousAttempt !== null;
  if (step === 3) return draft.biggestDifficulty !== null;
  return true;
}

/**
 * Resolve human-readable Uzbek labels for strategic onboarding choices.
 */
export function getOnboardingOptionLabels(
  answers: Pick<
    StrategicOnboardingAnswers,
    'childStage' | 'previousAttempt' | 'biggestDifficulty'
  >,
): {
  childStageLabel: string;
  previousAttemptsLabel: string;
  biggestDifficultyLabel: string;
} {
  const childStageLabel =
    ONBOARDING_STAGE_OPTIONS.find((opt) => opt.id === answers.childStage)?.label ??
    answers.childStage;
  const previousAttemptsLabel =
    ONBOARDING_ATTEMPT_OPTIONS.find((opt) => opt.id === answers.previousAttempt)?.label ??
    answers.previousAttempt;
  const biggestDifficultyLabel =
    ONBOARDING_DIFFICULTY_OPTIONS.find((opt) => opt.id === answers.biggestDifficulty)?.label ??
    answers.biggestDifficulty;

  return {
    childStageLabel,
    previousAttemptsLabel,
    biggestDifficultyLabel,
  };
}

/**
 * Build backward-compatible SurveyData enriched with strategic onboarding answers.
 */
export function buildSurveyDataFromStrategic(
  answers: StrategicOnboardingAnswers,
  existing?: SurveyData | null,
): SurveyData {
  const readingChallenge: SurveyData['readingChallenge'] =
    answers.childStage === 'no_letters_yet'
      ? 'slow_spelling'
      : answers.childStage === 'knows_letters_not_words'
        ? 'blending'
        : 'comprehension';

  const trimmedContact = answers.contact.trim();

  return {
    completedAt: answers.completedAt,
    ageGroup: existing?.ageGroup ?? '6-7',
    readingChallenge,
    dailyLimitMinutes: existing?.dailyLimitMinutes ?? 15,
    desiredFutureSubjects: existing?.desiredFutureSubjects ?? [],
    childStage: answers.childStage,
    previousAttempt: answers.previousAttempt,
    biggestDifficulty: answers.biggestDifficulty,
    ...(trimmedContact ? { contact: trimmedContact } : {}),
  };
}

function getStorageSafe(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Save strategic onboarding answers to localStorage without throwing on storage errors.
 */
export function saveStrategicOnboardingAnswers(answers: StrategicOnboardingAnswers): void {
  const storage = getStorageSafe();
  if (!storage) return;
  try {
    storage.setItem(STRATEGIC_ONBOARDING_STORAGE_KEY, JSON.stringify(answers));
  } catch {
    // Ignore storage quota or security errors
  }
}

/**
 * Load strategic onboarding answers from localStorage safely.
 */
export function loadStrategicOnboardingAnswers(): StrategicOnboardingAnswers | null {
  const storage = getStorageSafe();
  if (!storage) return null;
  try {
    const raw = storage.getItem(STRATEGIC_ONBOARDING_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    const validStage = ONBOARDING_STAGE_OPTIONS.some((o) => o.id === obj.childStage);
    const validAttempt = ONBOARDING_ATTEMPT_OPTIONS.some((o) => o.id === obj.previousAttempt);
    const validDiff = ONBOARDING_DIFFICULTY_OPTIONS.some((o) => o.id === obj.biggestDifficulty);
    if (
      typeof obj.completedAt !== 'string' ||
      !validStage ||
      !validAttempt ||
      !validDiff ||
      typeof obj.contact !== 'string'
    ) {
      return null;
    }
    return {
      completedAt: obj.completedAt,
      childStage: obj.childStage as OnboardingChildStage,
      previousAttempt: obj.previousAttempt as OnboardingPreviousAttempt,
      biggestDifficulty: obj.biggestDifficulty as OnboardingBiggestDifficulty,
      contact: obj.contact,
    };
  } catch {
    return null;
  }
}
