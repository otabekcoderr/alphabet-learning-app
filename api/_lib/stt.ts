import { randomUUID } from 'node:crypto';

export type SttProviderName = 'proxy' | 'voicelab' | 'uzbekvoice' | 'none';
export type ConfiguredSttProviderName = Exclude<SttProviderName, 'none'>;

export type SttFailureReason =
  | 'unauthorized'
  | 'insufficient_credits'
  | 'endpoint_not_found'
  | 'rate_limited'
  | 'timeout'
  | 'network_error'
  | 'bad_request'
  | 'provider_job_failed'
  | 'upstream_error'
  | 'invalid_response'
  | 'unconfigured';

export interface SttAttemptFailure {
  provider: ConfiguredSttProviderName;
  reason: SttFailureReason;
  upstreamStatus: number | null;
}

export interface SttUpstreamErrorDetails {
  provider: SttProviderName;
  reason: SttFailureReason;
  upstreamStatus: number | null;
  attempts?: SttAttemptFailure[];
}

const DEFAULT_VOICELAB_STT_URL = 'https://api.voicelab.uz/v1/stt';
const DEFAULT_UZBEKVOICE_STT_URL = 'https://uzbekvoice.ai/api/v1/stt';
const RMS_FLOOR = 0.008;

const UZBEK_APOSTROPHE_MAP: Record<string, string> = {
  '\u2018': "'",
  '\u2019': "'",
  '\u02bb': "'",
  '\u02bc': "'",
  '`': "'",
  '\u00b4': "'",
};

export class SttUpstreamError extends Error {
  readonly provider: SttProviderName;
  readonly reason: SttFailureReason;
  readonly upstreamStatus: number | null;
  readonly code: string;
  readonly attempts?: SttAttemptFailure[];

  constructor(details: SttUpstreamErrorDetails, message?: string) {
    super(message ?? `STT ${details.provider} failure: ${details.reason}`);
    this.name = 'SttUpstreamError';
    this.provider = details.provider;
    this.reason = details.reason;
    this.upstreamStatus = details.upstreamStatus;
    this.code =
      details.provider === 'voicelab' && details.reason === 'insufficient_credits'
        ? 'voicelab_insufficient_credits'
        : `stt_${details.provider}_${details.reason}`;
    if (details.attempts && details.attempts.length > 0) {
      this.attempts = details.attempts;
    }
  }
}

export class VoiceLabSttCreditsError extends SttUpstreamError {
  constructor(message = 'VoiceLab STT HTTP 402') {
    super(
      {
        provider: 'voicelab',
        reason: 'insufficient_credits',
        upstreamStatus: 402,
      },
      message,
    );
    this.name = 'VoiceLabSttCreditsError';
  }
}

export function classifyHttpFailureReason(status: number): SttFailureReason {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 402) return 'insufficient_credits';
  if (status === 404) return 'endpoint_not_found';
  if (status === 429) return 'rate_limited';
  if (status === 408 || status === 504) return 'timeout';
  if (status >= 400 && status < 500) return 'bad_request';
  return 'upstream_error';
}

function isTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  if (err.name === 'TimeoutError' || err.name === 'AbortError') {
    return true;
  }
  const cause = (err as { cause?: unknown }).cause;
  if (cause && typeof cause === 'object' && 'code' in cause) {
    const code = String((cause as { code?: unknown }).code ?? '');
    if (
      code === 'UND_ERR_CONNECT_TIMEOUT' ||
      code === 'UND_ERR_HEADERS_TIMEOUT' ||
      code === 'UND_ERR_BODY_TIMEOUT' ||
      code === 'ETIMEDOUT'
    ) {
      return true;
    }
  }
  return /\b(timeout|timed out|aborted)\b/i.test(err.message);
}

function wrapFetchError(provider: ConfiguredSttProviderName, err: unknown): SttUpstreamError {
  if (err instanceof SttUpstreamError) {
    return err;
  }
  const reason: SttFailureReason = isTimeoutError(err) ? 'timeout' : 'network_error';
  return new SttUpstreamError(
    {
      provider,
      reason,
      upstreamStatus: null,
    },
    `STT ${provider} ${reason}`,
  );
}

async function parseJsonResponse<T extends Record<string, unknown>>(
  resp: Response,
  provider: ConfiguredSttProviderName,
): Promise<T> {
  try {
    const parsed = (await resp.json()) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Non-object JSON payload');
    }
    return parsed as T;
  } catch {
    throw new SttUpstreamError(
      {
        provider,
        reason: 'invalid_response',
        upstreamStatus: resp.status,
      },
      `STT ${provider} invalid JSON response (HTTP ${resp.status})`,
    );
  }
}

function extractTranscriptFromPayload(payload: Record<string, unknown>): string {
  const result = payload.result;
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const resultText = (result as { text?: unknown }).text;
    if (typeof resultText === 'string') {
      return resultText;
    }
  }
  if (typeof payload.transcript === 'string') {
    return payload.transcript;
  }
  if (typeof payload.text === 'string') {
    return payload.text;
  }
  return '';
}

export function getConfiguredSttProvidersSummary(): {
  proxy: boolean;
  uzbekvoice: boolean;
  voicelab: boolean;
} {
  return {
    proxy: Boolean(process.env.STT_BACKEND_URL?.trim()),
    uzbekvoice: Boolean(process.env.UZBEKVOICE_API_KEY?.trim()),
    voicelab: Boolean(process.env.VOICELAB_API_KEY?.trim()),
  };
}

export function getConfiguredSttProvider(): SttProviderName {
  if (process.env.STT_BACKEND_URL?.trim()) {
    return 'proxy';
  }
  if (process.env.UZBEKVOICE_API_KEY?.trim()) {
    return 'uzbekvoice';
  }
  if (process.env.VOICELAB_API_KEY?.trim()) {
    return 'voicelab';
  }
  return 'none';
}

export function normalizeUzbekServer(text: string): string {
  let out = '';
  for (const ch of text || '') {
    out += UZBEK_APOSTROPHE_MAP[ch] ?? ch;
  }
  out = out.toLowerCase();
  out = out.replace(/[^\p{L}\p{N}\s']/gu, ' ').replace(/_/g, ' ');
  return out.replace(/\s+/g, ' ').trim();
}

export function evaluateSttMatch(
  transcript: string,
  expected: string,
  acceptAliases: string[],
): { normalized: string; accepted: boolean } {
  const normalized = normalizeUzbekServer(transcript);
  if (!normalized) {
    return { normalized: '', accepted: false };
  }

  const candidates = [expected, ...acceptAliases]
    .map((candidate) => normalizeUzbekServer(candidate))
    .filter((candidate) => candidate.length > 0);

  if (candidates.length === 0) {
    return { normalized, accepted: true };
  }

  const compactTranscript = normalized.replace(/\s+/g, '');
  const accepted = candidates.some(
    (candidate) => candidate === normalized || candidate.replace(/\s+/g, '') === compactTranscript,
  );

  return { normalized, accepted };
}

export function detectAudioFormat(
  buf: Buffer,
  contentType?: string,
): { mime: string; ext: string } {
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WAVE'
  ) {
    return { mime: 'audio/wav', ext: 'wav' };
  }
  if (buf.length >= 4 && buf.subarray(0, 4).toString('ascii') === 'OggS') {
    return { mime: 'audio/ogg', ext: 'ogg' };
  }
  if (
    (buf.length >= 3 && buf.subarray(0, 3).toString('ascii') === 'ID3') ||
    (buf.length >= 2 && buf[0] === 0xff && ((buf[1] ?? 0) & 0xe0) === 0xe0)
  ) {
    return { mime: 'audio/mpeg', ext: 'mp3' };
  }
  if (
    buf.length >= 4 &&
    buf[0] === 0x1a &&
    buf[1] === 0x45 &&
    buf[2] === 0xdf &&
    buf[3] === 0xa3
  ) {
    return { mime: 'audio/webm', ext: 'webm' };
  }

  const normalizedType = (contentType || '').toLowerCase();
  if (normalizedType.includes('mpeg') || normalizedType.includes('mp3')) {
    return { mime: 'audio/mpeg', ext: 'mp3' };
  }
  if (normalizedType.includes('ogg')) {
    return { mime: 'audio/ogg', ext: 'ogg' };
  }
  if (normalizedType.includes('webm')) {
    return { mime: 'audio/webm', ext: 'webm' };
  }
  if (normalizedType.includes('wav')) {
    return { mime: 'audio/wav', ext: 'wav' };
  }
  return { mime: 'audio/wav', ext: 'wav' };
}

export interface WavSilenceAnalysis {
  isWav: boolean;
  isSilence: boolean;
  origMs: number;
  trimmedMs: number;
  maxRms: number;
}

export function analyzeWavSilence(buf: Buffer): WavSilenceAnalysis {
  const nonWav: WavSilenceAnalysis = {
    isWav: false,
    isSilence: false,
    origMs: 0,
    trimmedMs: 0,
    maxRms: 0,
  };

  if (
    buf.length < 44 ||
    buf.subarray(0, 4).toString('ascii') !== 'RIFF' ||
    buf.subarray(8, 12).toString('ascii') !== 'WAVE'
  ) {
    return nonWav;
  }

  let audioFormat = 0;
  let numChannels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataStart = -1;
  let dataLength = 0;

  let offset = 12;
  while (offset + 8 <= buf.length) {
    const chunkId = buf.subarray(offset, offset + 4).toString('ascii');
    const chunkSize = buf.readUInt32LE(offset + 4);
    const payloadStart = offset + 8;

    if (chunkId === 'fmt ' && payloadStart + 16 <= buf.length) {
      audioFormat = buf.readUInt16LE(payloadStart);
      numChannels = buf.readUInt16LE(payloadStart + 2);
      sampleRate = buf.readUInt32LE(payloadStart + 4);
      bitsPerSample = buf.readUInt16LE(payloadStart + 14);
    } else if (chunkId === 'data' && payloadStart < buf.length) {
      dataStart = payloadStart;
      dataLength = Math.min(chunkSize, buf.length - payloadStart);
      break;
    }

    const paddedSize = chunkSize + (chunkSize % 2);
    if (paddedSize < 0) break;
    offset = payloadStart + paddedSize;
  }

  if (
    audioFormat !== 1 ||
    bitsPerSample !== 16 ||
    sampleRate <= 0 ||
    numChannels <= 0 ||
    dataStart < 0 ||
    dataLength <= 0
  ) {
    return nonWav;
  }

  const bytesPerFrame = numChannels * 2;
  const totalSampleFrames = Math.floor(dataLength / bytesPerFrame);
  if (totalSampleFrames <= 0) {
    return nonWav;
  }

  const origMs = Math.round((totalSampleFrames / sampleRate) * 1000);
  const windowSamples = Math.max(1, Math.round(sampleRate * 0.02));
  const totalWindows = Math.max(1, Math.ceil(totalSampleFrames / windowSamples));

  let maxRms = 0;
  let firstActiveWin = -1;
  let lastActiveWin = -1;

  for (let winIdx = 0; winIdx < totalWindows; winIdx++) {
    const startFrame = winIdx * windowSamples;
    const endFrame = Math.min(totalSampleFrames, startFrame + windowSamples);
    let sumSq = 0;
    let sampleCount = 0;

    for (let frame = startFrame; frame < endFrame; frame++) {
      const frameOffset = dataStart + frame * bytesPerFrame;
      for (let ch = 0; ch < numChannels; ch++) {
        const sampleOffset = frameOffset + ch * 2;
        if (sampleOffset + 2 > buf.length) break;
        const normalized = buf.readInt16LE(sampleOffset) / 32768;
        sumSq += normalized * normalized;
        sampleCount++;
      }
    }

    if (sampleCount === 0) continue;
    const rms = Math.sqrt(sumSq / sampleCount);
    if (rms > maxRms) {
      maxRms = rms;
    }
    if (rms >= RMS_FLOOR) {
      if (firstActiveWin === -1) {
        firstActiveWin = winIdx;
      }
      lastActiveWin = winIdx;
    }
  }

  if (firstActiveWin === -1) {
    return {
      isWav: true,
      isSilence: true,
      origMs,
      trimmedMs: 0,
      maxRms,
    };
  }

  const trimmedMs = Math.min(origMs, (lastActiveWin - firstActiveWin + 1) * 20);
  return {
    isWav: true,
    isSilence: false,
    origMs,
    trimmedMs,
    maxRms,
  };
}

function buildVoiceLabForm(audioBuf: Buffer, fmt: { mime: string; ext: string }): FormData {
  const form = new FormData();
  form.append('audio', new Blob([new Uint8Array(audioBuf)], { type: fmt.mime }), `speech.${fmt.ext}`);
  form.append('language', 'uz');
  form.append('include_speakers', 'false');
  return form;
}

function buildUzbekVoiceForm(
  audioBuf: Buffer,
  fmt: { mime: string; ext: string },
  model: string,
): FormData {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audioBuf)], { type: fmt.mime }), `speech.${fmt.ext}`);
  form.append('language', 'uz');
  form.append('model', model);
  form.append('blocking', 'true');
  form.append('return_offsets', 'false');
  form.append('run_diarization', 'false');
  return form;
}

export async function transcribeWithVoiceLab(
  audioBuf: Buffer,
  contentType?: string,
  timeoutMs?: number,
): Promise<string> {
  const apiKey = process.env.VOICELAB_API_KEY?.trim();
  if (!apiKey) {
    throw new SttUpstreamError(
      { provider: 'voicelab', reason: 'unconfigured', upstreamStatus: null },
      'VOICELAB_API_KEY sozlanmagan',
    );
  }

  const sttUrl = (process.env.VOICELAB_STT_URL || DEFAULT_VOICELAB_STT_URL).trim();
  const fmt = detectAudioFormat(audioBuf, contentType);
  const idempotencyKey = randomUUID();
  const effectiveTimeoutMs =
    timeoutMs ?? (process.env.UZBEKVOICE_API_KEY?.trim() ? 6_000 : 10_000);
  const deadline = Date.now() + effectiveTimeoutMs;

  for (let attempt = 0; attempt < 2; attempt++) {
    const remainingMs = Math.max(500, deadline - Date.now());
    let resp: Response;
    try {
      resp = await fetch(sttUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Idempotency-Key': idempotencyKey,
        },
        body: buildVoiceLabForm(audioBuf, fmt),
        signal: AbortSignal.timeout(remainingMs),
      });
    } catch (err) {
      throw wrapFetchError('voicelab', err);
    }

    if (resp.status === 429 && attempt === 0) {
      const waitMs = Math.min(1000, Math.max(100, deadline - Date.now()));
      if (Date.now() + waitMs < deadline) {
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      throw new SttUpstreamError(
        { provider: 'voicelab', reason: 'rate_limited', upstreamStatus: 429 },
        'VoiceLab STT HTTP 429',
      );
    }

    if (resp.status === 402) {
      throw new VoiceLabSttCreditsError('VoiceLab STT HTTP 402');
    }

    if (resp.status === 200) {
      const data = await parseJsonResponse<Record<string, unknown>>(resp, 'voicelab');
      return extractTranscriptFromPayload(data);
    }

    if (resp.status === 202) {
      const job = await parseJsonResponse<{ id?: unknown; status_url?: unknown }>(resp, 'voicelab');
      const rawStatusUrl =
        typeof job.status_url === 'string' && job.status_url.trim()
          ? job.status_url.trim()
          : `/v1/stt/transcriptions/${typeof job.id === 'string' ? job.id : ''}`;
      const statusUrl = new URL(rawStatusUrl, sttUrl).toString();

      while (Date.now() < deadline) {
        const sleepMs = Math.min(300, Math.max(50, deadline - Date.now()));
        await new Promise((r) => setTimeout(r, sleepMs));
        if (Date.now() >= deadline) break;

        let pollResp: Response;
        try {
          pollResp = await fetch(statusUrl, {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(Math.max(500, deadline - Date.now())),
          });
        } catch (err) {
          throw wrapFetchError('voicelab', err);
        }

        if (!pollResp.ok) {
          throw new SttUpstreamError(
            {
              provider: 'voicelab',
              reason: classifyHttpFailureReason(pollResp.status),
              upstreamStatus: pollResp.status,
            },
            `VoiceLab STT status HTTP ${pollResp.status}`,
          );
        }

        const pollJson = await parseJsonResponse<Record<string, unknown>>(pollResp, 'voicelab');
        const status = typeof pollJson.status === 'string' ? pollJson.status.toLowerCase() : '';
        if (status === 'completed' || status === 'done' || status === 'succeeded') {
          return extractTranscriptFromPayload(pollJson);
        }
        if (status === 'failed' || status === 'error') {
          throw new SttUpstreamError(
            {
              provider: 'voicelab',
              reason: 'provider_job_failed',
              upstreamStatus: pollResp.status,
            },
            'VoiceLab STT job failed',
          );
        }
      }

      throw new SttUpstreamError(
        { provider: 'voicelab', reason: 'timeout', upstreamStatus: null },
        'VoiceLab STT timed out',
      );
    }

    throw new SttUpstreamError(
      {
        provider: 'voicelab',
        reason: classifyHttpFailureReason(resp.status),
        upstreamStatus: resp.status,
      },
      `VoiceLab STT HTTP ${resp.status}`,
    );
  }

  throw new SttUpstreamError(
    { provider: 'voicelab', reason: 'rate_limited', upstreamStatus: 429 },
    'VoiceLab STT rate limit retries exhausted',
  );
}

export async function transcribeWithUzbekVoice(
  audioBuf: Buffer,
  contentType?: string,
  timeoutMs?: number,
): Promise<string> {
  const apiKey = process.env.UZBEKVOICE_API_KEY?.trim();
  if (!apiKey) {
    throw new SttUpstreamError(
      { provider: 'uzbekvoice', reason: 'unconfigured', upstreamStatus: null },
      'UZBEKVOICE_API_KEY sozlanmagan',
    );
  }

  const sttUrl = (process.env.UZBEKVOICE_STT_URL || DEFAULT_UZBEKVOICE_STT_URL).trim();
  const model = (process.env.UZBEKVOICE_STT_MODEL || 'general').trim() || 'general';
  const fmt = detectAudioFormat(audioBuf, contentType);
  const effectiveTimeoutMs =
    timeoutMs ?? (process.env.VOICELAB_API_KEY?.trim() ? 10_000 : 15_000);
  const deadline = Date.now() + effectiveTimeoutMs;

  for (let attempt = 0; attempt < 2; attempt++) {
    const remainingMs = Math.max(500, deadline - Date.now());
    let resp: Response;
    try {
      resp = await fetch(sttUrl, {
        method: 'POST',
        headers: {
          Authorization: apiKey,
        },
        body: buildUzbekVoiceForm(audioBuf, fmt, model),
        signal: AbortSignal.timeout(remainingMs),
      });
    } catch (err) {
      throw wrapFetchError('uzbekvoice', err);
    }

    if (resp.status === 429 && attempt === 0) {
      const waitMs = Math.min(1000, Math.max(100, deadline - Date.now()));
      if (Date.now() + waitMs < deadline) {
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      throw new SttUpstreamError(
        { provider: 'uzbekvoice', reason: 'rate_limited', upstreamStatus: 429 },
        'UzbekVoice STT HTTP 429',
      );
    }

    if (!resp.ok) {
      throw new SttUpstreamError(
        {
          provider: 'uzbekvoice',
          reason: classifyHttpFailureReason(resp.status),
          upstreamStatus: resp.status,
        },
        `UzbekVoice STT HTTP ${resp.status}`,
      );
    }

    const json = await parseJsonResponse<Record<string, unknown>>(resp, 'uzbekvoice');
    const rawStatus =
      typeof json.status === 'string'
        ? json.status
        : typeof json.state === 'string'
          ? json.state
          : '';
    const status = rawStatus.toLowerCase();

    if (status === 'failure' || status === 'failed' || status === 'error' || status === 'revoked') {
      throw new SttUpstreamError(
        {
          provider: 'uzbekvoice',
          reason: 'provider_job_failed',
          upstreamStatus: resp.status,
        },
        'UzbekVoice STT job failed',
      );
    }

    const extracted = extractTranscriptFromPayload(json);
    if (extracted || status === 'success' || status === 'completed' || status === 'done' || status === 'succeeded') {
      return extracted;
    }

    const taskId = typeof json.id === 'string' ? json.id.trim() : '';
    const isPending =
      resp.status === 202 ||
      status === 'pending' ||
      status === 'in_progress' ||
      status === 'started' ||
      status === 'queued' ||
      status === 'processing';

    if (isPending && taskId) {
      const pollUrl = new URL(`/api/v1/tasks?id=${encodeURIComponent(taskId)}`, sttUrl).toString();

      while (Date.now() < deadline) {
        const sleepMs = Math.min(400, Math.max(50, deadline - Date.now()));
        await new Promise((r) => setTimeout(r, sleepMs));
        if (Date.now() >= deadline) break;

        let pollResp: Response;
        try {
          pollResp = await fetch(pollUrl, {
            headers: { Authorization: apiKey },
            signal: AbortSignal.timeout(Math.max(500, deadline - Date.now())),
          });
        } catch (err) {
          throw wrapFetchError('uzbekvoice', err);
        }

        if (!pollResp.ok) {
          throw new SttUpstreamError(
            {
              provider: 'uzbekvoice',
              reason: classifyHttpFailureReason(pollResp.status),
              upstreamStatus: pollResp.status,
            },
            `UzbekVoice STT task HTTP ${pollResp.status}`,
          );
        }

        const pollJson = await parseJsonResponse<Record<string, unknown>>(pollResp, 'uzbekvoice');
        const pollRawStatus =
          typeof pollJson.status === 'string'
            ? pollJson.status
            : typeof pollJson.state === 'string'
              ? pollJson.state
              : '';
        const pollStatus = pollRawStatus.toLowerCase();

        if (
          pollStatus === 'success' ||
          pollStatus === 'completed' ||
          pollStatus === 'done' ||
          pollStatus === 'succeeded'
        ) {
          return extractTranscriptFromPayload(pollJson);
        }

        if (
          pollStatus === 'failure' ||
          pollStatus === 'failed' ||
          pollStatus === 'error' ||
          pollStatus === 'revoked'
        ) {
          throw new SttUpstreamError(
            {
              provider: 'uzbekvoice',
              reason: 'provider_job_failed',
              upstreamStatus: pollResp.status,
            },
            'UzbekVoice STT task failed',
          );
        }
      }

      throw new SttUpstreamError(
        { provider: 'uzbekvoice', reason: 'timeout', upstreamStatus: null },
        'UzbekVoice STT timed out',
      );
    }

    return extracted;
  }

  throw new SttUpstreamError(
    { provider: 'uzbekvoice', reason: 'rate_limited', upstreamStatus: 429 },
    'UzbekVoice STT rate limit retries exhausted',
  );
}

export async function transcribeAudioBuffer(
  audioBuf: Buffer,
  options: {
    contentType?: string;
    expected?: string;
    acceptAliases?: string[];
  } = {},
): Promise<{
  transcript: string;
  provider: SttProviderName;
  proxyPayload?: Record<string, unknown>;
}> {
  const proxyBase = process.env.STT_BACKEND_URL?.trim();
  const hasVoiceLab = Boolean(process.env.VOICELAB_API_KEY?.trim());
  const hasUzbekVoice = Boolean(process.env.UZBEKVOICE_API_KEY?.trim());
  const attempts: SttAttemptFailure[] = [];
  let lastErr: SttUpstreamError | null = null;

  if (proxyBase) {
    try {
      const params = new URLSearchParams();
      if (options.expected) {
        params.set('expected', options.expected);
      }
      if (options.acceptAliases && options.acceptAliases.length > 0) {
        params.set('accept', options.acceptAliases.join('|'));
      }
      const qs = params.toString();
      const targetUrl = `${proxyBase.replace(/\/+$/, '')}/api/stt${qs ? `?${qs}` : ''}`;
      const fmt = detectAudioFormat(audioBuf, options.contentType);
      let resp: Response;
      try {
        resp = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'Content-Type': options.contentType || fmt.mime,
          },
          body: new Uint8Array(audioBuf),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (err) {
        throw wrapFetchError('proxy', err);
      }

      if (!resp.ok) {
        throw new SttUpstreamError(
          {
            provider: 'proxy',
            reason: classifyHttpFailureReason(resp.status),
            upstreamStatus: resp.status,
          },
          `Proxy STT HTTP ${resp.status}`,
        );
      }

      const proxyPayload = await parseJsonResponse<Record<string, unknown>>(resp, 'proxy');
      const transcript =
        typeof proxyPayload.transcript === 'string' ? proxyPayload.transcript : '';
      return {
        transcript,
        provider: 'proxy',
        proxyPayload,
      };
    } catch (err) {
      const wrapped = wrapFetchError('proxy', err);
      lastErr = wrapped;
      attempts.push({
        provider: 'proxy',
        reason: wrapped.reason,
        upstreamStatus: wrapped.upstreamStatus,
      });
      if (!hasVoiceLab && !hasUzbekVoice) {
        throw wrapped;
      }
    }
  }

  if (hasUzbekVoice) {
    try {
      const transcript = await transcribeWithUzbekVoice(audioBuf, options.contentType);
      return { transcript, provider: 'uzbekvoice' };
    } catch (err) {
      const wrapped = wrapFetchError('uzbekvoice', err);
      lastErr = wrapped;
      attempts.push({
        provider: 'uzbekvoice',
        reason: wrapped.reason,
        upstreamStatus: wrapped.upstreamStatus,
      });
      if (!hasVoiceLab) {
        throw new SttUpstreamError(
          {
            provider: wrapped.provider,
            reason: wrapped.reason,
            upstreamStatus: wrapped.upstreamStatus,
            attempts,
          },
          wrapped.message,
        );
      }
    }
  }

  if (hasVoiceLab) {
    try {
      const transcript = await transcribeWithVoiceLab(
        audioBuf,
        options.contentType,
        hasUzbekVoice ? 6_000 : 10_000,
      );
      return { transcript, provider: 'voicelab' };
    } catch (err) {
      const wrapped = wrapFetchError('voicelab', err);
      lastErr = wrapped;
      attempts.push({
        provider: 'voicelab',
        reason: wrapped.reason,
        upstreamStatus: wrapped.upstreamStatus,
      });
    }
  }

  if (lastErr) {
    if (lastErr instanceof VoiceLabSttCreditsError && attempts.length <= 1) {
      throw lastErr;
    }
    throw new SttUpstreamError(
      {
        provider: lastErr.provider,
        reason: lastErr.reason,
        upstreamStatus: lastErr.upstreamStatus,
        attempts,
      },
      lastErr.message,
    );
  }

  throw new SttUpstreamError(
    { provider: 'none', reason: 'unconfigured', upstreamStatus: null },
    'STT provayderi sozlanmagan',
  );
}
