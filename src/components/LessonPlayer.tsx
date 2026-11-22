import { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutGroup, motion } from 'framer-motion';
import {
  countUzbekSyllables,
  DYNAMIC_WORD_POOL,
  type WordPoolItem,
  type WordPoolKind,
} from '../data/curriculum';
import {
  applyBubbleSpeechResult,
  BUBBLE_OFFLINE_PAUSE_MS,
  buildSyllableAcceptAliases,
  completeOfflineSyllablePause,
  confirmOfflineBubblePicture,
  createBubbleGateState,
  tapSyllableBubble,
  type BubbleGateState,
} from '../logic/bubbleGate';
import { getAvatarOption } from '../logic/gamification';
import { shuffleOptionsWithAntiStreak } from '../logic/optionShuffle';
import {
  SENTENCE_FRIENDLY_MIC_CONFIG,
  SPELLING_FRIENDLY_MIC_CONFIG,
  type MicAutoStopAction,
} from '../logic/micAutoStop';
import {
  evaluateReadingAttempt,
  READING_THRESHOLDS,
  type ReadingAttemptEvaluation,
  type WordProgress,
} from '../logic/pedagogy';
import {
  computeReadingDurations,
  createScaffoldingState,
  markScaffoldingAudioHint,
  pauseScaffoldingForSpeech,
  resumeScaffoldingAfterFalseStart,
  tickScaffolding,
  type ScaffoldingTimerState,
} from '../logic/scaffoldingTimer';
import { validateSttReading } from '../logic/sttValidator';
import {
  buildSentenceWordBank,
  getOfflineFallbackEmojiChoices,
  getSentenceComprehensionAudioKey,
  getSentenceComprehensionPromptUz,
  getStage1GameMode,
  getVisualSplitParts,
  type AdaptiveSessionWord,
  type Stage1GameMode,
} from '../logic/wordPoolEngine';
import {
  playFeedbackAudio,
  playFeedbackChime,
  playFeedbackThenWord,
  playInstructionAudio,
  playLetterRecallAudio,
  playPraiseAudio,
  playSyllableAudio,
  playWordItemAudio,
  playWrongFeedbackAudio,
  startMicRecording,
  stopActiveAudio,
  verifyAudioWithStt,
  type FeedbackAudioKey,
  type InstructionAudioKey,
  type MicRecordingResult,
  type MicSession,
} from '../utils/audioRecorder';
import { triggerCelebrationBurst } from '../utils/soundEffects';
import { AnimatedCharacter } from './AnimatedCharacter';
import { GameVisual } from './GameVisual';
import { ArrowRight, Check, CloseIcon, Home, Mic, RotateCcw, Sparkles, Square, Star, Volume2 } from './Icons';
import { LetterBlock } from './LetterBlock';
import { StorybookBackdrop } from './StorybookBackdrop';

export interface WordAttemptReport {
  item: WordPoolItem;
  evaluation: ReadingAttemptEvaluation;
  reactionMs: number;
  articulationMs: number;
  latencyMs: number | null;
  usedVoiceAi: boolean;
  starsEarned: number;
}

interface LessonPlayerProps {
  sessionItems: AdaptiveSessionWord[];
  wordProgressMap: Record<string, WordProgress>;
  worldTitle: string;
  avatarId: string;
  aiOnline: boolean;
  onLetterHintTap: (letter: string) => void;
  onWordCompleted: (report: WordAttemptReport) => void;
  onPlayAnotherRound: () => void;
  onBack: () => void;
}

export type WordPhase = 'stage1_build' | 'stage2_spotlight' | 'exam' | 'word_done';

export function getLessonInstructionKey(params: {
  wordPhase: WordPhase;
  buildGameMode: Stage1GameMode;
  itemKind: WordPoolKind;
  isOfflineFallbackActive: boolean;
}): InstructionAudioKey | null {
  if (params.wordPhase === 'word_done') return null;
  if (params.wordPhase === 'stage1_build') {
    if (params.buildGameMode === 'train') return 'instr_stage1_train';
    if (params.buildGameMode === 'sentence_builder') return 'instr_stage1_sentence';
    if (params.buildGameMode === 'constructor') return 'instr_stage1_constructor';
    return 'instr_stage1_bubbles';
  }
  if (params.wordPhase === 'stage2_spotlight') {
    return params.itemKind === 'sentence'
      ? 'instr_stage2_spotlight_sentence'
      : 'instr_stage2_spotlight_word';
  }
  if (params.isOfflineFallbackActive) {
    return params.itemKind === 'sentence'
      ? 'instr_stage3_exam_offline_sentence'
      : 'instr_stage3_exam_offline_word';
  }
  return params.itemKind === 'sentence'
    ? 'instr_stage3_exam_voice_sentence'
    : 'instr_stage3_exam_voice_word';
}

const CONSTRUCTOR_BTN_CLASSES = ['cube-btn-orange', 'cube-btn-emerald', 'cube-btn-purple'] as const;

export function LessonPlayer({
  sessionItems,
  wordProgressMap,
  worldTitle,
  avatarId,
  aiOnline,
  onLetterHintTap,
  onWordCompleted,
  onPlayAnotherRound,
  onBack,
}: LessonPlayerProps) {
  const [wordIdx, setWordIdx] = useState(0);
  const [retryIndex, setRetryIndex] = useState(0);
  const [roundFinished, setRoundFinished] = useState(false);
  const [roundStars, setRoundStars] = useState(0);
  const [completedResults, setCompletedResults] = useState<
    Record<string, ReadingAttemptEvaluation['status']>
  >({});

  const currentSession = sessionItems[wordIdx] ?? sessionItems[0] ?? null;
  const currentItem = currentSession?.item ?? null;
  const currentProgress = currentItem ? wordProgressMap[currentItem.id] : undefined;

  const initialPhaseForItem = (session: AdaptiveSessionWord | null): WordPhase =>
    session?.expressExamOnly ? 'exam' : 'stage1_build';

  const [wordPhase, setWordPhase] = useState<WordPhase>(() => initialPhaseForItem(currentSession));

  // Stage 1: Train Blending Slider, Constructor, Bubbles, or Sentence Builder
  const buildGameMode = useMemo(() => {
    if (!currentItem) return 'constructor' as const;
    return getStage1GameMode(wordIdx, currentItem);
  }, [wordIdx, currentItem]);

  const [pickedMissingPart, setPickedMissingPart] = useState<string | null>(null);
  const [wrongPart, setWrongPart] = useState<string | null>(null);
  const [wrongShakeTick, setWrongShakeTick] = useState(0);

  const [bubbleGate, setBubbleGate] = useState<BubbleGateState>(() =>
    createBubbleGateState(currentItem?.parts ?? []),
  );
  const [wrongBubbleKey, setWrongBubbleKey] = useState<string | null>(null);
  const [wrongBubblePicEmoji, setWrongBubblePicEmoji] = useState<string | null>(null);
  const [bubbleMicRecording, setBubbleMicRecording] = useState(false);
  const [bubbleMicChecking, setBubbleMicChecking] = useState(false);
  const [bubbleMicLevel, setBubbleMicLevel] = useState(0);
  const [bubbleFeedback, setBubbleFeedback] = useState<{
    text: string;
    audioKey: FeedbackAudioKey;
  } | null>(null);
  const [bubbleAssistBusy, setBubbleAssistBusy] = useState(false);
  const [blendProgress, setBlendProgress] = useState<number>(0);
  const [placedSentenceKeys, setPlacedSentenceKeys] = useState<string[]>([]);
  const [wrongSentenceKey, setWrongSentenceKey] = useState<string | null>(null);
  const [sentenceHint, setSentenceHint] = useState<{
    text: string;
    audioKey: FeedbackAudioKey;
  } | null>(null);

  // Stage 2: Spotlight + Emoji Match
  const [spotlightIndex, setSpotlightIndex] = useState<number>(0);
  const [wrongSpotlightEmoji, setWrongSpotlightEmoji] = useState<string | null>(null);

  // Stage 3: Independent Exam + Progressive Scaffolding + Offline 4-Choice Fallback
  const [browserOnline, setBrowserOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [consecutiveSttFailures, setConsecutiveSttFailures] = useState(0);
  const [micPermissionBlocked, setMicPermissionBlocked] = useState(false);

  const [isRecording, setIsRecording] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [examFeedback, setExamFeedback] = useState<{
    kind: 'gentle' | 'success';
    text: string;
    audioKey?: FeedbackAudioKey;
  } | null>(null);
  const [showVisualSplit, setShowVisualSplit] = useState(false);
  const [showAudioHint, setShowAudioHint] = useState(false);
  const [lastEval, setLastEval] = useState<ReadingAttemptEvaluation | null>(null);
  const [lastStarsEarned, setLastStarsEarned] = useState(0);

  // Offline 4-picture check state
  const [offlineWrongEmojis, setOfflineWrongEmojis] = useState<string[]>([]);

  const micRef = useRef<MicSession | null>(null);
  const bubbleMicRef = useRef<MicSession | null>(null);
  const stage1TimerRef = useRef<number | null>(null);
  const bubblePauseTimerRef = useRef<number | null>(null);
  const praiseTimerRef = useRef<number | null>(null);
  const bubbleGenRef = useRef<number>(0);
  const suppressNextAutoInstrRef = useRef<boolean>(false);
  const trainCompletedRef = useRef<boolean>(false);
  const recordedIdsRef = useRef<Set<string>>(new Set());
  const scaffoldingRef = useRef<ScaffoldingTimerState>(createScaffoldingState(0));
  const audioHintPlayedRef = useRef<boolean>(false);
  const lowConfRetriesRef = useRef<number>(0);
  const examRenderStartRef = useRef<number>(0);
  const isCheckingRef = useRef<boolean>(false);
  const prevConstructorCorrectIdxRef = useRef<number | null>(null);
  const prevBubbleCorrectIdxRef = useRef<number | null>(null);
  const prevSpotlightCorrectIdxRef = useRef<number | null>(null);
  const prevOfflineCorrectIdxRef = useRef<number | null>(null);

  const avatar = getAvatarOption(avatarId);

  const isOfflineFallbackActive =
    !aiOnline || !browserOnline || consecutiveSttFailures >= 2 || micPermissionBlocked;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOnline = () => setBrowserOnline(true);
    const handleOffline = () => setBrowserOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const spotlightEmojiChoices = useMemo(() => {
    if (!currentItem) return [];
    return shuffleOptionsWithAntiStreak(
      [currentItem.emoji, ...currentItem.distractorEmojis],
      (emoji) => emoji === currentItem.emoji,
      prevSpotlightCorrectIdxRef.current,
    );
  }, [currentItem, wordPhase, retryIndex]);

  const offlineEmojiChoices = useMemo(() => {
    if (!currentItem) return [];
    return getOfflineFallbackEmojiChoices(
      currentItem,
      DYNAMIC_WORD_POOL,
      prevOfflineCorrectIdxRef.current,
    );
  }, [currentItem, wordPhase, retryIndex]);

  const constructorChoices = useMemo(() => {
    if (!currentItem) return [];
    const targetLastPart = currentItem.parts[currentItem.parts.length - 1] ?? currentItem.text;
    const uniqueChoices = Array.from(
      new Set([targetLastPart, ...currentItem.distractorParts]),
    ).slice(0, 3);
    return shuffleOptionsWithAntiStreak(
      uniqueChoices,
      (part) => part === targetLastPart,
      prevConstructorCorrectIdxRef.current,
    );
  }, [currentItem, wordPhase, retryIndex]);

  const bubbleChoices = useMemo(() => {
    if (!currentItem) return [];
    const raw = [
      ...currentItem.parts.map((text, idx) => ({ key: `target-${idx}-${text}`, text })),
      ...currentItem.distractorParts.slice(0, 2).map((text, idx) => ({
        key: `dist-${idx}-${text}`,
        text,
      })),
    ];
    return shuffleOptionsWithAntiStreak(
      raw,
      (bubble) => bubble.key.startsWith('target-0-'),
      prevBubbleCorrectIdxRef.current,
    );
  }, [currentItem, wordPhase, retryIndex]);

  useEffect(() => {
    if (!currentItem) return;
    if (wordPhase === 'stage1_build') {
      if (buildGameMode === 'constructor') {
        const targetLastPart = currentItem.parts[currentItem.parts.length - 1] ?? currentItem.text;
        const idx = constructorChoices.indexOf(targetLastPart);
        if (idx !== -1) prevConstructorCorrectIdxRef.current = idx;
      } else if (buildGameMode === 'bubbles') {
        const idx = bubbleChoices.findIndex((b) => b.key.startsWith('target-0-'));
        if (idx !== -1) prevBubbleCorrectIdxRef.current = idx;
      }
    } else if (wordPhase === 'stage2_spotlight') {
      const idx = spotlightEmojiChoices.indexOf(currentItem.emoji);
      if (idx !== -1) prevSpotlightCorrectIdxRef.current = idx;
    } else if (wordPhase === 'exam' && isOfflineFallbackActive) {
      const idx = offlineEmojiChoices.indexOf(currentItem.emoji);
      if (idx !== -1) prevOfflineCorrectIdxRef.current = idx;
    }
  }, [
    currentItem,
    wordPhase,
    buildGameMode,
    isOfflineFallbackActive,
    constructorChoices,
    bubbleChoices,
    spotlightEmojiChoices,
    offlineEmojiChoices,
  ]);

  const sentenceBank = useMemo(() => {
    if (!currentItem || currentItem.kind !== 'sentence') return [];
    return buildSentenceWordBank(currentItem);
  }, [currentItem]);

  // Reset per-word state when switching to a new session item
  useEffect(() => {
    bubbleGenRef.current += 1;
    if (stage1TimerRef.current !== null) {
      window.clearTimeout(stage1TimerRef.current);
      stage1TimerRef.current = null;
    }
    if (bubblePauseTimerRef.current !== null) {
      window.clearTimeout(bubblePauseTimerRef.current);
      bubblePauseTimerRef.current = null;
    }
    if (praiseTimerRef.current !== null) {
      window.clearTimeout(praiseTimerRef.current);
      praiseTimerRef.current = null;
    }
    trainCompletedRef.current = false;
    setWordPhase(initialPhaseForItem(currentSession));
    setPickedMissingPart(null);
    setWrongPart(null);
    setWrongShakeTick(0);
    setBubbleGate(createBubbleGateState(currentItem?.parts ?? []));
    setWrongBubbleKey(null);
    setWrongBubblePicEmoji(null);
    setBubbleMicRecording(false);
    setBubbleMicChecking(false);
    setBubbleMicLevel(0);
    setBubbleFeedback(null);
    setBubbleAssistBusy(false);
    setBlendProgress(0);
    setPlacedSentenceKeys([]);
    setWrongSentenceKey(null);
    setSentenceHint(null);
    setSpotlightIndex(0);
    setWrongSpotlightEmoji(null);
    setIsRecording(false);
    isCheckingRef.current = false;
    setIsChecking(false);
    setMicLevel(0);
    setExamFeedback(null);
    setShowVisualSplit(false);
    setShowAudioHint(false);
    setLastEval(null);
    setLastStarsEarned(0);
    setOfflineWrongEmojis([]);
    lowConfRetriesRef.current = 0;
    audioHintPlayedRef.current = false;
    suppressNextAutoInstrRef.current = false;

    if (micRef.current) {
      micRef.current.cancel();
      micRef.current = null;
    }
    if (bubbleMicRef.current) {
      bubbleMicRef.current.cancel();
      bubbleMicRef.current = null;
    }
    return () => {
      bubbleGenRef.current += 1;
      if (stage1TimerRef.current !== null) {
        window.clearTimeout(stage1TimerRef.current);
        stage1TimerRef.current = null;
      }
      if (bubblePauseTimerRef.current !== null) {
        window.clearTimeout(bubblePauseTimerRef.current);
        bubblePauseTimerRef.current = null;
      }
      if (praiseTimerRef.current !== null) {
        window.clearTimeout(praiseTimerRef.current);
        praiseTimerRef.current = null;
      }
      stopActiveAudio();
      if (micRef.current) {
        micRef.current.cancel();
        micRef.current = null;
      }
      if (bubbleMicRef.current) {
        bubbleMicRef.current.cancel();
        bubbleMicRef.current = null;
      }
    };
  }, [currentSession, currentItem]);

  // Auto-play static instruction clip on stage/mode transitions (Stage 3 never reads target word)
  useEffect(() => {
    if (roundFinished || !currentItem) return;
    if (suppressNextAutoInstrRef.current) {
      suppressNextAutoInstrRef.current = false;
      return;
    }
    const instrKey = getLessonInstructionKey({
      wordPhase,
      buildGameMode,
      itemKind: currentItem.kind,
      isOfflineFallbackActive,
    });
    if (instrKey) {
      void playInstructionAudio(instrKey);
    }
  }, [roundFinished, currentItem, wordPhase, buildGameMode, isOfflineFallbackActive]);

  // Stage 3 Exam: Progressive Scaffolding Timer (4.5s split, 8.0s audio hint)
  useEffect(() => {
    if (wordPhase !== 'exam' || !currentItem) return;
    const now = performance.now();
    examRenderStartRef.current = now;
    scaffoldingRef.current = createScaffoldingState(now);
    audioHintPlayedRef.current = false;
    setShowVisualSplit(false);
    setShowAudioHint(false);

    if (isOfflineFallbackActive) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (isCheckingRef.current) return;
      const next = tickScaffolding(scaffoldingRef.current, performance.now(), READING_THRESHOLDS);
      scaffoldingRef.current = next;
      if (next.usedVisualSplit) {
        setShowVisualSplit(true);
      }
      if (next.usedAudioHint) {
        setShowAudioHint(true);
        if (!audioHintPlayedRef.current) {
          audioHintPlayedRef.current = true;
          void playWordItemAudio(currentItem);
        }
      }
    }, 150);

    return () => window.clearInterval(intervalId);
  }, [wordPhase, currentItem, isOfflineFallbackActive]);

  const handleTapLetterRecall = (letter: string) => {
    onLetterHintTap(letter);
    void playLetterRecallAudio(letter);
  };

  const handleExamLetterRecall = (letter: string) => {
    handleTapLetterRecall(letter);
    scaffoldingRef.current = markScaffoldingAudioHint(scaffoldingRef.current);
    setShowVisualSplit(true);
    setShowAudioHint(true);
  };

  const enterSpotlightStage = () => {
    playFeedbackChime('chime');
    setSpotlightIndex(0);
    setWrongSpotlightEmoji(null);
    setWordPhase('stage2_spotlight');
  };

  const scheduleStage2Advance = (delayMs: number) => {
    if (stage1TimerRef.current !== null) {
      window.clearTimeout(stage1TimerRef.current);
    }
    stage1TimerRef.current = window.setTimeout(() => {
      stage1TimerRef.current = null;
      enterSpotlightStage();
    }, delayMs);
  };

  const handleBlendSliderChange = (nextValue: number) => {
    setBlendProgress(nextValue);
    if (nextValue >= 90 && currentItem && !trainCompletedRef.current) {
      trainCompletedRef.current = true;
      setBlendProgress(100);
      playFeedbackChime('chime');
      void playWordItemAudio(currentItem);
      scheduleStage2Advance(720);
    }
  };

  const enterExamStage = () => {
    stopActiveAudio();
    playFeedbackChime('pop');
    setExamFeedback(null);
    setOfflineWrongEmojis([]);
    lowConfRetriesRef.current = 0;
    setWordPhase('exam');
  };

  const finishCurrentWord = (report: WordAttemptReport) => {
    if (!recordedIdsRef.current.has(report.item.id)) {
      recordedIdsRef.current.add(report.item.id);
      setRoundStars((prev) => prev + report.starsEarned);
      setCompletedResults((prev) => ({
        ...prev,
        [report.item.id]: report.evaluation.status,
      }));
      onWordCompleted(report);
    }
    setLastEval(report.evaluation);
    setLastStarsEarned(report.starsEarned);
    triggerCelebrationBurst('word');
    if (praiseTimerRef.current !== null) {
      window.clearTimeout(praiseTimerRef.current);
    }
    praiseTimerRef.current = window.setTimeout(() => {
      praiseTimerRef.current = null;
      void playPraiseAudio();
    }, 350);
    setWordPhase('word_done');
  };

  const handleBubbleTap = (bubbleKey: string, bubbleText: string) => {
    if (!currentItem) return;
    const nowMs = performance.now();
    const res = tapSyllableBubble(bubbleGate, bubbleText, {
      isOfflineMode: isOfflineFallbackActive,
      nowMs,
    });
    if (res.result === 'locked_ignored') {
      return;
    }
    setBubbleGate(res.state);

    if (res.result === 'wrong') {
      setWrongBubbleKey(bubbleKey);
      setWrongShakeTick((t) => t + 1);
      playFeedbackChime('soft-bonk');
      void playWrongFeedbackAudio();
      return;
    }

    setWrongBubbleKey(null);
    setBubbleFeedback(null);
    playFeedbackChime('pop');

    if (res.result === 'accepted_offline_pause') {
      const myGen = bubbleGenRef.current;
      const pauseWait = new Promise<void>((resolve) => {
        if (bubblePauseTimerRef.current !== null) {
          window.clearTimeout(bubblePauseTimerRef.current);
        }
        bubblePauseTimerRef.current = window.setTimeout(() => {
          bubblePauseTimerRef.current = null;
          resolve();
        }, BUBBLE_OFFLINE_PAUSE_MS);
      });
      void Promise.all([playSyllableAudio(bubbleText), pauseWait]).then(() => {
        if (bubbleGenRef.current !== myGen) return;
        setBubbleGate((prev) => {
          const next = completeOfflineSyllablePause(prev, performance.now());
          if (next.phase === 'offline_word_confirm') {
            void playInstructionAudio('instr_stage1_bubble_confirm_word');
          }
          return next;
        });
      });
      return;
    }

    void playInstructionAudio('instr_stage1_bubble_speak');
  };

  const processBubbleSpeech = async (result: MicRecordingResult) => {
    if (!currentItem) return;
    const myGen = bubbleGenRef.current;
    const isFullWordStep = bubbleGate.phase === 'awaiting_word_speech';
    const targetSpoken = isFullWordStep ? currentItem.text : (bubbleGate.activePart ?? '');
    if (!targetSpoken) return;

    const acceptAliases = isFullWordStep
      ? currentItem.accept
      : buildSyllableAcceptAliases(targetSpoken);

    setBubbleMicChecking(true);
    setBubbleFeedback(null);
    try {
      const sttResp = await verifyAudioWithStt(result.wavBlob, targetSpoken, acceptAliases);
      if (bubbleGenRef.current !== myGen) return;
      setConsecutiveSttFailures(0);
      const validation = validateSttReading({
        targetWord: targetSpoken,
        parts: isFullWordStep ? currentItem.parts : [targetSpoken],
        syllableCount: isFullWordStep ? currentItem.syllables.length : 1,
        acceptAliases,
        transcript: sttResp.transcript,
        isSilence: sttResp.is_silence,
        confidence: sttResp.confidence,
        confidenceAvailable: sttResp.confidence_available,
      });

      if (validation.decision === 'accepted' || sttResp.accepted) {
        playFeedbackChime('chime');
        const nextGate = applyBubbleSpeechResult(bubbleGate, true);
        setBubbleGate(nextGate);
        setBubbleFeedback(null);
        if (nextGate.phase === 'completed') {
          void playWordItemAudio(currentItem);
          scheduleStage2Advance(550);
        } else if (nextGate.phase === 'awaiting_word_speech') {
          void playInstructionAudio('instr_stage1_bubble_read_word');
        }
        return;
      }

      playFeedbackChime('soft-bonk');
      setBubbleGate((prev) => applyBubbleSpeechResult(prev, false));
      if (sttResp.is_silence) {
        setBubbleFeedback({
          text: 'Ovozing eshitilmadi — yana bir bor balandroq aytib ko‘r!',
          audioKey: 'fb_no_speech',
        });
        void playFeedbackAudio('fb_no_speech');
      } else {
        setBubbleFeedback({
          text: `«${targetSpoken}» ni aniqroq aytib ko‘r-chi!`,
          audioKey: 'fb_bubble_try_again',
        });
        void playFeedbackAudio('fb_bubble_try_again');
      }
    } catch {
      if (bubbleGenRef.current !== myGen) return;
      const nextFails = consecutiveSttFailures + 1;
      if (!isOfflineFallbackActive && nextFails >= 2) {
        suppressNextAutoInstrRef.current = true;
      }
      setConsecutiveSttFailures(nextFails);
      setBubbleGate((prev) => applyBubbleSpeechResult(prev, false));
      setBubbleFeedback({
        text: 'Ovoz serveri bilan aloqa uzildi — eshitib davom etamiz.',
        audioKey: 'fb_bubble_server_offline',
      });
      void playFeedbackAudio('fb_bubble_server_offline');
    } finally {
      if (bubbleGenRef.current === myGen) {
        setBubbleMicChecking(false);
      }
    }
  };

  const handleBubbleMicAutoStop = (
    reason: Exclude<MicAutoStopAction, 'continue'>,
    result: MicRecordingResult,
  ) => {
    bubbleMicRef.current = null;
    setBubbleMicRecording(false);
    setBubbleMicLevel(0);
    if (reason === 'stop_no_speech') {
      playFeedbackChime('soft-bonk');
      setBubbleGate((prev) => applyBubbleSpeechResult(prev, false));
      setBubbleFeedback({
        text: 'Ovozing eshitilmadi — yana bir bor balandroq aytib ko‘r!',
        audioKey: 'fb_no_speech',
      });
      void playFeedbackAudio('fb_no_speech');
      return;
    }
    void processBubbleSpeech(result);
  };

  const toggleBubbleMic = async () => {
    if (bubbleMicChecking || bubbleAssistBusy || !currentItem) return;
    if (!bubbleMicRecording) {
      setBubbleFeedback(null);
      try {
        const session = await startMicRecording(
          (lvl) => setBubbleMicLevel(lvl),
          handleBubbleMicAutoStop,
          SPELLING_FRIENDLY_MIC_CONFIG,
        );
        bubbleMicRef.current = session;
        setBubbleMicRecording(true);
      } catch {
        if (!isOfflineFallbackActive) {
          suppressNextAutoInstrRef.current = true;
        }
        setMicPermissionBlocked(true);
        setBubbleFeedback({
          text: 'Mikrofonga ruxsat berilmadi — ovozli pauza rejimiga o‘tamiz.',
          audioKey: 'fb_bubble_mic_blocked',
        });
        void playFeedbackAudio('fb_bubble_mic_blocked');
      }
    } else if (bubbleMicRef.current) {
      const activeSession = bubbleMicRef.current;
      bubbleMicRef.current = null;
      setBubbleMicRecording(false);
      setBubbleMicLevel(0);
      const stopped = await activeSession.stop();
      if (stopped) {
        await processBubbleSpeech(stopped);
      }
    }
  };

  const handleBubbleCoReadAssist = () => {
    if (!currentItem || bubbleAssistBusy) return;
    const isFullWordStep = bubbleGate.phase === 'awaiting_word_speech';
    const targetSpoken = isFullWordStep ? currentItem.text : (bubbleGate.activePart ?? '');
    if (!targetSpoken) return;

    const myGen = bubbleGenRef.current;
    setBubbleAssistBusy(true);
    setBubbleFeedback({
      text: `Tingla va birga ayt: «${targetSpoken}»!`,
      audioKey: 'fb_bubble_listen_repeat',
    });

    const audioPromise = (async () => {
      await playFeedbackAudio('fb_bubble_listen_repeat');
      if (bubbleGenRef.current !== myGen) return;
      if (isFullWordStep) {
        await playWordItemAudio(currentItem);
      } else {
        await playSyllableAudio(targetSpoken);
      }
    })();
    const pauseWait = new Promise<void>((resolve) => {
      if (bubblePauseTimerRef.current !== null) {
        window.clearTimeout(bubblePauseTimerRef.current);
      }
      bubblePauseTimerRef.current = window.setTimeout(() => {
        bubblePauseTimerRef.current = null;
        resolve();
      }, BUBBLE_OFFLINE_PAUSE_MS);
    });

    void Promise.all([audioPromise, pauseWait]).then(() => {
      if (bubbleGenRef.current !== myGen) return;
      setBubbleAssistBusy(false);
      setBubbleFeedback(null);
      setBubbleGate((prev) => {
        const next = applyBubbleSpeechResult(prev, true);
        if (next.phase === 'completed') {
          scheduleStage2Advance(450);
        } else if (next.phase === 'awaiting_word_speech') {
          void playInstructionAudio('instr_stage1_bubble_read_word');
        }
        return next;
      });
    });
  };

  const processRecordedSpeech = async (result: MicRecordingResult) => {
    if (!currentItem) return;
    isCheckingRef.current = true;
    setIsChecking(true);
    setExamFeedback(null);
    scaffoldingRef.current = pauseScaffoldingForSpeech(
      scaffoldingRef.current,
      performance.now(),
    );

    try {
      const resp = await verifyAudioWithStt(
        result.wavBlob,
        currentItem.text,
        currentItem.accept,
      );
      setConsecutiveSttFailures(0);

      const syllableCount =
        currentItem.kind === 'word'
          ? currentItem.syllables.length
          : countUzbekSyllables(currentItem.text);
      const wordCount =
        currentItem.kind === 'sentence' ? Math.max(1, currentItem.parts.length) : 1;

      const validation = validateSttReading({
        targetWord: currentItem.text,
        parts: currentItem.parts,
        syllableCount,
        acceptAliases: currentItem.accept,
        transcript: resp.transcript,
        isSilence: resp.is_silence,
        confidence: resp.confidence,
        confidenceAvailable: resp.confidence_available,
      });

      if (validation.decision === 'silence' || validation.decision === 'low_confidence') {
        if (lowConfRetriesRef.current < READING_THRESHOLDS.maxLowConfidenceRetries) {
          lowConfRetriesRef.current += 1;
          scaffoldingRef.current = resumeScaffoldingAfterFalseStart(
            scaffoldingRef.current,
            performance.now(),
            READING_THRESHOLDS,
          );
          if (validation.decision === 'silence') {
            setExamFeedback({
              kind: 'gentle',
              text: 'Ovozing eshitilmadi — yana bir bor balandroq aytib ko‘r!',
              audioKey: 'fb_no_speech',
            });
            void playFeedbackAudio('fb_no_speech');
          } else {
            setExamFeedback({
              kind: 'gentle',
              text: 'Yana bir bor balandroq va aniqroq aytib ko‘r!',
              audioKey: 'fb_louder_clearer',
            });
            void playFeedbackAudio('fb_louder_clearer');
          }
          return;
        }
        scaffoldingRef.current = markScaffoldingAudioHint(scaffoldingRef.current);
        setShowVisualSplit(true);
        setShowAudioHint(true);
        audioHintPlayedRef.current = true;
        setExamFeedback({
          kind: 'gentle',
          text: 'Ovoz yaxshi eshitilmadi — eshitib ko‘r, keyin yana o‘qib ber yoki «Birga aytamiz»ni bos.',
          audioKey: 'fb_listen_then_try',
        });
        void playFeedbackThenWord('fb_listen_then_try', currentItem);
        return;
      }

      if (validation.decision === 'word_collision') {
        scaffoldingRef.current = markScaffoldingAudioHint(scaffoldingRef.current);
        setShowVisualSplit(true);
        setShowAudioHint(true);
        audioHintPlayedRef.current = true;
        setExamFeedback({
          kind: 'gentle',
          text: `«${resp.transcript}» boshqa so‘zga o‘xshadi. Harflarga diqqat bilan qarab yana bir bor o‘qi!`,
          audioKey: 'fb_other_word',
        });
        void playFeedbackThenWord('fb_other_word', currentItem);
        return;
      }

      if (validation.decision === 'mismatch') {
        scaffoldingRef.current = markScaffoldingAudioHint(scaffoldingRef.current);
        setShowVisualSplit(true);
        setShowAudioHint(true);
        audioHintPlayedRef.current = true;
        setExamFeedback({
          kind: 'gentle',
          text: 'Yaxshi harakat! Quloq solib, bo‘g‘inlarga qarab yana bir marta o‘qib ko‘r.',
          audioKey: 'fb_try_syllables',
        });
        void playFeedbackThenWord('fb_try_syllables', currentItem);
        return;
      }

      const durations = computeReadingDurations({
        examRenderTimeMs: scaffoldingRef.current.examRenderTimeMs,
        recordingStartWallMs: result.recordingStartWallMs,
        firstSpeechMs: result.firstSpeechMs,
        lastSpeechMs: result.lastSpeechMs,
        audioDurationMs: result.durationMs,
      });

      const evaluation = evaluateReadingAttempt({
        syllableCount,
        wordCount,
        reactionMs: durations.reactionMs,
        articulationMs: durations.articulationMs,
        usedVisualSplit: scaffoldingRef.current.usedVisualSplit,
        usedAudioHint: scaffoldingRef.current.usedAudioHint,
        spokenCadence: validation.cadence,
        isCorrect: true,
        previousStatus: currentProgress?.status,
        previousIntervalDays: currentProgress?.reviewIntervalDays,
        previousFluentStreak: currentProgress?.fluentStreak,
      });

      const starsEarned =
        evaluation.status === 'mastered' ? 3 : evaluation.status === 'syllable' ? 2 : 1;

      finishCurrentWord({
        item: currentItem,
        evaluation,
        reactionMs: durations.reactionMs,
        articulationMs: durations.articulationMs,
        latencyMs: resp.latency_ms,
        usedVoiceAi: true,
        starsEarned,
      });
    } catch {
      scaffoldingRef.current = resumeScaffoldingAfterFalseStart(
        scaffoldingRef.current,
        performance.now(),
        READING_THRESHOLDS,
      );
      const nextFails = consecutiveSttFailures + 1;
      if (!isOfflineFallbackActive && nextFails >= 2) {
        suppressNextAutoInstrRef.current = true;
      }
      setConsecutiveSttFailures(nextFails);
      setExamFeedback({
        kind: 'gentle',
        text: 'Ovoz serveri bilan aloqa uzildi. Rasm tanlash orqali davom etamiz.',
        audioKey: 'fb_server_offline_pic',
      });
      void playFeedbackAudio('fb_server_offline_pic');
    } finally {
      isCheckingRef.current = false;
      setIsChecking(false);
    }
  };

  const handleMicAutoStop = (
    reason: Exclude<MicAutoStopAction, 'continue'>,
    result: MicRecordingResult,
  ) => {
    micRef.current = null;
    setIsRecording(false);
    setMicLevel(0);

    if (reason === 'stop_no_speech') {
      if (lowConfRetriesRef.current < READING_THRESHOLDS.maxLowConfidenceRetries) {
        lowConfRetriesRef.current += 1;
        scaffoldingRef.current = resumeScaffoldingAfterFalseStart(
          scaffoldingRef.current,
          performance.now(),
          READING_THRESHOLDS,
        );
        setExamFeedback({
          kind: 'gentle',
          text: 'Ovozing eshitilmadi — yana bir bor balandroq aytib ko‘r!',
          audioKey: 'fb_no_speech',
        });
        void playFeedbackAudio('fb_no_speech');
      } else {
        scaffoldingRef.current = markScaffoldingAudioHint(scaffoldingRef.current);
        setShowVisualSplit(true);
        setShowAudioHint(true);
        setExamFeedback({
          kind: 'gentle',
          text: 'Keling, so‘zni birga eshitib o‘qiymiz!',
          audioKey: 'fb_listen_together',
        });
        if (currentItem && !audioHintPlayedRef.current) {
          audioHintPlayedRef.current = true;
          void playFeedbackThenWord('fb_listen_together', currentItem);
        } else {
          void playFeedbackAudio('fb_listen_together');
        }
      }
      return;
    }

    void processRecordedSpeech(result);
  };

  const toggleRecording = async () => {
    if (isChecking || wordPhase !== 'exam') return;
    if (!isRecording) {
      setExamFeedback(null);
      try {
        const micConfig =
          currentItem?.kind === 'sentence'
            ? SENTENCE_FRIENDLY_MIC_CONFIG
            : SPELLING_FRIENDLY_MIC_CONFIG;
        const session = await startMicRecording(
          (lvl) => setMicLevel(lvl),
          handleMicAutoStop,
          micConfig,
          (wallTimeMs) => {
            scaffoldingRef.current = pauseScaffoldingForSpeech(scaffoldingRef.current, wallTimeMs);
          },
        );
        micRef.current = session;
        setIsRecording(true);
      } catch {
        if (!isOfflineFallbackActive) {
          suppressNextAutoInstrRef.current = true;
        }
        setMicPermissionBlocked(true);
        setExamFeedback({
          kind: 'gentle',
          text: 'Mikrofonga ruxsat berilmadi — mos rasmni tanlash rejimiga o‘tamiz.',
          audioKey: 'fb_mic_blocked_pic',
        });
        void playFeedbackAudio('fb_mic_blocked_pic');
      }
    } else if (micRef.current) {
      const activeSession = micRef.current;
      micRef.current = null;
      setIsRecording(false);
      setMicLevel(0);
      const stopped = await activeSession.stop();
      if (stopped) {
        await processRecordedSpeech(stopped);
      }
    }
  };

  const handleExamAudioAssist = () => {
    if (!currentItem || wordPhase !== 'exam') return;
    scaffoldingRef.current = markScaffoldingAudioHint(scaffoldingRef.current);
    setShowVisualSplit(true);
    setShowAudioHint(true);
    audioHintPlayedRef.current = true;
    void playWordItemAudio(currentItem);

    const syllableCount =
      currentItem.kind === 'word'
        ? currentItem.syllables.length
        : countUzbekSyllables(currentItem.text);
    const wordCount =
      currentItem.kind === 'sentence' ? Math.max(1, currentItem.parts.length) : 1;

    const evaluation = evaluateReadingAttempt({
      syllableCount,
      wordCount,
      reactionMs: Math.round(performance.now() - examRenderStartRef.current),
      articulationMs: 0,
      usedVisualSplit: true,
      usedAudioHint: true,
      isCorrect: true,
    });

    finishCurrentWord({
      item: currentItem,
      evaluation,
      reactionMs: Math.round(performance.now() - examRenderStartRef.current),
      articulationMs: 0,
      latencyMs: null,
      usedVoiceAi: false,
      starsEarned: 1,
    });
  };

  const handleOfflineEmojiChoice = (chosenEmoji: string) => {
    if (!currentItem || wordPhase !== 'exam') return;
    if (chosenEmoji !== currentItem.emoji) {
      if (!offlineWrongEmojis.includes(chosenEmoji)) {
        setOfflineWrongEmojis((prev) => [...prev, chosenEmoji]);
      }
      setWrongShakeTick((t) => t + 1);
      playFeedbackChime('soft-bonk');
      void playFeedbackAudio('fb_offline_look_again');
      setExamFeedback({
        kind: 'gentle',
        text: 'Yana bir bor so‘zni diqqat bilan o‘qib ko‘r-chi!',
        audioKey: 'fb_offline_look_again',
      });
      return;
    }

    const reactionMs = Math.max(250, Math.round(performance.now() - examRenderStartRef.current));
    const syllableCount =
      currentItem.kind === 'word'
        ? currentItem.syllables.length
        : countUzbekSyllables(currentItem.text);
    const wordCount =
      currentItem.kind === 'sentence' ? Math.max(1, currentItem.parts.length) : 1;

    const evaluation = evaluateReadingAttempt({
      syllableCount,
      wordCount,
      reactionMs,
      articulationMs: 0,
      usedVisualSplit: scaffoldingRef.current.usedVisualSplit,
      usedAudioHint: scaffoldingRef.current.usedAudioHint,
      isOfflineFallback: true,
      offlineWrongTaps: offlineWrongEmojis.length,
      isCorrect: true,
      previousOfflineStreak: currentProgress?.offlineCorrectStreak ?? 0,
    });

    finishCurrentWord({
      item: currentItem,
      evaluation,
      reactionMs,
      articulationMs: 0,
      latencyMs: null,
      usedVoiceAi: false,
      starsEarned: 1,
    });
  };

  const handleAdvanceRound = () => {
    playFeedbackChime('pop');
    if (wordIdx + 1 < sessionItems.length) {
      setWordIdx((prev) => prev + 1);
    } else {
      triggerCelebrationBurst('round');
      if (praiseTimerRef.current !== null) {
        window.clearTimeout(praiseTimerRef.current);
      }
      praiseTimerRef.current = window.setTimeout(() => {
        praiseTimerRef.current = null;
        void playPraiseAudio('round_complete');
      }, 800);
      setRoundFinished(true);
    }
  };

  if (!currentItem || !currentSession) {
    return (
      <div className="lesson-immersive-shell">
        <StorybookBackdrop />
        <div className="lesson-card-white" style={{ maxWidth: 480, margin: '80px auto', textAlign: 'center' }}>
          <p className="onboarding-text">Bu olamda mashq uchun so‘zlar topilmadi.</p>
          <button type="button" className="btn-3d-emerald" onClick={onBack}>
            Bosh sahifaga
          </button>
        </div>
      </div>
    );
  }

  // Mockup 10: Victory / Sessiya yakuni
  if (roundFinished) {
    return (
      <div className="victory-screen-shell">
        <StorybookBackdrop />

        <header className="victory-topbar">
          <button type="button" className="brand" onClick={onBack}>
            <img src="/images/logo.webp" alt="Alifbo" className="brand-logo-img" draggable={false} />
          </button>
        </header>

        <main className="victory-card-stage">
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            className="victory-card"
          >
            {/* 3 Fanned Giant Golden Stars */}
            <div className="victory-stars-fan" aria-hidden="true">
              {([-18, 0, 18] as const).map((rot, idx) => (
                <motion.div
                  key={idx}
                  initial={{ scale: 0, y: 24, rotate: rot }}
                  animate={{ scale: idx === 1 ? 1.18 : 0.96, y: idx === 1 ? -10 : 4, rotate: rot }}
                  transition={{
                    type: 'spring',
                    stiffness: 340,
                    damping: 14,
                    delay: 0.1 + idx * 0.1,
                  }}
                  className="victory-star-wrap"
                >
                  <Star size={54} fill="#FBBF24" color="#D97706" strokeWidth={2.2} />
                </motion.div>
              ))}
            </div>

            <div className="victory-mascot-wrap">
              <AnimatedCharacter
                mood="celebrating"
                size={156}
                avatarId={avatar.id}
                bubblePosition="none"
              />
            </div>

            <h1 className="victory-headline">Barakalla! Ajoyib natija!</h1>

            <div className="victory-metrics-row">
              <span className="stars-pill-3d victory-metric-pill">
                <Star size={18} fill="#F59E0B" color="#B45309" />
                <span>+{roundStars} Yulduz</span>
              </span>
              <span className="victory-words-pill">
                {sessionItems.length} / {sessionItems.length} so‘z
              </span>
            </div>

            <div className="round-summary-words victory-words-list">
              {sessionItems.map(({ item }) => {
                const st = completedResults[item.id] ?? 'assisted';
                return (
                  <span key={item.id} className={`round-word-pill status-badge-${st}`}>
                    <GameVisual emoji={item.emoji} wordId={item.id} alt={item.text} size={20} />
                    <span>{item.text}</span>
                  </span>
                );
              })}
            </div>

            {!aiOnline && (
              <p className="muted-text" style={{ margin: 0, fontSize: 13 }}>
                Ota-ona uchun: natijalarni «Ota-ona → Diagnostika» bo‘limida tasdiqlashingiz mumkin.
              </p>
            )}

            <div className="victory-actions">
              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                className="btn-3d-emerald victory-continue-btn btn-with-icon"
                onClick={() => {
                  playFeedbackChime('pop');
                  recordedIdsRef.current.clear();
                  setCompletedResults({});
                  setWordIdx(0);
                  setRetryIndex((n) => n + 1);
                  setRoundStars(0);
                  setRoundFinished(false);
                  onPlayAnotherRound();
                }}
              >
                <RotateCcw size={20} />
                <span>Davom etish!</span>
              </motion.button>

              <button
                type="button"
                className="btn-3d-cream btn-compact btn-with-icon"
                onClick={() => {
                  playFeedbackChime('pop');
                  onBack();
                }}
              >
                <Home size={16} />
                <span>Bosh sahifaga</span>
              </button>
            </div>
          </motion.div>
        </main>
      </div>
    );
  }

  const progressPct = Math.round(
    ((wordIdx + (wordPhase === 'word_done' ? 1 : 0.4)) / sessionItems.length) * 100,
  );

  const stagePrompt = (() => {
    if (wordPhase === 'stage1_build') {
      if (buildGameMode === 'train') return 'Slayderni surib bo‘g‘inlarni birlashtir!';
      if (buildGameMode === 'sentence_builder') return 'So‘zlarni to‘g‘ri tartibda ter!';
      return buildGameMode === 'constructor'
        ? 'Qaysi bo‘g‘in mos?'
        : 'Bo‘g‘in pufakchalarini yor!';
    }
    if (wordPhase === 'stage2_spotlight') {
      return currentItem.kind === 'sentence'
        ? 'Gapni o‘qib mos rasmni top!'
        : 'Bo‘g‘inlarni o‘qib mos rasmni top!';
    }
    if (wordPhase === 'exam') {
      if (isOfflineFallbackActive) {
        return currentItem.kind === 'sentence'
          ? 'Gapni o‘qi va mos rasmni tanla!'
          : 'So‘zni o‘qi va mos rasmni tanla!';
      }
      if (isRecording) return 'Tinglayapman... bemalol o‘qi!';
      if (examFeedback?.kind === 'gentle') return 'Yana bir bor urinib ko‘r!';
      return 'Barakalla! Endi o‘zing o‘qi!';
    }
    return lastEval?.status === 'mastered'
      ? `Barakalla! «${currentItem.text}» ni ravon o‘qiding!`
      : `Ajoyib urinish! «${currentItem.text}» mashq qilindi!`;
  })();

  const charMoodForScreen =
    wordPhase === 'word_done'
      ? 'celebrating'
      : wrongShakeTick > 0 && (wrongPart !== null || wrongBubbleKey !== null || offlineWrongEmojis.length > 0 || wrongSpotlightEmoji !== null || wrongSentenceKey !== null)
        ? 'encouraging'
        : isRecording || bubbleMicRecording
          ? 'listening'
          : examFeedback?.kind === 'gentle'
            ? 'encouraging'
            : wordPhase === 'exam'
              ? 'speaking'
              : 'idle';

  const splitParts = getVisualSplitParts(currentItem);
  const currentInstructionKey = getLessonInstructionKey({
    wordPhase,
    buildGameMode,
    itemKind: currentItem.kind,
    isOfflineFallbackActive,
  });

  const replayActiveInstruction = () => {
    if (currentInstructionKey) {
      void playInstructionAudio(currentInstructionKey);
    } else {
      void playPraiseAudio();
    }
  };

  return (
    <div className="lesson-immersive-shell">
      <StorybookBackdrop />

      {/* Top HUD Bar matching Mockups 07, 08, 09, 12 */}
      <header className="lesson-hud-bar" aria-label={worldTitle}>
        <button
          type="button"
          className="btn-circle-close-coral"
          onClick={() => {
            playFeedbackChime('pop');
            onBack();
          }}
          aria-label="O‘yindan chiqish"
        >
          <CloseIcon size={22} />
        </button>

        <div
          className="lesson-hud-progress-track"
          role="progressbar"
          aria-label="Mashq jarayoni"
          aria-valuenow={wordIdx + 1}
          aria-valuemin={1}
          aria-valuemax={sessionItems.length}
        >
          <motion.div
            className="lesson-hud-progress-fill"
            animate={{ width: `${progressPct}%` }}
            transition={{ type: 'spring', stiffness: 220, damping: 24 }}
          >
            <span className="lesson-hud-progress-gloss" aria-hidden="true" />
          </motion.div>
        </div>

        <span className="stars-pill-3d lesson-hud-counter">
          <Star size={17} fill="#F59E0B" color="#B45309" />
          <span>
            {wordIdx + 1} / {sessionItems.length}
          </span>
        </span>
      </header>

      <main className="lesson-stage-main">
        <motion.div
          key={`${currentItem.id}-${wordPhase}`}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22 }}
          className="lesson-stage-inner"
        >
          {/* STAGE 1: BUILD */}
          {wordPhase === 'stage1_build' && (
            <div className="stage1-shell">
              <div className="lesson-mode-heading-row">
                <span className="step-pill-tag">
                  {buildGameMode === 'train'
                    ? 'Bo‘g‘in poyezdi'
                    : buildGameMode === 'sentence_builder'
                      ? 'Gap tuzish'
                      : buildGameMode === 'constructor'
                        ? 'Konstruktor'
                        : 'Pufakchalar'}
                </span>
              </div>

              {buildGameMode === 'constructor' ? (
                <LayoutGroup id={`ctor-${currentItem.id}`}>
                  <div className="constructor-layout">
                    <div className="lesson-card-white constructor-main-card">
                      <motion.div
                        animate={{ y: [0, -5, 0] }}
                        transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
                        className="constructor-illustration"
                      >
                        <GameVisual
                          emoji={currentItem.emoji}
                          wordId={currentItem.id}
                          alt={currentItem.text}
                          size={124}
                        />
                      </motion.div>

                      <div className="constructor-slots-row">
                        {currentItem.parts.slice(0, -1).map((part, idx) => (
                          <LetterBlock
                            key={`pre-${part}-${idx}`}
                            text={part}
                            size="lg"
                            variant="sky-cube"
                            onLetterTap={handleTapLetterRecall}
                          />
                        ))}

                        <div
                          className={`constructor-drop-slot ${
                            pickedMissingPart ? 'constructor-slot-filled' : ''
                          }`}
                        >
                          {pickedMissingPart ? (
                            <motion.span
                              layoutId={`ctor-tile-${currentItem.id}-${pickedMissingPart}`}
                              transition={{ type: 'spring', stiffness: 380, damping: 24 }}
                              className="constructor-landed-tile"
                            >
                              {pickedMissingPart}
                            </motion.span>
                          ) : (
                            <span className="constructor-qmark" aria-hidden="true">
                              ?
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Choices row (Thumb Zone on Mobile) */}
                    <div className="constructor-choices-thumbzone">
                      <div className="constructor-choices-row">
                        {constructorChoices.map((part, idx) => {
                          const targetLast = currentItem.parts[currentItem.parts.length - 1] ?? '';
                          const isPicked = pickedMissingPart === part;
                          const isWrong = wrongPart === part;
                          const colorCls =
                            CONSTRUCTOR_BTN_CLASSES[idx % CONSTRUCTOR_BTN_CLASSES.length] ??
                            'cube-btn-orange';

                          return (
                            <div key={part} className="constructor-choice-slot">
                              {!isPicked ? (
                                <motion.button
                                  type="button"
                                  layoutId={`ctor-tile-${currentItem.id}-${part}`}
                                  whileHover={{ y: -3, scale: 1.04 }}
                                  whileTap={{ y: 3, scale: 0.94 }}
                                  animate={
                                    isWrong
                                      ? { x: [0, -10, 10, -7, 7, -3, 0] }
                                      : { x: 0 }
                                  }
                                  transition={{
                                    type: 'spring',
                                    stiffness: 420,
                                    damping: 22,
                                  }}
                                  className={`constructor-3d-cube ${colorCls} ${
                                    isWrong ? 'choice-wrong-cube' : ''
                                  }`}
                                  onClick={() => {
                                    if (part === targetLast) {
                                      setPickedMissingPart(part);
                                      setWrongPart(null);
                                      playFeedbackChime('chime');
                                      scheduleStage2Advance(540);
                                    } else {
                                      setWrongPart(part);
                                      setWrongShakeTick((t) => t + 1);
                                      playFeedbackChime('soft-bonk');
                                      void playWrongFeedbackAudio();
                                    }
                                  }}
                                >
                                  {part}
                                </motion.button>
                              ) : (
                                <div className="constructor-choice-placeholder" aria-hidden="true" />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="lesson-zukko-corner">
                      <AnimatedCharacter
                        mood={charMoodForScreen}
                        size={112}
                        avatarId={avatar.id}
                        layout="row"
                        bubblePosition="right"
                        speechText={stagePrompt}
                        onReplaySpeech={replayActiveInstruction}
                      />
                    </div>
                  </div>
                </LayoutGroup>
              ) : buildGameMode === 'train' ? (
                <div className="lesson-card-white lesson-centered-card">
                  <AnimatedCharacter
                    mood={charMoodForScreen}
                    size={96}
                    avatarId={avatar.id}
                    layout="row"
                    bubblePosition="right"
                    speechText={stagePrompt}
                    onReplaySpeech={replayActiveInstruction}
                  />

                  <motion.div
                    animate={{ y: [0, -6, 0] }}
                    transition={{ duration: 2.2, repeat: Infinity }}
                    className="big-target-emoji"
                  >
                    <GameVisual
                      emoji={currentItem.emoji}
                      wordId={currentItem.id}
                      alt={currentItem.text}
                      size={96}
                    />
                  </motion.div>

                  <div
                    className={`blend-track-box ${
                      blendProgress >= 90 ? 'blend-track-complete' : ''
                    }`}
                  >
                    <div
                      className="train-cars-stage"
                      style={{
                        gap: `${Math.max(0, Math.round((100 - blendProgress) * 0.42))}px`,
                      }}
                    >
                      <span className="train-locomotive" aria-hidden="true">
                        🚂
                      </span>
                      {currentItem.parts.map((part, idx) => (
                        <span key={`train-${part}-${idx}`} className="train-car-item">
                          <LetterBlock
                            text={part}
                            size="lg"
                            highlighted={blendProgress >= 90}
                            onLetterTap={handleTapLetterRecall}
                          />
                        </span>
                      ))}
                    </div>
                    {blendProgress >= 90 && (
                      <span className="blend-celebration-pill">
                        <Sparkles size={16} />
                        <span>{currentItem.text}!</span>
                      </span>
                    )}
                  </div>

                  <div className="slider-wrap train-slider-box">
                    <div className="slider-label">
                      <span>Ajratib o‘qish</span>
                      <strong className="merged-preview">
                        {blendProgress >= 90 ? currentItem.text : 'Birga →'}
                      </strong>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={blendProgress}
                      aria-label="Bo‘g‘inlarni ulash slayderi"
                      className="blend-slider"
                      onChange={(e) => handleBlendSliderChange(Number(e.target.value))}
                    />
                    <button
                      type="button"
                      className="btn-3d-emerald btn-compact"
                      style={{ marginTop: 10 }}
                      disabled={blendProgress >= 90}
                      onClick={() => {
                        playFeedbackChime('pop');
                        handleBlendSliderChange(100);
                      }}
                    >
                      Birlashtirish
                    </button>
                  </div>
                </div>
              ) : buildGameMode === 'sentence_builder' ? (
                <LayoutGroup id={`sent-${currentItem.id}`}>
                  <div className="lesson-card-white lesson-centered-card">
                    <AnimatedCharacter
                      mood={charMoodForScreen}
                      size={94}
                      avatarId={avatar.id}
                      layout="row"
                      bubblePosition="right"
                      speechText={stagePrompt}
                      onReplaySpeech={replayActiveInstruction}
                    />

                    <motion.div
                      animate={{ y: [0, -5, 0] }}
                      transition={{ duration: 2.2, repeat: Infinity }}
                      className="big-target-emoji"
                    >
                      <GameVisual
                        emoji={currentItem.emoji}
                        wordId={currentItem.id}
                        alt={currentItem.text}
                        size={96}
                      />
                    </motion.div>

                    <div className="sentence-slots-row" aria-label="Tuzilayotgan gap">
                      {currentItem.parts.map((part, idx) => {
                        const placedKey = placedSentenceKeys[idx];
                        return (
                          <span
                            key={`slot-${idx}-${part}`}
                            className={`sentence-slot-chip ${
                              placedKey ? 'sentence-slot-filled' : ''
                            }`}
                          >
                            {placedKey ? (
                              <motion.span
                                layoutId={`sent-word-${currentItem.id}-${placedKey}`}
                                transition={{ type: 'spring', stiffness: 360, damping: 24 }}
                              >
                                {part}
                              </motion.span>
                            ) : (
                              `${idx + 1}. ___`
                            )}
                          </span>
                        );
                      })}
                    </div>

                    {sentenceHint && (
                      <button
                        type="button"
                        className="feedback-banner feedback-gentle feedback-banner-clickable"
                        onClick={() => void playFeedbackAudio(sentenceHint.audioKey)}
                      >
                        <Volume2 size={16} />
                        <span>{sentenceHint.text}</span>
                      </button>
                    )}

                    <div className="sentence-word-bank">
                      {sentenceBank.map((tile) => {
                        const isUsed = placedSentenceKeys.includes(tile.key);
                        const isWrong = wrongSentenceKey === tile.key;
                        const expectedWord = currentItem.parts[placedSentenceKeys.length] ?? '';
                        return (
                          <motion.button
                            key={tile.key}
                            type="button"
                            disabled={isUsed}
                            whileHover={{ scale: isUsed ? 1 : 1.04 }}
                            whileTap={{ scale: 0.94 }}
                            animate={isWrong ? { x: [0, -8, 8, -5, 5, 0] } : { x: 0 }}
                            className={`sentence-word-tile ${
                              isUsed ? 'choice-correct' : isWrong ? 'choice-wrong' : ''
                            }`}
                            onClick={() => {
                              if (!tile.isDistractor && tile.text === expectedWord) {
                                const nextPlaced = [...placedSentenceKeys, tile.key];
                                setPlacedSentenceKeys(nextPlaced);
                                setWrongSentenceKey(null);
                                setSentenceHint(null);
                                playFeedbackChime('pop');
                                if (nextPlaced.length >= currentItem.parts.length) {
                                  playFeedbackChime('chime');
                                  void playWordItemAudio(currentItem);
                                  scheduleStage2Advance(600);
                                }
                              } else {
                                setWrongSentenceKey(tile.key);
                                setWrongShakeTick((t) => t + 1);
                                setSentenceHint({
                                  text: 'So‘zlarni to‘g‘ri tartibda joylashtirib ko‘r!',
                                  audioKey: 'fb_sentence_order',
                                });
                                playFeedbackChime('soft-bonk');
                                void playFeedbackAudio('fb_sentence_order');
                              }
                            }}
                          >
                            {tile.text}
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>
                </LayoutGroup>
              ) : (
                <div className="lesson-card-white lesson-centered-card">
                  <AnimatedCharacter
                    mood={charMoodForScreen}
                    size={94}
                    avatarId={avatar.id}
                    layout="row"
                    bubblePosition="right"
                    speechText={stagePrompt}
                    onReplaySpeech={replayActiveInstruction}
                  />

                  <div className="bubble-mystery-badge">
                    Bo‘g‘inlab o‘qing ({bubbleGate.confirmedCount}/{bubbleGate.parts.length})
                  </div>

                  <div className="bubble-assembled-row">
                    {currentItem.parts.map((part, idx) => (
                      <span
                        key={`assembled-${part}-${idx}`}
                        className={`assembled-chip ${
                          idx < bubbleGate.confirmedCount
                            ? 'assembled-chip-done'
                            : bubbleGate.activePart === part && idx === bubbleGate.confirmedCount
                              ? 'assembled-chip-active'
                              : ''
                        }`}
                      >
                        {idx < bubbleGate.confirmedCount ||
                        (idx === bubbleGate.confirmedCount && bubbleGate.activePart === part)
                          ? part
                          : '•••'}
                      </span>
                    ))}
                  </div>

                  {bubbleGate.phase !== 'offline_word_confirm' &&
                    bubbleGate.phase !== 'awaiting_word_speech' && (
                      <div className="bubbles-field">
                        {bubbleChoices.map((bubble, idx) => {
                          const isAlreadyPopped =
                            bubble.key.startsWith('target-') &&
                            Number(bubble.key.split('-')[1]) < bubbleGate.confirmedCount;
                          const isLocked = bubbleGate.phase !== 'pick_bubble';
                          const isWrong = wrongBubbleKey === bubble.key;
                          return (
                            <motion.button
                              key={bubble.key}
                              type="button"
                              disabled={isAlreadyPopped || isLocked}
                              animate={
                                isAlreadyPopped
                                  ? { scale: 0.8, opacity: 0.3 }
                                  : isWrong
                                    ? { x: [0, -9, 9, -6, 6, 0] }
                                    : isLocked
                                      ? { opacity: 0.55 }
                                      : { y: [0, idx % 2 === 0 ? -7 : 7, 0] }
                              }
                              transition={{
                                duration: isWrong ? 0.32 : 2.4,
                                repeat: isAlreadyPopped || isLocked || isWrong ? 0 : Infinity,
                              }}
                              whileTap={isLocked ? undefined : { scale: 1.12 }}
                              className={`syllable-bubble ${isWrong ? 'bubble-shake' : ''}`}
                              onClick={() => handleBubbleTap(bubble.key, bubble.text)}
                            >
                              {bubble.text}
                            </motion.button>
                          );
                        })}
                      </div>
                    )}

                  <div className="bubble-bottom-slot">
                    {bubbleGate.phase === 'pick_bubble' && (
                      <p className="bubble-pick-hint">Bo‘g‘in pufakchalarini tartib bilan yor!</p>
                    )}

                    {bubbleGate.phase === 'audio_pause' && bubbleGate.activePart && (
                      <div
                        className="bubble-gate-panel bubble-pause-panel"
                        role="status"
                        aria-live="polite"
                      >
                        <strong>«{bubbleGate.activePart}» — ovoz chiqarib qaytar!</strong>
                        <div className="bubble-pause-bar" aria-hidden="true">
                          <motion.div
                            key={`pause-${bubbleGate.confirmedCount}-${bubbleGate.activePart}`}
                            className="bubble-pause-fill"
                            initial={{ width: '0%' }}
                            animate={{ width: '100%' }}
                            transition={{ duration: BUBBLE_OFFLINE_PAUSE_MS / 1000, ease: 'linear' }}
                          />
                        </div>
                      </div>
                    )}

                    {(bubbleGate.phase === 'awaiting_syllable_speech' ||
                      bubbleGate.phase === 'awaiting_word_speech') && (
                      <div className="bubble-gate-panel">
                        <strong>
                          {bubbleGate.phase === 'awaiting_word_speech'
                            ? `Endi yig‘ilgan so‘zni o‘qi: «${currentItem.text}»`
                            : `Ochilgan bo‘g‘inni ovoz chiqarib ayt: «${bubbleGate.activePart}»`}
                        </strong>

                        {bubbleFeedback && (
                          <button
                            type="button"
                            className="feedback-banner feedback-gentle feedback-banner-clickable"
                            onClick={() => void playFeedbackAudio(bubbleFeedback.audioKey)}
                          >
                            <Volume2 size={16} />
                            <span>{bubbleFeedback.text}</span>
                          </button>
                        )}

                        <div className="voice-controls">
                          <button
                            type="button"
                            disabled={bubbleMicChecking || bubbleAssistBusy}
                            className={`btn-mic-circle ${
                              bubbleMicRecording ? 'btn-mic-circle-active' : ''
                            }`}
                            onClick={() => void toggleBubbleMic()}
                            aria-label={
                              bubbleMicChecking
                                ? 'Tekshirilmoqda'
                                : bubbleMicRecording
                                  ? 'Gapirib bo‘ldim'
                                  : 'Mikrofonga aytish'
                            }
                          >
                            {bubbleMicRecording ? (
                              <Square size={28} fill="currentColor" />
                            ) : (
                              <Mic size={32} />
                            )}
                          </button>
                          <span className="mic-caption">
                            {bubbleMicChecking
                              ? 'Tekshirilmoqda...'
                              : bubbleMicRecording
                                ? 'Gapirib bo‘lgach bosing'
                                : bubbleGate.phase === 'awaiting_word_speech'
                                  ? `«${currentItem.text}» deb ayt`
                                  : `«${bubbleGate.activePart}» deb ayt`}
                          </span>

                          {bubbleMicRecording && (
                            <div className="mic-meter" aria-label="Mikrofon ovoz darajasi">
                              <div
                                className="mic-meter-fill"
                                style={{ width: `${Math.round(bubbleMicLevel * 100)}%` }}
                              />
                            </div>
                          )}

                          {(bubbleGate.speechFailuresInStep >= 2 || isOfflineFallbackActive) && (
                            <button
                              type="button"
                              disabled={bubbleAssistBusy}
                              className="btn-3d-cream btn-compact btn-with-icon"
                              onClick={handleBubbleCoReadAssist}
                            >
                              <Volume2 size={16} />
                              <span>Eshitib, birga aytamiz</span>
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {bubbleGate.phase === 'offline_word_confirm' && (
                      <div className="bubble-gate-panel">
                        <strong>Zo‘r! Endi «{currentItem.text}» so‘ziga mos rasmni tanla:</strong>
                        <div className="emoji-choices-row bubble-confirm-grid">
                          {spotlightEmojiChoices.map((emoji) => {
                            const isWrong = wrongBubblePicEmoji === emoji;
                            return (
                              <motion.button
                                key={`bubble-confirm-${emoji}`}
                                type="button"
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.92 }}
                                animate={isWrong ? { x: [0, -8, 8, -5, 5, 0] } : { x: 0 }}
                                className={`emoji-choice-btn ${isWrong ? 'choice-wrong' : ''}`}
                                onClick={() => {
                                  const isCorrect = emoji === currentItem.emoji;
                                  const next = confirmOfflineBubblePicture(bubbleGate, isCorrect);
                                  setBubbleGate(next);
                                  if (isCorrect) {
                                    setWrongBubblePicEmoji(null);
                                    playFeedbackChime('chime');
                                    void playWordItemAudio(currentItem);
                                    scheduleStage2Advance(650);
                                  } else {
                                    setWrongBubblePicEmoji(emoji);
                                    setWrongShakeTick((t) => t + 1);
                                    playFeedbackChime('soft-bonk');
                                    void playWrongFeedbackAudio();
                                  }
                                }}
                                aria-label={
                                  emoji === currentItem.emoji ? `${currentItem.text} rasmi` : 'Rasm varianti'
                                }
                              >
                                <GameVisual
                                  emoji={emoji}
                                  wordId={emoji === currentItem.emoji ? currentItem.id : undefined}
                                  alt={emoji === currentItem.emoji ? currentItem.text : undefined}
                                  size={68}
                                />
                              </motion.button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <button
                type="button"
                className="audio-tip-pill btn-with-icon"
                onClick={() => {
                  playFeedbackChime('pop');
                  void playInstructionAudio('instr_letter_help_tip');
                }}
              >
                <Volume2 size={15} />
                <span>
                  {buildGameMode === 'constructor'
                    ? 'Bo‘g‘inni unutdingmi? Istalgan harf ustiga bos!'
                    : 'Harfni unutdingmi? Istalgan harf ustiga bos!'}
                </span>
              </button>
            </div>
          )}

          {/* STAGE 2: SPOTLIGHT */}
          {wordPhase === 'stage2_spotlight' && (
            <div className="lesson-card-white lesson-centered-card">
              <span className="step-pill-tag">2-bosqich · Mustahkamlash (Fonarcha)</span>

              <AnimatedCharacter
                mood={charMoodForScreen}
                size={96}
                avatarId={avatar.id}
                layout="row"
                bubblePosition="right"
                speechText={stagePrompt}
                onReplaySpeech={replayActiveInstruction}
              />

              <div className="spotlight-stage">
                {currentItem.parts.map((part, idx) => {
                  const isLit = idx <= spotlightIndex;
                  return (
                    <motion.div
                      key={`${part}-${idx}`}
                      animate={{
                        scale: idx === spotlightIndex ? 1.09 : 1,
                        opacity: isLit ? 1 : 0.45,
                      }}
                      transition={{ type: 'spring', stiffness: 320, damping: 20 }}
                    >
                      <LetterBlock
                        text={part}
                        size="xl"
                        highlighted={idx === spotlightIndex}
                        onLetterTap={handleTapLetterRecall}
                      />
                    </motion.div>
                  );
                })}
              </div>

              <div className="aux-voice-row">
                <button
                  type="button"
                  className="btn-3d-gold btn-compact"
                  onClick={() => {
                    const nextIdx =
                      spotlightIndex + 1 < currentItem.parts.length
                        ? spotlightIndex + 1
                        : currentItem.parts.length - 1;
                    setSpotlightIndex(nextIdx);
                    playFeedbackChime('pop');
                    if (currentItem.kind === 'sentence' && nextIdx === currentItem.parts.length - 1) {
                      void playInstructionAudio(getSentenceComprehensionAudioKey(currentItem));
                    }
                  }}
                >
                  {currentItem.kind === 'sentence' ? 'Keyingi so‘z' : 'Keyingi bo‘g‘in'} (
                  {Math.min(spotlightIndex + 1, currentItem.parts.length)}/
                  {currentItem.parts.length})
                </button>
                <button
                  type="button"
                  className="btn-3d-cream btn-compact btn-with-icon"
                  onClick={() => void playWordItemAudio(currentItem)}
                >
                  <Volume2 size={16} />
                  <span>{currentItem.kind === 'sentence' ? 'Gapni eshitish' : 'So‘zni eshitish'}</span>
                </button>
              </div>

              <button
                type="button"
                className="game-instruction-sub audio-tip-pill btn-with-icon"
                onClick={() => {
                  playFeedbackChime('pop');
                  void playInstructionAudio(
                    currentItem.kind === 'sentence'
                      ? getSentenceComprehensionAudioKey(currentItem)
                      : 'instr_stage2_spotlight_word',
                  );
                }}
              >
                <Volume2 size={15} />
                <span>
                  {currentItem.kind === 'sentence'
                    ? getSentenceComprehensionPromptUz(currentItem)
                    : 'O‘qigan so‘zingga mos rasmni tanla:'}
                </span>
              </button>

              <div className="emoji-choices-row">
                {spotlightEmojiChoices.map((emoji) => {
                  const isWrong = wrongSpotlightEmoji === emoji;
                  return (
                    <motion.button
                      key={emoji}
                      type="button"
                      whileHover={{ scale: 1.06 }}
                      whileTap={{ scale: 0.92 }}
                      animate={isWrong ? { x: [0, -8, 8, -5, 5, 0] } : { x: 0 }}
                      className={`emoji-choice-btn ${isWrong ? 'choice-wrong' : ''}`}
                      onClick={() => {
                        if (emoji === currentItem.emoji) {
                          enterExamStage();
                        } else {
                          setWrongSpotlightEmoji(emoji);
                          setWrongShakeTick((t) => t + 1);
                          playFeedbackChime('soft-bonk');
                          void playWrongFeedbackAudio();
                        }
                      }}
                      aria-label={
                        emoji === currentItem.emoji ? `${currentItem.text} rasmi` : 'Rasm varianti'
                      }
                    >
                      <GameVisual
                        emoji={emoji}
                        wordId={emoji === currentItem.emoji ? currentItem.id : undefined}
                        alt={emoji === currentItem.emoji ? currentItem.text : undefined}
                        size={72}
                      />
                    </motion.button>
                  );
                })}
              </div>
            </div>
          )}

          {/* STAGE 3: EXAM (Mockups 08 & 09 + Mobile Phone 3) */}
          {wordPhase === 'exam' && (
            <>
              {isOfflineFallbackActive ? (
                /* Mockup 09: Offline 4-Picture Exam */
                <div className="offline-exam-layout">
                  <div className="offline-exam-word-card">
                    <span className="step-pill-tag" style={{ marginBottom: 4 }}>
                      {currentSession.expressExamOnly ? 'Ekspress-Imtihon' : '3-bosqich · Mustaqil o‘qish'}
                    </span>

                    <div className="exam-word-hero">
                      <LetterBlock
                        text={currentItem.text}
                        size="xl"
                        variant="exam-clean"
                        onLetterTap={handleExamLetterRecall}
                      />
                    </div>

                    <p className="offline-exam-prompt">
                      {currentItem.kind === 'sentence'
                        ? 'Gapni o‘qi va mos rasmni tanla!'
                        : 'So‘zni o‘qi va mos rasmni tanla!'}
                    </p>
                  </div>

                  {examFeedback &&
                    (examFeedback.audioKey ? (
                      <button
                        type="button"
                        className="feedback-banner feedback-gentle feedback-banner-clickable"
                        onClick={() => {
                          if (examFeedback.audioKey) {
                            void playFeedbackAudio(examFeedback.audioKey);
                          }
                        }}
                      >
                        <Volume2 size={16} />
                        <span>{examFeedback.text}</span>
                      </button>
                    ) : (
                      <div className="feedback-banner feedback-gentle">{examFeedback.text}</div>
                    ))}

                  <div className="offline-2x2-grid">
                    {offlineEmojiChoices.map((emoji) => {
                      const isWrong = offlineWrongEmojis.includes(emoji);
                      return (
                        <motion.button
                          key={emoji}
                          type="button"
                          whileHover={{ y: -3, scale: 1.03 }}
                          whileTap={{ y: 2, scale: 0.94 }}
                          animate={isWrong ? { x: [0, -8, 8, -5, 5, 0] } : { x: 0 }}
                          className={`offline-picture-card ${isWrong ? 'offline-card-wrong' : ''}`}
                          onClick={() => handleOfflineEmojiChoice(emoji)}
                          aria-label={
                            emoji === currentItem.emoji ? `${currentItem.text} rasmi` : 'Rasm varianti'
                          }
                        >
                          <GameVisual
                            emoji={emoji}
                            wordId={emoji === currentItem.emoji ? currentItem.id : undefined}
                            alt={emoji === currentItem.emoji ? currentItem.text : undefined}
                            size={96}
                          />
                        </motion.button>
                      );
                    })}
                  </div>

                  <div className="lesson-zukko-corner">
                    <AnimatedCharacter
                      mood={charMoodForScreen}
                      size={110}
                      avatarId={avatar.id}
                      layout="row"
                      bubblePosition="right"
                      speechText={stagePrompt}
                      onReplaySpeech={replayActiveInstruction}
                    />
                  </div>
                </div>
              ) : (
                /* Mockup 08 & Mobile Phone 3: Independent Voice Reading Exam */
                <div className="voice-exam-layout">
                  <div className="voice-exam-mascot-col">
                    <AnimatedCharacter
                      mood={charMoodForScreen}
                      size={210}
                      avatarId={avatar.id}
                      layout="stacked"
                      bubblePosition="top"
                      speechText={stagePrompt}
                      onReplaySpeech={replayActiveInstruction}
                    />
                  </div>

                  <div className="voice-exam-card-col">
                    <div className="voice-exam-word-card">
                      <span className="step-pill-tag">
                        {currentSession.expressExamOnly ? 'Ekspress-Imtihon' : 'Ovozli Imtihon'}
                      </span>

                      <div className="exam-word-hero">
                        {showVisualSplit ? (
                          <motion.div
                            layout
                            className="exam-split-row"
                            aria-label="Bo‘g‘in yordami"
                          >
                            {splitParts.map((part, idx) => (
                              <span key={`split-${part}-${idx}`} className="exam-split-item">
                                {idx > 0 && (
                                  <span className="exam-split-dash" aria-hidden="true">
                                    -
                                  </span>
                                )}
                                <LetterBlock
                                  text={part}
                                  size="xl"
                                  variant="exam-clean"
                                  highlighted={showAudioHint}
                                  onLetterTap={handleExamLetterRecall}
                                />
                              </span>
                            ))}
                          </motion.div>
                        ) : (
                          <LetterBlock
                            text={currentItem.text}
                            size="xl"
                            variant="exam-clean"
                            onLetterTap={handleExamLetterRecall}
                          />
                        )}
                      </div>

                      {examFeedback &&
                        (examFeedback.audioKey ? (
                          <button
                            type="button"
                            className={`feedback-banner ${
                              examFeedback.kind === 'success' ? 'feedback-success' : 'feedback-gentle'
                            } feedback-banner-clickable`}
                            onClick={() => {
                              if (examFeedback.audioKey) {
                                void playFeedbackAudio(examFeedback.audioKey);
                              }
                            }}
                          >
                            <Volume2 size={16} />
                            <span>{examFeedback.text}</span>
                          </button>
                        ) : (
                          <div
                            className={`feedback-banner ${
                              examFeedback.kind === 'success' ? 'feedback-success' : 'feedback-gentle'
                            }`}
                          >
                            {examFeedback.text}
                          </div>
                        ))}
                    </div>

                    {/* Giant Circular 3D Emerald Mic CTA in Thumb Zone */}
                    <div className="voice-mic-dock">
                      <div className="mic-rings-wrapper">
                        {isRecording && (
                          <>
                            <motion.span
                              className="mic-pulse-ring"
                              animate={{
                                scale: [1, 1.35 + micLevel * 0.45],
                                opacity: [0.55, 0],
                              }}
                              transition={{ duration: 1.1, repeat: Infinity }}
                              aria-hidden="true"
                            />
                            <motion.span
                              className="mic-pulse-ring"
                              animate={{
                                scale: [1, 1.2 + micLevel * 0.3],
                                opacity: [0.45, 0],
                              }}
                              transition={{ duration: 1.1, delay: 0.45, repeat: Infinity }}
                              aria-hidden="true"
                            />
                          </>
                        )}
                        <motion.button
                          type="button"
                          disabled={isChecking}
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.94 }}
                          className={`btn-mic-circle ${isRecording ? 'btn-mic-circle-active' : ''}`}
                          onClick={() => void toggleRecording()}
                          aria-label={
                            isChecking
                              ? 'Tekshirilmoqda'
                              : isRecording
                                ? 'Gapirib bo‘ldim'
                                : 'Mikrofonga o‘qib ber'
                          }
                        >
                          {isRecording ? (
                            <Square size={30} fill="currentColor" />
                          ) : (
                            <Mic size={36} strokeWidth={2.5} />
                          )}
                        </motion.button>
                      </div>

                      <span className="mic-caption">
                        {isChecking
                          ? 'Tekshirilmoqda...'
                          : isRecording
                            ? 'Tinglayapman... tugatgach bosing'
                            : 'Ovoz chiqarib o‘qi'}
                      </span>

                      {isRecording && (
                        <div className="mic-meter" aria-label="Mikrofon ovoz darajasi">
                          <div
                            className="mic-meter-fill"
                            style={{ width: `${Math.round(micLevel * 100)}%` }}
                          />
                        </div>
                      )}

                      <button
                        type="button"
                        className="btn-3d-cream btn-compact btn-with-icon"
                        onClick={handleExamAudioAssist}
                      >
                        <Volume2 size={16} />
                        <span>Birga aytamiz (Yordam)</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* WORD DONE CARD */}
          {wordPhase === 'word_done' && lastEval && (
            <div className="word-done-stage">
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 22 }}
                className="lesson-card-white word-done-card"
              >
                <AnimatedCharacter
                  mood="celebrating"
                  size={120}
                  avatarId={avatar.id}
                  layout="row"
                  bubblePosition="right"
                  speechText={stagePrompt}
                  onReplaySpeech={replayActiveInstruction}
                />

                <div className="word-done-visual">
                  <GameVisual
                    emoji={currentItem.emoji}
                    wordId={currentItem.id}
                    alt={currentItem.text}
                    size={96}
                  />
                </div>

                <div className="word-done-stars" aria-label={`${lastStarsEarned} ta yulduz`}>
                  {Array.from({ length: Math.max(1, lastStarsEarned) }).map((_, i) => (
                    <Star key={i} size={32} fill="#FBBF24" color="#D97706" />
                  ))}
                </div>

                <div className="word-done-title">
                  {currentItem.kind === 'word'
                    ? currentItem.syllables.join('-')
                    : currentItem.text}
                </div>

                <span className={`status-badge status-badge-${lastEval.status}`}>
                  <Check size={15} strokeWidth={3} />
                  <span>
                    {lastEval.status === 'mastered'
                      ? 'Mustaqil ravon o‘qildi!'
                      : lastEval.status === 'syllable'
                        ? lastEval.pendingVoiceVerify
                          ? 'Topildi (Ota-ona tasdig‘ini kutmoqda)'
                          : 'Bo‘g‘inlab to‘g‘ri o‘qildi'
                        : 'Mashq qilindi (Tez orada qayta chiqadi)'}
                  </span>
                </span>

                <motion.button
                  type="button"
                  whileTap={{ scale: 0.97 }}
                  className="btn-3d-emerald word-done-next-btn btn-with-icon"
                  onClick={handleAdvanceRound}
                >
                  <span>
                    {wordIdx + 1 < sessionItems.length ? 'Keyingi so‘z' : 'Natijani ko‘rish'}
                  </span>
                  <ArrowRight size={20} />
                </motion.button>
              </motion.div>
            </div>
          )}
        </motion.div>
      </main>
    </div>
  );
}
