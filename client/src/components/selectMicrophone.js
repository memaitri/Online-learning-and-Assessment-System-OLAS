const VIRTUAL_INPUT_MARKERS = ['virtual', 'cable', 'loopback', 'stereo mix', 'sound mapper'];

export function isVirtualAudioInput(label = '') {
  const normalizedLabel = label.toLowerCase();
  return VIRTUAL_INPUT_MARKERS.some(marker => normalizedLabel.includes(marker));
}

export async function selectPhysicalMicrophone(mediaDevices, currentTrack) {
  if (!isVirtualAudioInput(currentTrack?.label)) return null;

  const devices = await mediaDevices.enumerateDevices();
  const candidate = devices.find(device =>
    device.kind === 'audioinput'
    && device.deviceId
    && !isVirtualAudioInput(device.label)
    && (/microphone/i.test(device.label) || /\bmic\b/i.test(device.label))
  );

  if (!candidate) {
    throw new Error(
      `The selected input "${currentTrack.label}" is virtual, and no physical microphone was found.`
    );
  }

  let stream;
  try {
    stream = await mediaDevices.getUserMedia({
      audio: { deviceId: { exact: candidate.deviceId } },
      video: false,
    });
  } catch (error) {
    throw new Error(`Could not open "${candidate.label}": ${error.message}`);
  }

  const track = stream.getAudioTracks()[0];
  if (!track || track.readyState !== 'live') {
    stream.getTracks().forEach(item => item.stop());
    throw new Error(`The selected microphone "${candidate.label}" did not start.`);
  }

  return stream;
}
