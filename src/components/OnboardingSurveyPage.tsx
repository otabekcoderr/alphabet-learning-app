import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  buildSurveyDataFromStrategic,
  getOnboardingOptionLabels,
  isStrategicStepComplete,
  ONBOARDING_ATTEMPT_OPTIONS,
  ONBOARDING_DIFFICULTY_OPTIONS,
  ONBOARDING_STAGE_OPTIONS,
  resolveRecommendedWorldFromStage,
  saveStrategicOnboardingAnswers,
  type StrategicOnboardingAnswers,
} from '../logic/onboarding';
import {
  formatOnboardingTelegramMessage,
  sendTelegramMessage,
} from '../services/telegramService';
import type {
  OnboardingBiggestDifficulty,
  OnboardingChildStage,
  OnboardingPreviousAttempt,
  SurveyData,
} from '../storage/progressStorage';
import { playFeedbackChime } from '../utils/audioRecorder';
import { AnimatedCharacter } from './AnimatedCharacter';
import { ArrowLeft, ArrowRight, Check } from './Icons';
import { StorybookBackdrop } from './StorybookBackdrop';

interface OnboardingSurveyPageProps {
  childName: string;
  avatarId: string;
  publicId?: string;
  initialSurvey?: SurveyData | null;
  onComplete: (result: { surveyData: SurveyData; recommendedWorldId: 1 | 2 | 3 | 4 | 5 }) => void;
  onCancelEdit?: () => void;
}

const AUTO_ADVANCE_DELAY_MS = 220;

/**
 * Full-screen 4-step strategic onboarding page.
 * Steps 1-3 use 1-tap cards that automatically advance; Step 4 collects optional contact.
 */
export function OnboardingSurveyPage({
  childName,
  avatarId,
  publicId,
  initialSurvey,
  onComplete,
  onCancelEdit,
}: OnboardingSurveyPageProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [childStage, setChildStage] = useState<OnboardingChildStage | null>(
    initialSurvey?.childStage ?? null,
  );
  const [previousAttempt, setPreviousAttempt] = useState<OnboardingPreviousAttempt | null>(
    initialSurvey?.previousAttempt ?? null,
  );
  const [biggestDifficulty, setBiggestDifficulty] = useState<OnboardingBiggestDifficulty | null>(
    initialSurvey?.biggestDifficulty ?? null,
  );
  const [contact, setContact] = useState<string>(initialSurvey?.contact ?? '');
  const [justSelected, setJustSelected] = useState(false);

  const autoAdvanceTimerRef = useRef<number | null>(null);
  const pulseTimerRef = useRef<number | null>(null);
  const submittedRef = useRef(false);

  const displayName = childName.trim() || 'Bolajon';

  const clearAutoAdvance = () => {
    if (autoAdvanceTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      clearAutoAdvance();
      if (pulseTimerRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(pulseTimerRef.current);
        pulseTimerRef.current = null;
      }
    };
  }, []);

  const canAdvanceCurrentStep = isStrategicStepComplete(step, {
    childStage,
    previousAttempt,
    biggestDifficulty,
    contact,
  });

  const pulseReaction = () => {
    setJustSelected(true);
    if (pulseTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(pulseTimerRef.current);
    }
    if (typeof window !== 'undefined') {
      pulseTimerRef.current = window.setTimeout(() => {
        pulseTimerRef.current = null;
        setJustSelected(false);
      }, 650);
    }
  };

  const scheduleNextStep = (nextStep: 2 | 3 | 4) => {
    clearAutoAdvance();
    if (typeof window === 'undefined') {
      setStep(nextStep);
      return;
    }
    autoAdvanceTimerRef.current = window.setTimeout(() => {
      autoAdvanceTimerRef.current = null;
      setStep(nextStep);
    }, AUTO_ADVANCE_DELAY_MS);
  };

  const handleSelectStage = (stageId: OnboardingChildStage) => {
    playFeedbackChime('pop');
    setChildStage(stageId);
    pulseReaction();
    scheduleNextStep(2);
  };

  const handleSelectAttempt = (attemptId: OnboardingPreviousAttempt) => {
    playFeedbackChime('pop');
    setPreviousAttempt(attemptId);
    pulseReaction();
    scheduleNextStep(3);
  };

  const handleSelectDifficulty = (difficultyId: OnboardingBiggestDifficulty) => {
    playFeedbackChime('pop');
    setBiggestDifficulty(difficultyId);
    pulseReaction();
    scheduleNextStep(4);
  };

  const handleFinish = (contactOverride?: string) => {
    if (!childStage || !previousAttempt || !biggestDifficulty || submittedRef.current) return;
    submittedRef.current = true;
    clearAutoAdvance();
    playFeedbackChime('chime');

    const resolvedContact = (contactOverride !== undefined ? contactOverride : contact).trim();
    const completedAt = new Date().toISOString();

    const answers: StrategicOnboardingAnswers = {
      completedAt,
      childStage,
      previousAttempt,
      biggestDifficulty,
      contact: resolvedContact,
    };

    saveStrategicOnboardingAnswers(answers);

    const labels = getOnboardingOptionLabels(answers);
    const messageText = formatOnboardingTelegramMessage({
      ...labels,
      contact: resolvedContact,
      childName: displayName,
      publicId,
      completedAt,
    });
    void sendTelegramMessage(messageText, { category: 'onboarding' });

    const surveyData = buildSurveyDataFromStrategic(answers, initialSurvey);
    onComplete({
      surveyData,
      recommendedWorldId: resolveRecommendedWorldFromStage(childStage),
    });
  };

  const handleTopBack = () => {
    clearAutoAdvance();
    playFeedbackChime('pop');
    if (step > 1) {
      setStep((prev) => (prev === 4 ? 3 : prev === 3 ? 2 : 1));
      return;
    }
    if (onCancelEdit) {
      onCancelEdit();
    }
  };

  return (
    <div className="survey-page-shell">
      <StorybookBackdrop />

      <header className="survey-header">
        <div className="survey-header-left">
          {(step > 1 || onCancelEdit) && (
            <button
              type="button"
              className="btn-squircle-back"
              onClick={handleTopBack}
              aria-label={step > 1 ? 'Oldingi savolga qaytish' : 'Orqaga qaytish'}
            >
              <ArrowLeft size={20} strokeWidth={2.6} />
            </button>
          )}
        </div>

        <div className="survey-brand-center">
          <img src="/images/logo.webp" alt="Alifbo" className="brand-logo-img" draggable={false} />
          <div className="survey-progress-row" aria-label={`Bosqich ${step} dan 4`}>
            <div className="survey-dots" aria-hidden="true">
              {[1, 2, 3, 4].map((idx) => (
                <span
                  key={idx}
                  className={`survey-dot ${
                    step === idx ? 'survey-dot-active' : step > idx ? 'survey-dot-done' : ''
                  }`}
                />
              ))}
            </div>
            <span className="survey-step-counter">{step} / 4</span>
          </div>
        </div>

        <div className="survey-header-spacer" aria-hidden="true" />
      </header>

      <main className="survey-card-stage">
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 24 }}
          className="survey-card"
          aria-labelledby="survey-page-title"
        >
          <div className="survey-mascot-col">
            <AnimatedCharacter
              mood={justSelected ? 'celebrating' : 'idle'}
              size={220}
              avatarId={avatarId}
              bubblePosition="none"
            />
            <span className="survey-child-pill">{displayName} uchun moslashuv</span>
          </div>

          <div className="survey-questions-col">
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, x: 18 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -18 }}
                transition={{ duration: 0.2 }}
                className="survey-step-content"
              >
                {step === 1 && (
                  <>
                    <h1 id="survey-page-title" className="survey-question-title">
                      Farzandingiz hozir qaysi bosqichda?
                    </h1>
                    <p className="survey-question-sub">
                      Bitta kartochkani bosing — dars darajasi darhol moslashtiriladi.
                    </p>
                    <div
                      className="survey-options-list"
                      role="radiogroup"
                      aria-label="Farzandingiz bosqichi"
                    >
                      {ONBOARDING_STAGE_OPTIONS.map((opt) => {
                        const selected = childStage === opt.id;
                        return (
                          <motion.button
                            key={opt.id}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            whileTap={{ scale: 0.98 }}
                            className={`survey-option-btn ${
                              selected ? 'survey-option-selected' : ''
                            }`}
                            onClick={() => handleSelectStage(opt.id)}
                          >
                            <span>{opt.label}</span>
                            {selected && (
                              <span className="survey-check-badge">
                                <Check size={16} strokeWidth={3} />
                              </span>
                            )}
                          </motion.button>
                        );
                      })}
                    </div>
                  </>
                )}

                {step === 2 && (
                  <>
                    <h1 id="survey-page-title" className="survey-question-title">
                      O‘qishni o‘rgatish uchun hozirgacha nima qilib ko‘rgansiz?
                    </h1>
                    <p className="survey-question-sub">
                      Tajribangizga qarab eng qulay yondashuvni tanlaymiz.
                    </p>
                    <div
                      className="survey-options-list"
                      role="radiogroup"
                      aria-label="Oldingi urinishlar"
                    >
                      {ONBOARDING_ATTEMPT_OPTIONS.map((opt) => {
                        const selected = previousAttempt === opt.id;
                        return (
                          <motion.button
                            key={opt.id}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            whileTap={{ scale: 0.98 }}
                            className={`survey-option-btn ${
                              selected ? 'survey-option-selected' : ''
                            }`}
                            onClick={() => handleSelectAttempt(opt.id)}
                          >
                            <span>{opt.label}</span>
                            {selected && (
                              <span className="survey-check-badge">
                                <Check size={16} strokeWidth={3} />
                              </span>
                            )}
                          </motion.button>
                        );
                      })}
                    </div>
                  </>
                )}

                {step === 3 && (
                  <>
                    <h1 id="survey-page-title" className="survey-question-title">
                      Oldingi usullarda sizga eng qiyin bo‘lgani nima edi?
                    </h1>
                    <p className="survey-question-sub">
                      Bu savol o‘yinni farzandingiz uchun yanada qiziqarli qilishga yordam beradi.
                    </p>
                    <div
                      className="survey-options-list"
                      role="radiogroup"
                      aria-label="Eng qiyin jihat"
                    >
                      {ONBOARDING_DIFFICULTY_OPTIONS.map((opt) => {
                        const selected = biggestDifficulty === opt.id;
                        return (
                          <motion.button
                            key={opt.id}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            whileTap={{ scale: 0.98 }}
                            className={`survey-option-btn ${
                              selected ? 'survey-option-selected' : ''
                            }`}
                            onClick={() => handleSelectDifficulty(opt.id)}
                          >
                            <span>{opt.label}</span>
                            {selected && (
                              <span className="survey-check-badge">
                                <Check size={16} strokeWidth={3} />
                              </span>
                            )}
                          </motion.button>
                        );
                      })}
                    </div>
                  </>
                )}

                {step === 4 && (
                  <>
                    <h1 id="survey-page-title" className="survey-question-title">
                      Telegram username yoki telefon raqamingiz
                    </h1>
                    <p className="survey-question-sub">
                      Ixtiyoriy — bog‘lanishimiz va foydali yangiliklarni ulashishimiz uchun.
                    </p>
                    <input
                      type="text"
                      value={contact}
                      onChange={(e) => setContact(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleFinish();
                        }
                      }}
                      placeholder="@username yoki +998 90 123 45 67"
                      maxLength={60}
                      className="survey-contact-input"
                      aria-label="Telegram username yoki telefon raqamingiz"
                    />
                  </>
                )}
              </motion.div>
            </AnimatePresence>

            <div className="survey-cta-footer">
              {step < 4 ? (
                canAdvanceCurrentStep && (
                  <button
                    type="button"
                    className="btn-3d-emerald survey-next-btn btn-with-icon"
                    onClick={() => {
                      clearAutoAdvance();
                      playFeedbackChime('pop');
                      setStep((prev) => (prev === 1 ? 2 : prev === 2 ? 3 : 4));
                    }}
                  >
                    <span>Keyingi</span>
                    <ArrowRight size={20} strokeWidth={2.6} />
                  </button>
                )
              ) : (
                <div className="survey-step4-actions">
                  <button
                    type="button"
                    className="btn-3d-emerald survey-next-btn btn-with-icon"
                    disabled={!childStage || !previousAttempt || !biggestDifficulty}
                    onClick={() => handleFinish()}
                  >
                    <span>Boshlash</span>
                    <ArrowRight size={20} strokeWidth={2.6} />
                  </button>
                  <button
                    type="button"
                    className="btn-3d-cream survey-skip-btn"
                    disabled={!childStage || !previousAttempt || !biggestDifficulty}
                    onClick={() => handleFinish('')}
                  >
                    O‘tkazib yuborish
                  </button>
                </div>
              )}
            </div>
          </div>
        </motion.section>
      </main>
    </div>
  );
}
