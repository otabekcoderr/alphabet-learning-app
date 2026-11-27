import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const INDEX_CSS = fs.readFileSync(path.join(ROOT, 'src/index.css'), 'utf8');
const ANIMATED_CHAR = fs.readFileSync(path.join(ROOT, 'src/components/AnimatedCharacter.tsx'), 'utf8');
const GAME_VISUAL = fs.readFileSync(path.join(ROOT, 'src/components/GameVisual.tsx'), 'utf8');

describe('Lesson page responsive layout invariants', () => {
  it('prevents .voice-mic-dock from using negative margin or sticky positioning that overlaps feedback banners', () => {
    const dockBlocks = [...INDEX_CSS.matchAll(/\.voice-mic-dock\s*\{([^}]*)\}/g)].map((m) => m[1] ?? '');
    expect(dockBlocks.length).toBeGreaterThan(0);

    for (const block of dockBlocks) {
      expect(block).not.toMatch(/margin-top:\s*-/);
      expect(block).not.toMatch(/position:\s*sticky/);
    }
  });

  it('keeps Word Hunter responsive media queries after the base card/chip rules so they are not overridden', () => {
    const baseCardIdx = INDEX_CSS.indexOf('.word-hunter-choice-card {');
    const baseChipIdx = INDEX_CSS.indexOf('.word-hunter-syl-chip {');
    const twoColMqIdx = INDEX_CSS.indexOf('@media (max-width: 680px)');
    const oneColMqIdx = INDEX_CSS.indexOf('@media (max-width: 360px)');

    expect(baseCardIdx).toBeGreaterThan(-1);
    expect(baseChipIdx).toBeGreaterThan(-1);
    expect(twoColMqIdx).toBeGreaterThan(baseCardIdx);
    expect(twoColMqIdx).toBeGreaterThan(baseChipIdx);
    expect(oneColMqIdx).toBeGreaterThan(twoColMqIdx);
  });

  it('keeps icons inside feedback banners from shrinking when text wraps', () => {
    expect(INDEX_CSS).toMatch(/\.feedback-banner\s+svg[^{]*\{[^}]*flex-shrink:\s*0/s);
  });

  it('uses fallback custom properties (--char-default-size / --visual-default-size) so CSS fluid clamp overrides work cleanly', () => {
    expect(ANIMATED_CHAR).toContain("'--char-default-size'");
    expect(ANIMATED_CHAR).not.toContain("'--char-size':");
    expect(GAME_VISUAL).toContain("'--visual-default-size'");
    expect(INDEX_CSS).toContain('var(--char-size, var(--char-default-size');
    expect(INDEX_CSS).toContain('var(--visual-size, var(--visual-default-size');
  });

  it('uses fluid CSS Grid tracks and wrapping in constructor choices without fixed pixel overflow', () => {
    const rowBlock = INDEX_CSS.match(/\.constructor-choices-row\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rowBlock).toContain('display: grid');
    expect(rowBlock).toContain('minmax(0, 1fr)');

    const lettersBlock = INDEX_CSS.match(/\.constructor-cube-letters\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(lettersBlock).toContain('flex-wrap: wrap');
  });
});
