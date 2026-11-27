import { describe, expect, it } from 'vitest';
import { ALIFBE_LETTERS_29, DYNAMIC_WORD_POOL } from '../../data/curriculum';
import {
  hasExplicitVisualMapping,
  resolveVisualRenderSrc,
  resolveVisualSrc,
} from '../../data/wordVisuals';
import { AVATAR_OPTIONS } from '../gamification';
import { getOfflineFallbackEmojiChoices } from '../wordPoolEngine';

interface NodeFsSubset {
  existsSync(path: URL): boolean;
  statSync(path: URL): { size: number };
  readFileSync(path: URL, encoding: 'utf8'): string;
}

async function getNodeFs(): Promise<NodeFsSubset> {
  const modId = 'node:fs';
  return (await import(/* @vite-ignore */ modId)) as NodeFsSubset;
}

const PUBLIC_DIR_URL = new URL('../../../public/', import.meta.url);

function assertValidSvgAsset(fs: NodeFsSubset, publicPath: string, contextLabel: string): string {
  expect(publicPath.endsWith('.svg'), `${contextLabel}: expected .svg, got ${publicPath}`).toBe(true);
  const rel = publicPath.replace(/^\//, '');
  const fileUrl = new URL(rel, PUBLIC_DIR_URL);
  expect(fs.existsSync(fileUrl), `${contextLabel}: missing SVG file ${rel}`).toBe(true);
  expect(fs.statSync(fileUrl).size, `${contextLabel}: empty SVG file ${rel}`).toBeGreaterThan(100);
  const content = fs.readFileSync(fileUrl, 'utf8');
  expect(content, `${contextLabel}: missing <svg tag in ${rel}`).toContain('<svg');
  expect(content, `${contextLabel}: missing viewBox in ${rel}`).toContain('viewBox');
  expect(content, `${contextLabel}: missing vector shape in ${rel}`).toMatch(/<(path|circle|rect|ellipse|polygon)\b/);
  return content;
}

describe('Complete Visual Asset Coverage (138 words, distractors, 8 avatars, A—ANOR, WebP sprites)', () => {
  it('ensures every one of the 138 words, distractors, and 4 offline exam cards has an explicit, unique, valid SVG file', async () => {
    const fs = await getNodeFs();
    expect(DYNAMIC_WORD_POOL).toHaveLength(138);

    for (const item of DYNAMIC_WORD_POOL) {
      expect(
        hasExplicitVisualMapping({ emoji: item.emoji, wordId: item.id }),
        `Missing explicit visual mapping for word "${item.id}" (${item.emoji})`,
      ).toBe(true);
      const mainSrc = resolveVisualSrc({ emoji: item.emoji, wordId: item.id });
      assertValidSvgAsset(fs, mainSrc, `word:${item.id}`);

      for (const distEmoji of item.distractorEmojis) {
        expect(
          hasExplicitVisualMapping({ emoji: distEmoji }),
          `Missing explicit visual mapping for distractor ${distEmoji} on word "${item.id}"`,
        ).toBe(true);
        const distSrc = resolveVisualSrc({ emoji: distEmoji });
        assertValidSvgAsset(fs, distSrc, `word:${item.id}:dist:${distEmoji}`);
      }

      const offline4 = getOfflineFallbackEmojiChoices(item, DYNAMIC_WORD_POOL);
      expect(offline4).toHaveLength(4);
      const resolvedOfflinePaths = offline4.map((emoji) => {
        const isCorrect = emoji === item.emoji;
        expect(
          hasExplicitVisualMapping({ emoji, wordId: isCorrect ? item.id : undefined }),
          `Offline 4 choice ${emoji} for "${item.id}" lacks explicit mapping`,
        ).toBe(true);
        const src = resolveVisualSrc({ emoji, wordId: isCorrect ? item.id : undefined });
        assertValidSvgAsset(fs, src, `offline4:${item.id}:${emoji}`);
        return src;
      });
      expect(
        new Set(resolvedOfflinePaths).size,
        `Offline 4 cards for "${item.id}" resolved to duplicate visual paths: ${resolvedOfflinePaths.join(', ')}`,
      ).toBe(4);
    }
  });

  it('ensures all 8 avatars (including Sher, Yo‘lbars, Yakkashox, Boyo‘g‘li) and A—ANOR render valid assets', async () => {
    const fs = await getNodeFs();

    const requiredAvatarIds = ['fox', 'lion', 'panda', 'rabbit', 'tiger', 'unicorn', 'astronaut', 'owl'];
    expect(AVATAR_OPTIONS.map((a) => a.id)).toEqual(requiredAvatarIds);

    for (const av of AVATAR_OPTIONS) {
      expect(
        hasExplicitVisualMapping({ emoji: av.emoji }),
        `Missing explicit mapping for avatar ${av.id} (${av.emoji})`,
      ).toBe(true);
      const src = resolveVisualSrc({ emoji: av.emoji });
      assertValidSvgAsset(fs, src, `avatar:${av.id}`);
    }

    const letterA = ALIFBE_LETTERS_29.find((entry) => entry.letter === 'A')!;
    expect(letterA.exampleWord).toBe('ANOR');
    const anorSrc = resolveVisualSrc({ emoji: letterA.exampleEmoji, letter: letterA.letter });
    expect(anorSrc).toBe('/images/words/anor.svg');
    const anorSvg = assertValidSvgAsset(fs, anorSrc, 'alphabet:A:ANOR');
    expect(anorSvg).toContain('#E11D48');
    expect(anorSvg).toContain('width="128"');
    expect(anorSvg).toContain('height="128"');
    expect(
      resolveVisualRenderSrc({ emoji: letterA.exampleEmoji, letter: letterA.letter }),
    ).toBe('/images/words/anor.svg');
    expect(resolveVisualRenderSrc({ emoji: '🥖', wordId: 'non' })).toBe('/images/words/non.svg');

    const nonSvg = assertValidSvgAsset(fs, '/images/words/non.svg', 'word:non');
    expect(nonSvg).toContain('width="128"');
    expect(nonSvg).toContain('height="128"');

    const onaItem = DYNAMIC_WORD_POOL.find((w) => w.id === 'ona')!;
    const ona4 = getOfflineFallbackEmojiChoices(onaItem, DYNAMIC_WORD_POOL);
    expect(ona4).toHaveLength(4);
    expect(ona4).toContain(onaItem.emoji);
    const onaRenderSrcs = ona4.map((emoji) => {
      expect(emoji.trim().length).toBeGreaterThan(0);
      const isCorrect = emoji === onaItem.emoji;
      expect(hasExplicitVisualMapping({ emoji, wordId: isCorrect ? onaItem.id : undefined })).toBe(
        true,
      );
      const renderSrc = resolveVisualRenderSrc({
        emoji,
        wordId: isCorrect ? onaItem.id : undefined,
      });
      expect(renderSrc.length).toBeGreaterThan(10);
      return renderSrc;
    });
    expect(new Set(onaRenderSrcs).size).toBe(4);
  });

  it('ships optimized WebP logo and Zukko mascot under 60 KB without leftover PNGs', async () => {
    const fs = await getNodeFs();
    const maxBytes = 60 * 1024;

    for (const fileName of ['images/logo.webp', 'images/zukko.webp']) {
      const url = new URL(fileName, PUBLIC_DIR_URL);
      expect(fs.existsSync(url), `Missing optimized WebP: ${fileName}`).toBe(true);
      const size = fs.statSync(url).size;
      expect(size, `${fileName} size=${size} exceeds 60 KB`).toBeLessThan(maxBytes);
      expect(size).toBeGreaterThan(1000);
    }

    expect(fs.existsSync(new URL('images/logo.png', PUBLIC_DIR_URL))).toBe(false);
    expect(fs.existsSync(new URL('images/zukko.png', PUBLIC_DIR_URL))).toBe(false);
  });
});
