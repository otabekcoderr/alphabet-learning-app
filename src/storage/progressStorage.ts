import {
  addDaysIso,
  clampUnverifiedCap,
  DEFAULT_UNVERIFIED_CAP,
  getFirstReviewDelayDays,
  type ConfirmationSource,
  type ItemProgress,
  type MasteryStatus,
  type WordProgress,
} from '../logic/pedagogy';
import type { LetterMasteryEntry, LetterMasteryStatus } from '../logic/alphabetReview';
import {
  generateAccountPublicId,
  isValidAccountPublicId,
  type ParentAccountSession,
} from '../logic/auth';
import { clearPinLockout, sha256Hex, type PinLockoutState } from '../logic/pin';
import { clampDailyLimitMinutes, DEFAULT_DAILY_LIMIT_MINUTES } from '../logic/wordPoolEngine';

export interface ChildProfileData {
  name: string;
  avatarId: string;
  dailyGoalXp: number;
}

export type FutureSubjectOption = 'math' | 'drawing' | 'handwriting' | 'english';

export type OnboardingChildStage =
  | 'no_letters_yet'
  | 'knows_letters_not_words'
  | 'reads_syllables_wants_speed';

export type OnboardingPreviousAttempt =
  | 'self_book_alifbe'
  | 'tutor_or_center'
  | 'youtube_or_apps'
  | 'not_started_seriously';

export type OnboardingBiggestDifficulty =
  | 'no_parent_time'
  | 'child_gets_bored'
  | 'no_uzbek_quality_material'
  | 'cannot_blend_letters';

export interface SurveyData {
  completedAt: string;
  ageGroup: '5-6' | '6-7' | '7-8';
  readingChallenge: 'blending' | 'slow_spelling' | 'forgets_letters' | 'comprehension';
  dailyLimitMinutes: 10 | 15 | 20;
  desiredFutureSubjects: FutureSubjectOption[];
  childStage?: OnboardingChildStage;
  previousAttempt?: OnboardingPreviousAttempt;
  biggestDifficulty?: OnboardingBiggestDifficulty;
  contact?: string;
}

export interface AlifboState {
  schemaVersion: 3;
  account: ParentAccountSession | null;
  pinSalt: string | null;
  pinHash: string | null;
  recoveryCodeHash: string | null;
  pinLockout: PinLockoutState;
  profile: ChildProfileData;
  progressByItem: Record<string, ItemProgress>;
  totalStars: number;
  totalEffortStars: number;
  practiceDates: string[];
  recentLatenciesMs: number[];
  shownStageRewards: number[];
  unverifiedCap: number;
  parentOnboardingDone: boolean;
  // Alifbo 2.0 fields
  seenWordIds: string[];
  letterHintCounts: Record<string, number>;
  dailyLimitMinutes: 10 | 15 | 20;
  dailyPracticeDate: string;
  todayPracticedSeconds: number;
  activeWorldId: number;
  surveyData: SurveyData | null;
  // Alifbo 2.2 fields
  wordProgress: Record<string, WordProgress>;
  recentReadingTimesMs: number[];
  letterMastery: Record<string, LetterMasteryEntry>;
  // Vazifa 2 fields
  completedSessionsCount: number;
  bismillahAlhamdulillahEnabled: boolean;
  firstSessionFeedbackPrompted: boolean;
}

export function createDefaultProfile(): ChildProfileData {
  return {
    name: 'Bolajon',
    avatarId: 'fox',
    dailyGoalXp: 60,
  };
}

export interface StorageLoadResult {
  state: AlifboState;
  recoveredCorruptData: boolean;
}

const STORAGE_KEY = 'alifbo_app_state_v3';
const BACKUP_PREFIX = 'alifbo_app_state_backup_';
export const PRE_PHASE_A_BACKUP_KEY = 'alifbo_backup_before_phase_a';
export const PRE_PHASE_B_BACKUP_KEY = 'alifbo_backup_before_phase_b';

export function getLocalDateString(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function createInitialState(): AlifboState {
  return {
    schemaVersion: 3,
    account: null,
    pinSalt: null,
    pinHash: null,
    recoveryCodeHash: null,
    pinLockout: clearPinLockout(),
    profile: createDefaultProfile(),
    progressByItem: {},
    totalStars: 0,
    totalEffortStars: 0,
    practiceDates: [],
    recentLatenciesMs: [],
    shownStageRewards: [],
    unverifiedCap: DEFAULT_UNVERIFIED_CAP,
    parentOnboardingDone: false,
    seenWordIds: [],
    letterHintCounts: {},
    dailyLimitMinutes: DEFAULT_DAILY_LIMIT_MINUTES,
    dailyPracticeDate: '',
    todayPracticedSeconds: 0,
    activeWorldId: 1,
    surveyData: null,
    wordProgress: {},
    recentReadingTimesMs: [],
    letterMastery: {},
    completedSessionsCount: 0,
    bismillahAlhamdulillahEnabled: true,
    firstSessionFeedbackPrompted: false,
  };
}

function isValidAccount(value: unknown): value is ParentAccountSession | null {
  if (value === null) return true;
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.contact === 'string' &&
    typeof obj.createdAt === 'string' &&
    typeof obj.signedInAt === 'string'
  );
}

function normalizeAccount(value: unknown): ParentAccountSession | null {
  if (!isValidAccount(value) || value === null) return null;
  return {
    ...value,
    publicId: isValidAccountPublicId(value.publicId)
      ? value.publicId
      : generateAccountPublicId(),
  };
}

function isValidProfile(value: unknown): value is ChildProfileData {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.name === 'string' &&
    typeof obj.avatarId === 'string' &&
    typeof obj.dailyGoalXp === 'number' &&
    Number.isFinite(obj.dailyGoalXp)
  );
}

function isValidLockout(value: unknown): value is PinLockoutState {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.failedAttempts === 'number' &&
    (obj.lockedUntilMs === null || typeof obj.lockedUntilMs === 'number')
  );
}

function isValidConfirmationSource(value: unknown): value is ConfirmationSource {
  return value === 'ai' || value === 'parent_single' || value === 'parent_bulk';
}

function isValidItemProgress(value: unknown): value is ItemProgress {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.itemId === 'string' &&
    (obj.status === 'mastered' || obj.status === 'unverified') &&
    typeof obj.mastered === 'boolean' &&
    typeof obj.stars === 'number' &&
    typeof obj.effortStars === 'number' &&
    typeof obj.voiceAttempts === 'number' &&
    typeof obj.parentVerified === 'boolean' &&
    (obj.confirmationSource === undefined ||
      obj.confirmationSource === null ||
      isValidConfirmationSource(obj.confirmationSource)) &&
    (obj.nextReviewAt === undefined || obj.nextReviewAt === null || typeof obj.nextReviewAt === 'string') &&
    (obj.lastLatencyMs === null || typeof obj.lastLatencyMs === 'number') &&
    typeof obj.lastPracticedAt === 'string'
  );
}

function normalizeItemProgressMap(progressByItem: Record<string, ItemProgress>): Record<string, ItemProgress> {
  const normalized: Record<string, ItemProgress> = {};
  for (const [key, item] of Object.entries(progressByItem)) {
    if (item.mastered) {
      const source: ConfirmationSource =
        item.confirmationSource ?? (item.parentVerified ? 'parent_single' : 'ai');
      const nextReviewAt =
        item.nextReviewAt ??
        addDaysIso(item.lastPracticedAt, getFirstReviewDelayDays(source, item.voiceAttempts));
      normalized[key] = {
        ...item,
        confirmationSource: source,
        nextReviewAt,
      };
    } else {
      normalized[key] = {
        ...item,
        confirmationSource: null,
        nextReviewAt: null,
      };
    }
  }
  return normalized;
}

function normalizeShownStageRewards(value: number[] | undefined): number[] {
  if (!Array.isArray(value)) return [];
  const valid = value.filter((n) => typeof n === 'number' && Number.isFinite(n) && n >= 1).map((n) => Math.trunc(n));
  return Array.from(new Set(valid)).sort((a, b) => a - b);
}

function isValidOnboardingChildStage(value: unknown): value is OnboardingChildStage {
  return (
    value === 'no_letters_yet' ||
    value === 'knows_letters_not_words' ||
    value === 'reads_syllables_wants_speed'
  );
}

function isValidOnboardingPreviousAttempt(value: unknown): value is OnboardingPreviousAttempt {
  return (
    value === 'self_book_alifbe' ||
    value === 'tutor_or_center' ||
    value === 'youtube_or_apps' ||
    value === 'not_started_seriously'
  );
}

function isValidOnboardingBiggestDifficulty(value: unknown): value is OnboardingBiggestDifficulty {
  return (
    value === 'no_parent_time' ||
    value === 'child_gets_bored' ||
    value === 'no_uzbek_quality_material' ||
    value === 'cannot_blend_letters'
  );
}

function isValidSurveyData(value: unknown): value is SurveyData {
  if (value === null) return true;
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.completedAt === 'string' &&
    (obj.ageGroup === '5-6' || obj.ageGroup === '6-7' || obj.ageGroup === '7-8') &&
    (obj.readingChallenge === 'blending' ||
      obj.readingChallenge === 'slow_spelling' ||
      obj.readingChallenge === 'forgets_letters' ||
      obj.readingChallenge === 'comprehension') &&
    (obj.dailyLimitMinutes === 10 || obj.dailyLimitMinutes === 15 || obj.dailyLimitMinutes === 20) &&
    Array.isArray(obj.desiredFutureSubjects) &&
    (obj.childStage === undefined || isValidOnboardingChildStage(obj.childStage)) &&
    (obj.previousAttempt === undefined ||
      isValidOnboardingPreviousAttempt(obj.previousAttempt)) &&
    (obj.biggestDifficulty === undefined ||
      isValidOnboardingBiggestDifficulty(obj.biggestDifficulty)) &&
    (obj.contact === undefined || typeof obj.contact === 'string')
  );
}

function normalizeLetterHintCounts(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object') return {};
  const result: Record<string, number> = {};
  for (const [key, count] of Object.entries(value as Record<string, unknown>)) {
    if (typeof count === 'number' && Number.isFinite(count) && count > 0) {
      result[key] = Math.trunc(count);
    }
  }
  return result;
}

function normalizeSeenWordIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((v): v is string => typeof v === 'string' && v.length > 0)));
}

function isValidMasteryStatus(value: unknown): value is MasteryStatus {
  return value === 'new' || value === 'assisted' || value === 'syllable' || value === 'mastered';
}

function normalizeRecentReadingTimesMs(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0)
    .map((n) => Math.round(n))
    .slice(-20);
}

function createMigratedWordProgress(wordId: string, todayStr: string): WordProgress {
  return {
    wordId,
    status: 'syllable',
    reviewIntervalDays: 0,
    nextReviewDate: todayStr,
    attemptCount: 1,
    assistedCount: 0,
    offlineCorrectStreak: 0,
    fluentStreak: 0,
    pendingVoiceVerify: true,
  };
}

function normalizeWordProgressMap(
  value: unknown,
  todayStr: string,
): { map: Record<string, WordProgress>; migratedCount: number } {
  const result: Record<string, WordProgress> = {};
  let migratedCount = 0;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { map: result, migratedCount };
  }

  for (const [key, rawEntry] of Object.entries(value as Record<string, unknown>)) {
    if (!rawEntry || typeof rawEntry !== 'object') continue;
    const entry = rawEntry as Record<string, unknown>;
    const wordId = typeof entry.wordId === 'string' && entry.wordId ? entry.wordId : key;

    if (isValidMasteryStatus(entry.status)) {
      result[key] = {
        wordId,
        status: entry.status,
        reviewIntervalDays:
          typeof entry.reviewIntervalDays === 'number' && Number.isFinite(entry.reviewIntervalDays)
            ? Math.max(0, Math.round(entry.reviewIntervalDays))
            : 0,
        nextReviewDate:
          typeof entry.nextReviewDate === 'string' && entry.nextReviewDate
            ? entry.nextReviewDate
            : todayStr,
        attemptCount:
          typeof entry.attemptCount === 'number' && Number.isFinite(entry.attemptCount)
            ? Math.max(0, Math.trunc(entry.attemptCount))
            : 0,
        assistedCount:
          typeof entry.assistedCount === 'number' && Number.isFinite(entry.assistedCount)
            ? Math.max(0, Math.trunc(entry.assistedCount))
            : 0,
        offlineCorrectStreak:
          typeof entry.offlineCorrectStreak === 'number' && Number.isFinite(entry.offlineCorrectStreak)
            ? Math.max(0, Math.trunc(entry.offlineCorrectStreak))
            : 0,
        fluentStreak:
          typeof entry.fluentStreak === 'number' && Number.isFinite(entry.fluentStreak)
            ? Math.max(0, Math.trunc(entry.fluentStreak))
            : 0,
        lastReactionMs:
          typeof entry.lastReactionMs === 'number' && Number.isFinite(entry.lastReactionMs)
            ? Math.round(entry.lastReactionMs)
            : undefined,
        lastArticulationMs:
          typeof entry.lastArticulationMs === 'number' && Number.isFinite(entry.lastArticulationMs)
            ? Math.round(entry.lastArticulationMs)
            : undefined,
        pendingVoiceVerify: Boolean(entry.pendingVoiceVerify),
      };
    } else if (entry.completed === true || entry.mastered === true) {
      result[key] = createMigratedWordProgress(wordId, todayStr);
      migratedCount++;
    }
  }

  return { map: result, migratedCount };
}

function isValidLetterMasteryStatus(value: unknown): value is LetterMasteryStatus {
  return value === 'new' || value === 'practiced' || value === 'mastered';
}

function normalizeLetterMasteryMap(value: unknown): Record<string, LetterMasteryEntry> {
  const result: Record<string, LetterMasteryEntry> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return result;
  }
  for (const [key, rawEntry] of Object.entries(value as Record<string, unknown>)) {
    if (!rawEntry || typeof rawEntry !== 'object') continue;
    const entry = rawEntry as Record<string, unknown>;
    const letter = typeof entry.letter === 'string' && entry.letter ? entry.letter : key;
    if (!letter || !isValidLetterMasteryStatus(entry.status)) continue;
    result[key] = {
      letter,
      status: entry.status,
      correctCount:
        typeof entry.correctCount === 'number' && Number.isFinite(entry.correctCount)
          ? Math.max(0, Math.trunc(entry.correctCount))
          : 0,
      streak:
        typeof entry.streak === 'number' && Number.isFinite(entry.streak)
          ? Math.max(0, Math.trunc(entry.streak))
          : 0,
      lastReviewedAt:
        typeof entry.lastReviewedAt === 'string' ? entry.lastReviewedAt : '',
    };
  }
  return result;
}

function normalizeLoadedState(rawObj: Record<string, unknown>, parsed: AlifboState, todayStr: string): AlifboState {
  const seenWordIds = normalizeSeenWordIds(rawObj.seenWordIds);
  const { map: normalizedWordProgress } = normalizeWordProgressMap(rawObj.wordProgress, todayStr);

  // If migrating from Alifbo 2.0 (where wordProgress did not exist yet), carry seen words as pending voice verify
  if (rawObj.wordProgress === undefined && seenWordIds.length > 0) {
    for (const id of seenWordIds) {
      if (!normalizedWordProgress[id]) {
        normalizedWordProgress[id] = createMigratedWordProgress(id, todayStr);
      }
    }
  }

  return {
    ...parsed,
    account: normalizeAccount(rawObj.account),
    profile: parsed.profile ?? createDefaultProfile(),
    progressByItem: normalizeItemProgressMap(parsed.progressByItem),
    shownStageRewards: normalizeShownStageRewards(parsed.shownStageRewards),
    unverifiedCap: clampUnverifiedCap(
      typeof parsed.unverifiedCap === 'number' ? parsed.unverifiedCap : DEFAULT_UNVERIFIED_CAP,
    ),
    parentOnboardingDone: typeof parsed.parentOnboardingDone === 'boolean' ? parsed.parentOnboardingDone : false,
    seenWordIds,
    letterHintCounts: normalizeLetterHintCounts(rawObj.letterHintCounts),
    dailyLimitMinutes: clampDailyLimitMinutes(
      typeof rawObj.dailyLimitMinutes === 'number' ? rawObj.dailyLimitMinutes : DEFAULT_DAILY_LIMIT_MINUTES,
    ),
    dailyPracticeDate: typeof rawObj.dailyPracticeDate === 'string' ? rawObj.dailyPracticeDate : '',
    todayPracticedSeconds:
      typeof rawObj.todayPracticedSeconds === 'number' && rawObj.todayPracticedSeconds >= 0
        ? Math.round(rawObj.todayPracticedSeconds)
        : 0,
    activeWorldId:
      typeof rawObj.activeWorldId === 'number' && rawObj.activeWorldId >= 1 && rawObj.activeWorldId <= 5
        ? Math.trunc(rawObj.activeWorldId)
        : 1,
    surveyData: isValidSurveyData(rawObj.surveyData) ? rawObj.surveyData : null,
    wordProgress: normalizedWordProgress,
    recentReadingTimesMs: normalizeRecentReadingTimesMs(rawObj.recentReadingTimesMs),
    letterMastery: normalizeLetterMasteryMap(rawObj.letterMastery),
    completedSessionsCount:
      typeof rawObj.completedSessionsCount === 'number' &&
      Number.isFinite(rawObj.completedSessionsCount) &&
      rawObj.completedSessionsCount >= 0
        ? Math.trunc(rawObj.completedSessionsCount)
        : 0,
    bismillahAlhamdulillahEnabled:
      typeof rawObj.bismillahAlhamdulillahEnabled === 'boolean'
        ? rawObj.bismillahAlhamdulillahEnabled
        : true,
    firstSessionFeedbackPrompted:
      typeof rawObj.firstSessionFeedbackPrompted === 'boolean'
        ? rawObj.firstSessionFeedbackPrompted
        : false,
  };
}

function isValidState(value: unknown): value is AlifboState {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  if (
    obj.schemaVersion !== 3 ||
    (obj.pinSalt !== null && typeof obj.pinSalt !== 'string') ||
    (obj.pinHash !== null && typeof obj.pinHash !== 'string') ||
    (obj.recoveryCodeHash !== null && typeof obj.recoveryCodeHash !== 'string') ||
    !isValidLockout(obj.pinLockout) ||
    typeof obj.progressByItem !== 'object' ||
    obj.progressByItem === null ||
    typeof obj.totalStars !== 'number' ||
    typeof obj.totalEffortStars !== 'number' ||
    !Array.isArray(obj.practiceDates) ||
    !Array.isArray(obj.recentLatenciesMs) ||
    (obj.profile !== undefined && !isValidProfile(obj.profile)) ||
    (obj.account !== undefined && !isValidAccount(obj.account)) ||
    (obj.shownStageRewards !== undefined &&
      (!Array.isArray(obj.shownStageRewards) ||
        !obj.shownStageRewards.every((s) => typeof s === 'number' && Number.isFinite(s)))) ||
    (obj.unverifiedCap !== undefined &&
      (typeof obj.unverifiedCap !== 'number' || !Number.isFinite(obj.unverifiedCap))) ||
    (obj.parentOnboardingDone !== undefined && typeof obj.parentOnboardingDone !== 'boolean') ||
    (obj.seenWordIds !== undefined && !Array.isArray(obj.seenWordIds)) ||
    (obj.dailyLimitMinutes !== undefined &&
      (typeof obj.dailyLimitMinutes !== 'number' || !Number.isFinite(obj.dailyLimitMinutes))) ||
    (obj.todayPracticedSeconds !== undefined &&
      (typeof obj.todayPracticedSeconds !== 'number' || !Number.isFinite(obj.todayPracticedSeconds))) ||
    (obj.activeWorldId !== undefined &&
      (typeof obj.activeWorldId !== 'number' || !Number.isFinite(obj.activeWorldId))) ||
    (obj.surveyData !== undefined && !isValidSurveyData(obj.surveyData)) ||
    (obj.wordProgress !== undefined &&
      (obj.wordProgress === null || typeof obj.wordProgress !== 'object' || Array.isArray(obj.wordProgress))) ||
    (obj.recentReadingTimesMs !== undefined && !Array.isArray(obj.recentReadingTimesMs)) ||
    (obj.letterMastery !== undefined &&
      (obj.letterMastery === null || typeof obj.letterMastery !== 'object' || Array.isArray(obj.letterMastery))) ||
    (obj.completedSessionsCount !== undefined &&
      (typeof obj.completedSessionsCount !== 'number' ||
        !Number.isFinite(obj.completedSessionsCount) ||
        obj.completedSessionsCount < 0)) ||
    (obj.bismillahAlhamdulillahEnabled !== undefined &&
      typeof obj.bismillahAlhamdulillahEnabled !== 'boolean') ||
    (obj.firstSessionFeedbackPrompted !== undefined &&
      typeof obj.firstSessionFeedbackPrompted !== 'boolean')
  ) {
    return false;
  }

  return Object.values(obj.progressByItem as Record<string, unknown>).every(isValidItemProgress);
}

/** Validate and normalize a full state payload loaded from remote database storage. */
export function hydrateAlifboState(raw: unknown): AlifboState | null {
  if (!isValidState(raw)) return null;
  return normalizeLoadedState(raw as unknown as Record<string, unknown>, raw, getLocalDateString());
}

export function loadAlifboState(): StorageLoadResult {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { state: createInitialState(), recoveredCorruptData: false };
    }
    try {
      if (window.localStorage.getItem(PRE_PHASE_A_BACKUP_KEY) === null) {
        window.localStorage.setItem(PRE_PHASE_A_BACKUP_KEY, raw);
      }
      if (window.localStorage.getItem(PRE_PHASE_B_BACKUP_KEY) === null) {
        window.localStorage.setItem(PRE_PHASE_B_BACKUP_KEY, raw);
      }
    } catch {
      // Ignore storage quota errors during pre-migration backup
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isValidState(parsed)) {
      window.localStorage.setItem(`${BACKUP_PREFIX}${Date.now()}`, raw);
      return { state: createInitialState(), recoveredCorruptData: true };
    }
    const rawObj = parsed as unknown as Record<string, unknown>;
    const rawAccount =
      rawObj.account && typeof rawObj.account === 'object'
        ? (rawObj.account as Record<string, unknown>)
        : null;
    const needsAccountPublicIdBackfill =
      rawAccount !== null && !isValidAccountPublicId(rawAccount.publicId);
    const normalized = normalizeLoadedState(rawObj, parsed, getLocalDateString());
    if (needsAccountPublicIdBackfill) {
      saveAlifboState(normalized);
    }
    return { state: normalized, recoveredCorruptData: false };
  } catch {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        window.localStorage.setItem(`${BACKUP_PREFIX}${Date.now()}`, raw);
      }
    } catch {
      // Ignore storage quota errors during backup
    }
    return { state: createInitialState(), recoveredCorruptData: true };
  }
}

export function saveAlifboState(state: AlifboState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors in restricted browsing contexts
  }
}

export function recordPracticeDate(dates: string[], today: string = getLocalDateString()): string[] {
  if (dates.includes(today)) return dates;
  return [...dates, today].sort();
}

export interface AlifboExportPayload {
  exportFormatVersion: '2.2';
  schemaVersion: '2.1';
  exportedAt: string;
  checksum: string;
  wordProgress: Record<string, WordProgress>;
  state: AlifboState;
}

export type ImportProgressResult =
  | { ok: true; state: AlifboState; migratedLegacyCount: number }
  | { ok: false; errorUz: string };

/**
 * Compute SHA-256 integrity checksum for export corruption detection.
 * Note: detects accidental corruption/truncation; not cryptographic authentication.
 */
export function computeIntegrityChecksum(unsignedPayload: {
  exportFormatVersion?: string;
  schemaVersion: string;
  exportedAt: string;
  wordProgress: unknown;
  state?: unknown;
}): string {
  const canonical =
    unsignedPayload.exportFormatVersion !== undefined
      ? {
          exportFormatVersion: unsignedPayload.exportFormatVersion,
          schemaVersion: unsignedPayload.schemaVersion,
          exportedAt: unsignedPayload.exportedAt,
          wordProgress: unsignedPayload.wordProgress,
          state: unsignedPayload.state,
        }
      : {
          schemaVersion: unsignedPayload.schemaVersion,
          exportedAt: unsignedPayload.exportedAt,
          wordProgress: unsignedPayload.wordProgress,
        };
  return sha256Hex(JSON.stringify(canonical));
}

export function exportProgressJson(
  state: AlifboState,
  nowIso: string = new Date().toISOString(),
): string {
  const unsigned = {
    exportFormatVersion: '2.2' as const,
    schemaVersion: '2.1' as const,
    exportedAt: nowIso,
    wordProgress: state.wordProgress,
    state,
  };
  const checksum = computeIntegrityChecksum(unsigned);
  const payload: AlifboExportPayload = {
    ...unsigned,
    checksum,
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Import progress from a JSON backup, validating checksum when present and migrating
 * legacy Alifbo 1.0 (`completed: true`) or 2.0 (`seenWordIds`) entries to
 * `status: 'syllable', pendingVoiceVerify: true`.
 */
export function importProgressJson(
  jsonStr: string,
  todayStr: string = getLocalDateString(),
): ImportProgressResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return { ok: false, errorUz: 'Zaxira fayli JSON formatida emas.' };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, errorUz: 'Zaxira fayli tuzilmasi noto‘g‘ri.' };
  }

  const obj = parsed as Record<string, unknown>;
  const isModernExport = obj.exportFormatVersion === '2.2' || obj.schemaVersion === '2.1';

  if (isModernExport) {
    if (typeof obj.checksum !== 'string' || !obj.checksum) {
      return { ok: false, errorUz: 'Zaxira faylida tekshiruv kodi (checksum) topilmadi.' };
    }
    const expected = computeIntegrityChecksum({
      exportFormatVersion:
        typeof obj.exportFormatVersion === 'string' ? obj.exportFormatVersion : undefined,
      schemaVersion: String(obj.schemaVersion ?? ''),
      exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : '',
      wordProgress: obj.wordProgress ?? {},
      state: obj.state,
    });
    if (obj.checksum !== expected) {
      return {
        ok: false,
        errorUz: 'Zaxira fayli buzilgan yoki o‘zgartirilgan (checksum mos kelmadi).',
      };
    }
  } else if (typeof obj.checksum === 'string' && obj.checksum.length > 0) {
    const expected = computeIntegrityChecksum({
      exportFormatVersion:
        typeof obj.exportFormatVersion === 'string' ? obj.exportFormatVersion : undefined,
      schemaVersion: String(obj.schemaVersion ?? ''),
      exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : '',
      wordProgress: obj.wordProgress ?? {},
      state: obj.state,
    });
    if (obj.checksum !== expected) {
      return {
        ok: false,
        errorUz: 'Zaxira fayli buzilgan (checksum mos kelmadi).',
      };
    }
  }

  // Case 1: Full state payload inside export
  if (obj.state && isValidState(obj.state)) {
    const rawStateObj = obj.state as unknown as Record<string, unknown>;
    const normalized = normalizeLoadedState(rawStateObj, obj.state, todayStr);
    const topWordProg = normalizeWordProgressMap(obj.wordProgress, todayStr);
    const mergedWordProgress: Record<string, WordProgress> = {
      ...normalized.wordProgress,
      ...topWordProg.map,
    };
    return {
      ok: true,
      state: {
        ...normalized,
        wordProgress: mergedWordProgress,
      },
      migratedLegacyCount: topWordProg.migratedCount,
    };
  }

  // Case 2: Direct AlifboState v3 JSON or legacy Alifbo 1.0/2.0 partial records
  if (isValidState(obj)) {
    const normalized = normalizeLoadedState(obj as unknown as Record<string, unknown>, obj, todayStr);
    const preCount = Object.values(normalized.wordProgress).filter((w) => w.pendingVoiceVerify).length;
    return {
      ok: true,
      state: normalized,
      migratedLegacyCount: obj.wordProgress === undefined ? preCount : 0,
    };
  }

  const base = createInitialState();
  const migratedWordProgress: Record<string, WordProgress> = {};
  let migratedLegacyCount = 0;

  if (obj.wordProgress && typeof obj.wordProgress === 'object') {
    const { map, migratedCount } = normalizeWordProgressMap(obj.wordProgress, todayStr);
    Object.assign(migratedWordProgress, map);
    migratedLegacyCount += migratedCount;
  }

  if (obj.progressByItem && typeof obj.progressByItem === 'object' && !Array.isArray(obj.progressByItem)) {
    for (const [key, rawItem] of Object.entries(obj.progressByItem as Record<string, unknown>)) {
      if (!rawItem || typeof rawItem !== 'object') continue;
      const itemObj = rawItem as Record<string, unknown>;
      if ((itemObj.completed === true || itemObj.mastered === true) && !migratedWordProgress[key]) {
        migratedWordProgress[key] = createMigratedWordProgress(key, todayStr);
        migratedLegacyCount++;
      }
    }
  }

  if (Array.isArray(obj.completedItems)) {
    for (const id of obj.completedItems) {
      if (typeof id === 'string' && id && !migratedWordProgress[id]) {
        migratedWordProgress[id] = createMigratedWordProgress(id, todayStr);
        migratedLegacyCount++;
      }
    }
  }

  const seenIds = Array.from(
    new Set([
      ...normalizeSeenWordIds(obj.seenWordIds),
      ...Object.keys(migratedWordProgress),
    ]),
  );

  if (!isModernExport && Object.keys(migratedWordProgress).length === 0 && seenIds.length === 0) {
    return { ok: false, errorUz: 'Zaxira faylida o‘quv ma’lumotlari topilmadi.' };
  }

  return {
    ok: true,
    state: {
      ...base,
      seenWordIds: seenIds,
      wordProgress: migratedWordProgress,
    },
    migratedLegacyCount,
  };
}
