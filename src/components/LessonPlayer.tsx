import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import {
  countUzbekSyllables,
  DYNAMIC_WORD_POOL,
  type WordPoolItem,
  type WordPoolKind,
} from '../data/curriculum';
import { resolveVisualRenderSrc } from '../data/wordVisuals';
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
  buildInterleavedSessionQueue,
  buildSentenceWordBank,
  buildWordHunterChoices,
  evaluateConstructorSelection,
  getOfflineFallbackEmojiChoices,
  getSentenceComprehensionAudioKey,
  getSentenceComprehensionPromptUz,
  getStage1GameMode,
  getVisualSplitParts,
  type AdaptiveSessionWord,
  type Stage1GameMode,
} from '../logic/wordPoolEngine';
import {
  INSTRUCTION_FALLBACK_TEXT,
  playFeedbackAudio,
  playFeedbackChime,
  playFeedbackThenWord,
  playInstructionAudio,
  playLetterRecallAudio,
  playPraiseAudio,
  playSyllableAudio,
  playWordItemAudio,
  playWrongFeedbackAudio,
  preloadLessonSessionAudio,
  startMicRecording,
  stopActiveAudio,
  SttRequestError,
  verifyAudioWithStt,
  type FeedbackAudioKey,
  type InstructionAudioKey,
  type MicRecordingResult,
  type MicSession,
} from '../utils/audioRecorder';
import { triggerCelebrationBurst } from '../utils/soundEffects';
import { AnimatedCharacter } from './AnimatedCharacter';
import { AlhamdulillahHabitBlock } from './BismillahAlhamdulillah';
import {
  FeedbackModal,
  shouldAutoOpenFirstSessionFeedback,
  shouldShowResultFeedbackButton,
} from './FeedbackModal';
import { GameVisual } from './GameVisual';
import { GuestSaveBanner } from './GuestSaveBanner';
import { ArrowRight, Check, CloseIcon, Home, MessageCircle, Mic, Sparkles, Square, Star, Volume2 } from './Icons';
import { LetterBlock, tokenizeUzbekLettersOrdered } from './LetterBlock';
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
  bismillahAlhamdulillahEnabled?: boolean;
  completedSessionsCount?: number;
  firstSessionFeedbackPrompted?: boolean;
  childName?: string;
  publicId?: string;
  isGuest?: boolean;
  onLetterHintTap: (letter: string) => void;
  onWordCompleted: (report: WordAttemptReport) => void;
  onRoundFinished?: () => void;
  onFirstSessionFeedbackPrompted?: () => void;
  onOpenGuestUpgrade?: () => void;
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
    if (params.buildGameMode === 'word_hunter') return 'instr_stage1_word_hunter';
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

export const BUBBLES_INSTRUCTION_TEXT_UZ =
  'Rasmga qara! Uning nomidagi bo‘g‘inlarni ketma-ket yor!';

export function shouldRunExamScaffoldingTimer(params: {
  roundFinished: boolean;
  wordPhase: WordPhase;
  hasCurrentItem: boolean;
  isOfflineFallbackActive: boolean;
}): boolean {
  return (
    !params.roundFinished &&
    params.wordPhase === 'exam' &&
    params.hasCurrentItem &&
    !params.isOfflineFallbackActive
  );
}

export function computeSessionProgress(params: {
  stepIdx: number;
  totalSteps: number;
  isWordDone: boolean;
}): {
  totalSteps: number;
  completedSteps: number;
  currentStepDisplay: number;
  progressPct: number;
} {
  const safeTotal = Math.max(1, params.totalSteps);
  const clampedIdx = Math.max(0, Math.min(params.stepIdx, safeTotal - 1));
  const completedSteps = params.isWordDone ? clampedIdx + 1 : clampedIdx;
  const currentStepDisplay = Math.min(
    completedSteps + (params.isWordDone ? 0 : 1),
    safeTotal,
  );
  const progressPct = Math.min(
    100,
    Math.round(((completedSteps + (params.isWordDone ? 0 : 0.4)) / safeTotal) * 100),
  );
  return {
    totalSteps: safeTotal,
    completedSteps,
    currentStepDisplay,
    progressPct,
  };
}

export const STT_FALLBACK_FAILURE_THRESHOLD = 2;

export function computeNextSttFailureCount(currentFailures: number, err: unknown): number {
  if (
    err instanceof SttRequestError &&
    (err.reason === 'unauthorized' ||
      err.reason === 'insufficient_credits' ||
      err.reason === 'endpoint_not_found' ||
      err.reason === 'unconfigured')
  ) {
    return Math.max(currentFailures + 1, STT_FALLBACK_FAILURE_THRESHOLD);
  }
  return currentFailures + 1;
}

const CONSTRUCTOR_BTN_CLASSES = ['cube-btn-orange', 'cube-btn-emerald', 'cube-btn-purple'] as const;

export function LessonPlayer({
  sessionItems,
  wordProgressMap,
  worldTitle,
  avatarId: _avatarId,
  aiOnline,
  bismillahAlhamdulillahEnabled = true,
  completedSessionsCount = 0,
  firstSessionFeedbackPrompted = false,
  childName,
  publicId,
  isGuest = false,
  onLetterHintTap,
  onWordCompleted,
  onRoundFinished,
  onFirstSessionFeedbackPrompted,
  onOpenGuestUpgrade,
  onPlayAnotherRound,
  onBack,
}: LessonPlayerProps) {
  const [retryIndex, setRetryIndex] = useState(0);
  const sessionQueue = useMemo(
    () => buildInterleavedSessionQueue(sessionItems),
    [sessionItems],
  );
  const [stepIdx, setStepIdx] = useState(0);
  const [showingWordDone, setShowingWordDone] = useState(false);
  const [roundFinished, setRoundFinished] = useState(false);
  const [roundStars, setRoundStars] = useState(0);
  const [roundPraiseDone, setRoundPraiseDone] = useState(false);
  const [alhamdulillahDone, setAlhamdulillahDone] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [completedResults, setCompletedResults] = useState<
    Record<string, ReadingAttemptEvaluation['status']>
  >({});

  const roundReportedRef = useRef(false);
  const autoFeedbackTriggeredRef = useRef(false);
  const isMountedRef = useRef(true);
  const onRoundFinishedRef = useRef(onRoundFinished);
  onRoundFinishedRef.current = onRoundFinished;
  const onFirstSessionFeedbackPromptedRef = useRef(onFirstSessionFeedbackPrompted);
  onFirstSessionFeedbackPromptedRef.current = onFirstSessionFeedbackPrompted;

  const currentStep = sessionQueue[stepIdx] ?? sessionQueue[0] ?? null;
  const wordPhase: WordPhase = showingWordDone
    ? 'word_done'
    : (currentStep?.phase ?? 'exam');
  const currentSession = currentStep?.entry ?? sessionItems[0] ?? null;
  const currentItem = currentSession?.item ?? null;
  const currentProgress = currentItem ? wordProgressMap[currentItem.id] : undefined;

  // Stage 1: Train Blending Slider, Constructor, Bubbles, or Sentence Builder
  const buildGameMode = useMemo(() => {
    if (!currentItem) return 'constructor' as const;
    return getStage1GameMode(currentStep?.stage1OrderIndex ?? 0, currentItem);
  }, [currentStep?.stage1OrderIndex, currentItem]);

  const [pickedMissingPart, setPickedMissingPart] = useState<string | null>(null);
  const [selectedConstructorPart, setSelectedConstructorPart] = useState<string | null>(null);
  const [wrongPart, setWrongPart] = useState<string | null>(null);
  const [wrongShakeTick, setWrongShakeTick] = useState(0);

  const [bubbleGate, setBubbleGate] = useState<BubbleGateState>(() =>
    createBubbleGateState(currentItem?.parts ?? []),
  );
  const [poppedBubbleKeys, setPoppedBubbleKeys] = useState<string[]>([]);
  const [wrongBubbleState, setWrongBubbleState] = useState<{ key: string; tick: number } | null>(
    null,
  );
  const [wrongBubblePicEmoji, setWrongBubblePicEmoji] = useState<string | null>(null);
  const [bubbleMicRecording, setBubbleMicRecording] = useState(false);
  const [bubbleMicChecking, setBubbleMicChecking] = useState(false);
  const [bubbleMicLevel, setBubbleMicLevel] = useState(0);
  const [bubbleFeedback, setBubbleFeedback] = useState<{
    text: string;
    audioKey: FeedbackAudioKey;
  } | null>(null);
  const [bubbleAssistBusy, setBubbleAssistBusy] = useState(false);
  const [selectedHunterChoiceId, setSelectedHunterChoiceId] = useState<string | null>(null);
  const [wrongHunterChoiceId, setWrongHunterChoiceId] = useState<string | null>(null);
  const [hunterMatched, setHunterMatched] = useState(false);
  const [hunterMicRecording, setHunterMicRecording] = useState(false);
  const [hunterMicChecking, setHunterMicChecking] = useState(false);
  const [hunterMicLevel, setHunterMicLevel] = useState(0);
  const [hunterAttempts, setHunterAttempts] = useState(0);
  const [hunterFeedback, setHunterFeedback] = useState<{
    text: string;
    audioKey?: FeedbackAudioKey;
  } | null>(null);
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
  const [examRevealed, setExamRevealed] = useState(false);
  const [lastEval, setLastEval] = useState<ReadingAttemptEvaluation | null>(null);
  const [lastStarsEarned, setLastStarsEarned] = useState(0);

  // Offline 4-picture check state
  const [offlineWrongEmojis, setOfflineWrongEmojis] = useState<string[]>([]);

  const micRef = useRef<MicSession | null>(null);
  const bubbleMicRef = useRef<MicSession | null>(null);
  const hunterMicRef = useRef<MicSession | null>(null);
  const stage1TimerRef = useRef<number | null>(null);
  const bubblePauseTimerRef = useRef<number | null>(null);
  const praiseTimerRef = useRef<number | null>(null);
  const examRevealTimerRef = useRef<number | null>(null);
  const wrongBubbleTimerRef = useRef<number | null>(null);
  const bubbleGenRef = useRef<number>(0);
  const suppressNextAutoInstrRef = useRef<boolean>(false);
  const recordedIdsRef = useRef<Set<string>>(new Set());
  const prevSessionItemsRef = useRef(sessionItems);
  const scaffoldingRef = useRef<ScaffoldingTimerState>(createScaffoldingState(0));
  const audioHintPlayedRef = useRef<boolean>(false);
  const lowConfRetriesRef = useRef<number>(0);
  const examRenderStartRef = useRef<number>(0);
  const isCheckingRef = useRef<boolean>(false);
  const examRevealedRef = useRef<boolean>(false);
  const consecutiveSttFailuresRef = useRef<number>(0);
  const prevHunterCorrectIdxRef = useRef<number | null>(null);
  const prevConstructorCorrectIdxRef = useRef<number | null>(null);
  const prevBubbleCorrectIdxRef = useRef<number | null>(null);
  const prevSpotlightCorrectIdxRef = useRef<number | null>(null);
  const prevOfflineCorrectIdxRef = useRef<number | null>(null);

  const avatar = getAvatarOption('fox');

  const isOfflineFallbackActive =
    !aiOnline ||
    !browserOnline ||
    consecutiveSttFailures >= STT_FALLBACK_FAILURE_THRESHOLD ||
    micPermissionBlocked;

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
  }, [currentItem, wordPhase, stepIdx, retryIndex]);

  const offlineEmojiChoices = useMemo(() => {
    if (!currentItem) return [];
    return getOfflineFallbackEmojiChoices(
      currentItem,
      DYNAMIC_WORD_POOL,
      prevOfflineCorrectIdxRef.current,
    );
  }, [currentItem, wordPhase, stepIdx, retryIndex]);

  useEffect(() => {
    if (!currentItem || typeof Image === 'undefined') return;
    const candidates: Array<{ emoji: string; image?: string; wordId?: string }> = [
      { emoji: currentItem.emoji, image: currentItem.image, wordId: currentItem.id },
      ...spotlightEmojiChoices.map((emoji) => ({
        emoji,
        image: emoji === currentItem.emoji ? currentItem.image : undefined,
        wordId: emoji === currentItem.emoji ? currentItem.id : undefined,
      })),
      ...offlineEmojiChoices.map((emoji) => ({
        emoji,
        image: emoji === currentItem.emoji ? currentItem.image : undefined,
        wordId: emoji === currentItem.emoji ? currentItem.id : undefined,
      })),
    ];
    const seen = new Set<string>();
    for (const entry of candidates) {
      const src = resolveVisualRenderSrc(entry);
      if (!src || src.startsWith('data:') || seen.has(src)) continue;
      seen.add(src);
      const img = new Image();
      img.src = src;
    }
  }, [currentItem, spotlightEmojiChoices, offlineEmojiChoices]);

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
  }, [currentItem, wordPhase, stepIdx, retryIndex]);

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
  }, [currentItem, wordPhase, stepIdx, retryIndex]);

  const wordHunterData = useMemo(() => {
    if (!currentItem || currentItem.kind !== 'word') {
      return { choices: [], correctIndex: -1 };
    }
    return buildWordHunterChoices(currentItem, DYNAMIC_WORD_POOL, {
      prevCorrectIndex: prevHunterCorrectIdxRef.current,
    });
  }, [currentItem, wordPhase, stepIdx, retryIndex]);

  useEffect(() => {
    if (!currentItem) return;
    if (wordPhase === 'stage1_build') {
      if (buildGameMode === 'word_hunter') {
        if (wordHunterData.correctIndex !== -1) {
          prevHunterCorrectIdxRef.current = wordHunterData.correctIndex;
        }
      } else if (buildGameMode === 'constructor') {
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
    wordHunterData.correctIndex,
    constructorChoices,
    bubbleChoices,
    spotlightEmojiChoices,
    offlineEmojiChoices,
  ]);

  const sentenceBank = useMemo(() => {
    if (!currentItem || currentItem.kind !== 'sentence') return [];
    return buildSentenceWordBank(currentItem);
  }, [currentItem, wordPhase, stepIdx, retryIndex]);

  // Defensive sync if parent swaps sessionItems without remounting
  useEffect(() => {
    if (prevSessionItemsRef.current === sessionItems) return;
    prevSessionItemsRef.current = sessionItems;
    recordedIdsRef.current.clear();
    roundReportedRef.current = false;
    autoFeedbackTriggeredRef.current = false;
    setCompletedResults({});
    setRoundStars(0);
    setRoundPraiseDone(false);
    setAlhamdulillahDone(false);
    setFeedbackOpen(false);
    setRoundFinished(false);
    setShowingWordDone(false);
    setStepIdx(0);
  }, [sessionItems]);

  // Reset per-step UI state when moving across exercise steps/items (never call setWordPhase here)
  useEffect(() => {
    if (roundFinished || wordPhase === 'word_done') return;
    bubbleGenRef.current += 1;
    if (stage1TimerRef.current !== null) {
      window.clearTimeout(stage1TimerRef.current);
      stage1TimerRef.current = null;
    }
    if (bubblePauseTimerRef.current !== null) {
      window.clearTimeout(bubblePauseTimerRef.current);
      bubblePauseTimerRef.current = null;
    }
    if (examRevealTimerRef.current !== null) {
      window.clearTimeout(examRevealTimerRef.current);
      examRevealTimerRef.current = null;
    }
    if (wrongBubbleTimerRef.current !== null) {
      window.clearTimeout(wrongBubbleTimerRef.current);
      wrongBubbleTimerRef.current = null;
    }
    setPickedMissingPart(null);
    setSelectedConstructorPart(null);
    setWrongPart(null);
    setWrongShakeTick(0);
    setBubbleGate(createBubbleGateState(currentItem?.parts ?? []));
    setPoppedBubbleKeys([]);
    setWrongBubbleState(null);
    setWrongBubblePicEmoji(null);
    setBubbleMicRecording(false);
    setBubbleMicChecking(false);
    setBubbleMicLevel(0);
    setBubbleFeedback(null);
    setBubbleAssistBusy(false);
    setSelectedHunterChoiceId(null);
    setWrongHunterChoiceId(null);
    setHunterMatched(false);
    setHunterMicRecording(false);
    setHunterMicChecking(false);
    setHunterMicLevel(0);
    setHunterAttempts(0);
    setHunterFeedback(null);
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
    examRevealedRef.current = false;
    setExamRevealed(false);
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
    if (hunterMicRef.current) {
      hunterMicRef.current.cancel();
      hunterMicRef.current = null;
    }
  }, [roundFinished, wordPhase, stepIdx, currentItem, retryIndex]);

  // Preload all lesson audio clips into in-memory blob cache on session start
  useEffect(() => {
    void preloadLessonSessionAudio(
      sessionItems.map((entry) => entry.item),
      { includeAlhamdulillah: bismillahAlhamdulillahEnabled },
    );
  }, [sessionItems, bismillahAlhamdulillahEnabled]);

  // Full cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
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
      if (examRevealTimerRef.current !== null) {
        window.clearTimeout(examRevealTimerRef.current);
        examRevealTimerRef.current = null;
      }
      if (wrongBubbleTimerRef.current !== null) {
        window.clearTimeout(wrongBubbleTimerRef.current);
        wrongBubbleTimerRef.current = null;
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
      if (hunterMicRef.current) {
        hunterMicRef.current.cancel();
        hunterMicRef.current = null;
      }
    };
  }, []);

  // Automatically open the 2nd survey once right after a new user completes their 1st session
  useEffect(() => {
    if (autoFeedbackTriggeredRef.current) return;
    const shouldOpen = shouldAutoOpenFirstSessionFeedback({
      completedSessionsCount,
      firstSessionFeedbackPrompted,
      roundFinished,
      bismillahAlhamdulillahEnabled,
      alhamdulillahDone,
      roundPraiseDone,
    });
    if (!shouldOpen) return;
    const timerId = window.setTimeout(() => {
      if (!isMountedRef.current || autoFeedbackTriggeredRef.current) return;
      autoFeedbackTriggeredRef.current = true;
      onFirstSessionFeedbackPromptedRef.current?.();
      setFeedbackOpen(true);
    }, 450);
    return () => {
      window.clearTimeout(timerId);
    };
  }, [
    completedSessionsCount,
    firstSessionFeedbackPrompted,
    roundFinished,
    bismillahAlhamdulillahEnabled,
    alhamdulillahDone,
    roundPraiseDone,
  ]);

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
  }, [roundFinished, stepIdx, currentItem, wordPhase, buildGameMode, isOfflineFallbackActive]);

  // Stage 3 Exam: Progressive Scaffolding Timer (4.5s split, 8.0s audio hint)
  useEffect(() => {
    if (
      !shouldRunExamScaffoldingTimer({
        roundFinished,
        wordPhase,
        hasCurrentItem: Boolean(currentItem),
        isOfflineFallbackActive,
      }) ||
      !currentItem
    ) {
      return;
    }
    const now = performance.now();
    examRenderStartRef.current = now;
    scaffoldingRef.current = createScaffoldingState(now);
    audioHintPlayedRef.current = false;
    setShowVisualSplit(false);
    setShowAudioHint(false);

    const intervalId = window.setInterval(() => {
      if (!isMountedRef.current || isCheckingRef.current || examRevealedRef.current) return;
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
  }, [roundFinished, wordPhase, stepIdx, currentItem, isOfflineFallbackActive]);

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

  const completeSessionRound = () => {
    bubbleGenRef.current += 1;
    if (stage1TimerRef.current !== null) {
      window.clearTimeout(stage1TimerRef.current);
      stage1TimerRef.current = null;
    }
    if (bubblePauseTimerRef.current !== null) {
      window.clearTimeout(bubblePauseTimerRef.current);
      bubblePauseTimerRef.current = null;
    }
    if (examRevealTimerRef.current !== null) {
      window.clearTimeout(examRevealTimerRef.current);
      examRevealTimerRef.current = null;
    }
    if (wrongBubbleTimerRef.current !== null) {
      window.clearTimeout(wrongBubbleTimerRef.current);
      wrongBubbleTimerRef.current = null;
    }
    if (micRef.current) {
      micRef.current.cancel();
      micRef.current = null;
    }
    if (bubbleMicRef.current) {
      bubbleMicRef.current.cancel();
      bubbleMicRef.current = null;
    }
    if (hunterMicRef.current) {
      hunterMicRef.current.cancel();
      hunterMicRef.current = null;
    }
    examRevealedRef.current = true;
    audioHintPlayedRef.current = true;
    stopActiveAudio();
    setShowingWordDone(false);
    setRoundPraiseDone(bismillahAlhamdulillahEnabled);
    setAlhamdulillahDone(false);
    if (!roundReportedRef.current) {
      roundReportedRef.current = true;
      onRoundFinishedRef.current?.();
    }
    triggerCelebrationBurst('round');
    if (praiseTimerRef.current !== null) {
      window.clearTimeout(praiseTimerRef.current);
      praiseTimerRef.current = null;
    }
    if (!bismillahAlhamdulillahEnabled) {
      praiseTimerRef.current = window.setTimeout(() => {
        praiseTimerRef.current = null;
        void playPraiseAudio('round_complete').finally(() => {
          if (isMountedRef.current) {
            setRoundPraiseDone(true);
          }
        });
      }, 800);
    }
    setRoundFinished(true);
  };

  const advanceAfterStage1 = () => {
    playFeedbackChime('chime');
    if (stepIdx + 1 < sessionQueue.length) {
      setStepIdx((prev) => prev + 1);
      return;
    }
    completeSessionRound();
  };

  const scheduleStage1Advance = (delayMs: number) => {
    if (stage1TimerRef.current !== null) {
      window.clearTimeout(stage1TimerRef.current);
    }
    stage1TimerRef.current = window.setTimeout(() => {
      stage1TimerRef.current = null;
      advanceAfterStage1();
    }, delayMs);
  };

  const verifyWordHunterSpeech = async (result: MicRecordingResult) => {
    if (!currentItem) return;
    const myGen = bubbleGenRef.current;
    setHunterMicChecking(true);
    setHunterFeedback(null);
    try {
      const resp = await verifyAudioWithStt(
        result.wavBlob,
        currentItem.text,
        currentItem.accept,
      );
      if (bubbleGenRef.current !== myGen) return;
      consecutiveSttFailuresRef.current = 0;
      setConsecutiveSttFailures(0);

      const validation = validateSttReading({
        targetWord: currentItem.text,
        parts: currentItem.parts,
        syllableCount: currentItem.syllables.length,
        acceptAliases: currentItem.accept,
        transcript: resp.transcript,
        isSilence: resp.is_silence,
        confidence: resp.confidence,
        confidenceAvailable: resp.confidence_available,
      });

      if (validation.decision === 'accepted' || resp.accepted) {
        playFeedbackChime('chime');
        setHunterFeedback(null);
        void playWordItemAudio(currentItem);
        scheduleStage1Advance(650);
        return;
      }

      playFeedbackChime('soft-bonk');
      setHunterAttempts((prev) => prev + 1);
      if (validation.decision === 'silence') {
        setHunterFeedback({
          text: 'Ovozing eshitilmadi — yana bir bor balandroq o‘qi!',
          audioKey: 'fb_no_speech',
        });
        void playFeedbackAudio('fb_no_speech');
      } else {
        setHunterFeedback({
          text: `«${currentItem.text}» so‘zini bo‘g‘inlarga qarab yana bir bor o‘qi!`,
          audioKey: 'fb_louder_clearer',
        });
        void playFeedbackAudio('fb_louder_clearer');
      }
    } catch (err) {
      if (bubbleGenRef.current !== myGen) return;
      const nextFailures = computeNextSttFailureCount(consecutiveSttFailuresRef.current, err);
      consecutiveSttFailuresRef.current = nextFailures;
      setConsecutiveSttFailures(nextFailures);
      setHunterAttempts((prev) => prev + 1);
      setHunterFeedback({
        text: 'Ovoz serveri bilan aloqa bo‘lmadi — «Davom etish» tugmasini bosishingiz mumkin.',
      });
    } finally {
      if (bubbleGenRef.current === myGen) {
        setHunterMicChecking(false);
      }
    }
  };

  const handleToggleWordHunterMic = async () => {
    if (!currentItem || hunterMicChecking) return;
    if (hunterMicRecording && hunterMicRef.current) {
      const rec = await hunterMicRef.current.stop();
      hunterMicRef.current = null;
      setHunterMicRecording(false);
      setHunterMicLevel(0);
      if (rec) {
        await verifyWordHunterSpeech(rec);
      }
      return;
    }

    stopActiveAudio();
    setHunterFeedback(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicPermissionBlocked(true);
      void playWordItemAudio(currentItem);
      scheduleStage1Advance(850);
      return;
    }

    const myGen = bubbleGenRef.current;
    try {
      const session = await startMicRecording(
        (lvl) => {
          if (bubbleGenRef.current === myGen) setHunterMicLevel(lvl);
        },
        (_reason, rec) => {
          hunterMicRef.current = null;
          if (bubbleGenRef.current !== myGen) return;
          setHunterMicRecording(false);
          setHunterMicLevel(0);
          void verifyWordHunterSpeech(rec);
        },
        SPELLING_FRIENDLY_MIC_CONFIG,
      );
      if (bubbleGenRef.current !== myGen) {
        session.cancel();
        return;
      }
      hunterMicRef.current = session;
      setHunterMicRecording(true);
    } catch {
      if (bubbleGenRef.current === myGen) {
        setMicPermissionBlocked(true);
        void playWordItemAudio(currentItem);
        scheduleStage1Advance(850);
      }
    }
  };

  const handleCheckWordHunter = () => {
    if (!currentItem || !selectedHunterChoiceId || hunterMatched) return;
    const picked = wordHunterData.choices.find((c) => c.id === selectedHunterChoiceId);
    if (!picked) return;

    if (!picked.isTarget) {
      playFeedbackChime('soft-bonk');
      setWrongHunterChoiceId(picked.id);
      setWrongShakeTick((prev) => prev + 1);
      setHunterFeedback({
        text: 'Boshqa so‘zga qarab ko‘r! Bo‘g‘inlarni diqqat bilan o‘qi.',
        audioKey: 'fb_word_hunter_wrong',
      });
      void playFeedbackAudio('fb_word_hunter_wrong');
      return;
    }

    playFeedbackChime('chime');
    setWrongHunterChoiceId(null);
    setHunterFeedback(null);
    setHunterMatched(true);

    const canVoiceSpeak =
      !isOfflineFallbackActive &&
      !micPermissionBlocked &&
      typeof navigator !== 'undefined' &&
      Boolean(navigator.mediaDevices?.getUserMedia);

    if (!canVoiceSpeak) {
      void playWordItemAudio(currentItem);
      scheduleStage1Advance(850);
      return;
    }

    void playInstructionAudio('instr_stage1_word_hunter_speak');
  };

  const advanceAfterStage2 = () => {
    stopActiveAudio();
    if (stepIdx + 1 < sessionQueue.length) {
      const nextStep = sessionQueue[stepIdx + 1];
      playFeedbackChime(nextStep?.phase === 'exam' ? 'pop' : 'chime');
      setStepIdx((prev) => prev + 1);
      return;
    }
    completeSessionRound();
  };

  const handleSelectConstructorChoice = (part: string) => {
    if (pickedMissingPart !== null) return;
    setSelectedConstructorPart(part);
    setWrongPart(null);
    playFeedbackChime('pop');
  };

  const handleConstructorCheck = () => {
    if (!currentItem || pickedMissingPart !== null) return;
    const targetLast = currentItem.parts[currentItem.parts.length - 1] ?? '';
    const outcome = evaluateConstructorSelection(selectedConstructorPart, targetLast);
    if (outcome === 'no_selection') return;

    if (outcome === 'correct' && selectedConstructorPart) {
      setPickedMissingPart(selectedConstructorPart);
      setSelectedConstructorPart(null);
      setWrongPart(null);
      playFeedbackChime('chime');
      scheduleStage1Advance(540);
      return;
    }

    if (selectedConstructorPart) {
      setWrongPart(selectedConstructorPart);
      setSelectedConstructorPart(null);
      setWrongShakeTick((t) => t + 1);
      playFeedbackChime('soft-bonk');
      void playWrongFeedbackAudio();
    }
  };

  const recordWordCompletion = (report: WordAttemptReport) => {
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
  };

  const finishCurrentWord = (report: WordAttemptReport) => {
    recordWordCompletion(report);
    triggerCelebrationBurst('word');
    if (praiseTimerRef.current !== null) {
      window.clearTimeout(praiseTimerRef.current);
    }
    praiseTimerRef.current = window.setTimeout(() => {
      praiseTimerRef.current = null;
      void playPraiseAudio();
    }, 350);
    setShowingWordDone(true);
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
      if (wrongBubbleTimerRef.current !== null) {
        window.clearTimeout(wrongBubbleTimerRef.current);
      }
      setWrongBubbleState({ key: bubbleKey, tick: Date.now() });
      setWrongShakeTick((t) => t + 1);
      wrongBubbleTimerRef.current = window.setTimeout(() => {
        wrongBubbleTimerRef.current = null;
        setWrongBubbleState(null);
      }, 420);
      playFeedbackChime('soft-bonk');
      void playWrongFeedbackAudio();
      return;
    }

    if (wrongBubbleTimerRef.current !== null) {
      window.clearTimeout(wrongBubbleTimerRef.current);
      wrongBubbleTimerRef.current = null;
    }
    setWrongBubbleState(null);
    setPoppedBubbleKeys((prev) => (prev.includes(bubbleKey) ? prev : [...prev, bubbleKey]));
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
      consecutiveSttFailuresRef.current = 0;
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
          scheduleStage1Advance(550);
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
    } catch (err) {
      if (bubbleGenRef.current !== myGen) return;
      const nextFailures = computeNextSttFailureCount(consecutiveSttFailuresRef.current, err);
      consecutiveSttFailuresRef.current = nextFailures;
      setConsecutiveSttFailures(nextFailures);

      if (nextFailures < STT_FALLBACK_FAILURE_THRESHOLD) {
        playFeedbackChime('soft-bonk');
        setBubbleGate((prev) => applyBubbleSpeechResult(prev, false));
        setBubbleFeedback({
          text: 'Yana bir bor balandroq va aniqroq aytib ko‘r!',
          audioKey: 'fb_louder_clearer',
        });
        void playFeedbackAudio('fb_louder_clearer');
        return;
      }

      if (!isOfflineFallbackActive) {
        suppressNextAutoInstrRef.current = true;
      }
      setBubbleFeedback(null);
      if (isFullWordStep) {
        setBubbleGate((prev) => ({
          ...prev,
          phase: 'offline_word_confirm',
          activePart: null,
          speechFailuresInStep: 0,
        }));
        void playInstructionAudio('instr_stage1_bubble_confirm_word');
      } else {
        const pauseStartedAtMs = performance.now();
        setBubbleGate((prev) => ({
          ...prev,
          phase: 'audio_pause',
          pauseStartedAtMs,
          speechFailuresInStep: 0,
        }));
        const pauseWait = new Promise<void>((resolve) => {
          if (bubblePauseTimerRef.current !== null) {
            window.clearTimeout(bubblePauseTimerRef.current);
          }
          bubblePauseTimerRef.current = window.setTimeout(() => {
            bubblePauseTimerRef.current = null;
            resolve();
          }, BUBBLE_OFFLINE_PAUSE_MS);
        });
        void Promise.all([playSyllableAudio(targetSpoken), pauseWait]).then(() => {
          if (bubbleGenRef.current !== myGen) return;
          setBubbleGate((prev) => {
            const next = completeOfflineSyllablePause(
              prev,
              pauseStartedAtMs + BUBBLE_OFFLINE_PAUSE_MS,
            );
            if (next.phase === 'offline_word_confirm') {
              void playInstructionAudio('instr_stage1_bubble_confirm_word');
            }
            return next;
          });
        });
      }
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
          scheduleStage1Advance(450);
        } else if (next.phase === 'awaiting_word_speech') {
          void playInstructionAudio('instr_stage1_bubble_read_word');
        }
        return next;
      });
    });
  };

  const processRecordedSpeech = async (result: MicRecordingResult) => {
    if (!currentItem) return;
    const stepGen = bubbleGenRef.current;
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
      if (bubbleGenRef.current !== stepGen) return;
      consecutiveSttFailuresRef.current = 0;
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

      recordWordCompletion({
        item: currentItem,
        evaluation,
        reactionMs: durations.reactionMs,
        articulationMs: durations.articulationMs,
        latencyMs: resp.latency_ms,
        usedVoiceAi: true,
        starsEarned,
      });

      examRevealedRef.current = true;
      setExamRevealed(true);
      setExamFeedback({
        kind: 'success',
        text: 'Barakalla! Rasm ochildi!',
      });
      playFeedbackChime('chime');
      triggerCelebrationBurst('word');
      void playWordItemAudio(currentItem);
      if (examRevealTimerRef.current !== null) {
        window.clearTimeout(examRevealTimerRef.current);
      }
      examRevealTimerRef.current = window.setTimeout(() => {
        examRevealTimerRef.current = null;
        setShowingWordDone(true);
        void playPraiseAudio();
      }, 1450);
    } catch (err) {
      if (bubbleGenRef.current !== stepGen) return;
      scaffoldingRef.current = resumeScaffoldingAfterFalseStart(
        scaffoldingRef.current,
        performance.now(),
        READING_THRESHOLDS,
      );
      const nextFailures = computeNextSttFailureCount(consecutiveSttFailuresRef.current, err);
      consecutiveSttFailuresRef.current = nextFailures;
      setConsecutiveSttFailures(nextFailures);

      if (nextFailures >= STT_FALLBACK_FAILURE_THRESHOLD) {
        setExamFeedback(null);
        setOfflineWrongEmojis([]);
      } else {
        setExamFeedback({
          kind: 'gentle',
          text: 'Yana bir bor balandroq va aniqroq aytib ko‘r!',
          audioKey: 'fb_louder_clearer',
        });
        void playFeedbackAudio('fb_louder_clearer');
      }
    } finally {
      if (bubbleGenRef.current === stepGen) {
        isCheckingRef.current = false;
        setIsChecking(false);
      }
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
    if (isChecking || examRevealed || wordPhase !== 'exam') return;
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
    if (!currentItem || examRevealed || wordPhase !== 'exam') return;
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
    if (praiseTimerRef.current !== null) {
      window.clearTimeout(praiseTimerRef.current);
      praiseTimerRef.current = null;
    }
    if (stepIdx + 1 < sessionQueue.length) {
      setShowingWordDone(false);
      setStepIdx((prev) => prev + 1);
    } else {
      completeSessionRound();
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
    const completedWordsCount = sessionItems.filter(
      ({ item }) => completedResults[item.id] !== undefined,
    ).length;

    return (
      <div className="victory-screen-shell">
        <StorybookBackdrop />

        <header className="victory-topbar">
          <button type="button" className="brand" onClick={onBack}>
            <img src="/images/logo.webp" alt="Alifbo" className="brand-logo-img" draggable={false} />
          </button>
          {shouldShowResultFeedbackButton(completedSessionsCount) && (
            <button
              type="button"
              className="btn-3d-cream btn-compact btn-with-icon victory-feedback-btn"
              onClick={() => {
                playFeedbackChime('pop');
                setFeedbackOpen(true);
              }}
            >
              <MessageCircle size={15} />
              <span>Fikr bildirish</span>
            </button>
          )}
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

            {!bismillahAlhamdulillahEnabled && (
              <h1 className="victory-headline">Barakalla! Ajoyib natija!</h1>
            )}

            <div className="victory-metrics-row">
              <span className="stars-pill-3d victory-metric-pill">
                <Star size={18} fill="#F59E0B" color="#B45309" />
                <span>+{roundStars} Yulduz</span>
              </span>
              <span className="victory-words-pill">
                {completedWordsCount} / {sessionItems.length} so‘z
              </span>
            </div>

            <div className="round-summary-words victory-words-list">
              {sessionItems.map(({ item }) => {
                const st = completedResults[item.id] ?? 'assisted';
                return (
                  <span key={item.id} className={`round-word-pill status-badge-${st}`}>
                    <GameVisual
                      emoji={item.emoji}
                      image={item.image}
                      wordId={item.id}
                      alt={item.text}
                      size={20}
                    />
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

            {bismillahAlhamdulillahEnabled && (
              <AlhamdulillahHabitBlock
                readyToPlay={roundPraiseDone}
                acknowledged={alhamdulillahDone}
                aiOnline={aiOnline}
                onAcknowledge={() => setAlhamdulillahDone(true)}
              />
            )}

            {isGuest && onOpenGuestUpgrade && (
              <div className="victory-guest-reminder">
                <GuestSaveBanner
                  variant="compact"
                  practicedCount={completedWordsCount}
                  totalStars={roundStars}
                  onSaveAccount={onOpenGuestUpgrade}
                />
              </div>
            )}

            {(!bismillahAlhamdulillahEnabled || alhamdulillahDone) && (
              <div className="victory-actions">
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  className="btn-3d-emerald victory-continue-btn btn-with-icon"
                  onClick={() => {
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
                    if (examRevealTimerRef.current !== null) {
                      window.clearTimeout(examRevealTimerRef.current);
                      examRevealTimerRef.current = null;
                    }
                    if (wrongBubbleTimerRef.current !== null) {
                      window.clearTimeout(wrongBubbleTimerRef.current);
                      wrongBubbleTimerRef.current = null;
                    }
                    if (micRef.current) {
                      micRef.current.cancel();
                      micRef.current = null;
                    }
                    if (bubbleMicRef.current) {
                      bubbleMicRef.current.cancel();
                      bubbleMicRef.current = null;
                    }
                    stopActiveAudio();
                    playFeedbackChime('pop');
                    recordedIdsRef.current.clear();
                    roundReportedRef.current = false;
                    autoFeedbackTriggeredRef.current = false;
                    prevConstructorCorrectIdxRef.current = null;
                    prevBubbleCorrectIdxRef.current = null;
                    prevSpotlightCorrectIdxRef.current = null;
                    prevOfflineCorrectIdxRef.current = null;
                    setCompletedResults({});
                    setShowingWordDone(false);
                    setStepIdx(0);
                    setRetryIndex((n) => n + 1);
                    setRoundStars(0);
                    setRoundPraiseDone(false);
                    setAlhamdulillahDone(false);
                    setFeedbackOpen(false);
                    setRoundFinished(false);
                    onPlayAnotherRound();
                  }}
                >
                  <span>Davom etish!</span>
                  <ArrowRight size={20} />
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
            )}
          </motion.div>
        </main>

        <FeedbackModal
          isOpen={feedbackOpen}
          onClose={() => setFeedbackOpen(false)}
          childName={childName}
          publicId={publicId}
          isGuest={isGuest}
          sessionsCompleted={completedSessionsCount}
        />
      </div>
    );
  }

  const { totalSteps, currentStepDisplay, progressPct } = computeSessionProgress({
    stepIdx,
    totalSteps: sessionQueue.length,
    isWordDone: wordPhase === 'word_done',
  });

  const stagePrompt = (() => {
    if (wordPhase === 'stage1_build') {
      if (buildGameMode === 'word_hunter') {
        return hunterMatched
          ? INSTRUCTION_FALLBACK_TEXT.instr_stage1_word_hunter_speak
          : INSTRUCTION_FALLBACK_TEXT.instr_stage1_word_hunter;
      }
      if (buildGameMode === 'sentence_builder') {
        return INSTRUCTION_FALLBACK_TEXT.instr_stage1_sentence;
      }
      if (buildGameMode === 'constructor') {
        return INSTRUCTION_FALLBACK_TEXT.instr_stage1_constructor;
      }
      if (bubbleGate.phase === 'awaiting_syllable_speech') {
        return INSTRUCTION_FALLBACK_TEXT.instr_stage1_bubble_speak;
      }
      if (bubbleGate.phase === 'awaiting_word_speech') {
        return INSTRUCTION_FALLBACK_TEXT.instr_stage1_bubble_read_word;
      }
      if (bubbleGate.phase === 'offline_word_confirm') {
        return INSTRUCTION_FALLBACK_TEXT.instr_stage1_bubble_confirm_word;
      }
      return BUBBLES_INSTRUCTION_TEXT_UZ;
    }
    if (wordPhase === 'stage2_spotlight') {
      return currentItem.kind === 'sentence'
        ? INSTRUCTION_FALLBACK_TEXT.instr_stage2_spotlight_sentence
        : INSTRUCTION_FALLBACK_TEXT.instr_stage2_spotlight_word;
    }
    if (wordPhase === 'exam') {
      if (isOfflineFallbackActive) {
        return currentItem.kind === 'sentence'
          ? INSTRUCTION_FALLBACK_TEXT.instr_stage3_exam_offline_sentence
          : INSTRUCTION_FALLBACK_TEXT.instr_stage3_exam_offline_word;
      }
      if (examRevealed) return `Barakalla! «${currentItem.text}» rasmi ochildi!`;
      if (isRecording) return 'Tinglayapman... bemalol o‘qi!';
      if (examFeedback?.kind === 'gentle') return 'Yana bir bor urinib ko‘r!';
      return currentItem.kind === 'sentence'
        ? INSTRUCTION_FALLBACK_TEXT.instr_stage3_exam_voice_sentence
        : INSTRUCTION_FALLBACK_TEXT.instr_stage3_exam_voice_word;
    }
    return lastEval?.status === 'mastered'
      ? `Barakalla! «${currentItem.text}» ni ravon o‘qiding!`
      : `Ajoyib urinish! «${currentItem.text}» mashq qilindi!`;
  })();

  const charMoodForScreen =
    wordPhase === 'word_done' || (wordPhase === 'exam' && examRevealed)
      ? 'celebrating'
      : wrongShakeTick > 0 &&
          (wrongPart !== null ||
            wrongBubbleState !== null ||
            offlineWrongEmojis.length > 0 ||
            wrongSpotlightEmoji !== null ||
            wrongSentenceKey !== null)
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
    if (wordPhase === 'stage1_build' && buildGameMode === 'word_hunter' && hunterMatched) {
      void playInstructionAudio('instr_stage1_word_hunter_speak');
      return;
    }
    if (wordPhase === 'stage1_build' && buildGameMode === 'bubbles') {
      if (bubbleGate.phase === 'awaiting_syllable_speech') {
        void playInstructionAudio('instr_stage1_bubble_speak');
      } else if (bubbleGate.phase === 'awaiting_word_speech') {
        void playInstructionAudio('instr_stage1_bubble_read_word');
      } else if (bubbleGate.phase === 'offline_word_confirm') {
        void playInstructionAudio('instr_stage1_bubble_confirm_word');
      } else {
        void playInstructionAudio('instr_stage1_bubbles');
      }
      return;
    }
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
          aria-valuenow={currentStepDisplay}
          aria-valuemin={1}
          aria-valuemax={totalSteps}
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
            {currentStepDisplay} / {totalSteps}
          </span>
        </span>
      </header>

      <main className="lesson-stage-main">
        <motion.div
          key={`${currentItem.id}-${wordPhase}-${stepIdx}`}
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
                  {buildGameMode === 'word_hunter'
                    ? 'So‘z ovchisi'
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
                          image={currentItem.image}
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

                    {/* Choices row + "Tekshirish" CTA (Thumb Zone on Mobile) */}
                    <div className="constructor-choices-thumbzone">
                      <div
                        className="constructor-choices-row"
                        role="radiogroup"
                        aria-label="Mos bo‘g‘in variantlari"
                      >
                        {constructorChoices.map((part, idx) => {
                          const isPicked = pickedMissingPart === part;
                          const isSelected = selectedConstructorPart === part;
                          const isWrong = wrongPart === part;
                          const colorCls =
                            CONSTRUCTOR_BTN_CLASSES[idx % CONSTRUCTOR_BTN_CLASSES.length] ??
                            'cube-btn-orange';
                          const letters = tokenizeUzbekLettersOrdered(part);

                          return (
                            <div key={part} className="constructor-choice-slot">
                              {!isPicked ? (
                                <motion.div
                                  role="radio"
                                  aria-checked={isSelected}
                                  aria-label={`${part} variantini tanlash`}
                                  tabIndex={0}
                                  layoutId={`ctor-tile-${currentItem.id}-${part}`}
                                  whileHover={{ y: -3, scale: 1.03 }}
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
                                    isSelected ? 'constructor-cube-selected' : ''
                                  } ${isWrong ? 'choice-wrong-cube' : ''}`}
                                  onClick={() => handleSelectConstructorChoice(part)}
                                  onKeyDown={(e) => {
                                    if (e.target !== e.currentTarget) return;
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      handleSelectConstructorChoice(part);
                                    }
                                  }}
                                >
                                  <div className="constructor-cube-letters">
                                    {(letters.length > 0 ? letters : [...part]).map(
                                      (unit, letterIdx) => {
                                        const normalizedUnit = unit
                                          .toUpperCase()
                                          .replace(/[‘ʻʼ`´]/g, "'");
                                        return (
                                          <motion.button
                                            key={`${part}-l-${unit}-${letterIdx}`}
                                            type="button"
                                            whileTap={{ scale: 1.22, y: -3 }}
                                            transition={{
                                              type: 'spring',
                                              stiffness: 450,
                                              damping: 20,
                                            }}
                                            className="constructor-cube-letter-btn"
                                            aria-label={`«${unit}» harf tovushini eshitish`}
                                            title={`«${unit}» tovushini eshitish`}
                                            onPointerDown={(e) => e.stopPropagation()}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              if (pickedMissingPart !== null) return;
                                              handleTapLetterRecall(normalizedUnit);
                                            }}
                                          >
                                            {unit}
                                          </motion.button>
                                        );
                                      },
                                    )}
                                  </div>
                                  <span
                                    className={`constructor-cube-select-pill ${
                                      isSelected ? 'is-selected' : ''
                                    }`}
                                  >
                                    {isSelected ? (
                                      <>
                                        <Check size={12} strokeWidth={3} />
                                        <span>Tanlandi</span>
                                      </>
                                    ) : (
                                      <span>Tanlash</span>
                                    )}
                                  </span>
                                </motion.div>
                              ) : (
                                <div className="constructor-choice-placeholder" aria-hidden="true" />
                              )}
                            </div>
                          );
                        })}
                      </div>

                      <motion.button
                        type="button"
                        disabled={!selectedConstructorPart || pickedMissingPart !== null}
                        whileHover={
                          selectedConstructorPart && !pickedMissingPart
                            ? { scale: 1.02 }
                            : undefined
                        }
                        whileTap={
                          selectedConstructorPart && !pickedMissingPart
                            ? { scale: 0.97 }
                            : undefined
                        }
                        className="btn-3d-emerald constructor-check-btn btn-with-icon"
                        onClick={handleConstructorCheck}
                      >
                        <Check size={20} strokeWidth={3} />
                        <span>Tekshirish</span>
                      </motion.button>
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
              ) : buildGameMode === 'word_hunter' ? (
                <div className="lesson-card-white lesson-centered-card">
                  <AnimatedCharacter
                    mood={hunterMicRecording ? 'listening' : charMoodForScreen}
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
                      image={currentItem.image}
                      wordId={currentItem.id}
                      alt={currentItem.text}
                      size={96}
                    />
                  </motion.div>

                  {!hunterMatched ? (
                    <>
                      <div className="word-hunter-grid" role="radiogroup" aria-label="Rasmga mos so‘zni tanlang">
                        {wordHunterData.choices.map((choice) => {
                          const isSelected = selectedHunterChoiceId === choice.id;
                          const isWrong = wrongHunterChoiceId === choice.id;
                          return (
                            <motion.button
                              key={choice.id}
                              type="button"
                              whileHover={{ scale: 1.02 }}
                              whileTap={{ scale: 0.97 }}
                              className={`word-hunter-choice-card ${
                                isSelected ? 'is-selected' : ''
                              } ${isWrong ? 'is-wrong shake' : ''}`}
                              onClick={() => {
                                playFeedbackChime('pop');
                                setSelectedHunterChoiceId(choice.id);
                                setWrongHunterChoiceId(null);
                                setHunterFeedback(null);
                              }}
                              aria-pressed={isSelected}
                            >
                              <span className="word-hunter-syllables">
                                {choice.parts.map((part, pIdx) => (
                                  <span key={`${choice.id}-p-${pIdx}`} className="word-hunter-syl-chip">
                                    {part}
                                  </span>
                                ))}
                              </span>
                            </motion.button>
                          );
                        })}
                      </div>

                      {hunterFeedback && (
                        <p className="gentle-feedback-banner" role="status">
                          {hunterFeedback.text}
                        </p>
                      )}

                      <button
                        type="button"
                        className="btn-3d-emerald"
                        disabled={!selectedHunterChoiceId}
                        onClick={handleCheckWordHunter}
                      >
                        Tekshirish
                      </button>
                    </>
                  ) : (
                    <div className="word-hunter-speak-box">
                      <div className="letter-row-centered">
                        {currentItem.parts.map((part, idx) => (
                          <LetterBlock
                            key={`hunter-word-${part}-${idx}`}
                            text={part}
                            size="lg"
                            highlighted
                            onLetterTap={handleTapLetterRecall}
                          />
                        ))}
                      </div>

                      <div className="hunter-mic-actions">
                        <button
                          type="button"
                          className={`mic-btn-big ${hunterMicRecording ? 'mic-btn-recording' : ''}`}
                          style={
                            hunterMicRecording
                              ? { transform: `scale(${1 + Math.min(0.14, hunterMicLevel * 0.25)})` }
                              : undefined
                          }
                          disabled={hunterMicChecking}
                          onClick={() => void handleToggleWordHunterMic()}
                        >
                          {hunterMicRecording ? (
                            <>
                              <Square size={20} fill="currentColor" />
                              <span>Tinglayapman...</span>
                            </>
                          ) : hunterMicChecking ? (
                            <>
                              <Sparkles size={20} />
                              <span>Tekshiryapman...</span>
                            </>
                          ) : (
                            <>
                              <Mic size={22} />
                              <span>Mikrofonga «{currentItem.text}» de</span>
                            </>
                          )}
                        </button>
                      </div>

                      {hunterFeedback && (
                        <p className="gentle-feedback-banner" role="status">
                          {hunterFeedback.text}
                        </p>
                      )}

                      {hunterAttempts >= 2 && (
                        <button
                          type="button"
                          className="btn-3d-cream btn-compact btn-with-icon"
                          onClick={() => {
                            void playWordItemAudio(currentItem);
                            scheduleStage1Advance(650);
                          }}
                        >
                          <ArrowRight size={16} />
                          <span>Davom etish</span>
                        </button>
                      )}
                    </div>
                  )}
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
                        image={currentItem.image}
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
                                  scheduleStage1Advance(600);
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

                  {bubbleGate.phase !== 'offline_word_confirm' && (
                    <motion.div
                      animate={{ y: [0, -5, 0] }}
                      transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                      className="bubble-target-visual"
                    >
                      <GameVisual
                        emoji={currentItem.emoji}
                        image={currentItem.image}
                        wordId={currentItem.id}
                        alt={currentItem.text}
                        size={104}
                      />
                    </motion.div>
                  )}

                  <div className="bubble-mystery-badge">
                    Bo‘g‘inlar ({bubbleGate.confirmedCount}/{bubbleGate.parts.length})
                  </div>

                  <div className="bubble-assembled-row" aria-label="Yig‘ilayotgan bo‘g‘in kataklari">
                    {currentItem.parts.map((part, idx) => {
                      const isDone = idx < bubbleGate.confirmedCount;
                      const isActive =
                        idx === bubbleGate.confirmedCount && bubbleGate.activePart !== null;
                      const displayText = isDone
                        ? part
                        : isActive
                          ? bubbleGate.activePart
                          : null;
                      return (
                        <span
                          key={`assembled-${part}-${idx}`}
                          className={`assembled-chip ${
                            isDone
                              ? 'assembled-chip-done'
                              : isActive
                                ? 'assembled-chip-active'
                                : 'assembled-chip-empty'
                          }`}
                        >
                          {displayText ? (
                            <motion.span
                              key={`slot-${idx}-${displayText}`}
                              initial={{ scale: 0.45, y: 14, opacity: 0 }}
                              animate={{ scale: 1, y: 0, opacity: 1 }}
                              transition={{ type: 'spring', stiffness: 420, damping: 20 }}
                            >
                              {displayText}
                            </motion.span>
                          ) : (
                            <span
                              className="assembled-slot-blank"
                              aria-label={`${idx + 1}-bo‘g‘in bo‘sh katagi`}
                            >
                              ___
                            </span>
                          )}
                        </span>
                      );
                    })}
                  </div>

                  {bubbleGate.phase !== 'offline_word_confirm' &&
                    bubbleGate.phase !== 'awaiting_word_speech' && (
                      <div className="bubbles-field">
                        {bubbleChoices.map((bubble, idx) => {
                          const isAlreadyPopped = poppedBubbleKeys.includes(bubble.key);
                          const isLocked = bubbleGate.phase !== 'pick_bubble';
                          const isWrong = wrongBubbleState?.key === bubble.key;
                          return (
                            <motion.button
                              key={bubble.key}
                              type="button"
                              disabled={isAlreadyPopped || isLocked}
                              animate={
                                isAlreadyPopped
                                  ? { scale: 0.8, opacity: 0.3 }
                                  : isWrong
                                    ? { x: [0, -8, 8, -6, 6, -3, 0] }
                                    : isLocked
                                      ? { opacity: 0.55 }
                                      : { y: [0, idx % 2 === 0 ? -7 : 7, 0] }
                              }
                              transition={{
                                duration: isWrong ? 0.36 : 2.4,
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
                                    scheduleStage1Advance(650);
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
                                  image={emoji === currentItem.emoji ? currentItem.image : undefined}
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
                    ? 'Harfni eshitish uchun ustiga bos, variantni tanlab «Tekshirish»ni bos!'
                    : 'Harfni unutdingmi? Istalgan harf ustiga bos!'}
                </span>
              </button>
            </div>
          )}

          {/* STAGE 2: SPOTLIGHT */}
          {wordPhase === 'stage2_spotlight' && (
            <div className="lesson-card-white lesson-centered-card">
              <span className="step-pill-tag">
                {currentItem.kind === 'sentence'
                  ? '2-bosqich · So‘zma-so‘z o‘qish'
                  : '2-bosqich · Bo‘g‘inlab o‘qish'}
              </span>

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
                          advanceAfterStage2();
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
                        image={emoji === currentItem.emoji ? currentItem.image : undefined}
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
                        ? INSTRUCTION_FALLBACK_TEXT.instr_stage3_exam_offline_sentence
                        : INSTRUCTION_FALLBACK_TEXT.instr_stage3_exam_offline_word}
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
                            image={emoji === currentItem.emoji ? currentItem.image : undefined}
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

                      {/* Hidden Mystery Card — reveals image with animation only after correct speech */}
                      <div className="exam-mystery-stage">
                        <AnimatePresence mode="wait">
                          {!examRevealed ? (
                            <motion.div
                              key="mystery-closed"
                              className="exam-mystery-card"
                              initial={{ opacity: 0, scale: 0.9 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ rotateY: -90, scale: 0.85, opacity: 0 }}
                              transition={{ duration: 0.24 }}
                              aria-label="Yashirilgan sirli rasm"
                            >
                              <span className="exam-mystery-qmark" aria-hidden="true">
                                ?
                              </span>
                              <span className="exam-mystery-label">Sirli rasm</span>
                            </motion.div>
                          ) : (
                            <motion.div
                              key="mystery-open"
                              className="exam-mystery-card exam-mystery-card-revealed"
                              initial={{ rotateY: 90, scale: 0.65, opacity: 0 }}
                              animate={{ rotateY: 0, scale: 1, opacity: 1 }}
                              transition={{ type: 'spring', stiffness: 320, damping: 18 }}
                            >
                              <GameVisual
                                emoji={currentItem.emoji}
                                image={currentItem.image}
                                wordId={currentItem.id}
                                alt={currentItem.text}
                                size={88}
                              />
                              <span className="exam-revealed-badge">
                                <Sparkles size={13} />
                                <span>Ochildi!</span>
                              </span>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>

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
                          disabled={isChecking || examRevealed}
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
                        disabled={examRevealed}
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
                    image={currentItem.image}
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
                    {stepIdx + 1 < sessionQueue.length ? 'Keyingi mashq' : 'Natijani ko‘rish'}
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
