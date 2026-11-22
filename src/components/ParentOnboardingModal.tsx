import { useState } from 'react';
import { motion } from 'framer-motion';
import { playFeedbackChime } from '../utils/audioRecorder';
import { ArrowLeft, ArrowRight, BookOpen, Check, CloseIcon, Lock } from './Icons';

interface ParentOnboardingModalProps {
  unverifiedCap: number;
  initialStep?: 1 | 2 | 3;
  isReplay?: boolean;
  onComplete: () => void;
  onClose: () => void;
}

export function ParentOnboardingModal({
  unverifiedCap,
  initialStep = 1,
  isReplay = false,
  onComplete,
  onClose,
}: ParentOnboardingModalProps) {
  const [step, setStep] = useState<1 | 2 | 3>(initialStep);

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-modal-title"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 24 }}
        className="modal-card onboarding-modal-card"
      >
        <div className="onboarding-topbar">
          <span className="onboarding-step-pill">Ota-ona tanishtiruvi · {step} / 3</span>
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

        <div className="onboarding-dots" aria-hidden="true">
          {[1, 2, 3].map((idx) => (
            <span
              key={idx}
              className={`onboarding-dot ${
                step === idx ? 'onboarding-dot-active' : step > idx ? 'onboarding-dot-done' : ''
              }`}
            />
          ))}
        </div>

        {step === 1 && (
          <div className="onboarding-body">
            <div className="onboarding-icon-circle" aria-hidden="true">
              <BookOpen size={30} color="#059669" />
            </div>
            <h2 id="onboarding-modal-title">1. Ilova nima qiladi?</h2>
            <p className="onboarding-text">
              Ilovada 139 ta so‘z va mashq 5 ta o‘qish olamiga taqsimlangan.
            </p>
            <ol className="onboarding-list">
              <li>
                <strong>Tinglaydi:</strong> Harf yoki so‘zni ko‘radi va namuna ovozni eshitadi.
              </li>
              <li>
                <strong>Eshitib topadi:</strong> Eshitgan variantini karta ichidan tanlaydi.
              </li>
              <li>
                <strong>Ulaydi:</strong> Bo‘g‘in kubiklari va slayder bilan so‘zlarni birlashtiradi.
              </li>
              <li>
                <strong>Ovoz chiqarib aytadi:</strong> Mustaqil o‘qish imtihonidan o‘tadi.
              </li>
            </ol>
          </div>
        )}

        {step === 2 && (
          <div className="onboarding-body">
            <div className="onboarding-icon-circle" aria-hidden="true">
              <Check size={30} color="#059669" strokeWidth={3} />
            </div>
            <h2 id="onboarding-modal-title">2. Ota-ona tasdig‘i qanday ishlaydi?</h2>
            <p className="onboarding-text">
              Bola <strong>{unverifiedCap} ta darsni</strong> mustaqil mashq qilgach, keyingi yangi darslarni
              ochish uchun ota-ona tasdig‘i so‘raladi.
            </p>
            <p className="onboarding-text">
              Siz <strong>«Tasdiqlash»</strong> bo‘limida bola o‘qib berganini tinglab,{' '}
              <strong>«Ravon o‘qidi»</strong> yoki <strong>«Yana mashq»</strong> tugmasini bosasiz.
            </p>
          </div>
        )}

        {step === 3 && (
          <div className="onboarding-body">
            <div className="onboarding-icon-circle" aria-hidden="true">
              <Lock size={28} color="#F97316" />
            </div>
            <h2 id="onboarding-modal-title">3. PIN-kod va tiklash kodi</h2>
            <p className="onboarding-text">
              Ota-ona bo‘limiga kirish uchun 4 xonali PIN-kod o‘rnatasiz (bu bolalar uchun oddiy cheklovdir).
            </p>
            <p className="onboarding-text">
              PIN-kod yaratilganda 10 belgili bir martalik tiklash kodi ko‘rsatiladi. PIN esdan chiqsa,
              dars natijalarini yo‘qotmasdan qayta tiklash uchun uni albatta yozib oling.
            </p>
          </div>
        )}

        <div className="onboarding-actions">
          {step > 1 ? (
            <button
              type="button"
              className="btn-3d-cream btn-compact btn-with-icon"
              onClick={() => {
                playFeedbackChime('pop');
                setStep((prev) => (prev === 3 ? 2 : 1));
              }}
            >
              <ArrowLeft size={16} />
              <span>Orqaga</span>
            </button>
          ) : (
            <span />
          )}

          {step < 3 ? (
            <button
              type="button"
              className="btn-3d-emerald btn-compact btn-with-icon"
              onClick={() => {
                playFeedbackChime('pop');
                setStep((prev) => (prev === 1 ? 2 : 3));
              }}
            >
              <span>Keyingi ({step + 1}/3)</span>
              <ArrowRight size={16} />
            </button>
          ) : (
            <button
              type="button"
              className="btn-3d-emerald btn-compact"
              onClick={() => {
                playFeedbackChime('pop');
                onComplete();
              }}
            >
              {isReplay ? 'Tushunarli' : 'Davom etish →'}
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
