import express from 'express';
import { createClass, getAllClasses, getClassById, updateClass, deleteClass, enrollStudent, removeStudent } from '../controllers/classController.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = express.Router();

router.post('/', authenticate, authorize(['admin', 'faculty']), createClass);
router.get('/', authenticate, getAllClasses);
router.get('/:id', authenticate, getClassById);
router.put('/:id', authenticate, authorize(['admin', 'faculty']), updateClass);
router.delete('/:id', authenticate, authorize(['admin']), deleteClass);
router.post('/:id/enroll', authenticate, authorize(['admin', 'faculty']), enrollStudent);
router.delete('/:id/students/:studentId', authenticate, authorize(['admin', 'faculty']), removeStudent);

export default router;
