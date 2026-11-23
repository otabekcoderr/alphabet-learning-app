import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  playAudioClip,
  playAudioClipWithStatus,
  playFeedbackChime,
  stopActiveAudio,
  type AudioClipPlayStatus,
} from '../utils/audioRecorder';
import { AnimatedCharacter } from './AnimatedCharacter';
import { ArrowLeft, ArrowRight, Check, Mic, Play, RotateCcw, Sparkles, Square, Volume2 } from './Icons';
import { StorybookBackdrop } from './StorybookBackdrop';

export const BISMILLAH_AUDIO_PATH = '/audio/bismillah.mp3';
export const ALHAMDULILLAH_AUDIO_PATH = '/audio/alhamdulillah.mp3';
export const BISMILLAH_TEXT_UZ = 'Ilming ziyoda bo‘lishi uchun, «Bismillah» deb boshla!';
export const ALHAMDULILLAH_TEXT_UZ =
  'Barakalla, mashqlarni zo‘r bajarding! Endi Allohga hamd aytib, «Alhamdulillah» deb ayt!';

const BISMILLAH_MIN_DISPLAY_MS = 3000;
const BISMILLAH_MAX_WAIT_MS = 7500;
const BISMILLAH_POST_AUDIO_PAUSE_MS = 350;
const ALHAMDULILLAH_MAX_RECORD_MS = 4000;

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' && typeof document !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Check whether the browser supports microphone recording + local playback via MediaRecorder.
 */
export function isVoicePlaybackRecordingSupported(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      Boolean(navigator.mediaDevices) &&
      typeof navigator.mediaDevices.getUserMedia === 'function' &&
      typeof MediaRecorder !== 'undefined'
    );
  } catch {
    return false;
  }
}

function pickSupportedRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return undefined;
  }
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  for (const mime of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) {
        return mime;
      }
    } catch {
      // Ignore browser-specific MIME check errors
    }
  }
  return undefined;
}

interface BismillahStartCardProps {
  avatarId: string;
  worldTitle: string;
  onContinue: () => void;
  onBack?: () => void;
}

/**
 * Gentle pre-session "Bismillah" card played at the start of each exercise round.
 * Child or parent can skip immediately with 1 tap or let it transition automatically.
 */
export function BismillahStartCard({
  avatarId,
  worldTitle,
  onContinue,
  onBack,
}: BismillahStartCardProps) {
  const [audioAutoplayBlocked, setAudioAutoplayBlocked] = useState(false);
  const doneRef = useRef(false);
  const autoAdvanceCancelledRef = useRef(false);
  const onContinueRef = useRef(onContinue);
  onContinueRef.current = onContinue;

  useIsomorphicLayoutEffect(() => {
    try {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    } catch {
      // Ignore environments without window.scrollTo
    }
  }, []);

  const finishOnce = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    stopActiveAudio();
    onContinueRef.current();
  }, []);

  useEffect(() => {
    let cancelled = false;
    doneRef.current = false;
    autoAdvanceCancelledRef.current = false;
    setAudioAutoplayBlocked(false);
    const timers: number[] = [];
    let removeGestureListeners = () => {};

    const waitMs = (ms: number) =>
      new Promise<void>((resolve) => {
        if (typeof window === 'undefined') {
          resolve();
          return;
        }
        const id = window.setTimeout(resolve, ms);
        timers.push(id);
      });

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

      if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
        return;
      }

      const shouldSkipTarget = (target: EventTarget | null): boolean => {
        if (!target || typeof target !== 'object' || !('closest' in target)) return false;
        const maybeClosest = (target as { closest?: unknown }).closest;
        if (typeof maybeClosest !== 'function') return false;
        const closestFn = maybeClosest as (selector: string) => unknown;
        return Boolean(
          closestFn.call(target, '.bismillah-skip-btn') ||
            closestFn.call(target, '.btn-squircle-back') ||
            closestFn.call(target, '.bismillah-listen-btn'),
        );
      };

      const onUnlockGesture = (event: Event) => {
        removeGestureListeners();
        if (cancelled || doneRef.current || shouldSkipTarget(event.target)) {
          return;
        }
        setAudioAutoplayBlocked(false);
        try {
          void playAudioClipWithStatus(BISMILLAH_AUDIO_PATH, BISMILLAH_TEXT_UZ).catch(
            () => 'unavailable' as const,
          );
        } catch {
          // Audio playback must never break UI
        }
      };

      const eventNames = ['pointerdown', 'touchstart', 'keydown'] as const;
      for (const evtName of eventNames) {
        window.addEventListener(evtName, onUnlockGesture, { capture: true, once: true });
      }
      removeGestureListeners = () => {
        for (const evtName of eventNames) {
          if (typeof window.removeEventListener === 'function') {
            window.removeEventListener(evtName, onUnlockGesture, { capture: true });
          }
        }
        removeGestureListeners = () => {};
      };
    });

    void Promise.all([
      waitMs(BISMILLAH_MIN_DISPLAY_MS),
      Promise.race([audioPromise, waitMs(BISMILLAH_MAX_WAIT_MS)]),
    ])
      .then(() => waitMs(BISMILLAH_POST_AUDIO_PAUSE_MS))
      .then(() => {
        if (!cancelled && !autoAdvanceCancelledRef.current) {
          finishOnce();
        }
      });

    return () => {
      cancelled = true;
      removeGestureListeners();
      for (const id of timers) {
        if (typeof window !== 'undefined') {
          window.clearTimeout(id);
        }
      }
      stopActiveAudio();
    };
  }, [finishOnce]);

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
        <section
          className="bismillah-card"
          aria-labelledby="bismillah-heading"
        >
          <span className="bismillah-world-pill">{worldTitle}</span>
          <span className="bismillah-teacher-pill">Ustoz eslatmasi</span>

          <AnimatedCharacter
            mood="idle"
            size={140}
            avatarId={avatarId}
            bubblePosition="none"
          />

          <h1 id="bismillah-heading" className="bismillah-title">
            Bismillah
          </h1>
          <p className="bismillah-sub">
            {BISMILLAH_TEXT_UZ}
          </p>

          <div className="bismillah-progress-track" aria-hidden="true">
            <div
              className="bismillah-progress-fill"
              style={{ animationDuration: `${BISMILLAH_MIN_DISPLAY_MS}ms` }}
            />
          </div>

          {audioAutoplayBlocked && (
            <p className="bismillah-audio-hint" role="status">
              Ovozni eshitish uchun «Eshitish» tugmasini bosing
            </p>
          )}

          <div className="bismillah-actions">
            <button
              type="button"
              className="btn-3d-cream btn-compact btn-with-icon bismillah-listen-btn"
              onClick={() => {
                autoAdvanceCancelledRef.current = true;
                setAudioAutoplayBlocked(false);
                try {
                  void playAudioClipWithStatus(BISMILLAH_AUDIO_PATH, BISMILLAH_TEXT_UZ).catch(
                    () => 'unavailable' as const,
                  );
                } catch {
                  // Ignore mobile audio replay failures
                }
              }}
            >
              <Volume2 size={17} />
              <span>Eshitish</span>
            </button>

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
          </div>
        </section>
      </main>
    </div>
  );
}

type RecordingPhase = 'idle' | 'recording' | 'recorded' | 'unavailable';

interface AlhamdulillahHabitBlockProps {
  readyToPlay: boolean;
  acknowledged: boolean;
  onAcknowledge: () => void;
}

/**
 * End-of-session "Alhamdulillah" habit card with audio prompt, optional MediaRecorder
 * self-playback, and graceful fallback when microphone permission is missing or denied.
 */
export function AlhamdulillahHabitBlock({
  readyToPlay,
  acknowledged,
  onAcknowledge,
}: AlhamdulillahHabitBlockProps) {
  const [recordingPhase, setRecordingPhase] = useState<RecordingPhase>('idle');
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [isPlayingOwn, setIsPlayingOwn] = useState(false);
  const [micNote, setMicNote] = useState<string | null>(null);

  const micSupported = isVoicePlaybackRecordingSupported();
  const mountedRef = useRef(true);
  const autoPlayedRef = useRef(false);
  const recordingPhaseRef = useRef<RecordingPhase>('idle');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const autoStopTimerRef = useRef<number | null>(null);
  const playbackAudioRef = useRef<HTMLAudioElement | null>(null);
  const recordedUrlRef = useRef<string | null>(null);

  recordingPhaseRef.current = recordingPhase;

  const stopMediaStream = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        try {
          track.stop();
        } catch {
          // Ignore track stop errors
        }
      }
      streamRef.current = null;
    }
  }, []);

  const clearAutoStopTimer = useCallback(() => {
    if (autoStopTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }
  }, []);

  const stopOwnPlayback = useCallback(() => {
    if (playbackAudioRef.current) {
      try {
        playbackAudioRef.current.pause();
        playbackAudioRef.current.currentTime = 0;
      } catch {
        // Ignore audio pause errors
      }
      playbackAudioRef.current = null;
    }
    if (mountedRef.current) {
      setIsPlayingOwn(false);
    }
  }, []);

  const revokeRecordedUrl = useCallback(() => {
    if (recordedUrlRef.current && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      try {
        URL.revokeObjectURL(recordedUrlRef.current);
      } catch {
        // Ignore revoke errors
      }
    }
    recordedUrlRef.current = null;
  }, []);

  const stopActiveRecorder = useCallback(() => {
    clearAutoStopTimer();
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') {
      try {
        rec.stop();
      } catch {
        stopMediaStream();
      }
    } else {
      stopMediaStream();
    }
  }, [clearAutoStopTimer, stopMediaStream]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearAutoStopTimer();
      if (recorderRef.current) {
        recorderRef.current.ondataavailable = null;
        recorderRef.current.onstop = null;
        recorderRef.current.onerror = null;
        if (recorderRef.current.state !== 'inactive') {
          try {
            recorderRef.current.stop();
          } catch {
            // Ignore recorder stop errors on unmount
          }
        }
        recorderRef.current = null;
      }
      stopMediaStream();
      stopOwnPlayback();
      revokeRecordedUrl();
    };
  }, [clearAutoStopTimer, revokeRecordedUrl, stopMediaStream, stopOwnPlayback]);

  useEffect(() => {
    if (!readyToPlay || acknowledged || autoPlayedRef.current) return;
    if (recordingPhaseRef.current === 'recording') return;
    autoPlayedRef.current = true;
    void playAudioClip(ALHAMDULILLAH_AUDIO_PATH, ALHAMDULILLAH_TEXT_UZ);
  }, [readyToPlay, acknowledged]);

  const handleReplayPromptAudio = () => {
    autoPlayedRef.current = true;
    stopOwnPlayback();
    void playAudioClip(ALHAMDULILLAH_AUDIO_PATH, ALHAMDULILLAH_TEXT_UZ);
  };

  const handleStartRecording = async () => {
    autoPlayedRef.current = true;
    stopActiveAudio();
    stopOwnPlayback();
    setMicNote(null);

    if (!micSupported) {
      setRecordingPhase('unavailable');
      setMicNote('Mikrofon topilmadi — ovoz chiqarib aytib, bemalol davom etishingiz mumkin.');
      return;
    }

    revokeRecordedUrl();
    setRecordedUrl(null);
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) {
        for (const track of stream.getTracks()) {
          try {
            track.stop();
          } catch {
            // Ignore
          }
        }
        return;
      }

      streamRef.current = stream;
      const mimeType = pickSupportedRecorderMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;

      recorder.ondataavailable = (ev: BlobEvent) => {
        if (ev.data && ev.data.size > 0) {
          chunksRef.current.push(ev.data);
        }
      };

      recorder.onerror = () => {
        clearAutoStopTimer();
        stopMediaStream();
        recorderRef.current = null;
        if (!mountedRef.current) return;
        setRecordingPhase('unavailable');
        setMicNote('Mikrofondan yozib bo‘lmadi — ovoz chiqarib aytib, bemalol davom eting.');
      };

      recorder.onstop = () => {
        clearAutoStopTimer();
        stopMediaStream();
        recorderRef.current = null;
        if (!mountedRef.current) return;

        if (chunksRef.current.length === 0) {
          setRecordingPhase('unavailable');
          setMicNote('Ovoz yozilmadi — qayta urinib ko‘ring yoki davom eting.');
          return;
        }

        try {
          const blob = new Blob(chunksRef.current, {
            type: recorder.mimeType || mimeType || 'audio/webm',
          });
          if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
            setRecordingPhase('unavailable');
            setMicNote('Ovoz yozib olindi! Endi bemalol davom etishingiz mumkin.');
            return;
          }
          const url = URL.createObjectURL(blob);
          recordedUrlRef.current = url;
          setRecordedUrl(url);
          setRecordingPhase('recorded');
        } catch {
          setRecordingPhase('unavailable');
          setMicNote('Ovozni tayyorlashda xatolik yuz berdi — bemalol davom eting.');
        }
      };

      recorder.start();
      setRecordingPhase('recording');
      if (typeof window !== 'undefined') {
        autoStopTimerRef.current = window.setTimeout(() => {
          stopActiveRecorder();
        }, ALHAMDULILLAH_MAX_RECORD_MS);
      }
    } catch {
      clearAutoStopTimer();
      stopMediaStream();
      recorderRef.current = null;
      if (!mountedRef.current) return;
      setRecordingPhase('unavailable');
      setMicNote('Mikrofonga ruxsat berilmadi — ovoz chiqarib aytib, bemalol davom eting.');
    }
  };

  const handlePlayOwnVoice = () => {
    if (!recordedUrl || typeof Audio === 'undefined') return;
    stopActiveAudio();
    stopOwnPlayback();
    try {
      const audio = new Audio(recordedUrl);
      playbackAudioRef.current = audio;
      setIsPlayingOwn(true);
      audio.onended = () => {
        if (playbackAudioRef.current === audio) {
          playbackAudioRef.current = null;
        }
        if (mountedRef.current) {
          setIsPlayingOwn(false);
        }
      };
      audio.onerror = () => {
        if (playbackAudioRef.current === audio) {
          playbackAudioRef.current = null;
        }
        if (mountedRef.current) {
          setIsPlayingOwn(false);
        }
      };
      void Promise.resolve(audio.play()).catch(() => {
        if (playbackAudioRef.current === audio) {
          playbackAudioRef.current = null;
        }
        if (mountedRef.current) {
          setIsPlayingOwn(false);
        }
      });
    } catch {
      setIsPlayingOwn(false);
    }
  };

  const handleContinueClick = () => {
    stopActiveRecorder();
    stopOwnPlayback();
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

      <p className="alhamdulillah-prompt">
        {ALHAMDULILLAH_TEXT_UZ}
      </p>

      {recordingPhase === 'recording' && (
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
        {recordingPhase === 'recording' ? (
          <button
            type="button"
            className="btn-3d-orange btn-compact btn-with-icon"
            onClick={stopActiveRecorder}
          >
            <Square size={15} fill="currentColor" />
            <span>To‘xtatish</span>
          </button>
        ) : recordingPhase === 'recorded' && recordedUrl ? (
          <>
            <button
              type="button"
              className="btn-3d-cream btn-compact btn-with-icon"
              onClick={handlePlayOwnVoice}
            >
              <Play size={15} fill="currentColor" />
              <span>{isPlayingOwn ? 'Ijro etilmoqda...' : 'O‘z ovozimni eshitish'}</span>
            </button>
            <button
              type="button"
              className="btn-3d-cream btn-compact btn-with-icon"
              onClick={() => void handleStartRecording()}
              aria-label="Qayta yozish"
            >
              <RotateCcw size={15} />
              <span>Qayta yozish</span>
            </button>
          </>
        ) : (
          micSupported && (
            <button
              type="button"
              className="btn-3d-cream btn-compact btn-with-icon"
              onClick={() => void handleStartRecording()}
            >
              <Mic size={16} />
              <span>O‘z ovozimni yozish</span>
            </button>
          )
        )}

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
      </div>
    </motion.section>
  );
}
