import { useState } from 'react';
import { motion } from 'framer-motion';
import { DYNAMIC_WORD_POOL } from '../data/curriculum';
import { playFeedbackChime } from '../utils/audioRecorder';
import { ArrowLeft, ArrowRight, BookOpen, Check, CloseIcon, Lock } from './Icons';

interface ParentOnboardingModalProps {
  unverifiedCap?: number;
  initialStep?: 1 | 2 | 3;
  isReplay?: boolean;
  onComplete: () => void;
  onClose: () => void;
}

export function ParentOnboardingModal({
  unverifiedCap: _unverifiedCap,
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
            <h2 id="onboarding-modal-title">1. 5 ta o‘qish olami va 3 bosqichli usul</h2>
            <p className="onboarding-text">
              Ilovadagi {DYNAMIC_WORD_POOL.length} ta so‘z va qisqa gaplar 5 ta o‘qish olamiga taqsimlangan. Har bir so‘z 3
              bosqichli zinapoyadan o‘tadi:
            </p>
            <ol className="onboarding-list">
              <li>
                <strong>Qurish:</strong> Bo‘g‘in konstruktori, pufakchalar yoki poyezd bilan so‘zni yig‘adi.
              </li>
              <li>
                <strong>Fonarcha:</strong> Bo‘g‘inlarni ketma-ket yoritib o‘qiydi va rasmga moslaydi.
              </li>
              <li>
                <strong>Mustaqil imtihon:</strong> Rasmsiz mustaqil o‘qish (ovozli yoki 4 rasmli tekshiruv).
              </li>
            </ol>
          </div>
        )}

        {step === 2 && (
          <div className="onboarding-body">
            <div className="onboarding-icon-circle" aria-hidden="true">
              <Check size={30} color="#059669" strokeWidth={3} />
            </div>
            <h2 id="onboarding-modal-title">2. Ota-ona kuzatuvi va kunlik eslatma</h2>
            <p className="onboarding-text">
              <strong>«Bugun»</strong> va <strong>«Diagnostika»</strong> bo‘limlarida farzandingiz
              qiynalayotgan harflarni ko‘rasiz hamda rasmli rejimda o‘qilgan so‘zlarni bir tugmada
              tasdiqlaysiz.
            </p>
            <p className="onboarding-text">
              Shuningdek, <strong>@alifbo_uz_robot</strong> Telegram boti orqali kechki kunlik
              mashq eslatmalarini yoqishingiz mumkin.
            </p>
          </div>
        )}

        {step === 3 && (
          <div className="onboarding-body">
            <div className="onboarding-icon-circle" aria-hidden="true">
              <Lock size={28} color="#F97316" />
            </div>
            <h2 id="onboarding-modal-title">3. PIN-kod va hisob himoyasi</h2>
            <p className="onboarding-text">
              Ota-ona bo‘limi 4 xonali PIN-kod bilan himoyalangan. PIN o‘rnatilganda 10 belgili
              bir martalik tiklash kodi beriladi.
            </p>
            <p className="onboarding-text">
              Ro‘yxatdan o‘tgan hisoblarda PIN esdan chiqsa ham hisobingizni qayta tasdiqlab,
              natijalarni yo‘qotmasdan yangi PIN o‘rnatishingiz mumkin.
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
