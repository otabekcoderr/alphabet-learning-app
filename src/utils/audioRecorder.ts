import {
  createMicAutoStopState,
  stepMicAutoStop,
  type MicAutoStopAction,
} from '../logic/micAutoStop';

const TARGET_SAMPLE_RATE = 16_000;

let activeAudio: HTMLAudioElement | null = null;

export function playAudioClip(url: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      if (activeAudio) {
        activeAudio.pause();
        activeAudio.currentTime = 0;
      }
      const audio = new Audio(url);
      activeAudio = audio;
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
      void audio.play().catch(() => resolve());
    } catch {
      resolve();
    }
  });
}

export function playFeedbackChime(kind: 'success' | 'tap'): void {
  try {
    const AudioCtx =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const notes = kind === 'success' ? [523.25, 659.25, 783.99] : [440];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.08, now + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 0.2);
    });
    setTimeout(() => void ctx.close(), 600);
  } catch {
    // Ignore audio context restrictions
  }
}

function downsampleTo16k(input: Float32Array, sourceRate: number): Float32Array {
  if (sourceRate === TARGET_SAMPLE_RATE) return input;
  const ratio = sourceRate / TARGET_SAMPLE_RATE;
  const outLength = Math.max(1, Math.round(input.length / ratio));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const s0 = input[idx] ?? 0;
    const s1 = input[Math.min(idx + 1, input.length - 1)] ?? s0;
    out[i] = s0 + (s1 - s0) * frac;
  }
  return out;
}

export function encodeWav16k(samples: Float32Array): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, TARGET_SAMPLE_RATE, true);
  view.setUint32(28, TARGET_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

export interface MicRecordingResult {
  wavBlob: Blob;
  durationMs: number;
}

export interface MicSession {
  stop: () => Promise<MicRecordingResult | null>;
  cancel: () => void;
}

export async function startMicRecording(
  onLevel: (rms: number) => void,
  onAutoStop?: (reason: Exclude<MicAutoStopAction, 'continue'>, result: MicRecordingResult) => void,
): Promise<MicSession> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Brauzerda mikrofon ruxsati qo'llab-quvvatlanmaydi.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
    },
  });

  const AudioCtx =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(2048, 1, 1);
  const chunks: Float32Array[] = [];
  let totalSamples = 0;
  let autoState = createMicAutoStopState();
  const startMs = performance.now();
  let stopped = false;

  const cleanup = () => {
    try {
      processor.disconnect();
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    } catch {
      // Ignore cleanup errors
    }
  };

  const finalize = (): MicRecordingResult => {
    const rate = ctx.sampleRate;
    cleanup();
    const merged = new Float32Array(totalSamples);
    let pos = 0;
    for (const chunk of chunks) {
      merged.set(chunk, pos);
      pos += chunk.length;
    }
    const resampled = downsampleTo16k(merged, rate);
    const wavBlob = encodeWav16k(resampled);
    const durationMs = Math.round((resampled.length / TARGET_SAMPLE_RATE) * 1000);
    return { wavBlob, durationMs };
  };

  processor.onaudioprocess = (event) => {
    if (stopped) return;
    const input = event.inputBuffer.getChannelData(0);
    const copy = new Float32Array(input.length);
    copy.set(input);
    chunks.push(copy);
    totalSamples += copy.length;

    let sumSq = 0;
    for (let i = 0; i < copy.length; i++) {
      const v = copy[i] ?? 0;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / copy.length);
    onLevel(Math.min(1, rms * 6));

    const elapsedMs = performance.now() - startMs;
    const step = stepMicAutoStop(autoState, rms, elapsedMs);
    autoState = step.state;
    if (step.action !== 'continue') {
      stopped = true;
      const result = finalize();
      if (onAutoStop) {
        onAutoStop(step.action, result);
      }
    }
  };

  source.connect(processor);
  processor.connect(ctx.destination);

  return {
    stop: async () => {
      if (stopped) return null;
      stopped = true;
      return finalize();
    },
    cancel: () => {
      if (stopped) return;
      stopped = true;
      cleanup();
    },
  };
}

export interface SttApiResponse {
  ok: boolean;
  transcript: string;
  normalized: string;
  accepted: boolean;
  is_silence: boolean;
  confidence: number;
  latency_ms: number;
  orig_ms: number;
  trimmed_ms: number;
  error?: string;
}

export async function verifyAudioWithStt(
  audioData: Blob,
  expected: string,
  acceptAliases: string[],
): Promise<SttApiResponse> {
  const params = new URLSearchParams({
    expected,
    accept: acceptAliases.join('|'),
  });
  const resp = await fetch(`/api/stt?${params.toString()}`, {
    method: 'POST',
    headers: {
      'Content-Type': audioData.type || 'application/octet-stream',
    },
    body: audioData,
  });

  const json = (await resp.json()) as SttApiResponse;
  if (!resp.ok || !json.ok) {
    throw new Error(json.error || `Server xatosi: ${resp.status}`);
  }
  return json;
}
