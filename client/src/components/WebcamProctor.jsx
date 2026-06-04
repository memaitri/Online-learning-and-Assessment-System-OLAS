import { useEffect, useRef, useState, useCallback } from 'react';
import { proctoringAPI } from '../services/api';

/**
 * WebcamProctor
 * ─────────────
 * Displays a fixed bottom-right webcam preview and sends frames to the
 * Python proctoring engine every 2 seconds via POST /api/proctoring/frame.
 *
 * Props
 * ─────
 * examId           : string  – Required for the API call.
 * onResult         : fn(result) – Called with each JSON result from Python.
 * disabled         : bool    – Stop capturing when exam is submitted.
 * proctoringReady  : bool    – Only start sending frames once Python is up.
 */
const WebcamProctor = ({ examId, onResult, disabled, proctoringReady }) => {
  const videoRef     = useRef(null);
  const canvasRef    = useRef(null);
  const streamRef    = useRef(null);
  const captureTimer = useRef(null);
  // Use a ref for camStatus so captureAndSend always reads the latest value
  // without needing to be recreated every time camStatus changes.
  const camStatusRef = useRef('requesting');

  const [camStatus, setCamStatus] = useState('requesting');
  const [lastSent,  setLastSent]  = useState(null);
  const [frameCount, setFrameCount] = useState(0);
  const [lastError,  setLastError]  = useState(null);

  // Keep ref in sync with state
  const updateCamStatus = (s) => {
    camStatusRef.current = s;
    setCamStatus(s);
  };

  // ── Start webcam ─────────────────────────────────────────────────────
  const startWebcam = useCallback(async () => {
    console.log('[WebcamProctor] Requesting camera…');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      console.log('[WebcamProctor] Camera active ✓');
      updateCamStatus('active');
    } catch (err) {
      console.error('[WebcamProctor] getUserMedia failed:', err.name, err.message);
      updateCamStatus(err.name === 'NotAllowedError' ? 'denied' : 'error');
    }
  }, []);

  // ── Capture one frame and send it ────────────────────────────────────
  const captureAndSend = useCallback(async () => {
    // Guard: use ref so we always read latest state
    if (disabled)                          return;
    if (camStatusRef.current !== 'active') return;
    if (!proctoringReady)                  return;
    if (!videoRef.current || !canvasRef.current) return;

    const video  = videoRef.current;
    const canvas = canvasRef.current;

    if (video.readyState < 2) {
      console.warn('[WebcamProctor] Video not ready yet (readyState=' + video.readyState + ')');
      return;
    }

    // Capture at native stream resolution (640×480 requested)
    const ctx = canvas.getContext('2d');
    canvas.width  = video.videoWidth  || 640;
    canvas.height = video.videoHeight || 480;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    console.log(`[WebcamProctor] Sending frame (${canvas.width}×${canvas.height}, ${Math.round(dataUrl.length/1024)}KB) to /api/proctoring/frame`);

    try {
      const res = await proctoringAPI.frame(examId, dataUrl);
      console.log('[WebcamProctor] Frame response:', res.data?.success, '| latestResult:', !!res.data?.latestResult);
      setLastSent(new Date().toLocaleTimeString());
      setFrameCount(c => c + 1);
      setLastError(null);
      if (res.data?.latestResult && onResult) {
        console.log('[WebcamProctor] Forwarding result to parent:', res.data.latestResult);
        onResult(res.data.latestResult);
      }
    } catch (err) {
      const msg = err.response?.data?.message || err.message;
      console.error('[WebcamProctor] Frame POST failed:', msg);
      setLastError(msg);
    }
  }, [examId, disabled, proctoringReady, onResult]);

  // ── Mount: start webcam ───────────────────────────────────────────────
  useEffect(() => {
    startWebcam();
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        console.log('[WebcamProctor] Camera stopped.');
      }
      clearInterval(captureTimer.current);
    };
  }, []);

  // ── Start/stop interval when readiness changes ────────────────────────
  // Depends on proctoringReady so we only start sending once Python is up.
  useEffect(() => {
    clearInterval(captureTimer.current);
    captureTimer.current = null;

    if (!disabled && camStatus === 'active' && proctoringReady) {
      console.log('[WebcamProctor] Starting capture interval (proctoringReady=true)');
      captureTimer.current = setInterval(captureAndSend, 2000);
    } else {
      console.log(`[WebcamProctor] Interval NOT started — disabled=${disabled} camStatus=${camStatus} proctoringReady=${proctoringReady}`);
    }

    return () => clearInterval(captureTimer.current);
  }, [disabled, camStatus, proctoringReady, captureAndSend]);

  // ── UI helpers ────────────────────────────────────────────────────────
  const dotColor = {
    requesting: 'bg-yellow-400 animate-pulse',
    active:     'bg-green-400 animate-pulse',
    denied:     'bg-red-500',
    error:      'bg-red-500',
  }[camStatus] ?? 'bg-gray-500';

  const statusLabel = (() => {
    if (camStatus === 'requesting') return 'Starting camera…';
    if (camStatus === 'denied')     return 'Camera denied';
    if (camStatus === 'error')      return 'Camera error';
    if (disabled)                   return 'Camera off';
    if (!proctoringReady)           return 'Waiting for AI…';
    if (lastError)                  return `Error: ${lastError.slice(0, 30)}`;
    if (lastSent)                   return `Frame ${frameCount} · ${lastSent}`;
    return 'Ready';
  })();

  return (
    <div
      style={{ position: 'fixed', bottom: '20px', right: '20px', width: '220px', zIndex: 50 }}
      className="flex flex-col rounded-xl overflow-hidden shadow-2xl border border-gray-600"
    >
      {/* Webcam preview */}
      <div className="relative bg-black" style={{ height: '160px' }}>
        <video
          ref={videoRef}
          muted
          playsInline
          className="w-full h-full object-cover"
          style={{ transform: 'scaleX(-1)' }}
        />

        {camStatus !== 'active' && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-80">
            <span className="text-xs text-gray-400 text-center px-2">
              {camStatus === 'denied'   ? '📷 Camera access denied'
              : camStatus === 'requesting' ? '📷 Starting camera…'
              : '📷 Camera unavailable'}
            </span>
          </div>
        )}

        {camStatus === 'active' && !disabled && (
          <div className="absolute top-2 left-2 flex items-center space-x-1">
            <div className={`w-2 h-2 rounded-full ${proctoringReady ? 'bg-red-500 animate-pulse' : 'bg-yellow-400 animate-pulse'}`} />
            <span className="text-xs text-white font-medium">
              {proctoringReady ? `REC · F${frameCount}` : 'WAIT'}
            </span>
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="bg-gray-900 px-3 py-1.5 flex items-center space-x-2">
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
        <span className={`text-xs truncate ${lastError ? 'text-red-400' : 'text-gray-400'}`}>
          {statusLabel}
        </span>
      </div>

      {/* Hidden canvas for frame capture */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
};

export default WebcamProctor;
