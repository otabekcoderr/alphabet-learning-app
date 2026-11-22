import { describe, expect, it } from 'vitest';
import { CURRICULUM_ITEMS, CURRICULUM_STAGES } from '../../data/curriculum';
import { encodeWav16k, verifyAudioWithStt } from '../../utils/audioRecorder';
import {
  evaluateSpeechResult,
  PARENT_OFFLINE_BANNER_TITLE,
  resolveVoiceStepUiState,
  validateCurriculumDecodability,
} from '../pedagogy';

interface NodeFsSubset {
  existsSync(path: URL): boolean;
  statSync(path: URL): { size: number };
  readFileSync(path: URL): Uint8Array;
  readFileSync(path: URL, encoding: 'utf8'): string;
}

interface NodeHttpRequest {
  url?: string;
  on(event: 'data', cb: (chunk: Uint8Array) => void): void;
  on(event: 'end', cb: () => void): void;
}

interface NodeHttpResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body: string): void;
}

interface NodeHttpServer {
  listen(port: number, host: string, cb: () => void): void;
  address(): { port: number } | string | null;
  close(cb: () => void): void;
}

interface NodeHttpSubset {
  createServer(handler: (req: NodeHttpRequest, res: NodeHttpResponse) => void): NodeHttpServer;
}

async function getNodeFs(): Promise<NodeFsSubset> {
  const modId = 'node:fs';
  return (await import(/* @vite-ignore */ modId)) as NodeFsSubset;
}

async function getNodeHttp(): Promise<NodeHttpSubset> {
  const modId = 'node:http';
  return (await import(/* @vite-ignore */ modId)) as NodeHttpSubset;
}

const PROJECT_ROOT_URL = new URL('../../../', import.meta.url);
const AUDIO_DIR_URL = new URL('public/audio/', PROJECT_ROOT_URL);
const REVIEW_CSV_URL = new URL('audio_review.csv', PROJECT_ROOT_URL);
const STT_BASE_URL = 'http://127.0.0.1:8765';

const UI_PHRASE_FILES = [
  'barakalla.mp3',
  'qayta_urinib_koring.mp3',
  'qaysi_biri.mp3',
  'ulab_oqiymiz.mp3',
  'mikrofonga_ayting.mp3',
  'jimlik_sezildi.mp3',
];

interface SttTestResponse {
  ok: boolean;
  transcript: string;
  normalized: string;
  accepted: boolean;
  is_silence: boolean;
  confidence: number;
  latency_ms: number;
}

async function callStt(
  audioBytes: Uint8Array,
  contentType: string,
  expected: string,
  acceptAliases: string[],
): Promise<SttTestResponse> {
  const params = new URLSearchParams({
    expected,
    accept: acceptAliases.join('|'),
  });
  const res = await fetch(`${STT_BASE_URL}/api/stt?${params.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: Uint8Array.from(audioBytes),
  });
  expect(res.ok).toBe(true);
  const json = (await res.json()) as SttTestResponse;
  expect(json.ok).toBe(true);
  return json;
}

describe('48-lesson curriculum, stage counts, and 102 static audio files', () => {
  it('contains 48 strictly decodable lessons distributed across 5 islands (7 + 10 + 8 + 10 + 13)', () => {
    expect(CURRICULUM_STAGES).toHaveLength(5);
    expect(CURRICULUM_ITEMS).toHaveLength(48);

    const stageCounts = CURRICULUM_STAGES.map(
      (s) => CURRICULUM_ITEMS.filter((item) => item.stage === s.stage).length,
    );
    expect(stageCounts).toEqual([7, 10, 8, 10, 13]);

    const ids = CURRICULUM_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(48);

    for (const item of CURRICULUM_ITEMS) {
      expect(item.parts.length).toBeGreaterThan(0);
      expect(item.accept.length).toBeGreaterThan(0);
      expect(item.coachTipUz.trim().length).toBeGreaterThan(0);
      expect(item.audioTeacher).toBe(`/audio/item_${item.id}.mp3`);
      expect(item.audioSound).toBe(`/audio/sound_${item.id}.mp3`);
    }

    const report = validateCurriculumDecodability(CURRICULUM_ITEMS);
    expect(report.valid).toBe(true);
    expect(report.violations).toEqual([]);
  });

  it('has all 102 non-trivial static MP3 files on disk and listed in audio_review.csv without temporary status', async () => {
    const fs = await getNodeFs();
    const expectedFiles: string[] = [];
    for (const item of CURRICULUM_ITEMS) {
      expectedFiles.push(`item_${item.id}.mp3`, `sound_${item.id}.mp3`);
    }
    expectedFiles.push(...UI_PHRASE_FILES);
    expect(expectedFiles).toHaveLength(102);

    for (const name of expectedFiles) {
      const fileUrl = new URL(name, AUDIO_DIR_URL);
      expect(fs.existsSync(fileUrl), `Missing audio file: ${name}`).toBe(true);
      const stat = fs.statSync(fileUrl);
      expect(stat.size, `Audio file too small: ${name}`).toBeGreaterThan(1000);
    }

    expect(fs.existsSync(REVIEW_CSV_URL)).toBe(true);
    const csvLines = fs
      .readFileSync(REVIEW_CSV_URL, 'utf8')
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .filter((l: string) => l.trim().length > 0);

    // Header + 102 audio entries
    expect(csvLines.length).toBeGreaterThanOrEqual(103);
    const csvBody = csvLines.slice(1).join('\n');
    for (const name of expectedFiles) {
      expect(csvBody, `Missing from audio_review.csv: ${name}`).toContain(`public/audio/${name}`);
    }
    expect(csvBody.toLowerCase()).not.toContain('temporary');
  });
});

async function isLiveVoiceServerOnline(): Promise<boolean> {
  try {
    const res = await fetch(`${STT_BASE_URL}/api/health`);
    if (!res.ok) return false;
    const json = (await res.json()) as { ok?: boolean };
    return Boolean(json.ok);
  } catch {
    return false;
  }
}

describe('Phase A3: client STT integration against fake server & voice UI state rules', () => {
  it('verifies accepted speech, silence, mismatch, and server errors via verifyAudioWithStt against a fake HTTP STT server', async () => {
    const http = await getNodeHttp();
    const server = http.createServer((req, res) => {
      const chunks: Uint8Array[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const parsedUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
        const expected = parsedUrl.searchParams.get('expected') ?? '';

        if (expected === 'ERROR') {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: 'Simulated STT error' }));
          return;
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        if (expected === 'SILENCE') {
          res.end(
            JSON.stringify({
              ok: true,
              transcript: '',
              normalized: '',
              accepted: false,
              is_silence: true,
              confidence: 0,
              latency_ms: 12,
              orig_ms: 1000,
              trimmed_ms: 0,
            }),
          );
          return;
        }

        if (expected === 'KITOB') {
          res.end(
            JSON.stringify({
              ok: true,
              transcript: 'ona',
              normalized: 'ona',
              accepted: false,
              is_silence: false,
              confidence: 0.85,
              latency_ms: 30,
              orig_ms: 900,
              trimmed_ms: 600,
            }),
          );
          return;
        }

        res.end(
          JSON.stringify({
            ok: true,
            transcript: 'ona',
            normalized: 'ona',
            accepted: true,
            is_silence: false,
            confidence: 0.96,
            latency_ms: 35,
            orig_ms: 900,
            trimmed_ms: 600,
          }),
        );
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      throw new Error('Fake server failed to bind ephemeral port');
    }
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      const sampleBlob = encodeWav16k(new Float32Array(1600));

      const acceptedResp = await verifyAudioWithStt(sampleBlob, 'ONA', ['ona'], baseUrl);
      expect(acceptedResp.accepted).toBe(true);
      expect(
        evaluateSpeechResult('ONA', ['ona'], acceptedResp.transcript, acceptedResp.is_silence, 1).outcome,
      ).toBe('accepted');

      const silenceResp = await verifyAudioWithStt(sampleBlob, 'SILENCE', ['silence'], baseUrl);
      expect(silenceResp.is_silence).toBe(true);
      expect(
        evaluateSpeechResult('SILENCE', ['silence'], silenceResp.transcript, silenceResp.is_silence, 1)
          .outcome,
      ).toBe('silence');

      const mismatchResp = await verifyAudioWithStt(sampleBlob, 'KITOB', ['kitob', 'kitop'], baseUrl);
      expect(mismatchResp.accepted).toBe(false);
      expect(
        evaluateSpeechResult(
          'KITOB',
          ['kitob', 'kitop'],
          mismatchResp.transcript,
          mismatchResp.is_silence,
          1,
        ).outcome,
      ).toBe('try_again');

      await expect(verifyAudioWithStt(sampleBlob, 'ERROR', ['error'], baseUrl)).rejects.toThrow(
        'Simulated STT error',
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('never allows self-confirm when voice server is online (even with mic permission blocked) and exposes parent offline banner text', () => {
    expect(PARENT_OFFLINE_BANNER_TITLE).toBe(
      "Ovoz tekshiruvi hozir o'chiq: server ishga tushirilmagan",
    );

    const onlineReady = resolveVoiceStepUiState({
      aiOnline: true,
      parentSessionActive: false,
      micPermissionBlocked: false,
    });
    expect(onlineReady.mode).toBe('voice_mic');
    expect(onlineReady.showMicButton).toBe(true);
    expect(onlineReady.showSelfConfirmButton).toBe(false);
    expect(onlineReady.showMicBlockedBanner).toBe(false);
    expect(onlineReady.showParentOfflineBanner).toBe(false);

    const onlineMicBlocked = resolveVoiceStepUiState({
      aiOnline: true,
      parentSessionActive: false,
      micPermissionBlocked: true,
    });
    expect(onlineMicBlocked.mode).toBe('voice_mic');
    expect(onlineMicBlocked.showMicButton).toBe(true);
    expect(onlineMicBlocked.showSelfConfirmButton).toBe(false);
    expect(onlineMicBlocked.showMicBlockedBanner).toBe(true);

    const offlineChild = resolveVoiceStepUiState({
      aiOnline: false,
      parentSessionActive: false,
      micPermissionBlocked: false,
    });
    expect(offlineChild.mode).toBe('offline_effort');
    expect(offlineChild.showMicButton).toBe(false);
    expect(offlineChild.showSelfConfirmButton).toBe(true);
    expect(offlineChild.showParentOfflineBanner).toBe(true);

    const offlineParentSession = resolveVoiceStepUiState({
      aiOnline: false,
      parentSessionActive: true,
      micPermissionBlocked: false,
    });
    expect(offlineParentSession.mode).toBe('parent_confirm');
    expect(offlineParentSession.showSelfConfirmButton).toBe(false);
    expect(offlineParentSession.showParentOfflineBanner).toBe(true);
  });
});

describe('live FastConformer RNNT speech recognition (/api/stt) & pedagogy integration', () => {
  it('recognizes and accepts all 48 lesson sound clips without false silence', async (ctx) => {
    if (!(await isLiveVoiceServerOnline())) {
      console.warn('SKIPPED: voice server offline');
      ctx.skip();
    }
    const fs = await getNodeFs();
    const healthRes = await fetch(`${STT_BASE_URL}/api/health`);
    expect(healthRes.ok).toBe(true);
    const healthJson = (await healthRes.json()) as { ok: boolean; status: string };
    expect(healthJson.ok).toBe(true);

    const failures: Array<{ id: string; text: string; resp: SttTestResponse }> = [];
    for (const item of CURRICULUM_ITEMS) {
      const fileUrl = new URL(`sound_${item.id}.mp3`, AUDIO_DIR_URL);
      const bytes = fs.readFileSync(fileUrl);
      const sttRes = await callStt(bytes, 'audio/mpeg', item.text, item.accept);
      const evalRes = evaluateSpeechResult(item.text, item.accept, sttRes.transcript, sttRes.is_silence, 1);

      if (sttRes.is_silence || !sttRes.accepted || evalRes.outcome !== 'accepted') {
        failures.push({ id: item.id, text: item.text, resp: sttRes });
      }
    }

    expect(failures).toEqual([]);
  }, 60_000);

  it('detects pure silence WAV as silence and rejects mismatched spoken words', async (ctx) => {
    if (!(await isLiveVoiceServerOnline())) {
      console.warn('SKIPPED: voice server offline');
      ctx.skip();
    }
    const fs = await getNodeFs();
    const silentBlob = encodeWav16k(new Float32Array(16_000));
    const silentBytes = new Uint8Array(await silentBlob.arrayBuffer());
    const silenceRes = await callStt(silentBytes, 'audio/wav', 'ONA', ['ona']);
    expect(silenceRes.is_silence).toBe(true);
    expect(silenceRes.accepted).toBe(false);
    expect(evaluateSpeechResult('ONA', ['ona'], silenceRes.transcript, silenceRes.is_silence, 1).outcome).toBe(
      'silence',
    );

    const mismatchCases = [
      { audioFile: 'sound_kitob.mp3', expected: 'ONA', accept: ['ona'] },
      { audioFile: 'sound_bola.mp3', expected: 'OLMA', accept: ['olma'] },
      { audioFile: 'sound_ona.mp3', expected: 'KITOB', accept: ['kitob', 'kitop'] },
    ];

    for (const mc of mismatchCases) {
      const bytes = fs.readFileSync(new URL(mc.audioFile, AUDIO_DIR_URL));
      const res = await callStt(bytes, 'audio/mpeg', mc.expected, mc.accept);
      expect(res.is_silence).toBe(false);
      expect(res.accepted).toBe(false);
      expect(evaluateSpeechResult(mc.expected, mc.accept, res.transcript, res.is_silence, 1).outcome).toBe(
        'try_again',
      );
    }
  }, 20_000);
});
