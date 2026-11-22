interface WorldIslandArtProps {
  worldId: 1 | 2 | 3 | 4 | 5;
  className?: string;
}

/**
 * Five bespoke storybook floating island illustrations matching the Alifbo 2.2
 * 5-World Adventure Map (Mockups 04 & 12), rendered crisply at any scale.
 */
export function WorldIslandArt({ worldId, className = '' }: WorldIslandArtProps) {
  if (worldId === 1) {
    // 1-olam: Ilk bo'g'inlar o'rmoni — Lush Forest Island
    return (
      <svg
        viewBox="0 0 180 128"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`world-island-svg ${className}`.trim()}
        aria-hidden="true"
      >
        <ellipse cx="90" cy="112" rx="76" ry="12" fill="#BAE6FD" fillOpacity="0.85" />
        <ellipse cx="90" cy="109" rx="64" ry="8" fill="#E0F2FE" />
        <path d="M22 92C22 104 52 111 90 111C128 111 158 104 158 92V85H22V92Z" fill="#B47B48" stroke="#6E4423" strokeWidth="2.5" />
        <ellipse cx="90" cy="85" rx="68" ry="15" fill="#65C466" stroke="#2E7D32" strokeWidth="2.5" />
        {/* Tree trunks */}
        <rect x="48" y="54" width="10" height="32" rx="4" fill="#8B5A2B" stroke="#5C3A21" strokeWidth="2" />
        <rect x="84" y="46" width="12" height="40" rx="5" fill="#8B5A2B" stroke="#5C3A21" strokeWidth="2" />
        <rect x="122" y="55" width="10" height="30" rx="4" fill="#8B5A2B" stroke="#5C3A21" strokeWidth="2" />
        {/* Canopy layers */}
        <circle cx="52" cy="48" r="21" fill="#4ADE80" stroke="#166534" strokeWidth="2.5" />
        <circle cx="127" cy="50" r="20" fill="#4ADE80" stroke="#166534" strokeWidth="2.5" />
        <circle cx="90" cy="36" r="25" fill="#22C55E" stroke="#14532D" strokeWidth="2.5" />
        <circle cx="72" cy="44" r="16" fill="#34D399" stroke="#14532D" strokeWidth="2.2" />
        <circle cx="109" cy="45" r="15" fill="#34D399" stroke="#14532D" strokeWidth="2.2" />
        {/* Highlight */}
        <circle cx="83" cy="27" r="7" fill="#86EFAC" fillOpacity="0.7" />
      </svg>
    );
  }

  if (worldId === 2) {
    // 2-olam: Chaqqon so'zlar vodiysi — Sunny Flower Valley & Peaks
    return (
      <svg
        viewBox="0 0 180 128"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`world-island-svg ${className}`.trim()}
        aria-hidden="true"
      >
        <ellipse cx="90" cy="112" rx="76" ry="12" fill="#BAE6FD" fillOpacity="0.85" />
        {/* Soft sky dome behind peaks */}
        <path d="M26 84C26 42 54 14 90 14C126 14 154 42 154 84H26Z" fill="#E0F2FE" stroke="#93C5FD" strokeWidth="2" />
        <circle cx="114" cy="35" r="11" fill="#FDE047" />
        {/* Mountains */}
        <path d="M36 84L68 38L94 74L118 42L146 84H36Z" fill="#94A3B8" stroke="#475569" strokeWidth="2.2" strokeLinejoin="round" />
        <path d="M68 38L59 52L68 50L75 54L68 38Z" fill="#FFFFFF" />
        <path d="M118 42L110 54L118 52L125 56L118 42Z" fill="#FFFFFF" />
        {/* Earth & green meadow */}
        <path d="M22 92C22 104 52 111 90 111C128 111 158 104 158 92V85H22V92Z" fill="#B47B48" stroke="#6E4423" strokeWidth="2.5" />
        <ellipse cx="90" cy="85" rx="68" ry="15" fill="#86EFAC" stroke="#15803D" strokeWidth="2.5" />
        {/* Tiny trees & colorful meadow flowers */}
        <circle cx="42" cy="70" r="10" fill="#22C55E" stroke="#166534" strokeWidth="2" />
        <circle cx="138" cy="70" r="10" fill="#22C55E" stroke="#166534" strokeWidth="2" />
        <circle cx="62" cy="85" r="4.5" fill="#FB7185" />
        <circle cx="62" cy="85" r="1.8" fill="#FEF08A" />
        <circle cx="92" cy="88" r="4.5" fill="#FACC15" />
        <circle cx="116" cy="83" r="4.5" fill="#F97316" />
        <circle cx="116" cy="83" r="1.8" fill="#FFFBEB" />
      </svg>
    );
  }

  if (worldId === 3) {
    // 3-olam: Sirli harf birikmalari — Magic Uzbek Letters Island (Sh, Ch, O‘, G‘, Ng)
    return (
      <svg
        viewBox="0 0 180 128"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`world-island-svg ${className}`.trim()}
        aria-hidden="true"
      >
        <ellipse cx="90" cy="112" rx="76" ry="12" fill="#BAE6FD" fillOpacity="0.85" />
        <path d="M22 92C22 104 52 111 90 111C128 111 158 104 158 92V85H22V92Z" fill="#9A663B" stroke="#5C3A21" strokeWidth="2.5" />
        <ellipse cx="90" cy="85" rx="68" ry="15" fill="#4C1D95" stroke="#2E1065" strokeWidth="2.5" />
        <ellipse cx="90" cy="82" rx="56" ry="10" fill="#6D28D9" />
        {/* Magic sparkles */}
        <path d="M36 42L38 48L44 50L38 52L36 58L34 52L28 50L34 48Z" fill="#FDE047" />
        <path d="M144 40L146 46L152 48L146 50L144 56L142 50L136 48L142 46Z" fill="#38BDF8" />
        <circle cx="90" cy="24" r="3" fill="#FDE047" />
        {/* Playful floating 3D Uzbek letters */}
        <g transform="rotate(-10 54 58)">
          <rect x="36" y="42" width="34" height="30" rx="9" fill="#F97316" stroke="#9A3412" strokeWidth="2.2" />
          <text x="53" y="63" textAnchor="middle" fill="#FFFFFF" fontSize="15" fontWeight="800" fontFamily="Fredoka, Nunito, sans-serif">
            Sh
          </text>
        </g>
        <g transform="rotate(8 126 56)">
          <rect x="110" y="40" width="34" height="30" rx="9" fill="#10B981" stroke="#065F46" strokeWidth="2.2" />
          <text x="127" y="61" textAnchor="middle" fill="#FFFFFF" fontSize="15" fontWeight="800" fontFamily="Fredoka, Nunito, sans-serif">
            Ch
          </text>
        </g>
        <rect x="70" y="34" width="40" height="38" rx="11" fill="#FBBF24" stroke="#B45309" strokeWidth="2.5" />
        <text x="90" y="61" textAnchor="middle" fill="#134E4A" fontSize="22" fontWeight="800" fontFamily="Fredoka, Nunito, sans-serif">
          O‘
        </text>
        <rect x="48" y="68" width="34" height="24" rx="8" fill="#38BDF8" stroke="#0369A1" strokeWidth="2" />
        <text x="65" y="85" textAnchor="middle" fill="#FFFFFF" fontSize="13" fontWeight="800" fontFamily="Fredoka, Nunito, sans-serif">
          G‘
        </text>
        <rect x="98" y="68" width="34" height="24" rx="8" fill="#EC4899" stroke="#9D174D" strokeWidth="2" />
        <text x="115" y="85" textAnchor="middle" fill="#FFFFFF" fontSize="13" fontWeight="800" fontFamily="Fredoka, Nunito, sans-serif">
          Ng
        </text>
      </svg>
    );
  }

  if (worldId === 4) {
    // 4-olam: Ravon kitobxon qal'asi — Fairytale Storybook Castle Island
    return (
      <svg
        viewBox="0 0 180 128"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`world-island-svg ${className}`.trim()}
        aria-hidden="true"
      >
        <ellipse cx="90" cy="112" rx="76" ry="12" fill="#BAE6FD" fillOpacity="0.85" />
        <path d="M22 92C22 104 52 111 90 111C128 111 158 104 158 92V85H22V92Z" fill="#B47B48" stroke="#6E4423" strokeWidth="2.5" />
        <ellipse cx="90" cy="85" rx="68" ry="15" fill="#65C466" stroke="#2E7D32" strokeWidth="2.5" />
        {/* Castle Towers */}
        <rect x="52" y="48" width="18" height="36" rx="2" fill="#FEF3C7" stroke="#92400E" strokeWidth="2.2" />
        <rect x="110" y="48" width="18" height="36" rx="2" fill="#FEF3C7" stroke="#92400E" strokeWidth="2.2" />
        <rect x="68" y="54" width="44" height="32" fill="#FDE68A" stroke="#92400E" strokeWidth="2.2" />
        <rect x="81" y="34" width="18" height="24" fill="#FEF3C7" stroke="#92400E" strokeWidth="2.2" />
        {/* Roofs */}
        <path d="M49 48L61 28L73 48H49Z" fill="#F87171" stroke="#991B1B" strokeWidth="2.2" strokeLinejoin="round" />
        <path d="M107 48L119 28L131 48H107Z" fill="#F87171" stroke="#991B1B" strokeWidth="2.2" strokeLinejoin="round" />
        <path d="M78 34L90 14L102 34H78Z" fill="#EF4444" stroke="#991B1B" strokeWidth="2.2" strokeLinejoin="round" />
        {/* Flag */}
        <line x1="90" y1="6" x2="90" y2="14" stroke="#78350F" strokeWidth="2" />
        <path d="M90 6L102 9.5L90 13V6Z" fill="#38BDF8" />
        {/* Door */}
        <path d="M82 86V70C82 65.5 85.5 62 90 62C94.5 62 98 65.5 98 70V86H82Z" fill="#92400E" />
        {/* Side trees */}
        <circle cx="38" cy="72" r="9" fill="#22C55E" stroke="#166534" strokeWidth="2" />
        <circle cx="142" cy="72" r="9" fill="#22C55E" stroke="#166534" strokeWidth="2" />
      </svg>
    );
  }

  // 5-olam: Qisqa gaplar olami — Cosmic Observatory & Rocket Island
  return (
    <svg
      viewBox="0 0 180 128"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`world-island-svg ${className}`.trim()}
      aria-hidden="true"
    >
      <ellipse cx="90" cy="112" rx="76" ry="12" fill="#BAE6FD" fillOpacity="0.85" />
      {/* Starry cosmic dome */}
      <path d="M24 85C24 44 53 16 90 16C127 16 156 44 156 85H24Z" fill="#1E293B" stroke="#334155" strokeWidth="2" />
      <circle cx="46" cy="52" r="2" fill="#FDE047" />
      <circle cx="62" cy="34" r="2.2" fill="#FFFFFF" />
      <circle cx="116" cy="28" r="2.2" fill="#FDE047" />
      <circle cx="136" cy="48" r="1.8" fill="#38BDF8" />
      <path d="M22 92C22 104 52 111 90 111C128 111 158 104 158 92V85H22V92Z" fill="#9A663B" stroke="#5C3A21" strokeWidth="2.5" />
      <ellipse cx="90" cy="85" rx="68" ry="15" fill="#1E3A8A" stroke="#0F172A" strokeWidth="2.5" />
      {/* Cosmic castle */}
      <rect x="64" y="52" width="44" height="32" rx="3" fill="#F1F5F9" stroke="#334155" strokeWidth="2.2" />
      <rect x="78" y="38" width="16" height="16" fill="#E2E8F0" stroke="#334155" strokeWidth="2" />
      <path d="M75 38L86 21L97 38H75Z" fill="#F97316" stroke="#9A3412" strokeWidth="2" strokeLinejoin="round" />
      <path d="M61 52L69 38L77 52H61Z" fill="#38BDF8" stroke="#0369A1" strokeWidth="2" />
      <path d="M95 52L103 38L111 52H95Z" fill="#38BDF8" stroke="#0369A1" strokeWidth="2" />
      <path d="M80 84V71C80 67.5 82.8 65 86 65C89.2 65 92 67.5 92 71V84H80Z" fill="#F97316" />
      {/* Launching Rocket */}
      <g transform="translate(122 28) rotate(24)">
        <path d="M12 0C18 8 20 18 18 28H6C4 18 6 8 12 0Z" fill="#FFFFFF" stroke="#1E293B" strokeWidth="2" />
        <path d="M12 0C15 5 17 10 17 14H7C7 10 9 5 12 0Z" fill="#EF4444" />
        <circle cx="12" cy="19" r="3" fill="#38BDF8" />
        <path d="M6 22L1 29L6 27V22Z" fill="#F97316" />
        <path d="M18 22L23 29L18 27V22Z" fill="#F97316" />
        <path d="M8 29L12 38L16 29H8Z" fill="#FBBF24" />
      </g>
    </svg>
  );
}
