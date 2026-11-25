import {
  CURRICULUM_ITEMS,
  DYNAMIC_WORD_POOL,
  normalizeText,
  tokenizeGraphemes,
  type CurriculumItem,
  type WordPoolItem,
} from '../data/curriculum';
import {
  matchesSpelledOrSyllabicTranscript,
  normalizeUzbek,
  READING_THRESHOLDS,
  type ReadingThresholds,
  type SpokenCadence,
} from './pedagogy';

export const PHONETIC_PAIRS: Record<string, readonly string[]> = {
  b: ['p'],
  p: ['b'],
  d: ['t'],
  t: ['d'],
  z: ['s'],
  s: ['z'],
  v: ['f'],
  f: ['v'],
  j: ['ch'],
  ch: ['j', 'sh'],
  g: ['k'],
  k: ['g', 'q'],
  q: ['k', 'gʻ'],
  'gʻ': ['q', 'g'],
  h: ['x'],
  x: ['h'],
  o: ['a'],
  a: ['o'],
  'oʻ': ['u', 'o'],
  u: ['oʻ'],
};

const EXTRA_UZBEK_MINIMAL_PAIRS = [
  'ana',
  'tush',
  'dogʻ',
  'togʻ',
  'bor',
  'por',
  'qol',
  'qal',
  'tus',
  'ol',
  'tola',
];

/** Build a canonical grapheme-joined lexicon of known Uzbek single words to guard against lexical collisions. */
export function buildKnownWordLexicon(
  pool: WordPoolItem[] = DYNAMIC_WORD_POOL,
  legacyItems: CurriculumItem[] = CURRICULUM_ITEMS,
): ReadonlySet<string> {
  const words = new Set<string>();
  for (const item of pool) {
    if (item.kind === 'word' && !item.text.includes(' ')) {
      const joined = tokenizeGraphemes(item.text).join('');
      if (joined) words.add(joined);
    }
  }
  for (const item of legacyItems) {
    if (item.kind === 'word' && !item.text.includes(' ')) {
      const joined = tokenizeGraphemes(item.text).join('');
      if (joined) words.add(joined);
    }
  }
  for (const extra of EXTRA_UZBEK_MINIMAL_PAIRS) {
    const joined = tokenizeGraphemes(extra).join('');
    if (joined) words.add(joined);
  }
  return words;
}

export const KNOWN_WORD_LEXICON: ReadonlySet<string> = buildKnownWordLexicon();

export function areGraphemesPhoneticallyClose(g1: string, g2: string): boolean {
  if (g1 === g2) return true;
  return PHONETIC_PAIRS[g1]?.includes(g2) ?? false;
}

export function graphemeLevenshtein(a: string[], b: string[]): number {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i]![0] = i;
  for (let j = 0; j <= b.length; j++) dp[0]![j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      );
    }
  }
  return dp[a.length]![b.length]!;
}

/**
 * Classify spoken reading cadence from raw STT transcript:
 * - 'spelled_out': letter-by-letter decoding (e.g. "k i t o b" or "k i ki t o b tob kitob")
 * - 'syllable': syllable-by-syllable decoding (e.g. "ki tob")
 * - 'fluent': whole-word / natural sentence reading
 */
export function classifySpokenReadingAttempt(
  targetWord: string,
  rawTranscript: string,
  syllableCount: number,
): SpokenCadence {
  const parts = normalizeText(rawTranscript).split(' ').filter(Boolean);
  const targetTokens = tokenizeGraphemes(targetWord);

  if (parts.length === 0 || targetTokens.length === 0) {
    return 'fluent';
  }

  if (!targetWord.includes(' ')) {
    if (parts.length >= targetTokens.length && targetTokens.length >= 2) {
      return 'spelled_out';
    }
    if (parts.length >= 2 && parts.length <= syllableCount + 1) {
      return 'syllable';
    }
    return 'fluent';
  }

  // Multi-word sentence handling (World 5)
  const targetWordCount = normalizeText(targetWord).split(' ').filter(Boolean).length;
  if (parts.length >= targetTokens.length) {
    return 'spelled_out';
  }
  if (parts.length >= targetWordCount + Math.max(2, syllableCount - targetWordCount)) {
    return 'syllable';
  }
  return 'fluent';
}

/**
 * Determine whether STT confidence is genuinely below threshold.
 * Unavailable/null confidence is treated as "unknown" (never fabricated, never penalized as low confidence).
 */
export function isLowConfidence(
  confidence: number | null | undefined,
  confidenceAvailable?: boolean,
  thresholds: ReadingThresholds = READING_THRESHOLDS,
): boolean {
  if (confidenceAvailable === false || confidence === null || confidence === undefined) {
    return false;
  }
  if (confidenceAvailable === undefined && confidence === 0) {
    return false;
  }
  if (!Number.isFinite(confidence)) {
    return false;
  }
  return confidence < thresholds.minSttConfidence;
}

export interface PronunciationCheckOptions {
  lexicon?: ReadonlySet<string>;
  acceptAliases?: string[];
}

/**
 * Two-stage phonetic-Levenshtein check with lexical collision guard:
 * - Exact grapheme match or explicit alias match -> true
 * - Non-exact match colliding with another real Uzbek word in `lexicon` -> false
 * - Short words (<= 4 graphemes): Levenshtein disabled; max 1 phonetically close substitution
 * - Long words (>= 5 graphemes): initial-position diff requires phonetic closeness; overall grapheme Levenshtein <= 1
 */
export function isPronunciationAcceptable(
  targetWord: string,
  sttTranscript: string,
  options: PronunciationCheckOptions = {},
): boolean {
  const target = tokenizeGraphemes(targetWord);
  const spoken = tokenizeGraphemes(sttTranscript);
  if (target.length === 0 || spoken.length === 0) return false;

  const targetJoined = target.join('');
  const spokenJoined = spoken.join('');
  if (targetJoined === spokenJoined) return true;

  const normalizedAliases = new Set(
    (options.acceptAliases ?? []).map((a) => tokenizeGraphemes(a).join('')).filter(Boolean),
  );
  if (normalizedAliases.has(spokenJoined)) {
    return true;
  }

  const lexicon = options.lexicon ?? KNOWN_WORD_LEXICON;
  if (!targetWord.includes(' ') && lexicon.has(spokenJoined)) {
    // Reject real-word minimal-pair collisions (e.g. bola -> tola, salat -> savat, tosh -> tush)
    return false;
  }

  if (target.length <= 4) {
    if (target.length !== spoken.length) return false;
    let phoneticDiffs = 0;
    for (let i = 0; i < target.length; i++) {
      if (target[i] !== spoken[i]) {
        if (areGraphemesPhoneticallyClose(target[i]!, spoken[i]!)) {
          phoneticDiffs++;
        } else {
          return false;
        }
      }
    }
    return phoneticDiffs <= 1;
  }

  if (target.length === spoken.length) {
    const diffIndices: number[] = [];
    for (let i = 0; i < target.length; i++) {
      if (target[i] !== spoken[i]) diffIndices.push(i);
    }
    if (diffIndices.length === 1 && diffIndices[0] === 0) {
      return areGraphemesPhoneticallyClose(target[0]!, spoken[0]!);
    }
  }

  return graphemeLevenshtein(target, spoken) <= 1;
}

export type SttValidationDecision =
  | 'accepted'
  | 'silence'
  | 'low_confidence'
  | 'word_collision'
  | 'mismatch';

export interface SttValidationResult {
  decision: SttValidationDecision;
  cadence: SpokenCadence;
}

/** Complete Stage 3 STT reading validation combining confidence, cadence, lexical collision, and phonetic matching. */
export function validateSttReading(params: {
  targetWord: string;
  parts: string[];
  syllableCount: number;
  acceptAliases: string[];
  transcript: string;
  isSilence: boolean;
  confidence?: number | null;
  confidenceAvailable?: boolean;
  thresholds?: ReadingThresholds;
  lexicon?: ReadonlySet<string>;
}): SttValidationResult {
  const thresholds = params.thresholds ?? READING_THRESHOLDS;
  const lexicon = params.lexicon ?? KNOWN_WORD_LEXICON;
  const normTranscript = normalizeText(params.transcript);

  if (params.isSilence || !normTranscript) {
    return { decision: 'silence', cadence: 'fluent' };
  }

  if (isLowConfidence(params.confidence, params.confidenceAvailable, thresholds)) {
    return { decision: 'low_confidence', cadence: 'fluent' };
  }

  const cadence = classifySpokenReadingAttempt(
    params.targetWord,
    params.transcript,
    params.syllableCount,
  );

  const targetJoined = tokenizeGraphemes(params.targetWord).join('');
  const spokenJoined = tokenizeGraphemes(params.transcript).join('');
  const aliasTokensSet = new Set(
    params.acceptAliases.map((a) => tokenizeGraphemes(a).join('')).filter(Boolean),
  );

  if (
    !params.targetWord.includes(' ') &&
    spokenJoined !== targetJoined &&
    !aliasTokensSet.has(spokenJoined) &&
    lexicon.has(spokenJoined)
  ) {
    return { decision: 'word_collision', cadence };
  }

  if (
    isPronunciationAcceptable(params.targetWord, params.transcript, {
      lexicon,
      acceptAliases: params.acceptAliases,
    })
  ) {
    return { decision: 'accepted', cadence };
  }

  if (cadence !== 'fluent') {
    const acceptedSet = new Set<string>();
    const normTarget = normalizeUzbek(params.targetWord);
    if (normTarget) acceptedSet.add(normTarget);
    for (const alias of params.acceptAliases) {
      const normAlias = normalizeUzbek(alias);
      if (normAlias) acceptedSet.add(normAlias);
    }
    const spelledMatch = matchesSpelledOrSyllabicTranscript(
      normalizeUzbek(params.transcript),
      acceptedSet,
      params.parts,
    );
    if (spelledMatch.matched) {
      return { decision: 'accepted', cadence };
    }
  }

  return { decision: 'mismatch', cadence };
}

export type HabitPhraseKind = 'bismillah' | 'alhamdulillah';

export const BISMILLAH_ACCEPT_ALIASES: readonly string[] = [
  'bismillah',
  'bismillo',
  'bismilloh',
  'bismilla',
  'bismillahir',
  'bismillohir',
  'bismillahi',
  'bismillohi',
  'besmillah',
  'besmillo',
  'bismilo',
  'bismilah',
  'bismilloh rahmanir rahim',
  'bismillahir rahmanir rahim',
  'бисмиллах',
  'бисмиллох',
  'бисмилло',
  'бисмиллаҳ',
];

export const ALHAMDULILLAH_ACCEPT_ALIASES: readonly string[] = [
  'alhamdulillah',
  'alhamdulloh',
  'alhamdulilloh',
  'alhamdulilla',
  'alhamdullilah',
  'alhamdullillah',
  'alhamdulloha',
  'alxamdulillah',
  'alxamdulilloh',
  'alxamdulloh',
  'elhamdulillah',
  'alhamdu',
  'alhamd',
  'алхамдулиллах',
  'алхамдулиллох',
  'алҳамдулиллаҳ',
];

/** Validate spoken Bismillah or Alhamdulillah with phonetic aliases and zero lexical false positives. */
export function validateHabitUtterance(
  kind: HabitPhraseKind,
  params: {
    transcript: string;
    isSilence: boolean;
    confidence?: number | null;
    confidenceAvailable?: boolean;
    thresholds?: ReadingThresholds;
  },
): SttValidationDecision {
  const thresholds = params.thresholds ?? READING_THRESHOLDS;
  const normTranscript = normalizeText(params.transcript);
  if (params.isSilence || !normTranscript) {
    return 'silence';
  }
  if (isLowConfidence(params.confidence, params.confidenceAvailable, thresholds)) {
    return 'low_confidence';
  }

  const aliases = kind === 'bismillah' ? BISMILLAH_ACCEPT_ALIASES : ALHAMDULILLAH_ACCEPT_ALIASES;
  const canonical = kind === 'bismillah' ? 'bismillah' : 'alhamdulillah';
  const canonicalGraphemes = tokenizeGraphemes(canonical);
  const normalizedSpoken = normalizeUzbek(params.transcript).replace(/[^a-z\u0400-\u04ff\s']/g, ' ');
  const spokenTokens = normalizedSpoken.split(/\s+/).filter(Boolean);
  const compactSpoken = spokenTokens.join('');

  for (const alias of aliases) {
    const compactAlias = alias.replace(/\s+/g, '');
    if (!compactAlias) continue;
    if (compactSpoken === compactAlias || compactSpoken.includes(compactAlias)) {
      return 'accepted';
    }
    for (const tok of spokenTokens) {
      if (tok === compactAlias || tok.includes(compactAlias)) {
        return 'accepted';
      }
      if (tok.length >= 6 && graphemeLevenshtein(tokenizeGraphemes(tok), canonicalGraphemes) <= 2) {
        return 'accepted';
      }
    }
  }

  if (
    compactSpoken.length >= 6 &&
    graphemeLevenshtein(tokenizeGraphemes(compactSpoken), canonicalGraphemes) <= 2
  ) {
    return 'accepted';
  }

  return 'mismatch';
}
