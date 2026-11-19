import assert from 'node:assert/strict';
import test from 'node:test';
import { isVirtualAudioInput, selectPhysicalMicrophone } from '../src/components/selectMicrophone.js';

test('recognizes virtual cable input and selects a physical microphone', async () => {
  const physicalStream = {
    getAudioTracks: () => [{ label: 'Microphone (Realtek Audio)', readyState: 'live' }],
    getTracks: () => [],
  };
  const mediaDevices = {
    enumerateDevices: async () => [
      { kind: 'audioinput', deviceId: 'virtual', label: 'Line 1 (Virtual Audio Cable)' },
      { kind: 'audioinput', deviceId: 'mic-1', label: 'Microphone (Realtek Audio)' },
    ],
    getUserMedia: async constraints => {
      assert.deepEqual(constraints, {
        audio: { deviceId: { exact: 'mic-1' } },
        video: false,
      });
      return physicalStream;
    },
  };

  assert.equal(isVirtualAudioInput('Default - Line 1 (Virtual Audio Cable)'), true);
  assert.equal(await selectPhysicalMicrophone(mediaDevices, {
    label: 'Default - Line 1 (Virtual Audio Cable)',
  }), physicalStream);
});

test('keeps an already selected physical microphone', async () => {
  const mediaDevices = {
    enumerateDevices: async () => {
      throw new Error('Should not enumerate a physical default');
    },
  };

  assert.equal(await selectPhysicalMicrophone(mediaDevices, {
    label: 'Microphone (Realtek Audio)',
  }), null);
});

test('reports when only virtual inputs are available', async () => {
  const mediaDevices = {
    enumerateDevices: async () => [
      { kind: 'audioinput', deviceId: 'virtual', label: 'Virtual Audio Cable' },
    ],
  };

  await assert.rejects(
    selectPhysicalMicrophone(mediaDevices, { label: 'Virtual Audio Cable' }),
    /no physical microphone was found/
  );
});
