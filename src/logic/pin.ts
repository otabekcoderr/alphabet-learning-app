/**
 * Parent child-lock PIN logic with per-install random salt, 10-character recovery code
 * (excluding look-alike 0/O/1/I/L characters), and 30-second lockout after 5 wrong attempts.
 * Note: This is a browser child-lock gate, not strong cryptographic authentication.
 */

const PIN_PATTERN = /^\d{4}$/;
export const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const RECOVERY_CODE_LENGTH = 10;
export const MAX_PIN_ATTEMPTS = 5;
export const PIN_LOCKOUT_MS = 30_000;

export interface PinLockoutState {
  failedAttempts: number;
  lockedUntilMs: number | null;
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function sha256Hex(message: string): string {
  const bytes = new TextEncoder().encode(message);
  const bitLen = bytes.length * 8;
  const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }

    let a = hash[0]!;
    let b = hash[1]!;
    let c = hash[2]!;
    let d = hash[3]!;
    let e = hash[4]!;
    let f = hash[5]!;
    let g = hash[6]!;
    let h = hash[7]!;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i]! + w[i]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    hash[0] = (hash[0]! + a) >>> 0;
    hash[1] = (hash[1]! + b) >>> 0;
    hash[2] = (hash[2]! + c) >>> 0;
    hash[3] = (hash[3]! + d) >>> 0;
    hash[4] = (hash[4]! + e) >>> 0;
    hash[5] = (hash[5]! + f) >>> 0;
    hash[6] = (hash[6]! + g) >>> 0;
    hash[7] = (hash[7]! + h) >>> 0;
  }

  return Array.from(hash, (v) => v.toString(16).padStart(8, '0')).join('');
}

function getCryptoRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export function generateInstallSalt(randomBytes?: Uint8Array): string {
  const bytes = randomBytes ?? getCryptoRandomBytes(16);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function generateRecoveryCode(randomBytes?: Uint8Array): string {
  if (randomBytes) {
    let code = '';
    for (let i = 0; i < RECOVERY_CODE_LENGTH; i++) {
      const b = randomBytes[i % randomBytes.length]!;
      code += RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]!;
    }
    return code;
  }

  // Rejection sampling avoids modulo bias across the 31-character alphabet.
  const limit = 256 - (256 % RECOVERY_ALPHABET.length);
  let code = '';
  while (code.length < RECOVERY_CODE_LENGTH) {
    const chunk = getCryptoRandomBytes(16);
    for (const byte of chunk) {
      if (byte < limit && code.length < RECOVERY_CODE_LENGTH) {
        code += RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length]!;
      }
    }
  }
  return code;
}

export function normalizeRecoveryCode(code: string): string {
  return (code || '').trim().toUpperCase().replace(/[\s-]/g, '');
}

export function isValidPinFormat(pin: string): boolean {
  return PIN_PATTERN.test(pin);
}

export function hashPin(pin: string, salt: string): string {
  return sha256Hex(`pin:${salt}:${pin}`);
}

export function hashRecoveryCode(code: string, salt: string): string {
  return sha256Hex(`recovery:${salt}:${normalizeRecoveryCode(code)}`);
}

export function clearPinLockout(): PinLockoutState {
  return { failedAttempts: 0, lockedUntilMs: null };
}

export function getLockoutStatus(
  lockout: PinLockoutState,
  nowMs: number,
): { locked: boolean; remainingSeconds: number } {
  if (lockout.lockedUntilMs === null || nowMs >= lockout.lockedUntilMs) {
    return { locked: false, remainingSeconds: 0 };
  }
  return {
    locked: true,
    remainingSeconds: Math.max(1, Math.ceil((lockout.lockedUntilMs - nowMs) / 1000)),
  };
}

export function recordFailedPinAttempt(lockout: PinLockoutState, nowMs: number): PinLockoutState {
  const baseFailures =
    lockout.lockedUntilMs !== null && nowMs >= lockout.lockedUntilMs ? 0 : lockout.failedAttempts;
  const nextFailures = baseFailures + 1;
  if (nextFailures >= MAX_PIN_ATTEMPTS) {
    return {
      failedAttempts: nextFailures,
      lockedUntilMs: nowMs + PIN_LOCKOUT_MS,
    };
  }
  return {
    failedAttempts: nextFailures,
    lockedUntilMs: null,
  };
}

export type CreatePinResult =
  | { ok: true; salt: string; pinHash: string; recoveryCode: string; recoveryCodeHash: string }
  | { ok: false; errorUz: string };

export function createInitialPin(
  existingHash: string | null,
  newPin: string,
  confirmPin: string,
  customSalt?: string,
  customCodeBytes?: Uint8Array,
): CreatePinResult {
  if (existingHash !== null) {
    return { ok: false, errorUz: 'PIN-kod allaqachon o‘rnatilgan.' };
  }
  if (!isValidPinFormat(newPin)) {
    return { ok: false, errorUz: 'PIN-kod faqat 4 ta raqamdan iborat bo‘lishi kerak.' };
  }
  if (newPin !== confirmPin) {
    return { ok: false, errorUz: 'Kiritilgan PIN-kodlar mos kelmadi.' };
  }
  const salt = customSalt ?? generateInstallSalt();
  const recoveryCode = generateRecoveryCode(customCodeBytes);
  return {
    ok: true,
    salt,
    pinHash: hashPin(newPin, salt),
    recoveryCode,
    recoveryCodeHash: hashRecoveryCode(recoveryCode, salt),
  };
}

export type PinCheckResult =
  | { ok: true; lockout: PinLockoutState }
  | { ok: false; lockout: PinLockoutState; errorUz: string };

export function verifyPinWithLockout(params: {
  salt: string | null;
  storedHash: string | null;
  candidatePin: string;
  lockout: PinLockoutState;
  nowMs: number;
}): PinCheckResult {
  const status = getLockoutStatus(params.lockout, params.nowMs);
  if (status.locked) {
    return {
      ok: false,
      lockout: params.lockout,
      errorUz: `Ko‘p xato urinish. ${status.remainingSeconds} soniyadan keyin qayta urinib ko‘ring.`,
    };
  }

  if (params.salt && params.storedHash && isValidPinFormat(params.candidatePin)) {
    if (hashPin(params.candidatePin, params.salt) === params.storedHash) {
      return { ok: true, lockout: clearPinLockout() };
    }
  }

  const nextLockout = recordFailedPinAttempt(params.lockout, params.nowMs);
  const nextStatus = getLockoutStatus(nextLockout, params.nowMs);
  return {
    ok: false,
    lockout: nextLockout,
    errorUz: nextStatus.locked
      ? `5 marta noto‘g‘ri kiritildi. ${nextStatus.remainingSeconds} soniya kutib turing.`
      : 'PIN-kod noto‘g‘ri. Qayta urinib ko‘ring.',
  };
}

export type PinUpdateResult =
  | { ok: true; pinHash: string; lockout: PinLockoutState }
  | { ok: false; lockout: PinLockoutState; errorUz: string };

export function resetPinWithRecoveryCode(params: {
  salt: string | null;
  storedRecoveryHash: string | null;
  inputCode: string;
  newPin: string;
  confirmPin: string;
  lockout: PinLockoutState;
  nowMs: number;
}): PinUpdateResult {
  const status = getLockoutStatus(params.lockout, params.nowMs);
  if (status.locked) {
    return {
      ok: false,
      lockout: params.lockout,
      errorUz: `Ko‘p xato urinish. ${status.remainingSeconds} soniya kutib turing.`,
    };
  }

  const normalized = normalizeRecoveryCode(params.inputCode);
  if (
    !params.salt ||
    !params.storedRecoveryHash ||
    normalized.length !== RECOVERY_CODE_LENGTH ||
    hashRecoveryCode(normalized, params.salt) !== params.storedRecoveryHash
  ) {
    const nextLockout = recordFailedPinAttempt(params.lockout, params.nowMs);
    const nextStatus = getLockoutStatus(nextLockout, params.nowMs);
    return {
      ok: false,
      lockout: nextLockout,
      errorUz: nextStatus.locked
        ? `5 marta noto‘g‘ri urinish. ${nextStatus.remainingSeconds} soniya kutib turing.`
        : 'Tiklash kodi noto‘g‘ri.',
    };
  }

  if (!isValidPinFormat(params.newPin)) {
    return {
      ok: false,
      lockout: params.lockout,
      errorUz: 'Yangi PIN-kod faqat 4 ta raqamdan iborat bo‘lishi kerak.',
    };
  }
  if (params.newPin !== params.confirmPin) {
    return {
      ok: false,
      lockout: params.lockout,
      errorUz: 'Yangi PIN-kod tasdig‘i mos kelmadi.',
    };
  }

  return {
    ok: true,
    pinHash: hashPin(params.newPin, params.salt),
    lockout: clearPinLockout(),
  };
}

export function changePin(params: {
  salt: string | null;
  storedHash: string | null;
  currentPin: string;
  newPin: string;
  confirmPin: string;
  lockout: PinLockoutState;
  nowMs: number;
}): PinUpdateResult {
  const check = verifyPinWithLockout({
    salt: params.salt,
    storedHash: params.storedHash,
    candidatePin: params.currentPin,
    lockout: params.lockout,
    nowMs: params.nowMs,
  });
  if (!check.ok) {
    return check;
  }
  if (!isValidPinFormat(params.newPin)) {
    return {
      ok: false,
      lockout: check.lockout,
      errorUz: 'Yangi PIN-kod faqat 4 ta raqamdan iborat bo‘lishi kerak.',
    };
  }
  if (params.newPin !== params.confirmPin) {
    return {
      ok: false,
      lockout: check.lockout,
      errorUz: 'Yangi PIN-kod tasdig‘i mos kelmadi.',
    };
  }
  return {
    ok: true,
    pinHash: hashPin(params.newPin, params.salt!),
    lockout: clearPinLockout(),
  };
}
