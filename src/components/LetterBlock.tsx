import { getLetterCategory } from '../data/curriculum';

interface LetterBlockProps {
  text: string;
  size?: 'md' | 'lg' | 'xl';
  highlighted?: boolean;
  onClick?: () => void;
}

/**
 * Renders a word/syllable/letter with Uzbekistan 1st-grade Alifbe color coding:
 * Red for vowels (unli) and Blue for consonants (undosh).
 */
export function LetterBlock({ text, size = 'lg', highlighted = false, onClick }: LetterBlockProps) {
  const chars = [...text];
  const isSingleVowel = chars.length === 1 && getLetterCategory(chars[0] ?? '') === 'vowel';
  const isSingleConsonant = chars.length === 1 && getLetterCategory(chars[0] ?? '') === 'consonant';

  const blockClass = isSingleVowel
    ? 'letter-tile tile-vowel'
    : isSingleConsonant
      ? 'letter-tile tile-consonant'
      : 'letter-tile tile-syllable';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${blockClass} size-${size} ${highlighted ? 'tile-highlighted' : ''}`}
      aria-label={`${text} tovushini eshitish`}
    >
      <span className="tile-chars">
        {chars.map((ch, idx) => {
          const cat = getLetterCategory(ch);
          return (
            <span key={`${ch}-${idx}`} className={cat === 'vowel' ? 'char-vowel' : 'char-consonant'}>
              {ch}
            </span>
          );
        })}
      </span>
    </button>
  );
}
