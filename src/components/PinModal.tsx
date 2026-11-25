import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  createInitialPin,
  formatLockoutRemainingUz,
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
  isGuest?: boolean;
  accountContact?: string;
  onRequestAccountReauth?: () => void;
  onCreatePin: (payload: { salt: string; pinHash: string; recoveryCodeHash: string }) => void;
  onUpdatePinAfterRecovery: (newPinHash: string, lockout: PinLockoutState) => void;
  onUpdateLockout: (lockout: PinLockoutState) => void;
  onEraseAllProgressAndResetPin: () => void;
  onUnlocked: () => void;
  onClose: () => void;
}

type ModalMode = 'setup' | 'show_recovery' | 'enter' | 'recover';
type PinFieldTarget = 'pin' | 'confirm';

const HOLD_DURATION_MS = 2000;
const KEYPAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'BACK'] as const;

function PinDotsDisplay({
  label,
  length,
  active,
  onSelect,
}: {
  label: string;
  length: number;
  active?: boolean;
  onSelect?: () => void;
}) {
  return (
    <div
      className={`pin-dots-box ${active ? 'pin-dots-box-active' : ''}`}
      onClick={onSelect}
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onKeyDown={
        onSelect
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect();
              }
            }
          : undefined
      }
      aria-label={`${label}: ${length}/4 raqam kiritildi`}
    >
      <span className="pin-dots-label">{label}</span>
      <div className="pin-dots-row" aria-hidden="true">
        {[0, 1, 2, 3].map((slot) => (
          <span key={slot} className={`pin-dot ${slot < length ? 'pin-dot-filled' : ''}`} />
        ))}
      </div>
    </div>
  );
}

function TactilePinKeypad({
  disabled,
  onDigit,
  onBackspace,
  onClear,
}: {
  disabled?: boolean;
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  onClear: () => void;
}) {
  return (
    <div className="pin-keypad-grid" role="group" aria-label="Raqamli PIN klaviatura">
      {KEYPAD_KEYS.map((key) => {
        if (key === 'C') {
          return (
            <button
              key="clear"
              type="button"
              disabled={disabled}
              className="pin-keypad-btn pin-keypad-fn"
              onClick={() => {
                playFeedbackChime('pop');
                onClear();
              }}
              aria-label="Tozalash"
            >
              Toza
            </button>
          );
        }
        if (key === 'BACK') {
          return (
            <button
              key="back"
              type="button"
              disabled={disabled}
              className="pin-keypad-btn pin-keypad-fn"
              onClick={() => {
                playFeedbackChime('pop');
                onBackspace();
              }}
              aria-label="O‘chirish"
            >
              ⌫
            </button>
          );
        }
        return (
          <button
            key={key}
            type="button"
            disabled={disabled}
            className="pin-keypad-btn"
            onClick={() => {
              playFeedbackChime('pop');
              onDigit(key);
            }}
          >
            {key}
          </button>
        );
      })}
    </div>
  );
}

export function PinModal({
  pinSalt,
  existingPinHash,
  recoveryCodeHash,
  lockout,
  isGuest = true,
  accountContact,
  onRequestAccountReauth,
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
  const [activeField, setActiveField] = useState<PinFieldTarget>('pin');
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
    if (!isGuest) return;
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
        setActiveField('pin');
        setRecoveryInput('');
        setError(null);
        setMode('setup');
      }
    }, 50);
  };

  const handleDigitInput = useCallback(
    (digit: string) => {
      if (lockoutStatus.locked) return;
      setError(null);
      if (mode === 'enter') {
        setPin((prev) => (prev.length < 4 ? `${prev}${digit}` : prev));
        return;
      }
      if (mode === 'setup' || mode === 'recover') {
        if (activeField === 'pin') {
          setPin((prev) => {
            if (prev.length >= 4) return prev;
            const next = `${prev}${digit}`;
            if (next.length === 4) {
              setActiveField('confirm');
            }
            return next;
          });
        } else {
          setConfirmPin((prev) => (prev.length < 4 ? `${prev}${digit}` : prev));
        }
      }
    },
    [mode, activeField, lockoutStatus.locked],
  );

  const handleBackspaceInput = useCallback(() => {
    if (lockoutStatus.locked) return;
    if (mode === 'enter') {
      setPin((prev) => prev.slice(0, -1));
      return;
    }
    if (mode === 'setup' || mode === 'recover') {
      if (activeField === 'confirm') {
        if (confirmPin.length > 0) {
          setConfirmPin((prev) => prev.slice(0, -1));
        } else {
          setActiveField('pin');
          setPin((prev) => prev.slice(0, -1));
        }
      } else {
        setPin((prev) => prev.slice(0, -1));
      }
    }
  }, [mode, activeField, confirmPin.length, lockoutStatus.locked]);

  const handleClearInput = useCallback(() => {
    setError(null);
    if (mode === 'enter') {
      setPin('');
      return;
    }
    if (activeField === 'confirm') {
      setConfirmPin('');
    } else {
      setPin('');
    }
  }, [mode, activeField]);

  const handleSetupSubmit = useCallback(() => {
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
    setActiveField('pin');
    setMode('show_recovery');
  }, [existingPinHash, pin, confirmPin, onCreatePin]);

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

  const handleEnterSubmit = useCallback(() => {
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
  }, [pinSalt, existingPinHash, pin, lockout, onUpdateLockout, onUnlocked]);

  const handleRecoverySubmit = useCallback(() => {
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
  }, [
    pinSalt,
    recoveryCodeHash,
    recoveryInput,
    pin,
    confirmPin,
    lockout,
    onUpdateLockout,
    onUpdatePinAfterRecovery,
    onUnlocked,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined' || mode === 'show_recovery') return;
    const onKeyDown = (event: KeyboardEvent) => {
      const targetTag = (event.target as { tagName?: string } | null)?.tagName;
      if (targetTag === 'INPUT' || targetTag === 'TEXTAREA') {
        return;
      }
      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        handleDigitInput(event.key);
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        handleBackspaceInput();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (mode === 'enter') handleEnterSubmit();
        else if (mode === 'setup') handleSetupSubmit();
        else if (mode === 'recover') handleRecoverySubmit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    mode,
    handleDigitInput,
    handleBackspaceInput,
    handleEnterSubmit,
    handleSetupSubmit,
    handleRecoverySubmit,
  ]);

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
            <div className="pin-form">
              <div className="pin-dots-pair">
                <PinDotsDisplay
                  label="4 xonali PIN-kod"
                  length={pin.length}
                  active={activeField === 'pin'}
                  onSelect={() => setActiveField('pin')}
                />
                <PinDotsDisplay
                  label="PIN-kodni tasdiqlang"
                  length={confirmPin.length}
                  active={activeField === 'confirm'}
                  onSelect={() => setActiveField('confirm')}
                />
              </div>

              <TactilePinKeypad
                onDigit={handleDigitInput}
                onBackspace={handleBackspaceInput}
                onClear={handleClearInput}
              />

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
                <button type="button" className="btn-3d-emerald" onClick={handleSetupSubmit}>
                  Saqlash
                </button>
              </div>
            </div>
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
              Ota-ona bo‘limiga kirish uchun 4 xonali PIN-kodni tering.
            </p>
            <div className="pin-form">
              <PinDotsDisplay label="4 xonali PIN-kod" length={pin.length} active />

              <TactilePinKeypad
                disabled={lockoutStatus.locked}
                onDigit={handleDigitInput}
                onBackspace={handleBackspaceInput}
                onClear={handleClearInput}
              />

              {lockoutStatus.locked && (
                <div className="feedback-banner feedback-gentle">
                  Ko‘p xato urinish. {formatLockoutRemainingUz(lockoutStatus.remainingSeconds)} kutib turing.
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
                    setActiveField('pin');
                    setMode('recover');
                  }}
                >
                  PIN unutildimi?
                </button>
                <button
                  type="button"
                  disabled={lockoutStatus.locked}
                  className="btn-3d-emerald"
                  onClick={handleEnterSubmit}
                >
                  Kirish
                </button>
              </div>
            </div>
          </>
        )}

        {mode === 'recover' && (
          <>
            <p className="muted-text">
              Saqlab qo‘ygan 10 belgili tiklash kodingizni kiriting — barcha dars natijalari saqlanib qoladi:
            </p>
            <div className="pin-form">
              <label className="pin-label">
                10 belgili tiklash kodi
                <input
                  type="text"
                  name="alifbo_tiklash_kodi"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-form-type="other"
                  maxLength={12}
                  disabled={lockoutStatus.locked}
                  value={recoveryInput}
                  onChange={(e) => setRecoveryInput(e.target.value.toUpperCase())}
                  placeholder="Masalan: K7M9P2X4Q8"
                  className="pin-input-sm"
                />
              </label>

              <div className="pin-dots-pair">
                <PinDotsDisplay
                  label="Yangi 4 xonali PIN"
                  length={pin.length}
                  active={activeField === 'pin'}
                  onSelect={() => setActiveField('pin')}
                />
                <PinDotsDisplay
                  label="Yangi PIN tasdig‘i"
                  length={confirmPin.length}
                  active={activeField === 'confirm'}
                  onSelect={() => setActiveField('confirm')}
                />
              </div>

              <TactilePinKeypad
                disabled={lockoutStatus.locked}
                onDigit={handleDigitInput}
                onBackspace={handleBackspaceInput}
                onClear={handleClearInput}
              />

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
                    setActiveField('pin');
                    setMode('enter');
                  }}
                >
                  <ArrowLeft size={16} />
                  <span>Orqaga</span>
                </button>
                <button
                  type="button"
                  disabled={lockoutStatus.locked}
                  className="btn-3d-emerald"
                  onClick={handleRecoverySubmit}
                >
                  PIN-kodni tiklash
                </button>
              </div>
            </div>

            {isGuest ? (
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
            ) : (
              onRequestAccountReauth && (
                <div className="account-reauth-reset-box">
                  <p className="account-reauth-note">
                    Tiklash kodi yoningizda emasmi? Ro‘yxatdan o‘tgan hisobingizni (
                    <strong>{accountContact || 'Telegram / Google / Parol'}</strong>) qayta
                    tasdiqlab, barcha o‘quv natijalarini saqlagan holda yangi PIN-kod o‘rnatishingiz
                    mumkin.
                  </p>
                  <button
                    type="button"
                    className="btn-3d-cream"
                    style={{ width: '100%' }}
                    onClick={() => {
                      playFeedbackChime('pop');
                      onRequestAccountReauth();
                    }}
                  >
                    Hisobni tasdiqlab yangi PIN o‘rnatish
                  </button>
                </div>
              )
            )}
          </>
        )}
      </motion.div>
    </div>
  );
}
