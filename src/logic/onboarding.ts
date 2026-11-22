import type { FutureSubjectOption, SurveyData } from '../storage/progressStorage';

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
