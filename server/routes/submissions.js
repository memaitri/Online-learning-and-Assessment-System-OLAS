import express from 'express';
import { createSubmission, getSubmissionsByExam, getSubmissionByStudent, gradeSubmission } from '../controllers/submissionController.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = express.Router();

router.post('/', authenticate, createSubmission);
router.get('/exam/:examId', authenticate, authorize(['admin', 'faculty']), getSubmissionsByExam);
router.get('/exam/:examId/student/:studentId', authenticate, getSubmissionByStudent);
router.put('/:id/grade', authenticate, authorize(['admin', 'faculty']), gradeSubmission);

export default router;
