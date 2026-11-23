import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ALIFBE_LETTERS_29, type AlifbeLetterInfo } from '../data/curriculum';
import {
  buildLetterQuizChoices,
  selectAlphabetReviewQueue,
  type LetterMasteryEntry,
} from '../logic/alphabetReview';
import { getAvatarOption } from '../logic/gamification';
import { MIC_AUTO_STOP_CONFIG, type MicAutoStopAction } from '../logic/micAutoStop';
import { validateSttReading } from '../logic/sttValidator';
import {
  playFeedbackAudio,
  playFeedbackChime,
  playInstructionAudio,
  playInstructionThenLetter,
  playLetterRecallAudio,
  playPraiseAudio,
  playWrongFeedbackAudio,
  startMicRecording,
  stopActiveAudio,
  verifyAudioWithStt,
  type FeedbackAudioKey,
  type MicRecordingResult,
  type MicSession,
} from '../utils/audioRecorder';
import { triggerCelebrationBurst } from '../utils/soundEffects';
import { AnimatedCharacter } from './AnimatedCharacter';
import { GameVisual } from './GameVisual';
import { ArrowLeft, BookOpen, Check, Gamepad2, Mic, RotateCcw, Square, Star, Volume2 } from './Icons';
import { StorybookBackdrop } from './StorybookBackdrop';

interface AlphabetRecallDrawerProps {
  letterHintCounts: Record<string, number>;
  letterMastery: Record<string, LetterMasteryEntry>;
  avatarId: string;
  aiOnline: boolean;
  totalStars?: number;
  onLetterHintTap: (letter: string) => void;
  onLetterReviewed: (payload: {
    letter: string;
    perfectRound: boolean;
    usedVoiceAi: boolean;
    starsEarned: number;
  }) => void;
  onClose: () => void;
}

type DrawerMode = 'chart' | 'game';
type MicroStep = 'listen_pick' | 'picture_match' | 'say_or_confirm';

interface RoundLetterOutcome {
  entry: AlifbeLetterInfo;
  perfect: boolean;
  usedVoiceAi: boolean;
}

const CHART_ORDER = [
  'A', 'B', 'D', 'E', 'F', 'G',
  'H', 'I', 'J', 'K', 'L', 'M',
  'N', 'O', 'P', 'Q', 'R', 'S',
  'T', 'U', 'V', 'X', 'Y', 'Z',
  "O'", "G'", 'SH', 'CH', 'NG', '’',
] as const;

const TILE_ACCENTS = [
  'tile-accent-coral',
  'tile-accent-gold',
  'tile-accent-teal',
  'tile-accent-orange',
  'tile-accent-purple',
  'tile-accent-blue',
] as const;

/**
 * Full-screen Uzbek Alphabet page (29 letters + tutuq belgisi) matching Mockup 06
 * (`06_ozbek_alifbosi_29_harf.jpg`), paired with the 5-letter interactive review game.
 */
export function AlphabetRecallDrawer({
  letterHintCounts,
  letterMastery,
  avatarId,
  aiOnline,
  totalStars = 0,
  onLetterHintTap,
  onLetterReviewed,
  onClose,
}: AlphabetRecallDrawerProps) {
  const orderedAlphabet = useMemo(() => {
    const byLetter = new Map(ALIFBE_LETTERS_29.map((item) => [item.letter, item]));
    const ordered: AlifbeLetterInfo[] = [];
    for (const code of CHART_ORDER) {
      const found = byLetter.get(code);
      if (found) ordered.push(found);
    }
    for (const item of ALIFBE_LETTERS_29) {
      if (!ordered.includes(item)) ordered.push(item);
    }
    return ordered;
  }, []);

  const [mode, setMode] = useState<DrawerMode>('chart');
  const [selected, setSelected] = useState<AlifbeLetterInfo | null>(orderedAlphabet[0] ?? null);

  // Sequential 5-letter game state
  const [roundEpoch, setRoundEpoch] = useState(0);
  const [queue, setQueue] = useState<AlifbeLetterInfo[]>(() =>
    selectAlphabetReviewQueue({
      catalog: ALIFBE_LETTERS_29,
      letterHintCounts,
      letterMastery,
    }),
  );
  const [idx, setIdx] = useState(0);
  const [microStep, setMicroStep] = useState<MicroStep>('listen_pick');
  const [hadMistake, setHadMistake] = useState(false);
  const [pickedCorrectKey, setPickedCorrectKey] = useState<string | null>(null);
  const [wrongKey, setWrongKey] = useState<string | null>(null);
  const [roundStars, setRoundStars] = useState(0);
  const [roundResults, setRoundResults] = useState<RoundLetterOutcome[]>([]);
  const [roundDone, setRoundDone] = useState(false);

  const [isRecording, setIsRecording] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [sttFallbackActive, setSttFallbackActive] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [voiceMsg, setVoiceMsg] = useState<{
    text: string;
    audioKey: FeedbackAudioKey;
  } | null>(null);

  const micRef = useRef<MicSession | null>(null);
  const timerRef = useRef<number | null>(null);
  const praiseTimerRef = useRef<number | null>(null);
  const wrongSeqRef = useRef<number>(0);
  const prevChoiceCorrectIdxRef = useRef<number | null>(null);

  const avatar = getAvatarOption(avatarId);
  const letters29 = orderedAlphabet.filter((entry) => entry.category !== 'mark');
  const markEntries = orderedAlphabet.filter((entry) => entry.category === 'mark');
  const current = queue[idx] ?? null;

  const choices = useMemo(() => {
    if (!current) return [];
    return buildLetterQuizChoices(
      current,
      ALIFBE_LETTERS_29,
      undefined,
      prevChoiceCorrectIdxRef.current,
    );
  }, [current, microStep, roundEpoch]);

  useEffect(() => {
    if (
      mode === 'game' &&
      !roundDone &&
      current &&
      (microStep === 'listen_pick' || microStep === 'picture_match')
    ) {
      const correctIdx = choices.findIndex((entry) => entry.letter === current.letter);
      if (correctIdx !== -1) {
        prevChoiceCorrectIdxRef.current = correctIdx;
      }
    }
  }, [mode, roundDone, current, microStep, choices]);

  const cancelOngoingMedia = () => {
    wrongSeqRef.current += 1;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (praiseTimerRef.current !== null) {
      window.clearTimeout(praiseTimerRef.current);
      praiseTimerRef.current = null;
    }
    if (micRef.current) {
      micRef.current.cancel();
      micRef.current = null;
    }
    setIsRecording(false);
    setIsChecking(false);
    setMicLevel(0);
    stopActiveAudio();
  };

  useEffect(() => {
    return () => {
      cancelOngoingMedia();
    };
  }, []);

  useEffect(() => {
    if (mode === 'chart') {
      void playInstructionAudio('instr_alpha_chart');
      return;
    }
    if (mode !== 'game' || roundDone || !current) return;
    if (microStep === 'listen_pick') {
      if (idx === 0) {
        void playInstructionThenLetter('instr_alpha_listen', current.letter);
      } else {
        void playLetterRecallAudio(current.letter, { skipChime: true });
      }
      return;
    }
    if (microStep === 'picture_match') {
      void playInstructionAudio('instr_alpha_picture');
      return;
    }
    if (microStep === 'say_or_confirm') {
      void playInstructionAudio('instr_alpha_say');
    }
  }, [mode, roundDone, microStep, idx, roundEpoch, current]);

  const handleClose = () => {
    playFeedbackChime('pop');
    cancelOngoingMedia();
    onClose();
  };

  const handleSwitchMode = (nextMode: DrawerMode) => {
    if (nextMode === mode) return;
    playFeedbackChime('pop');
    cancelOngoingMedia();
    setMode(nextMode);
  };

  const handleStartNewRound = () => {
    playFeedbackChime('pop');
    cancelOngoingMedia();
    const nextQueue = selectAlphabetReviewQueue({
      catalog: ALIFBE_LETTERS_29,
      letterHintCounts,
      letterMastery,
    });
    setQueue(nextQueue);
    setRoundEpoch((prev) => prev + 1);
    setIdx(0);
    setMicroStep('listen_pick');
    setHadMistake(false);
    setPickedCorrectKey(null);
    setWrongKey(null);
    setRoundStars(0);
    setRoundResults([]);
    setRoundDone(false);
    setVoiceMsg(null);
  };

  const handleChartTap = (entry: AlifbeLetterInfo) => {
    playFeedbackChime('marimba');
    setSelected(entry);
    onLetterHintTap(entry.letter);
    void playLetterRecallAudio(entry.letter);
  };

  const handlePickLetterChoice = (entry: AlifbeLetterInfo) => {
    if (!current || pickedCorrectKey !== null) return;
    if (entry.letter === current.letter) {
      setPickedCorrectKey(entry.letter);
      setWrongKey(null);
      playFeedbackChime('chime');
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        setPickedCorrectKey(null);
        setWrongKey(null);
        setMicroStep('picture_match');
      }, 420);
      return;
    }

    setHadMistake(true);
    setWrongKey(entry.letter);
    playFeedbackChime('soft-bonk');
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    wrongSeqRef.current += 1;
    const seqId = wrongSeqRef.current;
    const targetLetter = current.letter;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void (async () => {
        await playWrongFeedbackAudio();
        if (wrongSeqRef.current !== seqId) return;
        await playLetterRecallAudio(targetLetter, { skipChime: true });
      })();
    }, 240);
  };

  const handlePickPictureChoice = (entry: AlifbeLetterInfo) => {
    if (!current || pickedCorrectKey !== null) return;
    if (entry.letter === current.letter) {
      setPickedCorrectKey(entry.letter);
      setWrongKey(null);
      playFeedbackChime('chime');
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        setPickedCorrectKey(null);
        setWrongKey(null);
        setVoiceMsg(null);
        setMicroStep('say_or_confirm');
      }, 420);
      return;
    }

    setHadMistake(true);
    setWrongKey(entry.letter);
    playFeedbackChime('soft-bonk');
    void playWrongFeedbackAudio();
  };

  const finishCurrentLetter = (usedVoiceAi: boolean) => {
    if (!current) return;
    cancelOngoingMedia();
    const perfectRound = !hadMistake;
    const starsEarned = perfectRound ? 2 : 1;

    onLetterReviewed({
      letter: current.letter,
      perfectRound,
      usedVoiceAi,
      starsEarned,
    });

    setRoundStars((prev) => prev + starsEarned);
    setRoundResults((prev) => [...prev, { entry: current, perfect: perfectRound, usedVoiceAi }]);

    if (idx + 1 < queue.length) {
      setIdx((prev) => prev + 1);
      setMicroStep('listen_pick');
      setHadMistake(false);
      setPickedCorrectKey(null);
      setWrongKey(null);
      setVoiceMsg(null);
    } else {
      triggerCelebrationBurst('round');
      praiseTimerRef.current = window.setTimeout(() => {
        praiseTimerRef.current = null;
        void playPraiseAudio('alphabet_complete');
      }, 750);
      setRoundDone(true);
    }
  };

  const processVoiceSample = async (result: MicRecordingResult) => {
    if (!current) return;
    setIsChecking(true);
    setVoiceMsg(null);

    try {
      const acceptAliases = Array.from(
        new Set([current.exampleWord.toLowerCase(), current.letter.toLowerCase()]),
      );
      const sttRes = await verifyAudioWithStt(result.wavBlob, current.exampleWord, acceptAliases);
      const validation = validateSttReading({
        targetWord: current.exampleWord,
        parts: [current.exampleWord],
        syllableCount: 1,
        acceptAliases,
        transcript: sttRes.transcript,
        isSilence: sttRes.is_silence,
        confidence: sttRes.confidence,
        confidenceAvailable: sttRes.confidence_available,
      });

      if (validation.decision === 'accepted') {
        finishCurrentLetter(true);
        return;
      }

      playFeedbackChime('soft-bonk');
      if (sttRes.is_silence) {
        setVoiceMsg({
          text: 'Ovozing eshitilmadi — yana bir bor balandroq aytib ko‘r!',
          audioKey: 'fb_no_speech',
        });
        void playFeedbackAudio('fb_no_speech');
      } else {
        setVoiceMsg({
          text: `«${current.exampleWord}» so‘zini yana bir bor aniqroq aytib ko‘r!`,
          audioKey: 'fb_alpha_repeat',
        });
        void playFeedbackAudio('fb_alpha_repeat');
      }
    } catch {
      setSttFallbackActive(true);
      setVoiceMsg(null);
      void playLetterRecallAudio(current.letter, { skipChime: true });
    } finally {
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
      playFeedbackChime('soft-bonk');
      setVoiceMsg({
        text: 'Ovozing eshitilmadi — yana bir bor balandroq aytib ko‘r!',
        audioKey: 'fb_no_speech',
      });
      void playFeedbackAudio('fb_no_speech');
      return;
    }
    void processVoiceSample(result);
  };

  const toggleMicCheck = async () => {
    if (isChecking || !current || microStep !== 'say_or_confirm') return;
    if (!isRecording) {
      setVoiceMsg(null);
      try {
        const session = await startMicRecording(
          (lvl) => setMicLevel(lvl),
          handleMicAutoStop,
          MIC_AUTO_STOP_CONFIG,
        );
        micRef.current = session;
        setIsRecording(true);
      } catch {
        setVoiceMsg({
          text: 'Mikrofonga ruxsat berilmadi — pastdagi tugma bilan davom eting.',
          audioKey: 'fb_alpha_mic_blocked',
        });
        void playFeedbackAudio('fb_alpha_mic_blocked');
      }
    } else if (micRef.current) {
      const active = micRef.current;
      micRef.current = null;
      setIsRecording(false);
      setMicLevel(0);
      const stopped = await active.stop();
      if (stopped) {
        await processVoiceSample(stopped);
      }
    }
  };

  const renderChartTile = (entry: AlifbeLetterInfo, idxInGrid: number) => {
    const tapCount = letterHintCounts[entry.letter] ?? 0;
    const isSelected = selected?.letter === entry.letter;
    const isMastered = letterMastery[entry.letter]?.status === 'mastered';
    const accentClass = TILE_ACCENTS[idxInGrid % TILE_ACCENTS.length] ?? 'tile-accent-blue';
    const shortLabel = entry.display.split(' ')[0] ?? entry.letter;

    return (
      <motion.button
        key={entry.letter}
        type="button"
        whileHover={{ y: -3, scale: 1.04 }}
        whileTap={{ y: 3, scale: 0.94 }}
        transition={{ type: 'spring', stiffness: 420, damping: 22 }}
        className={`alifbo-3d-tile ${accentClass} ${
          isSelected ? 'alifbo-3d-tile-selected' : ''
        }`}
        onClick={() => handleChartTap(entry)}
        aria-label={`${entry.display} — ${entry.exampleWord}`}
      >
        {isMastered && (
          <span className="alphabet-mastery-check" aria-label="Mustahkamlangan">
            <Check size={11} strokeWidth={3} />
          </span>
        )}
        <strong className="alifbo-tile-glyph">{shortLabel}</strong>
        {tapCount > 0 && <span className="alphabet-mini-badge">{tapCount}</span>}
      </motion.button>
    );
  };

  const gameProgressPct = queue.length
    ? Math.round(
        ((roundDone
          ? queue.length
          : idx +
            (microStep === 'say_or_confirm' ? 0.75 : microStep === 'picture_match' ? 0.45 : 0.15)) /
          queue.length) *
          100,
      )
    : 0;

  const selectedUpper = selected ? selected.display.split(' ')[0] ?? selected.letter : '';
  const selectedLower = selected ? selected.display.split(' ')[1] ?? '' : '';

  return (
    <div className="alphabet-screen-shell">
      <StorybookBackdrop />

      <header className="alphabet-screen-header">
        <div className="alphabet-header-left">
          <button
            type="button"
            className="brand"
            onClick={handleClose}
            aria-label="Alifbo — Bosh sahifaga"
          >
            <img src="/images/logo.webp" alt="Alifbo" className="brand-logo-img" draggable={false} />
          </button>

          <button
            type="button"
            className="btn-3d-cream btn-compact btn-with-icon nav-btn"
            onClick={handleClose}
          >
            <ArrowLeft size={16} strokeWidth={2.5} />
            <span>Bosh sahifa</span>
          </button>
        </div>

        <h1 className="alphabet-page-title">O‘zbek Alifbosi</h1>

        <div className="alphabet-header-right">
          <button
            type="button"
            className={`btn-compact btn-with-icon nav-btn ${
              mode === 'game' ? 'btn-3d-emerald' : 'btn-3d-cream'
            }`}
            onClick={() => handleSwitchMode(mode === 'chart' ? 'game' : 'chart')}
          >
            {mode === 'chart' ? <Gamepad2 size={16} /> : <BookOpen size={16} />}
            <span>{mode === 'chart' ? 'Harf o‘yini' : '29 harf jadvali'}</span>
          </button>

          <span className="stars-pill-3d" aria-label="Jami yulduzlar">
            <Star size={17} fill="#F59E0B" color="#B45309" />
            <span>{totalStars}</span>
          </span>
        </div>
      </header>

      <main className="alphabet-main-content">
        {mode === 'chart' ? (
          <div className="alphabet-chart-layout">
            {/* Left 62%: 29 letters + tutuq belgisi grid */}
            <section className="alphabet-tiles-panel" aria-label="O‘zbek alifbosi harflari">
              <div className="alphabet-grid-6col">
                {letters29.map((entry, idxInGrid) => renderChartTile(entry, idxInGrid))}
              </div>
              {markEntries.length > 0 && (
                <div className="alphabet-tutuq-row">
                  {markEntries.map((entry) => (
                    <button
                      key={entry.letter}
                      type="button"
                      className={`btn-3d-cream tutuq-pill-btn ${
                        selected?.letter === entry.letter ? 'alifbo-3d-tile-selected' : ''
                      }`}
                      onClick={() => handleChartTap(entry)}
                    >
                      <strong>{entry.letter}</strong>
                      <span>Tutuq belgisi ({entry.exampleWord})</span>
                    </button>
                  ))}
                </div>
              )}
            </section>

            {/* Right 38%: Big Selected Letter Preview Card + peeking Zukko */}
            {selected && (
              <aside className="alphabet-preview-panel">
                <motion.div
                  key={selected.letter}
                  initial={{ scale: 0.96, opacity: 0.7 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 320, damping: 24 }}
                  className="alphabet-showcase-card"
                >
                  <div className="alphabet-pair-display" aria-label={selected.display}>
                    <span className="pair-upper">{selectedUpper}</span>
                    {selectedLower && !selectedLower.startsWith('(') && (
                      <span className="pair-lower">{selectedLower}</span>
                    )}
                  </div>

                  <div className="alphabet-showcase-visual">
                    <GameVisual
                      emoji={selected.exampleEmoji}
                      letter={selected.letter}
                      alt={selected.exampleWord}
                      size={138}
                    />
                  </div>

                  <div className="alphabet-showcase-word">{selected.exampleWord}</div>
                  <div className="alphabet-showcase-sound">
                    Tovushi: «{selected.soundTextUz}»
                  </div>

                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.97 }}
                    className="btn-3d-emerald alphabet-listen-btn btn-with-icon"
                    onClick={() => void playLetterRecallAudio(selected.letter)}
                  >
                    <Volume2 size={20} strokeWidth={2.6} />
                    <span>Eshitish</span>
                  </motion.button>

                  <img
                    src="/images/zukko.webp"
                    alt="Zukko Tulki"
                    className="alphabet-peeking-zukko"
                    draggable={false}
                  />
                </motion.div>
              </aside>
            )}
          </div>
        ) : roundDone ? (
          <motion.section
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="alphabet-game-card"
          >
            <AnimatedCharacter
              mood="celebrating"
              size={128}
              avatarId={avatar.id}
              speechText={`Barakalla! ${queue.length} ta harfni takrorlab, ${roundStars} ta yulduzcha to‘plading!`}
              onReplaySpeech={() => void playPraiseAudio('alphabet_complete')}
            />

            <div className="round-summary-words">
              {roundResults.map(({ entry, perfect, usedVoiceAi }) => (
                <span
                  key={entry.letter}
                  className={`round-word-pill ${
                    perfect ? 'status-badge-mastered' : 'status-badge-syllable'
                  }`}
                >
                  <GameVisual
                    emoji={entry.exampleEmoji}
                    letter={entry.letter}
                    alt={entry.exampleWord}
                    size={22}
                  />
                  <span>{entry.display}</span>
                  <span>{usedVoiceAi ? '🎤' : perfect ? '★' : '✓'}</span>
                </span>
              ))}
            </div>

            <div className="step-actions">
              <button
                type="button"
                className="btn-3d-emerald btn-with-icon"
                onClick={handleStartNewRound}
              >
                <RotateCcw size={18} />
                <span>Yana 5 ta harf o‘ynash</span>
              </button>
              <button
                type="button"
                className="btn-3d-cream"
                onClick={() => handleSwitchMode('chart')}
              >
                Barcha harflarni ko‘rish
              </button>
            </div>
          </motion.section>
        ) : current ? (
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="alphabet-game-card"
          >
            <div className="alphabet-progress-bar">
              <div
                className="duo-progress-track"
                role="progressbar"
                aria-label="Harf o‘yini jarayoni"
                aria-valuenow={idx + 1}
                aria-valuemin={1}
                aria-valuemax={queue.length}
              >
                <div className="duo-progress-fill" style={{ width: `${gameProgressPct}%` }} />
              </div>
              <span className="stars-pill-3d">
                {idx + 1} / {queue.length}
              </span>
            </div>

            {microStep === 'listen_pick' && (
              <div className="step-body">
                <AnimatedCharacter
                  mood={wrongKey ? 'encouraging' : 'speaking'}
                  size={104}
                  avatarId={avatar.id}
                  speechText="Quloq sol! Qaysi harfning tovushi eshitildi?"
                  onReplaySpeech={() => void playInstructionAudio('instr_alpha_listen')}
                />

                <button
                  type="button"
                  className="btn-3d-cream btn-compact btn-with-icon"
                  onClick={() => void playLetterRecallAudio(current.letter)}
                >
                  <Volume2 size={17} />
                  <span>Qayta eshitish</span>
                </button>

                <div className="alphabet-quiz-choices">
                  {choices.map((entry, cIdx) => {
                    const isCorrect = pickedCorrectKey === entry.letter;
                    const isWrong = wrongKey === entry.letter;
                    const accentClass = TILE_ACCENTS[cIdx % TILE_ACCENTS.length];
                    return (
                      <motion.button
                        key={entry.letter}
                        type="button"
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.94 }}
                        animate={isWrong ? { x: [0, -8, 8, -5, 5, 0] } : { x: 0 }}
                        transition={{ duration: 0.35 }}
                        className={`alifbo-3d-tile alphabet-quiz-tile ${accentClass} ${
                          isCorrect ? 'choice-correct' : isWrong ? 'choice-wrong' : ''
                        }`}
                        onClick={() => handlePickLetterChoice(entry)}
                      >
                        <strong className="alifbo-tile-glyph">{entry.display}</strong>
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            )}

            {microStep === 'picture_match' && (
              <div className="step-body">
                <AnimatedCharacter
                  mood={wrongKey ? 'encouraging' : 'speaking'}
                  size={104}
                  avatarId={avatar.id}
                  speechText="Harfga mos rasmni top!"
                  onReplaySpeech={() => void playInstructionAudio('instr_alpha_picture')}
                />

                <div className="alphabet-target-badge">
                  <strong className="pair-upper" style={{ fontSize: 44 }}>
                    {current.display}
                  </strong>
                  <span className="muted-text" style={{ fontSize: 15, fontWeight: 700 }}>
                    Tovushi: «{current.soundTextUz}»
                  </span>
                </div>

                <div className="emoji-choices-row">
                  {choices.map((entry) => {
                    const isCorrect = pickedCorrectKey === entry.letter;
                    const isWrong = wrongKey === entry.letter;
                    return (
                      <motion.button
                        key={entry.letter}
                        type="button"
                        whileHover={{ scale: 1.06 }}
                        whileTap={{ scale: 0.93 }}
                        animate={isWrong ? { x: [0, -8, 8, -5, 5, 0] } : { x: 0 }}
                        className={`emoji-choice-btn ${
                          isCorrect ? 'choice-correct' : isWrong ? 'choice-wrong' : ''
                        }`}
                        onClick={() => handlePickPictureChoice(entry)}
                        aria-label={`${entry.exampleWord} rasmi`}
                      >
                        <GameVisual
                          emoji={entry.exampleEmoji}
                          letter={entry.letter}
                          alt={entry.exampleWord}
                          size={72}
                        />
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            )}

            {microStep === 'say_or_confirm' && (
              <div className="step-body">
                <span className="step-badge">3-qadam · Ovoz chiqarib ayt!</span>

                <div className="alphabet-target-badge">
                  <GameVisual
                    emoji={current.exampleEmoji}
                    letter={current.letter}
                    alt={current.exampleWord}
                    size={76}
                  />
                  <strong className="pair-upper" style={{ fontSize: 38 }}>
                    {current.display}
                  </strong>
                  <span className="alphabet-showcase-word" style={{ fontSize: 22 }}>
                    {current.exampleWord}
                  </span>
                </div>

                <button
                  type="button"
                  className="btn-3d-cream btn-compact btn-with-icon"
                  onClick={() => void playLetterRecallAudio(current.letter)}
                >
                  <Volume2 size={17} />
                  <span>Eshitish</span>
                </button>

                {voiceMsg && (
                  <button
                    type="button"
                    className="feedback-banner feedback-gentle feedback-banner-clickable"
                    onClick={() => void playFeedbackAudio(voiceMsg.audioKey)}
                  >
                    <Volume2 size={16} />
                    <span>{voiceMsg.text}</span>
                  </button>
                )}

                {aiOnline && !sttFallbackActive && current.category !== 'mark' ? (
                  <div className="voice-controls">
                    <button
                      type="button"
                      disabled={isChecking}
                      className={`btn-mic-circle ${isRecording ? 'btn-mic-circle-active' : ''}`}
                      onClick={() => void toggleMicCheck()}
                      aria-label={
                        isChecking
                          ? 'Tekshirilmoqda'
                          : isRecording
                            ? 'Gapirib bo‘ldim'
                            : `Mikrofonga ${current.exampleWord} deb ayt`
                      }
                    >
                      {isRecording ? <Square size={30} fill="currentColor" /> : <Mic size={34} />}
                    </button>
                    <span className="mic-caption">
                      {isChecking
                        ? 'Tekshirilmoqda...'
                        : isRecording
                          ? 'Tinglayapman — gapirib bo‘lgach bosing'
                          : `«${current.exampleWord}» deb ayt`}
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
                      className="btn-3d-cream"
                      onClick={() => {
                        playFeedbackChime('pop');
                        finishCurrentLetter(false);
                      }}
                    >
                      Eshitdim, keyingi harf →
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn-3d-emerald"
                    onClick={() => {
                      playFeedbackChime('pop');
                      finishCurrentLetter(false);
                    }}
                  >
                    Aytdim, davom etamiz! →
                  </button>
                )}
              </div>
            )}
          </motion.section>
        ) : null}
      </main>
    </div>
  );
}
