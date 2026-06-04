// server/proctoring/proctoringController.js
// ─────────────────────────────────────────────────────────────────────────────
// HTTP handlers for proctoring API endpoints.
// All Python process logic delegates to proctoringService.js.
// All DB writes go through Prisma.
// ─────────────────────────────────────────────────────────────────────────────

import prisma from '../utils/db.js';
import {
  startSession,
  stopSession,
  submitFrame,
  getStatus,
  getReport,
} from './proctoringService.js';

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/proctoring/violation
// Body: { examId, type }
// Called by ProctoringSystem.jsx when a browser-side violation fires
// (tab switch, fullscreen exit, Ctrl+C, etc.) so it reaches RiskService.
// ─────────────────────────────────────────────────────────────────────────────
export const submitBrowserViolation = async (req, res) => {
  try {
    const { examId, type } = req.body;
    const studentId        = req.user.id;

    if (!examId || !type) {
      return res.status(400).json({ message: 'examId and type are required' });
    }

    const dbSession = await prisma.studentExamSession.findUnique({
      where: { studentId_examId: { studentId, examId } },
    });

    if (!dbSession || dbSession.status !== 'in_progress') {
      return res.status(404).json({ message: 'Active exam session not found' });
    }

    // Map browser violation type → Python EventType string
    // Python's RiskService.record_event() accepts EventType enum values.
    // We pass the string and let Python's EventType(value) resolve it.
    const EVENT_MAP = {
      'tab_switch':         'LOOKING_AWAY',
      'window_blur':        'LOOKING_AWAY',
      'exit_fullscreen':    'LOOKING_AWAY',
      'right_click':        null,             // not a risk event — DB-only
      'copy_attempt':       'LOOKING_AWAY',
      'paste_attempt':      'LOOKING_AWAY',
      'cut_attempt':        'LOOKING_AWAY',
      'keyboard_shortcut':  'LOOKING_AWAY',
      'devtools_attempt':   'LOOKING_AWAY',
      'devtools_open':      'LOOKING_AWAY',
      'page_refresh':       'LOOKING_AWAY',
      'network_disconnect': null,
    };

    const eventType = EVENT_MAP[type] ?? null;
    let latestResult = null;

    if (eventType) {
      // Dynamically import to avoid circular dep issues at module load time
      const { submitViolationEvent } = await import('./proctoringService.js');
      const result = submitViolationEvent(dbSession.id, eventType, { source: 'browser', type });
      latestResult = result ?? null;
    }

    res.json({ success: true, latestResult });
  } catch (error) {
    console.error('[proctoringController] submitBrowserViolation:', error);
    res.status(500).json({ message: 'Error recording violation', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/proctoring/frame
// Body: { examId, frame: "<base64 JPEG string>" }
// Called every 2 seconds by WebcamProctor.jsx
// ─────────────────────────────────────────────────────────────────────────────
export const submitFrameHandler = async (req, res) => {
  try {
    const { examId, frame } = req.body;
    const studentId         = req.user.id;

    if (!examId || !frame) {
      return res.status(400).json({ message: 'examId and frame are required' });
    }

    const dbSession = await prisma.studentExamSession.findUnique({
      where: { studentId_examId: { studentId, examId } },
    });

    if (!dbSession || dbSession.status !== 'in_progress') {
      return res.status(404).json({ message: 'Active exam session not found' });
    }

    const frameSize = Math.round(frame.length / 1024);
    console.log(`[Frame] session=${dbSession.id.slice(0,8)} size=${frameSize}KB`);

    const result = submitFrame(dbSession.id, frame);

    if (!result.success) {
      console.warn(`[Frame] submitFrame failed: ${result.message}`);
    } else {
      console.log(`[Frame] Sent to Python. latestResult=${!!result.latestResult}`);
    }

    res.json({
      success:      result.success,
      sessionId:    dbSession.id,
      latestResult: result.latestResult ?? null,
    });
  } catch (error) {
    console.error('[proctoringController] submitFrame:', error);
    res.status(500).json({ message: 'Error submitting frame', error: error.message });
  }
};
export const startProctoring = async (req, res) => {
  try {
    const { examId } = req.body;
    const studentId  = req.user.id;

    if (!examId) {
      return res.status(400).json({ message: 'examId is required' });
    }

    // Find the student's existing session for this exam
    const dbSession = await prisma.studentExamSession.findUnique({
      where: { studentId_examId: { studentId, examId } },
    });

    if (!dbSession) {
      return res.status(404).json({ message: 'Exam session not found. Start the exam first.' });
    }
    if (dbSession.status === 'completed') {
      return res.status(400).json({ message: 'Exam already submitted' });
    }
    if (dbSession.status === 'blocked') {
      return res.status(403).json({ message: 'You are blocked from this exam' });
    }

    // Spawn the Python proctoring process, passing the DB session ID
    const result = startSession(dbSession.id);

    if (!result.success) {
      return res.status(409).json({ message: result.message });
    }

    res.status(201).json({
      message:       'Proctoring started',
      sessionId:     dbSession.id,
      pid:           result.pid,
    });
  } catch (error) {
    console.error('[proctoringController] startProctoring:', error);
    res.status(500).json({ message: 'Error starting proctoring', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/proctoring/stop
// Body: { examId }
// ─────────────────────────────────────────────────────────────────────────────
export const stopProctoring = async (req, res) => {
  try {
    const { examId } = req.body;
    const studentId  = req.user.id;

    if (!examId) {
      return res.status(400).json({ message: 'examId is required' });
    }

    const dbSession = await prisma.studentExamSession.findUnique({
      where: { studentId_examId: { studentId, examId } },
    });

    if (!dbSession) {
      return res.status(404).json({ message: 'Exam session not found' });
    }

    // Signal Python to stop (SIGTERM → triggers finally block → writes final JSON)
    const result = stopSession(dbSession.id);
    if (!result.success) {
      // Not necessarily a hard error — process may have already exited
      console.warn(`[proctoringController] stopSession: ${result.message}`);
    }

    // Give the process up to 5 s to write the final output file, then read it
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const reportData = getReport(dbSession.id);

    // Persist risk data to the DB session record
    if (reportData.found && reportData.finalData) {
      const fd = reportData.finalData;
      try {
        await prisma.studentExamSession.update({
          where: { id: dbSession.id },
          data:  {
            riskScore:            fd.riskScore       ?? 0,
            riskLevel:            fd.riskLevel       ?? 'SAFE',
            totalViolations:      fd.totalViolations ?? 0,
            proctoringReportPath: reportData.reportPath ?? null,
          },
        });
      } catch (dbErr) {
        // Schema may not have the risk fields yet — log but don't fail the request
        console.warn('[proctoringController] Could not persist risk data (schema migration needed?):', dbErr.message);
      }
    }

    res.json({
      message:    'Proctoring stopped',
      sessionId:  dbSession.id,
      reportData: reportData.found ? reportData.finalData : null,
    });
  } catch (error) {
    console.error('[proctoringController] stopProctoring:', error);
    res.status(500).json({ message: 'Error stopping proctoring', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/proctoring/status?examId=<id>
// ─────────────────────────────────────────────────────────────────────────────
export const getProctoringStatus = async (req, res) => {
  try {
    const { examId } = req.query;
    const studentId  = req.user.id;

    if (!examId) {
      return res.status(400).json({ message: 'examId query param is required' });
    }

    const dbSession = await prisma.studentExamSession.findUnique({
      where: { studentId_examId: { studentId, examId } },
    });

    if (!dbSession) {
      return res.status(404).json({ message: 'Exam session not found' });
    }

    const statusData = getStatus(dbSession.id);
    console.log(`[Status] session=${dbSession.id.slice(0,8)} procStatus=${statusData.status} ready=${statusData.ready}`);

    res.json({
      sessionId:  dbSession.id,
      examStatus: dbSession.status,
      proctoring: statusData,
    });
  } catch (error) {
    console.error('[proctoringController] getProctoringStatus:', error);
    res.status(500).json({ message: 'Error fetching proctoring status', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/proctoring/report/:sessionId
// Available to: the student who owns the session, faculty, admin
// ─────────────────────────────────────────────────────────────────────────────
export const getProctoringReport = async (req, res) => {
  try {
    const { sessionId } = req.params;

    // Authorise: student can only see their own session
    const dbSession = await prisma.studentExamSession.findUnique({
      where: { id: sessionId },
      include: {
        exam: { select: { id: true, title: true, createdById: true } },
      },
    });

    if (!dbSession) {
      return res.status(404).json({ message: 'Session not found' });
    }

    const user = req.user;
    const isOwner   = dbSession.studentId === user.id;
    const isFaculty = user.role === 'faculty' || user.role === 'admin';

    if (!isOwner && !isFaculty) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Try live service data first; fall back to DB fields
    const reportData = getReport(sessionId);

    const response = {
      sessionId,
      examId:              dbSession.examId,
      examTitle:           dbSession.exam.title,
      studentId:           dbSession.studentId,
      status:              dbSession.status,
      startedAt:           dbSession.startedAt,
      submittedAt:         dbSession.submittedAt,
      // Risk fields — from DB (persisted on stop) or live service
      riskScore:           dbSession.riskScore            ?? reportData.finalData?.riskScore ?? 0,
      riskLevel:           dbSession.riskLevel            ?? reportData.finalData?.riskLevel ?? 'SAFE',
      totalViolations:     dbSession.totalViolations      ?? reportData.finalData?.totalViolations ?? 0,
      proctoringReportPath: dbSession.proctoringReportPath ?? reportData.reportPath ?? null,
      // Detailed live data if available
      detail: reportData.found ? reportData.finalData : null,
      reportText: (isFaculty && reportData.reportText) ? reportData.reportText : null,
    };

    res.json(response);
  } catch (error) {
    console.error('[proctoringController] getProctoringReport:', error);
    res.status(500).json({ message: 'Error fetching report', error: error.message });
  }
};
