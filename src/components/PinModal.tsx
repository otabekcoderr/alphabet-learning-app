import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  createInitialPin,
  getLockoutStatus,
  resetPinWithRecoveryCode,
  verifyPinWithLockout,
  type PinLockoutState,
} from '../logic/pin';

interface PinModalProps {
  pinSalt: string | null;
  existingPinHash: string | null;
  recoveryCodeHash: string | null;
  lockout: PinLockoutState;
  onCreatePin: (payload: { salt: string; pinHash: string; recoveryCodeHash: string }) => void;
  onUpdatePinAfterRecovery: (newPinHash: string, lockout: PinLockoutState) => void;
  onUpdateLockout: (lockout: PinLockoutState) => void;
  onEraseAllProgressAndResetPin: () => void;
  onUnlocked: () => void;
  onClose: () => void;
}

type ModalMode = 'setup' | 'show_recovery' | 'enter' | 'recover';

const HOLD_DURATION_MS = 2000;

export function PinModal({
  pinSalt,
  existingPinHash,
  recoveryCodeHash,
  lockout,
  onCreatePin,
  onUpdatePinAfterRecovery,
  onUpdateLockout,
  onEraseAllProgressAndResetPin,
  onUnlocked,
  onClose,
}: PinModalProps) {
  const [mode, setMode] = useState<ModalMode>(existingPinHash === null ? 'setup' : 'enter');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [recoveryInput, setRecoveryInput] = useState('');
  const [createdRecoveryCode, setCreatedRecoveryCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [holdProgress, setHoldProgress] = useState<number>(0);

  const holdTimerRef = useRef<number | null>(null);

  const lockoutStatus = getLockoutStatus(lockout, nowMs);

  useEffect(() => {
    if (!lockoutStatus.locked) return;
    const id = window.setInterval(() => {
      setNowMs(Date.now());
    }, 500);
    return () => window.clearInterval(id);
  }, [lockoutStatus.locked]);

  useEffect(() => {
    return () => {
      if (holdTimerRef.current !== null) {
        window.clearInterval(holdTimerRef.current);
      }
    };
  }, []);

  const stopHold = () => {
    if (holdTimerRef.current !== null) {
      window.clearInterval(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    setHoldProgress(0);
  };

  const startHoldToErase = () => {
    stopHold();
    const start = Date.now();
    holdTimerRef.current = window.setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.min(100, Math.round((elapsed / HOLD_DURATION_MS) * 100));
      setHoldProgress(pct);
      if (elapsed >= HOLD_DURATION_MS) {
        stopHold();
        onEraseAllProgressAndResetPin();
        setPin('');
        setConfirmPin('');
        setRecoveryInput('');
        setError(null);
        setMode('setup');
      }
    }, 50);
  };

  const handleSetupSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const res = createInitialPin(existingPinHash, pin.trim(), confirmPin.trim());
    if (!res.ok) {
      setError(res.errorUz);
      return;
    }
    onCreatePin({
      salt: res.salt,
      pinHash: res.pinHash,
      recoveryCodeHash: res.recoveryCodeHash,
    });
    setCreatedRecoveryCode(res.recoveryCode);
    setPin('');
    setConfirmPin('');
    setMode('show_recovery');
  };

  const handleEnterSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const currentNow = Date.now();
    setNowMs(currentNow);

    const res = verifyPinWithLockout({
      salt: pinSalt,
      storedHash: existingPinHash,
      candidatePin: pin.trim(),
      lockout,
      nowMs: currentNow,
    });
    onUpdateLockout(res.lockout);

    if (!res.ok) {
      setError(res.errorUz);
      setPin('');
      return;
    }
    onUnlocked();
  };

  const handleRecoverySubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const currentNow = Date.now();
    setNowMs(currentNow);

    const res = resetPinWithRecoveryCode({
      salt: pinSalt,
      storedRecoveryHash: recoveryCodeHash,
      inputCode: recoveryInput,
      newPin: pin.trim(),
      confirmPin: confirmPin.trim(),
      lockout,
      nowMs: currentNow,
    });
    onUpdateLockout(res.lockout);

    if (!res.ok) {
      setError(res.errorUz);
      return;
    }
    onUpdatePinAfterRecovery(res.pinHash, res.lockout);
    onUnlocked();
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="pin-modal-title">
      <div className="modal-card">
        {mode === 'setup' && (
          <>
            <h2 id="pin-modal-title">🔒 Ota-ona uchun PIN-kod yarating</h2>
            <p className="muted-text">
              Birinchi kirishda 4 xonali PIN-kod o‘rnating. Bu bolalar uchun oddiy cheklov bo‘lib, kuchli
              kriptografik himoya emas.
            </p>
            <form onSubmit={handleSetupSubmit} className="pin-form">
              <label className="pin-label">
                4 xonali PIN-kod
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="\d{4}"
                  maxLength={4}
                  autoFocus
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="••••"
                  className="pin-input"
                />
              </label>
              <label className="pin-label">
                PIN-kodni tasdiqlang
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="\d{4}"
                  maxLength={4}
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="••••"
                  className="pin-input"
                />
              </label>
              {error && <div className="feedback-banner feedback-gentle">{error}</div>}
              <div className="pin-actions">
                <button type="button" className="btn-secondary" onClick={onClose}>
                  Bekor qilish
                </button>
                <button type="submit" className="btn-primary">
                  Saqlash
                </button>
              </div>
            </form>
          </>
        )}

        {mode === 'show_recovery' && createdRecoveryCode && (
          <>
            <h2 id="pin-modal-title">🔑 Bir martalik tiklash kodi</h2>
            <p className="muted-text">
              PIN-kodni unutib qo‘ysangiz, ma’lumotlarni yo‘qotmasdan tiklash uchun ushbu 10 belgili kodni
              yozib oling. U boshqa ko‘rsatilmaydi:
            </p>
            <div className="recovery-code-box" aria-label="Tiklash kodi">
              {createdRecoveryCode}
            </div>
            <div className="pin-actions">
              <button type="button" className="btn-primary" onClick={onUnlocked}>
                Kodni saqladim — Kirish
              </button>
            </div>
          </>
        )}

        {mode === 'enter' && (
          <>
            <h2 id="pin-modal-title">🔒 Ota-ona bo‘limi</h2>
            <p className="muted-text">
              Kirish uchun 4 xonali PIN-kodni kiriting. (Bu bolalar uchun oddiy cheklov, kuchli xavfsizlik tizimi
              emas.)
            </p>
            <form onSubmit={handleEnterSubmit} className="pin-form">
              <label className="pin-label">
                4 xonali PIN-kod
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="\d{4}"
                  maxLength={4}
                  autoFocus
                  disabled={lockoutStatus.locked}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="••••"
                  className="pin-input"
                />
              </label>
              {lockoutStatus.locked && (
                <div className="feedback-banner feedback-gentle">
                  Ko‘p xato urinish. {lockoutStatus.remainingSeconds} soniya kutib turing.
                </div>
              )}
              {error && !lockoutStatus.locked && <div className="feedback-banner feedback-gentle">{error}</div>}
              <div className="pin-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setError(null);
                    setPin('');
                    setConfirmPin('');
                    setMode('recover');
                  }}
                >
                  PIN unutildimi?
                </button>
                <button type="button" className="btn-secondary" onClick={onClose}>
                  Yopish
                </button>
                <button type="submit" disabled={lockoutStatus.locked} className="btn-primary">
                  Kirish
                </button>
              </div>
            </form>
          </>
        )}

        {mode === 'recover' && (
          <>
            <h2 id="pin-modal-title">🔑 PIN-kodni tiklash</h2>
            <p className="muted-text">
              Saqlab qo‘ygan 10 belgili tiklash kodingizni kiriting — barcha dars natijalari saqlanib qoladi:
            </p>
            <form onSubmit={handleRecoverySubmit} className="pin-form">
              <label className="pin-label">
                10 belgili tiklash kodi
                <input
                  type="text"
                  maxLength={12}
                  disabled={lockoutStatus.locked}
                  value={recoveryInput}
                  onChange={(e) => setRecoveryInput(e.target.value.toUpperCase())}
                  placeholder="Masalan: K7M9P2X4Q8"
                  className="pin-input-sm"
                />
              </label>
              <label className="pin-label">
                Yangi 4 xonali PIN
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  disabled={lockoutStatus.locked}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="••••"
                  className="pin-input"
                />
              </label>
              <label className="pin-label">
                Yangi PIN tasdig‘i
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  disabled={lockoutStatus.locked}
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="••••"
                  className="pin-input"
                />
              </label>
              {error && <div className="feedback-banner feedback-gentle">{error}</div>}
              <div className="pin-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setError(null);
                    setMode('enter');
                  }}
                >
                  ← Orqaga
                </button>
                <button type="submit" disabled={lockoutStatus.locked} className="btn-primary">
                  PIN-kodni tiklash
                </button>
              </div>
            </form>

            <div className="erase-reset-box">
              <p className="warning-note">
                ⚠️ Agar PIN-kod ham, tiklash kodi ham yo‘qolgan bo‘lsa: quyidagi tugmani{' '}
                <strong>2 soniya bosib turing</strong>. Barcha dars natijalari, yulduzchalar va PIN-kod butunlay
                o‘chiriladi!
              </p>
              <button
                type="button"
                className="btn-hold-erase"
                onPointerDown={startHoldToErase}
                onPointerUp={stopHold}
                onPointerLeave={stopHold}
                onPointerCancel={stopHold}
              >
                {holdProgress > 0
                  ? `O‘chirilmoqda... ${holdProgress}%`
                  : 'Natijalarni o‘chirib qayta boshlash (bosib turing)'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
