import { randomUUID } from 'node:crypto';

export type SttProviderName = 'proxy' | 'voicelab' | 'uzbekvoice' | 'none';

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

export function getConfiguredSttProvider(): SttProviderName {
  if (process.env.STT_BACKEND_URL?.trim()) {
    return 'proxy';
  }
  if (process.env.VOICELAB_API_KEY?.trim()) {
    return 'voicelab';
  }
  if (process.env.UZBEKVOICE_API_KEY?.trim()) {
    return 'uzbekvoice';
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

export async function transcribeWithVoiceLab(
  audioBuf: Buffer,
  contentType?: string,
): Promise<string> {
  const apiKey = process.env.VOICELAB_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('VOICELAB_API_KEY sozlanmagan');
  }

  const sttUrl = (process.env.VOICELAB_STT_URL || DEFAULT_VOICELAB_STT_URL).trim();
  const fmt = detectAudioFormat(audioBuf, contentType);
  const idempotencyKey = randomUUID();

  for (let attempt = 0; attempt < 2; attempt++) {
    const resp = await fetch(sttUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Idempotency-Key': idempotencyKey,
      },
      body: buildVoiceLabForm(audioBuf, fmt),
      signal: AbortSignal.timeout(15_000),
    });

    if (resp.status === 429 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }

    if (resp.status === 200) {
      const data = (await resp.json()) as { transcript?: unknown; text?: unknown };
      return typeof data.transcript === 'string'
        ? data.transcript
        : typeof data.text === 'string'
          ? data.text
          : '';
    }

    if (resp.status === 202) {
      const job = (await resp.json()) as { id?: string; status_url?: string };
      const statusUrl = new URL(
        job.status_url || `/v1/stt/transcriptions/${job.id || ''}`,
        sttUrl,
      ).toString();

      for (let poll = 0; poll < 35; poll++) {
        await new Promise((r) => setTimeout(r, 300));
        const pollResp = await fetch(statusUrl, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (!pollResp.ok) {
          throw new Error(`VoiceLab STT status HTTP ${pollResp.status}`);
        }
        const pollJson = (await pollResp.json()) as {
          status?: string;
          transcript?: unknown;
          text?: unknown;
          error?: string;
        };
        const status = (pollJson.status || '').toLowerCase();
        if (status === 'completed' || status === 'done' || status === 'succeeded') {
          return typeof pollJson.transcript === 'string'
            ? pollJson.transcript
            : typeof pollJson.text === 'string'
              ? pollJson.text
              : '';
        }
        if (status === 'failed' || status === 'error') {
          throw new Error(pollJson.error || 'VoiceLab STT failed');
        }
      }

      throw new Error('VoiceLab STT timed out');
    }

    const errText = (await resp.text()).slice(0, 200);
    throw new Error(`VoiceLab STT HTTP ${resp.status}: ${errText}`);
  }

  throw new Error('VoiceLab STT rate limit retries exhausted');
}

export async function transcribeWithUzbekVoice(
  audioBuf: Buffer,
  contentType?: string,
): Promise<string> {
  const apiKey = process.env.UZBEKVOICE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('UZBEKVOICE_API_KEY sozlanmagan');
  }

  const sttUrl = (process.env.UZBEKVOICE_STT_URL || DEFAULT_UZBEKVOICE_STT_URL).trim();
  const fmt = detectAudioFormat(audioBuf, contentType);
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audioBuf)], { type: fmt.mime }), `speech.${fmt.ext}`);
  form.append('language', 'uz');
  form.append('model', 'general');
  form.append('blocking', 'true');
  form.append('return_offsets', 'false');
  form.append('run_diarization', 'false');

  const resp = await fetch(sttUrl, {
    method: 'POST',
    headers: {
      Authorization: apiKey,
    },
    body: form,
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    const errText = (await resp.text()).slice(0, 200);
    throw new Error(`UzbekVoice STT HTTP ${resp.status}: ${errText}`);
  }

  const json = (await resp.json()) as {
    result?: { text?: unknown };
    text?: unknown;
  };
  if (typeof json.result?.text === 'string') {
    return json.result.text;
  }
  if (typeof json.text === 'string') {
    return json.text;
  }
  return '';
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
      const resp = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': options.contentType || fmt.mime,
        },
        body: new Uint8Array(audioBuf),
        signal: AbortSignal.timeout(15_000),
      });

      if (!resp.ok) {
        throw new Error(`Proxy STT HTTP ${resp.status}`);
      }

      const proxyPayload = (await resp.json()) as Record<string, unknown>;
      const transcript =
        typeof proxyPayload.transcript === 'string' ? proxyPayload.transcript : '';
      return {
        transcript,
        provider: 'proxy',
        proxyPayload,
      };
    } catch (err) {
      if (!hasVoiceLab && !hasUzbekVoice) {
        throw err;
      }
    }
  }

  if (hasVoiceLab) {
    try {
      const transcript = await transcribeWithVoiceLab(audioBuf, options.contentType);
      return { transcript, provider: 'voicelab' };
    } catch (err) {
      if (hasUzbekVoice) {
        const transcript = await transcribeWithUzbekVoice(audioBuf, options.contentType);
        return { transcript, provider: 'uzbekvoice' };
      }
      throw err;
    }
  }

  if (hasUzbekVoice) {
    const transcript = await transcribeWithUzbekVoice(audioBuf, options.contentType);
    return { transcript, provider: 'uzbekvoice' };
  }

  throw new Error('STT provayderi sozlanmagan');
}
