import { useEffect, useRef, useState } from 'react';
import { AudioViolationDetector, getAudioLevel } from './audioViolationDetector';
const SAMPLE_INTERVAL_MS = 100;
const METER_FLOOR_DBFS = -72;

const AudioProctor = ({ stream, audioContext, disabled, onViolation }) => {
  const [status, setStatus] = useState('starting');
  const [level, setLevel] = useState({ rms: 0, dbfs: -96, percent: 0 });
  const [deviceName, setDeviceName] = useState('Default microphone');
  const onViolationRef = useRef(onViolation);
  const disabledRef = useRef(disabled);

  useEffect(() => {
    onViolationRef.current = onViolation;
  }, [onViolation]);

  useEffect(() => {
    disabledRef.current = disabled;
    if (disabled) {
      setStatus('stopped');
      setLevel({ rms: 0, dbfs: -96, percent: 0 });
    } else if (audioContext?.state === 'running') {
      setStatus('active');
    }
  }, [disabled, audioContext]);

  useEffect(() => {
    const track = stream?.getAudioTracks()[0];
    if (!track || track.readyState !== 'live' || !audioContext) {
      setStatus('unavailable');
      return undefined;
    }
    setDeviceName(track.label || 'Microphone');

    let intervalId;
    let disposed = false;
    let source;
    let analyser;
    const detector = new AudioViolationDetector();

    try {
      source = audioContext.createMediaStreamSource(stream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
    } catch (error) {
      console.error('[AudioProctor] Could not initialize microphone analysis:', error);
      setStatus('error');
      return undefined;
    }

    if (audioContext.state !== 'running') {
      setStatus('error');
      console.error('[AudioProctor] Audio context is not running:', audioContext.state);
      source.disconnect();
      return undefined;
    }

    const samples = new Float32Array(analyser.fftSize);
    const reportViolation = (type, rms, durationS) => {
      Promise.resolve(onViolationRef.current?.(type, {
        rmsLevel: Math.round(rms * 32768),
        durationS,
      })).catch((error) => {
        console.error('[AudioProctor] Failed to report audio event:', error);
      });
    };

    const sampleAudio = () => {
      if (disposed || disabledRef.current || audioContext.state !== 'running') return;

      analyser.getFloatTimeDomainData(samples);
      let sumSquares = 0;
      for (const sample of samples) sumSquares += sample * sample;
      const rms = Math.sqrt(sumSquares / samples.length);
      const measuredLevel = getAudioLevel(rms);
      setLevel({
        rms: Math.round(rms * 32768),
        dbfs: measuredLevel.dbfs,
        percent: measuredLevel.percent,
      });

      const event = detector.update(rms, performance.now());
      if (event) reportViolation(event.type, rms, event.durationS);
    };

    const handleTrackEnded = () => setStatus('unavailable');
    const handleContextStateChange = () => {
      setStatus(disabledRef.current
        ? 'stopped'
        : audioContext.state === 'running' ? 'active' : 'error');
    };
    track.addEventListener('ended', handleTrackEnded);
    audioContext.addEventListener('statechange', handleContextStateChange);
    setStatus('active');
    intervalId = window.setInterval(sampleAudio, SAMPLE_INTERVAL_MS);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      track.removeEventListener('ended', handleTrackEnded);
      audioContext.removeEventListener('statechange', handleContextStateChange);
      source.disconnect();
      analyser.disconnect();
    };
  }, [stream, audioContext]);

  const statusText = {
    starting: 'Starting microphone…',
    active: 'Microphone monitoring active',
    unavailable: 'Microphone unavailable',
    error: 'Microphone monitor error',
    stopped: 'Microphone monitoring stopped',
  }[status] || 'Microphone status unknown';
  const statusColor = status === 'active'
    ? 'bg-green-400'
    : status === 'starting' ? 'bg-yellow-400' : 'bg-red-400';
  const speechThresholdDbfs = 20 * Math.log10(500 / 32768);
  const spikeThresholdDbfs = 20 * Math.log10(4000 / 32768);
  const thresholdPosition = dbfs => Math.min(
    100,
    Math.max(0, ((dbfs - METER_FLOOR_DBFS) / -METER_FLOOR_DBFS) * 100)
  );
  const meterColor = level.rms >= 4000
    ? 'bg-red-400'
    : level.rms >= 500 ? 'bg-yellow-400' : 'bg-green-400';

  return (
    <div className="fixed bottom-[230px] right-5 z-50 w-[220px] rounded-xl border border-gray-600 bg-gray-900 px-3 py-2 shadow-xl">
      <div className="flex items-center gap-2">
        <div className={`h-2 w-2 flex-shrink-0 rounded-full ${statusColor} ${status === 'starting' ? 'animate-pulse' : ''}`} />
        <span className="truncate text-xs text-gray-200">{statusText}</span>
      </div>
      <div className="relative mt-2 h-2 overflow-hidden rounded bg-gray-700" title="Meter scale: -72 to 0 dBFS">
        <div
          className={`h-full transition-all ${status === 'active' ? meterColor : 'bg-gray-500'}`}
          style={{ width: `${level.percent}%` }}
        />
        <div
          className="absolute inset-y-0 w-px bg-yellow-200"
          style={{ left: `${thresholdPosition(speechThresholdDbfs)}%` }}
          title="Speech threshold"
        />
        <div
          className="absolute inset-y-0 w-px bg-red-200"
          style={{ left: `${thresholdPosition(spikeThresholdDbfs)}%` }}
          title="Noise spike threshold"
        />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-gray-400">
        <span>RMS {level.rms}</span>
        <span>{level.dbfs.toFixed(1)} dBFS</span>
      </div>
      <div className="mt-1 flex justify-between text-[9px] text-gray-500">
        <span>Speech {speechThresholdDbfs.toFixed(0)} dBFS</span>
        <span>Spike {spikeThresholdDbfs.toFixed(0)} dBFS</span>
      </div>
      <p className="mt-1 truncate text-[9px] text-gray-500" title={deviceName}>
        Input: {deviceName}
      </p>
    </div>
  );
};

export default AudioProctor;
