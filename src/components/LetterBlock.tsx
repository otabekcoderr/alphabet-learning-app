import { motion } from 'framer-motion';
import { getLetterCategory } from '../data/curriculum';

interface LetterBlockProps {
  text: string;
  size?: 'md' | 'lg' | 'xl';
  highlighted?: boolean;
  variant?: 'alifbe' | 'sky-cube' | 'exam-clean';
  onClick?: () => void;
  /** Optional per-letter Tap-to-Recall callback; turns each letter inside the syllable/word into an interactive button. */
  onLetterTap?: (letter: string) => void;
}

const VOWEL_UNITS = new Set(['A', 'O', 'I', 'U', 'E', "O'", 'O‘']);

function isVowelUnit(unit: string): boolean {
  const upper = unit.toUpperCase().replace(/[‘ʻʼ`´]/g, "'");
  return VOWEL_UNITS.has(upper) || getLetterCategory(upper) === 'vowel';
}

/**
 * Renders a word/syllable/letter block in Fredoka display typography with
 * Uzbekistan 1st-grade Alifbe color coding (Red vowels / Blue consonants) or
 * clean storybook variants matching the Alifbo 2.2 game screens.
 */
export function LetterBlock({
  text,
  size = 'lg',
  highlighted = false,
  variant = 'alifbe',
  onClick,
  onLetterTap,
}: LetterBlockProps) {
  const rawUnits = tokenizeUzbekLettersOrdered(text);
  const chars = rawUnits.length > 0 ? rawUnits : [...text];
  const isSingleVowel = chars.length === 1 && isVowelUnit(chars[0] ?? '');
  const isSingleConsonant = chars.length === 1 && !isVowelUnit(chars[0] ?? '');

  const blockClass =
    variant === 'sky-cube'
      ? 'letter-tile tile-sky-cube'
      : variant === 'exam-clean'
        ? 'letter-tile tile-exam-clean'
        : isSingleVowel
          ? 'letter-tile tile-vowel'
          : isSingleConsonant
            ? 'letter-tile tile-consonant'
            : 'letter-tile tile-syllable';

  const getCharClass = (vowel: boolean): string => {
    if (variant === 'sky-cube') return 'char-cube-white';
    if (variant === 'exam-clean') return 'char-exam-teal';
    return vowel ? 'char-vowel' : 'char-consonant';
  };

  if (onLetterTap) {
    return (
      <motion.div
        whileHover={{ scale: 1.03 }}
        className={`${blockClass} ${blockClass}-interactive size-${size} ${highlighted ? 'tile-highlighted' : ''}`}
        role="group"
        aria-label={`${text} — harflarni bosib tovushini eshiting`}
      >
        <span className="tile-chars">
          {chars.map((unit, idx) => {
            const normalizedUnit = unit.toUpperCase().replace(/[‘ʻʼ`´]/g, "'");
            const vowel = isVowelUnit(unit);
            return (
              <motion.button
                key={`${unit}-${idx}`}
                type="button"
                whileTap={{ scale: 1.24, y: -4 }}
                transition={{ type: 'spring', stiffness: 450, damping: 20 }}
                className={`tile-letter-btn ${getCharClass(vowel)}`}
                title={`«${unit}» tovushini eslash`}
                aria-label={`«${unit}» harf tovushini eshitish`}
                onClick={(e) => {
                  e.stopPropagation();
                  onLetterTap(normalizedUnit);
                }}
              >
                {unit}
              </motion.button>
            );
          })}
        </span>
      </motion.div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${blockClass} size-${size} ${highlighted ? 'tile-highlighted' : ''}`}
      aria-label={`${text} tovushini eshitish`}
    >
      <span className="tile-chars">
        {chars.map((ch, idx) => {
          const vowel = isVowelUnit(ch);
          return (
            <span key={`${ch}-${idx}`} className={getCharClass(vowel)}>
              {ch}
            </span>
          );
        })}
      </span>
    </button>
  );
}

/**
 * Split Uzbek Latin text keeping digraphs (Sh, Ch, Ng, O‘, G‘) intact and in order.
 */
export function tokenizeUzbekLettersOrdered(text: string): string[] {
  const chars = [...(text || '')];
  const apostrophes = new Set(['‘', '’', 'ʻ', 'ʼ', '`', '´', "'"]);
  const units: string[] = [];
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i] ?? '';
    const next = chars[i + 1] ?? '';
    const up = ch.toUpperCase();
    const upNext = next.toUpperCase();
    if ((up === 'O' || up === 'G') && apostrophes.has(next)) {
      units.push(`${ch}${next}`);
      i += 2;
      continue;
    }
    if ((up === 'S' && upNext === 'H') || (up === 'C' && upNext === 'H') || (up === 'N' && upNext === 'G')) {
      units.push(`${ch}${next}`);
      i += 2;
      continue;
    }
    units.push(ch);
    i++;
  }
  return units;
}
