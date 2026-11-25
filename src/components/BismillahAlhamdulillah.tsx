import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { SPELLING_FRIENDLY_MIC_CONFIG } from '../logic/micAutoStop';
import {
  ALHAMDULILLAH_ACCEPT_ALIASES,
  BISMILLAH_ACCEPT_ALIASES,
  validateHabitUtterance,
} from '../logic/sttValidator';
import {
  playAudioClip,
  playAudioClipWithStatus,
  playFeedbackAudio,
  playFeedbackChime,
  startMicRecording,
  stopActiveAudio,
  verifyAudioWithStt,
  type AudioClipPlayStatus,
  type MicRecordingResult,
  type MicSession,
} from '../utils/audioRecorder';
import { AnimatedCharacter } from './AnimatedCharacter';
import { ArrowLeft, ArrowRight, Check, Mic, Sparkles, Square, Volume2 } from './Icons';
import { StorybookBackdrop } from './StorybookBackdrop';

export const BISMILLAH_AUDIO_PATH = '/audio/bismillah.mp3';
export const ALHAMDULILLAH_AUDIO_PATH = '/audio/alhamdulillah.mp3';
export const BISMILLAH_TEXT_UZ = 'Ilming ziyoda bo‘lishi uchun, «Bismillah» deb boshla!';
export const ALHAMDULILLAH_TEXT_UZ =
  'Barakalla, mashqlarni zo‘r bajarding! Endi Allohga hamd aytib, «Alhamdulillah» deb ayt!';

const HABIT_SOFT_FALLBACK_THRESHOLD = 2;

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' && typeof document !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Check whether the browser supports microphone recording via getUserMedia + AudioContext/MediaRecorder.
 */
export function isVoicePlaybackRecordingSupported(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      Boolean(navigator.mediaDevices) &&
      typeof navigator.mediaDevices.getUserMedia === 'function' &&
      (typeof AudioContext !== 'undefined' ||
        typeof (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext !== 'undefined' ||
        typeof MediaRecorder !== 'undefined')
    );
  } catch {
    return false;
  }
}

function isMicPermissionDeniedError(err: unknown): boolean {
  const name =
    err && typeof err === 'object' && 'name' in err
      ? String((err as { name?: unknown }).name ?? '')
      : '';
  const msg = err instanceof Error ? err.message.toLowerCase() : '';
  return (
    name === 'NotAllowedError' ||
    name === 'PermissionDeniedError' ||
    msg.includes('permission') ||
    msg.includes('ruxsat')
  );
}

interface BismillahStartCardProps {
  avatarId: string;
  worldTitle: string;
  aiOnline?: boolean;
  onContinue: () => void;
  onBack?: () => void;
}

/**
 * Interactive pre-session "Bismillah" card requiring spoken STT verification
 * (accepting bismillah/bismillo/bismilloh phonetic forms) with a gentle 2-attempt
 * or offline/blocked-mic fallback so a child is never stuck.
 */
export function BismillahStartCard({
  avatarId,
  worldTitle,
  aiOnline = true,
  onContinue,
  onBack,
}: BismillahStartCardProps) {
  const [audioAutoplayBlocked, setAudioAutoplayBlocked] = useState(false);
  const [browserOnline, setBrowserOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [isRecording, setIsRecording] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [micBlockedOrMissing, setMicBlockedOrMissing] = useState(false);
  const [verified, setVerified] = useState(false);
  const [feedbackText, setFeedbackText] = useState<string | null>(null);

  const micSupported = isVoicePlaybackRecordingSupported();
  const canUseVoiceStt = aiOnline && browserOnline && micSupported && !micBlockedOrMissing;
  const allowSoftSkip = !canUseVoiceStt || attempts >= HABIT_SOFT_FALLBACK_THRESHOLD;

  const doneRef = useRef(false);
  const mountedRef = useRef(true);
  const micRef = useRef<MicSession | null>(null);
  const advanceTimerRef = useRef<number | null>(null);
  const onContinueRef = useRef(onContinue);
  onContinueRef.current = onContinue;

  useIsomorphicLayoutEffect(() => {
    try {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    } catch {
      // Ignore environments without window.scrollTo
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onOn = () => setBrowserOnline(true);
    const onOff = () => setBrowserOnline(false);
    window.addEventListener('online', onOn);
    window.addEventListener('offline', onOff);
    return () => {
      window.removeEventListener('online', onOn);
      window.removeEventListener('offline', onOff);
    };
  }, []);

  const finishOnce = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (micRef.current) {
      micRef.current.cancel();
      micRef.current = null;
    }
    if (advanceTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
    stopActiveAudio();
    onContinueRef.current();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    doneRef.current = false;
    setAudioAutoplayBlocked(false);
    let removeGestureListeners = () => {};

    let audioPromise: Promise<AudioClipPlayStatus>;
    try {
      audioPromise = playAudioClipWithStatus(BISMILLAH_AUDIO_PATH, BISMILLAH_TEXT_UZ, {
        adoptGestureClip: true,
      }).catch(() => 'unavailable' as const);
    } catch {
      audioPromise = Promise.resolve('unavailable');
    }

    void audioPromise.then((status) => {
      if (cancelled || status !== 'autoplay_blocked') return;
      setAudioAutoplayBlocked(true);
      if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;

      const shouldSkipTarget = (target: EventTarget | null): boolean => {
        if (!target || typeof target !== 'object' || !('closest' in target)) return false;
        const maybeClosest = (target as { closest?: unknown }).closest;
        if (typeof maybeClosest !== 'function') return false;
        const closestFn = maybeClosest as (selector: string) => unknown;
        return Boolean(
          closestFn.call(target, '.bismillah-skip-btn') ||
            closestFn.call(target, '.btn-squircle-back') ||
            closestFn.call(target, '.bismillah-listen-btn') ||
            closestFn.call(target, '.bismillah-mic-btn'),
        );
      };

      const onUnlockGesture = (event: Event) => {
        removeGestureListeners();
        if (cancelled || doneRef.current || shouldSkipTarget(event.target)) return;
        setAudioAutoplayBlocked(false);
        void playAudioClipWithStatus(BISMILLAH_AUDIO_PATH, BISMILLAH_TEXT_UZ).catch(
          () => 'unavailable' as const,
        );
      };

      const eventNames = ['pointerdown', 'touchstart', 'keydown'] as const;
      for (const evtName of eventNames) {
        window.addEventListener(evtName, onUnlockGesture, { capture: true, once: true });
      }
      removeGestureListeners = () => {
        for (const evtName of eventNames) {
          window.removeEventListener(evtName, onUnlockGesture, { capture: true });
        }
        removeGestureListeners = () => {};
      };
    });

    return () => {
      mountedRef.current = false;
      cancelled = true;
      removeGestureListeners();
      if (micRef.current) {
        micRef.current.cancel();
        micRef.current = null;
      }
      if (advanceTimerRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(advanceTimerRef.current);
        advanceTimerRef.current = null;
      }
      stopActiveAudio();
    };
  }, []);

  const verifyHabitSpeech = async (rec: MicRecordingResult) => {
    if (!mountedRef.current || doneRef.current) return;
    setIsChecking(true);
    setFeedbackText(null);
    try {
      const resp = await verifyAudioWithStt(
        rec.wavBlob,
        'bismillah',
        [...BISMILLAH_ACCEPT_ALIASES],
      );
      if (!mountedRef.current || doneRef.current) return;
      const decision = validateHabitUtterance('bismillah', {
        transcript: resp.transcript,
        isSilence: resp.is_silence,
        confidence: resp.confidence,
        confidenceAvailable: resp.confidence_available,
      });

      if (decision === 'accepted') {
        setVerified(true);
        setFeedbackText('Barakalla! «Bismillah» qabul qilindi!');
        playFeedbackChime('chime');
        if (typeof window !== 'undefined') {
          advanceTimerRef.current = window.setTimeout(() => {
            advanceTimerRef.current = null;
            finishOnce();
          }, 650);
        } else {
          finishOnce();
        }
        return;
      }

      setAttempts((prev) => prev + 1);
      if (decision === 'silence') {
        setFeedbackText('Ovozing eshitilmadi — «Bismillah» deb balandroq ayt!');
        void playFeedbackAudio('fb_no_speech');
      } else {
        setFeedbackText('Yana bir bor aniqroq qilib «Bismillah» deb ayt!');
        void playFeedbackAudio('fb_louder_clearer');
      }
    } catch {
      if (!mountedRef.current || doneRef.current) return;
      setAttempts((prev) => prev + 1);
      setFeedbackText('Ovoz serveri bilan aloqa bo‘lmadi — «Boshlash» tugmasi bilan davom eting.');
    } finally {
      if (mountedRef.current) {
        setIsChecking(false);
      }
    }
  };

  const handleToggleMic = async () => {
    if (isChecking || verified) return;
    if (isRecording && micRef.current) {
      const rec = await micRef.current.stop();
      micRef.current = null;
      setIsRecording(false);
      setMicLevel(0);
      if (rec) {
        await verifyHabitSpeech(rec);
      }
      return;
    }

    stopActiveAudio();
    setFeedbackText(null);
    if (!micSupported) {
      setMicBlockedOrMissing(true);
      setFeedbackText('Mikrofon topilmadi — «Bismillah» deb aytib, darsni boshlang!');
      return;
    }

    try {
      const session = await startMicRecording(
        (lvl) => {
          if (mountedRef.current) setMicLevel(lvl);
        },
        (_reason, rec) => {
          micRef.current = null;
          if (!mountedRef.current) return;
          setIsRecording(false);
          setMicLevel(0);
          void verifyHabitSpeech(rec);
        },
        SPELLING_FRIENDLY_MIC_CONFIG,
      );
      if (!mountedRef.current || doneRef.current) {
        session.cancel();
        return;
      }
      micRef.current = session;
      setIsRecording(true);
    } catch (err) {
      if (!mountedRef.current) return;
      if (isMicPermissionDeniedError(err)) {
        setMicBlockedOrMissing(true);
        setFeedbackText('Mikrofonga ruxsat berilmadi — ovoz chiqarib «Bismillah» deng va boshlang!');
      } else {
        setAttempts((prev) => prev + 1);
        setFeedbackText('Mikrofonni yoqib bo‘lmadi — qayta urining yoki boshlang.');
      }
    }
  };

  return (
    <div className="bismillah-shell">
      <StorybookBackdrop />

      {onBack && (
        <header className="victory-topbar">
          <button
            type="button"
            className="btn-squircle-back"
            onClick={() => {
              doneRef.current = true;
              if (micRef.current) {
                micRef.current.cancel();
                micRef.current = null;
              }
              stopActiveAudio();
              playFeedbackChime('pop');
              onBack();
            }}
            aria-label="Orqaga"
          >
            <ArrowLeft size={20} strokeWidth={2.6} />
          </button>
        </header>
      )}

      <main className="bismillah-stage">
        <section className="bismillah-card" aria-labelledby="bismillah-heading">
          <span className="bismillah-world-pill">{worldTitle}</span>
          <span className="bismillah-teacher-pill">Ustoz eslatmasi</span>

          <AnimatedCharacter
            mood={verified ? 'celebrating' : isRecording ? 'listening' : 'idle'}
            size={140}
            avatarId={avatarId}
            bubblePosition="none"
          />

          <h1 id="bismillah-heading" className="bismillah-title">
            Bismillah
          </h1>
          <p className="bismillah-sub">{BISMILLAH_TEXT_UZ}</p>

          {audioAutoplayBlocked && (
            <p className="bismillah-audio-hint" role="status">
              Ovozni eshitish uchun «Eshitish» tugmasini bosing
            </p>
          )}

          {canUseVoiceStt && !verified && (
            <div className="habit-mic-panel">
              <button
                type="button"
                className={`mic-btn-big bismillah-mic-btn ${
                  isRecording ? 'mic-btn-recording' : ''
                }`}
                style={
                  isRecording
                    ? { transform: `scale(${1 + Math.min(0.14, micLevel * 0.25)})` }
                    : undefined
                }
                disabled={isChecking}
                onClick={() => void handleToggleMic()}
              >
                {isRecording ? (
                  <>
                    <Square size={20} fill="currentColor" />
                    <span>Tinglayapman... «Bismillah» de!</span>
                  </>
                ) : isChecking ? (
                  <>
                    <Sparkles size={20} />
                    <span>Tekshiryapman...</span>
                  </>
                ) : (
                  <>
                    <Mic size={22} />
                    <span>Mikrofonga «Bismillah» de</span>
                  </>
                )}
              </button>
            </div>
          )}

          {feedbackText && (
            <p
              className={`bismillah-feedback-pill ${verified ? 'is-ok' : ''}`}
              role="status"
            >
              {feedbackText}
            </p>
          )}

          <div className="bismillah-actions">
            <button
              type="button"
              className="btn-3d-cream btn-compact btn-with-icon bismillah-listen-btn"
              onClick={() => {
                setAudioAutoplayBlocked(false);
                void playAudioClipWithStatus(BISMILLAH_AUDIO_PATH, BISMILLAH_TEXT_UZ).catch(
                  () => 'unavailable' as const,
                );
              }}
            >
              <Volume2 size={17} />
              <span>Eshitish</span>
            </button>

            {allowSoftSkip && !verified && (
              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.96 }}
                className="btn-3d-emerald btn-with-icon bismillah-skip-btn"
                onClick={() => {
                  playFeedbackChime('pop');
                  finishOnce();
                }}
              >
                <span>Boshlash</span>
                <ArrowRight size={19} strokeWidth={2.6} />
              </motion.button>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

interface AlhamdulillahHabitBlockProps {
  readyToPlay: boolean;
  acknowledged: boolean;
  aiOnline?: boolean;
  onAcknowledge: () => void;
}

/**
 * End-of-session "Alhamdulillah" habit card with a single Malika voice prompt,
 * spoken STT verification (accepting alhamdulillah / alhamdulloh), and safe
 * fallback when offline or after 2 failed attempts.
 */
export function AlhamdulillahHabitBlock({
  readyToPlay,
  acknowledged,
  aiOnline = true,
  onAcknowledge,
}: AlhamdulillahHabitBlockProps) {
  const [browserOnline, setBrowserOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [isRecording, setIsRecording] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [micBlockedOrMissing, setMicBlockedOrMissing] = useState(false);
  const [micNote, setMicNote] = useState<string | null>(null);

  const micSupported = isVoicePlaybackRecordingSupported();
  const canUseVoiceStt = aiOnline && browserOnline && micSupported && !micBlockedOrMissing;
  const allowSoftSkip = !canUseVoiceStt || attempts >= HABIT_SOFT_FALLBACK_THRESHOLD;

  const mountedRef = useRef(true);
  const autoPlayedRef = useRef(false);
  const micRef = useRef<MicSession | null>(null);
  const onAcknowledgeRef = useRef(onAcknowledge);
  onAcknowledgeRef.current = onAcknowledge;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onOn = () => setBrowserOnline(true);
    const onOff = () => setBrowserOnline(false);
    window.addEventListener('online', onOn);
    window.addEventListener('offline', onOff);
    return () => {
      window.removeEventListener('online', onOn);
      window.removeEventListener('offline', onOff);
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (micRef.current) {
        micRef.current.cancel();
        micRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!readyToPlay || acknowledged || autoPlayedRef.current) return;
    autoPlayedRef.current = true;
    void playAudioClip(ALHAMDULILLAH_AUDIO_PATH, ALHAMDULILLAH_TEXT_UZ);
  }, [readyToPlay, acknowledged]);

  const handleReplayPromptAudio = () => {
    autoPlayedRef.current = true;
    void playAudioClip(ALHAMDULILLAH_AUDIO_PATH, ALHAMDULILLAH_TEXT_UZ);
  };

  const verifyAlhamdulillahSpeech = async (rec: MicRecordingResult) => {
    if (!mountedRef.current || acknowledged) return;
    setIsChecking(true);
    setMicNote(null);
    try {
      const resp = await verifyAudioWithStt(
        rec.wavBlob,
        'alhamdulillah',
        [...ALHAMDULILLAH_ACCEPT_ALIASES],
      );
      if (!mountedRef.current || acknowledged) return;
      const decision = validateHabitUtterance('alhamdulillah', {
        transcript: resp.transcript,
        isSilence: resp.is_silence,
        confidence: resp.confidence,
        confidenceAvailable: resp.confidence_available,
      });

      if (decision === 'accepted') {
        playFeedbackChime('chime');
        onAcknowledgeRef.current();
        return;
      }

      setAttempts((prev) => prev + 1);
      if (decision === 'silence') {
        setMicNote('Ovozing eshitilmadi — «Alhamdulillah» deb balandroq aytib ko‘r!');
        void playFeedbackAudio('fb_no_speech');
      } else {
        setMicNote('Yana bir bor aniqroq qilib «Alhamdulillah» deb ayt!');
        void playFeedbackAudio('fb_louder_clearer');
      }
    } catch {
      if (!mountedRef.current) return;
      setAttempts((prev) => prev + 1);
      setMicNote('Ovoz tekshiruvi vaqtincha ishlamadi — ovoz chiqarib aytib davom eting.');
    } finally {
      if (mountedRef.current) {
        setIsChecking(false);
      }
    }
  };

  const handleToggleMic = async () => {
    if (isChecking || acknowledged) return;
    autoPlayedRef.current = true;

    if (isRecording && micRef.current) {
      const rec = await micRef.current.stop();
      micRef.current = null;
      setIsRecording(false);
      setMicLevel(0);
      if (rec) {
        await verifyAlhamdulillahSpeech(rec);
      }
      return;
    }

    stopActiveAudio();
    setMicNote(null);
    if (!micSupported) {
      setMicBlockedOrMissing(true);
      setMicNote('Mikrofon topilmadi — ovoz chiqarib aytib, bemalol davom etishingiz mumkin.');
      return;
    }

    try {
      const session = await startMicRecording(
        (lvl) => {
          if (mountedRef.current) setMicLevel(lvl);
        },
        (_reason, rec) => {
          micRef.current = null;
          if (!mountedRef.current) return;
          setIsRecording(false);
          setMicLevel(0);
          void verifyAlhamdulillahSpeech(rec);
        },
        SPELLING_FRIENDLY_MIC_CONFIG,
      );
      if (!mountedRef.current || acknowledged) {
        session.cancel();
        return;
      }
      micRef.current = session;
      setIsRecording(true);
    } catch (err) {
      if (!mountedRef.current) return;
      if (isMicPermissionDeniedError(err)) {
        setMicBlockedOrMissing(true);
        setMicNote('Mikrofonga ruxsat berilmadi — ovoz chiqarib aytib, bemalol davom eting.');
      } else {
        setAttempts((prev) => prev + 1);
        setMicNote('Mikrofondan yozib bo‘lmadi — qayta urining yoki davom eting.');
      }
    }
  };

  const handleContinueClick = () => {
    if (micRef.current) {
      micRef.current.cancel();
      micRef.current = null;
    }
    stopActiveAudio();
    playFeedbackChime('chime');
    onAcknowledge();
  };

  if (acknowledged) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="alhamdulillah-done-pill"
      >
        <Sparkles size={16} />
        <span>Barakalla! «Alhamdulillah» deb aytding!</span>
        <button
          type="button"
          className="alhamdulillah-mini-audio"
          onClick={handleReplayPromptAudio}
          aria-label="Alhamdulillahni qayta eshitish"
        >
          <Volume2 size={15} />
        </button>
      </motion.div>
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="alhamdulillah-box"
      aria-label="Alhamdulillah odati"
    >
      <div className="alhamdulillah-header">
        <span className="alhamdulillah-title">Alhamdulillah</span>
        <button
          type="button"
          className="btn-3d-cream btn-compact btn-with-icon"
          onClick={handleReplayPromptAudio}
        >
          <Volume2 size={15} />
          <span>Eshitish</span>
        </button>
      </div>

      <p className="alhamdulillah-prompt">{ALHAMDULILLAH_TEXT_UZ}</p>

      {isRecording && (
        <div className="alhamdulillah-recording-pill" role="status">
          <span className="alhamdulillah-rec-dot" aria-hidden="true" />
          <span>Tinglayapman... «Alhamdulillah» deb ayt!</span>
        </div>
      )}

      {micNote && (
        <p className="alhamdulillah-mic-note" role="status">
          {micNote}
        </p>
      )}

      <div className="alhamdulillah-controls">
        {canUseVoiceStt && (
          <button
            type="button"
            className={`btn-3d-amber btn-compact btn-with-icon ${
              isRecording ? 'mic-btn-recording' : ''
            }`}
            style={
              isRecording
                ? { transform: `scale(${1 + Math.min(0.08, micLevel * 0.16)})` }
                : undefined
            }
            disabled={isChecking}
            onClick={() => void handleToggleMic()}
          >
            {isRecording ? (
              <>
                <Square size={15} fill="currentColor" />
                <span>To‘xtatish</span>
              </>
            ) : isChecking ? (
              <>
                <Sparkles size={15} />
                <span>Tekshiryapman...</span>
              </>
            ) : (
              <>
                <Mic size={16} />
                <span>Mikrofonga «Alhamdulillah» de</span>
              </>
            )}
          </button>
        )}

        {allowSoftSkip && (
          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.96 }}
            className="btn-3d-emerald btn-compact btn-with-icon"
            onClick={handleContinueClick}
          >
            <Check size={16} strokeWidth={2.8} />
            <span>Aytdim / Davom etish</span>
          </motion.button>
        )}
      </div>
    </motion.section>
  );
}
