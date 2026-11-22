import { useEffect, useRef, useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import {
  createInitialPin,
  getLockoutStatus,
  resetPinWithRecoveryCode,
  verifyPinWithLockout,
  type PinLockoutState,
} from '../logic/pin';
import { playFeedbackChime } from '../utils/audioRecorder';
import { ArrowLeft, CheckIcon, CloseIcon, CopyIcon, Lock } from './Icons';

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
  const [hasCopied, setHasCopied] = useState(false);
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
      playFeedbackChime('soft-bonk');
      setError(res.errorUz);
      return;
    }
    playFeedbackChime('chime');
    onCreatePin({
      salt: res.salt,
      pinHash: res.pinHash,
      recoveryCodeHash: res.recoveryCodeHash,
    });
    setCreatedRecoveryCode(res.recoveryCode);
    setHasCopied(false);
    setPin('');
    setConfirmPin('');
    setMode('show_recovery');
  };

  const handleCopyRecoveryCode = async () => {
    if (!createdRecoveryCode) return;
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(createdRecoveryCode);
        copied = true;
      }
    } catch {
      copied = false;
    }
    if (!copied && typeof document !== 'undefined') {
      try {
        const ta = document.createElement('textarea');
        ta.value = createdRecoveryCode;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        copied = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {
        copied = false;
      }
    }
    if (copied) {
      playFeedbackChime('pop');
      setHasCopied(true);
      setError(null);
    } else {
      playFeedbackChime('soft-bonk');
      setError('Avtomatik nusxalab bo‘lmadi — kodni yozib oling va qayta urinib ko‘ring.');
    }
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
      playFeedbackChime('soft-bonk');
      setError(res.errorUz);
      setPin('');
      return;
    }
    playFeedbackChime('chime');
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
      playFeedbackChime('soft-bonk');
      setError(res.errorUz);
      return;
    }
    playFeedbackChime('chime');
    onUpdatePinAfterRecovery(res.pinHash, res.lockout);
    onUnlocked();
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="pin-modal-title">
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 24 }}
        className="modal-card"
      >
        <div className="modal-header-row">
          <div className="modal-title-with-icon">
            <span className="modal-icon-badge">
              <Lock size={18} />
            </span>
            <h2 id="pin-modal-title" className="modal-title">
              {mode === 'setup'
                ? 'Ota-ona uchun PIN-kod yarating'
                : mode === 'show_recovery'
                  ? 'Bir martalik tiklash kodi'
                  : mode === 'enter'
                    ? 'Ota-ona bo‘limi'
                    : 'PIN-kodni tiklash'}
            </h2>
          </div>

          <button
            type="button"
            className="btn-circle-close"
            onClick={() => {
              playFeedbackChime('pop');
              onClose();
            }}
            aria-label="Yopish"
          >
            <CloseIcon size={18} />
          </button>
        </div>

        {mode === 'setup' && (
          <>
            <p className="muted-text">
              Birinchi kirishda 4 xonali PIN-kod o‘rnating. Bu farzandingiz sozlamalarni tasodifan
              o‘zgartirib yubormasligi uchun oddiy qulf vazifasini bajaradi.
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
              {error && (
                <motion.div
                  animate={{ x: [0, -6, 6, -4, 4, 0] }}
                  className="feedback-banner feedback-gentle"
                >
                  {error}
                </motion.div>
              )}
              <div className="pin-actions">
                <button type="button" className="btn-3d-cream" onClick={onClose}>
                  Bekor qilish
                </button>
                <button type="submit" className="btn-3d-emerald">
                  Saqlash
                </button>
              </div>
            </form>
          </>
        )}

        {mode === 'show_recovery' && createdRecoveryCode && (
          <>
            <p className="muted-text">
              PIN-kodni unutib qo‘ysangiz, ma’lumotlarni yo‘qotmasdan tiklash uchun ushbu 10 belgili kodni
              yozib oling yoki nusxalang. U boshqa ko‘rsatilmaydi:
            </p>
            <div className="recovery-code-box" aria-label="Tiklash kodi">
              {createdRecoveryCode}
            </div>
            {error && <div className="feedback-banner feedback-gentle">{error}</div>}
            <div className="pin-actions">
              {!hasCopied ? (
                <button
                  type="button"
                  className="btn-3d-emerald btn-with-icon"
                  style={{ width: '100%' }}
                  onClick={() => void handleCopyRecoveryCode()}
                >
                  <CopyIcon size={16} />
                  <span>Kodni nusxalash</span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn-3d-cream btn-with-icon"
                    onClick={() => void handleCopyRecoveryCode()}
                  >
                    <CheckIcon size={16} />
                    <span>✅ Nusxalandi!</span>
                  </button>
                  <motion.button
                    type="button"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="btn-3d-emerald"
                    onClick={onUnlocked}
                  >
                    Ota-ona paneliga kirish
                  </motion.button>
                </>
              )}
            </div>
          </>
        )}

        {mode === 'enter' && (
          <>
            <p className="muted-text">
              Ota-ona bo‘limiga kirish uchun 4 xonali PIN-kodni kiriting.
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
              {error && !lockoutStatus.locked && (
                <motion.div
                  animate={{ x: [0, -6, 6, -4, 4, 0] }}
                  className="feedback-banner feedback-gentle"
                >
                  {error}
                </motion.div>
              )}
              <div className="pin-actions">
                <button
                  type="button"
                  className="btn-3d-cream"
                  onClick={() => {
                    setError(null);
                    setPin('');
                    setConfirmPin('');
                    setMode('recover');
                  }}
                >
                  PIN unutildimi?
                </button>
                <button
                  type="submit"
                  disabled={lockoutStatus.locked}
                  className="btn-3d-emerald"
                >
                  Kirish
                </button>
              </div>
            </form>
          </>
        )}

        {mode === 'recover' && (
          <>
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
              {error && (
                <motion.div
                  animate={{ x: [0, -6, 6, -4, 4, 0] }}
                  className="feedback-banner feedback-gentle"
                >
                  {error}
                </motion.div>
              )}
              <div className="pin-actions">
                <button
                  type="button"
                  className="btn-3d-cream btn-with-icon"
                  onClick={() => {
                    setError(null);
                    setMode('enter');
                  }}
                >
                  <ArrowLeft size={16} />
                  <span>Orqaga</span>
                </button>
                <button
                  type="submit"
                  disabled={lockoutStatus.locked}
                  className="btn-3d-emerald"
                >
                  PIN-kodni tiklash
                </button>
              </div>
            </form>

            <div className="erase-reset-box">
              <p className="warning-note">
                Agar PIN-kod ham, tiklash kodi ham yo‘qolgan bo‘lsa: quyidagi tugmani{' '}
                <strong>2 soniya bosib turing</strong>. Barcha dars natijalari, yulduzchalar va PIN-kod
                butunlay o‘chiriladi!
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
      </motion.div>
    </div>
  );
}
