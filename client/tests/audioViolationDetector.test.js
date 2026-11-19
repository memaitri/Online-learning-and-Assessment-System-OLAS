import assert from 'node:assert/strict';
import test from 'node:test';
import { AudioViolationDetector, getAudioLevel } from '../src/components/audioViolationDetector.js';

test('reports a readable dBFS level and a visible meter value for non-silent input', () => {
  assert.deepEqual(getAudioLevel(0), { dbfs: -96, percent: 0 });

  const level = getAudioLevel(0.1);
  assert.equal(level.dbfs, -20);
  assert.ok(level.percent > 70);
});

test('reports sustained speech once until the sound returns below threshold', () => {
  const detector = new AudioViolationDetector({
    speechThreshold: 0.1,
    spikeThreshold: 0.5,
    speechTimeoutMs: 3000,
  });

  assert.equal(detector.update(0.11, 0), null);
  assert.equal(detector.update(0.11, 2999), null);
  assert.deepEqual(detector.update(0.11, 3000), {
    type: 'audio_speech_detected',
    durationS: 3,
  });
  assert.equal(detector.update(0.11, 4000), null);
  assert.equal(detector.update(0, 4100), null);
  assert.equal(detector.update(0.11, 5000), null);
  assert.deepEqual(detector.update(0.11, 8000), {
    type: 'audio_speech_detected',
    durationS: 3,
  });
});

test('reports only the start of each distinct noise spike', () => {
  const detector = new AudioViolationDetector({
    speechThreshold: 0.1,
    spikeThreshold: 0.5,
  });

  assert.deepEqual(detector.update(0.6, 0), {
    type: 'audio_noise_spike',
    durationS: 0,
  });
  assert.equal(detector.update(0.7, 100), null);
  assert.equal(detector.update(0.1, 200), null);
  assert.deepEqual(detector.update(0.6, 300), {
    type: 'audio_noise_spike',
    durationS: 0,
  });
});
