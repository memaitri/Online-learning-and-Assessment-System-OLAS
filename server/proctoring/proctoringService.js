// server/proctoring/proctoringService.js
// ─────────────────────────────────────────────────────────────────────────────
// Manages the lifecycle of the Python proctoring engine subprocess.
//
// Architecture change (headless frame-server mode):
//   • Spawns frame_server.py instead of main.py
//   • Python has NO webcam and NO OpenCV window
//   • Node receives base64 JPEG frames from the browser via
//     POST /api/proctoring/frame and writes them to Python's stdin
//   • Python processes each frame with the full detection pipeline and
//     prints one JSON result line to stdout
//   • Node reads stdout line-by-line and caches the latest result
//   • session_output.json is still written every 2 s by Python (background)
// ─────────────────────────────────────────────────────────────────────────────

import { spawn }    from 'child_process';
import path         from 'path';
import fs           from 'fs';
import readline     from 'readline';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PROCTORING_DIR = path.resolve(__dirname, '../../proctoring');
const OUTPUT_FILE    = path.join(PROCTORING_DIR, 'session_output.json');
const REPORT_FILE    = path.join(PROCTORING_DIR, 'logs', 'session_report.txt');
const RISK_LOG_FILE  = path.join(PROCTORING_DIR, 'logs', 'risk_log.txt');

// Map: dbSessionId → SessionState
const activeSessions = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// startSession(dbSessionId)
// ─────────────────────────────────────────────────────────────────────────────
export function startSession(dbSessionId) {
  if (activeSessions.has(dbSessionId)) {
    const existing = activeSessions.get(dbSessionId);
    if (existing.status === 'running') {
      return { success: false, message: 'Proctoring session already running' };
    }
  }

  // Spawn frame_server.py with stdin/stdout pipes
  const pyProcess = spawn(
    'python',
    [
      'frame_server.py',
      '--session-id',   dbSessionId,
      '--output-file',  OUTPUT_FILE,
    ],
    {
      cwd:         PROCTORING_DIR,
      stdio:       ['pipe', 'pipe', 'pipe'],  // stdin, stdout, stderr all piped
      windowsHide: true,                      // no console window
    }
  );

  const session = {
    process:      pyProcess,
    pid:          pyProcess.pid,
    startedAt:    new Date(),
    status:       'running',
    dbSessionId,
    latestResult: null,    // last JSON result line from Python stdout
    ready:        false,   // true once Python prints its ready message
  };
  activeSessions.set(dbSessionId, session);

  // ── Read Python stdout line-by-line (each line is a JSON result) ─────
  const rl = readline.createInterface({ input: pyProcess.stdout });
  rl.on('line', (line) => {
    try {
      const result = JSON.parse(line);
      session.latestResult = result;
      // Log every 10th frame to avoid flooding the console
      if (result.frameIndex && result.frameIndex % 10 === 0) {
        process.stdout.write(`[Proctoring:${dbSessionId.slice(0,6)}] frame=${result.frameIndex} risk=${result.riskScore} level=${result.riskLevel}\n`);
      }
    } catch (_) {
      // Non-JSON stdout line — ignore (e.g. mediapipe init messages)
    }
  });

  // ── Log Python stderr to Node console ────────────────────────────────
  pyProcess.stderr.on('data', (data) => {
    const msg = data.toString();
    process.stderr.write(`[Proctoring:${dbSessionId.slice(0,6)}] ${msg}`);
    // Mark as ready once detectors are initialised
    if (msg.includes('All detectors ready')) {
      session.ready = true;
    }
  });

  pyProcess.on('close', (code) => {
    const s = activeSessions.get(dbSessionId);
    if (s) {
      s.status   = 'stopped';
      s.exitCode = code;
    }
    console.log(`[Proctoring] Session ${dbSessionId} process exited (code ${code})`);
  });

  pyProcess.on('error', (err) => {
    const s = activeSessions.get(dbSessionId);
    if (s) {
      s.status = 'error';
      s.error  = err.message;
    }
    console.error(`[Proctoring] Failed to start process: ${err.message}`);
  });

  // Silently absorb EPIPE errors on stdin — these happen when the Python
  // process exits while Node is still writing frames to stdin.
  pyProcess.stdin.on('error', (err) => {
    if (err.code !== 'EPIPE') {
      console.error(`[Proctoring] stdin error for ${dbSessionId}: ${err.message}`);
    }
  });

  console.log(`[Proctoring] Started frame server ${dbSessionId} (PID ${pyProcess.pid})`);
  return { success: true, pid: pyProcess.pid, sessionId: dbSessionId };
}

// ─────────────────────────────────────────────────────────────────────────────
// submitViolationEvent(dbSessionId, eventType, metadata)
// Injects a browser-side violation directly into Python's RiskService
// by sending a special message on stdin.
// Python frame_server.py reads "VIOLATION:<json>\n" and records the event.
// ─────────────────────────────────────────────────────────────────────────────
export function submitViolationEvent(dbSessionId, eventType, metadata = {}) {
  const session = activeSessions.get(dbSessionId);
  if (!session || session.status !== 'running') {
    return null;
  }
  try {
    if (!session.process.stdin.writable) return null;
    const msg = JSON.stringify({ eventType, metadata });
    session.process.stdin.write(`VIOLATION:${msg}\n`);
    return session.latestResult;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// submitFrame(dbSessionId, base64Jpeg)
// ─────────────────────────────────────────────────────────────────────────────
export function submitFrame(dbSessionId, base64Jpeg) {
  const session = activeSessions.get(dbSessionId);
  if (!session || session.status !== 'running') {
    return { success: false, message: 'No active proctoring session' };
  }
  try {
    if (!session.process.stdin.writable) {
      return { success: false, message: 'Python stdin not writable' };
    }
    session.process.stdin.write(base64Jpeg.replace(/\n/g, '') + '\n');
    return { success: true, latestResult: session.latestResult };
  } catch (err) {
    // Absorb EPIPE — Python process exited between writable check and write
    return { success: false, message: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// stopSession(dbSessionId)
// ─────────────────────────────────────────────────────────────────────────────
export function stopSession(dbSessionId) {
  const session = activeSessions.get(dbSessionId);
  if (!session) {
    return { success: false, message: 'No active proctoring session found' };
  }
  if (session.status !== 'running') {
    return { success: false, message: `Session already ${session.status}` };
  }

  try {
    // Send STOP command then close stdin so Python exits cleanly
    if (session.process.stdin.writable) {
      session.process.stdin.write('STOP\n');
      session.process.stdin.end();
    }
    session.status = 'stopping';
    console.log(`[Proctoring] Sent STOP to session ${dbSessionId}`);
    return { success: true };
  } catch (err) {
    // Fallback: SIGTERM
    try { session.process.kill('SIGTERM'); } catch (_) {}
    return { success: true };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// getStatus(dbSessionId)
// ─────────────────────────────────────────────────────────────────────────────
export function getStatus(dbSessionId) {
  const session = activeSessions.get(dbSessionId);
  if (!session) {
    return { found: false, status: 'not_started' };
  }

  let liveData = session.latestResult;

  // Fall back to session_output.json if no in-memory result yet
  if (!liveData) {
    try {
      if (fs.existsSync(OUTPUT_FILE)) {
        const raw = fs.readFileSync(OUTPUT_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed.sessionId === dbSessionId) liveData = parsed;
      }
    } catch (_) {}
  }

  return {
    found:      true,
    status:     session.status,
    ready:      session.ready,
    pid:        session.pid,
    startedAt:  session.startedAt,
    liveData:   liveData ?? {
      sessionId:       dbSessionId,
      riskScore:       0,
      riskLevel:       'SAFE',
      totalViolations: 0,
      phoneDetections: 0,
      multipleFaces:   0,
      noFace:          0,
      lookingAway:     0,
      headTurns:       0,
      status:          session.status,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// getReport(dbSessionId)
// ─────────────────────────────────────────────────────────────────────────────
export function getReport(dbSessionId) {
  let finalData = null;
  try {
    if (fs.existsSync(OUTPUT_FILE)) {
      const raw    = fs.readFileSync(OUTPUT_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed.sessionId === dbSessionId && parsed.status === 'completed') {
        finalData = parsed;
      }
    }
  } catch (_) {}

  // Also check in-memory latest result
  const session = activeSessions.get(dbSessionId);
  if (!finalData && session?.latestResult?.status === 'completed') {
    finalData = session.latestResult;
  }

  let reportText = null;
  try {
    if (fs.existsSync(REPORT_FILE)) {
      reportText = fs.readFileSync(REPORT_FILE, 'utf8');
    }
  } catch (_) {}

  if (!finalData && !reportText) {
    return { found: false, message: 'Report not yet available' };
  }

  return {
    found:       true,
    sessionId:   dbSessionId,
    finalData,
    reportText,
    reportPath:  REPORT_FILE,
    riskLogPath: RISK_LOG_FILE,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// stopAllSessions  (called on server shutdown)
// ─────────────────────────────────────────────────────────────────────────────
export function stopAllSessions() {
  for (const [id, session] of activeSessions.entries()) {
    if (session.status === 'running') {
      try {
        if (session.process.stdin.writable) {
          session.process.stdin.write('STOP\n');
          session.process.stdin.end();
        }
      } catch (_) {
        try { session.process.kill('SIGTERM'); } catch (_) {}
      }
    }
  }
  activeSessions.clear();
}
