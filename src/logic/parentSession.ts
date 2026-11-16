/**
 * Pure lifecycle rules for temporary in-memory "Ota-ona yonida" mode.
 * Never persisted to localStorage.
 */

export const PARENT_SESSION_TIMEOUT_MS = 180_000; // 3 minutes

export type ParentSessionCloseEvent =
  | 'lesson_completed'
  | 'lesson_exited'
  | 'visibility_hidden'
  | 'window_blur';

export function isParentSessionExpired(
  lastActiveMs: number | null,
  nowMs: number,
  timeoutMs: number = PARENT_SESSION_TIMEOUT_MS,
): boolean {
  if (lastActiveMs === null) return true;
  return nowMs - lastActiveMs >= timeoutMs;
}

export function shouldCloseParentSessionOnEvent(event: ParentSessionCloseEvent): boolean {
  return (
    event === 'lesson_completed' ||
    event === 'lesson_exited' ||
    event === 'visibility_hidden' ||
    event === 'window_blur'
  );
}
