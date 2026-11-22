interface StorybookBackdropProps {
  variant?: 'playful' | 'parent';
}

/**
 * Atmospheric warm cream storybook backdrop with drifting soft clouds,
 * pastel rolling hills, and stylized little trees matching the Alifbo 2.2 design mockups.
 */
export function StorybookBackdrop({ variant = 'playful' }: StorybookBackdropProps) {
  const isParent = variant === 'parent';

  return (
    <div
      className={`storybook-backdrop ${isParent ? 'storybook-backdrop-parent' : ''}`}
      aria-hidden="true"
    >
      {!isParent && (
        <>
          <svg
            className="backdrop-cloud backdrop-cloud-left"
            viewBox="0 0 180 70"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M28 54H146C158.15 54 168 44.15 168 32C168 20.8 159.6 11.6 148.8 10.2C144.2 4.1 136.9 0 128.6 0C119.3 0 111.2 5.1 106.9 12.7C102.6 9.8 97.4 8 91.8 8C77.8 8 66.4 18.8 65.4 32.5C63.1 31.5 60.6 31 58 31C46.4 31 37 40.4 37 52C37 52.7 37 53.3 37.1 54H28Z"
              fill="#FFFFFF"
              fillOpacity="0.92"
            />
          </svg>
          <svg
            className="backdrop-cloud backdrop-cloud-right"
            viewBox="0 0 160 64"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M20 52H136C147 52 156 43 156 32C156 21.5 147.8 13 137.4 12.1C133.2 5.1 125.6 0.5 117 0.5C105.7 0.5 96.2 8.4 93.7 19C89.8 16.5 85.1 15 80 15C66.7 15 56 25.7 56 39C56 40 56.1 41 56.2 42H20C14.5 42 10 46.5 10 52H20Z"
              fill="#FFFFFF"
              fillOpacity="0.88"
            />
          </svg>
        </>
      )}

      <svg
        className="backdrop-hills"
        viewBox="0 0 1440 240"
        preserveAspectRatio="none"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Back pastel hills */}
        <path
          d="M0 175C175 118 335 125 510 175C680 222 860 120 1070 140C1250 156 1365 115 1440 130V240H0V175Z"
          fill={isParent ? '#F3F7F4' : '#FDE6C4'}
          fillOpacity={isParent ? 0.75 : 0.7}
        />
        <path
          d="M0 198C210 155 415 215 620 172C820 130 980 205 1180 172C1310 150 1390 168 1440 180V240H0V198Z"
          fill={isParent ? '#EAF4EF' : '#D9F5DC'}
          fillOpacity={isParent ? 0.7 : 0.75}
        />
        <path
          d="M0 214C260 190 480 228 740 205C990 183 1210 222 1440 196V240H0V214Z"
          fill={isParent ? '#E6F2F4' : '#D8EEFB'}
          fillOpacity={isParent ? 0.65 : 0.72}
        />

        {/* Stylized storybook tiny trees on left & right margins */}
        <g opacity={isParent ? 0.45 : 0.85}>
          <rect x="82" y="168" width="6" height="24" rx="3" fill="#85654D" />
          <circle cx="85" cy="158" r="14" fill="#68B684" />
          <rect x="116" y="178" width="5" height="20" rx="2.5" fill="#85654D" />
          <circle cx="118.5" cy="170" r="11" fill="#84CC9C" />

          <rect x="1310" y="172" width="6" height="24" rx="3" fill="#85654D" />
          <circle cx="1313" cy="162" r="13" fill="#68B684" />
          <rect x="1346" y="160" width="6" height="28" rx="3" fill="#85654D" />
          <circle cx="1349" cy="148" r="15" fill="#52A374" />
        </g>
      </svg>
    </div>
  );
}
