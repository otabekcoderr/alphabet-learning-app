import { randomUUID } from 'node:crypto';
import { jsonResponse } from './_lib/session.js';

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
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WAVE'
  ) {
    return 'audio/wav';
  }
  if (buf.length >= 4 && buf.subarray(0, 4).toString('ascii') === 'OggS') {
    return 'audio/ogg';
  }
  return 'audio/mpeg';
}

async function synthesizeVoiceLabWav(
  text: string,
  voiceStyle: 'friendly' | 'neutral' = 'friendly',
): Promise<Buffer> {
  const apiKey = (process.env.VOICELAB_API_KEY || '').trim();
  const ttsUrl = (process.env.VOICELAB_TTS_URL || DEFAULT_VOICELAB_TTS_URL).trim();
  const modelId = (process.env.VOICELAB_MODEL_ID || DEFAULT_VOICELAB_MODEL_ID).trim();
  const voiceId =
    voiceStyle === 'neutral'
      ? NEUTRAL_VOICELAB_VOICE_ID
      : (process.env.VOICELAB_VOICE_ID || DEFAULT_VOICELAB_VOICE_ID).trim();
  const speed = voiceStyle === 'neutral' ? 0.95 : 1;

  if (!apiKey) {
    throw new Error('VOICELAB_API_KEY sozlanmagan');
  }

  const idempotencyKey = randomUUID();
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

async function handleTts(text: string, voiceStyle: 'friendly' | 'neutral'): Promise<Response> {
  if (!text) {
    return jsonResponse({ ok: false, error: "text parametri bo'sh" }, 400);
  }
  if (text.length > 1000) {
    return jsonResponse({ ok: false, error: 'text juda uzun' }, 400);
  }
  if (!(process.env.VOICELAB_API_KEY || '').trim()) {
    return jsonResponse({ ok: false, error: 'VOICELAB_API_KEY sozlanmagan' }, 503);
  }

  try {
    const audioBuffer = await synthesizeVoiceLabWav(text, voiceStyle);
    return new Response(new Uint8Array(audioBuffer), {
      status: 200,
      headers: {
        'Content-Type': detectAudioMime(audioBuffer),
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (err) {
    if (err instanceof VoiceLabCreditsExhaustedError) {
      return jsonResponse(
        {
          ok: false,
          code: 'voicelab_insufficient_credits',
          error: 'VoiceLab API krediti yetarli emas (HTTP 402).',
        },
        402,
      );
    }
    return jsonResponse(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'VoiceLab TTS xatosi',
      },
      502,
    );
  }
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const text = (url.searchParams.get('text') || '').trim();
  const voiceStyle =
    (url.searchParams.get('voice_style') || '').trim().toLowerCase() === 'neutral'
      ? 'neutral'
      : 'friendly';
  return handleTts(text, voiceStyle);
}

export async function POST(request: Request): Promise<Response> {
  let parsed: { text?: unknown; voice_style?: unknown } = {};
  try {
    parsed = (await request.json()) as { text?: unknown; voice_style?: unknown };
  } catch {
    return jsonResponse({ ok: false, error: "Noto'g'ri JSON" }, 400);
  }
  const text = typeof parsed.text === 'string' ? parsed.text.trim() : '';
  const voiceStyle =
    typeof parsed.voice_style === 'string' && parsed.voice_style.trim().toLowerCase() === 'neutral'
      ? 'neutral'
      : 'friendly';
  return handleTts(text, voiceStyle);
}
