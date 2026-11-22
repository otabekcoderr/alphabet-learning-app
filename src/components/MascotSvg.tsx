interface MascotSvgProps {
  mood?: 'happy' | 'cheering' | 'listening';
  size?: number;
  className?: string;
}

/**
 * Zukko Tulki transparent WebP mascot extracted from the official Alifbo design kit.
 */
export function MascotSvg({ mood = 'happy', size = 68, className = '' }: MascotSvgProps) {
  return (
    <img
      src="/images/zukko.webp"
      alt="Zukko Tulki"
      width={size}
      height={size}
      draggable={false}
      className={`zukko-mascot-img zukko-mood-${mood} ${className}`.trim()}
      style={{ width: size, height: size, objectFit: 'contain' }}
    />
  );
}
