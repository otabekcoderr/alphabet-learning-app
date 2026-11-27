import {
  ALIFBE_LETTERS_29,
  DYNAMIC_WORD_POOL,
  toSyllableSlug,
  type WordPoolItem,
} from '../data/curriculum';
import { normalizeAsrBaseUrl } from '../logic/asrHealth';
import {
  createMicAutoStopState,
  MIC_AUTO_STOP_CONFIG,
  stepMicAutoStop,
  type MicAutoStopAction,
  type MicAutoStopConfig,
} from '../logic/micAutoStop';
import { playSfx, type SfxKind } from './soundEffects';

const TARGET_SAMPLE_RATE = 16_000;
export const STATIC_AUDIO_VERSION = '234';

let activeAudio: HTMLAudioElement | null = null;
let activeAbortController: AbortController | null = null;
let activeCancelCallback: (() => void) | null = null;
let playbackGeneration = 0;
let playedSessionEntryKey: InstructionAudioKey | null = null;
let activeEntryAttemptKey: InstructionAudioKey | null = null;
let pendingGestureClip: {
  url: string;
  generation: number;
  promise: Promise<StaticPlaybackResult>;
} | null = null;
const ttsBlobUrlCache = new Map<string, string>();
const staticBlobUrlCache = new Map<string, string>();
const inFlightPreloads = new Map<string, Promise<void>>();

export function withStaticAudioVersion(url: string): string {
  if (!url || !url.startsWith('/audio/') || url.includes('?')) {
    return url;
  }
  return `${url}?v=${STATIC_AUDIO_VERSION}`;
}

function getCanonicalStaticAudioKey(url: string): string {
  return url.split('?')[0] ?? url;
}

/** Preload static VoiceLab Malika MP3 files into in-memory blob URLs to avoid first-play lag. */
export async function preloadAudioUrls(urls: readonly string[]): Promise<void> {
  if (typeof fetch === 'undefined') return;
  const canCreateObjectUrl = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
  const uniqueUrls = Array.from(
    new Set(
      urls
        .map((u) => getCanonicalStaticAudioKey(u.trim()))
        .filter((u) => u.startsWith('/audio/') && !staticBlobUrlCache.has(u)),
    ),
  );
  if (uniqueUrls.length === 0) return;

  const CONCURRENCY = 4;
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < uniqueUrls.length) {
      const idx = cursor;
      cursor += 1;
      const canonical = uniqueUrls[idx];
      if (!canonical || staticBlobUrlCache.has(canonical)) continue;
      const existing = inFlightPreloads.get(canonical);
      if (existing) {
        await existing;
        continue;
      }
      const task = (async () => {
        try {
          const resp = await fetch(withStaticAudioVersion(canonical));
          if (!resp.ok) return;
          const contentType = resp.headers?.get('content-type') ?? '';
          if (contentType && !contentType.toLowerCase().startsWith('audio/')) return;
          if (!canCreateObjectUrl) return;
          const blob = await resp.blob();
          if (blob.size > 0) {
            staticBlobUrlCache.set(canonical, URL.createObjectURL(blob));
          }
        } catch {
          // Ignore best-effort preload failures; playback will retry or use /api/tts.
        } finally {
          inFlightPreloads.delete(canonical);
        }
      })();
      inFlightPreloads.set(canonical, task);
      await task;
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, uniqueUrls.length) }, () => worker()),
  );
}

/** Preload all audio clips needed for an upcoming lesson round (habit, instructions, words & syllables). */
export function preloadLessonSessionAudio(
  items: readonly WordPoolItem[],
  opts?: { includeAlhamdulillah?: boolean },
): Promise<void> {
  const urls: string[] = [
    '/audio/bismillah.mp3',
    '/audio/instr_bismillah_speak.mp3',
    '/audio/instr_stage1_word_hunter.mp3',
    '/audio/instr_stage1_word_hunter_speak.mp3',
    '/audio/instr_stage1_constructor.mp3',
    '/audio/instr_stage1_bubbles.mp3',
    '/audio/instr_stage1_bubble_speak.mp3',
    '/audio/instr_stage1_bubble_read_word.mp3',
    '/audio/instr_stage1_bubble_confirm_word.mp3',
    '/audio/instr_stage2_spotlight_word.mp3',
    '/audio/instr_stage3_exam_voice_word.mp3',
    '/audio/praise_1.mp3',
    '/audio/wrong_1.mp3',
  ];
  if (opts?.includeAlhamdulillah) {
    urls.push('/audio/alhamdulillah.mp3', '/audio/instr_alhamdulillah_speak.mp3');
  }
  if (items.some((item) => item.kind === 'sentence')) {
    urls.push(
      '/audio/instr_stage1_sentence.mp3',
      '/audio/instr_stage2_spotlight_sentence.mp3',
      '/audio/instr_stage3_exam_voice_sentence.mp3',
    );
  }
  for (const item of items) {
    if (item.audioSound) urls.push(item.audioSound);
    for (const part of item.parts) {
      const slug = toSyllableSlug(part);
      if (slug) urls.push(`/audio/syl_${slug}.mp3`);
    }
    for (const part of item.distractorParts ?? []) {
      const slug = toSyllableSlug(part);
      if (slug) urls.push(`/audio/syl_${slug}.mp3`);
    }
  }
  return preloadAudioUrls(urls);
}

/** Preload Alphabet 29 recall clips and alphabet instructions. */
export function preloadAlphabetAudio(): Promise<void> {
  const urls: string[] = [
    '/audio/instr_alpha_chart.mp3',
    '/audio/instr_alpha_listen.mp3',
    '/audio/instr_alpha_picture.mp3',
    '/audio/instr_alpha_say.mp3',
    '/audio/praise_alphabet_complete.mp3',
  ];
  for (const entry of ALIFBE_LETTERS_29) {
    urls.push(entry.audioRecall, entry.audioSound);
  }
  return preloadAudioUrls(urls);
}

const DEFAULT_AUTO_ENTRY_SKIP_SELECTORS: readonly string[] = [
  '.world-card',
  '.btn-continue-big',
  '.btn-hear-child',
  '.btn-bubble-audio',
  '.nav-btn',
  '.brand',
];

function targetMatchesSelectorList(target: EventTarget | null, selectors: readonly string[]): boolean {
  if (!target || typeof target !== 'object' || !('closest' in target)) {
    return false;
  }
  const maybeClosest = (target as { closest?: unknown }).closest;
  if (typeof maybeClosest !== 'function') {
    return false;
  }
  return selectors.some((sel) =>
    Boolean((maybeClosest as (selector: string) => unknown).call(target, sel)),
  );
}

/** Ensure any accidental "bismilloh" spelling is normalized to "Bismillah" before TTS/speech. */
export function enforceBismillahPronunciationText(text: string): string {
  return (text || '').replace(/\bbismilloh\b/gi, (match) =>
    match === match.toLowerCase() ? 'bismillah' : 'Bismillah',
  );
}

/** Strip decorative emojis and normalize whitespace before sending Uzbek text to VoiceLab TTS. */
export function sanitizeSpeechTextForTts(text: string): string {
  return enforceBismillahPronunciationText(
    (text || '')
      .replace(/\p{Extended_Pictographic}|\uFE0F|\u200D/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

export function stopActiveAudio(): void {
  playbackGeneration += 1;
  pendingGestureClip = null;
  const cancelPending = activeCancelCallback;
  activeCancelCallback = null;
  try {
    if (cancelPending) {
      cancelPending();
    }
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
    }
    if (activeAudio) {
      activeAudio.pause();
      activeAudio.currentTime = 0;
      activeAudio = null;
    }
  } catch {
    activeAudio = null;
    activeAbortController = null;
  }
}

export function resetSessionEntryAudioState(): void {
  playedSessionEntryKey = null;
  activeEntryAttemptKey = null;
  stopActiveAudio();
}

function playObjectOrUrlAudio(url: string, generation: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      if (activeCancelCallback === abortNow) {
        activeCancelCallback = null;
      }
      resolve(ok);
    };
    let audio: HTMLAudioElement | null = null;
    const abortNow = () => {
      if (audio) {
        audio.onended = null;
        audio.onerror = null;
        try {
          audio.pause();
          audio.currentTime = 0;
        } catch {
          // Ignore cleanup errors on aborted audio elements
        }
        if (activeAudio === audio) {
          activeAudio = null;
        }
      }
      finish(false);
    };

    try {
      if (typeof Audio === 'undefined' || generation !== playbackGeneration) {
        resolve(false);
        return;
      }
      audio = new Audio(url);
      activeAudio = audio;
      activeCancelCallback = abortNow;
      audio.onended = () => {
        if (activeAudio === audio) {
          activeAudio = null;
        }
        finish(generation === playbackGeneration);
      };
      audio.onerror = () => {
        if (activeAudio === audio) {
          activeAudio = null;
        }
        finish(false);
      };
      void audio.play().catch(() => {
        if (activeAudio === audio) {
          activeAudio = null;
        }
        finish(false);
      });
    } catch {
      finish(false);
    }
  });
}

type TtsPlaybackResult = 'played' | 'aborted' | 'unavailable';

async function synthesizeAndPlayVoiceLab(
  text: string,
  voiceStyle?: 'friendly' | 'neutral',
): Promise<TtsPlaybackResult> {
  const cleanText = sanitizeSpeechTextForTts(text);
  if (!cleanText || typeof fetch === 'undefined') {
    return 'unavailable';
  }

  stopActiveAudio();
  const myGen = playbackGeneration;
  const cacheKey = voiceStyle === 'neutral' ? `neutral:${cleanText}` : cleanText;

  let objectUrl = ttsBlobUrlCache.get(cacheKey);
  if (!objectUrl) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    activeAbortController = controller;
    const reqPayload =
      voiceStyle === 'neutral'
        ? { text: cleanText, voice_style: 'neutral' as const }
        : { text: cleanText };

    try {
      const resp = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(reqPayload),
        signal: controller?.signal,
      });
      if (activeAbortController === controller) {
        activeAbortController = null;
      }
      if (myGen !== playbackGeneration) {
        return 'aborted';
      }
      const contentType = resp.headers?.get('content-type') ?? '';
      if (!resp.ok || !contentType.toLowerCase().startsWith('audio/')) {
        return 'unavailable';
      }
      const blob = await resp.blob();
      if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        objectUrl = URL.createObjectURL(blob);
        ttsBlobUrlCache.set(cacheKey, objectUrl);
      } else {
        return myGen === playbackGeneration ? 'played' : 'aborted';
      }
    } catch {
      if (activeAbortController === controller) {
        activeAbortController = null;
      }
      return myGen !== playbackGeneration ? 'aborted' : 'unavailable';
    }
  }

  if (myGen !== playbackGeneration) {
    return 'aborted';
  }
  if (!objectUrl) {
    return 'unavailable';
  }
  const played = await playObjectOrUrlAudio(objectUrl, myGen);
  if (myGen !== playbackGeneration) {
    return 'aborted';
  }
  return played ? 'played' : 'unavailable';
}

function normalizeAudioLookupKey(text: string): string {
  return sanitizeSpeechTextForTts(text)
    .replace(/[‘ʻʼ`´]/g, "'")
    .toLowerCase()
    .replace(/[.!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function findStaticAudioUrlForText(text: string): string | null {
  const key = normalizeAudioLookupKey(text);
  if (!key) return null;

  for (const item of DYNAMIC_WORD_POOL) {
    if (item.audioSound && normalizeAudioLookupKey(item.text) === key) {
      return item.audioSound;
    }
  }

  for (const entry of ALIFBE_LETTERS_29) {
    if (
      normalizeAudioLookupKey(entry.letter) === key ||
      normalizeAudioLookupKey(entry.exampleWord) === key ||
      normalizeAudioLookupKey(entry.phoneticTtsPrompt) === key
    ) {
      return entry.audioRecall;
    }
  }

  for (const [audioKey, phrase] of Object.entries(HABIT_AUDIO_FALLBACK_TEXT)) {
    if (normalizeAudioLookupKey(phrase) === key) {
      return `/audio/${audioKey}.mp3`;
    }
  }

  for (const [audioKey, phrase] of Object.entries(INSTRUCTION_FALLBACK_TEXT)) {
    if (normalizeAudioLookupKey(phrase) === key) {
      return `/audio/${audioKey}.mp3`;
    }
  }

  for (const [audioKey, phrase] of Object.entries(FEEDBACK_FALLBACK_TEXT)) {
    if (normalizeAudioLookupKey(phrase) === key) {
      return `/audio/${audioKey}.mp3`;
    }
  }

  for (let i = 0; i < WRONG_FEEDBACK_PHRASES.length; i++) {
    if (normalizeAudioLookupKey(WRONG_FEEDBACK_PHRASES[i] ?? '') === key) {
      return `/audio/wrong_${i + 1}.mp3`;
    }
  }

  for (let i = 0; i < PRAISE_PHRASES.length; i++) {
    if (normalizeAudioLookupKey(PRAISE_PHRASES[i] ?? '') === key) {
      return `/audio/praise_${i + 1}.mp3`;
    }
  }

  return null;
}

/**
 * Speak Uzbek text aloud strictly via VoiceLab Lison v2 (Malika), preferring
 * matching pre-generated static `public/audio/` MP3 clips before `/api/tts`.
 */
export async function speakUzbekText(text: string): Promise<void> {
  const res = await synthesizeAndPlayVoiceLab(text);
  if (res !== 'unavailable') return;
  const gen = playbackGeneration;
  const staticUrl = findStaticAudioUrlForText(text);
  if (staticUrl) {
    await tryPlayStaticUrl(staticUrl, gen);
  }
}

type StaticPlaybackResult = 'played' | 'aborted' | 'autoplay_blocked' | 'unavailable';
export type AudioClipPlayStatus = 'played' | 'autoplay_blocked' | 'aborted' | 'unavailable';

function tryPlayStaticUrl(
  url: string,
  generation: number,
  onStarted?: () => void,
): Promise<StaticPlaybackResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: StaticPlaybackResult) => {
      if (settled) return;
      settled = true;
      if (activeCancelCallback === abortNow) {
        activeCancelCallback = null;
      }
      resolve(result);
    };
    let audio: HTMLAudioElement | null = null;
    const abortNow = () => {
      if (audio) {
        audio.onended = null;
        audio.onerror = null;
        try {
          audio.pause();
          audio.currentTime = 0;
        } catch {
          // Ignore cleanup errors on aborted audio elements
        }
        if (activeAudio === audio) {
          activeAudio = null;
        }
      }
      finish('aborted');
    };

    try {
      if (!url || typeof Audio === 'undefined' || generation !== playbackGeneration) {
        resolve(generation !== playbackGeneration ? 'aborted' : 'unavailable');
        return;
      }
      const canonical = getCanonicalStaticAudioKey(url);
      const cachedBlobUrl = staticBlobUrlCache.get(canonical);
      const resolvedSrc = cachedBlobUrl ?? withStaticAudioVersion(url);
      audio = new Audio(resolvedSrc);
      try {
        audio.preload = 'auto';
        if (typeof audio.setAttribute === 'function') {
          audio.setAttribute('playsinline', 'true');
        }
      } catch {
        // Ignore attribute/preload errors in mocked or restricted environments
      }
      activeAudio = audio;
      activeCancelCallback = abortNow;
      audio.onended = () => {
        if (activeAudio === audio) {
          activeAudio = null;
        }
        finish(generation === playbackGeneration ? 'played' : 'aborted');
      };
      audio.onerror = () => {
        if (activeAudio === audio) {
          activeAudio = null;
        }
        if (cachedBlobUrl && staticBlobUrlCache.get(canonical) === cachedBlobUrl) {
          staticBlobUrlCache.delete(canonical);
        }
        finish(generation === playbackGeneration ? 'unavailable' : 'aborted');
      };
      void Promise.resolve(audio.play())
        .then(() => {
          if (generation === playbackGeneration) {
            onStarted?.();
          }
        })
        .catch((err: unknown) => {
          if (activeAudio === audio) {
            activeAudio = null;
          }
          const isAutoplayBlocked = Boolean(
            err &&
              typeof err === 'object' &&
              'name' in err &&
              (err as { name?: unknown }).name === 'NotAllowedError',
          );
          finish(
            generation !== playbackGeneration
              ? 'aborted'
              : isAutoplayBlocked
                ? 'autoplay_blocked'
                : 'unavailable',
          );
        });
    } catch {
      finish('unavailable');
    }
  });
}

/**
 * Prime and start an audio clip synchronously inside a user tap/click handler so mobile
 * browsers (iOS Safari / Android Chrome) preserve user-gesture autoplay activation across
 * the subsequent React screen transition.
 */
export function startGestureAudioClip(url: string): boolean {
  try {
    if (!url || typeof Audio === 'undefined') {
      return false;
    }
    stopActiveAudio();
    const myGen = playbackGeneration;
    const promise = tryPlayStaticUrl(url, myGen);
    pendingGestureClip = { url, generation: myGen, promise };
    return true;
  } catch {
    pendingGestureClip = null;
    return false;
  }
}

export async function playAudioClipWithStatus(
  url: string,
  fallbackText?: string,
  opts?: { voiceStyle?: 'friendly' | 'neutral'; adoptGestureClip?: boolean },
): Promise<AudioClipPlayStatus> {
  try {
    if (
      opts?.adoptGestureClip &&
      pendingGestureClip &&
      pendingGestureClip.url === url &&
      pendingGestureClip.generation === playbackGeneration
    ) {
      const adopted = pendingGestureClip;
      pendingGestureClip = null;
      const res = await adopted.promise;
      if (res === 'played' || res === 'aborted' || res === 'autoplay_blocked') {
        return res;
      }
      if (adopted.generation === playbackGeneration && fallbackText) {
        const ttsRes = await synthesizeAndPlayVoiceLab(fallbackText, opts?.voiceStyle);
        return ttsRes;
      }
      return adopted.generation !== playbackGeneration ? 'aborted' : 'unavailable';
    }

    stopActiveAudio();
    const myGen = playbackGeneration;
    if (url) {
      const res = await tryPlayStaticUrl(url, myGen);
      if (res === 'played' || res === 'aborted' || res === 'autoplay_blocked') {
        return res;
      }
    }
    if (myGen === playbackGeneration && fallbackText) {
      const ttsRes = await synthesizeAndPlayVoiceLab(fallbackText, opts?.voiceStyle);
      return ttsRes;
    }
    return myGen !== playbackGeneration ? 'aborted' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

async function playAudioClipInternal(
  url: string,
  fallbackText?: string,
  opts?: { voiceStyle?: 'friendly' | 'neutral' },
): Promise<TtsPlaybackResult> {
  const status = await playAudioClipWithStatus(url, fallbackText, opts);
  return status === 'autoplay_blocked' ? 'unavailable' : status;
}

export async function playAudioClip(
  url: string,
  fallbackText?: string,
  opts?: { voiceStyle?: 'friendly' | 'neutral' },
): Promise<boolean> {
  const res = await playAudioClipInternal(url, fallbackText, opts);
  return res === 'played';
}

/**
 * Play a welcome/entry static instruction clip once per session on site entry,
 * retrying automatically on the first user gesture if blocked by browser autoplay policy.
 */
export function playInstructionAutoOnEntry(
  key: InstructionAudioKey,
  opts?: { skipSelectors?: string[] },
): () => void {
  if (playedSessionEntryKey === key || activeEntryAttemptKey === key) {
    return () => {};
  }
  const url = `/audio/${key}.mp3`;

  activeEntryAttemptKey = key;
  let disposed = false;
  let removeListeners = () => {};

  const markPlayed = () => {
    playedSessionEntryKey = key;
    if (activeEntryAttemptKey === key) {
      activeEntryAttemptKey = null;
    }
  };

  stopActiveAudio();
  const myGen = playbackGeneration;

  void tryPlayStaticUrl(url, myGen, markPlayed).then((res) => {
    if (res !== 'autoplay_blocked') {
      if (activeEntryAttemptKey === key) {
        activeEntryAttemptKey = null;
      }
      return;
    }
    if (
      disposed ||
      playedSessionEntryKey === key ||
      typeof window === 'undefined' ||
      typeof window.addEventListener !== 'function'
    ) {
      if (activeEntryAttemptKey === key) {
        activeEntryAttemptKey = null;
      }
      return;
    }

    const skipList = opts?.skipSelectors ?? DEFAULT_AUTO_ENTRY_SKIP_SELECTORS;
    const onFirstGesture = (event: Event) => {
      removeListeners();
      if (disposed || playedSessionEntryKey === key) {
        if (activeEntryAttemptKey === key) {
          activeEntryAttemptKey = null;
        }
        return;
      }
      if (targetMatchesSelectorList(event.target, skipList)) {
        if (activeEntryAttemptKey === key) {
          activeEntryAttemptKey = null;
        }
        return;
      }
      stopActiveAudio();
      const unlockGen = playbackGeneration;
      void tryPlayStaticUrl(url, unlockGen, markPlayed).then(() => {
        if (activeEntryAttemptKey === key) {
          activeEntryAttemptKey = null;
        }
      });
    };

    const eventNames = ['pointerdown', 'touchstart', 'keydown'] as const;
    for (const evtName of eventNames) {
      window.addEventListener(evtName, onFirstGesture, { capture: true, once: true });
    }
    removeListeners = () => {
      for (const evtName of eventNames) {
        if (typeof window.removeEventListener === 'function') {
          window.removeEventListener(evtName, onFirstGesture, { capture: true });
        }
      }
      removeListeners = () => {};
    };
  });

  return () => {
    disposed = true;
    if (activeEntryAttemptKey === key) {
      activeEntryAttemptKey = null;
    }
    removeListeners();
  };
}

export type InstructionAudioKey =
  | 'instr_home_welcome'
  | 'instr_home_sleep'
  | 'instr_alpha_listen'
  | 'instr_alpha_picture'
  | 'instr_alpha_say'
  | 'instr_alpha_chart'
  | 'instr_letter_help_tip'
  | 'instr_stage1_word_hunter'
  | 'instr_stage1_word_hunter_speak'
  | 'instr_bismillah_speak'
  | 'instr_alhamdulillah_speak'
  | 'instr_stage1_constructor'
  | 'instr_stage1_bubbles'
  | 'instr_stage1_bubble_speak'
  | 'instr_stage1_bubble_read_word'
  | 'instr_stage1_bubble_confirm_word'
  | 'instr_stage1_sentence'
  | 'instr_stage2_spotlight_word'
  | 'instr_stage2_spotlight_sentence'
  | 'instr_stage3_exam_voice_word'
  | 'instr_stage3_exam_voice_sentence'
  | 'instr_stage3_exam_offline_word'
  | 'instr_stage3_exam_offline_sentence'
  | 'instr_comprehension_action'
  | 'instr_comp_eat'
  | 'instr_comp_move'
  | 'instr_comp_nature';

export const INSTRUCTION_FALLBACK_TEXT: Record<InstructionAudioKey, string> = {
  instr_home_welcome: 'Salom, bolajon! Bugun yangi so‘zlarni birga o‘qiymiz! Qani boshladik!',
  instr_home_sleep:
    'Barakalla! Bugungi mashqni a’lo bajarding! Endi ko‘zlarimiz dam olsin, ertaga yana o‘ynaymiz!',
  instr_alpha_listen: 'Quloq sol! Eshitilgan harfni top!',
  instr_alpha_picture: 'Bu harfga mos rasmni top!',
  instr_alpha_say: 'Endi bu harf va so‘zni ovoz chiqarib ayt!',
  instr_alpha_chart: 'Istalgan harf ustiga bos — tovushini va so‘zini aytib beraman!',
  instr_letter_help_tip: 'Harfni unutdingmi? Istalgan harf ustiga bos!',
  instr_stage1_word_hunter: 'Rasmga qara va unga mos so‘zni tanla!',
  instr_stage1_word_hunter_speak:
    'Barakalla! Endi topgan so‘zingni mikrofonga ovoz chiqarib o‘qib ber!',
  instr_bismillah_speak: 'Darsni boshlash uchun mikrofon tugmasini bosib, «Bismillah» deb ayt!',
  instr_alhamdulillah_speak:
    'Barakalla, mashqlarni zo‘r bajarding! Endi Allohga hamd aytib, «Alhamdulillah» deb ayt!',
  instr_stage1_constructor: 'Rasmga qara va yetishmayotgan bo‘g‘inni tanla!',
  instr_stage1_bubbles: 'Rasmga qara! Uning nomidagi bo‘g‘inlarni ketma-ket yor!',
  instr_stage1_bubble_speak: 'Ajoyib! Endi ochilgan bo‘g‘inni mikrofonga ovoz chiqarib ayt!',
  instr_stage1_bubble_read_word:
    'Zo‘r! Endi yig‘ilgan butun so‘zni mikrofonga ovoz chiqarib o‘qi!',
  instr_stage1_bubble_confirm_word: 'Zo‘r! Endi yig‘ilgan so‘zni o‘qib, unga mos rasmni tanla!',
  instr_stage1_sentence: 'Rasmga qara va so‘zlardan to‘g‘ri gap tuz!',
  instr_stage2_spotlight_word: 'Bo‘g‘inlarni ketma-ket o‘qi va mos rasmni tanla!',
  instr_stage2_spotlight_sentence: 'Gapni o‘qi va mos rasmni tanla!',
  instr_stage3_exam_voice_word: 'Endi bu so‘zni o‘zing mustaqil o‘qib, mikrofonga ayt!',
  instr_stage3_exam_voice_sentence: 'Endi bu gapni o‘zing mustaqil o‘qib, mikrofonga ayt!',
  instr_stage3_exam_offline_word: 'Endi bu so‘zni o‘zing o‘qi va unga mos rasmni tanla!',
  instr_stage3_exam_offline_sentence: 'Endi bu gapni o‘zing o‘qi va unga mos rasmni tanla!',
  instr_comprehension_action: 'Gapda nima haqida aytilgan? Ma’nosiga mos rasmni tanla!',
  instr_comp_eat: 'Kim nima yedi, ichdi yoki tayyorladi? Mos rasmni tanla!',
  instr_comp_move: 'Kim qanday harakat qildi? To‘g‘ri rasmni tanla!',
  instr_comp_nature: 'Tabiatda nima sodir bo‘ldi? Mos rasmni tanla!',
};

export type FeedbackAudioKey =
  | 'fb_no_speech'
  | 'fb_louder_clearer'
  | 'fb_listen_then_try'
  | 'fb_other_word'
  | 'fb_try_syllables'
  | 'fb_listen_together'
  | 'fb_server_offline_pic'
  | 'fb_mic_blocked_pic'
  | 'fb_offline_look_again'
  | 'fb_sentence_order'
  | 'fb_word_hunter_wrong'
  | 'fb_bubble_try_again'
  | 'fb_bubble_server_offline'
  | 'fb_bubble_mic_blocked'
  | 'fb_bubble_listen_repeat'
  | 'fb_alpha_repeat'
  | 'fb_alpha_server_offline'
  | 'fb_alpha_mic_blocked';

export const FEEDBACK_FALLBACK_TEXT: Record<FeedbackAudioKey, string> = {
  fb_no_speech: 'Ovozing eshitilmadi — yana bir bor balandroq aytib ko‘r!',
  fb_louder_clearer: 'Yana bir bor balandroq va aniqroq aytib ko‘r!',
  fb_listen_then_try:
    'Ovoz yaxshi eshitilmadi — eshitib ko‘r, keyin yana o‘qib ber yoki Birga aytamiz tugmasini bos.',
  fb_other_word: 'Bu boshqa so‘zga o‘xshadi. Harflarga diqqat bilan qarab yana bir bor o‘qi!',
  fb_try_syllables: 'Yaxshi harakat! Quloq solib, bo‘g‘inlarga qarab yana bir marta o‘qib ko‘r.',
  fb_listen_together: 'Keling, so‘zni birga eshitib o‘qiymiz!',
  fb_server_offline_pic: 'Ovoz serveri bilan aloqa uzildi. Rasm tanlash orqali davom etamiz.',
  fb_mic_blocked_pic: 'Mikrofonga ruxsat berilmadi — mos rasmni tanlash rejimiga o‘tamiz.',
  fb_offline_look_again: 'Yana bir bor so‘zni diqqat bilan o‘qib ko‘r-chi!',
  fb_sentence_order: 'So‘zlarni to‘g‘ri tartibda joylashtirib ko‘r!',
  fb_word_hunter_wrong: 'Boshqa so‘zga qarab ko‘r! Bo‘g‘inlarni diqqat bilan o‘qi.',
  fb_bubble_try_again: 'Bu bo‘g‘inni yana bir bor aniqroq aytib ko‘r-chi!',
  fb_bubble_server_offline: 'Ovoz serveri bilan aloqa uzildi — eshitib davom etamiz.',
  fb_bubble_mic_blocked: 'Mikrofonga ruxsat berilmadi — ovozli pauza rejimiga o‘tamiz.',
  fb_bubble_listen_repeat: 'Tingla va birga ayt!',
  fb_alpha_repeat: 'So‘zni yana bir bor aniqroq aytib ko‘r yoki pastdagi tugma bilan davom et!',
  fb_alpha_server_offline:
    'Ovoz serveri bilan aloqa uzildi — pastdagi tugma bilan davom etishingiz mumkin.',
  fb_alpha_mic_blocked: 'Mikrofonga ruxsat berilmadi — pastdagi tugma bilan davom eting.',
};

export const HABIT_AUDIO_FALLBACK_TEXT: Record<'bismillah' | 'alhamdulillah', string> = {
  bismillah: 'Ilming ziyoda bo‘lishi uchun, «Bismillah» deb boshla!',
  alhamdulillah:
    'Barakalla, mashqlarni zo‘r bajarding! Endi Allohga hamd aytib, «Alhamdulillah» deb ayt!',
};

const WRONG_FEEDBACK_PHRASES = [
  'Yaqin kelding, yana bir urinib ko‘r!',
  'Boshqa rasmni tekshirib ko‘ramizmi?',
  'Hechqisi yo‘q, shoshilmasdan yana qarab ko‘r!',
  'Deyarli topding! Harflarga diqqat bilan qarab yana urinib ko‘r!',
  'Boshqa bo‘g‘inni sinab ko‘ramizmi? Sen albatta topasan!',
] as const;

const PRAISE_PHRASES = [
  'Barakalla! Juda to‘g‘ri topding!',
  'Zo‘r! Sen haqiqiy zukko bolajonsan!',
  'Ajoyib! Juda chiroyli o‘qiding!',
  'Yasha! Xuddi shunday davom et!',
] as const;

let wrongFeedbackCursor = 0;
let praiseCursor = 0;

/** Play static instruction MP3 first (offline-safe), falling back to /api/tts if needed. */
export async function playInstructionAudio(
  key: InstructionAudioKey,
  fallbackText?: string,
): Promise<boolean> {
  return playAudioClip(`/audio/${key}.mp3`, fallbackText ?? INSTRUCTION_FALLBACK_TEXT[key]);
}

/** Play child-facing error/status/hint message via static MP3 first, falling back to /api/tts. */
export async function playFeedbackAudio(
  key: FeedbackAudioKey,
  fallbackText?: string,
): Promise<boolean> {
  return playAudioClip(`/audio/${key}.mp3`, fallbackText ?? FEEDBACK_FALLBACK_TEXT[key]);
}

/** Play gentle, non-punitive wrong-answer voice guidance from static MP3 clips. */
export async function playWrongFeedbackAudio(): Promise<boolean> {
  const idx = wrongFeedbackCursor % WRONG_FEEDBACK_PHRASES.length;
  wrongFeedbackCursor += 1;
  const fallback = WRONG_FEEDBACK_PHRASES[idx] ?? WRONG_FEEDBACK_PHRASES[0];
  return playAudioClip(`/audio/wrong_${idx + 1}.mp3`, fallback);
}

/** Play cheerful praise or round/alphabet completion audio from static MP3 clips. */
export async function playPraiseAudio(
  key?: 'round_complete' | 'alphabet_complete',
): Promise<void> {
  if (key === 'round_complete') {
    await playAudioClip(
      '/audio/praise_round_complete.mp3',
      'Ura! Mashqni a’lo darajada yakunlading! Juda ko‘p yulduzcha to‘plading, barakalla!',
    );
    return;
  }
  if (key === 'alphabet_complete') {
    await playAudioClip(
      '/audio/praise_alphabet_complete.mp3',
      'Ofarin! Barcha harflarni zo‘r takrorlading! Sen haqiqiy chempionsan!',
    );
    return;
  }
  const idx = praiseCursor % PRAISE_PHRASES.length;
  praiseCursor += 1;
  const fallback = PRAISE_PHRASES[idx] ?? PRAISE_PHRASES[0];
  await playAudioClip(`/audio/praise_${idx + 1}.mp3`, fallback);
}

/** Play static syllable MP3 first (syl_<slug>.mp3 or sound_<slug>.mp3), falling back to /api/tts and browser speech. */
export async function playSyllableAudio(syllable: string): Promise<void> {
  const slug = toSyllableSlug(syllable);
  stopActiveAudio();
  const myGen = playbackGeneration;
  if (slug) {
    const sylRes = await tryPlayStaticUrl(`/audio/syl_${slug}.mp3`, myGen);
    if (sylRes !== 'unavailable') return;
    const soundRes = await tryPlayStaticUrl(`/audio/sound_${slug}.mp3`, myGen);
    if (soundRes !== 'unavailable') return;
  }
  if (myGen === playbackGeneration) {
    const prompt = `${syllable.toLowerCase()}.`;
    await synthesizeAndPlayVoiceLab(prompt);
  }
}

/** Play pure plain letter + reminder word via static offline MP3 first (with VoiceLab /api/tts fallback). */
export async function playLetterRecallAudio(
  letter: string,
  opts?: { skipChime?: boolean },
): Promise<void> {
  const norm = letter.trim().toUpperCase().replace(/[‘ʻʼ`´]/g, "'");
  const entry = ALIFBE_LETTERS_29.find(
    (item) => item.letter.toUpperCase() === norm || (norm === "'" && item.letter === '’'),
  );
  if (!entry) {
    await speakUzbekText(letter);
    return;
  }
  if (!opts?.skipChime) {
    playFeedbackChime('marimba');
  }
  stopActiveAudio();
  const myGen = playbackGeneration;
  const recallRes = await tryPlayStaticUrl(entry.audioRecall, myGen);
  if (recallRes !== 'unavailable') return;
  const soundRes = await tryPlayStaticUrl(entry.audioSound, myGen);
  if (soundRes !== 'unavailable') return;
  if (myGen === playbackGeneration) {
    await synthesizeAndPlayVoiceLab(entry.phoneticTtsPrompt, 'neutral');
  }
}

/** Play audio for a WordPoolItem via static offline MP3 first (with VoiceLab /api/tts fallback). */
export async function playWordItemAudio(item: WordPoolItem): Promise<void> {
  stopActiveAudio();
  const myGen = playbackGeneration;
  if (item.audioSound) {
    const res = await tryPlayStaticUrl(item.audioSound, myGen);
    if (res !== 'unavailable') return;
  }
  if (myGen === playbackGeneration) {
    const prompt = item.text.toLowerCase();
    await synthesizeAndPlayVoiceLab(prompt);
  }
}

/** Speak feedback clip first, then immediately play the target word unless interrupted. */
export async function playFeedbackThenWord(
  key: FeedbackAudioKey,
  item: WordPoolItem,
  fallbackText?: string,
): Promise<void> {
  const res = await playAudioClipInternal(
    `/audio/${key}.mp3`,
    fallbackText ?? FEEDBACK_FALLBACK_TEXT[key],
  );
  if (res === 'aborted') return;
  await playWordItemAudio(item);
}

/** Speak instruction clip first, then immediately play the target letter audio unless interrupted. */
export async function playInstructionThenLetter(
  key: InstructionAudioKey,
  letter: string,
): Promise<void> {
  const res = await playAudioClipInternal(`/audio/${key}.mp3`, INSTRUCTION_FALLBACK_TEXT[key]);
  if (res === 'aborted') return;
  await playLetterRecallAudio(letter, { skipChime: true });
}

export function playFeedbackChime(kind: 'success' | 'tap' | SfxKind): void {
  if (kind === 'tap') {
    playSfx('pop');
    return;
  }
  if (kind === 'success') {
    playSfx('chime');
    return;
  }
  playSfx(kind);
}

function downsampleTo16k(input: Float32Array, sourceRate: number): Float32Array {
  if (sourceRate === TARGET_SAMPLE_RATE) return input;
  const ratio = sourceRate / TARGET_SAMPLE_RATE;
  const outLength = Math.max(1, Math.round(input.length / ratio));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const s0 = input[idx] ?? 0;
    const s1 = input[Math.min(idx + 1, input.length - 1)] ?? s0;
    out[i] = s0 + (s1 - s0) * frac;
  }
  return out;
}

export function normalizeAudioPeak(
  samples: Float32Array,
  targetPeak = 0.75,
  maxGain = 6.0,
): Float32Array {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const absVal = Math.abs(samples[i] ?? 0);
    if (absVal > peak) peak = absVal;
  }
  if (peak < 0.008 || peak >= targetPeak) {
    return samples;
  }
  const gain = Math.min(maxGain, targetPeak / peak);
  if (gain <= 1.05) {
    return samples;
  }
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const scaled = (samples[i] ?? 0) * gain;
    out[i] = Math.max(-1, Math.min(1, scaled));
  }
  return out;
}

export function encodeWav16k(samples: Float32Array): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, TARGET_SAMPLE_RATE, true);
  view.setUint32(28, TARGET_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

const MIC_CAPTURE_WORKLET_NAME = 'alifbo-mic-capture';
const MIC_CAPTURE_CHUNK_SIZE = 2048;
const MIC_CAPTURE_WORKLET_SOURCE = `
class AlifboMicCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(${MIC_CAPTURE_CHUNK_SIZE});
    this._offset = 0;
  }
  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];
    if (!channel) return true;
    let i = 0;
    while (i < channel.length) {
      const take = Math.min(channel.length - i, this._buffer.length - this._offset);
      this._buffer.set(channel.subarray(i, i + take), this._offset);
      this._offset += take;
      i += take;
      if (this._offset >= this._buffer.length) {
        const out = this._buffer;
        this.port.postMessage(out, [out.buffer]);
        this._buffer = new Float32Array(${MIC_CAPTURE_CHUNK_SIZE});
        this._offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('${MIC_CAPTURE_WORKLET_NAME}', AlifboMicCaptureProcessor);
`;

export type SttErrorReason =
  | 'unauthorized'
  | 'insufficient_credits'
  | 'endpoint_not_found'
  | 'rate_limited'
  | 'timeout'
  | 'network_error'
  | 'bad_request'
  | 'provider_job_failed'
  | 'upstream_error'
  | 'invalid_response'
  | 'unconfigured';

export class SttRequestError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly provider?: string;
  readonly reason?: SttErrorReason;
  readonly upstreamStatus?: number | null;
  readonly retryAfterSec?: number | null;

  constructor(
    message: string,
    details: {
      status: number;
      code?: string;
      provider?: string;
      reason?: SttErrorReason;
      upstreamStatus?: number | null;
      retryAfterSec?: number | null;
    },
  ) {
    super(message);
    this.name = 'SttRequestError';
    this.status = details.status;
    this.code = details.code;
    this.provider = details.provider;
    this.reason = details.reason;
    this.upstreamStatus = details.upstreamStatus;
    this.retryAfterSec = details.retryAfterSec;
  }
}

export function isSttTerminalOrLimitedError(err: unknown): boolean {
  if (!(err instanceof SttRequestError)) return false;
  if (err.status === 429 || err.status === 503) return true;
  return (
    err.reason === 'unauthorized' ||
    err.reason === 'insufficient_credits' ||
    err.reason === 'endpoint_not_found' ||
    err.reason === 'unconfigured' ||
    err.reason === 'rate_limited'
  );
}

export interface MicRecordingResult {
  wavBlob: Blob;
  durationMs: number;
  firstSpeechMs: number | null;
  lastSpeechMs: number | null;
  recordingStartWallMs: number;
}

export interface MicSession {
  stop: () => Promise<MicRecordingResult | null>;
  cancel: () => void;
}

export async function startMicRecording(
  onLevel: (rms: number) => void,
  onAutoStop?: (reason: Exclude<MicAutoStopAction, 'continue'>, result: MicRecordingResult) => void,
  micConfig: MicAutoStopConfig = MIC_AUTO_STOP_CONFIG,
  onSpeechStart?: (wallTimeMs: number) => void,
): Promise<MicSession> {
  stopActiveAudio();

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Brauzerda mikrofon ruxsati qo'llab-quvvatlanmaydi.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: true,
    },
  });

  const AudioCtx =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }
  const source = ctx.createMediaStreamSource(stream);
  const silentGain = ctx.createGain();
  silentGain.gain.value = 0;

  let captureNode: AudioWorkletNode | ScriptProcessorNode | null = null;
  let detachCaptureHandlers: (() => void) | null = null;
  const chunks: Float32Array[] = [];
  let totalSamples = 0;
  let autoState = createMicAutoStopState(micConfig);
  const startMs = performance.now();
  let stopped = false;

  const cleanup = () => {
    try {
      detachCaptureHandlers?.();
      captureNode?.disconnect();
      silentGain.disconnect();
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    } catch {
      // Ignore cleanup errors
    }
  };

  const finalize = (): MicRecordingResult => {
    const rate = ctx.sampleRate;
    cleanup();
    const merged = new Float32Array(totalSamples);
    let pos = 0;
    for (const chunk of chunks) {
      merged.set(chunk, pos);
      pos += chunk.length;
    }
    const resampled = normalizeAudioPeak(downsampleTo16k(merged, rate));
    const wavBlob = encodeWav16k(resampled);
    const durationMs = Math.round((resampled.length / TARGET_SAMPLE_RATE) * 1000);
    return {
      wavBlob,
      durationMs,
      firstSpeechMs: autoState.firstSpeechMs,
      lastSpeechMs: autoState.lastSpeechMs,
      recordingStartWallMs: startMs,
    };
  };

  const handleAudioChunk = (copy: Float32Array) => {
    if (stopped || copy.length === 0) return;
    chunks.push(copy);
    totalSamples += copy.length;

    let sumSq = 0;
    for (let i = 0; i < copy.length; i++) {
      const v = copy[i] ?? 0;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / copy.length);
    onLevel(Math.min(1, rms * 6));

    const elapsedMs = performance.now() - startMs;
    const wasSpeaking = autoState.speechStarted;
    const step = stepMicAutoStop(autoState, rms, elapsedMs, micConfig);
    autoState = step.state;
    if (!wasSpeaking && autoState.speechStarted && onSpeechStart) {
      onSpeechStart(performance.now());
    }
    if (step.action !== 'continue') {
      stopped = true;
      const result = finalize();
      if (onAutoStop) {
        onAutoStop(step.action, result);
      }
    }
  };

  let attachedWorklet = false;
  if (
    typeof AudioWorkletNode !== 'undefined' &&
    ctx.audioWorklet &&
    typeof ctx.audioWorklet.addModule === 'function' &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function'
  ) {
    const moduleUrl = URL.createObjectURL(
      new Blob([MIC_CAPTURE_WORKLET_SOURCE], { type: 'application/javascript' }),
    );
    try {
      await ctx.audioWorklet.addModule(moduleUrl);
      const workletNode = new AudioWorkletNode(ctx, MIC_CAPTURE_WORKLET_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
      });
      workletNode.port.onmessage = (event: MessageEvent<unknown>) => {
        if (event.data instanceof Float32Array) {
          handleAudioChunk(event.data);
        } else if (event.data instanceof ArrayBuffer) {
          handleAudioChunk(new Float32Array(event.data));
        }
      };
      detachCaptureHandlers = () => {
        workletNode.port.onmessage = null;
      };
      captureNode = workletNode;
      source.connect(workletNode);
      workletNode.connect(silentGain);
      silentGain.connect(ctx.destination);
      attachedWorklet = true;
    } catch {
      try {
        captureNode?.disconnect();
      } catch {
        // Ignore partial worklet cleanup error
      }
      captureNode = null;
      detachCaptureHandlers = null;
    } finally {
      if (typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(moduleUrl);
      }
    }
  }

  if (!attachedWorklet) {
    try {
      const processor = ctx.createScriptProcessor(MIC_CAPTURE_CHUNK_SIZE, 1, 1);
      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        const copy = new Float32Array(input.length);
        copy.set(input);
        handleAudioChunk(copy);
      };
      detachCaptureHandlers = () => {
        processor.onaudioprocess = null;
      };
      captureNode = processor;
      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(ctx.destination);
    } catch (err) {
      cleanup();
      throw err;
    }
  }

  return {
    stop: async () => {
      if (stopped) return null;
      stopped = true;
      return finalize();
    },
    cancel: () => {
      if (stopped) return;
      stopped = true;
      cleanup();
    },
  };
}

export interface SttApiResponse {
  ok: boolean;
  provider?: string;
  transcript: string;
  normalized: string;
  accepted: boolean;
  is_silence: boolean;
  confidence: number | null;
  confidence_available?: boolean;
  latency_ms: number;
  orig_ms: number;
  trimmed_ms: number;
  code?: string;
  reason?: SttErrorReason;
  upstreamStatus?: number | null;
  error?: string;
}

export async function verifyAudioWithStt(
  audioData: Blob,
  expected: string,
  acceptAliases: string[],
  baseUrl = normalizeAsrBaseUrl(
    typeof import.meta !== 'undefined' ? import.meta.env?.VITE_ASR_URL : '',
  ),
): Promise<SttApiResponse> {
  const params = new URLSearchParams({
    expected,
    accept: acceptAliases.join('|'),
  });
  const resp = await fetch(`${baseUrl}/api/stt?${params.toString()}`, {
    method: 'POST',
    headers: {
      'Content-Type': audioData.type || 'application/octet-stream',
    },
    body: audioData,
  });

  const retryAfterRaw = Number(resp.headers.get('retry-after'));
  const retryAfterSec =
    Number.isFinite(retryAfterRaw) && retryAfterRaw > 0 ? retryAfterRaw : null;

  let json: SttApiResponse;
  try {
    json = (await resp.json()) as SttApiResponse;
  } catch {
    throw new SttRequestError(`Server xatosi: ${resp.status}`, {
      status: resp.status,
      reason:
        resp.status === 504
          ? 'timeout'
          : resp.status === 429
            ? 'rate_limited'
            : 'invalid_response',
      upstreamStatus: null,
      retryAfterSec,
    });
  }

  if (!resp.ok || !json.ok) {
    throw new SttRequestError(json.error || `Server xatosi: ${resp.status}`, {
      status: resp.status,
      code: json.code,
      provider: json.provider,
      reason: json.reason ?? (resp.status === 429 ? 'rate_limited' : undefined),
      upstreamStatus: json.upstreamStatus ?? null,
      retryAfterSec,
    });
  }
  return json;
}
