import { describe, expect, it } from 'vitest';
import {
  changePin,
  clearPinLockout,
  createInitialPin,
  generateInstallSalt,
  generateRecoveryCode,
  getLockoutStatus,
  hashPin,
  MAX_PIN_ATTEMPTS,
  PIN_LOCKOUT_MS,
  RECOVERY_ALPHABET,
  RECOVERY_CODE_LENGTH,
  resetPinWithRecoveryCode,
  verifyPinWithLockout,
} from '../pin';

describe('parent PIN, per-install salt, recovery code, and lockout logic', () => {
  it('generates a 10-character recovery code via crypto.getRandomValues without look-alike chars (0/O/1/I/L)', () => {
    for (let i = 0; i < 20; i++) {
      const code = generateRecoveryCode();
      expect(code).toHaveLength(RECOVERY_CODE_LENGTH);
      expect(code).not.toMatch(/[0O1IL]/);
      for (const ch of code) {
        expect(RECOVERY_ALPHABET).toContain(ch);
      }
    }
  });

  it('uses per-install random salt so identical PINs produce distinct hashes', () => {
    const saltA = generateInstallSalt();
    const saltB = generateInstallSalt();
    expect(saltA).not.toBe(saltB);
    expect(hashPin('2580', saltA)).not.toBe(hashPin('2580', saltB));
  });

  it('creates PIN with hashed PIN + hashed recovery code and rejects invalid setup inputs', () => {
    const created = createInitialPin(null, '2580', '2580');
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(created.pinHash).not.toBe('2580');
    expect(created.recoveryCodeHash).not.toBe(created.recoveryCode);
    expect(created.recoveryCode).toHaveLength(10);

    expect(createInitialPin(null, '12', '12').ok).toBe(false);
    expect(createInitialPin(null, 'abcd', 'abcd').ok).toBe(false);
    expect(createInitialPin(null, '1234', '5678').ok).toBe(false);
    expect(createInitialPin(created.pinHash, '2222', '2222').ok).toBe(false);
  });

  it('imposes a 30-second lockout after 5 wrong attempts and allows retry after delay', () => {
    const created = createInitialPin(null, '4321', '4321');
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    let lockout = clearPinLockout();
    const baseTime = 1_000_000;

    for (let attempt = 1; attempt < MAX_PIN_ATTEMPTS; attempt++) {
      const res = verifyPinWithLockout({
        salt: created.salt,
        storedHash: created.pinHash,
        candidatePin: '0000',
        lockout,
        nowMs: baseTime + attempt * 1000,
      });
      expect(res.ok).toBe(false);
      lockout = res.lockout;
      expect(getLockoutStatus(lockout, baseTime + attempt * 1000).locked).toBe(false);
    }

    // 5th wrong attempt triggers 30s lockout
    const fifthTime = baseTime + 5000;
    const fifth = verifyPinWithLockout({
      salt: created.salt,
      storedHash: created.pinHash,
      candidatePin: '0000',
      lockout,
      nowMs: fifthTime,
    });
    expect(fifth.ok).toBe(false);
    lockout = fifth.lockout;
    expect(getLockoutStatus(lockout, fifthTime).locked).toBe(true);
    expect(getLockoutStatus(lockout, fifthTime).remainingSeconds).toBe(30);

    // Correct PIN is rejected while locked
    const blocked = verifyPinWithLockout({
      salt: created.salt,
      storedHash: created.pinHash,
      candidatePin: '4321',
      lockout,
      nowMs: fifthTime + 10_000,
    });
    expect(blocked.ok).toBe(false);

    // After 30 seconds, correct PIN succeeds and clears lockout
    const unlocked = verifyPinWithLockout({
      salt: created.salt,
      storedHash: created.pinHash,
      candidatePin: '4321',
      lockout,
      nowMs: fifthTime + PIN_LOCKOUT_MS,
    });
    expect(unlocked.ok).toBe(true);
    expect(unlocked.lockout.failedAttempts).toBe(0);
  });

  it('resets forgotten PIN with valid 10-char recovery code and rejects wrong code', () => {
    const created = createInitialPin(null, '1975', '1975');
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const badReset = resetPinWithRecoveryCode({
      salt: created.salt,
      storedRecoveryHash: created.recoveryCodeHash,
      inputCode: 'AAAAAAAAAA',
      newPin: '8888',
      confirmPin: '8888',
      lockout: clearPinLockout(),
      nowMs: 1000,
    });
    expect(badReset.ok).toBe(false);

    const goodReset = resetPinWithRecoveryCode({
      salt: created.salt,
      storedRecoveryHash: created.recoveryCodeHash,
      inputCode: created.recoveryCode.toLowerCase(),
      newPin: '8888',
      confirmPin: '8888',
      lockout: clearPinLockout(),
      nowMs: 2000,
    });
    expect(goodReset.ok).toBe(true);
    if (!goodReset.ok) return;

    const checkNew = verifyPinWithLockout({
      salt: created.salt,
      storedHash: goodReset.pinHash,
      candidatePin: '8888',
      lockout: goodReset.lockout,
      nowMs: 3000,
    });
    expect(checkNew.ok).toBe(true);
  });

  it('changes PIN only when current PIN matches', () => {
    const created = createInitialPin(null, '1111', '1111');
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const badChange = changePin({
      salt: created.salt,
      storedHash: created.pinHash,
      currentPin: '9999',
      newPin: '2222',
      confirmPin: '2222',
      lockout: clearPinLockout(),
      nowMs: 1000,
    });
    expect(badChange.ok).toBe(false);

    const goodChange = changePin({
      salt: created.salt,
      storedHash: created.pinHash,
      currentPin: '1111',
      newPin: '2222',
      confirmPin: '2222',
      lockout: clearPinLockout(),
      nowMs: 2000,
    });
    expect(goodChange.ok).toBe(true);
  });
});
