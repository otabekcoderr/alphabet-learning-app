import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const DEFAULT_VOICELAB_TTS_URL = 'https://api.voicelab.uz/v1/tts';
const DEFAULT_VOICELAB_MODEL_ID = 'lison-v2';
const DEFAULT_VOICELAB_VOICE_ID = 'voice_83a39d68-22bc-4062-b86e-0a9dd998ba7a';
const NEUTRAL_VOICELAB_VOICE_ID = DEFAULT_VOICELAB_VOICE_ID;

class VoiceLabCreditsExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VoiceLabCreditsExhaustedError';
  }
}

function detectAudioMime(buf: Buffer): string {
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WAVE') {
    return 'audio/wav';
  }
  if (buf.length >= 4 && buf.subarray(0, 4).toString('ascii') === 'OggS') {
    return 'audio/ogg';
  }
  return 'audio/mpeg';
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function synthesizeVoiceLabWav(
  env: Record<string, string>,
  text: string,
  voiceStyle: 'friendly' | 'neutral' = 'friendly',
): Promise<Buffer> {
  const apiKey = (env.VOICELAB_API_KEY || '').trim();
  const ttsUrl = (env.VOICELAB_TTS_URL || DEFAULT_VOICELAB_TTS_URL).trim();
  const modelId = (env.VOICELAB_MODEL_ID || DEFAULT_VOICELAB_MODEL_ID).trim();
  const voiceId =
    voiceStyle === 'neutral'
      ? NEUTRAL_VOICELAB_VOICE_ID
      : (env.VOICELAB_VOICE_ID || DEFAULT_VOICELAB_VOICE_ID).trim();
  const speed = voiceStyle === 'neutral' ? 0.95 : 1;

  if (!apiKey) {
    throw new Error('VOICELAB_API_KEY topilmadi (.env faylini tekshiring)');
  }

  const idempotencyKey = crypto.randomUUID();
  const payload = JSON.stringify({
    text,
    language: 'uz',
    voice_id: voiceId,
    model_id: modelId,
    speed,
  });

  for (let attempt = 0; attempt < 4; attempt++) {
    const resp = await fetch(ttsUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'audio/wav',
        'Idempotency-Key': idempotencyKey,
      },
      body: payload,
    });

    if (resp.status === 429 && attempt < 3) {
      const waitHeader = resp.headers.get('retry-after') ?? resp.headers.get('ratelimit-reset');
      const waitMs = Math.max(1000, ((waitHeader ? Number(waitHeader) : 2) || 2) * 1000 + 500);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }

    if (resp.status === 402) {
      const errText = (await resp.text()).slice(0, 300);
      throw new VoiceLabCreditsExhaustedError(`VoiceLab TTS HTTP 402: ${errText}`);
    }

    if (resp.status === 200) {
      return Buffer.from(await resp.arrayBuffer());
    }

    if (resp.status === 202) {
      const job = (await resp.json()) as { id?: string; status_url?: string };
      const statusUrl = new URL(
        job.status_url || `/v1/tts/generations/${job.id || ''}`,
        ttsUrl,
      ).toString();
      for (let poll = 0; poll < 25; poll++) {
        await new Promise((r) => setTimeout(r, 1000));
        const pollResp = await fetch(statusUrl, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!pollResp.ok) {
          throw new Error(`VoiceLab status HTTP ${pollResp.status}`);
        }
        const pollJson = (await pollResp.json()) as {
          status?: string;
          audio_url?: string;
          error?: string;
        };
        if (pollJson.status === 'completed' && pollJson.audio_url) {
          const audioResp = await fetch(pollJson.audio_url);
          if (!audioResp.ok) {
            throw new Error(`VoiceLab audio download HTTP ${audioResp.status}`);
          }
          return Buffer.from(await audioResp.arrayBuffer());
        }
        if (pollJson.status === 'failed') {
          throw new Error(pollJson.error || 'VoiceLab TTS failed');
        }
      }
      throw new Error('VoiceLab TTS timed out');
    }

    const errText = (await resp.text()).slice(0, 300);
    throw new Error(`VoiceLab TTS HTTP ${resp.status}: ${errText}`);
  }

  throw new Error('VoiceLab TTS rate limit retries exhausted');
}

function voicelabTtsDevPlugin(env: Record<string, string>): Plugin {
  const cacheDir = path.resolve(process.cwd(), 'public', 'audio', 'cache');
  const pendingByKey = new Map<string, Promise<Buffer>>();

  return {
    name: 'voicelab-tts-dev-endpoint',
    configureServer(server) {
      server.middlewares.use('/api/tts', (req: IncomingMessage, res: ServerResponse, next) => {
        void (async () => {
          try {
            let text = '';
            let voiceStyle: 'friendly' | 'neutral' = 'friendly';
            if (req.method === 'POST') {
              const rawBody = await readRequestBody(req);
              const parsed = JSON.parse(rawBody || '{}') as { text?: unknown; voice_style?: unknown };
              text = typeof parsed.text === 'string' ? parsed.text.trim() : '';
              if (typeof parsed.voice_style === 'string' && parsed.voice_style.trim().toLowerCase() === 'neutral') {
                voiceStyle = 'neutral';
              }
            } else if (req.method === 'GET') {
              const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
              text = (reqUrl.searchParams.get('text') || '').trim();
              if ((reqUrl.searchParams.get('voice_style') || '').trim().toLowerCase() === 'neutral') {
                voiceStyle = 'neutral';
              }
            } else {
              next();
              return;
            }

            if (!text) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: false, error: "text parametri bo'sh" }));
              return;
            }
            if (text.length > 1000) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: false, error: 'text juda uzun' }));
              return;
            }

            if (!(env.VOICELAB_API_KEY || '').trim()) {
              res.statusCode = 503;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: false, error: 'VOICELAB_API_KEY sozlanmagan' }));
              return;
            }

            const modelId = (env.VOICELAB_MODEL_ID || DEFAULT_VOICELAB_MODEL_ID).trim();
            const vlVoiceId =
              voiceStyle === 'neutral'
                ? NEUTRAL_VOICELAB_VOICE_ID
                : (env.VOICELAB_VOICE_ID || DEFAULT_VOICELAB_VOICE_ID).trim();
            const vlDigest = crypto
              .createHash('sha256')
              .update(`${modelId}:${vlVoiceId}:${text}`)
              .digest('hex')
              .slice(0, 24);
            const vlCacheFile = path.join(cacheDir, `vl_${vlDigest}.wav`);

            let audioBuffer: Buffer;
            if (fs.existsSync(vlCacheFile)) {
              audioBuffer = fs.readFileSync(vlCacheFile);
            } else {
              const inflightKey = `${voiceStyle}:${text}`;
              let inflight = pendingByKey.get(inflightKey);
              if (!inflight) {
                inflight = synthesizeVoiceLabWav(env, text, voiceStyle).then((buf) => {
                  fs.mkdirSync(cacheDir, { recursive: true });
                  fs.writeFileSync(vlCacheFile, buf);
                  return buf;
                });
                pendingByKey.set(inflightKey, inflight);
              }
              try {
                audioBuffer = await inflight;
              } finally {
                pendingByKey.delete(inflightKey);
              }
            }

            res.statusCode = 200;
            res.setHeader('Content-Type', detectAudioMime(audioBuffer));
            res.setHeader('Cache-Control', 'public, max-age=86400');
            res.end(audioBuffer);
          } catch (err) {
            if (err instanceof VoiceLabCreditsExhaustedError) {
              res.statusCode = 402;
              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({
                  ok: false,
                  code: 'voicelab_insufficient_credits',
                  error:
                    "VoiceLab API krediti yetarli emas (HTTP 402). Balansni to'ldiring yoki api.txt/.env ni yangilang.",
                }),
              );
              return;
            }
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                ok: false,
                error: err instanceof Error ? err.message : 'VoiceLab TTS xatosi',
              }),
            );
          }
        })();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), voicelabTtsDevPlugin(env)],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8765',
          changeOrigin: true,
        },
      },
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  };
});
