interface MascotSvgProps {
  mood?: 'happy' | 'cheering' | 'listening';
  size?: number;
}

/**
 * Original friendly vector mascot ("Zukko Tulki") inspired by playful educational apps.
 */
export function MascotSvg({ mood = 'happy', size = 68 }: MascotSvgProps) {
  const earTilt = mood === 'listening' ? 'rotate(-4 30 24)' : undefined;
  const mouthPath =
    mood === 'cheering'
      ? 'M 36 53 Q 44 63 52 53 Z'
      : mood === 'listening'
        ? 'M 40 55 Q 44 57 48 55'
        : 'M 37 53 Q 44 60 51 53';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 88 88"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="mascot-svg"
    >
      <circle cx="44" cy="44" r="42" fill="#FFF7ED" stroke="#FDBA74" strokeWidth="3" />
      {/* Left & Right Ears */}
      <g transform={earTilt}>
        <path d="M22 34L17 12L36 22Z" fill="#FB923C" stroke="#EA580C" strokeWidth="2.5" strokeLinejoin="round" />
        <path d="M23 30L20 17L32 23Z" fill="#FED7AA" />
      </g>
      <path d="M66 34L71 12L52 22Z" fill="#FB923C" stroke="#EA580C" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M65 30L68 17L56 23Z" fill="#FED7AA" />

      {/* Head */}
      <ellipse cx="44" cy="48" rx="25" ry="21" fill="#FB923C" stroke="#EA580C" strokeWidth="2.5" />
      {/* White Cheeks */}
      <path d="M21 48C21 59 31 68 44 68C38 61 36 55 31 50C27 46 22 46 21 48Z" fill="#FFFFFF" />
      <path d="M67 48C67 59 57 68 44 68C50 61 52 55 57 50C61 46 66 46 67 48Z" fill="#FFFFFF" />

      {/* Eyes */}
      <circle cx="34" cy="43" r="4.5" fill="#1E293B" />
      <circle cx="54" cy="43" r="4.5" fill="#1E293B" />
      <circle cx="35.5" cy="41.5" r="1.5" fill="#FFFFFF" />
      <circle cx="55.5" cy="41.5" r="1.5" fill="#FFFFFF" />

      {/* Rosy Blush */}
      <ellipse cx="27" cy="50" rx="4" ry="2.2" fill="#FDA4AF" opacity="0.7" />
      <ellipse cx="61" cy="50" rx="4" ry="2.2" fill="#FDA4AF" opacity="0.7" />

      {/* Nose & Smile */}
      <ellipse cx="44" cy="49" rx="3.5" ry="2.5" fill="#0F172A" />
      <path
        d={mouthPath}
        fill={mood === 'cheering' ? '#EF4444' : 'none'}
        stroke="#0F172A"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
