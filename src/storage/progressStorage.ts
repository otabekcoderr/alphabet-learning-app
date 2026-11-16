import type { ItemProgress } from '../logic/pedagogy';
import { clearPinLockout, type PinLockoutState } from '../logic/pin';

export interface ChildProfileData {
  name: string;
  avatarId: string;
  dailyGoalXp: number;
}

export interface AlifboState {
  schemaVersion: 3;
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

export function getLocalDateString(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function createInitialState(): AlifboState {
  return {
    schemaVersion: 3,
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
    (obj.lastLatencyMs === null || typeof obj.lastLatencyMs === 'number') &&
    typeof obj.lastPracticedAt === 'string'
  );
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
    (obj.profile !== undefined && !isValidProfile(obj.profile))
  ) {
    return false;
  }

  return Object.values(obj.progressByItem as Record<string, unknown>).every(isValidItemProgress);
}

export function loadAlifboState(): StorageLoadResult {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { state: createInitialState(), recoveredCorruptData: false };
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isValidState(parsed)) {
      window.localStorage.setItem(`${BACKUP_PREFIX}${Date.now()}`, raw);
      return { state: createInitialState(), recoveredCorruptData: true };
    }
    const normalized: AlifboState = {
      ...parsed,
      profile: parsed.profile ?? createDefaultProfile(),
    };
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
