// server/controllers/questionBankController.js
// ─────────────────────────────────────────────────────────────────────────────
// Handles question bank: upload, parse, save, assign, preview, export
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import prisma from '../utils/db.js';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Seeded pseudo-random number generator (Mulberry32).
 * Returns a function that generates reproducible floats [0,1) for a given seed.
 */
function seededRng(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6D2B79F5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates shuffle using either seeded rng or Math.random.
 */
function shuffle(arr, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Parse raw text into individual question strings.
 * Handles: blank-line separated, numbered (1. / 1) / Q1.), bullet (- / *)
 */
export function parseQuestions(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Try numbered pattern first: lines starting with digit or Q+digit
  const numbered = [];
  const numberedRe = /^(?:Q\d+[.)]\s*|\d+[.)]\s*)/i;
  for (const line of lines) {
    if (numberedRe.test(line)) {
      numbered.push(line.replace(numberedRe, '').trim());
    }
  }
  if (numbered.length >= 2) return numbered.filter(Boolean);

  // Try bullet point pattern
  const bullets = [];
  const bulletRe = /^[-*•]\s+/;
  for (const line of lines) {
    if (bulletRe.test(line)) {
      bullets.push(line.replace(bulletRe, '').trim());
    }
  }
  if (bullets.length >= 2) return bullets.filter(Boolean);

  // Fall back: split by blank lines (join wrapped lines)
  const blocks = text.split(/\n\s*\n/).map(b => b.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (blocks.length >= 2) return blocks;

  // Last resort: every non-empty line is a question
  return lines.filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/question-bank/upload
// Accepts multipart file (.txt / .doc / .docx), returns parsed preview
// ─────────────────────────────────────────────────────────────────────────────
export const uploadQuestions = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const { mimetype, path: filePath, originalname } = req.file;
    let rawText = '';

    if (mimetype === 'text/plain' || originalname.endsWith('.txt')) {
      rawText = fs.readFileSync(filePath, 'utf-8');
    } else if (
      mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      originalname.endsWith('.docx') || originalname.endsWith('.doc')
    ) {
      const result = await mammoth.extractRawText({ path: filePath });
      rawText = result.value;
    } else {
      fs.unlinkSync(filePath);
      return res.status(400).json({ message: 'Unsupported file type. Use .txt, .doc, or .docx' });
    }

    // Clean up temp file
    fs.unlinkSync(filePath);

    const questionTexts = parseQuestions(rawText);

    if (questionTexts.length === 0) {
      return res.status(400).json({ message: 'No questions could be extracted from the file' });
    }

    // Return preview (not saved to DB yet)
    const preview = questionTexts.map((text, idx) => ({
      questionNumber: idx + 1,
      questionText: text,
      title: text.length > 60 ? text.slice(0, 57) + '...' : text,
      points: 10,
    }));

    res.json({ questions: preview, total: preview.length });
  } catch (err) {
    console.error('[QuestionBank] upload error:', err);
    res.status(500).json({ message: 'Error processing file', error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/question-bank/save
// Body: { examId, questions: [{questionNumber, questionText, title, points}] }
// Replaces the entire question bank for this exam
// ─────────────────────────────────────────────────────────────────────────────
export const saveQuestions = async (req, res) => {
  try {
    const { examId, questions } = req.body;
    if (!examId) return res.status(400).json({ message: 'examId required' });
    if (!Array.isArray(questions) || questions.length === 0)
      return res.status(400).json({ message: 'questions array required' });

    // Verify exam exists and belongs to the requesting faculty
    const exam = await prisma.exam.findUnique({ where: { id: examId } });
    if (!exam) return res.status(404).json({ message: 'Exam not found' });
    if (req.user.role === 'faculty' && exam.createdById !== req.user.id)
      return res.status(403).json({ message: 'Not your exam' });

    // Replace entire bank (deleteMany + createMany in a transaction)
    await prisma.$transaction([
      prisma.studentQuestionAssignment.deleteMany({ where: { examId } }),
      prisma.questionBank.deleteMany({ where: { examId } }),
      prisma.questionBank.createMany({
        data: questions.map((q, idx) => ({
          examId,
          uploadedById: req.user.id,
          questionNumber: q.questionNumber ?? idx + 1,
          questionText: q.questionText,
          title: q.title || (q.questionText.slice(0, 60)),
          points: q.points ?? 10,
        })),
      }),
    ]);

    const saved = await prisma.questionBank.findMany({
      where: { examId },
      orderBy: { questionNumber: 'asc' },
    });

    res.status(201).json({ message: 'Question bank saved', questions: saved, total: saved.length });
  } catch (err) {
    console.error('[QuestionBank] save error:', err);
    res.status(500).json({ message: 'Error saving questions', error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/question-bank/:examId
// Returns the full question bank for an exam (faculty/admin)
// ─────────────────────────────────────────────────────────────────────────────
export const getQuestionBank = async (req, res) => {
  try {
    const { examId } = req.params;
    const questions = await prisma.questionBank.findMany({
      where: { examId },
      orderBy: { questionNumber: 'asc' },
    });
    res.json({ questions, total: questions.length });
  } catch (err) {
    res.status(500).json({ message: 'Error fetching question bank', error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/question-bank/question/:id
// Update a single question's text/title/points
// ─────────────────────────────────────────────────────────────────────────────
export const updateQuestion = async (req, res) => {
  try {
    const { id } = req.params;
    const { questionText, title, points } = req.body;
    const updated = await prisma.questionBank.update({
      where: { id },
      data: {
        ...(questionText !== undefined && { questionText }),
        ...(title !== undefined && { title }),
        ...(points !== undefined && { points }),
      },
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: 'Error updating question', error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/question-bank/question/:id
// ─────────────────────────────────────────────────────────────────────────────
export const deleteQuestion = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.studentQuestionAssignment.deleteMany({ where: { questionId: id } });
    await prisma.questionBank.delete({ where: { id } });
    res.json({ message: 'Question deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Error deleting question', error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/question-bank/:examId/assign
// Body: { questionsPerStudent, allowRepetition, randomSeed? }
// Randomly assigns questions to all enrolled students
// ─────────────────────────────────────────────────────────────────────────────
export const assignQuestions = async (req, res) => {
  try {
    const { examId } = req.params;
    const { questionsPerStudent = 1, allowRepetition = false, randomSeed } = req.body;

    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      include: { class: { include: { students: { select: { id: true, name: true, email: true } } } } },
    });
    if (!exam) return res.status(404).json({ message: 'Exam not found' });

    const students = exam.class.students;
    if (students.length === 0)
      return res.status(400).json({ message: 'No students enrolled in this class' });

    const bank = await prisma.questionBank.findMany({
      where: { examId },
      orderBy: { questionNumber: 'asc' },
    });
    if (bank.length === 0)
      return res.status(400).json({ message: 'Question bank is empty. Upload questions first.' });

    const rng = randomSeed != null ? seededRng(Number(randomSeed)) : Math.random.bind(Math);
    const n = questionsPerStudent;

    // Build assignments
    const assignments = [];
    for (const student of students) {
      let pool;
      if (!allowRepetition && bank.length >= n) {
        // Mode 1: Unique — shuffle bank, pick first n
        pool = shuffle(bank, rng).slice(0, n);
      } else {
        // Mode 2: Allow repetition — pick n random (with possible repeats)
        pool = Array.from({ length: n }, () => bank[Math.floor(rng() * bank.length)]);
        // Deduplicate within same student
        pool = [...new Map(pool.map(q => [q.id, q])).values()];
      }
      for (const q of pool) {
        assignments.push({ studentId: student.id, examId, questionId: q.id });
      }
    }

    // Clear old assignments, insert new ones
    await prisma.studentQuestionAssignment.deleteMany({ where: { examId } });
    await prisma.studentQuestionAssignment.createMany({ data: assignments, skipDuplicates: true });

    // Update exam flags
    await prisma.exam.update({
      where: { id: examId },
      data: {
        randomAssignment: true,
        questionsPerStudent: n,
        allowRepetition,
        randomSeed: randomSeed != null ? Number(randomSeed) : null,
      },
    });

    // Return preview with student → question mapping
    const preview = [];
    for (const student of students) {
      const qs = assignments
        .filter(a => a.studentId === student.id)
        .map(a => bank.find(q => q.id === a.questionId))
        .filter(Boolean);
      preview.push({ student: { id: student.id, name: student.name, email: student.email }, questions: qs });
    }

    res.status(201).json({
      message: 'Questions assigned successfully',
      totalStudents: students.length,
      totalAssignments: assignments.length,
      preview,
    });
  } catch (err) {
    console.error('[QuestionBank] assign error:', err);
    res.status(500).json({ message: 'Error assigning questions', error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/question-bank/:examId/assignments
// Returns full assignment map (faculty view)
// ─────────────────────────────────────────────────────────────────────────────
export const getAssignments = async (req, res) => {
  try {
    const { examId } = req.params;
    const assignments = await prisma.studentQuestionAssignment.findMany({
      where: { examId },
      include: {
        student: { select: { id: true, name: true, email: true } },
        question: true,
      },
      orderBy: { assignedAt: 'asc' },
    });

    // Group by student
    const byStudent = {};
    for (const a of assignments) {
      const sid = a.student.id;
      if (!byStudent[sid]) byStudent[sid] = { student: a.student, questions: [] };
      byStudent[sid].questions.push(a.question);
    }

    res.json({ assignments: Object.values(byStudent), total: assignments.length });
  } catch (err) {
    res.status(500).json({ message: 'Error fetching assignments', error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/question-bank/:examId/assignments
// Clear all assignments for an exam
// ─────────────────────────────────────────────────────────────────────────────
export const clearAssignments = async (req, res) => {
  try {
    const { examId } = req.params;
    await prisma.studentQuestionAssignment.deleteMany({ where: { examId } });
    await prisma.exam.update({
      where: { id: examId },
      data: { randomAssignment: false },
    });
    res.json({ message: 'Assignments cleared' });
  } catch (err) {
    res.status(500).json({ message: 'Error clearing assignments', error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/question-bank/:examId/my-question
// Student: get their assigned question(s) for this exam
// Assignment is LOCKED — same result every call
// ─────────────────────────────────────────────────────────────────────────────
export const getMyQuestion = async (req, res) => {
  try {
    const { examId } = req.params;
    const studentId = req.user.id;

    const assignments = await prisma.studentQuestionAssignment.findMany({
      where: { examId, studentId },
      include: { question: true },
      orderBy: { assignedAt: 'asc' },
    });

    if (assignments.length === 0) {
      // Exam doesn't use random assignment — return null
      return res.json({ assigned: false, questions: [] });
    }

    res.json({
      assigned: true,
      questions: assignments.map(a => a.question),
    });
  } catch (err) {
    res.status(500).json({ message: 'Error fetching assigned question', error: err.message });
  }
};
