import express from 'express';
import { createExam, getAllExams, getExamById, updateExam, deleteExam, startExam, submitExam, getExamSession, getAllExamSessions, unblockStudent } from '../controllers/examController.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = express.Router();

router.post('/', authenticate, authorize(['admin', 'faculty']), createExam);
router.get('/', authenticate, getAllExams);
router.get('/:id', authenticate, getExamById);
router.put('/:id', authenticate, authorize(['admin', 'faculty']), updateExam);
router.delete('/:id', authenticate, authorize(['admin', 'faculty']), deleteExam);
router.post('/:id/start', authenticate, authorize(['student']), startExam);
router.post('/:id/submit', authenticate, authorize(['student']), submitExam);
router.get('/:id/session', authenticate, getExamSession);
router.get('/:id/sessions', authenticate, authorize(['admin', 'faculty']), getAllExamSessions);
router.put('/:examId/sessions/:sessionId/unblock', authenticate, authorize(['admin', 'faculty']), unblockStudent);

export default router;
