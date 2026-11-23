import { jsonResponse } from './_lib/session.js';
import {
  analyzeWavSilence,
  evaluateSttMatch,
  getConfiguredSttProvider,
  SttUpstreamError,
  transcribeAudioBuffer,
  type SttFailureReason,
} from './_lib/stt.js';

const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

function mapSttFailureToHttp(reason: SttFailureReason): { status: number; error: string } {
  switch (reason) {
    case 'timeout':
      return { status: 504, error: 'Ovozli tekshiruv vaqti tugadi.' };
    case 'insufficient_credits':
      return { status: 503, error: 'Ovozli tekshiruv xizmati vaqtincha mavjud emas.' };
    case 'unauthorized':
      return { status: 503, error: 'Ovozli tekshiruv xizmati kaliti noto‘g‘ri.' };
    case 'endpoint_not_found':
      return { status: 503, error: 'Ovozli tekshiruv manzili topilmadi.' };
    case 'unconfigured':
      return { status: 503, error: 'Ovozli tekshiruv serveri sozlanmagan.' };
    case 'rate_limited':
      return { status: 429, error: 'Ovozli tekshiruv so‘rovlari juda ko‘p.' };
    case 'network_error':
    case 'upstream_error':
    case 'bad_request':
    case 'provider_job_failed':
    case 'invalid_response':
      return { status: 502, error: 'Ovozli tekshiruvda xatolik yuz berdi.' };
  }
}

interface ParsedAudioInput {
  audioBuf: Buffer;
  contentType: string;
  expected: string;
  acceptRaw: string;
}

async function parseSttRequest(request: Request): Promise<ParsedAudioInput | Response> {
  const url = new URL(request.url);
  let expected = (url.searchParams.get('expected') || '').trim();
  let acceptRaw = url.searchParams.get('accept') || '';
  const reqContentType = request.headers.get('content-type') || '';
  const lowerType = reqContentType.toLowerCase();

  if (lowerType.includes('multipart/form-data')) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return jsonResponse({ ok: false, error: "Noto'g'ri multipart audio so'rovi." }, 400);
    }
    const filePart = form.get('file') ?? form.get('audio');
    if (!(filePart instanceof Blob)) {
      return jsonResponse({ ok: false, error: 'Audio fayli topilmadi.' }, 400);
    }
    if (!expected) {
      const formExpected = form.get('expected');
      if (typeof formExpected === 'string') {
        expected = formExpected.trim();
      }
    }
    if (!acceptRaw) {
      const formAccept = form.get('accept');
      if (typeof formAccept === 'string') {
        acceptRaw = formAccept;
      }
    }
    const audioBuf = Buffer.from(await filePart.arrayBuffer());
    return {
      audioBuf,
      contentType: filePart.type || 'application/octet-stream',
      expected,
      acceptRaw,
    };
  }

  if (lowerType.includes('application/json')) {
    let payload: Record<string, unknown>;
    try {
      payload = (await request.json()) as Record<string, unknown>;
    } catch {
      return jsonResponse({ ok: false, error: "Noto'g'ri JSON formati." }, 400);
    }
    if (!expected && typeof payload.expected === 'string') {
      expected = payload.expected.trim();
    }
    if (!acceptRaw && typeof payload.accept === 'string') {
      acceptRaw = payload.accept;
    }
    const b64 = typeof payload.audio_base64 === 'string' ? payload.audio_base64.trim() : '';
    const audioBuf = b64 ? Buffer.from(b64, 'base64') : Buffer.alloc(0);
    return {
      audioBuf,
      contentType: typeof payload.mime_type === 'string' ? payload.mime_type : 'audio/wav',
      expected,
      acceptRaw,
    };
  }

  const audioBuf = Buffer.from(await request.arrayBuffer());
  return {
    audioBuf,
    contentType: reqContentType || 'application/octet-stream',
    expected,
    acceptRaw,
  };
}

export async function POST(request: Request): Promise<Response> {
  const startedAt = Date.now();
  const parsed = await parseSttRequest(request);
  if (parsed instanceof Response) {
    return parsed;
  }

  const { audioBuf, contentType, expected, acceptRaw } = parsed;
  if (audioBuf.length === 0) {
    return jsonResponse({ ok: false, error: "Bo'sh audio yuborildi." }, 400);
  }
  if (audioBuf.length > MAX_AUDIO_BYTES) {
    return jsonResponse({ ok: false, error: 'Audio hajmi 5 MB dan oshmasligi kerak.' }, 413);
  }

  const acceptAliases = acceptRaw
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);

  const wavInfo = analyzeWavSilence(audioBuf);
  if (wavInfo.isWav && wavInfo.isSilence) {
    return jsonResponse({
      ok: true,
      transcript: '',
      normalized: '',
      accepted: false,
      is_silence: true,
      confidence: null,
      confidence_available: false,
      latency_ms: Date.now() - startedAt,
      orig_ms: wavInfo.origMs,
      trimmed_ms: 0,
    });
  }

  if (getConfiguredSttProvider() === 'none') {
    return jsonResponse(
      {
        ok: false,
        code: 'stt_unconfigured',
        provider: 'none',
        reason: 'unconfigured',
        upstreamStatus: null,
        error: 'Ovozli tekshiruv serveri sozlanmagan.',
      },
      503,
    );
  }

  try {
    const result = await transcribeAudioBuffer(audioBuf, {
      contentType,
      expected,
      acceptAliases,
    });

    if (
      result.proxyPayload &&
      typeof result.proxyPayload.ok === 'boolean' &&
      typeof result.proxyPayload.transcript === 'string' &&
      typeof result.proxyPayload.accepted === 'boolean'
    ) {
      return jsonResponse({
        ...result.proxyPayload,
        provider: result.proxyPayload.provider ?? result.provider,
      });
    }

    const { normalized, accepted } = evaluateSttMatch(
      result.transcript,
      expected,
      acceptAliases,
    );

    return jsonResponse({
      ok: true,
      provider: result.provider,
      transcript: result.transcript,
      normalized,
      accepted,
      is_silence: !result.transcript.trim(),
      confidence: null,
      confidence_available: false,
      latency_ms: Date.now() - startedAt,
      orig_ms: wavInfo.origMs,
      trimmed_ms: wavInfo.trimmedMs,
    });
  } catch (err) {
    if (err instanceof SttUpstreamError) {
      const mapped = mapSttFailureToHttp(err.reason);
      return jsonResponse(
        {
          ok: false,
          code: err.code,
          provider: err.provider,
          reason: err.reason,
          upstreamStatus: err.upstreamStatus,
          ...(err.attempts && err.attempts.length > 1 ? { attempts: err.attempts } : {}),
          error: mapped.error,
        },
        mapped.status,
      );
    }
    return jsonResponse(
      {
        ok: false,
        code: 'stt_internal_error',
        provider: getConfiguredSttProvider(),
        reason: 'upstream_error',
        upstreamStatus: null,
        error: 'Ovozli tekshiruvda xatolik yuz berdi.',
      },
      502,
    );
  }
}
