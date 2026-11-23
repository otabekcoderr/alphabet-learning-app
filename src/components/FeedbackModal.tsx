import { useEffect, useRef, useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import {
  formatFeedbackTelegramMessage,
  sendTelegramMessage,
} from '../services/telegramService';
import { playFeedbackChime } from '../utils/audioRecorder';
import { Check, CloseIcon, MessageCircle, Send } from './Icons';

export const FEEDBACK_MIN_SESSIONS_FOR_RESULT = 2;
export const FEEDBACK_STORAGE_KEY = 'alifbo_feedback_submissions_v1';

export type FeedbackDisappointment =
  | 'very_disappointed'
  | 'somewhat_disappointed'
  | 'not_disappointed';

export const FEEDBACK_DISAPPOINTMENT_OPTIONS: ReadonlyArray<{
  id: FeedbackDisappointment;
  label: string;
}> = [
  { id: 'very_disappointed', label: 'Juda xafa bo‘laman' },
  { id: 'somewhat_disappointed', label: 'Biroz' },
  { id: 'not_disappointed', label: 'Farqi yo‘q' },
];

export interface StoredFeedbackEntry {
  id: string;
  disappointment: FeedbackDisappointment;
  stuckPoint: string;
  recommendationNote: string;
  sessionsCompleted: number;
  submittedAt: string;
}

/**
 * Show the corner feedback button on the round summary screen only after >= 2 completed sessions.
 */
export function shouldShowResultFeedbackButton(completedSessionsCount: number): boolean {
  return completedSessionsCount >= FEEDBACK_MIN_SESSIONS_FOR_RESULT;
}

function saveFeedbackLocally(entry: StoredFeedbackEntry): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const raw = window.localStorage.getItem(FEEDBACK_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(parsed) ? (parsed as StoredFeedbackEntry[]) : [];
    const next = [...list, entry].slice(-30);
    window.localStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore localStorage failures in restricted environments
  }
}

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  childName?: string;
  publicId?: string;
  sessionsCompleted: number;
}

export function FeedbackModal({
  isOpen,
  onClose,
  childName,
  publicId,
  sessionsCompleted,
}: FeedbackModalProps) {
  const [disappointment, setDisappointment] = useState<FeedbackDisappointment | null>(null);
  const [stuckPoint, setStuckPoint] = useState('');
  const [recommendationNote, setRecommendationNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const mountedRef = useRef(true);
  const closeTimerRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (closeTimerRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    if (closeTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setDisappointment(null);
    setStuckPoint('');
    setRecommendationNote('');
    setSubmitting(false);
    setSubmitted(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) {
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, submitting]);

  if (!isOpen) {
    return null;
  }

  const handleCloseClick = () => {
    if (submitting) return;
    if (closeTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    playFeedbackChime('pop');
    onClose();
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!disappointment || submitting) return;

    setSubmitting(true);
    const submittedAt = new Date().toISOString();
    const optionLabel =
      FEEDBACK_DISAPPOINTMENT_OPTIONS.find((opt) => opt.id === disappointment)?.label ??
      disappointment;

    saveFeedbackLocally({
      id: `fb_${Date.now()}`,
      disappointment,
      stuckPoint: stuckPoint.trim(),
      recommendationNote: recommendationNote.trim(),
      sessionsCompleted,
      submittedAt,
    });

    const messageText = formatFeedbackTelegramMessage({
      disappointmentLabel: optionLabel,
      stuckPoint: stuckPoint.trim(),
      recommendationNote: recommendationNote.trim(),
      sessionsCompleted,
      childName,
      publicId,
      submittedAt,
    });

    await sendTelegramMessage(messageText, { category: 'feedback' });

    if (!mountedRef.current) return;
    playFeedbackChime('chime');
    setSubmitting(false);
    setSubmitted(true);

    if (typeof window !== 'undefined') {
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null;
        if (mountedRef.current) {
          onCloseRef.current();
        }
      }, 1500);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="feedback-modal-title"
      onClick={(event) => {
        if (event.target === event.currentTarget && !submitting) {
          handleCloseClick();
        }
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 24 }}
        className="modal-card feedback-modal-card"
      >
        <div className="modal-header-row">
          <div className="modal-title-with-icon">
            <span className="modal-icon-badge" aria-hidden="true">
              <MessageCircle size={18} />
            </span>
            <h2 id="feedback-modal-title" className="modal-title">
              Fikr bildirish
            </h2>
          </div>

          <button
            type="button"
            className="btn-circle-close"
            disabled={submitting}
            onClick={handleCloseClick}
            aria-label="Yopish"
          >
            <CloseIcon size={18} />
          </button>
        </div>

        {submitted ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="feedback-thanks-box"
            role="status"
          >
            <div className="feedback-thanks-check" aria-hidden="true">
              <Check size={28} strokeWidth={3} />
            </div>
            <h3 className="feedback-thanks-title">Rahmat!</h3>
            <p className="feedback-thanks-text">
              Fikringiz uchun katta rahmat! ALIFBOni yanada yaxshilashda albatta hisobga olamiz.
            </p>
            <button
              type="button"
              className="btn-3d-emerald btn-compact"
              onClick={handleCloseClick}
            >
              Yopish
            </button>
          </motion.div>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="feedback-form">
            <div className="feedback-field">
              <span className="feedback-label">
                1. Agar ALIFBO ertaga yopilib qolsa, qanchalik xafa bo‘lasiz?
              </span>
              <div
                className="feedback-pmf-options"
                role="radiogroup"
                aria-label="ALIFBO yopilib qolsa munosabatingiz"
              >
                {FEEDBACK_DISAPPOINTMENT_OPTIONS.map((opt) => {
                  const selected = disappointment === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={`feedback-pmf-btn ${selected ? 'feedback-pmf-selected' : ''}`}
                      onClick={() => {
                        playFeedbackChime('pop');
                        setDisappointment(opt.id);
                      }}
                    >
                      <span>{opt.label}</span>
                      {selected && <Check size={16} strokeWidth={2.8} />}
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="feedback-field">
              <span className="feedback-label">
                2. Farzandingiz qaysi joyda tushunmay to‘xtab qoldi yoki nima yoqmadi?
              </span>
              <textarea
                rows={3}
                maxLength={500}
                value={stuckPoint}
                onChange={(e) => setStuckPoint(e.target.value)}
                placeholder="Masalan: qaysi mashq qiyin bo‘ldi yoki nima noqulay edi..."
                className="feedback-textarea"
              />
            </label>

            <label className="feedback-field">
              <span className="feedback-label">
                3. Buni boshqa ota-onaga tavsiya qilarmidingiz? Yo‘q bo‘lsa, nima yetishmayapti?
              </span>
              <textarea
                rows={3}
                maxLength={500}
                value={recommendationNote}
                onChange={(e) => setRecommendationNote(e.target.value)}
                placeholder="Qisqacha fikringiz..."
                className="feedback-textarea"
              />
            </label>

            <div className="feedback-actions">
              <button
                type="button"
                className="btn-3d-cream btn-compact"
                disabled={submitting}
                onClick={handleCloseClick}
              >
                Bekor qilish
              </button>
              <button
                type="submit"
                className="btn-3d-emerald btn-compact btn-with-icon"
                disabled={!disappointment || submitting}
              >
                <Send size={16} />
                <span>{submitting ? 'Yuborilmoqda...' : 'Yuborish'}</span>
              </button>
            </div>
          </form>
        )}
      </motion.div>
    </div>
  );
}
