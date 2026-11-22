import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const wordsDir = path.join(projectRoot, 'public', 'images', 'words');
const emojiDir = path.join(projectRoot, 'public', 'images', 'emoji');
const visualsOutPath = path.join(projectRoot, 'src', 'data', 'wordVisuals.ts');

fs.mkdirSync(wordsDir, { recursive: true });
fs.mkdirSync(emojiDir, { recursive: true });

const svgWrap = (bg, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none">\n` +
  `  <rect width="128" height="128" rx="28" fill="${bg}"/>\n` +
  `${body}\n</svg>\n`;

/** 29 bespoke child-friendly vector illustrations for Uzbek curriculum words */
const CUSTOM_SVGS = {
  anor: svgWrap(
    '#FFF1F2',
    `  <path d="M53 26 L56 15 L64 21 L72 15 L75 26 Z" fill="#C81E3A" stroke="#881337" stroke-width="2.5" stroke-linejoin="round"/>
  <circle cx="64" cy="69" r="40" fill="#E11D48" stroke="#9F1239" stroke-width="3"/>
  <ellipse cx="47" cy="52" rx="11" ry="17" transform="rotate(-22 47 52)" fill="#FB7185" opacity="0.5"/>
  <path d="M72 47 C89 49 97 64 93 80 C88 94 73 99 61 93 C53 88 53 74 59 60 C63 50 67 47 72 47 Z" fill="#FFF1F2" stroke="#9F1239" stroke-width="2.5"/>
  <circle cx="69" cy="63" r="4.5" fill="#BE123C"/><circle cx="79" cy="61" r="4.5" fill="#E11D48"/>
  <circle cx="85" cy="71" r="4.5" fill="#BE123C"/><circle cx="74" cy="73" r="4.5" fill="#9F1239"/>
  <circle cx="64" cy="76" r="4.2" fill="#E11D48"/><circle cx="73" cy="84" r="4.5" fill="#BE123C"/>
  <circle cx="83" cy="82" r="4.2" fill="#9F1239"/>
  <path d="M40 28 C30 22 25 27 32 34 C37 36 42 33 45 30 Z" fill="#22C55E" stroke="#15803D" stroke-width="2"/>`,
  ),
  doska: svgWrap(
    '#F0FDF4',
    `  <rect x="14" y="24" width="100" height="68" rx="10" fill="#B45309" stroke="#78350F" stroke-width="3.5"/>
  <rect x="22" y="32" width="84" height="52" rx="5" fill="#15803D" stroke="#14532D" stroke-width="2.5"/>
  <text x="34" y="57" font-family="Nunito, Arial, sans-serif" font-weight="900" font-size="22" fill="#FFFFFF" opacity="0.95">A  B  O</text>
  <line x1="34" y1="69" x2="88" y2="69" stroke="#BBF7D0" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="10 7"/>
  <rect x="10" y="90" width="108" height="9" rx="4.5" fill="#92400E" stroke="#78350F" stroke-width="2.5"/>
  <rect x="30" y="83" width="18" height="7" rx="2.5" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="1.5"/>
  <rect x="76" y="80" width="24" height="10" rx="3" fill="#F59E0B" stroke="#B45309" stroke-width="2"/>
  <rect x="76" y="86" width="24" height="4" rx="1.5" fill="#334155"/>
  <path d="M36 99 L30 112 M92 99 L98 112" stroke="#78350F" stroke-width="5" stroke-linecap="round"/>`,
  ),
  dasturxon: svgWrap(
    '#FFFBEB',
    `  <path d="M18 46 L110 46 L118 98 L10 98 Z" fill="#FEF3C7" stroke="#D97706" stroke-width="3" stroke-linejoin="round"/>
  <path d="M23 50 L105 50 L111 89 L17 89 Z" fill="#FFFFFF" stroke="#F59E0B" stroke-width="2"/>
  <path d="M16 90 L112 90 L116 98 L12 98 Z" fill="#EF4444" opacity="0.85"/>
  <circle cx="64" cy="69" r="15" fill="#F59E0B" stroke="#B45309" stroke-width="2.5"/>
  <circle cx="64" cy="69" r="8" fill="#FDE68A" stroke="#D97706" stroke-width="1.5"/>
  <circle cx="64" cy="69" r="2" fill="#B45309"/>
  <ellipse cx="93" cy="67" rx="10" ry="9" fill="#0284C7" stroke="#0369A1" stroke-width="2"/>
  <path d="M85 60 Q93 52 101 60" fill="#38BDF8" stroke="#0369A1" stroke-width="2"/>
  <path d="M103 65 Q110 66 107 73" stroke="#0369A1" stroke-width="2.5" stroke-linecap="round"/>
  <circle cx="36" cy="70" r="8" fill="#EF4444" stroke="#B91C1C" stroke-width="2"/>
  <circle cx="42" cy="59" r="6" fill="#22C55E" stroke="#15803D" stroke-width="1.8"/>
  <ellipse cx="47" cy="80" rx="7" ry="5" fill="#38BDF8" stroke="#0284C7" stroke-width="2"/>`,
  ),
  paxta: svgWrap(
    '#F0F9FF',
    `  <path d="M64 108 L64 76" stroke="#15803D" stroke-width="5" stroke-linecap="round"/>
  <path d="M64 94 C52 88 45 92 48 100 C54 102 60 99 64 94 Z" fill="#22C55E" stroke="#15803D" stroke-width="2"/>
  <path d="M40 74 L64 86 L88 74 L76 64 L52 64 Z" fill="#78350F" stroke="#451A03" stroke-width="2.5" stroke-linejoin="round"/>
  <circle cx="48" cy="54" r="18" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="2.5"/>
  <circle cx="80" cy="54" r="18" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="2.5"/>
  <circle cx="64" cy="40" r="20" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="2.5"/>
  <circle cx="64" cy="58" r="16" fill="#F8FAFC"/>
  <path d="M52 46 Q64 54 76 46" stroke="#E2E8F0" stroke-width="2.5" stroke-linecap="round"/>`,
  ),
  malina: svgWrap(
    '#FFF1F2',
    `  <path d="M64 26 L64 16 M64 25 L48 20 M64 25 L80 20" stroke="#15803D" stroke-width="3.5" stroke-linecap="round"/>
  <path d="M45 30 Q64 20 83 30 L72 36 L56 36 Z" fill="#22C55E" stroke="#15803D" stroke-width="2"/>
  <g fill="#E11D48" stroke="#9F1239" stroke-width="2">
    <circle cx="52" cy="44" r="10"/><circle cx="76" cy="44" r="10"/><circle cx="64" cy="41" r="10"/>
    <circle cx="46" cy="60" r="10"/><circle cx="82" cy="60" r="10"/><circle cx="64" cy="57" r="11"/>
    <circle cx="52" cy="76" r="10"/><circle cx="76" cy="76" r="10"/><circle cx="64" cy="74" r="10"/>
    <circle cx="58" cy="91" r="9"/><circle cx="70" cy="91" r="9"/><circle cx="64" cy="98" r="8"/>
  </g>
  <circle cx="50" cy="41" r="2.5" fill="#FDA4AF"/><circle cx="62" cy="54" r="2.5" fill="#FDA4AF"/><circle cx="74" cy="73" r="2.5" fill="#FDA4AF"/>`,
  ),
  ninachi: svgWrap(
    '#ECFEFF',
    `  <ellipse cx="42" cy="46" rx="24" ry="9" transform="rotate(-22 42 46)" fill="#BAE6FD" stroke="#0284C7" stroke-width="2.2" opacity="0.85"/>
  <ellipse cx="86" cy="46" rx="24" ry="9" transform="rotate(22 86 46)" fill="#BAE6FD" stroke="#0284C7" stroke-width="2.2" opacity="0.85"/>
  <ellipse cx="43" cy="64" rx="21" ry="8" transform="rotate(14 43 64)" fill="#E0F2FE" stroke="#0284C7" stroke-width="2.2" opacity="0.85"/>
  <ellipse cx="85" cy="64" rx="21" ry="8" transform="rotate(-14 85 64)" fill="#E0F2FE" stroke="#0284C7" stroke-width="2.2" opacity="0.85"/>
  <rect x="60" y="38" width="8" height="66" rx="4" fill="#06B6D4" stroke="#0E7490" stroke-width="2.5"/>
  <circle cx="64" cy="34" r="9" fill="#14B8A6" stroke="#0E7490" stroke-width="2.5"/>
  <circle cx="58" cy="31" r="4" fill="#1E293B"/><circle cx="70" cy="31" r="4" fill="#1E293B"/>
  <circle cx="59" cy="30" r="1.4" fill="#FFF"/><circle cx="71" cy="30" r="1.4" fill="#FFF"/>`,
  ),
  qalamdon: svgWrap(
    '#F5F3FF',
    `  <path d="M36 42 L44 18 L52 42 Z" fill="#FDE68A" stroke="#D97706" stroke-width="2"/>
  <rect x="36" y="42" width="16" height="22" fill="#EF4444" stroke="#B91C1C" stroke-width="2"/>
  <path d="M62 42 L68 15 L75 42 Z" fill="#FDE68A" stroke="#D97706" stroke-width="2"/>
  <rect x="62" y="42" width="13" height="22" fill="#3B82F6" stroke="#1D4ED8" stroke-width="2"/>
  <path d="M82 42 L89 20 L95 42 Z" fill="#FDE68A" stroke="#D97706" stroke-width="2"/>
  <rect x="82" y="42" width="13" height="22" fill="#22C55E" stroke="#15803D" stroke-width="2"/>
  <rect x="20" y="54" width="88" height="48" rx="16" fill="#8B5CF6" stroke="#6D28D9" stroke-width="3"/>
  <rect x="24" y="58" width="80" height="12" rx="6" fill="#A78BFA"/>
  <line x1="24" y1="66" x2="104" y2="66" stroke="#FBBF24" stroke-width="3.5" stroke-dasharray="4 3"/>
  <circle cx="94" cy="66" r="5" fill="#F59E0B" stroke="#B45309" stroke-width="2"/>
  <circle cx="64" cy="84" r="7" fill="#FDE047"/>`,
  ),
  kitobxon: svgWrap(
    '#EFF6FF',
    `  <path d="M18 42 C36 35 54 39 64 49 L64 99 C52 91 34 89 18 94 Z" fill="#FFFFFF" stroke="#2563EB" stroke-width="3" stroke-linejoin="round"/>
  <path d="M110 42 C92 35 74 39 64 49 L64 99 C76 91 94 89 110 94 Z" fill="#F8FAFC" stroke="#2563EB" stroke-width="3" stroke-linejoin="round"/>
  <line x1="28" y1="56" x2="54" y2="59" stroke="#93C5FD" stroke-width="3" stroke-linecap="round"/>
  <line x1="28" y1="68" x2="54" y2="71" stroke="#93C5FD" stroke-width="3" stroke-linecap="round"/>
  <line x1="28" y1="80" x2="48" y2="82" stroke="#93C5FD" stroke-width="3" stroke-linecap="round"/>
  <line x1="74" y1="59" x2="100" y2="56" stroke="#93C5FD" stroke-width="3" stroke-linecap="round"/>
  <line x1="74" y1="71" x2="100" y2="68" stroke="#93C5FD" stroke-width="3" stroke-linecap="round"/>
  <path d="M64 16 L68 26 L78 27 L70 34 L72 44 L64 39 L56 44 L58 34 L50 27 L60 26 Z" fill="#FACC15" stroke="#CA8A04" stroke-width="2" stroke-linejoin="round"/>`,
  ),
  orik: svgWrap(
    '#FFF7ED',
    `  <path d="M64 34 L64 20" stroke="#78350F" stroke-width="4" stroke-linecap="round"/>
  <path d="M66 26 C80 14 96 22 86 35 C78 39 70 34 66 26 Z" fill="#22C55E" stroke="#15803D" stroke-width="2.2"/>
  <circle cx="64" cy="68" r="35" fill="#FB923C" stroke="#EA580C" stroke-width="3"/>
  <path d="M64 34 C56 54 56 84 64 102" stroke="#EA580C" stroke-width="2.5" stroke-linecap="round" opacity="0.65"/>
  <ellipse cx="48" cy="54" rx="9" ry="15" transform="rotate(-20 48 54)" fill="#FDBA74" opacity="0.65"/>`,
  ),
  qaldirgoch: svgWrap(
    '#F0F9FF',
    `  <path d="M22 42 Q46 32 62 56 L42 64 Z" fill="#1E293B" stroke="#0F172A" stroke-width="2.5" stroke-linejoin="round"/>
  <path d="M22 84 L46 72 L52 80 L28 96 L40 80 Z" fill="#1E293B" stroke="#0F172A" stroke-width="2" stroke-linejoin="round"/>
  <ellipse cx="64" cy="66" rx="22" ry="14" transform="rotate(-18 64 66)" fill="#1E293B" stroke="#0F172A" stroke-width="2.5"/>
  <ellipse cx="67" cy="70" rx="14" ry="8" transform="rotate(-18 67 70)" fill="#F8FAFC"/>
  <path d="M66 48 Q92 22 106 38 Q86 58 72 60 Z" fill="#334155" stroke="#0F172A" stroke-width="2.5" stroke-linejoin="round"/>
  <circle cx="84" cy="54" r="9" fill="#1E293B"/>
  <circle cx="84" cy="58" r="5" fill="#F97316"/>
  <circle cx="86" cy="52" r="2.2" fill="#FFF"/>
  <path d="M92 54 L102 56 L92 59 Z" fill="#F59E0B"/>`,
  ),
  non: svgWrap(
    '#FFFBEB',
    `  <circle cx="64" cy="64" r="42" fill="#F59E0B" stroke="#B45309" stroke-width="3.5"/>
  <circle cx="64" cy="64" r="32" fill="#FBBF24"/>
  <circle cx="64" cy="64" r="20" fill="#FDE68A" stroke="#D97706" stroke-width="2.5"/>
  <g fill="#92400E">
    <circle cx="64" cy="56" r="2"/><circle cx="56" cy="64" r="2"/><circle cx="72" cy="64" r="2"/>
    <circle cx="64" cy="72" r="2"/><circle cx="64" cy="64" r="2.2"/>
  </g>
  <ellipse cx="44" cy="40" rx="8" ry="4" transform="rotate(-30 44 40)" fill="#FEF3C7" opacity="0.7"/>`,
  ),
  shirmon: svgWrap(
    '#FEF3C7',
    `  <circle cx="64" cy="64" r="41" fill="#EA580C" stroke="#9A3412" stroke-width="3"/>
  <circle cx="64" cy="64" r="30" fill="#FB923C" stroke="#C2410C" stroke-width="2.5" stroke-dasharray="9 5"/>
  <circle cx="64" cy="64" r="16" fill="#FDE047" stroke="#CA8A04" stroke-width="2"/>
  <circle cx="64" cy="64" r="4" fill="#B45309"/>`,
  ),
  gulzor: svgWrap(
    '#F0FDF4',
    `  <rect x="16" y="84" width="96" height="22" rx="11" fill="#22C55E" stroke="#15803D" stroke-width="2.5"/>
  <path d="M36 86 L36 52 M64 86 L64 42 M92 86 L92 54" stroke="#15803D" stroke-width="4" stroke-linecap="round"/>
  <circle cx="36" cy="46" r="12" fill="#F43F5E"/><circle cx="36" cy="46" r="5" fill="#FDE047"/>
  <path d="M52 44 C52 28 76 28 76 44 C76 54 68 58 64 58 C60 58 52 54 52 44 Z" fill="#EC4899" stroke="#BE185D" stroke-width="2"/>
  <circle cx="92" cy="48" r="12" fill="#8B5CF6"/><circle cx="92" cy="48" r="5" fill="#FDE047"/>`,
  ),
  kabob: svgWrap(
    '#FFF7ED',
    `  <line x1="20" y1="104" x2="106" y2="22" stroke="#64748B" stroke-width="5" stroke-linecap="round"/>
  <rect x="34" y="68" width="22" height="22" rx="6" transform="rotate(-45 45 79)" fill="#B45309" stroke="#78350F" stroke-width="2.5"/>
  <circle cx="62" cy="64" r="10" fill="#EF4444" stroke="#B91C1C" stroke-width="2"/>
  <rect x="66" y="36" width="22" height="22" rx="6" transform="rotate(-45 77 47)" fill="#92400E" stroke="#78350F" stroke-width="2.5"/>
  <circle cx="92" cy="34" r="8" fill="#22C55E" stroke="#15803D" stroke-width="2"/>`,
  ),
  qovun: svgWrap(
    '#FEFCE8',
    `  <ellipse cx="64" cy="66" rx="44" ry="29" fill="#FACC15" stroke="#CA8A04" stroke-width="3"/>
  <path d="M22 66 Q64 46 106 66" stroke="#16A34A" stroke-width="3" stroke-dasharray="6 4"/>
  <path d="M26 55 Q64 39 102 55" stroke="#16A34A" stroke-width="2.5" stroke-dasharray="5 4"/>
  <path d="M26 77 Q64 93 102 77" stroke="#16A34A" stroke-width="2.5" stroke-dasharray="5 4"/>
  <path d="M104 54 L112 46" stroke="#78350F" stroke-width="4" stroke-linecap="round"/>`,
  ),
  kompot: svgWrap(
    '#FFF1F2',
    `  <path d="M32 38 L66 38 L72 98 L26 98 Z" fill="#FFE4E6" stroke="#BE123C" stroke-width="3" stroke-linejoin="round"/>
  <path d="M29 54 L69 54 L72 97 L26 97 Z" fill="#E11D48" opacity="0.85"/>
  <path d="M68 48 Q82 48 80 68 Q78 78 70 78" stroke="#BE123C" stroke-width="3.5" stroke-linecap="round"/>
  <circle cx="44" cy="74" r="6" fill="#9F1239"/><circle cx="56" cy="84" r="5" fill="#FDE047"/>
  <path d="M84 64 L108 64 L104 98 L88 98 Z" fill="#FB7185" stroke="#BE123C" stroke-width="2.5" stroke-linejoin="round"/>`,
  ),
  tovoq: svgWrap(
    '#EFF6FF',
    `  <ellipse cx="64" cy="66" rx="46" ry="30" fill="#FFFFFF" stroke="#1D4ED8" stroke-width="3.5"/>
  <ellipse cx="64" cy="66" rx="34" ry="20" fill="#EFF6FF" stroke="#3B82F6" stroke-width="2.5" stroke-dasharray="6 4"/>
  <circle cx="64" cy="66" r="9" fill="#F59E0B" stroke="#B45309" stroke-width="2"/>
  <circle cx="42" cy="66" r="4" fill="#2563EB"/><circle cx="86" cy="66" r="4" fill="#2563EB"/>`,
  ),
  kosa: svgWrap(
    '#F0F9FF',
    `  <path d="M22 50 L106 50 C106 84 86 98 64 98 C42 98 22 84 22 50 Z" fill="#FFFFFF" stroke="#0284C7" stroke-width="3.5" stroke-linejoin="round"/>
  <rect x="44" y="96" width="40" height="8" rx="3" fill="#E0F2FE" stroke="#0284C7" stroke-width="2.5"/>
  <line x1="24" y1="60" x2="104" y2="60" stroke="#38BDF8" stroke-width="3"/>
  <circle cx="46" cy="76" r="5" fill="#0284C7"/><circle cx="64" cy="78" r="6" fill="#0284C7"/><circle cx="82" cy="76" r="5" fill="#0284C7"/>`,
  ),
  sandal: svgWrap(
    '#FDF2F8',
    `  <ellipse cx="44" cy="66" rx="16" ry="36" fill="#F59E0B" stroke="#B45309" stroke-width="3"/>
  <path d="M29 52 Q44 42 59 52" stroke="#EC4899" stroke-width="8" stroke-linecap="round"/>
  <path d="M30 74 Q44 68 58 74" stroke="#EC4899" stroke-width="7" stroke-linecap="round"/>
  <ellipse cx="84" cy="66" rx="16" ry="36" fill="#F59E0B" stroke="#B45309" stroke-width="3"/>
  <path d="M69 52 Q84 42 99 52" stroke="#EC4899" stroke-width="8" stroke-linecap="round"/>
  <path d="M70 74 Q84 68 98 74" stroke="#EC4899" stroke-width="7" stroke-linecap="round"/>`,
  ),
  motor: svgWrap(
    '#F1F5F9',
    `  <rect x="26" y="42" width="66" height="48" rx="10" fill="#64748B" stroke="#334155" stroke-width="3"/>
  <rect x="38" y="28" width="38" height="14" rx="4" fill="#94A3B8" stroke="#334155" stroke-width="2.5"/>
  <line x1="36" y1="54" x2="72" y2="54" stroke="#CBD5E1" stroke-width="3" stroke-linecap="round"/>
  <line x1="36" y1="66" x2="72" y2="66" stroke="#CBD5E1" stroke-width="3" stroke-linecap="round"/>
  <line x1="36" y1="78" x2="72" y2="78" stroke="#CBD5E1" stroke-width="3" stroke-linecap="round"/>
  <circle cx="98" cy="66" r="14" fill="#F59E0B" stroke="#B45309" stroke-width="3"/>
  <circle cx="98" cy="66" r="5" fill="#FEF3C7"/>`,
  ),
  buzoq: svgWrap(
    '#FEFCE8',
    `  <ellipse cx="32" cy="44" rx="11" ry="6" transform="rotate(-20 32 44)" fill="#78350F"/>
  <ellipse cx="96" cy="44" rx="11" ry="6" transform="rotate(20 96 44)" fill="#78350F"/>
  <circle cx="64" cy="62" r="31" fill="#FFFFFF" stroke="#475569" stroke-width="3"/>
  <path d="M36 46 Q52 44 48 60 Q36 62 36 46 Z" fill="#334155"/>
  <ellipse cx="64" cy="77" rx="22" ry="15" fill="#FDA4AF" stroke="#E11D48" stroke-width="2"/>
  <circle cx="55" cy="76" r="2.8" fill="#9F1239"/><circle cx="73" cy="76" r="2.8" fill="#9F1239"/>
  <circle cx="52" cy="55" r="4" fill="#0F172A"/><circle cx="76" cy="55" r="4" fill="#0F172A"/>`,
  ),
  gildirak: svgWrap(
    '#F8FAFC',
    `  <circle cx="64" cy="64" r="42" fill="#1E293B" stroke="#0F172A" stroke-width="3"/>
  <circle cx="64" cy="64" r="25" fill="#CBD5E1" stroke="#475569" stroke-width="3"/>
  <circle cx="64" cy="64" r="8" fill="#475569"/>
  <line x1="64" y1="39" x2="64" y2="89" stroke="#64748B" stroke-width="4"/>
  <line x1="39" y1="64" x2="89" y2="64" stroke="#64748B" stroke-width="4"/>`,
  ),
  maral: svgWrap(
    '#FFFBEB',
    `  <path d="M46 36 L34 18 M40 27 L28 28 M82 36 L94 18 M88 27 L100 28" stroke="#78350F" stroke-width="4" stroke-linecap="round"/>
  <ellipse cx="64" cy="64" rx="26" ry="30" fill="#D97706" stroke="#92400E" stroke-width="3"/>
  <ellipse cx="64" cy="78" rx="14" ry="12" fill="#FEF3C7"/>
  <circle cx="53" cy="58" r="4" fill="#0F172A"/><circle cx="75" cy="58" r="4" fill="#0F172A"/>
  <ellipse cx="64" cy="74" rx="5" ry="3.5" fill="#0F172A"/>`,
  ),
  choynak: svgWrap(
    '#EFF6FF',
    `  <path d="M36 58 L20 48 L24 66 Z" fill="#0284C7" stroke="#0369A1" stroke-width="2.5" stroke-linejoin="round"/>
  <path d="M90 52 C108 52 108 82 90 82" stroke="#0369A1" stroke-width="5" stroke-linecap="round"/>
  <circle cx="64" cy="68" r="28" fill="#0EA5E9" stroke="#0369A1" stroke-width="3"/>
  <ellipse cx="64" cy="40" rx="16" ry="6" fill="#38BDF8" stroke="#0369A1" stroke-width="2.5"/>
  <circle cx="64" cy="31" r="5" fill="#FACC15" stroke="#CA8A04" stroke-width="2"/>
  <circle cx="64" cy="68" r="10" fill="#FFFFFF" opacity="0.85"/>`,
  ),
  tola: svgWrap(
    '#FFF1F2',
    `  <rect x="34" y="24" width="60" height="12" rx="4" fill="#D97706" stroke="#92400E" stroke-width="2.5"/>
  <rect x="34" y="92" width="60" height="12" rx="4" fill="#D97706" stroke="#92400E" stroke-width="2.5"/>
  <rect x="40" y="36" width="48" height="56" fill="#EF4444" stroke="#B91C1C" stroke-width="2.5"/>
  <line x1="40" y1="48" x2="88" y2="54" stroke="#FCA5A5" stroke-width="3"/>
  <line x1="40" y1="62" x2="88" y2="68" stroke="#FCA5A5" stroke-width="3"/>
  <line x1="40" y1="76" x2="88" y2="82" stroke="#FCA5A5" stroke-width="3"/>`,
  ),
  nina: svgWrap(
    '#F0F9FF',
    `  <path d="M24 100 L96 26 C101 21 106 26 101 31 L30 104 Z" fill="#94A3B8" stroke="#334155" stroke-width="2.5" stroke-linejoin="round"/>
  <circle cx="94" cy="32" r="3" fill="#F0F9FF"/>
  <path d="M94 32 C112 46 80 74 104 94" stroke="#EF4444" stroke-width="3.5" stroke-linecap="round"/>`,
  ),
  arra: svgWrap(
    '#FEF3C7',
    `  <path d="M22 86 L82 32 L94 44 L36 96 L32 88 L26 92 Z" fill="#CBD5E1" stroke="#475569" stroke-width="2.5" stroke-linejoin="round"/>
  <rect x="78" y="22" width="26" height="24" rx="6" transform="rotate(-40 91 34)" fill="#F97316" stroke="#C2410C" stroke-width="3"/>`,
  ),
  oltin: svgWrap(
    '#FEFCE8',
    `  <circle cx="48" cy="72" r="24" fill="#FACC15" stroke="#CA8A04" stroke-width="3"/>
  <circle cx="48" cy="72" r="15" stroke="#EAB308" stroke-width="2"/>
  <circle cx="78" cy="56" r="24" fill="#FDE047" stroke="#CA8A04" stroke-width="3"/>
  <circle cx="78" cy="56" r="15" stroke="#EAB308" stroke-width="2"/>
  <path d="M78 46 L81 53 L88 53 L82 58 L84 65 L78 61 L72 65 L74 58 L68 53 L75 53 Z" fill="#CA8A04"/>`,
  ),
  alo: svgWrap(
    '#FFFBEB',
    `  <path d="M44 20 L58 20 L64 50 L50 50 Z" fill="#2563EB"/>
  <path d="M70 20 L84 20 L78 50 L64 50 Z" fill="#EF4444"/>
  <circle cx="64" cy="74" r="30" fill="#FACC15" stroke="#CA8A04" stroke-width="3.5"/>
  <circle cx="64" cy="74" r="22" fill="#FEF08A" stroke="#EAB308" stroke-width="2"/>
  <text x="64" y="84" text-anchor="middle" font-family="Nunito, Arial, sans-serif" font-weight="900" font-size="30" fill="#B45309">5</text>`,
  ),
};

for (const [name, svg] of Object.entries(CUSTOM_SVGS)) {
  fs.writeFileSync(path.join(wordsDir, `${name}.svg`), svg, 'utf8');
}
console.log(`Generated ${Object.keys(CUSTOM_SVGS).length} custom word SVGs in public/images/words/`);

const CUSTOM_WORD_VISUAL_BY_ID = {
  anor: '/images/words/anor.svg',
  doska: '/images/words/doska.svg',
  dasturxon: '/images/words/dasturxon.svg',
  malina: '/images/words/malina.svg',
  orik: '/images/words/orik.svg',
  paxta: '/images/words/paxta.svg',
  ninachi: '/images/words/ninachi.svg',
  qalamdon: '/images/words/qalamdon.svg',
  kitobxon: '/images/words/kitobxon.svg',
  qaldirgoch: '/images/words/qaldirgoch.svg',
  non: '/images/words/non.svg',
  gap_ona_non: '/images/words/non.svg',
  shirmon: '/images/words/shirmon.svg',
  gulzor: '/images/words/gulzor.svg',
  kabob: '/images/words/kabob.svg',
  qovun: '/images/words/qovun.svg',
  kompot: '/images/words/kompot.svg',
  tovoq: '/images/words/tovoq.svg',
  kosa: '/images/words/kosa.svg',
  sandal: '/images/words/sandal.svg',
  motor: '/images/words/motor.svg',
  buzoq: '/images/words/buzoq.svg',
  gildirak: '/images/words/gildirak.svg',
  maral: '/images/words/maral.svg',
  choynak: '/images/words/choynak.svg',
  gap_bobo_choy: '/images/words/choynak.svg',
  tola: '/images/words/tola.svg',
  nina: '/images/words/nina.svg',
  arra: '/images/words/arra.svg',
  oltin: '/images/words/oltin.svg',
  alo: '/images/words/alo.svg',
};

const CUSTOM_VISUAL_BY_EMOJI = {
  '🔴': '/images/words/anor.svg',
  '🟩': '/images/words/doska.svg',
  '🍽️': '/images/words/dasturxon.svg',
  '🩷': '/images/words/malina.svg',
  '🟠': '/images/words/orik.svg',
  '🤍': '/images/words/paxta.svg',
  '🪰': '/images/words/ninachi.svg',
  '🖍️': '/images/words/qalamdon.svg',
  '🤓': '/images/words/kitobxon.svg',
  '🐦': '/images/words/qaldirgoch.svg',
  '🥖': '/images/words/non.svg',
  '🫓': '/images/words/shirmon.svg',
  '🌺': '/images/words/gulzor.svg',
  '🍢': '/images/words/kabob.svg',
  '🍈': '/images/words/qovun.svg',
  '🧃': '/images/words/kompot.svg',
  '🍲': '/images/words/tovoq.svg',
  '🥣': '/images/words/kosa.svg',
  '👡': '/images/words/sandal.svg',
  '⚙️': '/images/words/motor.svg',
  '🐄': '/images/words/buzoq.svg',
  '🛞': '/images/words/gildirak.svg',
  '🦌': '/images/words/maral.svg',
  '🫖': '/images/words/choynak.svg',
  '🧵': '/images/words/tola.svg',
  '🪡': '/images/words/nina.svg',
  '🪚': '/images/words/arra.svg',
  '🪙': '/images/words/oltin.svg',
  '🏅': '/images/words/alo.svg',
};

// Collect all emojis from curriculum.ts, gamification.ts, wordPoolEngine.ts
const cur = fs.readFileSync(path.join(projectRoot, 'src', 'data', 'curriculum.ts'), 'utf8');
const gam = fs.readFileSync(path.join(projectRoot, 'src', 'logic', 'gamification.ts'), 'utf8');
const wpe = fs.readFileSync(path.join(projectRoot, 'src', 'logic', 'wordPoolEngine.ts'), 'utf8');

const allEmojis = new Set(['🔴', '🟩', '🟠', '🩷']);
for (const m of cur.matchAll(/exampleEmoji:\s*'([^']+)'/g)) allEmojis.add(m[1]);
for (const m of cur.matchAll(/icon:\s*'([^']+)'/g)) allEmojis.add(m[1]);
for (const m of cur.matchAll(/makeWordItem\('[^']+',\s*\d+,\s*'[^']+',\s*\[[^\]]+\],\s*'([^']+)',\s*\[([^\]]+)\]/g)) {
  allEmojis.add(m[1]);
  for (const d of m[2].matchAll(/'([^']+)'/g)) allEmojis.add(d[1]);
}
for (const m of gam.matchAll(/emoji:\s*'([^']+)'/g)) allEmojis.add(m[1]);
const fb = wpe.match(/FALLBACK_EMOJI_POOL\s*=\s*\[([^\]]+)\]/);
if (fb) for (const d of fb[1].matchAll(/'([^']+)'/g)) allEmojis.add(d[1]);

function toTwemojiCandidates(emoji) {
  const cps = [...emoji].map((c) => c.codePointAt(0).toString(16));
  const withFe0f = cps.join('-');
  const withoutFe0f = cps.includes('200d') ? withFe0f : cps.filter((cp) => cp !== 'fe0f').join('-');
  return Array.from(new Set([withoutFe0f, withFe0f]));
}

const localTwemojiMap = {};
for (const emoji of allEmojis) {
  if (CUSTOM_VISUAL_BY_EMOJI[emoji]) continue;
  const candidates = toTwemojiCandidates(emoji);
  let downloaded = false;
  for (const code of candidates) {
    const outPath = path.join(emojiDir, `${code}.svg`);
    if (fs.existsSync(outPath) && fs.readFileSync(outPath, 'utf8').includes('<svg')) {
      localTwemojiMap[emoji] = `/images/emoji/${code}.svg`;
      downloaded = true;
      break;
    }
    const url = `https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg/${code}.svg`;
    const resp = await fetch(url);
    if (resp.ok) {
      const body = await resp.text();
      if (body.includes('<svg')) {
        fs.writeFileSync(outPath, body, 'utf8');
        localTwemojiMap[emoji] = `/images/emoji/${code}.svg`;
        downloaded = true;
        break;
      }
    }
  }
  if (!downloaded) {
    throw new Error(`Failed to fetch Twemoji SVG for ${emoji} (candidates: ${candidates.join(', ')})`);
  }
}

console.log(`Verified ${Object.keys(localTwemojiMap).length} local Twemoji SVGs in public/images/emoji/`);

const tsLines = [
  '/* Auto-generated by scripts/build_visual_assets.mjs — crisp local SVG asset mapping */',
  '',
  'export const CUSTOM_WORD_VISUAL_BY_ID: Record<string, string> = ' + JSON.stringify(CUSTOM_WORD_VISUAL_BY_ID, null, 2) + ';',
  '',
  'export const CUSTOM_VISUAL_BY_EMOJI: Record<string, string> = ' + JSON.stringify(CUSTOM_VISUAL_BY_EMOJI, null, 2) + ';',
  '',
  'export const LOCAL_TWEMOJI_FILE_MAP: Record<string, string> = ' + JSON.stringify(localTwemojiMap, null, 2) + ';',
  '',
  `export function resolveVisualSrc(params: {
  emoji: string;
  wordId?: string;
  letter?: string;
}): string {
  const byId = params.wordId ? CUSTOM_WORD_VISUAL_BY_ID[params.wordId] : undefined;
  if (byId) return byId;
  const byEmojiCustom = CUSTOM_VISUAL_BY_EMOJI[params.emoji];
  if (byEmojiCustom) return byEmojiCustom;
  const byTwemoji = LOCAL_TWEMOJI_FILE_MAP[params.emoji];
  if (byTwemoji) return byTwemoji;
  if (params.letter === 'A') return '/images/words/anor.svg';
  return '/images/emoji/1f34e.svg';
}

export function getVisualAltUz(emoji: string, fallback?: string): string {
  if (fallback && fallback.trim().length > 0) return fallback.trim();
  const customPath = CUSTOM_VISUAL_BY_EMOJI[emoji];
  if (customPath) {
    return customPath.replace('/images/words/', '').replace('.svg', '') + ' rasmi';
  }
  return 'O‘yin rasmi';
}
`,
];

fs.writeFileSync(visualsOutPath, tsLines.join('\n'), 'utf8');
console.log(`Wrote ${visualsOutPath}`);
