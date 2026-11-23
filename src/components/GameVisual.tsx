import { useState } from 'react';
import { getVisualAltUz, resolveVisualRenderSrc, resolveVisualSrc } from '../data/wordVisuals';

interface GameVisualProps {
  emoji: string;
  image?: string;
  wordId?: string;
  letter?: string;
  size?: number;
  alt?: string;
  className?: string;
}

/**
 * Renders custom word images when provided (`image`), falling back to crisp local
 * SVG illustrations (custom Uzbek artwork or bundled Twemoji SVGs) and finally emoji text.
 */
export function GameVisual({
  emoji,
  image,
  wordId,
  letter,
  size = 64,
  alt,
  className = '',
}: GameVisualProps) {
  const customImage = image?.trim() || '';
  const mappedAssetSrc = resolveVisualSrc({ emoji, wordId, letter });
  const mappedRenderSrc = resolveVisualRenderSrc({ emoji, wordId, letter });
  const primaryAssetSrc = customImage || mappedAssetSrc;
  const label = getVisualAltUz(emoji, alt);

  const candidates: string[] = [];
  for (const src of [customImage, mappedRenderSrc, mappedAssetSrc]) {
    if (src && !candidates.includes(src)) {
      candidates.push(src);
    }
  }
  const candidateKey = candidates.join('|');

  const [fallbackState, setFallbackState] = useState<{ key: string; index: number }>({
    key: candidateKey,
    index: 0,
  });

  const activeIndex = fallbackState.key === candidateKey ? fallbackState.index : 0;

  if (activeIndex >= candidates.length) {
    return (
      <span
        role="img"
        aria-label={label}
        className={`game-visual-emoji-fallback ${className}`.trim()}
        style={{ width: size, height: size, fontSize: Math.round(size * 0.72) }}
      >
        {emoji || '🖼️'}
      </span>
    );
  }

  const activeSrc = candidates[activeIndex]!;

  return (
    <img
      src={activeSrc}
      data-asset-src={primaryAssetSrc}
      alt={label}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      loading="eager"
      decoding="sync"
      className={`game-visual-img ${className}`.trim()}
      draggable={false}
      onError={() => {
        setFallbackState({ key: candidateKey, index: activeIndex + 1 });
      }}
    />
  );
}
