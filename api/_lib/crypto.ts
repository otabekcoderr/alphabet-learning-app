import { randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';

export const ACCOUNT_PUBLIC_ID_REGEX = /^\d{8}$/;

/** Generate a cryptographically random 8-digit numeric public ID (no leading zero). */
export function generateAccountPublicId(): string {
  return String(randomInt(10_000_000, 100_000_000));
}

/** Check whether a value is a valid 8-digit numeric public account ID. */
export function isValidAccountPublicId(value: unknown): value is string {
  return typeof value === 'string' && ACCOUNT_PUBLIC_ID_REGEX.test(value);
}

/** Format an 8-digit numeric public ID as `XXXX-XXXX` for display (e.g. `4829-1034`). */
export function formatAccountPublicId(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim();
  if (/^\d{8}$/.test(trimmed)) {
    return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 8)}`;
  }
  return trimmed;
}

/** Generate an internal UUID v4 for account `id`. */
export function generateAccountUuid(): string {
  return randomUUID();
}

export function normalizeContactKey(contact: string): string {
  const trimmed = (contact || '').trim().toLowerCase();
  if (trimmed.includes('@')) {
    return trimmed;
  }
  const digitsOnly = trimmed.replace(/[\s\-()+]/g, '');
  return /^\d{5,}$/.test(digitsOnly) ? digitsOnly : trimmed;
}

export function hashPassword(password: string): { salt: string; hash: string } {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password: string, salt: string, storedHash: string): boolean {
  if (!salt || !storedHash) return false;
  try {
    const derived = scryptSync(password, salt, 64);
    const expected = Buffer.from(storedHash, 'hex');
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
