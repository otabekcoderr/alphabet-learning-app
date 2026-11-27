import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BUBBLES_INSTRUCTION_TEXT_UZ,
  computeSessionProgress,
  getLessonInstructionKey,
  shouldRunExamScaffoldingTimer,
} from '../../components/LessonPlayer';
import { tokenizeUzbekLettersOrdered } from '../../components/LetterBlock';
import { DYNAMIC_WORD_POOL, type WordPoolItem } from '../../data/curriculum';
import {
  hasExplicitVisualMapping,
  resolveVisualRenderSrc,
  resolveVisualSrc,
} from '../../data/wordVisuals';
import { INSTRUCTION_FALLBACK_TEXT } from '../../utils/audioRecorder';
import { createBubbleGateState, tapSyllableBubble } from '../bubbleGate';
import { type WordProgress } from '../pedagogy';
import {
  buildInterleavedSessionQueue,
  buildShuffledExerciseQueues,
  evaluateConstructorSelection,
  selectAdaptiveSessionWords,
  shuffleSessionWordsForExercise,
  type AdaptiveSessionWord,
} from '../wordPoolEngine';

describe('ALIFBO 2.3 — Exercise Shuffling, Constructor UX, Bubbles, Next Round & Custom Images', () => {
  it('shuffles session words independently across Stage 1, Stage 2, and Stage 3 without boundary repeats', () => {
    const rawItems = DYNAMIC_WORD_POOL.slice(0, 5);
    const session: AdaptiveSessionWord[] = rawItems.map((item) => ({
      item,
      expressExamOnly: false,
      sourceBucket: 'new',
    }));

    for (let run = 0; run < 50; run++) {
      const queues = buildShuffledExerciseQueues(session);
      const s1Ids = queues.stage1.map((e) => e.item.id);
      const s2Ids = queues.stage2.map((e) => e.item.id);
      const s3Ids = queues.stage3.map((e) => e.item.id);

      const expectedSorted = rawItems.map((i) => i.id).sort();
      expect([...s1Ids].sort()).toEqual(expectedSorted);
      expect([...s2Ids].sort()).toEqual(expectedSorted);
      expect([...s3Ids].sort()).toEqual(expectedSorted);

      expect(s2Ids).not.toEqual(s1Ids);
      expect(s3Ids).not.toEqual(s2Ids);
      expect(s2Ids[0]).not.toBe(s1Ids[s1Ids.length - 1]);
      expect(s3Ids[0]).not.toBe(s2Ids[s2Ids.length - 1]);
    }

    // Even with a completely constant RNG, fallback permutation still avoids identical order & boundary repeats
    const constantZeroRng = () => 0;
    const baseIds = session.map((e) => e.item.id);
    const deterministic = shuffleSessionWordsForExercise(session, baseIds, constantZeroRng);
    expect(deterministic.map((e) => e.item.id)).not.toEqual(baseIds);
    expect(deterministic[0]?.item.id).not.toBe(baseIds[baseIds.length - 1]);
  });

  it('handles mixed expressExamOnly and all-express sessions cleanly in buildShuffledExerciseQueues', () => {
    const rawItems = DYNAMIC_WORD_POOL.slice(0, 4);
    const mixed: AdaptiveSessionWord[] = [
      { item: rawItems[0]!, expressExamOnly: true, sourceBucket: 'mastered_review' },
      { item: rawItems[1]!, expressExamOnly: false, sourceBucket: 'new' },
      { item: rawItems[2]!, expressExamOnly: false, sourceBucket: 'new' },
      { item: rawItems[3]!, expressExamOnly: false, sourceBucket: 'assisted_or_syllable' },
    ];

    const mixedQueues = buildShuffledExerciseQueues(mixed);
    expect(mixedQueues.stage1.map((e) => e.item.id).sort()).toEqual(
      [rawItems[1]!.id, rawItems[2]!.id, rawItems[3]!.id].sort(),
    );
    expect(mixedQueues.stage2.map((e) => e.item.id).sort()).toEqual(
      [rawItems[1]!.id, rawItems[2]!.id, rawItems[3]!.id].sort(),
    );
    expect(mixedQueues.stage3).toHaveLength(4);
    expect(mixedQueues.stage2[0]?.item.id).not.toBe(
      mixedQueues.stage1[mixedQueues.stage1.length - 1]?.item.id,
    );

    const allExpress: AdaptiveSessionWord[] = rawItems.slice(0, 3).map((item) => ({
      item,
      expressExamOnly: true,
      sourceBucket: 'mastered_review',
    }));
    const expressQueues = buildShuffledExerciseQueues(allExpress);
    expect(expressQueues.stage1).toHaveLength(0);
    expect(expressQueues.stage2).toHaveLength(0);
    expect(expressQueues.stage3).toHaveLength(3);
  });

  it('evaluates Constructor Tanla va Tekshirish state and tokenizes Uzbek digraphs cleanly', () => {
    expect(evaluateConstructorSelection(null, 'MA')).toBe('no_selection');
    expect(evaluateConstructorSelection('NA', 'MA')).toBe('wrong');
    expect(evaluateConstructorSelection('MA', 'MA')).toBe('correct');

    expect(tokenizeUzbekLettersOrdered('SHIR')).toEqual(['SH', 'I', 'R']);
    expect(tokenizeUzbekLettersOrdered('G‘OCH')).toEqual(['G‘', 'O', 'CH']);
    expect(tokenizeUzbekLettersOrdered('TONG')).toEqual(['T', 'O', 'NG']);
    expect(tokenizeUzbekLettersOrdered('O‘R')).toEqual(['O‘', 'R']);
  });

  it('keeps wrong Bubbles intact without advancing confirmedCount while allowing subsequent correct pops', () => {
    let gate = createBubbleGateState(['AR', 'RA']);
    const wrongTap = tapSyllableBubble(gate, 'LA', { isOfflineMode: true, nowMs: 100 });
    expect(wrongTap.result).toBe('wrong');
    gate = wrongTap.state;
    expect(gate.confirmedCount).toBe(0);
    expect(gate.phase).toBe('pick_bubble');

    const rightTap = tapSyllableBubble(gate, 'AR', { isOfflineMode: true, nowMs: 250 });
    expect(rightTap.result).toBe('accepted_offline_pause');
    expect(rightTap.state.activePart).toBe('AR');
  });

  it('selects fresh non-overlapping words when recentSessionWordIds is passed for next round', () => {
    const firstRound = selectAdaptiveSessionWords({
      worldId: 1,
      pool: DYNAMIC_WORD_POOL,
      wordProgressMap: {},
      todayStr: '2026-11-23',
    });
    expect(firstRound).toHaveLength(3);
    const firstIds = firstRound.map((e) => e.item.id);

    // Simulate all 3 words from round 1 finishing offline with pendingVoiceVerify
    const progressAfterRound1: Record<string, WordProgress> = {};
    for (const id of firstIds) {
      progressAfterRound1[id] = {
        wordId: id,
        status: 'assisted',
        reviewIntervalDays: 0,
        nextReviewDate: '2026-11-23',
        attemptCount: 1,
        assistedCount: 1,
        pendingVoiceVerify: true,
      };
    }

    const secondRound = selectAdaptiveSessionWords({
      worldId: 1,
      pool: DYNAMIC_WORD_POOL,
      wordProgressMap: progressAfterRound1,
      todayStr: '2026-11-23',
      recentSessionWordIds: firstIds,
    });
    expect(secondRound).toHaveLength(3);
    for (const entry of secondRound) {
      expect(firstIds).not.toContain(entry.item.id);
    }

    // Without recentSessionWordIds, existing adaptive behavior remains deterministic
    const defaultRetry = selectAdaptiveSessionWords({
      worldId: 1,
      pool: DYNAMIC_WORD_POOL,
      wordProgressMap: progressAfterRound1,
      todayStr: '2026-11-23',
    });
    expect(defaultRetry.some((e) => firstIds.includes(e.item.id))).toBe(true);

    // Fallback when all world items were in recentSessionWordIds still returns items
    const allWorldIds = DYNAMIC_WORD_POOL.filter((w) => w.worldId === 1).map((w) => w.id);
    const fallbackRound = selectAdaptiveSessionWords({
      worldId: 1,
      pool: DYNAMIC_WORD_POOL,
      wordProgressMap: {},
      todayStr: '2026-11-23',
      recentSessionWordIds: allWorldIds,
    });
    expect(fallbackRound.length).toBeGreaterThan(0);
  });

  it('supports optional image?: string with clean fallback to mapped SVG/emoji when omitted or blank', () => {
    const baseArra = DYNAMIC_WORD_POOL.find((w) => w.id === 'arra')!;
    const withCustomWebp: WordPoolItem = {
      ...baseArra,
      image: '/images/words/arra.webp',
    };

    expect(
      hasExplicitVisualMapping({
        emoji: withCustomWebp.emoji,
        image: withCustomWebp.image,
        wordId: withCustomWebp.id,
      }),
    ).toBe(true);
    expect(
      resolveVisualSrc({
        emoji: withCustomWebp.emoji,
        image: withCustomWebp.image,
        wordId: withCustomWebp.id,
      }),
    ).toBe('/images/words/arra.webp');
    expect(
      resolveVisualRenderSrc({
        emoji: withCustomWebp.emoji,
        image: withCustomWebp.image,
        wordId: withCustomWebp.id,
      }),
    ).toBe('/images/words/arra.webp');

    // Blank/omitted image falls back to existing SVG mapping
    expect(
      resolveVisualSrc({
        emoji: baseArra.emoji,
        image: '   ',
        wordId: baseArra.id,
      }),
    ).toBe('/images/words/arra.svg');
    expect(
      resolveVisualSrc({
        emoji: '🍎',
      }),
    ).toBe('/images/emoji/1f34e.svg');
  });
});

describe('Vazifa 1.1 — Zinapoya (Interleaved) Queue & Bubbles Instruction', () => {
  it('builds exact Zinapoya sequence for 3 words A, B, C with sequential stage1OrderIndex', () => {
    const rawItems = DYNAMIC_WORD_POOL.slice(0, 3);
    const [A, B, C] = rawItems;
    const session: AdaptiveSessionWord[] = rawItems.map((item) => ({
      item,
      expressExamOnly: false,
      sourceBucket: 'new',
    }));

    const queue = buildInterleavedSessionQueue(session);
    expect(queue).toHaveLength(9);

    const labels = queue.map((step) => `${step.stage}(${step.entry.item.id})`);
    expect(labels).toEqual([
      `1(${A!.id})`,
      `1(${B!.id})`,
      `2(${A!.id})`,
      `1(${C!.id})`,
      `2(${B!.id})`,
      `3(${A!.id})`,
      `2(${C!.id})`,
      `3(${B!.id})`,
      `3(${C!.id})`,
    ]);

    expect(queue.map((step) => step.phase)).toEqual([
      'stage1_build',
      'stage1_build',
      'stage2_spotlight',
      'stage1_build',
      'stage2_spotlight',
      'exam',
      'stage2_spotlight',
      'exam',
      'exam',
    ]);

    expect(queue.filter((s) => s.stage === 1).map((s) => s.stage1OrderIndex)).toEqual([0, 1, 2]);
    expect(queue.filter((s) => s.stage !== 1).every((s) => s.stage1OrderIndex === null)).toBe(true);
  });

  it('satisfies general N-word Zinapoya invariants for N = 1..6', () => {
    for (const n of [1, 2, 3, 4, 5, 6]) {
      const rawItems = DYNAMIC_WORD_POOL.slice(0, n);
      const session: AdaptiveSessionWord[] = rawItems.map((item) => ({
        item,
        expressExamOnly: false,
        sourceBucket: 'new',
      }));

      const queue = buildInterleavedSessionQueue(session);
      expect(queue).toHaveLength(3 * n);

      for (const item of rawItems) {
        const idx1 = queue.findIndex((s) => s.stage === 1 && s.entry.item.id === item.id);
        const idx2 = queue.findIndex((s) => s.stage === 2 && s.entry.item.id === item.id);
        const idx3 = queue.findIndex((s) => s.stage === 3 && s.entry.item.id === item.id);
        expect(idx1).toBeGreaterThanOrEqual(0);
        expect(idx2).toBeGreaterThan(idx1);
        expect(idx3).toBeGreaterThan(idx2);
        expect(queue.filter((s) => s.entry.item.id === item.id)).toHaveLength(3);
      }

      if (n >= 2) {
        for (let i = 1; i < queue.length; i++) {
          expect(queue[i]!.entry.item.id).not.toBe(queue[i - 1]!.entry.item.id);
        }
      }

      if (n >= 3) {
        let sameStageAdj = 0;
        for (let i = 1; i < queue.length; i++) {
          if (queue[i]!.stage === queue[i - 1]!.stage) {
            sameStageAdj += 1;
          }
        }
        expect(sameStageAdj).toBeLessThanOrEqual(2);
      }

      expect(queue.filter((s) => s.stage === 1).map((s) => s.stage1OrderIndex)).toEqual(
        Array.from({ length: n }, (_, i) => i),
      );
      expect(queue.filter((s) => s.stage !== 1).every((s) => s.stage1OrderIndex === null)).toBe(
        true,
      );
    }
  });

  it('handles empty, all-express, and mixed expressExamOnly + full-pipeline sessions', () => {
    expect(buildInterleavedSessionQueue([])).toEqual([]);

    const rawItems = DYNAMIC_WORD_POOL.slice(0, 5);

    const allExpress: AdaptiveSessionWord[] = rawItems.slice(0, 3).map((item) => ({
      item,
      expressExamOnly: true,
      sourceBucket: 'mastered_review',
    }));
    const expressQueue = buildInterleavedSessionQueue(allExpress);
    expect(expressQueue).toHaveLength(3);
    expect(expressQueue.every((s) => s.stage === 3 && s.phase === 'exam' && s.stage1OrderIndex === null)).toBe(true);
    for (let i = 1; i < expressQueue.length; i++) {
      expect(expressQueue[i]!.entry.item.id).not.toBe(expressQueue[i - 1]!.entry.item.id);
    }

    const cases: Array<{ fullCount: number; expressCount: number }> = [
      { fullCount: 1, expressCount: 2 },
      { fullCount: 2, expressCount: 2 },
      { fullCount: 3, expressCount: 2 },
    ];

    for (const { fullCount, expressCount } of cases) {
      const fullSlice = rawItems.slice(0, fullCount).map(
        (item): AdaptiveSessionWord => ({
          item,
          expressExamOnly: false,
          sourceBucket: 'new',
        }),
      );
      const expressSlice = rawItems.slice(fullCount, fullCount + expressCount).map(
        (item): AdaptiveSessionWord => ({
          item,
          expressExamOnly: true,
          sourceBucket: 'mastered_review',
        }),
      );
      const mixed = [...fullSlice, ...expressSlice];
      const queue = buildInterleavedSessionQueue(mixed);

      expect(queue).toHaveLength(3 * fullCount + expressCount);
      expect(queue.filter((s) => s.stage === 3)).toHaveLength(mixed.length);

      for (let i = 1; i < queue.length; i++) {
        expect(queue[i]!.entry.item.id).not.toBe(queue[i - 1]!.entry.item.id);
      }

      for (const { item } of fullSlice) {
        const idx1 = queue.findIndex((s) => s.stage === 1 && s.entry.item.id === item.id);
        const idx2 = queue.findIndex((s) => s.stage === 2 && s.entry.item.id === item.id);
        const idx3 = queue.findIndex((s) => s.stage === 3 && s.entry.item.id === item.id);
        expect(idx1).toBeGreaterThanOrEqual(0);
        expect(idx2).toBeGreaterThan(idx1);
        expect(idx3).toBeGreaterThan(idx2);
      }
    }
  });

  it('computes progress bar metrics accurately across a 9-step (3-word) session', () => {
    let prevPct = -1;
    for (let stepIdx = 0; stepIdx < 9; stepIdx++) {
      const active = computeSessionProgress({
        stepIdx,
        totalSteps: 9,
        isWordDone: false,
      });
      expect(active.totalSteps).toBe(9);
      expect(active.currentStepDisplay).toBe(stepIdx + 1);
      expect(active.progressPct).toBeGreaterThanOrEqual(prevPct);
      prevPct = active.progressPct;

      if (stepIdx === 5 || stepIdx === 7 || stepIdx === 8) {
        const done = computeSessionProgress({
          stepIdx,
          totalSteps: 9,
          isWordDone: true,
        });
        expect(done.completedSteps).toBe(stepIdx + 1);
        expect(done.currentStepDisplay).toBe(stepIdx + 1);
        expect(done.progressPct).toBeGreaterThanOrEqual(prevPct);
        prevPct = done.progressPct;
        if (stepIdx === 8) {
          expect(done.progressPct).toBe(100);
        }
      }
    }
  });

  it('keeps Bubbles instruction text and dedicated audio key synchronized', () => {
    const expectedText = 'Rasmga qara! Uning nomidagi bo‘g‘inlarni ketma-ket yor!';
    expect(BUBBLES_INSTRUCTION_TEXT_UZ).toBe(expectedText);
    expect(INSTRUCTION_FALLBACK_TEXT.instr_stage1_bubbles).toBe(expectedText);
    expect(
      getLessonInstructionKey({
        wordPhase: 'stage1_build',
        buildGameMode: 'bubbles',
        itemKind: 'word',
        isOfflineFallbackActive: false,
      }),
    ).toBe('instr_stage1_bubbles');
  });

  it('guards instruction text/audio parity with VoiceLab lison-v2 Malika and prevents round-end scaffolding leak', () => {
    const rootDir = path.resolve(__dirname, '..', '..', '..');
    const cachePath = path.join(rootDir, 'public', 'audio', '.offline_tts_cache.json');
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as Record<
      string,
      { provider?: string; voice?: string; text?: string }
    >;
    const csvText = fs.readFileSync(path.join(rootDir, 'audio_review.csv'), 'utf8');

    const phoneticCyrillicOverrides = new Set([
      'instr_bismillah_speak',
      'instr_alhamdulillah_speak',
    ]);

    for (const [key, fallbackText] of Object.entries(INSTRUCTION_FALLBACK_TEXT)) {
      const mp3Name = `${key}.mp3`;
      const mp3Path = path.join(rootDir, 'public', 'audio', mp3Name);
      expect(fs.existsSync(mp3Path), `Missing MP3 for ${key}`).toBe(true);
      expect(fs.statSync(mp3Path).size, `Empty MP3 for ${key}`).toBeGreaterThan(1000);
      expect(fallbackText.toLowerCase(), `Unexpected "yoritib" in ${key}`).not.toContain('yoritib');

      const cached = cache[mp3Name];
      expect(cached, `Missing cache entry for ${mp3Name}`).toBeDefined();
      expect(cached?.provider).toBe('voicelab');
      expect(cached?.voice).toContain('malika');
      if (!phoneticCyrillicOverrides.has(key)) {
        expect(cached?.text, `Text mismatch between UI fallback and TTS cache for ${mp3Name}`).toBe(
          fallbackText,
        );
      }
      expect(csvText, `Missing ${mp3Name} in audio_review.csv`).toContain(`public/audio/${mp3Name}`);
    }

    // Bug #4 regression: Stage 3 scaffolding timer must NOT run once roundFinished is true
    expect(
      shouldRunExamScaffoldingTimer({
        roundFinished: true,
        wordPhase: 'exam',
        hasCurrentItem: true,
        isOfflineFallbackActive: false,
      }),
    ).toBe(false);
    expect(
      shouldRunExamScaffoldingTimer({
        roundFinished: false,
        wordPhase: 'exam',
        hasCurrentItem: true,
        isOfflineFallbackActive: false,
      }),
    ).toBe(true);
    expect(
      shouldRunExamScaffoldingTimer({
        roundFinished: false,
        wordPhase: 'exam',
        hasCurrentItem: true,
        isOfflineFallbackActive: true,
      }),
    ).toBe(false);

    const lessonPlayerSrc = fs.readFileSync(
      path.join(rootDir, 'src', 'components', 'LessonPlayer.tsx'),
      'utf8',
    );
    expect(lessonPlayerSrc).toContain('if (roundFinished || wordPhase === \'word_done\') return;');
    expect(lessonPlayerSrc).toContain('shouldRunExamScaffoldingTimer({');
    expect(lessonPlayerSrc).toContain('examRevealedRef.current = true;');
    expect(lessonPlayerSrc).toContain('audioHintPlayedRef.current = true;');
  });
});
