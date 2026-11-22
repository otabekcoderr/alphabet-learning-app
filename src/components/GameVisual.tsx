import { getVisualAltUz, resolveVisualSrc } from '../data/wordVisuals';

interface GameVisualProps {
  emoji: string;
  wordId?: string;
  letter?: string;
  size?: number;
  alt?: string;
  className?: string;
}

/**
 * Renders crisp local SVG illustrations (custom Uzbek artwork or bundled Twemoji SVGs)
 * instead of inconsistent OS system emojis.
 */
export function GameVisual({
  emoji,
  wordId,
  letter,
  size = 64,
  alt,
  className = '',
}: GameVisualProps) {
  const src = resolveVisualSrc({ emoji, wordId, letter });
  const label = getVisualAltUz(emoji, alt);

  return (
    <img
      src={src}
      alt={label}
      width={size}
      height={size}
      loading="eager"
      className={`game-visual-img ${className}`.trim()}
      draggable={false}
    />
  );
}
