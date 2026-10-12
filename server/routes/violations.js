import express from 'express';
import { createViolation, getViolationsBySession, getViolationsByExam, resetViolations } from '../controllers/violationController.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = express.Router();

router.post('/', authenticate, createViolation);
router.get('/session/:sessionId', authenticate, getViolationsBySession);
router.get('/exam/:examId', authenticate, authorize(['admin', 'faculty']), getViolationsByExam);
router.delete('/session/:sessionId', authenticate, authorize(['admin', 'faculty']), resetViolations);

export default router;
