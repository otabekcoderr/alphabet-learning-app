import { describe, expect, it } from 'vitest';
import {
  createMicAutoStopState,
  SPELLING_FRIENDLY_MIC_CONFIG,
  stepMicAutoStop,
} from '../micAutoStop';
import {
  computeReadingDurations,
  createScaffoldingState,
  markScaffoldingAudioHint,
  pauseScaffoldingForSpeech,
  resumeScaffoldingAfterFalseStart,
  tickScaffolding,
} from '../scaffoldingTimer';
import {
  classifySpokenReadingAttempt,
  isLowConfidence,
  isPronunciationAcceptable,
  validateSttReading,
} from '../sttValidator';

describe('Alifbo 2.2 two-stage Phonetic-Levenshtein STT validator & lexical collision guard', () => {
  it('accepts phonetic equivalents and tutuq/apostrophe variants while rejecting lexical collisions on short and long words', () => {
    expect(isPronunciationAcceptable('KITOB', 'kitop')).toBe(true);
    expect(isPronunciationAcceptable('QOR', 'kor')).toBe(true);
    expect(isPronunciationAcceptable('MAKTAB', 'maktap')).toBe(true);
    expect(isPronunciationAcceptable('VELOSIPED', 'velosipet')).toBe(true);
    expect(isPronunciationAcceptable('SURAT', "sur'at")).toBe(true);
    expect(isPronunciationAcceptable('O‘RDAK', "o'rdak")).toBe(true);

    // Reject lexical collisions and non-phonetic mismatches
    expect(isPronunciationAcceptable('BOLA', 'tola')).toBe(false);
    expect(isPronunciationAcceptable('QOR', 'bor')).toBe(false);
    expect(isPronunciationAcceptable('SALAT', 'savat')).toBe(false);
    expect(isPronunciationAcceptable('ONA', 'ana')).toBe(false);
    expect(isPronunciationAcceptable('TOG‘', "dog'")).toBe(false);
    expect(isPronunciationAcceptable('TOSH', 'tush')).toBe(false);
  });

  it('classifies fluent, syllable, and spelled-out spoken cadence accurately', () => {
    expect(classifySpokenReadingAttempt('KITOB', 'kitob', 2)).toBe('fluent');
    expect(classifySpokenReadingAttempt('KITOB', 'ki tob', 2)).toBe('syllable');
    expect(classifySpokenReadingAttempt('KITOB', 'k i t o b', 2)).toBe('spelled_out');
    expect(classifySpokenReadingAttempt('KITOB', 'k i ki t o b tob kitob', 2)).toBe('spelled_out');
    expect(classifySpokenReadingAttempt('OLMA SHIRIN', 'olma shirin', 4)).toBe('fluent');
    expect(classifySpokenReadingAttempt('OLMA SHIRIN', 'ol ma shi rin', 4)).toBe('syllable');
  });

  it('handles unavailable/null confidence honestly without penalizing valid transcripts', () => {
    expect(isLowConfidence(null, false)).toBe(false);
    expect(isLowConfidence(undefined, false)).toBe(false);
    expect(isLowConfidence(0, false)).toBe(false);
    expect(isLowConfidence(0.35, true)).toBe(true);
    expect(isLowConfidence(0.45, true)).toBe(false);

    const noLogprobsValid = validateSttReading({
      targetWord: 'QOR',
      parts: ['QO', 'R'],
      syllableCount: 1,
      acceptAliases: ['qor'],
      transcript: 'kor',
      isSilence: false,
      confidence: null,
      confidenceAvailable: false,
    });
    expect(noLogprobsValid.decision).toBe('accepted');
    expect(noLogprobsValid.cadence).toBe('fluent');

    const lowConf = validateSttReading({
      targetWord: 'QOR',
      parts: ['QO', 'R'],
      syllableCount: 1,
      acceptAliases: ['qor'],
      transcript: 'qor',
      isSilence: false,
      confidence: 0.3,
      confidenceAvailable: true,
    });
    expect(lowConf.decision).toBe('low_confidence');

    const collision = validateSttReading({
      targetWord: 'SALAT',
      parts: ['SA', 'LAT'],
      syllableCount: 2,
      acceptAliases: ['salat'],
      transcript: 'savat',
      isSilence: false,
      confidence: 0.92,
      confidenceAvailable: true,
    });
    expect(collision.decision).toBe('word_collision');

    const spelled = validateSttReading({
      targetWord: 'KITOB',
      parts: ['KI', 'TOB'],
      syllableCount: 2,
      acceptAliases: ['kitob', 'kitop'],
      transcript: 'k i ki t o b tob kitob',
      isSilence: false,
      confidence: 0.9,
      confidenceAvailable: true,
    });
    expect(spelled.decision).toBe('accepted');
    expect(spelled.cadence).toBe('spelled_out');
  });
});

describe('Alifbo 2.2 mic firstSpeechMs tracking & synchronous scaffolding timer safeguards', () => {
  it('captures firstSpeechMs and lastSpeechMs inside MicAutoStopState', () => {
    let st = createMicAutoStopState(SPELLING_FRIENDLY_MIC_CONFIG);
    expect(st.firstSpeechMs).toBeNull();
    st = stepMicAutoStop(st, 0.002, 100, SPELLING_FRIENDLY_MIC_CONFIG).state;
    st = stepMicAutoStop(st, 0.09, 480, SPELLING_FRIENDLY_MIC_CONFIG).state;
    st = stepMicAutoStop(st, 0.11, 1320, SPELLING_FRIENDLY_MIC_CONFIG).state;
    expect(st.firstSpeechMs).toBe(480);
    expect(st.lastSpeechMs).toBe(1320);

    const durations = computeReadingDurations({
      examRenderTimeMs: 10_000,
      recordingStartWallMs: 11_200,
      firstSpeechMs: st.firstSpeechMs,
      lastSpeechMs: st.lastSpeechMs,
      audioDurationMs: 2800,
    });
    expect(durations.reactionMs).toBe(1680);
    expect(durations.articulationMs).toBe(840);
  });

  it('freezes 4.5s/8.0s scaffolding timers when speech starts so 1950ms post-speech silence never penalizes fluent readers', () => {
    let timer = createScaffoldingState(1000);
    // Child reads at 3200 ms (2200 ms idle)
    timer = tickScaffolding(timer, 3200);
    expect(timer.usedVisualSplit).toBe(false);

    // Synchronous pause on speech start
    timer = pauseScaffoldingForSpeech(timer, 3200);

    // 2950 ms passes while speaking + 1950 ms mic auto-stop silence (wall clock = 6150 ms > 4500 ms!)
    timer = tickScaffolding(timer, 6150);
    expect(timer.usedVisualSplit).toBe(false);
    expect(timer.usedAudioHint).toBe(false);
    expect(timer.accumulatedIdleMs).toBe(2200);
  });

  it('resumes scaffolding timers without deadlock after a false-start noise/cough and unlocks hints at 4.5s and 8.0s', () => {
    let timer = createScaffoldingState(0);
    timer = tickScaffolding(timer, 1500);
    timer = pauseScaffoldingForSpeech(timer, 1500);
    expect(timer.pausedForSpeech).toBe(true);

    // STT returns silence/low confidence at 3500ms -> resume
    timer = resumeScaffoldingAfterFalseStart(timer, 3500);
    expect(timer.pausedForSpeech).toBe(false);
    expect(timer.usedVisualSplit).toBe(false);

    // Another 3000ms idle (total idle 1500 + 3000 = 4500ms) -> visual split opens
    timer = tickScaffolding(timer, 6500);
    expect(timer.usedVisualSplit).toBe(true);
    expect(timer.usedAudioHint).toBe(false);

    // Another 3500ms idle (total idle = 8000ms) -> audio hint opens
    timer = tickScaffolding(timer, 10_000);
    expect(timer.usedAudioHint).toBe(true);

    const forced = markScaffoldingAudioHint(createScaffoldingState(0));
    expect(forced.usedVisualSplit).toBe(true);
    expect(forced.usedAudioHint).toBe(true);
  });
});
