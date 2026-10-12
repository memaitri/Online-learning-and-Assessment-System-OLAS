import { useEffect, useRef, useState } from 'react';
import { violationAPI, proctoringAPI } from '../services/api';
import toast from 'react-hot-toast';

const RISK_COLORS = {
  SAFE:     { bg: 'bg-green-900',  border: 'border-green-500',  text: 'text-green-400',  dot: 'bg-green-500',  badge: 'bg-green-700'  },
  LOW:      { bg: 'bg-teal-900',   border: 'border-teal-500',   text: 'text-teal-400',   dot: 'bg-teal-500',   badge: 'bg-teal-700'   },
  MEDIUM:   { bg: 'bg-yellow-900', border: 'border-yellow-500', text: 'text-yellow-400', dot: 'bg-yellow-500', badge: 'bg-yellow-700' },
  HIGH:     { bg: 'bg-orange-900', border: 'border-orange-500', text: 'text-orange-400', dot: 'bg-orange-500', badge: 'bg-orange-700' },
  CRITICAL: { bg: 'bg-red-900',    border: 'border-red-500',    text: 'text-red-400',    dot: 'bg-red-500',    badge: 'bg-red-700'    },
};

// Maps raw gaze/head direction from Python to a human label + icon
function describeDirection(gaze, head) {
  const g = (gaze || '').toUpperCase();
  const h = (head || '').toUpperCase();
  if (g === 'LEFT'  || h === 'LEFT')  return { icon: '👈', text: 'Looking Left' };
  if (g === 'RIGHT' || h === 'RIGHT') return { icon: '👉', text: 'Looking Right' };
  if (g === 'UP'    || h === 'UP')    return { icon: '👆', text: 'Looking Up' };
  if (g === 'DOWN'  || h === 'DOWN')  return { icon: '👇', text: 'Looking Down' };
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// useAudioProctor — browser-side microphone monitoring hook
// Runs entirely in the browser, no Python needed.
// Returns: { rmsLevel, isSpeech, audioViolations, micStatus }
// ─────────────────────────────────────────────────────────────────────────────
function useAudioProctor({ enabled, onViolation, rmsThreshold = 500, spikeThreshold = 4000, speechTimeout = 3.0 }) {
  const [micStatus,       setMicStatus]       = useState('idle');   // idle | active | denied | error
  const [rmsLevel,        setRmsLevel]        = useState(0);
  const [isSpeech,        setIsSpeech]        = useState(false);
  const [audioViolations, setAudioViolations] = useState(0);
  const [alertType,       setAlertType]       = useState(null);     // null | 'TALKING' | 'NOISE_SPIKE'

  const audioCtxRef    = useRef(null);
  const analyserRef    = useRef(null);
  const streamRef      = useRef(null);
  const rafRef         = useRef(null);
  const speechStartRef = useRef(null);  // timestamp when speech episode started
  const violFiredRef   = useRef(false); // prevent re-firing within same episode
  const spikeFiredRef  = useRef(false);
  const violCountRef   = useRef(0);
  const mountedRef     = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) return;

    let ctx, analyser, source;

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        if (!mountedRef.current) { stream.getTracks().forEach(t => t.stop()); return; }

        streamRef.current = stream;
        ctx      = new (window.AudioContext || window.webkitAudioContext)();
        analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        source   = ctx.createMediaStreamSource(stream);
        source.connect(analyser);
        audioCtxRef.current  = ctx;
        analyserRef.current  = analyser;
        setMicStatus('active');

        const buf = new Float32Array(analyser.fftSize);

        const tick = () => {
          if (!mountedRef.current) return;
          rafRef.current = requestAnimationFrame(tick);

          analyser.getFloatTimeDomainData(buf);
          // RMS in range 0..1 (Float32 audio), scale to 0..32768 to match Python
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          const rmsNorm = Math.sqrt(sum / buf.length);
          const rms = rmsNorm * 32768;

          setRmsLevel(Math.round(rms));
          const speech = rms >= rmsThreshold;
          const spike  = rms >= spikeThreshold;
          setIsSpeech(speech || spike);

          const now = Date.now();

          // ── Spike: instant violation ──────────────────────────────
          if (spike) {
            if (!spikeFiredRef.current) {
              spikeFiredRef.current = true;
              violCountRef.current += 1;
              setAudioViolations(violCountRef.current);
              setAlertType('NOISE_SPIKE');
              if (onViolation) onViolation('NOISE_SPIKE', rms, 0);
              setTimeout(() => { spikeFiredRef.current = false; }, 2000);
            }
            speechStartRef.current = null;
            violFiredRef.current   = false;
            return;
          }
          spikeFiredRef.current = false;

          // ── Sustained speech ──────────────────────────────────────
          if (speech) {
            if (!speechStartRef.current) {
              speechStartRef.current = now;
              violFiredRef.current   = false;
            }
            const dur = (now - speechStartRef.current) / 1000;
            if (dur >= speechTimeout && !violFiredRef.current) {
              violFiredRef.current = true;
              violCountRef.current += 1;
              setAudioViolations(violCountRef.current);
              setAlertType('TALKING');
              if (onViolation) onViolation('TALKING', rms, dur);
            }
          } else {
            // Reset episode
            speechStartRef.current = null;
            violFiredRef.current   = false;
            if (alertType === 'TALKING') setAlertType(null);
          }
        };

        rafRef.current = requestAnimationFrame(tick);
      } catch (err) {
        if (!mountedRef.current) return;
        setMicStatus(err.name === 'NotAllowedError' ? 'denied' : 'error');
      }
    };

    start();

    return () => {
      mountedRef.current = false;
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
      ctx?.close().catch(() => {});
    };
  }, [enabled]);

  return { rmsLevel, isSpeech, audioViolations, micStatus, alertType };
}

const ProctoringSystem = ({
  sessionId, examId, onViolation, onBlock, socket, disabled, riskData,
  inline = false,
}) => {
  const [browserViolations, setBrowserViolations] = useState(0);
  const [lastEvent, setLastEvent]  = useState(null);
  // ── Fullscreen overlay state ─────────────────────────────────────────
  const [showFsOverlay, setShowFsOverlay] = useState(false);
  const isMountedRef     = useRef(true);
  const isInitializedRef = useRef(false);

  const score    = riskData?.riskScore       ?? 0;
  const level    = riskData?.riskLevel       ?? 'SAFE';
  const aiTotal  = riskData?.totalViolations ?? 0;
  const colors   = RISK_COLORS[level] || RISK_COLORS.SAFE;
  const aiActive = riskData?.status === 'running';
  const faceCount= riskData?.faceCount       ?? -1;

  // ── Browser-side audio proctoring ────────────────────────────────────
  const { rmsLevel, isSpeech, audioViolations: browserAudioViolations,
          micStatus, alertType } = useAudioProctor({
    enabled: !disabled,
    onViolation: (type, rms, dur) => {
      const desc = type === 'NOISE_SPIKE'
        ? 'Loud noise/spike detected'
        : `Talking detected (${dur.toFixed(1)}s)`;
      toast.error(`🎤 ${desc}`);
      // Report as a browser violation so it reaches DB + Python risk engine
      reportViolation('audio_violation', desc, 'high');
    },
    rmsThreshold:  500,
    spikeThreshold: 4000,
    speechTimeout:  3.0,
  });

  // ── Derive last live event ────────────────────────────────────────────
  useEffect(() => {
    if (!riskData) return;
    const { gazeDirection, headDirection, faceCount, phoneDetections } = riskData;
    let event = null;
    if (faceCount === 0) {
      event = { icon: '🚫', text: 'No person detected', color: 'text-red-400' };
    } else if (faceCount >= 2) {
      event = { icon: '👥', text: `${faceCount} people in frame`, color: 'text-red-400' };
    } else if (phoneDetections > 0) {
      event = { icon: '📱', text: 'Phone detected!', color: 'text-red-400' };
    } else {
      const dir = describeDirection(gazeDirection, headDirection);
      if (dir) event = { ...dir, color: 'text-yellow-400' };
      else     event = { icon: '✅', text: 'Looking at screen', color: 'text-green-400' };
    }
    if (event) setLastEvent({ ...event, ts: new Date().toLocaleTimeString() });
  }, [riskData]);

  // ── Event listeners setup ─────────────────────────────────────────────
  useEffect(() => {
    isMountedRef.current     = true;
    isInitializedRef.current = false;
    let cleanup = null;
    const t = setTimeout(() => {
      if (isMountedRef.current) {
        cleanup = setupEventListeners();
        isInitializedRef.current = true;
      }
    }, 2000);
    return () => {
      isMountedRef.current = false;
      isInitializedRef.current = false;
      clearTimeout(t);
      if (cleanup) cleanup();
    };
  }, []);

  const reEnterFullscreen = () => {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen;
    if (req) {
      req.call(el).then(() => setShowFsOverlay(false)).catch(() => {});
    }
  };

  const setupEventListeners = () => {
    const h = {};
    const fire = (type, desc, sev = 'medium') => reportViolation(type, desc, sev);

    h.vis  = () => { if (document.hidden && isMountedRef.current && isInitializedRef.current) fire('tab_switch','Switched tabs','high'); };
    h.blur = () => { if (isMountedRef.current && isInitializedRef.current) fire('window_blur','Switched window','high'); };

    // ── Fullscreen exit: show overlay + try auto re-entry ────────────
    h.fs = () => {
      const isFS = !!(document.fullscreenElement || document.webkitFullscreenElement);
      if (!isFS && isMountedRef.current && isInitializedRef.current) {
        fire('exit_fullscreen', 'Exited fullscreen', 'high');
        setShowFsOverlay(true);
        // Try immediate auto re-entry (works for accidental Esc on some browsers)
        const el = document.documentElement;
        const req = el.requestFullscreen || el.webkitRequestFullscreen;
        req?.call(el)
          .then(() => { if (isMountedRef.current) setShowFsOverlay(false); })
          .catch(() => { /* needs user gesture — overlay button handles it */ });
      }
      // If fullscreen was RE-entered (e.g. user clicked our button), hide overlay
      if (isFS && isMountedRef.current) {
        setShowFsOverlay(false);
      }
    };

    h.ctx  = e => { if (isMountedRef.current && isInitializedRef.current) { e.preventDefault(); fire('right_click','Right-click attempt','medium'); } };
    h.copy = e => { if (isMountedRef.current && isInitializedRef.current) { e.preventDefault(); fire('copy_attempt','Copy attempt','high'); } };
    h.paste= e => { if (isMountedRef.current && isInitializedRef.current) { e.preventDefault(); fire('paste_attempt','Paste attempt','high'); } };
    h.cut  = e => { if (isMountedRef.current && isInitializedRef.current) { e.preventDefault(); fire('cut_attempt','Cut attempt','high'); } };
    h.key  = e => {
      if (!isMountedRef.current || !isInitializedRef.current) return;
      if (e.ctrlKey || e.metaKey) {
        if (['c','C'].includes(e.key)) { e.preventDefault(); fire('keyboard_shortcut','Ctrl+C blocked','high'); }
        if (['v','V'].includes(e.key)) { e.preventDefault(); fire('keyboard_shortcut','Ctrl+V blocked','high'); }
        if (['x','X'].includes(e.key)) { e.preventDefault(); fire('keyboard_shortcut','Ctrl+X blocked','high'); }
        if (e.key==='F12'||(e.shiftKey&&['I','J','C'].includes(e.key))) { e.preventDefault(); fire('devtools_attempt','DevTools attempt','high'); }
      }
      if (e.key==='F12') { e.preventDefault(); fire('devtools_attempt','DevTools attempt','high'); }
    };
    h.unload = e => { if (isMountedRef.current && isInitializedRef.current) { e.preventDefault(); fire('page_refresh','Refresh attempt','high'); e.returnValue=''; } };
    h.offline= () => { if (isMountedRef.current && isInitializedRef.current) fire('network_disconnect','Network lost','high'); };
    h.online = () => { if (isMountedRef.current && isInitializedRef.current) toast.success('Network restored'); };
    h.dtInt  = setInterval(() => {
      if (!isMountedRef.current || !isInitializedRef.current) return;
      if (window.outerWidth - window.innerWidth > 160 || window.outerHeight - window.innerHeight > 160)
        fire('devtools_open','DevTools detected','high');
    }, 1000);

    document.addEventListener('visibilitychange', h.vis);
    window.addEventListener('blur', h.blur);
    document.addEventListener('fullscreenchange', h.fs);
    document.addEventListener('webkitfullscreenchange', h.fs);
    document.addEventListener('contextmenu', h.ctx);
    document.addEventListener('copy', h.copy);
    document.addEventListener('paste', h.paste);
    document.addEventListener('cut', h.cut);
    document.addEventListener('keydown', h.key);
    window.addEventListener('beforeunload', h.unload);
    window.addEventListener('offline', h.offline);
    window.addEventListener('online', h.online);

    return () => {
      document.removeEventListener('visibilitychange', h.vis);
      window.removeEventListener('blur', h.blur);
      document.removeEventListener('fullscreenchange', h.fs);
      document.removeEventListener('webkitfullscreenchange', h.fs);
      document.removeEventListener('contextmenu', h.ctx);
      document.removeEventListener('copy', h.copy);
      document.removeEventListener('paste', h.paste);
      document.removeEventListener('cut', h.cut);
      document.removeEventListener('keydown', h.key);
      window.removeEventListener('beforeunload', h.unload);
      window.removeEventListener('offline', h.offline);
      window.removeEventListener('online', h.online);
      clearInterval(h.dtInt);
    };
  };

  const reportViolation = async (type, description, severity = 'medium') => {
    if (disabled || !isMountedRef.current || !isInitializedRef.current) return;
    try {
      const response = await violationAPI.create({ sessionId, type, description, severity });
      const newCount = response.data.violationCount;
      setBrowserViolations(newCount);
      try { await proctoringAPI.violation(examId, type); } catch { /* non-fatal */ }
      if (socket) socket.emit('violation-detected', { examId, sessionId, type, description, severity, count: newCount });
      toast.error(`⚠️ ${description}`);
      if (onViolation) onViolation(newCount);
      if (response.data.blocked) { toast.error('Blocked due to excessive violations!'); if (onBlock) onBlock(); }
    } catch (err) { console.error('Error reporting violation:', err); }
  };

  // ── Fullscreen blocking overlay ───────────────────────────────────────
  const FullscreenOverlay = () => (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center"
      style={{ zIndex: 999999, background: 'rgba(0,0,0,0.97)', backdropFilter: 'blur(8px)' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-center max-w-md px-8">
        <div className="text-7xl mb-6">⚠️</div>
        <h1 className="text-3xl font-bold text-red-400 mb-3">Fullscreen Required</h1>
        <p className="text-gray-300 mb-2 text-lg">
          You exited fullscreen mode during the exam.
        </p>
        <p className="text-gray-400 text-sm mb-2">
          This has been recorded as a violation. You must return to fullscreen to continue.
        </p>
        <p className="text-gray-500 text-xs mb-8">
          Repeated fullscreen exits may result in automatic submission.
        </p>
        <button
          onClick={() => {
            const el = document.documentElement;
            const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen;
            if (req) {
              req.call(el)
                .then(() => setShowFsOverlay(false))
                .catch(() => toast.error('Please click the button to re-enter fullscreen'));
            }
          }}
          className="bg-red-600 hover:bg-red-500 active:bg-red-700 text-white text-xl font-bold px-12 py-4 rounded-2xl transition-all shadow-2xl hover:scale-105 active:scale-95 cursor-pointer"
          style={{ pointerEvents: 'auto' }}
        >
          🖥️ Return to Fullscreen
        </button>
      </div>
    </div>
  );

  // Derive mic level bar width (0–100%)
  const micBarPct = Math.min((rmsLevel / 4000) * 100, 100);
  const micColor  = alertType === 'NOISE_SPIKE' ? 'bg-red-500'
                  : alertType === 'TALKING'      ? 'bg-red-400'
                  : isSpeech                     ? 'bg-yellow-400'
                  : 'bg-green-500';
  const micLabel  = alertType === 'NOISE_SPIKE' ? '🎤 SPIKE!'
                  : alertType === 'TALKING'      ? '🎤 TALKING!'
                  : isSpeech                     ? '🎤 Speech…'
                  : micStatus === 'denied'        ? '🎤 Mic denied'
                  : micStatus === 'error'         ? '🎤 Mic error'
                  : micStatus === 'idle'          ? '🎤 Starting…'
                  : '🎤 Quiet';

  // ── Inline chip ───────────────────────────────────────────────────────
  if (inline) {
    return (
      <>
        {showFsOverlay && <FullscreenOverlay />}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 bg-gray-700 border border-gray-600 rounded-lg px-2.5 py-1">
            <div className={`w-2 h-2 rounded-full ${browserViolations === 0 ? 'bg-green-500' : browserViolations < 3 ? 'bg-yellow-500' : 'bg-red-500'}`} />
            <span className="text-xs text-white font-semibold">Browser: {browserViolations}</span>
          </div>
          {riskData && (
            <div className={`flex items-center gap-1.5 ${colors.bg} border ${colors.border} rounded-lg px-2.5 py-1`}>
              <div className={`w-2 h-2 rounded-full ${colors.dot} ${aiActive ? 'animate-pulse' : ''}`} />
              <span className="text-xs text-white font-bold">AI:</span>
              <span className={`text-xs font-bold ${colors.text}`}>{level}</span>
              <span className="text-xs text-gray-300">{score.toFixed(0)}/100</span>
            </div>
          )}
        </div>
      </>
    );
  }

  // ── Full panel ────────────────────────────────────────────────────────
  return (
    <>
      {/* Fullscreen blocking overlay */}
      {showFsOverlay && <FullscreenOverlay />}

      <div className="fixed bottom-4 left-4 z-50 w-60 flex flex-col gap-2">

        {/* Panel 1 — Browser proctoring status */}
        <div className="bg-gray-800 border border-gray-600 rounded-xl shadow-xl px-3 py-2.5 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-gray-300 uppercase tracking-wide">Browser Guard</span>
            <div className={`w-2 h-2 rounded-full ${disabled ? 'bg-gray-500' : 'bg-blue-400 animate-pulse'}`} />
          </div>
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${browserViolations === 0 ? 'bg-green-500' : browserViolations < 3 ? 'bg-yellow-500' : 'bg-red-500'}`} />
            <span className="text-xs text-white">
              {browserViolations === 0 ? 'No violations' : `${browserViolations} violation${browserViolations > 1 ? 's' : ''} detected`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${disabled ? 'bg-gray-500' : 'bg-blue-400'}`} />
            <span className="text-xs text-gray-400">{disabled ? 'Proctoring ended' : 'Monitoring active'}</span>
          </div>

          {/* ── Audio monitor row ── */}
          {!disabled && (
            <div className="border-t border-gray-700 pt-1.5">
              <div className="flex items-center justify-between mb-1">
                <span className={`text-xs font-semibold ${alertType ? 'text-red-400' : isSpeech ? 'text-yellow-400' : 'text-gray-400'}`}>
                  {micLabel}
                </span>
                {browserAudioViolations > 0 && (
                  <span className="text-xs text-red-400 font-bold">{browserAudioViolations}×</span>
                )}
              </div>
              {/* Mic level bar */}
              <div className="w-full bg-gray-700 rounded-full h-1.5 relative overflow-hidden">
                <div
                  className={`h-1.5 rounded-full transition-all duration-100 ${micColor}`}
                  style={{ width: `${micBarPct}%` }}
                />
                {/* Threshold marker at 500/4000 = 12.5% */}
                <div className="absolute top-0 bottom-0 w-px bg-yellow-400 opacity-60" style={{ left: '12.5%' }} />
              </div>
            </div>
          )}
        </div>

        {/* Panel 2 — AI Proctoring live feed */}
        {riskData && (
          <div className={`${colors.bg} border ${colors.border} rounded-xl shadow-xl px-3 py-2.5 space-y-2`}>

            {/* Header row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <div className={`w-2.5 h-2.5 rounded-full ${colors.dot} ${aiActive ? 'animate-pulse' : ''}`} />
                <span className="text-xs font-bold text-white">AI Proctoring</span>
              </div>
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${colors.badge} ${colors.text}`}>{level}</span>
            </div>

            {/* Risk score bar */}
            <div>
              <div className="flex justify-between text-xs mb-0.5">
                <span className="text-gray-400">Risk Score</span>
                <span className={`font-bold ${colors.text}`}>{score.toFixed(1)} / 100</span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-2">
                <div className={`h-2 rounded-full transition-all duration-700 ${colors.dot}`}
                  style={{ width: `${Math.min(score, 100)}%` }} />
              </div>
            </div>

            {/* Live detection feed */}
            <div className="border-t border-gray-700 pt-2">
              <p className="text-xs text-gray-400 font-semibold mb-1.5 uppercase tracking-wide">Live Detection</p>
              {lastEvent && (
                <div className="flex items-center gap-2 bg-gray-900 rounded-lg px-2.5 py-1.5 mb-2">
                  <span className="text-base">{lastEvent.icon}</span>
                  <div>
                    <p className={`text-xs font-bold ${lastEvent.color}`}>{lastEvent.text}</p>
                    <p className="text-xs text-gray-500">{lastEvent.ts}</p>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2 mb-1">
                {faceCount === 0
                  ? <span className="text-xs text-red-400">🚫 No person in frame</span>
                  : faceCount === 1
                    ? <span className="text-xs text-green-400">👤 1 person detected</span>
                    : faceCount >= 2
                      ? <span className="text-xs text-red-400 font-bold">👥 {faceCount} people in frame!</span>
                      : <span className="text-xs text-gray-500">👁 Waiting for frame…</span>
                }
              </div>
              {riskData.gazeDirection && riskData.gazeDirection !== 'UNKNOWN' && (
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-gray-300">
                    Eyes: {' '}
                    {riskData.gazeDirection === 'CENTER' && <span className="text-green-400">Center ✓</span>}
                    {riskData.gazeDirection === 'LEFT'   && <span className="text-yellow-400">👈 Left</span>}
                    {riskData.gazeDirection === 'RIGHT'  && <span className="text-yellow-400">👉 Right</span>}
                    {riskData.gazeDirection === 'UP'     && <span className="text-yellow-400">👆 Up</span>}
                    {riskData.gazeDirection === 'DOWN'   && <span className="text-yellow-400">👇 Down</span>}
                  </span>
                </div>
              )}
              {riskData.headDirection && riskData.headDirection !== 'UNKNOWN' && (
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-gray-300">
                    Head: {' '}
                    {riskData.headDirection === 'FORWARD' && <span className="text-green-400">Forward ✓</span>}
                    {riskData.headDirection === 'LEFT'    && <span className="text-yellow-400">↰ Turned Left</span>}
                    {riskData.headDirection === 'RIGHT'   && <span className="text-yellow-400">↱ Turned Right</span>}
                    {riskData.headDirection === 'UP'      && <span className="text-yellow-400">↑ Head Up</span>}
                    {riskData.headDirection === 'DOWN'    && <span className="text-yellow-400">↓ Head Down</span>}
                  </span>
                </div>
              )}
            </div>

            {/* Cumulative violation counts */}
            <div className="border-t border-gray-700 pt-2 space-y-1">
              <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Session Summary</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                <span className="text-gray-400">Total events</span>
                <span className={`font-bold text-right ${aiTotal > 0 ? 'text-red-400' : 'text-green-400'}`}>{aiTotal}</span>
                {riskData.phoneDetections > 0 && <>
                  <span className="text-red-400">📱 Phone</span>
                  <span className="text-red-400 font-bold text-right">{riskData.phoneDetections}×</span>
                </>}
                {riskData.multipleFaces > 0 && <>
                  <span className="text-red-400">👥 Multi-face</span>
                  <span className="text-red-400 font-bold text-right">{riskData.multipleFaces}×</span>
                </>}
                {riskData.noFace > 0 && <>
                  <span className="text-orange-400">🚫 No face</span>
                  <span className="text-orange-400 font-bold text-right">{riskData.noFace}×</span>
                </>}
                {riskData.lookingAway > 0 && <>
                  <span className="text-yellow-400">👁 Gaze away</span>
                  <span className="text-yellow-400 font-bold text-right">{riskData.lookingAway}×</span>
                </>}
                {riskData.headTurns > 0 && <>
                  <span className="text-yellow-400">↩ Head turned</span>
                  <span className="text-yellow-400 font-bold text-right">{riskData.headTurns}×</span>
                </>}
                {(riskData.audioViolations > 0 || browserAudioViolations > 0) && <>
                  <span className="text-orange-400">🎤 Audio/Talking</span>
                  <span className="text-orange-400 font-bold text-right">
                    {Math.max(riskData.audioViolations ?? 0, browserAudioViolations)}×
                  </span>
                </>}
              </div>
            </div>

          </div>
        )}
      </div>
    </>
  );
};

export default ProctoringSystem;
