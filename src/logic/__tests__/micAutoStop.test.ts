import { describe, expect, it } from 'vitest';
import { createMicAutoStopState, MIC_AUTO_STOP_CONFIG, stepMicAutoStop } from '../micAutoStop';

describe('adaptive microphone auto-stop logic', () => {
  it('adapts speech threshold to room noise during calibration so background hum does not count as speech', () => {
    let state = createMicAutoStopState();

    // 300 ms noisy room calibration at RMS 0.025 -> adapted threshold ~0.075
    for (const ms of [50, 150, 250]) {
      const step = stepMicAutoStop(state, 0.025, ms);
      state = step.state;
      expect(step.action).toBe('continue');
    }
    expect(state.speechThreshold).toBeCloseTo(0.075, 4);

    // Continued 0.030 room hum after calibration should NOT trigger speechStarted
    const humStep = stepMicAutoStop(state, 0.03, 1000);
    expect(humStep.state.speechStarted).toBe(false);
    expect(humStep.action).toBe('continue');
  });

  it('stops 1350 ms after speech ends once speech started', () => {
    let state = createMicAutoStopState();

    // Quiet calibration
    state = stepMicAutoStop(state, 0.002, 100).state;
    state = stepMicAutoStop(state, 0.002, 200).state;

    // Speech active from 400 ms to 900 ms
    state = stepMicAutoStop(state, 0.12, 400).state;
    state = stepMicAutoStop(state, 0.15, 900).state;
    expect(state.speechStarted).toBe(true);

    // Silence for 1300 ms -> continue
    const beforeStop = stepMicAutoStop(state, 0.003, 900 + MIC_AUTO_STOP_CONFIG.silenceAfterSpeechMs - 50);
    expect(beforeStop.action).toBe('continue');

    // Silence reaches 1350 ms -> stop_silence_after_speech
    const atStop = stepMicAutoStop(beforeStop.state, 0.003, 900 + MIC_AUTO_STOP_CONFIG.silenceAfterSpeechMs);
    expect(atStop.action).toBe('stop_silence_after_speech');
  });

  it('stops at 5000 ms with stop_no_speech if no speech occurs', () => {
    let state = createMicAutoStopState();
    state = stepMicAutoStop(state, 0.002, 100).state;

    const beforeTimeout = stepMicAutoStop(state, 0.002, MIC_AUTO_STOP_CONFIG.noSpeechTimeoutMs - 100);
    expect(beforeTimeout.action).toBe('continue');

    const atTimeout = stepMicAutoStop(beforeTimeout.state, 0.002, MIC_AUTO_STOP_CONFIG.noSpeechTimeoutMs);
    expect(atTimeout.action).toBe('stop_no_speech');
  });

  it('stops at 7000 ms maximum duration even while speech continues', () => {
    let state = createMicAutoStopState();
    state = stepMicAutoStop(state, 0.002, 100).state;
    state = stepMicAutoStop(state, 0.1, 1000).state;

    const beforeMax = stepMicAutoStop(state, 0.1, MIC_AUTO_STOP_CONFIG.maxDurationMs - 100);
    expect(beforeMax.action).toBe('continue');

    const atMax = stepMicAutoStop(beforeMax.state, 0.1, MIC_AUTO_STOP_CONFIG.maxDurationMs);
    expect(atMax.action).toBe('stop_max_duration');
  });
});
