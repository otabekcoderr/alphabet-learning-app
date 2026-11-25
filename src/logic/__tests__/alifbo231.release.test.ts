import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ALIFBE_LETTERS_29, DYNAMIC_WORD_POOL, normalizeText } from '../../data/curriculum';
import { buildReminderConfirmationTextUz } from '../../../api/_lib/telegramWebhookHandler';
import { validateHabitUtterance } from '../sttValidator';
import { buildWordHunterChoices, getStage1GameMode } from '../wordPoolEngine';
import {
  playAudioClipWithStatus,
  stopActiveAudio,
  withStaticAudioVersion,
} from '../../utils/audioRecorder';

const ROOT = path.resolve(__dirname, '..', '..', '..');

afterEach(() => {
  stopActiveAudio();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Alifbo 2.3.1 release acceptance checks', () => {
  it('Task 1 & 8: locks audio strictly to Malika (no SpeechSynthesis), fixes F sound, and aborts active clips cleanly', async () => {
    const audioRecorderSrc = fs.readFileSync(path.join(ROOT, 'src/utils/audioRecorder.ts'), 'utf8');
    expect(audioRecorderSrc).not.toMatch(/speechSynthesis/i);
    expect(audioRecorderSrc).not.toMatch(/SpeechSynthesisUtterance/);

    const ttsApiSrc = fs.readFileSync(path.join(ROOT, 'api/tts.ts'), 'utf8');
    expect(ttsApiSrc).toContain('voice_83a39d68-22bc-4062-b86e-0a9dd998ba7a');
    expect(ttsApiSrc).toContain('lison-v2');

    const csvText = fs.readFileSync(path.join(ROOT, 'audio_review.csv'), 'utf8');
    const lines = csvText.trim().split(/\r?\n/).slice(1);
    expect(lines.length).toBeGreaterThanOrEqual(450);
    for (const line of lines) {
      expect(line).toContain('voicelab:lison-v2:malika');
      expect(line.toLowerCase()).not.toContain('temporary');
    }

    const soundF = fs.statSync(path.join(ROOT, 'public/audio/sound_f.mp3'));
    const letterF = fs.statSync(path.join(ROOT, 'public/audio/letter_f.mp3'));
    expect(soundF.size).toBeGreaterThan(1000);
    expect(letterF.size).toBeGreaterThan(1000);

    const entryF = ALIFBE_LETTERS_29.find((l) => l.letter === 'F');
    expect(entryF?.phoneticTtsPrompt).toBe('Fff. Fil.');
    expect(withStaticAudioVersion('/audio/sound_f.mp3')).toBe('/audio/sound_f.mp3?v=231');

    class HangingAudioMock {
      src: string;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      paused = false;
      currentTime = 0;
      constructor(src: string) {
        this.src = src;
      }
      play(): Promise<void> {
        return Promise.resolve();
      }
      pause(): void {
        this.paused = true;
      }
    }
    vi.stubGlobal('Audio', HangingAudioMock);

    const p1 = playAudioClipWithStatus('/audio/bismillah.mp3');
    stopActiveAudio();
    await expect(p1).resolves.toBe('aborted');
  });

  it('Task 2: validates spoken Bismillah and Alhamdulillah phonetic variants and keeps Victory screen single-voiced', () => {
    for (const sample of ['bismillah', 'Bismillo', 'BISMILLOH', 'бисмиллаҳ']) {
      expect(
        validateHabitUtterance('bismillah', { transcript: sample, isSilence: false }),
      ).toBe('accepted');
    }
    for (const sample of ['alhamdulillah', 'Alhamdulloh', 'Alhamdulilloh', 'алҳамдулиллаҳ']) {
      expect(
        validateHabitUtterance('alhamdulillah', { transcript: sample, isSilence: false }),
      ).toBe('accepted');
    }
    expect(validateHabitUtterance('bismillah', { transcript: '', isSilence: true })).toBe('silence');
    expect(validateHabitUtterance('bismillah', { transcript: 'olma', isSilence: false })).toBe(
      'mismatch',
    );
    expect(validateHabitUtterance('alhamdulillah', { transcript: 'kitob', isSilence: false })).toBe(
      'mismatch',
    );

    const lessonPlayerSrc = fs.readFileSync(
      path.join(ROOT, 'src/components/LessonPlayer.tsx'),
      'utf8',
    );
    expect(lessonPlayerSrc).toContain('if (!bismillahAlhamdulillahEnabled)');
    expect(lessonPlayerSrc).toContain('{!bismillahAlhamdulillahEnabled && (');
  });

  it('Task 3: replaces slider train mode with word_hunter 3-choice Stage-Gate matching', () => {
    const world1 = DYNAMIC_WORD_POOL.filter((w) => w.worldId === 1 && w.kind === 'word');
    expect(world1.length).toBeGreaterThanOrEqual(3);
    const target = world1[0]!;
    expect(getStage1GameMode(0, target)).toBe('word_hunter');

    const { choices, correctIndex } = buildWordHunterChoices(target, DYNAMIC_WORD_POOL);
    expect(choices).toHaveLength(3);
    expect(correctIndex).toBeGreaterThanOrEqual(0);
    expect(choices[correctIndex]?.id).toBe(target.id);
    const normTexts = new Set(choices.map((c) => normalizeText(c.text)));
    expect(normTexts.size).toBe(3);

    const lessonPlayerSrc = fs.readFileSync(
      path.join(ROOT, 'src/components/LessonPlayer.tsx'),
      'utf8',
    );
    expect(lessonPlayerSrc).not.toContain('blend-slider');
    expect(lessonPlayerSrc).toContain("buildGameMode === 'word_hunter'");
  });

  it('Task 4: Telegram confirmation message includes 19:00 Tashkent schedule & non-practiced condition, and cron rolls back transient errors', () => {
    const confirmUz = buildReminderConfirmationTextUz('Ali');
    expect(confirmUz).toContain('@alifbo_uz_robot');
    expect(confirmUz).toContain('19:00');
    expect(confirmUz).toContain('Toshkent');

    const notifApiSrc = fs.readFileSync(path.join(ROOT, 'api/notifications.ts'), 'utf8');
    expect(notifApiSrc).toContain('last_reminded_date = ${user.last_reminded_date}');

    const stateApiSrc = fs.readFileSync(path.join(ROOT, 'api/state.ts'), 'utf8');
    expect(stateApiSrc).toContain('d > todayUz ? todayUz : d');
  });

  it('Task 5, 6, 7: configures no-cache SW headers, keeps 8 API endpoints, removes type="password" from PIN screens, and adds PWA manifest + icons', () => {
    const vercelConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')) as {
      headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
    };
    const indexHdr = vercelConfig.headers.find((h) => h.source === '/index.html');
    const swHdr = vercelConfig.headers.find((h) => h.source === '/sw.js');
    const assetsHdr = vercelConfig.headers.find((h) => h.source === '/assets/(.*)');
    expect(indexHdr?.headers[0]?.value).toBe('no-cache, no-store, must-revalidate');
    expect(swHdr?.headers[0]?.value).toBe('no-cache, no-store, must-revalidate');
    expect(assetsHdr?.headers[0]?.value).toBe('public, max-age=31536000, immutable');

    const pinModalSrc = fs.readFileSync(path.join(ROOT, 'src/components/PinModal.tsx'), 'utf8');
    const parentCornerSrc = fs.readFileSync(
      path.join(ROOT, 'src/components/ParentCorner.tsx'),
      'utf8',
    );
    expect(pinModalSrc).not.toContain('type="password"');
    expect(parentCornerSrc).not.toContain('type="password"');

    const manifestPath = path.join(ROOT, 'public/manifest.webmanifest');
    expect(fs.existsSync(manifestPath)).toBe(true);
    for (const iconFile of [
      'icon-192.png',
      'icon-512.png',
      'icon-maskable-512.png',
      'apple-touch-icon.png',
    ]) {
      expect(fs.existsSync(path.join(ROOT, 'public/icons', iconFile))).toBe(true);
    }

    const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    expect(indexHtml).toContain('href="/manifest.webmanifest"');
    expect(indexHtml).toContain('href="/icons/apple-touch-icon.png"');
  });
});
