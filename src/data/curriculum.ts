export type SoundCategory = 'vowel' | 'consonant';

export interface LetterMeta {
  letter: string;
  category: SoundCategory;
  continuant: boolean;
  soundLabel: string;
  colorClass: 'vowel' | 'consonant';
}

export type ItemKind = 'letter' | 'syllable' | 'word';

export interface CurriculumItem {
  id: string;
  stage: number;
  kind: ItemKind;
  text: string;
  /** Visual parts for the blending slider (e.g. ['M', 'A'] or ['BO', 'LA']) */
  parts: string[];
  accept: string[];
  coachTipUz: string;
  audioTeacher: string;
  audioSound: string;
}

export interface CurriculumStage {
  stage: number;
  title: string;
  subtitle: string;
  noteUz: string;
  accentColor: string;
}

export const LETTER_META: Record<string, LetterMeta> = {
  A: { letter: 'A', category: 'vowel', continuant: true, soundLabel: 'aaaa', colorClass: 'vowel' },
  O: { letter: 'O', category: 'vowel', continuant: true, soundLabel: 'oooo', colorClass: 'vowel' },
  I: { letter: 'I', category: 'vowel', continuant: true, soundLabel: 'iiii', colorClass: 'vowel' },
  U: { letter: 'U', category: 'vowel', continuant: true, soundLabel: 'uuuu', colorClass: 'vowel' },
  E: { letter: 'E', category: 'vowel', continuant: true, soundLabel: 'eeee', colorClass: 'vowel' },
  N: { letter: 'N', category: 'consonant', continuant: true, soundLabel: 'nnnn', colorClass: 'consonant' },
  M: { letter: 'M', category: 'consonant', continuant: true, soundLabel: 'mmmm', colorClass: 'consonant' },
  L: { letter: 'L', category: 'consonant', continuant: true, soundLabel: 'llll', colorClass: 'consonant' },
  S: { letter: 'S', category: 'consonant', continuant: true, soundLabel: 'ssss', colorClass: 'consonant' },
  R: { letter: 'R', category: 'consonant', continuant: true, soundLabel: 'rrrr', colorClass: 'consonant' },
  V: { letter: 'V', category: 'consonant', continuant: true, soundLabel: 'vvvv', colorClass: 'consonant' },
  B: { letter: 'B', category: 'consonant', continuant: false, soundLabel: 'b', colorClass: 'consonant' },
  T: { letter: 'T', category: 'consonant', continuant: false, soundLabel: 't', colorClass: 'consonant' },
  D: { letter: 'D', category: 'consonant', continuant: false, soundLabel: 'd', colorClass: 'consonant' },
  K: { letter: 'K', category: 'consonant', continuant: false, soundLabel: 'k', colorClass: 'consonant' },
};

export const VOWELS = new Set(['A', 'O', 'I', 'U', 'E']);

export function getLetterCategory(ch: string): SoundCategory {
  return VOWELS.has(ch.toUpperCase()) ? 'vowel' : 'consonant';
}

export const CURRICULUM_STAGES: CurriculumStage[] = [
  {
    stage: 1,
    title: '1-bosqich: Unlilar vodiysi',
    subtitle: 'A, O, I, U, E — OI, AU (7 ta dars)',
    noteUz: 'Bu bosqichda A, O, I, U, E unli harflari hamda OI va AU ulanmalari beriladi.',
    accentColor: '#ff4b4b',
  },
  {
    stage: 2,
    title: '2-bosqich: Bo‘g‘inlar o‘rmoni',
    subtitle: 'N, NA, NO, NI — M, MA, MO — L, LO, LA (10 ta dars)',
    noteUz: 'Bu bosqichda N, M, L undosh harflari va ulardan tuzilgan 7 ta bo‘g‘in mashq qilinadi.',
    accentColor: '#1cb0f6',
  },
  {
    stage: 3,
    title: '3-bosqich: Ilk so‘zlar qishlog‘i',
    subtitle: 'ONA, ANA, NON, NIMA, LOLA, OLMA, OILA, LIMON (8 ta dars)',
    noteUz: 'Bu bosqichda 1–2-bosqichda o‘tilgan harflardan tuzilgan 8 ta ilk so‘z o‘qiladi.',
    accentColor: '#58cc02',
  },
  {
    stage: 4,
    title: '4-bosqich: Shovqinli daryo',
    subtitle: 'S, SA, SI — R, RO, RA, ARRA, ASAL — V, SUV (10 ta dars)',
    noteUz: 'Bu bosqichda S, R, V harflari hamda ular ishtirokidagi bo‘g‘in va so‘zlar beriladi.',
    accentColor: '#ff9600',
  },
  {
    stage: 5,
    title: '5-bosqich: Kitobxonlar qal’asi',
    subtitle: 'B, BOLA, BOBO — T, OTA — D, DADA — K, KITOB (13 ta dars)',
    noteUz: 'Bu bosqichda B, T, D, K harflari bilan bo‘g‘inlar va sevimli so‘zlar o‘zlashtiriladi.',
    accentColor: '#ce82ff',
  },
];

export const CURRICULUM_ITEMS: CurriculumItem[] = [
  // Stage 1: 7 lessons (A, O, I, U, E, OI, AU)
  {
    id: 'a',
    stage: 1,
    kind: 'letter',
    text: 'A',
    parts: ['A'],
    accept: ['a', 'aa', 'aaa', 'ha'],
    coachTipUz: "Og'zingizni ochib, «Aaaaa» deb cho'zib ayting.",
    audioTeacher: '/audio/item_a.mp3',
    audioSound: '/audio/sound_a.mp3',
  },
  {
    id: 'o',
    stage: 1,
    kind: 'letter',
    text: 'O',
    parts: ['O'],
    accept: ['o', 'oo', 'ooo', 'oh', "o'"],
    coachTipUz: "Labingizni doira qilib, «Ooooo» deb ayting.",
    audioTeacher: '/audio/item_o.mp3',
    audioSound: '/audio/sound_o.mp3',
  },
  {
    id: 'i',
    stage: 1,
    kind: 'letter',
    text: 'I',
    parts: ['I'],
    accept: ['i', 'ii', 'iii', 'ey'],
    coachTipUz: "Tabassum qilib «Iiiii» deb cho'zib ayting.",
    audioTeacher: '/audio/item_i.mp3',
    audioSound: '/audio/sound_i.mp3',
  },
  {
    id: 'u',
    stage: 1,
    kind: 'letter',
    text: 'U',
    parts: ['U'],
    accept: ['u', 'uu', 'uuu', "o'", 'o'],
    coachTipUz: "Labingizni oldinga cho'zib, «Uuuuu» deng.",
    audioTeacher: '/audio/item_u.mp3',
    audioSound: '/audio/sound_u.mp3',
  },
  {
    id: 'e',
    stage: 1,
    kind: 'letter',
    text: 'E',
    parts: ['E'],
    accept: ['e', 'ee', 'eee', 'ey'],
    coachTipUz: "Yengil tabassum bilan «Eeeee» deb cho'zib ayting.",
    audioTeacher: '/audio/item_e.mp3',
    audioSound: '/audio/sound_e.mp3',
  },
  {
    id: 'oi',
    stage: 1,
    kind: 'syllable',
    text: 'OI',
    parts: ['O', 'I'],
    accept: ['oi', 'oy', 'o i'],
    coachTipUz: 'O va I tovushlarini bir nafasda ulang: O-I!',
    audioTeacher: '/audio/item_oi.mp3',
    audioSound: '/audio/sound_oi.mp3',
  },
  {
    id: 'au',
    stage: 1,
    kind: 'syllable',
    text: 'AU',
    parts: ['A', 'U'],
    accept: ['au', 'av', 'a u', 'a'],
    coachTipUz: 'A tovushidan U tovushiga silliq o‘ting: A-U!',
    audioTeacher: '/audio/item_au.mp3',
    audioSound: '/audio/sound_au.mp3',
  },

  // Stage 2: 10 lessons (N, NA, NO, NI, M, MA, MO, L, LO, LA)
  {
    id: 'n',
    stage: 2,
    kind: 'letter',
    text: 'N',
    parts: ['N'],
    accept: ['n', 'en', 'na', 'nn', 'e', 'in', 'un'],
    coachTipUz: "«Nnnnn» deb cho'zib ayting.",
    audioTeacher: '/audio/item_n.mp3',
    audioSound: '/audio/sound_n.mp3',
  },
  {
    id: 'na',
    stage: 2,
    kind: 'syllable',
    text: 'NA',
    parts: ['N', 'A'],
    accept: ['na'],
    coachTipUz: '«Nnnn» tovushini «aaaa» ga ulang: NA.',
    audioTeacher: '/audio/item_na.mp3',
    audioSound: '/audio/sound_na.mp3',
  },
  {
    id: 'no',
    stage: 2,
    kind: 'syllable',
    text: 'NO',
    parts: ['N', 'O'],
    accept: ['no'],
    coachTipUz: '«Nnnn» va «oooo» tovushlarini ulang: NO.',
    audioTeacher: '/audio/item_no.mp3',
    audioSound: '/audio/sound_no.mp3',
  },
  {
    id: 'ni',
    stage: 2,
    kind: 'syllable',
    text: 'NI',
    parts: ['N', 'I'],
    accept: ['ni', 'n', 'ne', 'nu'],
    coachTipUz: '«Nnnn» va «iiii» tovushlarini birlashtiring: NI.',
    audioTeacher: '/audio/item_ni.mp3',
    audioSound: '/audio/sound_ni.mp3',
  },
  {
    id: 'm',
    stage: 2,
    kind: 'letter',
    text: 'M',
    parts: ['M'],
    accept: ['m', 'em', 'ma', 'mm', 'mu', 'mhm'],
    coachTipUz: "Lablarni yumib, «Mmmmm» deb ayting.",
    audioTeacher: '/audio/item_m.mp3',
    audioSound: '/audio/sound_m.mp3',
  },
  {
    id: 'ma',
    stage: 2,
    kind: 'syllable',
    text: 'MA',
    parts: ['M', 'A'],
    accept: ['ma'],
    coachTipUz: '«Mmmm» va «aaaa» tovushlarini ulang: MA.',
    audioTeacher: '/audio/item_ma.mp3',
    audioSound: '/audio/sound_ma.mp3',
  },
  {
    id: 'mo',
    stage: 2,
    kind: 'syllable',
    text: 'MO',
    parts: ['M', 'O'],
    accept: ['mo'],
    coachTipUz: '«Mmmm» va «oooo» tovushlarini birga ayting: MO.',
    audioTeacher: '/audio/item_mo.mp3',
    audioSound: '/audio/sound_mo.mp3',
  },
  {
    id: 'l',
    stage: 2,
    kind: 'letter',
    text: 'L',
    parts: ['L'],
    accept: ['l', 'el', 'la', 'll', 'el tovushi', 'l tovushi'],
    coachTipUz: "Tilni yuqoriga ko'tarib «Lllll» deng.",
    audioTeacher: '/audio/item_l.mp3',
    audioSound: '/audio/sound_l.mp3',
  },
  {
    id: 'lo',
    stage: 2,
    kind: 'syllable',
    text: 'LO',
    parts: ['L', 'O'],
    accept: ['lo'],
    coachTipUz: '«Llll» va «oooo» tovushlarini ulang: LO.',
    audioTeacher: '/audio/item_lo.mp3',
    audioSound: '/audio/sound_lo.mp3',
  },
  {
    id: 'la',
    stage: 2,
    kind: 'syllable',
    text: 'LA',
    parts: ['L', 'A'],
    accept: ['la', 'l', 'lab', 'lablab'],
    coachTipUz: '«Llll» va «aaaa» tovushlarini ulang: LA.',
    audioTeacher: '/audio/item_la.mp3',
    audioSound: '/audio/sound_la.mp3',
  },

  // Stage 3: 8 lessons (ONA, ANA, NON, NIMA, LOLA, OLMA, OILA, LIMON)
  {
    id: 'ona',
    stage: 3,
    kind: 'word',
    text: 'ONA',
    parts: ['O', 'NA'],
    accept: ['ona'],
    coachTipUz: 'Ikki bo‘lakni qo‘shing: O + NA = ONA.',
    audioTeacher: '/audio/item_ona.mp3',
    audioSound: '/audio/sound_ona.mp3',
  },
  {
    id: 'ana',
    stage: 3,
    kind: 'word',
    text: 'ANA',
    parts: ['A', 'NA'],
    accept: ['ana'],
    coachTipUz: 'A va NA bo‘laklarini ulang: ANA.',
    audioTeacher: '/audio/item_ana.mp3',
    audioSound: '/audio/sound_ana.mp3',
  },
  {
    id: 'non',
    stage: 3,
    kind: 'word',
    text: 'NON',
    parts: ['NO', 'N'],
    accept: ['non'],
    coachTipUz: 'NO va N bo‘laklarini qo‘shing: NON.',
    audioTeacher: '/audio/item_non.mp3',
    audioSound: '/audio/sound_non.mp3',
  },
  {
    id: 'nima',
    stage: 3,
    kind: 'word',
    text: 'NIMA',
    parts: ['NI', 'MA'],
    accept: ['nima'],
    coachTipUz: 'NI va MA bo‘g‘inlarini birlashtiring: NIMA.',
    audioTeacher: '/audio/item_nima.mp3',
    audioSound: '/audio/sound_nima.mp3',
  },
  {
    id: 'lola',
    stage: 3,
    kind: 'word',
    text: 'LOLA',
    parts: ['LO', 'LA'],
    accept: ['lola'],
    coachTipUz: 'LO va LA bo‘g‘inlarini birlashtiring: LOLA.',
    audioTeacher: '/audio/item_lola.mp3',
    audioSound: '/audio/sound_lola.mp3',
  },
  {
    id: 'olma',
    stage: 3,
    kind: 'word',
    text: 'OLMA',
    parts: ['OL', 'MA'],
    accept: ['olma'],
    coachTipUz: 'OL va MA bo‘g‘inlarini qo‘shib o‘qing: OLMA.',
    audioTeacher: '/audio/item_olma.mp3',
    audioSound: '/audio/sound_olma.mp3',
  },
  {
    id: 'oila',
    stage: 3,
    kind: 'word',
    text: 'OILA',
    parts: ['OI', 'LA'],
    accept: ['oila', 'oyla', 'oilalar'],
    coachTipUz: 'OI va LA bo‘laklarini birga o‘qing: OILA.',
    audioTeacher: '/audio/item_oila.mp3',
    audioSound: '/audio/sound_oila.mp3',
  },
  {
    id: 'limon',
    stage: 3,
    kind: 'word',
    text: 'LIMON',
    parts: ['LI', 'MON'],
    accept: ['limon'],
    coachTipUz: 'LI va MON bo‘g‘inlarini ulang: LIMON.',
    audioTeacher: '/audio/item_limon.mp3',
    audioSound: '/audio/sound_limon.mp3',
  },

  // Stage 4: 10 lessons (S, SA, SI, R, RO, RA, ARRA, ASAL, V, SUV)
  {
    id: 's',
    stage: 4,
    kind: 'letter',
    text: 'S',
    parts: ['S'],
    accept: ['s', 'es', 'sa', 'ss'],
    coachTipUz: '«Sssss» deb cho‘zib ayting.',
    audioTeacher: '/audio/item_s.mp3',
    audioSound: '/audio/sound_s.mp3',
  },
  {
    id: 'sa',
    stage: 4,
    kind: 'syllable',
    text: 'SA',
    parts: ['S', 'A'],
    accept: ['sa'],
    coachTipUz: '«Ssss» va «aaaa» tovushlarini ulang: SA.',
    audioTeacher: '/audio/item_sa.mp3',
    audioSound: '/audio/sound_sa.mp3',
  },
  {
    id: 'si',
    stage: 4,
    kind: 'syllable',
    text: 'SI',
    parts: ['S', 'I'],
    accept: ['si', 's', 'se'],
    coachTipUz: '«Ssss» va «iiii» tovushlarini birlashtiring: SI.',
    audioTeacher: '/audio/item_si.mp3',
    audioSound: '/audio/sound_si.mp3',
  },
  {
    id: 'r',
    stage: 4,
    kind: 'letter',
    text: 'R',
    parts: ['R'],
    accept: ['r', 'er', 'ra', 'rr', 'ar', 'roq', 'pulroq', 'azizroq'],
    coachTipUz: '«Rrrrr» deb cho‘zib ayting.',
    audioTeacher: '/audio/item_r.mp3',
    audioSound: '/audio/sound_r.mp3',
  },
  {
    id: 'ro',
    stage: 4,
    kind: 'syllable',
    text: 'RO',
    parts: ['R', 'O'],
    accept: ['ro', 'iro'],
    coachTipUz: '«Rrrr» va «oooo» tovushlarini ulang: RO.',
    audioTeacher: '/audio/item_ro.mp3',
    audioSound: '/audio/sound_ro.mp3',
  },
  {
    id: 'ra',
    stage: 4,
    kind: 'syllable',
    text: 'RA',
    parts: ['R', 'A'],
    accept: ['ra'],
    coachTipUz: '«Rrrr» va «aaaa» tovushlarini qo‘shing: RA.',
    audioTeacher: '/audio/item_ra.mp3',
    audioSound: '/audio/sound_ra.mp3',
  },
  {
    id: 'arra',
    stage: 4,
    kind: 'word',
    text: 'ARRA',
    parts: ['AR', 'RA'],
    accept: ['arra', 'ara'],
    coachTipUz: 'AR va RA bo‘g‘inlarini birga o‘qing: ARRA.',
    audioTeacher: '/audio/item_arra.mp3',
    audioSound: '/audio/sound_arra.mp3',
  },
  {
    id: 'asal',
    stage: 4,
    kind: 'word',
    text: 'ASAL',
    parts: ['A', 'SAL'],
    accept: ['asal'],
    coachTipUz: 'A va SAL bo‘laklarini qo‘shing: ASAL.',
    audioTeacher: '/audio/item_asal.mp3',
    audioSound: '/audio/sound_asal.mp3',
  },
  {
    id: 'v',
    stage: 4,
    kind: 'letter',
    text: 'V',
    parts: ['V'],
    accept: ['v', 've', 'va', 'vv', 'vi', 'viv'],
    coachTipUz: 'Yuqori tishlarni pastki labga tekkizib «Vvvvv» deng.',
    audioTeacher: '/audio/item_v.mp3',
    audioSound: '/audio/sound_v.mp3',
  },
  {
    id: 'suv',
    stage: 4,
    kind: 'word',
    text: 'SUV',
    parts: ['SU', 'V'],
    accept: ['suv', 'suf'],
    coachTipUz: 'SU bo‘g‘inini V bilan tugating: SUV.',
    audioTeacher: '/audio/item_suv.mp3',
    audioSound: '/audio/sound_suv.mp3',
  },

  // Stage 5: 13 lessons (B, BA, BO, BOLA, BOBO, T, TA, OTA, D, DA, DADA, K, KITOB)
  {
    id: 'b',
    stage: 5,
    kind: 'letter',
    text: 'B',
    parts: ['B'],
    accept: ['b', 'be', 'bi', "ba'", 'ba'],
    coachTipUz: 'Qisqa «B» tovushini ayting.',
    audioTeacher: '/audio/item_b.mp3',
    audioSound: '/audio/sound_b.mp3',
  },
  {
    id: 'ba',
    stage: 5,
    kind: 'syllable',
    text: 'BA',
    parts: ['B', 'A'],
    accept: ['ba', 'va'],
    coachTipUz: 'B va A ni birga ayting: BA.',
    audioTeacher: '/audio/item_ba.mp3',
    audioSound: '/audio/sound_ba.mp3',
  },
  {
    id: 'bo',
    stage: 5,
    kind: 'syllable',
    text: 'BO',
    parts: ['B', 'O'],
    accept: ['bo', 'ba', 'va', 'b'],
    coachTipUz: 'B va O ni birga qo‘shing: BO.',
    audioTeacher: '/audio/item_bo.mp3',
    audioSound: '/audio/sound_bo.mp3',
  },
  {
    id: 'bola',
    stage: 5,
    kind: 'word',
    text: 'BOLA',
    parts: ['BO', 'LA'],
    accept: ['bola'],
    coachTipUz: 'BO va LA bo‘g‘inlarini qo‘shing: BOLA.',
    audioTeacher: '/audio/item_bola.mp3',
    audioSound: '/audio/sound_bola.mp3',
  },
  {
    id: 'bobo',
    stage: 5,
    kind: 'word',
    text: 'BOBO',
    parts: ['BO', 'BO'],
    accept: ['bobo'],
    coachTipUz: 'Ikkita BO bo‘g‘inini qo‘shing: BOBO.',
    audioTeacher: '/audio/item_bobo.mp3',
    audioSound: '/audio/sound_bobo.mp3',
  },
  {
    id: 't',
    stage: 5,
    kind: 'letter',
    text: 'T',
    parts: ['T'],
    accept: ['t', 'te', 'ta', 'bit', 'bitta'],
    coachTipUz: 'Qisqa «T» tovushini ayting.',
    audioTeacher: '/audio/item_t.mp3',
    audioSound: '/audio/sound_t.mp3',
  },
  {
    id: 'ta',
    stage: 5,
    kind: 'syllable',
    text: 'TA',
    parts: ['T', 'A'],
    accept: ['ta', "ta'", 'tal', 'da'],
    coachTipUz: 'T va A ni birga o‘qing: TA.',
    audioTeacher: '/audio/item_ta.mp3',
    audioSound: '/audio/sound_ta.mp3',
  },
  {
    id: 'ota',
    stage: 5,
    kind: 'word',
    text: 'OTA',
    parts: ['O', 'TA'],
    accept: ['ota'],
    coachTipUz: 'O va TA bo‘g‘inlarini ulang: OTA.',
    audioTeacher: '/audio/item_ota.mp3',
    audioSound: '/audio/sound_ota.mp3',
  },
  {
    id: 'd',
    stage: 5,
    kind: 'letter',
    text: 'D',
    parts: ['D'],
    accept: ['d', 'de', 'da'],
    coachTipUz: 'Qisqa «D» tovushini ayting.',
    audioTeacher: '/audio/item_d.mp3',
    audioSound: '/audio/sound_d.mp3',
  },
  {
    id: 'da',
    stage: 5,
    kind: 'syllable',
    text: 'DA',
    parts: ['D', 'A'],
    accept: ['da'],
    coachTipUz: 'D va A ni qo‘shib ayting: DA.',
    audioTeacher: '/audio/item_da.mp3',
    audioSound: '/audio/sound_da.mp3',
  },
  {
    id: 'dada',
    stage: 5,
    kind: 'word',
    text: 'DADA',
    parts: ['DA', 'DA'],
    accept: ['dada', 'dadan', 'dadant', 'dadam'],
    coachTipUz: 'DA va DA bo‘g‘inlarini qo‘shing: DADA.',
    audioTeacher: '/audio/item_dada.mp3',
    audioSound: '/audio/sound_dada.mp3',
  },
  {
    id: 'k',
    stage: 5,
    kind: 'letter',
    text: 'K',
    parts: ['K'],
    accept: ['k', 'ka', 'ke', 'ik', 'ak', 'ikki', 'likka'],
    coachTipUz: 'Qisqa «K» tovushini ayting.',
    audioTeacher: '/audio/item_k.mp3',
    audioSound: '/audio/sound_k.mp3',
  },
  {
    id: 'kitob',
    stage: 5,
    kind: 'word',
    text: 'KITOB',
    parts: ['KI', 'TOB'],
    accept: ['kitob', 'kitop'],
    coachTipUz: 'KI va TOB bo‘g‘inlarini birga o‘qing: KITOB.',
    audioTeacher: '/audio/item_kitob.mp3',
    audioSound: '/audio/sound_kitob.mp3',
  },
];

// ============================================================================
// Alifbo 2.0 — 1-sinf "Alifbe" ketma-ketligi, 5 ta Olam va 125+ so'z/gap banki
// ============================================================================

export interface AlifbeLetterInfo {
  letter: string;
  display: string;
  category: 'vowel' | 'consonant' | 'digraph' | 'mark';
  soundTextUz: string;
  exampleWord: string;
  exampleEmoji: string;
  audioSound: string;
  audioRecall: string;
  phoneticTtsPrompt: string;
}

export const ALIFBE_LETTERS_29: AlifbeLetterInfo[] = [
  { letter: 'O', display: 'O o', category: 'vowel', soundTextUz: 'o', exampleWord: 'OLMA', exampleEmoji: '🍎', audioSound: '/audio/sound_o.mp3', audioRecall: '/audio/letter_o.mp3', phoneticTtsPrompt: 'O. Olma.' },
  { letter: 'A', display: 'A a', category: 'vowel', soundTextUz: 'a', exampleWord: 'ANOR', exampleEmoji: '🔴', audioSound: '/audio/sound_a.mp3', audioRecall: '/audio/letter_a.mp3', phoneticTtsPrompt: 'A. Anor.' },
  { letter: 'N', display: 'N n', category: 'consonant', soundTextUz: 'n', exampleWord: 'NON', exampleEmoji: '🥖', audioSound: '/audio/sound_n.mp3', audioRecall: '/audio/letter_n.mp3', phoneticTtsPrompt: 'N. Non.' },
  { letter: 'I', display: 'I i', category: 'vowel', soundTextUz: 'i', exampleWord: 'ILON', exampleEmoji: '🐍', audioSound: '/audio/sound_i.mp3', audioRecall: '/audio/letter_i.mp3', phoneticTtsPrompt: 'I. Ilon.' },
  { letter: 'M', display: 'M m', category: 'consonant', soundTextUz: 'm', exampleWord: 'MUSHUK', exampleEmoji: '🐱', audioSound: '/audio/sound_m.mp3', audioRecall: '/audio/letter_m.mp3', phoneticTtsPrompt: 'M. Mushuk.' },
  { letter: 'T', display: 'T t', category: 'consonant', soundTextUz: 't', exampleWord: 'TOG‘', exampleEmoji: '⛰️', audioSound: '/audio/sound_t.mp3', audioRecall: '/audio/letter_t.mp3', phoneticTtsPrompt: 'T. Tog‘.' },
  { letter: 'L', display: 'L l', category: 'consonant', soundTextUz: 'l', exampleWord: 'LOLA', exampleEmoji: '🌷', audioSound: '/audio/sound_l.mp3', audioRecall: '/audio/letter_l.mp3', phoneticTtsPrompt: 'L. Lola.' },
  { letter: 'B', display: 'B b', category: 'consonant', soundTextUz: 'b', exampleWord: 'BALIQ', exampleEmoji: '🐟', audioSound: '/audio/sound_b.mp3', audioRecall: '/audio/letter_b.mp3', phoneticTtsPrompt: 'B. Baliq.' },
  { letter: 'K', display: 'K k', category: 'consonant', soundTextUz: 'k', exampleWord: 'KITOB', exampleEmoji: '📗', audioSound: '/audio/sound_k.mp3', audioRecall: '/audio/letter_k.mp3', phoneticTtsPrompt: 'K. Kitob.' },
  { letter: 'R', display: 'R r', category: 'consonant', soundTextUz: 'r', exampleWord: 'RO‘MOL', exampleEmoji: '🧣', audioSound: '/audio/sound_r.mp3', audioRecall: '/audio/letter_r.mp3', phoneticTtsPrompt: 'R. Ro‘mol.' },
  { letter: 'U', display: 'U u', category: 'vowel', soundTextUz: 'u', exampleWord: 'UZUM', exampleEmoji: '🍇', audioSound: '/audio/sound_u.mp3', audioRecall: '/audio/letter_u.mp3', phoneticTtsPrompt: 'U. Uzum.' },
  { letter: 'S', display: 'S s', category: 'consonant', soundTextUz: 's', exampleWord: 'SABZI', exampleEmoji: '🥕', audioSound: '/audio/sound_s.mp3', audioRecall: '/audio/letter_s.mp3', phoneticTtsPrompt: 'S. Sabzi.' },
  { letter: 'D', display: 'D d', category: 'consonant', soundTextUz: 'd', exampleWord: 'DARAXT', exampleEmoji: '🌳', audioSound: '/audio/sound_d.mp3', audioRecall: '/audio/letter_d.mp3', phoneticTtsPrompt: 'D. Daraxt.' },
  { letter: 'E', display: 'E e', category: 'vowel', soundTextUz: 'e', exampleWord: 'ESHIK', exampleEmoji: '🚪', audioSound: '/audio/sound_e.mp3', audioRecall: '/audio/letter_e.mp3', phoneticTtsPrompt: 'E. Eshik.' },
  { letter: 'Z', display: 'Z z', category: 'consonant', soundTextUz: 'z', exampleWord: 'ZEBRA', exampleEmoji: '🦓', audioSound: '/audio/sound_z.mp3', audioRecall: '/audio/letter_z.mp3', phoneticTtsPrompt: 'Z harfi. Zebra.' },
  { letter: 'SH', display: 'Sh sh', category: 'digraph', soundTextUz: 'sh', exampleWord: 'SHAR', exampleEmoji: '🎈', audioSound: '/audio/sound_sh.mp3', audioRecall: '/audio/letter_sh.mp3', phoneticTtsPrompt: 'Sh. Shar.' },
  { letter: 'V', display: 'V v', category: 'consonant', soundTextUz: 'v', exampleWord: 'VAGON', exampleEmoji: '🚃', audioSound: '/audio/sound_v.mp3', audioRecall: '/audio/letter_v.mp3', phoneticTtsPrompt: 'V. Vagon.' },
  { letter: 'Y', display: 'Y y', category: 'consonant', soundTextUz: 'y', exampleWord: 'YULDUZ', exampleEmoji: '⭐', audioSound: '/audio/sound_y.mp3', audioRecall: '/audio/letter_y.mp3', phoneticTtsPrompt: 'Y. Yulduz.' },
  { letter: 'G', display: 'G g', category: 'consonant', soundTextUz: 'g', exampleWord: 'GILOS', exampleEmoji: '🍒', audioSound: '/audio/sound_g.mp3', audioRecall: '/audio/letter_g.mp3', phoneticTtsPrompt: 'G. Gilos.' },
  { letter: 'NG', display: 'Ng ng', category: 'digraph', soundTextUz: 'ng', exampleWord: 'TONG', exampleEmoji: '🌅', audioSound: '/audio/sound_ng.mp3', audioRecall: '/audio/letter_ng.mp3', phoneticTtsPrompt: 'Ng tovushi. Tong.' },
  { letter: "O'", display: 'O‘ o‘', category: 'vowel', soundTextUz: 'o‘', exampleWord: 'O‘RDAK', exampleEmoji: '🦆', audioSound: '/audio/sound_o_apostrophe.mp3', audioRecall: '/audio/letter_o_apostrophe.mp3', phoneticTtsPrompt: 'O‘. O‘rdak.' },
  { letter: 'CH', display: 'Ch ch', category: 'digraph', soundTextUz: 'ch', exampleWord: 'CHOYNAK', exampleEmoji: '🫖', audioSound: '/audio/sound_ch.mp3', audioRecall: '/audio/letter_ch.mp3', phoneticTtsPrompt: 'Ch. Choynak.' },
  { letter: 'Q', display: 'Q q', category: 'consonant', soundTextUz: 'q', exampleWord: 'QALAM', exampleEmoji: '✏️', audioSound: '/audio/sound_q.mp3', audioRecall: '/audio/letter_q.mp3', phoneticTtsPrompt: 'Q. Qalam.' },
  { letter: "G'", display: 'G‘ g‘', category: 'consonant', soundTextUz: 'g‘', exampleWord: 'G‘OZ', exampleEmoji: '🦢', audioSound: '/audio/sound_g_apostrophe.mp3', audioRecall: '/audio/letter_g_apostrophe.mp3', phoneticTtsPrompt: 'G‘ harfi. G‘oz.' },
  { letter: 'H', display: 'H h', category: 'consonant', soundTextUz: 'h', exampleWord: 'HAVO', exampleEmoji: '🌤️', audioSound: '/audio/sound_h.mp3', audioRecall: '/audio/letter_h.mp3', phoneticTtsPrompt: 'H. Havo.' },
  { letter: 'J', display: 'J j', category: 'consonant', soundTextUz: 'j', exampleWord: 'JO‘JA', exampleEmoji: '🐣', audioSound: '/audio/sound_j.mp3', audioRecall: '/audio/letter_j.mp3', phoneticTtsPrompt: 'J. Jo‘ja.' },
  { letter: 'X', display: 'X x', category: 'consonant', soundTextUz: 'x', exampleWord: 'XO‘ROZ', exampleEmoji: '🐓', audioSound: '/audio/sound_x.mp3', audioRecall: '/audio/letter_x.mp3', phoneticTtsPrompt: 'X. Xo‘roz.' },
  { letter: 'F', display: 'F f', category: 'consonant', soundTextUz: 'f', exampleWord: 'FIL', exampleEmoji: '🐘', audioSound: '/audio/sound_f.mp3', audioRecall: '/audio/letter_f.mp3', phoneticTtsPrompt: 'Fff. Fil.' },
  { letter: 'P', display: 'P p', category: 'consonant', soundTextUz: 'p', exampleWord: 'POMIDOR', exampleEmoji: '🍅', audioSound: '/audio/sound_p.mp3', audioRecall: '/audio/letter_p.mp3', phoneticTtsPrompt: 'P. Pomidor.' },
  { letter: '’', display: '’ (Tutuq)', category: 'mark', soundTextUz: 'tutuq belgisi', exampleWord: 'A’LO', exampleEmoji: '🏅', audioSound: '/audio/sound_tutuq.mp3', audioRecall: '/audio/letter_tutuq.mp3', phoneticTtsPrompt: 'Tutuq belgisi. A’lo.' },
];

export interface ReadingWorld {
  worldId: 1 | 2 | 3 | 4 | 5;
  icon: string;
  titleUz: string;
  subtitleUz: string;
  descriptionUz: string;
  focusLetters: string[];
  accentColor: string;
  bgTint: string;
}

export const READING_WORLDS: ReadingWorld[] = [
  {
    worldId: 1,
    icon: '🌱',
    titleUz: '1-olam: Ilk bo‘g‘inlar o‘rmoni',
    subtitleUz: 'O, A, N, I, M, T, L, B, K, R — ochiq va sodda so‘zlar',
    descriptionUz: 'Harflarni eslab, birinchi bo‘g‘inlarni tez va oson ulash mashqlari.',
    focusLetters: ['O', 'A', 'N', 'I', 'M', 'T', 'L', 'B', 'K', 'R'],
    accentColor: '#58cc02',
    bgTint: '#f2fde4',
  },
  {
    worldId: 2,
    icon: '🚀',
    titleUz: '2-olam: Chaqqon so‘zlar vodiysi',
    subtitleUz: 'U, S, D, E, Z + yopiq bo‘g‘inlar (KI-TOB, MAK-TAB)',
    descriptionUz: 'Hijjalab o‘qishdan (k-i -> ki, t-o-b -> tob) ravon o‘qishga o‘tish.',
    focusLetters: ['U', 'S', 'D', 'E', 'Z'],
    accentColor: '#1cb0f6',
    bgTint: '#f0f9ff',
  },
  {
    worldId: 3,
    icon: '✨',
    titleUz: '3-olam: Sirli harf birikmalari',
    subtitleUz: 'Sh, Ch, Ng, O‘, G‘, Q, V, Y, G, H, J, X, F, P',
    descriptionUz: 'Qo‘sh harflar va maxsus tovushlar ishtirokidagi qiziqarli so‘zlar.',
    focusLetters: ['SH', 'V', 'Y', 'G', 'NG', "O'", 'CH', 'Q', "G'", 'H', 'J', 'X', 'F', 'P', '’'],
    accentColor: '#ff9600',
    bgTint: '#fff7ed',
  },
  {
    worldId: 4,
    icon: '🏆',
    titleUz: '4-olam: Ravon kitobxon qal’asi',
    subtitleUz: '3 bo‘g‘inli uzun so‘zlar (KA-PA-LAK, QA-LAM-DON)',
    descriptionUz: 'Uzun so‘zlarni qo‘rqmasdan bo‘lib o‘qish va tezlikni oshirish.',
    focusLetters: ['O', 'A', 'K', 'SH', 'CH', "O'", 'Q', 'B'],
    accentColor: '#ce82ff',
    bgTint: '#faf5ff',
  },
  {
    worldId: 5,
    icon: '🌟',
    titleUz: '5-olam: Qisqa gaplar olami',
    subtitleUz: '2–3 so‘zli qiziqarli gaplar va ma’noli o‘qish',
    descriptionUz: 'Yuqori bosqich: gapni o‘qib, ma’nosini tushunish va ovozda aytish.',
    focusLetters: ['O', 'A', 'SH', 'CH', "O'", "G'", 'Q'],
    accentColor: '#ff4b4b',
    bgTint: '#fff5f5',
  },
];

export type WordPoolKind = 'word' | 'sentence';
export type ScriptMode = 'standard_latin' | 'reformed_latin';

export interface WordPoolItem {
  id: string;
  worldId: 1 | 2 | 3 | 4 | 5;
  kind: WordPoolKind;
  text: string;
  /** Interactive game chunks (always >= 2 parts for constructor/bubbles games). */
  parts: string[];
  /** Phonetic syllables for words (each word syllable has 1 vowel); words array for sentences. */
  syllables: string[];
  letters: string[];
  emoji: string;
  /** Optional custom word illustration path (e.g. '/images/words/arra.webp'); falls back to emoji/SVG when absent. */
  image?: string;
  distractorEmojis: [string, string];
  distractorParts: string[];
  accept: string[];
  questionPromptUz: string;
  repeatPromptUz: string;
  motivationPromptUz: string;
  audioSound: string | null;
}

export const UZBEK_VOWELS: ReadonlySet<string> = new Set(['a', 'o', 'i', 'u', 'e', 'oʻ']);
export const MULTI_CHAR_GRAPHEMES = ['sh', 'ch', 'ng', 'oʻ', 'gʻ'] as const;

const MULTI_CHAR_SET: ReadonlySet<string> = new Set(MULTI_CHAR_GRAPHEMES);

const REFORMED_LATIN_CHAR_MAP: Record<string, string> = {
  ö: 'oʻ',
  ğ: 'gʻ',
  ş: 'sh',
  ç: 'ch',
};

const CANONICAL_TO_STANDARD_LATIN: Record<string, string> = {
  'oʻ': 'o‘',
  'gʻ': 'g‘',
};

const CANONICAL_TO_REFORMED_LATIN: Record<string, string> = {
  'oʻ': 'ö',
  'gʻ': 'ğ',
  sh: 'ş',
  ch: 'ç',
};

/**
 * Normalize Uzbek Latin text: lowercase, trim, unify apostrophes to U+02BB ('ʻ'),
 * map reformed Uzbek Latin characters (ö, ğ, ş, ç) to canonical digraphs,
 * and collapse repeated whitespace.
 */
export function normalizeText(str: string): string {
  const lowered = (str || '').toLowerCase().trim().replace(/['’‘`ʼʻ´]/g, 'ʻ');
  let mapped = '';
  for (const ch of lowered) {
    mapped += REFORMED_LATIN_CHAR_MAP[ch] ?? ch;
  }
  return mapped.replace(/\s+/g, ' ').trim();
}

/**
 * Tokenize Uzbek Latin text into canonical graphemes (merging sh, ch, ng, oʻ, gʻ),
 * skipping standalone tutuq marks ('ʻ'), spaces, hyphens, and punctuation.
 */
export function tokenizeGraphemes(word: string): string[] {
  const clean = normalizeText(word);
  const tokens: string[] = [];
  let i = 0;

  while (i < clean.length) {
    const twoChar = clean.slice(i, i + 2);
    if (MULTI_CHAR_SET.has(twoChar)) {
      tokens.push(twoChar);
      i += 2;
    } else if (/[a-z]/.test(clean[i] ?? '')) {
      tokens.push(clean[i]!);
      i += 1;
    } else {
      // Standalone tutuq ('ʻ'), spaces, hyphens, and punctuation are not counted as graphemes
      i += 1;
    }
  }
  return tokens;
}

/** Count phonetic syllables by counting Uzbek vowel graphemes in the text. */
export function countUzbekSyllables(text: string): number {
  const tokens = tokenizeGraphemes(text);
  if (tokens.length === 0) return 0;
  let vowelCount = 0;
  for (const tok of tokens) {
    if (UZBEK_VOWELS.has(tok)) {
      vowelCount++;
    }
  }
  return Math.max(1, vowelCount);
}

/** Format a canonical grapheme token for display under the chosen Uzbek Latin script mode. */
export function formatGraphemeForScript(
  token: string,
  mode: ScriptMode = 'standard_latin',
): string {
  const norm = normalizeText(token);
  if (mode === 'reformed_latin') {
    return CANONICAL_TO_REFORMED_LATIN[norm] ?? norm;
  }
  return CANONICAL_TO_STANDARD_LATIN[norm] ?? norm;
}

const WORLD_1_GRAPHEMES = ['o', 'a', 'n', 'i', 'm', 't', 'l', 'b', 'k', 'r'];
const WORLD_2_GRAPHEMES = [...WORLD_1_GRAPHEMES, 'u', 's', 'd', 'e', 'z'];
const WORLD_3_GRAPHEMES = [
  ...WORLD_2_GRAPHEMES,
  'sh', 'v', 'y', 'g', 'ng', 'oʻ', 'ch', 'q', 'gʻ', 'h', 'j', 'x', 'f', 'p',
];

export const WORLD_ALLOWED_GRAPHEMES: Record<1 | 2 | 3 | 4 | 5, ReadonlySet<string>> = {
  1: new Set(WORLD_1_GRAPHEMES),
  2: new Set(WORLD_2_GRAPHEMES),
  3: new Set(WORLD_3_GRAPHEMES),
  4: new Set(WORLD_3_GRAPHEMES),
  5: new Set(WORLD_3_GRAPHEMES),
};

export interface WordPoolInvariantViolation {
  id: string;
  worldId: number;
  text: string;
  reason: string;
}

/**
 * Validate pedagogical and structural invariants for the dynamic word pool:
 * - Stage Gate: every grapheme in `item.text` is introduced in `1..item.worldId`
 * - Structural game integrity: `parts.length >= 2`, 2 unique distractors not matching `emoji`
 * - Phonetic syllable integrity (Worlds 1-4): `syllables.join('')` matches `text` and each syllable has 1 vowel
 */
export function validateWordPoolInvariants(pool: WordPoolItem[]): {
  valid: boolean;
  violations: WordPoolInvariantViolation[];
} {
  const violations: WordPoolInvariantViolation[] = [];

  for (const item of pool) {
    const allowed = WORLD_ALLOWED_GRAPHEMES[item.worldId];
    const graphemes = tokenizeGraphemes(item.text);
    for (const g of graphemes) {
      if (!allowed.has(g)) {
        violations.push({
          id: item.id,
          worldId: item.worldId,
          text: item.text,
          reason: `Stage Gate violation in World ${item.worldId}: unexpected grapheme "${g}"`,
        });
      }
    }

    if (item.parts.length < 2) {
      violations.push({
        id: item.id,
        worldId: item.worldId,
        text: item.text,
        reason: `Expected at least 2 visual parts, got ${item.parts.length}`,
      });
    }

    if (item.distractorEmojis.length !== 2 || item.distractorEmojis.includes(item.emoji)) {
      violations.push({
        id: item.id,
        worldId: item.worldId,
        text: item.text,
        reason: 'Invalid distractorEmojis (must be 2 and exclude target emoji)',
      });
    }

    if (item.kind === 'word') {
      const joinedNorm = normalizeText(item.syllables.join(''));
      const textNorm = normalizeText(item.text);
      if (joinedNorm !== textNorm) {
        violations.push({
          id: item.id,
          worldId: item.worldId,
          text: item.text,
          reason: `Syllable join mismatch: "${joinedNorm}" !== "${textNorm}"`,
        });
      }

      for (const syl of item.syllables) {
        const sylVowels = tokenizeGraphemes(syl).filter((t) => UZBEK_VOWELS.has(t)).length;
        if (sylVowels !== 1) {
          violations.push({
            id: item.id,
            worldId: item.worldId,
            text: item.text,
            reason: `Syllable "${syl}" has ${sylVowels} vowel(s); expected exactly 1`,
          });
        }
      }
    } else {
      const joinedSentence = normalizeText(item.syllables.join(' '));
      const textNorm = normalizeText(item.text);
      if (joinedSentence !== textNorm) {
        violations.push({
          id: item.id,
          worldId: item.worldId,
          text: item.text,
          reason: `Sentence parts join mismatch: "${joinedSentence}" !== "${textNorm}"`,
        });
      }
    }
  }

  return { valid: violations.length === 0, violations };
}

const APOSTROPHE_CHARS = new Set(['‘', '’', 'ʻ', 'ʼ', '`', '´', "'"]);

/** Tokenize Uzbek Latin text into individual letters, digraphs (Sh, Ch, Ng, O', G'), and marks. */
export function tokenizeUzbekLetters(text: string): string[] {
  const chars = [...(text || '').toUpperCase()];
  const tokens: string[] = [];
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i] ?? '';
    const next = chars[i + 1] ?? '';
    if (ch === ' ' || ch === '-' || ch === '.' || ch === '!' || ch === '?') {
      i++;
      continue;
    }
    if ((ch === 'O' || ch === 'G') && APOSTROPHE_CHARS.has(next)) {
      tokens.push(`${ch}'`);
      i += 2;
      continue;
    }
    if ((ch === 'S' && next === 'H') || (ch === 'C' && next === 'H') || (ch === 'N' && next === 'G')) {
      tokens.push(`${ch}${next}`);
      i += 2;
      continue;
    }
    if (APOSTROPHE_CHARS.has(ch)) {
      tokens.push('’');
      i++;
      continue;
    }
    if (/[A-Z]/.test(ch)) {
      tokens.push(ch);
    }
    i++;
  }
  return Array.from(new Set(tokens));
}

/** Convert an Uzbek syllable/grapheme chunk into a deterministic ASCII filename slug matching backend/generate_tts.py. */
export function toSyllableSlug(syllable: string): string {
  return (syllable || '')
    .toLowerCase()
    .replace(/o['’‘ʻʼ`´]/g, 'o_ap')
    .replace(/g['’‘ʻʼ`´]/g, 'g_ap')
    .replace(/['’‘ʻʼ`´]/g, '')
    .replace(/[^a-z0-9_]/g, '');
}

const EXISTING_SOUND_IDS = new Set([
  'ona',
  'ana',
  'non',
  'nima',
  'lola',
  'olma',
  'oila',
  'limon',
  'arra',
  'asal',
  'suv',
  'bola',
  'bobo',
  'ota',
  'dada',
  'kitob',
]);

function deriveWordSyllables(
  text: string,
  parts: string[],
  kind: WordPoolKind,
  explicitSyllables?: string[],
): string[] {
  if (explicitSyllables && explicitSyllables.length > 0) {
    return explicitSyllables;
  }
  if (kind === 'sentence') {
    return [...parts];
  }
  const allPartsSingleVowel =
    parts.length > 0 &&
    parts.every((p) => tokenizeGraphemes(p).filter((t) => UZBEK_VOWELS.has(t)).length === 1);
  if (allPartsSingleVowel) {
    return [...parts];
  }
  if (countUzbekSyllables(text) === 1) {
    return [text];
  }
  return [...parts];
}

function makeWordItem(
  id: string,
  worldId: 1 | 2 | 3 | 4 | 5,
  text: string,
  parts: string[],
  emoji: string,
  distractorEmojis: [string, string],
  distractorParts: string[],
  extraAccept: string[] = [],
  kind: WordPoolKind = 'word',
  explicitSyllables?: string[],
  image?: string,
): WordPoolItem {
  const syllables = deriveWordSyllables(text, parts, kind, explicitSyllables);
  const hyphenated = syllables.join('-');
  const cleanWord = text.replace(/[-.!?,]/g, '').toLowerCase();
  const accept = Array.from(new Set([cleanWord, ...extraAccept]));
  return {
    id,
    worldId,
    kind,
    text,
    parts,
    syllables,
    letters: tokenizeUzbekLetters(text),
    emoji,
    ...(image ? { image } : {}),
    distractorEmojis,
    distractorParts,
    accept,
    questionPromptUz:
      kind === 'sentence'
        ? 'Gapni ovoz chiqarib o‘qing va rasmda nima bo‘layotganini ayting!'
        : 'Bu nima? Ovoz chiqarib ayt-chi!',
    repeatPromptUz: `Barakalla! Endi men bilan birga quvnoq qilib qaytar: ${hyphenated}!`,
    motivationPromptUz: `Hechqisi yo‘q! Keling, birga bo‘g‘inlab aytamiz: ${parts.join(' - ')}! Sen uddalaysan!`,
    audioSound: EXISTING_SOUND_IDS.has(id) ? `/audio/sound_${id}.mp3` : `/audio/word_${id}.mp3`,
  };
}

export const DYNAMIC_WORD_POOL: WordPoolItem[] = [
  // World 1: Ilk bo'g'inlar va tanish harflar (O, A, N, I, M, T, L, B, K, R) — 26 items
  makeWordItem('ona', 1, 'ONA', ['O', 'NA'], '👩', ['🚗', '🍎'], ['MA', 'LO']),
  makeWordItem('non', 1, 'NON', ['NO', 'N'], '🥖', ['🍌', '🐶'], ['LA', 'TO'], [], 'word', ['NON']),
  makeWordItem('lola', 1, 'LOLA', ['LO', 'LA'], '🌷', ['🌳', '📚'], ['MA', 'NO']),
  makeWordItem('olma', 1, 'OLMA', ['OL', 'MA'], '🍎', ['🥖', '🦁'], ['NA', 'BO']),
  makeWordItem('bola', 1, 'BOLA', ['BO', 'LA'], '🧒', ['🌷', '🍎'], ['MA', 'TA']),
  makeWordItem('bobo', 1, 'BOBO', ['BO', 'BO'], '👴', ['🚗', '🍉'], ['LA', 'NO']),
  makeWordItem('ota', 1, 'OTA', ['O', 'TA'], '👨', ['🐱', '🍇'], ['NA', 'LO']),
  makeWordItem('anor', 1, 'ANOR', ['A', 'NOR'], '🔴', ['🥖', '🚲'], ['MOL', 'TAR']),
  makeWordItem('ilon', 1, 'ILON', ['I', 'LON'], '🐍', ['🍎', '✈️'], ['MAN', 'BOR']),
  makeWordItem('arra', 1, 'ARRA', ['AR', 'RA'], '🪚', ['🌷', '🐝'], ['LA', 'MO'], ['ara']),
  makeWordItem('limon', 1, 'LIMON', ['LI', 'MON'], '🍋', ['🥖', '🐻'], ['NAR', 'BOL']),
  makeWordItem('oltin', 1, 'OLTIN', ['OL', 'TIN'], '🪙', ['🍎', '🐢'], ['MAN', 'LOR']),
  makeWordItem('tola', 1, 'TOLA', ['TO', 'LA'], '🧵', ['🚗', '🍌'], ['MA', 'BO']),
  makeWordItem('nina', 1, 'NINA', ['NI', 'NA'], '🪡', ['🌷', '🍇'], ['LO', 'MA']),
  makeWordItem('bino', 1, 'BINO', ['BI', 'NO'], '🏢', ['🐶', '🍋'], ['LA', 'TA']),
  makeWordItem('kran', 1, 'KRAN', ['K', 'RAN'], '🏗️', ['🍎', '🦋'], ['MON', 'TAR'], [], 'word', ['KRAN']),
  makeWordItem('olam', 1, 'OLAM', ['O', 'LAM'], '🌍', ['🥖', '🐈'], ['NOR', 'TAN']),
  makeWordItem('kalit', 1, 'KALIT', ['KA', 'LIT'], '🔑', ['🍌', '🚌'], ['MON', 'BOR']),
  makeWordItem('maral', 1, 'MARAL', ['MA', 'RAL'], '🦌', ['🌷', '🥖'], ['LON', 'TAN']),
  makeWordItem('motor', 1, 'MOTOR', ['MO', 'TOR'], '⚙️', ['🍎', '🐸'], ['LAN', 'BOR']),
  makeWordItem('banan', 1, 'BANAN', ['BA', 'NAN'], '🍌', ['🚲', '🍋'], ['MAN', 'LOR']),
  makeWordItem('kabob', 1, 'KABOB', ['KA', 'BOB'], '🍢', ['🐶', '🔑'], ['LAR', 'MON'], ['kabop']),
  makeWordItem('kamon', 1, 'KAMON', ['KA', 'MON'], '🏹', ['🌷', '🥖'], ['TOR', 'BOL']),
  makeWordItem('bolta', 1, 'BOLTA', ['BOL', 'TA'], '🪓', ['🍎', '🐱'], ['MA', 'NO']),
  makeWordItem('robot', 1, 'ROBOT', ['RO', 'BOT'], '🤖', ['🍌', '🌳'], ['LAN', 'TOR']),
  makeWordItem('karam', 1, 'KARAM', ['KA', 'RAM'], '🥬', ['🚗', '🎈'], ['LON', 'MOT']),

  // World 2: Yopiq bo'g'inlar va chaqqon so'zlar (U, S, D, E, Z + avvalgi) — 26 items
  makeWordItem('kitob', 2, 'KITOB', ['KI', 'TOB'], '📗', ['🍎', '⚽'], ['MOL', 'NAR'], ['kitop']),
  makeWordItem('dada', 2, 'DADA', ['DA', 'DA'], '👨‍👦', ['🌳', '🚌'], ['BO', 'LA']),
  makeWordItem('asal', 2, 'ASAL', ['A', 'SAL'], '🍯', ['🥖', '🐸'], ['MON', 'LOR']),
  makeWordItem('uzuk', 2, 'UZUK', ['U', 'ZUK'], '💍', ['🔥', '🍎'], ['ZUM', 'TAR']),
  makeWordItem('uzum', 2, 'UZUM', ['U', 'ZUM'], '🍇', ['🥕', '🚌'], ['MON', 'TAR']),
  makeWordItem('sabzi', 2, 'SABZI', ['SAB', 'ZI'], '🥕', ['🍋', '🐶'], ['MA', 'TO']),
  makeWordItem('zebra', 2, 'ZEBRA', ['ZEB', 'RA'], '🦓', ['🍎', '🚲'], ['LA', 'MO']),
  makeWordItem('kosa', 2, 'KOSA', ['KO', 'SA'], '🥣', ['🌷', '🥖'], ['MA', 'ZA']),
  makeWordItem('etik', 2, 'ETIK', ['E', 'TIK'], '🥾', ['🍇', '🦋'], ['MOL', 'ZAR']),
  makeWordItem('tulki', 2, 'TULKI', ['TUL', 'KI'], '🦊', ['🐻', '🍋'], ['MA', 'ZO']),
  makeWordItem('bilet', 2, 'BILET', ['BI', 'LET'], '🎫', ['🥕', '🐢'], ['MON', 'ZUL']),
  makeWordItem('maktab', 2, 'MAKTAB', ['MAK', 'TAB'], '🏫', ['🌳', '🍎'], ['LAR', 'ZON'], ['maktap']),
  makeWordItem('burun', 2, 'BURUN', ['BU', 'RUN'], '👃', ['🥖', '🐟'], ['MON', 'ZUL']),
  makeWordItem('sut', 2, 'SUT', ['SU', 'T'], '🥛', ['🍎', '🚗'], ['Z', 'M'], [], 'word', ['SUT']),
  makeWordItem('tuz', 2, 'TUZ', ['TU', 'Z'], '🧂', ['🌷', '🐶'], ['M', 'L'], [], 'word', ['TUZ']),
  makeWordItem('kema', 2, 'KEMA', ['KE', 'MA'], '🚢', ['🚲', '🍇'], ['ZO', 'TU']),
  makeWordItem('salat', 2, 'SALAT', ['SA', 'LAT'], '🥗', ['🔑', '🤖'], ['MON', 'ZUR']),
  makeWordItem('soat', 2, 'SOAT', ['SO', 'AT'], '⏰', ['🥕', '🐦'], ['MA', 'ZI']),
  makeWordItem('bulut', 2, 'BULUT', ['BU', 'LUT'], '☁️', ['🍎', '⚽'], ['ZAR', 'MON']),
  makeWordItem('stul', 2, 'STUL', ['S', 'TUL'], '🪑', ['🌷', '🍌'], ['MON', 'ZAT'], [], 'word', ['STUL']),
  makeWordItem('doska', 2, 'DOSKA', ['DOS', 'KA'], '🟩', ['🍇', '🐶'], ['MA', 'ZO']),
  makeWordItem('surat', 2, 'SURAT', ['SU', 'RAT'], '🖼️', ['🍎', '🎈'], ['MON', 'ZAT']),
  makeWordItem('kaktus', 2, 'KAKTUS', ['KAK', 'TUS'], '🌵', ['🚗', '🍋'], ['MON', 'ZAR']),
  makeWordItem('terak', 2, 'TERAK', ['TE', 'RAK'], '🌲', ['🥖', '🐟'], ['ZOM', 'LUR']),
  makeWordItem('sandal', 2, 'SANDAL', ['SAN', 'DAL'], '👡', ['🍎', '✏️'], ['MON', 'TAR']),
  makeWordItem('sumka', 2, 'SUMKA', ['SUM', 'KA'], '🎒', ['🥕', '🐢'], ['LO', 'ZA']),

  // World 3: Qo'sh harflar va maxsus tovushlar (Sh, V, Y, G, Ng, O', Ch, Q, G', H, J, X, F, P, ’) — 35 items
  makeWordItem('shar', 3, 'SHAR', ['SHA', 'R'], '🎈', ['🍎', '🚗'], ['M', 'Z'], [], 'word', ['SHAR']),
  makeWordItem('choynak', 3, 'CHOYNAK', ['CHOY', 'NAK'], '🫖', ['📗', '🐶'], ['LAR', 'MON']),
  makeWordItem('ordak', 3, 'O‘RDAK', ['O‘R', 'DAK'], '🦆', ['🐓', '🍏'], ['MON', 'G‘OZ'], ["o'rdak"]),
  makeWordItem('goz', 3, 'G‘OZ', ['G‘O', 'Z'], '🦢', ['🐟', '🍌'], ['R', 'M'], ["g'oz"], 'word', ['G‘OZ']),
  makeWordItem('qalam', 3, 'QALAM', ['QA', 'LAM'], '✏️', ['🔑', '🌳'], ['G‘OZ', 'CHOY']),
  makeWordItem('gilos', 3, 'GILOS', ['GI', 'LOS'], '🍒', ['🍇', '🥕'], ['MON', 'ZAR']),
  makeWordItem('yulduz', 3, 'YULDUZ', ['YUL', 'DUZ'], '⭐', ['☁️', '🐢'], ['QOR', 'CHOY']),
  makeWordItem('vagon', 3, 'VAGON', ['VA', 'GON'], '🚃', ['🚢', '🍎'], ['MON', 'CHIR']),
  makeWordItem('tong', 3, 'TONG', ['TO', 'NG'], '🌅', ['🌙', '🥖'], ['CH', 'Q'], [], 'word', ['TONG']),
  makeWordItem('joja', 3, 'JO‘JA', ['JO‘', 'JA'], '🐣', ['🐱', '🚗'], ['G‘O', 'CHI'], ["jo'ja"]),
  makeWordItem('xoroz', 3, 'XO‘ROZ', ['XO‘', 'ROZ'], '🐓', ['🦆', '🍌'], ['MON', 'QOR'], ["xo'roz"]),
  makeWordItem('fil', 3, 'FIL', ['FI', 'L'], '🐘', ['🦁', '🍎'], ['CH', 'G‘'], [], 'word', ['FIL']),
  makeWordItem('paxta', 3, 'PAXTA', ['PAX', 'TA'], '🤍', ['🌳', '🥕'], ['CHO', 'G‘I']),
  makeWordItem('havo', 3, 'HAVO', ['HA', 'VO'], '🌤️', ['🪨', '🔑'], ['CHO', 'QOR']),
  makeWordItem('qovun', 3, 'QOVUN', ['QO', 'VUN'], '🍈', ['🍎', '🥖'], ['G‘OZ', 'CHIR']),
  makeWordItem('orik', 3, 'O‘RIK', ['O‘', 'RIK'], '🟠', ['🍋', '🐶'], ['G‘OZ', 'CHOY'], ["o'rik"]),
  makeWordItem('shirmon', 3, 'SHIRMON', ['SHIR', 'MON'], '🫓', ['🍏', '🚲'], ['QAL', 'CHOY']),
  makeWordItem('chumoli', 3, 'CHUMOLI', ['CHU', 'MO', 'LI'], '🐜', ['🦋', '🍎'], ['G‘OZ', 'QOR']),
  makeWordItem('gildirak', 3, 'G‘ILDIRAK', ['G‘IL', 'DI', 'RAK'], '🛞', ['⛵', '🥕'], ['MON', 'CHOY'], ["g'ildirak"]),
  makeWordItem('quyon', 3, 'QUYON', ['QU', 'YON'], '🐰', ['🦊', '🍋'], ['G‘O', 'CHI']),
  makeWordItem('baliq', 3, 'BALIQ', ['BA', 'LIQ'], '🐟', ['🐸', '🌳'], ['CHOY', 'G‘OZ']),
  makeWordItem('mushuk', 3, 'MUSHUK', ['MU', 'SHUK'], '🐱', ['🐶', '🍎'], ['QOR', 'CHIR']),
  makeWordItem('kuchuk', 3, 'KUCHUK', ['KU', 'CHUK'], '🐶', ['🐱', '🚗'], ['MON', 'G‘OZ']),
  makeWordItem('xat', 3, 'XAT', ['XA', 'T'], '✉️', ['🔑', '🍌'], ['CH', 'G‘'], [], 'word', ['XAT']),
  makeWordItem('qor', 3, 'QOR', ['QO', 'R'], '❄️', ['☀️', '🍎'], ['G‘', 'CH'], [], 'word', ['QOR']),
  makeWordItem('alo', 3, 'A’LO', ['A’', 'LO'], '🏅', ['🪨', '🚲'], ['CHOY', 'G‘OZ'], ["a'lo", 'alo']),
  // Moved from Worlds 1 & 2 into World 3 so all V, Q, P, Sh, F, X letters are strictly Stage-Gate valid:
  makeWordItem('tovoq', 3, 'TOVOQ', ['TO', 'VOQ'], '🍲', ['🚲', '🍋'], ['MAN', 'LOR']),
  makeWordItem('kompot', 3, 'KOMPOT', ['KOM', 'POT'], '🧃', ['🐶', '🔑'], ['LAR', 'MON']),
  makeWordItem('suv', 3, 'SUV', ['SU', 'V'], '💧', ['🔥', '🍎'], ['R', 'T'], ['suf'], 'word', ['SUV']),
  makeWordItem('eshik', 3, 'ESHIK', ['E', 'SHIK'], '🚪', ['🌷', '🥖'], ['MON', 'TAR']),
  makeWordItem('daftar', 3, 'DAFTAR', ['DAF', 'TAR'], '📓', ['🥕', '🐢'], ['MON', 'ZUL']),
  makeWordItem('daraxt', 3, 'DARAXT', ['DA', 'RAXT'], '🌳', ['🥖', '🐟'], ['MON', 'ZUL']),
  makeWordItem('savat', 3, 'SAVAT', ['SA', 'VAT'], '🧺', ['🔑', '🤖'], ['MON', 'ZUR']),
  makeWordItem('tosh', 3, 'TOSH', ['TO', 'SH'], '🪨', ['🍎', '🎈'], ['M', 'Z'], [], 'word', ['TOSH']),
  makeWordItem('buzoq', 3, 'BUZOQ', ['BU', 'ZOQ'], '🐄', ['🍎', '✏️'], ['MON', 'TAR']),

  // World 4: Ravon kitobxon (3+ bo'g'inli uzun so'zlar) — 26 items
  makeWordItem('kapalak', 4, 'KAPALAK', ['KA', 'PA', 'LAK'], '🦋', ['🐜', '🍎'], ['MON', 'CHIR']),
  makeWordItem('qalamdon', 4, 'QALAMDON', ['QA', 'LAM', 'DON'], '🖍️', ['📓', '🚗'], ['CHOY', 'G‘OZ']),
  makeWordItem('samolyot', 4, 'SAMOLYOT', ['SA', 'MOL', 'YOT'], '✈️', ['🚢', '🚲'], ['QOR', 'TUR']),
  makeWordItem('telefon', 4, 'TELEFON', ['TE', 'LE', 'FON'], '📱', ['⏰', '🔑'], ['MON', 'CHOY']),
  makeWordItem('muzqaymoq', 4, 'MUZQAYMOQ', ['MUZ', 'QAY', 'MOQ'], '🍦', ['🍎', '🥖'], ['LOR', 'CHIR']),
  makeWordItem('qulupnay', 4, 'QULUPNAY', ['QU', 'LUP', 'NAY'], '🍓', ['🍌', '🥕'], ['MON', 'G‘OZ']),
  makeWordItem('bodring', 4, 'BODRING', ['BOD', 'RING'], '🥒', ['🍎', '🍋'], ['CHOY', 'QOR']),
  makeWordItem('tarvuz', 4, 'TARVUZ', ['TAR', 'VUZ'], '🍉', ['🍈', '🍎'], ['MON', 'CHIR']),
  makeWordItem('kabutar', 4, 'KABUTAR', ['KA', 'BU', 'TAR'], '🕊️', ['🐓', '🐱'], ['QOR', 'ZUR']),
  makeWordItem('ayiqcha', 4, 'AYIQCHA', ['A', 'YIQ', 'CHA'], '🧸', ['🦊', '🍎'], ['MON', 'G‘OZ']),
  makeWordItem('shaftoli', 4, 'SHAFTOLI', ['SHAF', 'TO', 'LI'], '🍑', ['🍇', '🥕'], ['QOR', 'CHIR']),
  makeWordItem('velosiped', 4, 'VELOSIPED', ['VE', 'LO', 'SI', 'PED'], '🚲', ['✈️', '🚢'], ['MON', 'QAL']),
  makeWordItem('qoziqorin', 4, 'QO‘ZIQORIN', ['QO‘', 'ZI', 'QO', 'RIN'], '🍄', ['🌳', '🍎'], ['CHOY', 'G‘OZ'], ["qo'ziqorin"]),
  makeWordItem('ninachi', 4, 'NINACHI', ['NI', 'NA', 'CHI'], '🪰', ['🐢', '🍋'], ['QOR', 'MON']),
  makeWordItem('toshbaqa', 4, 'TOSHBAQA', ['TOSH', 'BA', 'QA'], '🐢', ['🐰', '🍎'], ['CHOY', 'G‘OZ']),
  makeWordItem('olmaxon', 4, 'OLMAXON', ['OL', 'MA', 'XON'], '🐿️', ['🦊', '🥖'], ['QOR', 'CHIR']),
  makeWordItem('pomidor', 4, 'POMIDOR', ['PO', 'MI', 'DOR'], '🍅', ['🥒', '🍌'], ['MON', 'G‘OZ']),
  makeWordItem('baqlajon', 4, 'BAQLAJON', ['BAQ', 'LA', 'JON'], '🍆', ['🥕', '🍎'], ['CHOY', 'QOR']),
  makeWordItem('malina', 4, 'MALINA', ['MA', 'LI', 'NA'], '🩷', ['🍋', '🚗'], ['QOR', 'CHIR']),
  makeWordItem('kamalak', 4, 'KAMALAK', ['KA', 'MA', 'LAK'], '🌈', ['☁️', '🍎'], ['MON', 'G‘OZ']),
  makeWordItem('chigirtka', 4, 'CHIGIRTKA', ['CHI', 'GIRT', 'KA'], '🦗', ['🐝', '🐶'], ['QOR', 'MON']),
  makeWordItem('asalari', 4, 'ASALARI', ['A', 'SA', 'LA', 'RI'], '🐝', ['🐜', '🍎'], ['CHOY', 'G‘OZ']),
  makeWordItem('qaldirgoch', 4, 'QALDIRG‘OCH', ['QAL', 'DIR', 'G‘OCH'], '🐦', ['🦆', '🐱'], ['MON', 'CHIR'], ["qaldirg'och"]),
  makeWordItem('dasturxon', 4, 'DASTURXON', ['DAS', 'TUR', 'XON'], '🍽️', ['🪑', '🍎'], ['QOR', 'G‘OZ']),
  makeWordItem('kitobxon', 4, 'KITOBXON', ['KI', 'TOB', 'XON'], '🤓', ['😴', '🚗'], ['MON', 'CHIR']),
  makeWordItem('gulzor', 4, 'GULZOR', ['GUL', 'ZOR'], '🌺', ['🪨', '🥖'], ['CHOY', 'QOR']),

  // World 5: Qisqa gaplar olami (2-3 so'zli gaplar) — 26 items
  makeWordItem('gap_olma_shirin', 5, 'OLMA SHIRIN', ['OLMA', 'SHIRIN'], '🍎', ['🍋', '🪨'], ['ACHCHIQ', 'SOVUQ'], ['olma shirin'], 'sentence'),
  makeWordItem('gap_bola_kitob', 5, 'BOLA KITOB O‘QIDI', ['BOLA', 'KITOB', 'O‘QIDI'], '📖', ['⚽', '😴'], ['UXLADI', 'YUGURDI'], ["bola kitob o'qidi", 'bola kitob oqidi'], 'sentence'),
  makeWordItem('gap_ona_non', 5, 'ONA NON YOPDI', ['ONA', 'NON', 'YOPDI'], '🥖', ['🌧️', '🚲'], ['UCHDI', 'SUZDI'], ['ona non yopdi'], 'sentence'),
  makeWordItem('gap_mushuk_sut', 5, 'MUSHUK SUT ICHDI', ['MUSHUK', 'SUT', 'ICHDI'], '🐱', ['🐘', '✈️'], ['MINDI', 'YOPDI'], ['mushuk sut ichdi'], 'sentence'),
  makeWordItem('gap_baliq_suv', 5, 'BALIQ SUVDA SUZDI', ['BALIQ', 'SUVDA', 'SUZDI'], '🐟', ['🦅', '🌳'], ['UCHDI', 'UXLADI'], ['baliq suvda suzdi'], 'sentence'),
  makeWordItem('gap_quyosh_chiqdi', 5, 'QUYOSH CHIQDI', ['QUYOSH', 'CHIQDI'], '☀️', ['🌧️', '❄️'], ['YOG‘DI', 'KETDI'], ['quyosh chiqdi'], 'sentence'),
  makeWordItem('gap_qor_yogdi', 5, 'OPPOQ QOR YOG‘DI', ['OPPOQ', 'QOR', 'YOG‘DI'], '❄️', ['☀️', '🔥'], ['ISIDI', 'QURIDI'], ["oppoq qor yog'di", 'oppoq qor yogdi'], 'sentence'),
  makeWordItem('gap_lola_gul', 5, 'QIZIL LOLA OCHILDI', ['QIZIL', 'LOLA', 'OCHILDI'], '🌷', ['🌵', '🪨'], ['YOPILDI', 'UCHDI'], ['qizil lola ochildi'], 'sentence'),
  makeWordItem('gap_kuchuk_yugurdi', 5, 'KUCHUK TEZ YUGURDI', ['KUCHUK', 'TEZ', 'YUGURDI'], '🐶', ['🐢', '🪑'], ['UXLADI', 'OTIRDI'], ['kuchuk tez yugurdi'], 'sentence'),
  makeWordItem('gap_quyon_sabzi', 5, 'QUYON SABZI YEDI', ['QUYON', 'SABZI', 'YEDI'], '🐰', ['🦁', '🚗'], ['MINDI', 'YOPDI'], ['quyon sabzi yedi'], 'sentence'),
  makeWordItem('gap_kapalak_uchdi', 5, 'KAPALAK BALAND UCHDI', ['KAPALAK', 'BALAND', 'UCHDI'], '🦋', ['🐢', '🐟'], ['SUZDI', 'UXLADI'], ['kapalak baland uchdi'], 'sentence'),
  makeWordItem('gap_ayiq_asal', 5, 'AYIQ ASAL YEDI', ['AYIQ', 'ASAL', 'YEDI'], '🐻', ['🐍', '🍋'], ['SUZDI', 'UCHDI'], ['ayiq asal yedi'], 'sentence'),
  makeWordItem('gap_tulki_zukko', 5, 'ZUKKO TULKI KULDI', ['ZUKKO', 'TULKI', 'KULDI'], '🦊', ['🐊', '🪨'], ['YIG‘LADI', 'UXLADI'], ['zukko tulki kuldi'], 'sentence'),
  makeWordItem('gap_ordak_suv', 5, 'O‘RDAK SUVDA SUZDI', ['O‘RDAK', 'SUVDA', 'SUZDI'], '🦆', ['🐓', '🚲'], ['UCHDI', 'MINDI'], ["o'rdak suvda suzdi", 'ordak suvda suzdi'], 'sentence'),
  makeWordItem('gap_dada_daraxt', 5, 'DADA DARAXT EKDI', ['DADA', 'DARAXT', 'EKDI'], '🌳', ['🚗', '📱'], ['OCHDI', 'ICHDI'], ['dada daraxt ekdi'], 'sentence'),
  makeWordItem('gap_bobo_choy', 5, 'BOBO ISSIQ CHOY ICHDI', ['BOBO', 'ISSIQ', 'CHOY', 'ICHDI'], '🫖', ['🍦', '❄️'], ['YEDI', 'OCHDI'], ['bobo issiq choy ichdi'], 'sentence'),
  makeWordItem('gap_asalari_gul', 5, 'ASALARI GULGA QO‘NDI', ['ASALARI', 'GULGA', 'QO‘NDI'], '🐝', ['🐟', '🪨'], ['SUZDI', 'BOTDI'], ["asalari gulga qo'ndi", 'asalari gulga qondi'], 'sentence'),
  makeWordItem('gap_uzum_shirin', 5, 'QORA UZUM SHIRIN', ['QORA', 'UZUM', 'SHIRIN'], '🍇', ['🧅', '🧂'], ['ACHCHIQ', 'SHO‘R'], ['qora uzum shirin'], 'sentence'),
  makeWordItem('gap_samolyot_uchdi', 5, 'SAMOLYOT OSMONDA UCHDI', ['SAMOLYOT', 'OSMONDA', 'UCHDI'], '✈️', ['🚢', '🚗'], ['SUZDI', 'YURDI'], ['samolyot osmonda uchdi'], 'sentence'),
  makeWordItem('gap_kema_daryo', 5, 'KATTA KEMA SUZDI', ['KATTA', 'KEMA', 'SUZDI'], '🚢', ['🚲', '✈️'], ['UCHDI', 'SAKRADI'], ['katta kema suzdi'], 'sentence'),
  makeWordItem('gap_joja_don', 5, 'SARIQ JO‘JA DON YEDI', ['SARIQ', 'JO‘JA', 'DON', 'YEDI'], '🐣', ['🐘', '🚗'], ['ICHDI', 'MINDI'], ["sariq jo'ja don yedi", 'sariq joja don yedi'], 'sentence'),
  makeWordItem('gap_qalam_rasm', 5, 'QALAM BILAN RASM CHIZDI', ['QALAM', 'BILAN', 'RASM', 'CHIZDI'], '✏️', ['🥄', '🥾'], ['YEDI', 'KIYDI'], ['qalam bilan rasm chizdi'], 'sentence'),
  makeWordItem('gap_yomgir_yogdi', 5, 'YOMG‘IR YOG‘DI', ['YOMG‘IR', 'YOG‘DI'], '🌧️', ['☀️', '🔥'], ['QURIDI', 'CHIQDI'], ["yomg'ir yog'di", 'yomgir yogdi'], 'sentence'),
  makeWordItem('gap_yulduz_porladi', 5, 'YULDUZLAR PORLADI', ['YULDUZLAR', 'PORLADI'], '⭐', ['🪨', '🌧️'], ['UXLADI', 'KETDI'], ['yulduzlar porladi'], 'sentence'),
  makeWordItem('gap_maktab_bordi', 5, 'BOLA MAKTABGA BORDI', ['BOLA', 'MAKTABGA', 'BORDI'], '🏫', ['🛏️', '😴'], ['UXLADI', 'QOLDI'], ['bola maktabga bordi'], 'sentence'),
  makeWordItem('gap_tarvuz_katta', 5, 'KATTA TARVUZ PISHDI', ['KATTA', 'TARVUZ', 'PISHDI'], '🍉', ['❄️', '🪨'], ['MUZLADI', 'SO‘NDI'], ['katta tarvuz pishdi'], 'sentence'),
];

