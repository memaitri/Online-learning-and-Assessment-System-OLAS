const DEFAULT_SPEECH_THRESHOLD = 500 / 32768;
const DEFAULT_SPIKE_THRESHOLD = 4000 / 32768;
const DEFAULT_SPEECH_TIMEOUT_MS = 3000;
const METER_FLOOR_DBFS = -72;

export function getAudioLevel(rms) {
  const dbfs = rms > 0 ? Math.max(-96, 20 * Math.log10(rms)) : -96;
  const percent = Math.min(100, Math.max(0, ((dbfs - METER_FLOOR_DBFS) / -METER_FLOOR_DBFS) * 100));
  return { dbfs, percent };
}

export class AudioViolationDetector {
  constructor({
    speechThreshold = DEFAULT_SPEECH_THRESHOLD,
    spikeThreshold = DEFAULT_SPIKE_THRESHOLD,
    speechTimeoutMs = DEFAULT_SPEECH_TIMEOUT_MS,
  } = {}) {
    this.speechThreshold = speechThreshold;
    this.spikeThreshold = spikeThreshold;
    this.speechTimeoutMs = speechTimeoutMs;
    this.reset();
  }

  update(rms, now) {
    if (rms >= this.spikeThreshold) {
      const event = this.spikeActive ? null : {
        type: 'audio_noise_spike',
        durationS: 0,
      };
      this.spikeActive = true;
      this.speechStartedAt = null;
      this.speechReported = false;
      return event;
    }

    this.spikeActive = false;
    if (rms >= this.speechThreshold) {
      if (this.speechStartedAt === null) this.speechStartedAt = now;
      const durationMs = now - this.speechStartedAt;
      if (!this.speechReported && durationMs >= this.speechTimeoutMs) {
        this.speechReported = true;
        return {
          type: 'audio_speech_detected',
          durationS: durationMs / 1000,
        };
      }
      return null;
    }

    this.speechStartedAt = null;
    this.speechReported = false;
    return null;
  }

  reset() {
    this.speechStartedAt = null;
    this.speechReported = false;
    this.spikeActive = false;
  }
}
