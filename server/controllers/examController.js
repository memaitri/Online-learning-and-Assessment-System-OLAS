import prisma from '../utils/db.js';
import { stopSession, getReport } from '../proctoring/proctoringService.js';

export const createExam = async (req, res) => {
  try {
    const { title, description, classId, startTime, endTime, duration, questions, allowedLanguages, maxViolations } = req.body;
    
    const exam = await prisma.exam.create({
      data: {
        title,
        description,
        classId,
        createdById: req.user.id,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        duration,
        questions,
        allowedLanguages: allowedLanguages || ['javascript', 'python', 'java', 'c', 'cpp'],
        maxViolations: maxViolations || 3
      },
      include: {
        class: { select: { id: true, name: true, code: true } },
        createdBy: { select: { id: true, name: true, email: true } }
      }
    });

    res.status(201).json(exam);
  } catch (error) {
    res.status(500).json({ message: 'Error creating exam', error: error.message });
  }
};

export const getAllExams = async (req, res) => {
  try {
    const { classId } = req.query;
    let where = {};
    
    if (classId) {
      where.classId = classId;
    }
    
    if (req.user.role === 'student') {
      // Get all classes the student is enrolled in
      const studentClasses = await prisma.class.findMany({
        where: {
          students: {
            some: { id: req.user.id }
          }
        },
        select: { id: true }
      });
      
      const classIds = studentClasses.map(c => c.id);
      
      // Show exams from classes the student is enrolled in
      where.classId = { in: classIds };
    }

    const exams = await prisma.exam.findMany({
      where,
      include: {
        class: { select: { id: true, name: true, code: true } },
        createdBy: { select: { id: true, name: true, email: true } }
      },
      orderBy: { startTime: 'desc' }
    });
    
    res.json(exams);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching exams', error: error.message });
  }
};

export const getExamById = async (req, res) => {
  try {
    const exam = await prisma.exam.findUnique({
      where: { id: req.params.id },
      include: {
        class: { select: { id: true, name: true, code: true } },
        createdBy: { select: { id: true, name: true, email: true } }
      }
    });
    
    if (!exam) {
      return res.status(404).json({ message: 'Exam not found' });
    }

    res.json(exam);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching exam', error: error.message });
  }
};

export const updateExam = async (req, res) => {
  try {
    const exam = await prisma.exam.update({
      where: { id: req.params.id },
      data: req.body,
      include: {
        class: { select: { id: true, name: true, code: true } },
        createdBy: { select: { id: true, name: true, email: true } }
      }
    });

    res.json(exam);
  } catch (error) {
    res.status(500).json({ message: 'Error updating exam', error: error.message });
  }
};

export const deleteExam = async (req, res) => {
  try {
    await prisma.exam.delete({
      where: { id: req.params.id }
    });

    res.json({ message: 'Exam deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting exam', error: error.message });
  }
};

export const startExam = async (req, res) => {
  try {
    const exam = await prisma.exam.findUnique({
      where: { id: req.params.id }
    });
    
    if (!exam) {
      return res.status(404).json({ message: 'Exam not found' });
    }

    const now = new Date();
    if (now < exam.startTime) {
      return res.status(400).json({ message: 'Exam has not started yet' });
    }
    if (now > exam.endTime) {
      return res.status(400).json({ message: 'Exam has ended' });
    }

    let session = await prisma.studentExamSession.findUnique({
      where: {
        studentId_examId: {
          studentId: req.user.id,
          examId: req.params.id
        }
      }
    });

    if (session) {
      if (session.status === 'blocked') {
        return res.status(403).json({ message: 'You are blocked from this exam' });
      }
      if (session.status === 'completed') {
        return res.status(400).json({ message: 'You have already completed this exam' });
      }
      return res.json(session);
    }

    session = await prisma.studentExamSession.create({
      data: {
        studentId: req.user.id,
        examId: req.params.id,
        status: 'in_progress'
      }
    });

    res.status(201).json(session);
  } catch (error) {
    res.status(500).json({ message: 'Error starting exam', error: error.message });
  }
};

export const submitExam = async (req, res) => {
  try {
    const session = await prisma.studentExamSession.findUnique({
      where: {
        studentId_examId: {
          studentId: req.user.id,
          examId: req.params.id
        }
      }
    });

    if (!session) {
      return res.status(404).json({ message: 'Exam session not found' });
    }

    if (session.status === 'completed') {
      return res.status(400).json({ message: 'Exam already submitted' });
    }

    // ── Stop the proctoring process and collect risk data ───────────────
    stopSession(session.id);

    // Wait up to 5 s for Python to write the final JSON
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const reportData = getReport(session.id);
    const riskFields = {};

    if (reportData.found && reportData.finalData) {
      const fd = reportData.finalData;
      riskFields.riskScore            = fd.riskScore       ?? 0;
      riskFields.riskLevel            = fd.riskLevel       ?? 'SAFE';
      riskFields.totalViolations      = fd.totalViolations ?? 0;
      riskFields.proctoringReportPath = reportData.reportPath ?? null;
    }

    const updatedSession = await prisma.studentExamSession.update({
      where: { id: session.id },
      data: {
        status:      'completed',
        submittedAt: new Date(),
        ...riskFields,
      }
    });

    res.json({
      message: 'Exam submitted successfully',
      session: updatedSession,
      riskData: reportData.found ? reportData.finalData : null,
    });
  } catch (error) {
    res.status(500).json({ message: 'Error submitting exam', error: error.message });
  }
};

export const getExamSession = async (req, res) => {
  try {
    const session = await prisma.studentExamSession.findUnique({
      where: {
        studentId_examId: {
          studentId: req.user.id,
          examId: req.params.id
        }
      },
      include: {
        exam: true
      }
    });

    res.json(session);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching session', error: error.message });
  }
};

export const getAllExamSessions = async (req, res) => {
  try {
    const sessions = await prisma.studentExamSession.findMany({
      where: { examId: req.params.id },
      include: {
        student: { select: { id: true, name: true, email: true } },
        exam: { select: { id: true, title: true, maxViolations: true } }
      },
      orderBy: { startedAt: 'desc' }
    });

    res.json(sessions);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching sessions', error: error.message });
  }
};

export const unblockStudent = async (req, res) => {
  try {
    const { examId, sessionId } = req.params;

    const session = await prisma.studentExamSession.findUnique({
      where: { id: sessionId }
    });

    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }

    if (session.examId !== examId) {
      return res.status(400).json({ message: 'Session does not belong to this exam' });
    }

    const updatedSession = await prisma.studentExamSession.update({
      where: { id: sessionId },
      data: {
        status: 'in_progress',
        submittedAt: null
      }
    });

    const io = req.app.get('io');
    io.to(`exam-${examId}`).emit('student-unblocked', {
      sessionId,
      studentId: session.studentId
    });

    res.json({ message: 'Student unblocked successfully', session: updatedSession });
  } catch (error) {
    res.status(500).json({ message: 'Error unblocking student', error: error.message });
  }
};
