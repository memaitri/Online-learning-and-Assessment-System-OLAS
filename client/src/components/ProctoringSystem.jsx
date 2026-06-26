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
  return null; // CENTER / FORWARD / UNKNOWN → no alert
}

const ProctoringSystem = ({
  sessionId, examId, onViolation, onBlock, socket, disabled, riskData,
  inline = false,   // true = compact header chip only; full panel always renders fixed bottom-left
}) => {
  const [browserViolations, setBrowserViolations] = useState(0);
  const [lastEvent, setLastEvent]  = useState(null);   // { icon, text, ts }
  const isMountedRef     = useRef(true);
  const isInitializedRef = useRef(false);

  const score    = riskData?.riskScore       ?? 0;
  const level    = riskData?.riskLevel       ?? 'SAFE';
  const aiTotal  = riskData?.totalViolations ?? 0;
  const colors   = RISK_COLORS[level] || RISK_COLORS.SAFE;
  const aiActive = riskData?.status === 'running';
  const faceCount= riskData?.faceCount       ?? -1;  // -1 = not yet received

  // ── Derive last live event for the "what I just saw" feed ──────────
  useEffect(() => {
    if (!riskData) return;
    const { gazeDirection, headDirection, faceCount, phoneDetections,
            multipleFaces, noFace, lastEvent: pyEvent } = riskData;

    let event = null;

    if (faceCount === 0) {
      event = { icon: '🚫', text: 'No person detected', color: 'text-red-400' };
    } else if (faceCount >= 2) {
      event = { icon: '👥', text: `${faceCount} people in frame`, color: 'text-red-400' };
    } else if (phoneDetections > 0) {
      event = { icon: '📱', text: 'Phone detected!', color: 'text-red-400' };
    } else {
      const dir = describeDirection(gazeDirection, headDirection);
      if (dir) {
        event = { ...dir, color: 'text-yellow-400' };
      } else {
        event = { icon: '✅', text: 'Looking at screen', color: 'text-green-400' };
      }
    }

    if (event) setLastEvent({ ...event, ts: new Date().toLocaleTimeString() });
  }, [riskData]);

  // ── Event listeners setup ───────────────────────────────────────────
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

  const setupEventListeners = () => {
    const h = {};
    const fire = (type, desc, sev = 'medium') => reportViolation(type, desc, sev);

    h.vis  = () => { if (document.hidden && isMountedRef.current && isInitializedRef.current) fire('tab_switch','Switched tabs','high'); };
    h.blur = () => { if (isMountedRef.current && isInitializedRef.current) fire('window_blur','Switched window','high'); };
    h.fs   = () => {
      const isFS = !!(document.fullscreenElement || document.webkitFullscreenElement);
      if (!isFS && isMountedRef.current && isInitializedRef.current) {
        fire('exit_fullscreen','Exited fullscreen','high');
        setTimeout(() => {
          if (isMountedRef.current) {
            const el = document.documentElement;
            (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el)?.catch(() => {});
          }
        }, 1000);
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

  // ── Inline chip — shown inside the header bar ───────────────────────
  if (inline) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        {/* Browser violations */}
        <div className="flex items-center gap-1.5 bg-gray-700 border border-gray-600 rounded-lg px-2.5 py-1">
          <div className={`w-2 h-2 rounded-full ${browserViolations === 0 ? 'bg-green-500' : browserViolations < 3 ? 'bg-yellow-500' : 'bg-red-500'}`} />
          <span className="text-xs text-white font-semibold">Browser: {browserViolations}</span>
        </div>

        {/* AI risk compact chip */}
        {riskData && (
          <div className={`flex items-center gap-1.5 ${colors.bg} border ${colors.border} rounded-lg px-2.5 py-1`}>
            <div className={`w-2 h-2 rounded-full ${colors.dot} ${aiActive ? 'animate-pulse' : ''}`} />
            <span className="text-xs text-white font-bold">AI:</span>
            <span className={`text-xs font-bold ${colors.text}`}>{level}</span>
            <span className="text-xs text-gray-300">{score.toFixed(0)}/100</span>
          </div>
        )}
      </div>
    );
  }

  // ── Full panel — fixed bottom-left (away from webcam bottom-right and buttons) ──
  return (
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

          {/* ── LIVE FEED — "what I just saw" ── */}
          <div className="border-t border-gray-700 pt-2">
            <p className="text-xs text-gray-400 font-semibold mb-1.5 uppercase tracking-wide">Live Detection</p>

            {/* Current status */}
            {lastEvent && (
              <div className={`flex items-center gap-2 bg-gray-900 rounded-lg px-2.5 py-1.5 mb-2`}>
                <span className="text-base">{lastEvent.icon}</span>
                <div>
                  <p className={`text-xs font-bold ${lastEvent.color}`}>{lastEvent.text}</p>
                  <p className="text-xs text-gray-500">{lastEvent.ts}</p>
                </div>
              </div>
            )}

            {/* Face count */}
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

            {/* Gaze direction */}
            {riskData.gazeDirection && riskData.gazeDirection !== 'UNKNOWN' && (
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs text-gray-300">
                  Eyes: {' '}
                  {riskData.gazeDirection === 'CENTER'  && <span className="text-green-400">Center ✓</span>}
                  {riskData.gazeDirection === 'LEFT'    && <span className="text-yellow-400">👈 Left</span>}
                  {riskData.gazeDirection === 'RIGHT'   && <span className="text-yellow-400">👉 Right</span>}
                  {riskData.gazeDirection === 'UP'      && <span className="text-yellow-400">👆 Up</span>}
                  {riskData.gazeDirection === 'DOWN'    && <span className="text-yellow-400">👇 Down</span>}
                </span>
              </div>
            )}

            {/* Head direction */}
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

          {/* ── Cumulative violation counts ── */}
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
            </div>
          </div>

        </div>
      )}
    </div>
  );
};

export default ProctoringSystem;
