import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLessonInstructionKey } from '../../components/LessonPlayer';
import {
  ALIFBE_LETTERS_29,
  DYNAMIC_WORD_POOL,
  READING_WORLDS,
  toSyllableSlug,
} from '../../data/curriculum';
import { resolveVisualSrc } from '../../data/wordVisuals';
import {
  FEEDBACK_FALLBACK_TEXT,
  INSTRUCTION_FALLBACK_TEXT,
  playInstructionAudio,
  playInstructionAutoOnEntry,
  resetSessionEntryAudioState,
  speakUzbekText,
  stopActiveAudio,
} from '../../utils/audioRecorder';
import { playSfx } from '../../utils/soundEffects';
import {
  applyBubbleSpeechResult,
  BUBBLE_OFFLINE_PAUSE_MS,
  buildSyllableAcceptAliases,
  completeOfflineSyllablePause,
  confirmOfflineBubblePicture,
  createBubbleGateState,
  tapSyllableBubble,
} from '../bubbleGate';
import { AVATAR_OPTIONS, resolveMascotPresentation } from '../gamification';
import {
  getOfflineFallbackEmojiChoices,
  getSentenceComprehensionAudioKey,
} from '../wordPoolEngine';

interface NodeDirEntry {
  name: string;
  isDirectory(): boolean;
}

interface NodeFsSubset {
  existsSync(path: URL): boolean;
  statSync(path: URL): { size: number };
  readFileSync(path: URL, encoding: 'utf8'): string;
  readdirSync(path: URL, options: { withFileTypes: true }): NodeDirEntry[];
}

async function getNodeFs(): Promise<NodeFsSubset> {
  const modId = 'node:fs';
  return (await import(/* @vite-ignore */ modId)) as NodeFsSubset;
}

const PROJECT_ROOT_URL = new URL('../../../', import.meta.url);
const PUBLIC_DIR_URL = new URL('public/', PROJECT_ROOT_URL);
const AUDIO_DIR_URL = new URL('public/audio/', PROJECT_ROOT_URL);

function readSvgOnDisk(fs: NodeFsSubset, publicRelPath: string): string {
  const rel = publicRelPath.replace(/^\//, '');
  const absUrl = new URL(rel, PUBLIC_DIR_URL);
  expect(fs.existsSync(absUrl), `Missing SVG asset on disk: ${absUrl.href}`).toBe(true);
  const content = fs.readFileSync(absUrl, 'utf8');
  expect(content).toContain('<svg');
  return content;
}

describe('Alifbo 2.2 Live Test Fixes: Mascot, Visuals, Audio, Bubble Gate & Security', () => {
  it('resolves Zukko Tulki strictly to Fox SVG while showing Panda only when user selected Panda', () => {
    const defaultFox = resolveMascotPresentation({ avatarId: 'fox' });
    expect(defaultFox).toEqual({
      avatarId: 'fox',
      name: 'Zukko Tulki',
      emoji: '🦊',
      usesFoxSvg: true,
    });

    // Guard against mismatched name="Zukko Tulki" + avatarId="panda"
    const guarded = resolveMascotPresentation({
      avatarId: 'panda',
      explicitName: 'Zukko Tulki',
    });
    expect(guarded.avatarId).toBe('fox');
    expect(guarded.usesFoxSvg).toBe(true);
    expect(guarded.emoji).toBe('🦊');

    const userPanda = resolveMascotPresentation({ avatarId: 'panda' });
    expect(userPanda).toEqual({
      avatarId: 'panda',
      name: 'Quvnoq Panda',
      emoji: '🐼',
      usesFoxSvg: false,
    });

    expect(AVATAR_OPTIONS).toHaveLength(8);
    expect(new Set(AVATAR_OPTIONS.map((a) => a.mascotName)).size).toBe(8);
  });

  it('audits all 138 words, distractors, 30 letters, 5 worlds & 8 avatars to valid local SVG files', async () => {
    const fs = await getNodeFs();

    for (const item of DYNAMIC_WORD_POOL) {
      const targetSrc = resolveVisualSrc({ emoji: item.emoji, wordId: item.id });
      expect(targetSrc.endsWith('.svg')).toBe(true);
      readSvgOnDisk(fs, targetSrc);

      for (const distEmoji of item.distractorEmojis) {
        const distSrc = resolveVisualSrc({ emoji: distEmoji });
        expect(distSrc.endsWith('.svg')).toBe(true);
        readSvgOnDisk(fs, distSrc);
      }
    }

    for (const entry of ALIFBE_LETTERS_29) {
      const letterSrc = resolveVisualSrc({ emoji: entry.exampleEmoji, letter: entry.letter });
      expect(letterSrc.endsWith('.svg')).toBe(true);
      readSvgOnDisk(fs, letterSrc);
    }

    for (const world of READING_WORLDS) {
      const worldSrc = resolveVisualSrc({ emoji: world.icon });
      expect(worldSrc.endsWith('.svg')).toBe(true);
      readSvgOnDisk(fs, worldSrc);
    }

    for (const av of AVATAR_OPTIONS) {
      const avSrc = resolveVisualSrc({ emoji: av.emoji });
      expect(avSrc.endsWith('.svg')).toBe(true);
      readSvgOnDisk(fs, avSrc);
    }

    // Specific fixes required from live testing
    const doska = DYNAMIC_WORD_POOL.find((w) => w.id === 'doska')!;
    expect(doska.emoji).not.toBe('🧑‍🏫');
    expect(resolveVisualSrc({ emoji: doska.emoji, wordId: doska.id })).toBe(
      '/images/words/doska.svg',
    );

    const anor = DYNAMIC_WORD_POOL.find((w) => w.id === 'anor')!;
    const letterA = ALIFBE_LETTERS_29.find((l) => l.letter === 'A')!;
    expect(anor.emoji).not.toBe('🫐');
    expect(letterA.exampleEmoji).not.toBe('🫐');
    expect(resolveVisualSrc({ emoji: anor.emoji, wordId: anor.id })).toBe(
      '/images/words/anor.svg',
    );
    expect(resolveVisualSrc({ emoji: letterA.exampleEmoji, letter: 'A' })).toBe(
      '/images/words/anor.svg',
    );

    const dasturxon = DYNAMIC_WORD_POOL.find((w) => w.id === 'dasturxon')!;
    expect(resolveVisualSrc({ emoji: dasturxon.emoji, wordId: dasturxon.id })).toBe(
      '/images/words/dasturxon.svg',
    );
    const dasturxon3 = [dasturxon.emoji, ...dasturxon.distractorEmojis];
    expect(dasturxon3).toContain(dasturxon.emoji);
    const dasturxon4 = getOfflineFallbackEmojiChoices(dasturxon, DYNAMIC_WORD_POOL);
    expect(dasturxon4).toHaveLength(4);
    expect(dasturxon4).toContain(dasturxon.emoji);

    const expectedCustomPaths: Array<[string, string]> = [
      ['malina', '/images/words/malina.svg'],
      ['paxta', '/images/words/paxta.svg'],
      ['ninachi', '/images/words/ninachi.svg'],
      ['qalamdon', '/images/words/qalamdon.svg'],
      ['kitobxon', '/images/words/kitobxon.svg'],
      ['orik', '/images/words/orik.svg'],
    ];
    for (const [id, expectedPath] of expectedCustomPaths) {
      const item = DYNAMIC_WORD_POOL.find((w) => w.id === id)!;
      expect(resolveVisualSrc({ emoji: item.emoji, wordId: item.id })).toBe(expectedPath);
    }
  });

  it('verifies plain neutral letters, 100% static AI voice coverage, audio_review.csv, SFX, and Stage 3 scaffolding guard', async () => {
    const fs = await getNodeFs();
    const reviewCsv = fs
      .readFileSync(new URL('audio_review.csv', PROJECT_ROOT_URL), 'utf8')
      .replace(/^\uFEFF/, '');
    expect(reviewCsv.toLowerCase()).not.toContain('temporary');

    // No exaggerated repeated letter strings or exclamation marks in plain neutral ALIFBE_LETTERS_29
    const forbiddenRepeated =
      /Aaaaa|Ooooo|Iiiii|Uuuuu|Eeeee|Nnnnn|Mmmmm|Lllll|Rrrrr|Sssss|Zzzzz|Shshsh|Vvvvv|Yyyy|Hhhh|Xxxx|Ffff|O‘o‘o‘|G‘g‘g‘/;
    for (const entry of ALIFBE_LETTERS_29) {
      expect(forbiddenRepeated.test(entry.phoneticTtsPrompt), entry.letter).toBe(false);
      expect(entry.phoneticTtsPrompt).not.toContain('!');
      expect(forbiddenRepeated.test(entry.soundTextUz), entry.letter).toBe(false);
    }

    // All 30 Alifbe letters have non-null recall + sound MP3s on disk and in audio_review.csv
    for (const entry of ALIFBE_LETTERS_29) {
      const recallRel = entry.audioRecall.replace(/^\//, '');
      const soundRel = entry.audioSound.replace(/^\//, '');
      const recallUrl = new URL(recallRel, PUBLIC_DIR_URL);
      const soundUrl = new URL(soundRel, PUBLIC_DIR_URL);

      expect(fs.existsSync(recallUrl), `Missing letter recall clip: ${recallRel}`).toBe(true);
      expect(fs.statSync(recallUrl).size).toBeGreaterThan(1000);
      expect(fs.existsSync(soundUrl), `Missing letter sound clip: ${soundRel}`).toBe(true);
      expect(fs.statSync(soundUrl).size).toBeGreaterThan(1000);

      expect(reviewCsv).toContain(`public/${recallRel}`);
      expect(reviewCsv).toContain(`public/${soundRel}`);
    }

    // Trimmed sound_x.mp3 sanity check (< 100 KB, > 5 KB)
    const soundXSize = fs.statSync(new URL('sound_x.mp3', AUDIO_DIR_URL)).size;
    expect(soundXSize).toBeGreaterThan(5000);
    expect(soundXSize).toBeLessThan(100_000);

    // All 27 instruction keys and all 18 child-facing feedback keys have valid MP3s & CSV rows
    const instrKeys = Object.keys(INSTRUCTION_FALLBACK_TEXT);
    expect(instrKeys).toHaveLength(27);
    for (const key of instrKeys) {
      const val = INSTRUCTION_FALLBACK_TEXT[key as keyof typeof INSTRUCTION_FALLBACK_TEXT];
      expect(val.trim().length).toBeGreaterThan(8);
      const fileUrl = new URL(`${key}.mp3`, AUDIO_DIR_URL);
      expect(fs.existsSync(fileUrl), `Missing instruction clip: ${key}.mp3`).toBe(true);
      expect(fs.statSync(fileUrl).size).toBeGreaterThan(1000);
      expect(reviewCsv).toContain(`public/audio/${key}.mp3`);
    }

    const feedbackKeys = Object.keys(FEEDBACK_FALLBACK_TEXT);
    expect(feedbackKeys).toHaveLength(18);
    for (const key of feedbackKeys) {
      const val = FEEDBACK_FALLBACK_TEXT[key as keyof typeof FEEDBACK_FALLBACK_TEXT];
      expect(val.trim().length).toBeGreaterThan(8);
      const fileUrl = new URL(`${key}.mp3`, AUDIO_DIR_URL);
      expect(fs.existsSync(fileUrl), `Missing feedback clip: ${key}.mp3`).toBe(true);
      expect(fs.statSync(fileUrl).size).toBeGreaterThan(1000);
      expect(reviewCsv).toContain(`public/audio/${key}.mp3`);
    }

    // All 5 wrong feedback + 6 praise clips present & tracked
    for (const fname of [
      'wrong_1.mp3',
      'wrong_2.mp3',
      'wrong_3.mp3',
      'wrong_4.mp3',
      'wrong_5.mp3',
      'praise_1.mp3',
      'praise_2.mp3',
      'praise_3.mp3',
      'praise_4.mp3',
      'praise_round_complete.mp3',
      'praise_alphabet_complete.mp3',
    ]) {
      const fileUrl = new URL(fname, AUDIO_DIR_URL);
      expect(fs.existsSync(fileUrl), `Missing clip: ${fname}`).toBe(true);
      expect(fs.statSync(fileUrl).size).toBeGreaterThan(1000);
      expect(reviewCsv).toContain(`public/audio/${fname}`);
    }

    // All 139 dynamic word pool audio files + all World 4 syllable clips present & tracked
    const checkedSylSlugs = new Set<string>();
    for (const item of DYNAMIC_WORD_POOL) {
      expect(item.audioSound).toBeTruthy();
      const wordRel = (item.audioSound ?? '').replace(/^\//, '');
      const wordUrl = new URL(wordRel, PUBLIC_DIR_URL);
      expect(fs.existsSync(wordUrl), `Missing word audio: ${wordRel}`).toBe(true);
      expect(fs.statSync(wordUrl).size).toBeGreaterThan(1000);
      expect(reviewCsv).toContain(`public/${wordRel}`);

      if (item.worldId === 4) {
        for (const part of item.parts) {
          const slug = toSyllableSlug(part);
          if (slug && !checkedSylSlugs.has(slug)) {
            checkedSylSlugs.add(slug);
            const sylName = `syl_${slug}.mp3`;
            const sylUrl = new URL(sylName, AUDIO_DIR_URL);
            expect(fs.existsSync(sylUrl), `Missing syllable audio: ${sylName}`).toBe(true);
            expect(fs.statSync(sylUrl).size).toBeGreaterThan(1000);
            expect(reviewCsv).toContain(`public/audio/${sylName}`);
          }
        }
      }
    }

    // Comprehension audio key maps all 4 World 5 sentence branches
    const eatItem = DYNAMIC_WORD_POOL.find((w) => w.id === 'gap_quyon_sabzi')!;
    const moveItem = DYNAMIC_WORD_POOL.find((w) => w.id === 'gap_kapalak_uchdi')!;
    const natureItem = DYNAMIC_WORD_POOL.find((w) => w.id === 'gap_quyosh_chiqdi')!;
    const genericItem = DYNAMIC_WORD_POOL.find((w) => w.id === 'gap_olma_shirin')!;
    expect(getSentenceComprehensionAudioKey(eatItem)).toBe('instr_comp_eat');
    expect(getSentenceComprehensionAudioKey(moveItem)).toBe('instr_comp_move');
    expect(getSentenceComprehensionAudioKey(natureItem)).toBe('instr_comp_nature');
    expect(getSentenceComprehensionAudioKey(genericItem)).toBe('instr_comprehension_action');

    // All SFX variants execute cleanly in headless/Node environment
    for (const kind of ['pop', 'marimba', 'chime', 'soft-bonk', 'celebration'] as const) {
      expect(() => playSfx(kind)).not.toThrow();
    }

    // Stage 3 Exam only plays generic exam instruction, never target word audio
    expect(
      getLessonInstructionKey({
        wordPhase: 'exam',
        buildGameMode: 'bubbles',
        itemKind: 'word',
        isOfflineFallbackActive: false,
      }),
    ).toBe('instr_stage3_exam_voice_word');
    expect(
      getLessonInstructionKey({
        wordPhase: 'exam',
        buildGameMode: 'constructor',
        itemKind: 'word',
        isOfflineFallbackActive: true,
      }),
    ).toBe('instr_stage3_exam_offline_word');
    expect(
      getLessonInstructionKey({
        wordPhase: 'exam',
        buildGameMode: 'sentence_builder',
        itemKind: 'sentence',
        isOfflineFallbackActive: true,
      }),
    ).toBe('instr_stage3_exam_offline_sentence');
    expect(
      getLessonInstructionKey({
        wordPhase: 'word_done',
        buildGameMode: 'bubbles',
        itemKind: 'word',
        isOfflineFallbackActive: true,
      }),
    ).toBeNull();
  });

  it('blocks rapid-tap bypass in World 4 Syllable Bubbles in both offline and online STT modes', () => {
    const parts = ['KA', 'PA', 'LAK'];

    // 1. Offline mode: rapid consecutive taps must be ignored during mandatory pause, and picture match is required
    let offState = createBubbleGateState(parts);
    const tap1 = tapSyllableBubble(offState, 'KA', { isOfflineMode: true, nowMs: 1000 });
    expect(tap1.result).toBe('accepted_offline_pause');
    offState = tap1.state;
    expect(offState.phase).toBe('audio_pause');

    // Immediate rapid tap on second bubble MUST be locked_ignored
    const rapidTap = tapSyllableBubble(offState, 'PA', { isOfflineMode: true, nowMs: 1150 });
    expect(rapidTap.result).toBe('locked_ignored');
    expect(rapidTap.state.confirmedCount).toBe(0);

    // Attempting early unlock before BUBBLE_OFFLINE_PAUSE_MS refuses to unlock
    const earlyUnlock = completeOfflineSyllablePause(offState, 1000 + BUBBLE_OFFLINE_PAUSE_MS - 100);
    expect(earlyUnlock.phase).toBe('audio_pause');
    expect(earlyUnlock.confirmedCount).toBe(0);

    // Full pause unlocks next bubble
    offState = completeOfflineSyllablePause(offState, 1000 + BUBBLE_OFFLINE_PAUSE_MS);
    expect(offState.phase).toBe('pick_bubble');
    expect(offState.confirmedCount).toBe(1);

    // Wrong bubble tap is counted cleanly
    const wrongTap = tapSyllableBubble(offState, 'LAK', { isOfflineMode: true, nowMs: 2600 });
    expect(wrongTap.result).toBe('wrong');
    offState = wrongTap.state;
    expect(offState.wrongBubbleTaps).toBe(1);

    // Finish PA & LAK with full pauses -> must land on offline_word_confirm (NOT completed)
    offState = tapSyllableBubble(offState, 'PA', { isOfflineMode: true, nowMs: 3000 }).state;
    offState = completeOfflineSyllablePause(offState, 3000 + BUBBLE_OFFLINE_PAUSE_MS);
    offState = tapSyllableBubble(offState, 'LAK', { isOfflineMode: true, nowMs: 5000 }).state;
    offState = completeOfflineSyllablePause(offState, 5000 + BUBBLE_OFFLINE_PAUSE_MS);
    expect(offState.phase).toBe('offline_word_confirm');

    // Wrong picture tap cannot complete
    offState = confirmOfflineBubblePicture(offState, false);
    expect(offState.phase).toBe('offline_word_confirm');
    expect(offState.wrongPictureTaps).toBe(1);

    // Correct picture tap completes
    offState = confirmOfflineBubblePicture(offState, true);
    expect(offState.phase).toBe('completed');

    // 2. Online STT mode: requires spoken verification for every bubble + final assembled word
    let onState = createBubbleGateState(parts);
    const onTap1 = tapSyllableBubble(onState, 'KA', { isOfflineMode: false, nowMs: 100 });
    expect(onTap1.result).toBe('accepted_need_speech');
    onState = onTap1.state;
    expect(onState.phase).toBe('awaiting_syllable_speech');

    // Rapid tap on PA while awaiting speech for KA is ignored
    expect(tapSyllableBubble(onState, 'PA', { isOfflineMode: false, nowMs: 200 }).result).toBe(
      'locked_ignored',
    );

    // Failed speech increments failure counter without advancing
    onState = applyBubbleSpeechResult(onState, false);
    expect(onState.speechFailuresInStep).toBe(1);
    expect(onState.confirmedCount).toBe(0);

    // Accepted speech unlocks next bubble
    onState = applyBubbleSpeechResult(onState, true);
    expect(onState.confirmedCount).toBe(1);
    expect(onState.phase).toBe('pick_bubble');

    onState = tapSyllableBubble(onState, 'PA', { isOfflineMode: false, nowMs: 300 }).state;
    onState = applyBubbleSpeechResult(onState, true);
    onState = tapSyllableBubble(onState, 'LAK', { isOfflineMode: false, nowMs: 400 }).state;
    onState = applyBubbleSpeechResult(onState, true);
    expect(onState.phase).toBe('awaiting_word_speech');

    // Must read full word aloud before completed
    onState = applyBubbleSpeechResult(onState, true);
    expect(onState.phase).toBe('completed');

    expect(buildSyllableAcceptAliases('QO‘')).toContain("qo'");
    expect(buildSyllableAcceptAliases('QO‘')).toContain('qo');
  });

  afterEach(() => {
    stopActiveAudio();
    resetSessionEntryAudioState();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('auto-plays welcome greeting once per session with autoplay unlock without falling back to /api/tts', async () => {
    const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

    // 1. NotAllowedError in playInstructionAudio must NOT fall back to /api/tts
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'audio/wav' },
      blob: async () => new Blob([]),
    }));
    vi.stubGlobal('fetch', fetchSpy);

    const blockedUrls: string[] = [];
    class BlockedAudioMock {
      src: string;
      paused = true;
      currentTime = 0;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(src: string) {
        this.src = src;
        blockedUrls.push(src);
      }
      play(): Promise<void> {
        const err = new Error('play() failed because user did not interact');
        err.name = 'NotAllowedError';
        return Promise.reject(err);
      }
      pause(): void {
        this.paused = true;
      }
    }
    vi.stubGlobal('Audio', BlockedAudioMock);

    const played = await playInstructionAudio('instr_home_welcome');
    expect(played).toBe(false);
    expect(blockedUrls).toEqual(['/audio/instr_home_welcome.mp3?v=231']);
    expect(fetchSpy).not.toHaveBeenCalled();

    // 2. Allowed autoplay: plays once on entry, skips subsequent calls in the same session
    resetSessionEntryAudioState();
    const playedUrls: string[] = [];
    class AllowedAudioMock {
      src: string;
      paused = false;
      currentTime = 0;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(src: string) {
        this.src = src;
        playedUrls.push(src);
      }
      play(): Promise<void> {
        this.paused = false;
        return Promise.resolve();
      }
      pause(): void {
        this.paused = true;
      }
    }
    vi.stubGlobal('Audio', AllowedAudioMock);

    const cleanup1 = playInstructionAutoOnEntry('instr_home_welcome');
    await flushMicrotasks();
    const cleanup2 = playInstructionAutoOnEntry('instr_home_welcome');
    await flushMicrotasks();
    expect(playedUrls).toEqual(['/audio/instr_home_welcome.mp3?v=231']);
    cleanup1();
    cleanup2();

    // 3. Autoplay blocked on entry: registers capture listeners, skips .world-card clicks, plays on page click
    resetSessionEntryAudioState();
    const listeners = new Map<string, Array<(evt: Event) => void>>();
    vi.stubGlobal('window', {
      addEventListener: (type: string, cb: (evt: Event) => void) => {
        const arr = listeners.get(type) ?? [];
        arr.push(cb);
        listeners.set(type, arr);
      },
      removeEventListener: (type: string, cb: (evt: Event) => void) => {
        const arr = listeners.get(type) ?? [];
        listeners.set(
          type,
          arr.filter((fn) => fn !== cb),
        );
      },
    });

    let blockFirstPlay = true;
    const gestureUrls: string[] = [];
    class RetryAudioMock {
      src: string;
      paused = false;
      currentTime = 0;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(src: string) {
        this.src = src;
        gestureUrls.push(src);
      }
      play(): Promise<void> {
        if (blockFirstPlay) {
          blockFirstPlay = false;
          const err = new Error('NotAllowedError');
          err.name = 'NotAllowedError';
          return Promise.reject(err);
        }
        return Promise.resolve();
      }
      pause(): void {
        this.paused = true;
      }
    }
    vi.stubGlobal('Audio', RetryAudioMock);

    // 3a. Clicking .world-card on first interaction must skip playing entry greeting
    const cleanupCard = playInstructionAutoOnEntry('instr_home_welcome');
    await flushMicrotasks();
    expect(gestureUrls).toEqual(['/audio/instr_home_welcome.mp3?v=231']);
    expect(listeners.get('pointerdown')?.length).toBe(1);
    listeners.get('pointerdown')?.[0]?.({
      target: { closest: (sel: string) => (sel === '.world-card' ? {} : null) },
    } as unknown as Event);
    await flushMicrotasks();
    expect(gestureUrls).toEqual(['/audio/instr_home_welcome.mp3?v=231']);
    expect(listeners.get('pointerdown')?.length).toBe(0);
    cleanupCard();

    // 3b. Clicking page background unlocks and plays instr_home_welcome once
    resetSessionEntryAudioState();
    blockFirstPlay = true;
    gestureUrls.length = 0;
    const cleanupBg = playInstructionAutoOnEntry('instr_home_welcome');
    await flushMicrotasks();
    expect(listeners.get('pointerdown')?.length).toBe(1);
    listeners.get('pointerdown')?.[0]?.({
      target: { closest: () => null },
    } as unknown as Event);
    await flushMicrotasks();
    expect(gestureUrls).toEqual(['/audio/instr_home_welcome.mp3?v=231', '/audio/instr_home_welcome.mp3?v=231']);
    expect(listeners.get('pointerdown')?.length).toBe(0);
    expect(listeners.get('touchstart')?.length).toBe(0);
    expect(listeners.get('keydown')?.length).toBe(0);

    // Subsequent same-session call after gesture unlock does NOT replay
    const cleanupAgain = playInstructionAutoOnEntry('instr_home_welcome');
    await flushMicrotasks();
    expect(gestureUrls).toHaveLength(2);
    cleanupBg();
    cleanupAgain();
  });

  it('falls back to matching static Malika MP3 when /api/tts returns 402/503 and never invokes browser SpeechSynthesis', async () => {
    const fetch402 = vi.fn(async () => ({
      ok: false,
      status: 402,
      headers: { get: () => 'application/json' },
    }));
    vi.stubGlobal('fetch', fetch402);

    const playedUrls: string[] = [];
    class StaticAudioMock {
      src: string;
      paused = false;
      currentTime = 0;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(src: string) {
        this.src = src;
        playedUrls.push(src);
      }
      play(): Promise<void> {
        queueMicrotask(() => this.onended?.());
        return Promise.resolve();
      }
      pause(): void {
        this.paused = true;
      }
    }
    vi.stubGlobal('Audio', StaticAudioMock);

    await expect(speakUzbekText('ONA')).resolves.toBeUndefined();
    expect(playedUrls).toEqual(['/audio/sound_ona.mp3?v=231']);

    // When no static MP3 exists and /api/tts returns 503, strictly keeps Malika-only (no SpeechSynthesis fallback)
    const fetch503 = vi.fn(async () => ({
      ok: false,
      status: 503,
      headers: { get: () => 'application/json' },
    }));
    vi.stubGlobal('fetch', fetch503);

    const spokenTexts: string[] = [];
    class MockUtterance {
      text: string;
      lang = '';
      rate = 1;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    }
    vi.stubGlobal('SpeechSynthesisUtterance', MockUtterance);
    vi.stubGlobal('window', {
      speechSynthesis: {
        speak: (utt: MockUtterance) => {
          spokenTexts.push(utt.text);
          queueMicrotask(() => utt.onend?.());
        },
        cancel: vi.fn(),
      },
    });

    await expect(speakUzbekText('Yangi tasodifiy matn')).resolves.toBeUndefined();
    expect(spokenTexts).toEqual([]);
  });

  it('keeps VoiceLab API key out of src/ and protects api.txt & .env via .gitignore', async () => {
    const fs = await getNodeFs();
    const gitignore = fs.readFileSync(new URL('.gitignore', PROJECT_ROOT_URL), 'utf8');
    expect(gitignore).toContain('api.txt');
    expect(gitignore).toContain('.env');

    const stack: URL[] = [new URL('src/', PROJECT_ROOT_URL)];
    while (stack.length > 0) {
      const dirUrl = stack.pop()!;
      for (const entry of fs.readdirSync(dirUrl, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          stack.push(new URL(`${entry.name}/`, dirUrl));
        } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
          const fileUrl = new URL(entry.name, dirUrl);
          const code = fs.readFileSync(fileUrl, 'utf8');
          expect(code, `Secret leak in ${fileUrl.href}`).not.toContain('vlk_');
          expect(code, `Env key name in ${fileUrl.href}`).not.toContain('VOICELAB_API_KEY');
          expect(code, `api.txt ref in ${fileUrl.href}`).not.toContain('api.txt');
        }
      }
    }
  });
});
