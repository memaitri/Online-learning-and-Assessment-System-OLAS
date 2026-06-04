import { useEffect, useRef, useState } from 'react';
import { violationAPI, proctoringAPI } from '../services/api';
import toast from 'react-hot-toast';

/**
 * ProctoringSystem
 * ─────────────────
 * Handles browser-side proctoring (tab-switch, fullscreen, copy/paste …)
 * AND displays the live AI risk score panel received from the Python engine
 * via the parent's polling.
 *
 * Props
 * ─────
 * sessionId       : string   – DB StudentExamSession ID
 * examId          : string   – Exam ID
 * onViolation     : fn(count)
 * onBlock         : fn()
 * socket          : Socket.IO socket
 * disabled        : bool     – disables detection after submit
 * riskData        : object   – live AI proctoring data (from parent polling)
 *   { riskScore, riskLevel, totalViolations, phoneDetections,
 *     multipleFaces, noFace, lookingAway, headTurns, status }
 */
const RISK_COLORS = {
  SAFE:     { bg: 'bg-green-900',  border: 'border-green-500',  text: 'text-green-400',  dot: 'bg-green-500'  },
  LOW:      { bg: 'bg-teal-900',   border: 'border-teal-500',   text: 'text-teal-400',   dot: 'bg-teal-500'   },
  MEDIUM:   { bg: 'bg-yellow-900', border: 'border-yellow-500', text: 'text-yellow-400', dot: 'bg-yellow-500' },
  HIGH:     { bg: 'bg-orange-900', border: 'border-orange-500', text: 'text-orange-400', dot: 'bg-orange-500' },
  CRITICAL: { bg: 'bg-red-900',    border: 'border-red-500',    text: 'text-red-400',    dot: 'bg-red-500'    },
};

const ProctoringSystem = ({
  sessionId,
  examId,
  onViolation,
  onBlock,
  socket,
  disabled,
  riskData,
}) => {
  const [browserViolations, setBrowserViolations] = useState(0);
  const isMountedRef      = useRef(true);
  const isInitializedRef  = useRef(false);

  // ── Risk panel display values ────────────────────────────────────────
  const score    = riskData?.riskScore       ?? 0;
  const level    = riskData?.riskLevel       ?? 'SAFE';
  const aiTotal  = riskData?.totalViolations ?? 0;
  const colors   = RISK_COLORS[level] || RISK_COLORS.SAFE;
  const aiActive = riskData?.status === 'running';

  useEffect(() => {
    isMountedRef.current       = true;
    isInitializedRef.current   = false;
    let cleanupListeners = null;

    // Delay 2 s to avoid false-positives on page load
    const initTimer = setTimeout(() => {
      if (isMountedRef.current) {
        cleanupListeners   = setupEventListeners();
        isInitializedRef.current = true;
      }
    }, 2000);

    return () => {
      isMountedRef.current     = false;
      isInitializedRef.current = false;
      clearTimeout(initTimer);
      if (cleanupListeners) cleanupListeners();
    };
  }, []);

  // ── Browser-side event listeners (tab switch, fullscreen, copy …) ───
  const setupEventListeners = () => {
    const handlers = {};

    handlers.visibilityChange = () => {
      if (document.hidden && isMountedRef.current && isInitializedRef.current)
        reportViolation('tab_switch', 'Student switched tabs or minimized window', 'high');
    };
    handlers.blur = () => {
      if (isMountedRef.current && isInitializedRef.current)
        reportViolation('window_blur', 'Student switched to another window', 'high');
    };
    handlers.fullscreenChange = () => {
      const isFS = !!(
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement
      );
      if (!isFS && isMountedRef.current && isInitializedRef.current) {
        reportViolation('exit_fullscreen', 'Student exited fullscreen mode', 'high');
        setTimeout(() => {
          if (isMountedRef.current) {
            const el = document.documentElement;
            (el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen)
              ?.call(el)
              ?.catch(() => {});
          }
        }, 1000);
      }
    };
    handlers.contextMenu = (e) => {
      if (isMountedRef.current && isInitializedRef.current) {
        e.preventDefault();
        reportViolation('right_click', 'Student attempted to right-click', 'medium');
      }
    };
    handlers.copy = (e) => {
      if (isMountedRef.current && isInitializedRef.current) {
        e.preventDefault();
        reportViolation('copy_attempt', 'Student attempted to copy content', 'high');
      }
    };
    handlers.paste = (e) => {
      if (isMountedRef.current && isInitializedRef.current) {
        e.preventDefault();
        reportViolation('paste_attempt', 'Student attempted to paste content', 'high');
      }
    };
    handlers.cut = (e) => {
      if (isMountedRef.current && isInitializedRef.current) {
        e.preventDefault();
        reportViolation('cut_attempt', 'Student attempted to cut content', 'high');
      }
    };
    handlers.keyDown = (e) => {
      if (!isMountedRef.current || !isInitializedRef.current) return;
      if (e.ctrlKey || e.metaKey) {
        if (['c','C'].includes(e.key)) { e.preventDefault(); reportViolation('keyboard_shortcut','Blocked Ctrl+C','high'); }
        if (['v','V'].includes(e.key)) { e.preventDefault(); reportViolation('keyboard_shortcut','Blocked Ctrl+V','high'); }
        if (['x','X'].includes(e.key)) { e.preventDefault(); reportViolation('keyboard_shortcut','Blocked Ctrl+X','high'); }
        if (e.key === 'F12' || (e.shiftKey && ['I','J','C'].includes(e.key)))
          { e.preventDefault(); reportViolation('devtools_attempt','Attempted to open DevTools','high'); }
      }
      if (e.key === 'F12') { e.preventDefault(); reportViolation('devtools_attempt','Attempted to open DevTools','high'); }
    };
    handlers.beforeUnload = (e) => {
      if (isMountedRef.current && isInitializedRef.current) {
        e.preventDefault();
        reportViolation('page_refresh','Student attempted to refresh page','high');
        e.returnValue = '';
      }
    };
    handlers.offline = () => {
      if (isMountedRef.current && isInitializedRef.current)
        reportViolation('network_disconnect','Network connection lost','high');
    };
    handlers.online = () => {
      if (isMountedRef.current && isInitializedRef.current)
        toast.success('Network connection restored');
    };

    const detectDevTools = () => {
      if (!isMountedRef.current || !isInitializedRef.current) return;
      if (window.outerWidth - window.innerWidth > 160 || window.outerHeight - window.innerHeight > 160)
        reportViolation('devtools_open','Developer tools detected','high');
    };

    document.addEventListener('visibilitychange',    handlers.visibilityChange);
    window.addEventListener('blur',                  handlers.blur);
    document.addEventListener('fullscreenchange',    handlers.fullscreenChange);
    document.addEventListener('webkitfullscreenchange', handlers.fullscreenChange);
    document.addEventListener('mozfullscreenchange', handlers.fullscreenChange);
    document.addEventListener('contextmenu',         handlers.contextMenu);
    document.addEventListener('copy',                handlers.copy);
    document.addEventListener('paste',               handlers.paste);
    document.addEventListener('cut',                 handlers.cut);
    document.addEventListener('keydown',             handlers.keyDown);
    window.addEventListener('beforeunload',          handlers.beforeUnload);
    window.addEventListener('offline',               handlers.offline);
    window.addEventListener('online',                handlers.online);
    handlers.devToolsInterval = setInterval(detectDevTools, 1000);

    return () => {
      document.removeEventListener('visibilitychange',    handlers.visibilityChange);
      window.removeEventListener('blur',                  handlers.blur);
      document.removeEventListener('fullscreenchange',    handlers.fullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handlers.fullscreenChange);
      document.removeEventListener('mozfullscreenchange', handlers.fullscreenChange);
      document.removeEventListener('contextmenu',         handlers.contextMenu);
      document.removeEventListener('copy',                handlers.copy);
      document.removeEventListener('paste',               handlers.paste);
      document.removeEventListener('cut',                 handlers.cut);
      document.removeEventListener('keydown',             handlers.keyDown);
      window.removeEventListener('beforeunload',          handlers.beforeUnload);
      window.removeEventListener('offline',               handlers.offline);
      window.removeEventListener('online',                handlers.online);
      if (handlers.devToolsInterval) clearInterval(handlers.devToolsInterval);
    };
  };

  const reportViolation = async (type, description, severity = 'medium') => {
    if (disabled || !isMountedRef.current || !isInitializedRef.current) return;
    try {
      // 1. Write to DB via existing violations API (unchanged)
      const response = await violationAPI.create({ sessionId, type, description, severity });
      const newCount = response.data.violationCount;
      setBrowserViolations(newCount);

      // 2. Forward to Python RiskService so risk score reflects browser violations
      try {
        await proctoringAPI.violation(examId, type);
      } catch {
        // Non-fatal — risk score may just not reflect this one event
      }

      if (socket) {
        socket.emit('violation-detected', { examId, sessionId, type, description, severity, count: newCount });
      }
      toast.error(`Violation: ${description}`);
      if (onViolation) onViolation(newCount);
      if (response.data.blocked) {
        toast.error('Blocked due to excessive violations!');
        if (onBlock) onBlock();
      }
    } catch (error) {
      console.error('Error reporting violation:', error);
    }
  };

  // ── Render: two side-by-side panels ─────────────────────────────────
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-56">

      {/* Panel 1 — Browser proctoring (always visible) */}
      <div className="bg-gray-800 border border-gray-600 rounded-lg shadow-lg px-4 py-3 space-y-1">
        <div className="flex items-center space-x-2">
          <div className={`w-2.5 h-2.5 rounded-full ${
            browserViolations === 0 ? 'bg-green-500'
            : browserViolations < 3  ? 'bg-yellow-500'
            : 'bg-red-500'}`}
          />
          <span className="text-xs font-semibold text-white">
            Browser Violations: {browserViolations}
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <div className={`w-2.5 h-2.5 rounded-full ${disabled ? 'bg-gray-500' : 'bg-blue-500'}`} />
          <span className="text-xs font-semibold text-white">
            {disabled ? 'Proctoring Ended' : 'Proctoring Active'}
          </span>
        </div>
      </div>

      {/* Panel 2 — AI Risk Score (shown once proctoring starts) */}
      {riskData && (
        <div className={`${colors.bg} border ${colors.border} rounded-lg shadow-lg px-4 py-3 space-y-2`}>
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-1.5">
              <div className={`w-2.5 h-2.5 rounded-full ${colors.dot} ${aiActive ? 'animate-pulse' : ''}`} />
              <span className="text-xs font-bold text-white">AI Proctoring</span>
            </div>
            <span className={`text-xs font-bold ${colors.text}`}>{level}</span>
          </div>

          {/* Risk score gauge */}
          <div>
            <div className="flex justify-between text-xs text-gray-400 mb-0.5">
              <span>Risk Score</span>
              <span className={`font-bold ${colors.text}`}>{score.toFixed(1)}/100</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all duration-700 ${colors.dot}`}
                style={{ width: `${Math.min(score, 100)}%` }}
              />
            </div>
          </div>

          {/* Violation breakdown */}
          <div className="space-y-0.5 text-xs text-gray-300">
            <div className="flex justify-between">
              <span>AI Violations</span>
              <span className={aiTotal > 0 ? 'text-red-400 font-bold' : 'text-green-400'}>{aiTotal}</span>
            </div>
            {riskData.phoneDetections > 0 && (
              <div className="flex justify-between text-red-400">
                <span>📱 Phone detected</span>
                <span>{riskData.phoneDetections}×</span>
              </div>
            )}
            {riskData.multipleFaces > 0 && (
              <div className="flex justify-between text-red-400">
                <span>👥 Multiple faces</span>
                <span>{riskData.multipleFaces}×</span>
              </div>
            )}
            {riskData.lookingAway > 0 && (
              <div className="flex justify-between text-yellow-400">
                <span>👁 Looking away</span>
                <span>{riskData.lookingAway}×</span>
              </div>
            )}
            {riskData.headTurns > 0 && (
              <div className="flex justify-between text-yellow-400">
                <span>↩ Head turned</span>
                <span>{riskData.headTurns}×</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ProctoringSystem;
