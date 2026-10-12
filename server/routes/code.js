import express from 'express';
import { executeCode } from '../controllers/codeController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.post('/execute', authenticate, executeCode);

export default router;
