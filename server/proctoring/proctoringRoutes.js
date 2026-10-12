// server/proctoring/proctoringRoutes.js
// ─────────────────────────────────────────────────────────────────────────────
// Proctoring API routes.
//
// Mounted at: /api/proctoring  (added in server.js)
//
// Endpoints:
//   POST   /api/proctoring/start           Student starts proctoring
//   POST   /api/proctoring/stop            Student stops proctoring
//   GET    /api/proctoring/status          Live status (polled every 5 s)
//   GET    /api/proctoring/report/:id      Final session report
// ─────────────────────────────────────────────────────────────────────────────

import express from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import {
  startProctoring,
  stopProctoring,
  submitFrameHandler,
  submitBrowserViolation,
  getProctoringStatus,
  getProctoringReport,
} from './proctoringController.js';

const router = express.Router();

router.post('/start',              authenticate, authorize(['student']), startProctoring);
router.post('/stop',               authenticate, authorize(['student']), stopProctoring);
router.post('/frame',              authenticate, authorize(['student']), submitFrameHandler);
router.post('/violation',          authenticate, authorize(['student']), submitBrowserViolation);
router.get('/status',              authenticate, authorize(['student']), getProctoringStatus);
router.get('/report/:sessionId',   authenticate, getProctoringReport);

export default router;
