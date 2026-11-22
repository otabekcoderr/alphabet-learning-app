import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { isSurveyStepComplete, resolveRecommendedWorld } from '../logic/onboarding';
import type { FutureSubjectOption, SurveyData } from '../storage/progressStorage';
import { playFeedbackChime } from '../utils/audioRecorder';
import { AnimatedCharacter } from './AnimatedCharacter';
import { ArrowLeft, ArrowRight, Check } from './Icons';
import { StorybookBackdrop } from './StorybookBackdrop';

interface OnboardingSurveyPageProps {
  childName: string;
  avatarId: string;
  initialSurvey?: SurveyData | null;
  onComplete: (result: { surveyData: SurveyData; recommendedWorldId: 1 | 2 | 3 | 4 | 5 }) => void;
  onCancelEdit?: () => void;
}

/**
 * Full-screen 4-step adaptive onboarding page matching Mockup 05 (`05_sorovnoma_onboarding.jpg`).
 * Starts strictly with empty defaults (no pre-selected options) on initial setup.
 */
export function OnboardingSurveyPage({
  childName,
  avatarId,
  initialSurvey,
  onComplete,
  onCancelEdit,
}: OnboardingSurveyPageProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [ageGroup, setAgeGroup] = useState<SurveyData['ageGroup'] | null>(
    initialSurvey?.ageGroup ?? null,
  );
  const [readingChallenge, setReadingChallenge] = useState<SurveyData['readingChallenge'] | null>(
    initialSurvey?.readingChallenge ?? null,
  );
  const [dailyLimitMinutes, setDailyLimitMinutes] = useState<
    SurveyData['dailyLimitMinutes'] | null
  >(initialSurvey?.dailyLimitMinutes ?? null);
  const [desiredFutureSubjects, setDesiredFutureSubjects] = useState<FutureSubjectOption[]>(
    initialSurvey?.desiredFutureSubjects ?? [],
  );
  const [justSelected, setJustSelected] = useState(false);

  const displayName = childName.trim() || 'Bolajon';

  const canAdvanceCurrentStep = isSurveyStepComplete(step, {
    ageGroup,
    readingChallenge,
    dailyLimitMinutes,
    desiredFutureSubjects,
  });

  const pulseReaction = () => {
    setJustSelected(true);
    window.setTimeout(() => setJustSelected(false), 650);
  };

  const toggleSubject = (subject: FutureSubjectOption) => {
    playFeedbackChime('pop');
    pulseReaction();
    setDesiredFutureSubjects((prev) =>
      prev.includes(subject) ? prev.filter((item) => item !== subject) : [...prev, subject],
    );
  };

  const handleFinish = () => {
    if (!ageGroup || !readingChallenge || !dailyLimitMinutes) return;
    playFeedbackChime('chime');
    const surveyData: SurveyData = {
      completedAt: new Date().toISOString(),
      ageGroup,
      readingChallenge,
      dailyLimitMinutes,
      desiredFutureSubjects,
    };
    onComplete({
      surveyData,
      recommendedWorldId: resolveRecommendedWorld(readingChallenge),
    });
  };

  const handleTopBack = () => {
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
                      Bolaning yoshi nechada?
                    </h1>
                    <p className="survey-question-sub">
                      Yosh guruhiga qarab so‘zlar tezligi va o‘yin darajasi moslashtiriladi.
                    </p>
                    <div className="survey-options-list" role="radiogroup" aria-label="Yosh guruhi">
                      {[
                        { id: '5-6' as const, label: '5–6 yosh (Maktabga tayyorlov)' },
                        { id: '6-7' as const, label: '6–7 yosh (1-sinf o‘quvchisi)' },
                        { id: '7-8' as const, label: '7–8 yosh (Ravonlikni kuchaytirish)' },
                      ].map((opt) => (
                        <motion.button
                          key={opt.id}
                          type="button"
                          role="radio"
                          aria-checked={ageGroup === opt.id}
                          whileTap={{ scale: 0.98 }}
                          className={`survey-option-btn ${
                            ageGroup === opt.id ? 'survey-option-selected' : ''
                          }`}
                          onClick={() => {
                            playFeedbackChime('pop');
                            setAgeGroup(opt.id);
                            pulseReaction();
                          }}
                        >
                          <span>{opt.label}</span>
                          {ageGroup === opt.id && (
                            <span className="survey-check-badge">
                              <Check size={16} strokeWidth={3} />
                            </span>
                          )}
                        </motion.button>
                      ))}
                    </div>
                  </>
                )}

                {step === 2 && (
                  <>
                    <h1 id="survey-page-title" className="survey-question-title">
                      O‘qishda asosiy qiyinchilik nima?
                    </h1>
                    <p className="survey-question-sub">
                      Boshlang‘ich o‘qish olamini bolaning darajasiga qarab tanlaymiz:
                    </p>
                    <div
                      className="survey-options-list"
                      role="radiogroup"
                      aria-label="O‘qish qiyinchiligi"
                    >
                      {[
                        {
                          id: 'slow_spelling' as const,
                          label: 'Harflab-bo‘g‘inlab (k-i → ki, t-o-b → tob) sekin o‘qiydi',
                        },
                        {
                          id: 'blending' as const,
                          label: 'Harflarni biladi, lekin bo‘g‘inlarni ulashga qiynaladi',
                        },
                        {
                          id: 'forgets_letters' as const,
                          label: 'Ba’zi harflarni (Sh, Ch, O‘, G‘...) unutib qo‘yadi',
                        },
                        {
                          id: 'comprehension' as const,
                          label: 'So‘z o‘qiydi, endi uzun so‘zlar va qisqa gaplar kerak',
                        },
                      ].map((opt) => (
                        <motion.button
                          key={opt.id}
                          type="button"
                          role="radio"
                          aria-checked={readingChallenge === opt.id}
                          whileTap={{ scale: 0.98 }}
                          className={`survey-option-btn ${
                            readingChallenge === opt.id ? 'survey-option-selected' : ''
                          }`}
                          onClick={() => {
                            playFeedbackChime('pop');
                            setReadingChallenge(opt.id);
                            pulseReaction();
                          }}
                        >
                          <span>{opt.label}</span>
                          {readingChallenge === opt.id && (
                            <span className="survey-check-badge">
                              <Check size={16} strokeWidth={3} />
                            </span>
                          )}
                        </motion.button>
                      ))}
                    </div>
                  </>
                )}

                {step === 3 && (
                  <>
                    <h1 id="survey-page-title" className="survey-question-title">
                      Kunlik sog‘lom mashq vaqti
                    </h1>
                    <p className="survey-question-sub">
                      Vaqt tugaganda Zukko Tulki muloyim uyquga ketadi va ko‘zlar dam oladi.
                    </p>
                    <div
                      className="survey-options-list"
                      role="radiogroup"
                      aria-label="Kunlik mashq vaqti"
                    >
                      {[
                        { id: 10 as const, label: 'Kuniga 10 daqiqa (Yengil)' },
                        { id: 15 as const, label: 'Kuniga 15 daqiqa (Tavsiya etiladi)' },
                        { id: 20 as const, label: 'Kuniga 20 daqiqa (Ko‘proq mashq)' },
                      ].map((opt) => (
                        <motion.button
                          key={opt.id}
                          type="button"
                          role="radio"
                          aria-checked={dailyLimitMinutes === opt.id}
                          whileTap={{ scale: 0.98 }}
                          className={`survey-option-btn ${
                            dailyLimitMinutes === opt.id ? 'survey-option-selected' : ''
                          }`}
                          onClick={() => {
                            playFeedbackChime('pop');
                            setDailyLimitMinutes(opt.id);
                            pulseReaction();
                          }}
                        >
                          <span>{opt.label}</span>
                          {dailyLimitMinutes === opt.id && (
                            <span className="survey-check-badge">
                              <Check size={16} strokeWidth={3} />
                            </span>
                          )}
                        </motion.button>
                      ))}
                    </div>
                  </>
                )}

                {step === 4 && (
                  <>
                    <h1 id="survey-page-title" className="survey-question-title">
                      Yana qaysi o‘yinlarni xohlaysiz?
                    </h1>
                    <p className="survey-question-sub">
                      Ixtiyoriy — bir nechtasini tanlashingiz yoki bo‘sh qoldirishingiz mumkin.
                    </p>
                    <div className="survey-options-list">
                      {[
                        { id: 'math' as const, label: 'Matematika va mantiqiy o‘yinlar' },
                        { id: 'drawing' as const, label: 'Chizmachilik va ijodiy rasm' },
                        { id: 'handwriting' as const, label: 'Chiroyli yozuv (Husnixat)' },
                        { id: 'english' as const, label: 'Bolalar uchun ingliz tili' },
                      ].map((opt) => {
                        const active = desiredFutureSubjects.includes(opt.id);
                        return (
                          <motion.button
                            key={opt.id}
                            type="button"
                            aria-pressed={active}
                            whileTap={{ scale: 0.98 }}
                            className={`survey-option-btn ${
                              active ? 'survey-option-selected' : ''
                            }`}
                            onClick={() => toggleSubject(opt.id)}
                          >
                            <span>{opt.label}</span>
                            {active && (
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
              </motion.div>
            </AnimatePresence>

            <div className="survey-cta-footer">
              {step < 4 ? (
                <button
                  type="button"
                  className="btn-3d-emerald survey-next-btn btn-with-icon"
                  disabled={!canAdvanceCurrentStep}
                  onClick={() => {
                    playFeedbackChime('pop');
                    setStep((prev) => (prev === 1 ? 2 : prev === 2 ? 3 : 4));
                  }}
                >
                  <span>Keyingi</span>
                  <ArrowRight size={20} strokeWidth={2.6} />
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-3d-emerald survey-next-btn btn-with-icon"
                  disabled={!ageGroup || !readingChallenge || !dailyLimitMinutes}
                  onClick={handleFinish}
                >
                  <span>O‘yinni boshlash!</span>
                  <ArrowRight size={20} strokeWidth={2.6} />
                </button>
              )}
            </div>
          </div>
        </motion.section>
      </main>
    </div>
  );
}
