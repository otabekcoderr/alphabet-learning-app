import { describe, expect, it } from 'vitest';
import {
  countUzbekSyllables,
  DYNAMIC_WORD_POOL,
  formatGraphemeForScript,
  normalizeText,
  READING_WORLDS,
  tokenizeGraphemes,
  validateWordPoolInvariants,
} from '../../data/curriculum';

describe('Alifbo 2.2 curriculum invariants, Stage Gate fixes, and Uzbek graphemes', () => {
  it('contains 138 unique items across 5 worlds (24, 27, 35, 26, 26) with zero invariant violations', () => {
    expect(READING_WORLDS).toHaveLength(5);
    expect(DYNAMIC_WORD_POOL).toHaveLength(138);

    const uniqueIds = new Set(DYNAMIC_WORD_POOL.map((item) => item.id));
    expect(uniqueIds.size).toBe(138);

    const worldCounts = [1, 2, 3, 4, 5].map(
      (w) => DYNAMIC_WORD_POOL.filter((item) => item.worldId === w).length,
    );
    expect(worldCounts).toEqual([24, 27, 35, 26, 26]);

    const report = validateWordPoolInvariants(DYNAMIC_WORD_POOL);
    expect(report.violations).toEqual([]);
    expect(report.valid).toBe(true);
  });

  it('preserves the 9 moved Stage Gate words inside World 3 with original IDs and audio', () => {
    const movedIds = ['tovoq', 'kompot', 'suv', 'eshik', 'daftar', 'daraxt', 'savat', 'tosh', 'buzoq'];
    for (const id of movedIds) {
      const found = DYNAMIC_WORD_POOL.find((item) => item.id === id);
      expect(found, `Missing moved item: ${id}`).toBeDefined();
      expect(found?.worldId).toBe(3);
    }

    const suv = DYNAMIC_WORD_POOL.find((item) => item.id === 'suv');
    expect(suv?.audioSound).toBe('/audio/sound_suv.mp3');
    expect(suv?.parts).toEqual(['SU', 'V']);
    expect(suv?.syllables).toEqual(['SUV']);
  });

  it('fixes the 6 World 4 syllable splits and keeps parts.length >= 2 on 1-syllable words', () => {
    const expectedSyllables: Record<string, string[]> = {
      bodring: ['BOD', 'RING'],
      tarvuz: ['TAR', 'VUZ'],
      gulzor: ['GUL', 'ZOR'],
      velosiped: ['VE', 'LO', 'SI', 'PED'],
      qoziqorin: ['QO‘', 'ZI', 'QO', 'RIN'],
      asalari: ['A', 'SA', 'LA', 'RI'],
    };

    for (const [id, syl] of Object.entries(expectedSyllables)) {
      const item = DYNAMIC_WORD_POOL.find((entry) => entry.id === id);
      expect(item?.syllables).toEqual(syl);
      expect(item?.parts).toEqual(syl);
    }

    const singleSyllableIds = [
      'non', 'kran', 'sut', 'tuz', 'stul', 'suv', 'tosh',
      'shar', 'goz', 'tong', 'fil', 'xat', 'qor',
    ];
    for (const id of singleSyllableIds) {
      const item = DYNAMIC_WORD_POOL.find((entry) => entry.id === id);
      expect(item?.syllables).toHaveLength(1);
      expect(item?.parts.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('normalizes apostrophe variants, reformed Latin characters, and tokenizes digraphs cleanly', () => {
    expect(normalizeText("O'rdaK")).toBe('oʻrdak');
    expect(normalizeText('O‘g‘il')).toBe('oʻgʻil');
    expect(normalizeText("Sur'at")).toBe('surʻat');
    expect(normalizeText('Ördak ğoz şar çoy')).toBe('oʻrdak gʻoz shar choy');

    expect(tokenizeGraphemes('shahar')).toEqual(['sh', 'a', 'h', 'a', 'r']);
    expect(tokenizeGraphemes('O‘RDAK')).toEqual(['oʻ', 'r', 'd', 'a', 'k']);
    expect(tokenizeGraphemes("G'ILDIRAK")).toEqual(['gʻ', 'i', 'l', 'd', 'i', 'r', 'a', 'k']);
    expect(tokenizeGraphemes('TONG')).toEqual(['t', 'o', 'ng']);
    expect(tokenizeGraphemes('CHOYNAK')).toEqual(['ch', 'o', 'y', 'n', 'a', 'k']);
    // Standalone tutuq ('ʻ'), spaces, hyphens, and punctuation are ignored as graphemes
    expect(tokenizeGraphemes("a'lo")).toEqual(['a', 'l', 'o']);
    expect(tokenizeGraphemes("sur'at")).toEqual(tokenizeGraphemes('surat'));
    expect(tokenizeGraphemes('OLMA SHIRIN!')).toEqual(['o', 'l', 'm', 'a', 'sh', 'i', 'r', 'i', 'n']);
    expect(tokenizeGraphemes('ki-tob')).toEqual(['k', 'i', 't', 'o', 'b']);

    expect(countUzbekSyllables('QALDIRG‘OCH')).toBe(3);
    expect(countUzbekSyllables('QOR')).toBe(1);
    expect(countUzbekSyllables('BOLA KITOB O‘QIDI')).toBe(7);
  });

  it('renders canonical graphemes for both standard_latin and reformed_latin script modes', () => {
    expect(formatGraphemeForScript('oʻ', 'standard_latin')).toBe('o‘');
    expect(formatGraphemeForScript('gʻ', 'standard_latin')).toBe('g‘');
    expect(formatGraphemeForScript('sh', 'standard_latin')).toBe('sh');
    expect(formatGraphemeForScript('oʻ', 'reformed_latin')).toBe('ö');
    expect(formatGraphemeForScript('gʻ', 'reformed_latin')).toBe('ğ');
    expect(formatGraphemeForScript('sh', 'reformed_latin')).toBe('ş');
    expect(formatGraphemeForScript('ch', 'reformed_latin')).toBe('ç');
  });
});
