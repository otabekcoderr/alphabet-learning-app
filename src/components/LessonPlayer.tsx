import { useEffect, useMemo, useRef, useState } from 'react';
import { CURRICULUM_ITEMS, getLetterCategory, type CurriculumItem } from '../data/curriculum';
import type { MicAutoStopAction } from '../logic/micAutoStop';
import { evaluateSpeechResult, getDistractors, type SpeechEvaluation } from '../logic/pedagogy';
import {
  playAudioClip,
  playFeedbackChime,
  startMicRecording,
  verifyAudioWithStt,
  type MicRecordingResult,
  type MicSession,
} from '../utils/audioRecorder';
import { LetterBlock } from './LetterBlock';
import { MascotSvg } from './MascotSvg';

interface LessonPlayerProps {
  item: CurriculumItem;
  parentSessionActive: boolean;
  aiOnline: boolean;
  onBack: () => void;
  onVerifiedComplete: (payload: {
    itemId: string;
    starsEarned: number;
    voiceAttemptsDelta: number;
    parentVerified: boolean;
    latencyMs: number | null;
  }) => void;
  onUnverifiedComplete: (itemId: string) => void;
  onNextItem: () => void;
  hasNextItem: boolean;
}

type LessonStep = 1 | 2 | 3 | 4;

const STEP_LABELS: Record<LessonStep, string> = {
  1: '1. Tingla',
  2: '2. Top',
  3: '3. Ula',
  4: '4. Ayt',
};

export function LessonPlayer({
  item,
  parentSessionActive,
  aiOnline,
  onBack,
  onVerifiedComplete,
  onUnverifiedComplete,
  onNextItem,
  hasNextItem,
}: LessonPlayerProps) {
  const [step, setStep] = useState<LessonStep>(1);
  const [earStatus, setEarStatus] = useState<'idle' | 'correct' | 'wrong'>('idle');
  const [wrongChoiceId, setWrongChoiceId] = useState<string | null>(null);
  const [blendValue, setBlendValue] = useState<number>(0);

  const [isRecording, setIsRecording] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [voiceAttempts, setVoiceAttempts] = useState(0);
  const [evalResult, setEvalResult] = useState<SpeechEvaluation | null>(null);
  const [noSpeechMessage, setNoSpeechMessage] = useState<string | null>(null);
  const [aiUnavailableFallback, setAiUnavailableFallback] = useState(false);
  const [completedKind, setCompletedKind] = useState<'mastered' | 'unverified' | null>(null);
  const [completedStars, setCompletedStars] = useState<number>(0);

  const micRef = useRef<MicSession | null>(null);
  const blendPlayedRef = useRef(false);

  const choices = useMemo(() => getDistractors(item, CURRICULUM_ITEMS), [item]);

  useEffect(() => {
    setStep(1);
    setEarStatus('idle');
    setWrongChoiceId(null);
    setBlendValue(0);
    blendPlayedRef.current = false;
    setIsRecording(false);
    setIsChecking(false);
    setMicLevel(0);
    setVoiceAttempts(0);
    setEvalResult(null);
    setNoSpeechMessage(null);
    setAiUnavailableFallback(false);
    setCompletedKind(null);
    setCompletedStars(0);

    return () => {
      if (micRef.current) {
        micRef.current.cancel();
        micRef.current = null;
      }
    };
  }, [item]);

  useEffect(() => {
    if (step === 1) {
      void playAudioClip(item.audioTeacher);
    } else if (step === 2) {
      void playAudioClip('/audio/qaysi_biri.mp3').then(() => playAudioClip(item.audioSound));
    } else if (step === 3) {
      void playAudioClip('/audio/ulab_oqiymiz.mp3');
    } else if (step === 4 && aiOnline && !parentSessionActive && !aiUnavailableFallback) {
      void playAudioClip('/audio/mikrofonga_ayting.mp3');
    }
  }, [step, item, aiOnline, parentSessionActive, aiUnavailableFallback]);

  const handleEarChoice = (chosen: CurriculumItem) => {
    if (chosen.id === item.id) {
      setEarStatus('correct');
      setWrongChoiceId(null);
      playFeedbackChime('success');
      void playAudioClip('/audio/barakalla.mp3');
    } else {
      setEarStatus('wrong');
      setWrongChoiceId(chosen.id);
      void playAudioClip(item.audioSound);
    }
  };

  const handleBlendChange = (value: number) => {
    setBlendValue(value);
    if (value >= 88 && !blendPlayedRef.current) {
      blendPlayedRef.current = true;
      playFeedbackChime('success');
      void playAudioClip(item.audioSound);
    }
  };

  const processAudioForStt = async (audioBlob: Blob) => {
    setIsChecking(true);
    const nextAttempt = voiceAttempts + 1;
    setVoiceAttempts(nextAttempt);
    try {
      const resp = await verifyAudioWithStt(audioBlob, item.text, item.accept);
      const evaluation = evaluateSpeechResult(item.text, item.accept, resp.transcript, resp.is_silence, nextAttempt);
      setEvalResult(evaluation);

      if (evaluation.outcome === 'accepted') {
        playFeedbackChime('success');
        void playAudioClip('/audio/barakalla.mp3');
        setCompletedKind('mastered');
        setCompletedStars(evaluation.starsEarned);
        onVerifiedComplete({
          itemId: item.id,
          starsEarned: evaluation.starsEarned,
          voiceAttemptsDelta: nextAttempt,
          parentVerified: false,
          latencyMs: resp.latency_ms,
        });
      } else if (evaluation.outcome === 'silence') {
        void playAudioClip('/audio/jimlik_sezildi.mp3');
      } else {
        void playAudioClip('/audio/qayta_urinib_koring.mp3');
      }
    } catch {
      // Silent fallback to effort-only continuation if AI backend is unavailable
      setAiUnavailableFallback(true);
    } finally {
      setIsChecking(false);
    }
  };

  const handleAutoStop = (reason: Exclude<MicAutoStopAction, 'continue'>, result: MicRecordingResult) => {
    micRef.current = null;
    setIsRecording(false);
    setMicLevel(0);

    if (reason === 'stop_no_speech') {
      setNoSpeechMessage('Yana bir marta');
      void playAudioClip('/audio/jimlik_sezildi.mp3');
      return;
    }

    void processAudioForStt(result.wavBlob);
  };

  const toggleRecording = async () => {
    if (isChecking) return;
    if (!isRecording) {
      setEvalResult(null);
      setNoSpeechMessage(null);
      try {
        const session = await startMicRecording((lvl) => setMicLevel(lvl), handleAutoStop);
        micRef.current = session;
        setIsRecording(true);
      } catch {
        setAiUnavailableFallback(true);
      }
    } else if (micRef.current) {
      const activeSession = micRef.current;
      micRef.current = null;
      setIsRecording(false);
      setMicLevel(0);
      const stopped = await activeSession.stop();
      if (stopped) {
        await processAudioForStt(stopped.wavBlob);
      }
    }
  };

  const handleParentConfirm = () => {
    if (!parentSessionActive) return;
    playFeedbackChime('success');
    void playAudioClip('/audio/barakalla.mp3');
    setCompletedKind('mastered');
    setCompletedStars(3);
    setEvalResult({
      outcome: 'accepted',
      messageUz: 'Barakalla! Ota-ona tasdig‘i bilan saqlandi!',
      starsEarned: 3,
    });
    onVerifiedComplete({
      itemId: item.id,
      starsEarned: 3,
      voiceAttemptsDelta: Math.max(1, voiceAttempts),
      parentVerified: true,
      latencyMs: null,
    });
  };

  const handleUnverifiedContinue = () => {
    playFeedbackChime('success');
    void playAudioClip('/audio/barakalla.mp3');
    setCompletedKind('unverified');
    setCompletedStars(1);
    onUnverifiedComplete(item.id);
  };

  const gapPx = Math.max(0, Math.round((100 - blendValue) * 0.56));
  const useVoiceMode = aiOnline && !aiUnavailableFallback && !parentSessionActive;
  const progressPct = Math.round((step / 4) * 100);

  const mascotPromptByStep: Record<LessonStep, string> = {
    1: `Qara va diqqat bilan tingla: «${item.text}»!`,
    2: 'Quloq sol! Qaysi kartada shu tovush bor?',
    3: item.parts.length > 1 ? 'Vagonchalarni birlashtirib, bo‘laklarni ula!' : 'Slayderni oxirigacha surib tovushni eshit!',
    4: 'Endi sen o‘qiysan! Bilag‘on Tulki tinglayapti!',
  };

  const mascotMood: 'happy' | 'cheering' | 'listening' =
    completedKind || (step === 2 && earStatus === 'correct') || (step === 3 && blendValue >= 88)
      ? 'cheering'
      : isRecording
        ? 'listening'
        : 'happy';

  return (
    <div className="lesson-shell">
      <div className="lesson-topbar">
        <button type="button" className="btn-back" onClick={onBack}>
          ← Bosh sahifa
        </button>

        <div
          className="duo-progress-track"
          role="progressbar"
          aria-label="Dars jarayoni"
          aria-valuenow={step}
          aria-valuemin={1}
          aria-valuemax={4}
        >
          <div className="duo-progress-fill" style={{ width: `${progressPct}%` }}>
            <span className="duo-progress-shine" aria-hidden="true" />
          </div>
        </div>

        <span className="lesson-xp-badge">⚡ +20 XP</span>

        <div className="step-pills" role="tablist" aria-label="Dars qadamlari">
          {([1, 2, 3, 4] as LessonStep[]).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={step === s}
              className={`step-pill ${step === s ? 'step-active' : step > s ? 'step-done' : ''}`}
              onClick={() => setStep(s)}
            >
              {STEP_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="lesson-card">
        <div className="lesson-mascot-header">
          <MascotSvg mood={mascotMood} size={48} />
          <div className="mascot-coach-line">{mascotPromptByStep[step]}</div>
        </div>

        {step === 1 && (
          <div className="step-body">
            <span className="step-badge">1-qadam · Tingla</span>
            <h2>Eshiting va kuzating</h2>
            <div className="blocks-stage">
              {item.parts.map((part, idx) => (
                <LetterBlock
                  key={`${part}-${idx}`}
                  text={part}
                  size="xl"
                  onClick={() => void playAudioClip(item.audioSound)}
                />
              ))}
            </div>
            <p className="coach-tip">💡 {item.coachTipUz}</p>
            <div className="step-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void playAudioClip(item.audioTeacher)}
              >
                🔊 Eshitish
              </button>
              <button type="button" className="btn-primary" onClick={() => setStep(2)}>
                Keyingi qadam →
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="step-body">
            <span className="step-badge">2-qadam · Top</span>
            <h2>Eshitganingizni bosing!</h2>
            <button
              type="button"
              className="btn-sound-big"
              onClick={() => void playAudioClip(item.audioSound)}
            >
              🔊 Eshitish
            </button>

            <div className="choices-row">
              {choices.map((choice) => {
                const isChosenCorrect = earStatus === 'correct' && choice.id === item.id;
                const isChosenWrong = wrongChoiceId === choice.id;
                return (
                  <button
                    key={choice.id}
                    type="button"
                    className={`choice-tile ${isChosenCorrect ? 'choice-correct' : ''} ${
                      isChosenWrong ? 'choice-wrong' : ''
                    }`}
                    onClick={() => handleEarChoice(choice)}
                  >
                    {[...choice.text].map((ch, idx) => (
                      <span
                        key={`${ch}-${idx}`}
                        className={getLetterCategory(ch) === 'vowel' ? 'char-vowel' : 'char-consonant'}
                      >
                        {ch}
                      </span>
                    ))}
                  </button>
                );
              })}
            </div>

            {earStatus === 'correct' && <div className="feedback-banner feedback-success">⭐ Barakalla!</div>}
            {earStatus === 'wrong' && (
              <div className="feedback-banner feedback-gentle">Yana bir eshitib ko‘ring.</div>
            )}

            <div className="step-actions">
              <button type="button" className="btn-secondary" onClick={() => setStep(1)}>
                ← Orqaga
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={earStatus !== 'correct'}
                onClick={() => setStep(3)}
              >
                Keyingi qadam →
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="step-body">
            <span className="step-badge">3-qadam · Ula</span>
            <h2>{item.parts.length > 1 ? 'Surib birlashtiring!' : 'Surib tovushni eshiting!'}</h2>

            <div className={`blend-track-box ${blendValue >= 88 ? 'blend-track-complete' : ''}`}>
              <div
                className={`blend-stage ${blendValue >= 88 ? 'blend-merged' : ''}`}
                style={{ gap: `${gapPx}px` }}
              >
                {item.parts.map((part, idx) => (
                  <div key={`blend-wrap-${part}-${idx}`} className="train-car-item">
                    <LetterBlock
                      text={part}
                      size="xl"
                      highlighted={blendValue >= 88}
                      onClick={() => void playAudioClip(item.audioSound)}
                    />
                    {idx < item.parts.length - 1 && (
                      <span className="magnet-link" aria-hidden="true">
                        {blendValue >= 88 ? '✨' : '🧲'}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              {blendValue >= 88 && (
                <div className="blend-celebration-pill">✨ Ulandi! {item.text}! 🎉</div>
              )}
            </div>

            <div className="slider-wrap">
              <label htmlFor="blend-slider" className="slider-label">
                <span>🚂 Boshlash</span>
                <strong className="merged-preview">{blendValue >= 88 ? `✨ ${item.text}!` : 'Suring →'}</strong>
              </label>
              <input
                id="blend-slider"
                type="range"
                min={0}
                max={100}
                value={blendValue}
                onChange={(e) => handleBlendChange(Number(e.target.value))}
                className="blend-slider"
              />
            </div>

            <div className="step-actions">
              <button type="button" className="btn-secondary" onClick={() => setStep(2)}>
                ← Orqaga
              </button>
              <button type="button" className="btn-primary" onClick={() => setStep(4)}>
                Keyingi qadam →
              </button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="step-body">
            <span className="step-badge">4-qadam · Ayt</span>
            <h2>Ovoz chiqarib o‘qing!</h2>

            <div className="blocks-stage">
              <LetterBlock text={item.text} size="xl" onClick={() => void playAudioClip(item.audioSound)} />
            </div>

            <button
              type="button"
              className="btn-secondary"
              onClick={() => void playAudioClip(item.audioSound)}
            >
              🔊 Namuna tovush
            </button>

            {parentSessionActive ? (
              <div className="parent-mode-box">
                <p>👨‍👩‍👧 Ota-ona yonida rejimi faol. Bola «{item.text}» ni to‘g‘ri o‘qidimi?</p>
                <div className="aux-voice-row">
                  <button type="button" className="btn-primary" onClick={handleParentConfirm}>
                    ✅ To‘g‘ri o‘qidi (Ota-ona tasdig‘i)
                  </button>
                </div>
              </div>
            ) : useVoiceMode ? (
              <div className="voice-controls">
                <button
                  type="button"
                  disabled={isChecking}
                  className={`btn-mic ${isRecording ? 'btn-mic-active' : ''}`}
                  onClick={() => void toggleRecording()}
                >
                  {isChecking
                    ? '⏳ Tekshirilmoqda...'
                    : isRecording
                      ? '⏹ To‘xtatish'
                      : '🎤 Mikrofonni bosib o‘qing'}
                </button>

                {isRecording && (
                  <>
                    <div className="listening-indicator" role="status" aria-live="polite">
                      <span className="pulse-dot" aria-hidden="true" />
                      <span>🎧 Tinglayapman... gapiring</span>
                    </div>
                    <div className="mic-meter" aria-label="Mikrofon ovoz darajasi">
                      <div className="mic-meter-fill" style={{ width: `${Math.round(micLevel * 100)}%` }} />
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="voice-controls">
                <button type="button" className="btn-continue-big" onClick={handleUnverifiedContinue}>
                  🌟 O‘qidim — Davom etamiz (+1 harakat yulduzi)
                </button>
              </div>
            )}

            {noSpeechMessage && (
              <div className="feedback-banner feedback-gentle">{noSpeechMessage}</div>
            )}

            {completedKind && (
              <div
                className={`celebration-card ${
                  completedKind === 'mastered' ? 'celebration-mastered' : 'celebration-effort'
                }`}
              >
                <div className="celebration-confetti" aria-hidden="true">
                  {completedKind === 'mastered' ? '🎉 🏆 ✨' : '🌟 🎉 🌟'}
                </div>
                <div className="celebration-xp-pill">
                  ⚡ +{completedKind === 'mastered' ? Math.max(1, completedStars) * 20 : 5} XP
                </div>
                <div className="celebration-stars">
                  {completedKind === 'mastered'
                    ? '⭐'.repeat(Math.max(1, completedStars))
                    : '🌟 +1 harakat yulduzi'}
                </div>
                <div className="celebration-title">
                  {completedKind === 'mastered'
                    ? 'Ajoyib g‘alaba! Dars zabt etildi!'
                    : 'Barakalla! Harakat yulduzi qo‘shildi!'}
                </div>
              </div>
            )}

            {evalResult && (
              <div
                className={`feedback-banner ${
                  evalResult.outcome === 'accepted' ? 'feedback-success' : 'feedback-gentle'
                }`}
              >
                <div className="eval-headline">
                  {completedStars > 0 ? `${'⭐'.repeat(completedStars)} ` : ''}
                  {evalResult.messageUz}
                </div>
              </div>
            )}

            <div className="step-actions">
              <button type="button" className="btn-secondary" onClick={() => setStep(3)}>
                ← Orqaga
              </button>
              {completedKind === 'mastered' && hasNextItem && (
                <button type="button" className="btn-primary" onClick={onNextItem}>
                  Keyingi darsga o‘tish →
                </button>
              )}
              {completedKind === 'mastered' && !hasNextItem && (
                <button type="button" className="btn-primary" onClick={onBack}>
                  🏆 Bosh sahifaga qaytish
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
