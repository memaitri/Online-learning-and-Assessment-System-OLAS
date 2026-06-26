// server/routes/questionBank.js
import express from 'express';
import multer from 'multer';
import path from 'path';
import os from 'os';
import {
  uploadQuestions,
  saveQuestions,
  getQuestionBank,
  updateQuestion,
  deleteQuestion,
  assignQuestions,
  getAssignments,
  clearAssignments,
  getMyQuestion,
} from '../controllers/questionBankController.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = express.Router();

// Multer: store in OS temp dir, accept .txt / .doc / .docx only
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (_req, file, cb) => {
    const allowed = ['.txt', '.doc', '.docx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only .txt, .doc and .docx files are allowed'));
    }
  },
});

// ── Faculty / Admin ────────────────────────────────────────────────────────
router.post('/upload',                   authenticate, authorize(['faculty', 'admin']), upload.single('file'), uploadQuestions);
router.post('/save',                     authenticate, authorize(['faculty', 'admin']), saveQuestions);
router.get('/:examId',                   authenticate, authorize(['faculty', 'admin']), getQuestionBank);
router.put('/question/:id',              authenticate, authorize(['faculty', 'admin']), updateQuestion);
router.delete('/question/:id',           authenticate, authorize(['faculty', 'admin']), deleteQuestion);
router.post('/:examId/assign',           authenticate, authorize(['faculty', 'admin']), assignQuestions);
router.get('/:examId/assignments',       authenticate, authorize(['faculty', 'admin']), getAssignments);
router.delete('/:examId/assignments',    authenticate, authorize(['faculty', 'admin']), clearAssignments);

// ── Student ────────────────────────────────────────────────────────────────
router.get('/:examId/my-question',       authenticate, authorize(['student']), getMyQuestion);

export default router;
