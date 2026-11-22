import confetti from 'canvas-confetti';
import { Howl } from 'howler';

export type SfxKind = 'pop' | 'marimba' | 'chime' | 'soft-bonk' | 'celebration';

const SFX_VOLUMES: Record<SfxKind, number> = {
  pop: 0.45,
  marimba: 0.45,
  chime: 0.55,
  'soft-bonk': 0.42,
  celebration: 0.65,
};

const ALIFBO_CONFETTI_COLORS = [
  '#F97316',
  '#059669',
  '#FBBF24',
  '#38BDF8',
  '#EC4899',
  '#A855F7',
];

const howlCache = new Map<SfxKind, Howl>();
const failedHowls = new Set<SfxKind>();

function getOrCreateHowl(kind: SfxKind): Howl | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null;
  }
  if (failedHowls.has(kind)) {
    return null;
  }
  const existing = howlCache.get(kind);
  if (existing) {
    return existing;
  }
  try {
    const howl = new Howl({
      src: [`/audio/sfx/${kind}.wav`],
      volume: SFX_VOLUMES[kind],
      preload: true,
      onloaderror: () => {
        failedHowls.add(kind);
      },
      onplayerror: () => {
        failedHowls.add(kind);
        playSynthFallback(kind);
      },
    });
    howlCache.set(kind, howl);
    return howl;
  } catch {
    failedHowls.add(kind);
    return null;
  }
}

let sharedAudioCtx: AudioContext | null = null;
const cachedNoiseBuffers = new WeakMap<AudioContext, AudioBuffer>();

function getSharedAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;

  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    sharedAudioCtx = new AudioCtx();
  }
  if (sharedAudioCtx.state === 'suspended') {
    void sharedAudioCtx.resume().catch(() => {
      // Ignore autoplay resume errors prior to user interaction
    });
  }
  return sharedAudioCtx;
}

function getNoiseBuffer(ctx: AudioContext): AudioBuffer | null {
  const cached = cachedNoiseBuffers.get(ctx);
  if (cached) return cached;
  if (typeof ctx.createBuffer !== 'function') return null;

  const length = Math.max(1, Math.round(ctx.sampleRate * 0.016));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    const fade = 1 - i / length;
    channel[i] = (Math.random() * 2 - 1) * fade;
  }
  cachedNoiseBuffers.set(ctx, buffer);
  return buffer;
}

function scheduleTactileNoiseTick(
  ctx: AudioContext,
  startAt: number,
  duration = 0.014,
  centerHz = 1400,
  peakGain = 0.045,
): void {
  const buf = getNoiseBuffer(ctx);
  if (!buf || typeof ctx.createBufferSource !== 'function') return;

  const src = ctx.createBufferSource();
  src.buffer = buf;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(centerHz, startAt);
  filter.Q.setValueAtTime(1.8, startAt);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(peakGain, startAt);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  src.start(startAt);
  src.stop(startAt + duration + 0.005);
}

function scheduleTone(
  ctx: AudioContext,
  opts: {
    startAt: number;
    duration: number;
    freqStart: number;
    freqEnd?: number;
    type?: OscillatorType;
    peakGain?: number;
    cutoffHz?: number;
    attackSec?: number;
  },
): void {
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(opts.freqStart, opts.startAt);
  if (opts.freqEnd !== undefined && opts.freqEnd !== opts.freqStart) {
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(40, opts.freqEnd),
      opts.startAt + opts.duration * 0.85,
    );
  }

  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(opts.cutoffHz ?? 2600, opts.startAt);

  const peak = opts.peakGain ?? 0.09;
  const attackEnd = opts.startAt + (opts.attackSec ?? Math.min(0.012, opts.duration * 0.2));
  gain.gain.setValueAtTime(0.0001, opts.startAt);
  gain.gain.exponentialRampToValueAtTime(peak, attackEnd);
  gain.gain.exponentialRampToValueAtTime(0.0001, opts.startAt + opts.duration);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  osc.start(opts.startAt);
  osc.stop(opts.startAt + opts.duration + 0.02);
}

function playSynthFallback(kind: SfxKind): void {
  try {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime + 0.004;

    if (kind === 'pop') {
      scheduleTactileNoiseTick(ctx, now, 0.014, 1400, 0.045);
      scheduleTone(ctx, {
        startAt: now,
        duration: 0.038,
        freqStart: 520,
        freqEnd: 290,
        type: 'sine',
        peakGain: 0.065,
        cutoffHz: 1600,
        attackSec: 0.003,
      });
      return;
    }

    if (kind === 'marimba') {
      scheduleTone(ctx, {
        startAt: now,
        duration: 0.095,
        freqStart: 659.25,
        type: 'sine',
        peakGain: 0.06,
        cutoffHz: 1900,
        attackSec: 0.005,
      });
      scheduleTone(ctx, {
        startAt: now,
        duration: 0.045,
        freqStart: 1318.5,
        type: 'sine',
        peakGain: 0.016,
        cutoffHz: 2400,
        attackSec: 0.004,
      });
      return;
    }

    if (kind === 'chime') {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, idx) => {
        scheduleTone(ctx, {
          startAt: now + idx * 0.065,
          duration: 0.24,
          freqStart: freq,
          type: 'triangle',
          peakGain: 0.075,
          cutoffHz: 3200,
        });
      });
      return;
    }

    if (kind === 'soft-bonk') {
      scheduleTone(ctx, {
        startAt: now,
        duration: 0.16,
        freqStart: 310,
        freqEnd: 215,
        type: 'triangle',
        peakGain: 0.07,
        cutoffHz: 900,
      });
      return;
    }

    const fanfareLead = [
      { offset: 0.0, freq: 523.25, dur: 0.14 },
      { offset: 0.11, freq: 659.25, dur: 0.14 },
      { offset: 0.22, freq: 783.99, dur: 0.16 },
      { offset: 0.42, freq: 1046.5, dur: 0.48 },
    ];
    for (const note of fanfareLead) {
      scheduleTone(ctx, {
        startAt: now + note.offset,
        duration: note.dur,
        freqStart: note.freq,
        type: 'triangle',
        peakGain: 0.085,
        cutoffHz: 3400,
      });
    }
    for (const harm of [523.25, 659.25, 783.99]) {
      scheduleTone(ctx, {
        startAt: now + 0.42,
        duration: 0.48,
        freqStart: harm,
        type: 'sine',
        peakGain: 0.045,
        cutoffHz: 2600,
      });
    }
    [1318.51, 1567.98].forEach((freq, idx) => {
      scheduleTone(ctx, {
        startAt: now + 0.68 + idx * 0.09,
        duration: 0.22,
        freqStart: freq,
        type: 'sine',
        peakGain: 0.038,
        cutoffHz: 3800,
      });
    });
  } catch {
    // Ignore Web Audio restrictions in headless environments
  }
}

/**
 * Play crisp, warm children's game sound effects powered by Howler.js
 * with seamless Web Audio synthesis fallback and safe no-op execution in Node.
 */
export function playSfx(kind: SfxKind): void {
  try {
    const howl = getOrCreateHowl(kind);
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      (['pop', 'marimba', 'chime', 'soft-bonk', 'celebration'] as const).forEach((k) => {
        if (k !== kind) {
          getOrCreateHowl(k);
        }
      });
    }
    if (howl && howl.state() === 'loaded') {
      howl.play();
      return;
    }
    if (howl && howl.state() === 'loading') {
      // Trigger Howl load; play synthesized fallback immediately for zero-latency click feedback
      playSynthFallback(kind);
      return;
    }
    playSynthFallback(kind);
  } catch {
    // Ignore audio failures in headless/Node environments
  }
}

function launchConfettiSafe(options: confetti.Options): void {
  try {
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      void confetti({
        colors: ALIFBO_CONFETTI_COLORS,
        disableForReducedMotion: true,
        ...options,
      });
    }
  } catch {
    // Ignore canvas confetti failures in headless environments
  }
}

/**
 * Trigger confetti and celebratory Howler fanfare on the exact same frame/tick
 * so visual particle burst and victory audio feel tightly synchronized.
 */
export function triggerCelebrationBurst(variant: 'word' | 'round'): void {
  const fire = () => {
    if (variant === 'round') {
      playSfx('celebration');
      launchConfettiSafe({
        particleCount: 60,
        angle: 60,
        spread: 60,
        origin: { x: 0.14, y: 0.72 },
      });
      launchConfettiSafe({
        particleCount: 60,
        angle: 120,
        spread: 60,
        origin: { x: 0.86, y: 0.72 },
      });
      launchConfettiSafe({
        particleCount: 50,
        spread: 80,
        origin: { x: 0.5, y: 0.58 },
      });
      if (typeof window !== 'undefined') {
        window.setTimeout(() => {
          launchConfettiSafe({
            particleCount: 55,
            spread: 95,
            startVelocity: 34,
            origin: { x: 0.5, y: 0.45 },
          });
        }, 400);
      }
    } else {
      playSfx('chime');
      launchConfettiSafe({
        particleCount: 48,
        spread: 68,
        origin: { y: 0.65 },
      });
    }
  };

  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => fire());
  } else {
    fire();
  }
}
