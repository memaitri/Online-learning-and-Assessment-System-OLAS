import prisma from '../utils/db.js';

export const createViolation = async (req, res) => {
  try {
    const { sessionId, type, description, severity } = req.body;

    const session = await prisma.studentExamSession.findUnique({
      where: { id: sessionId }
    });

    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }

    const violation = await prisma.violation.create({
      data: {
        sessionId,
        studentId: session.studentId,
        examId: session.examId,
        type,
        description,
        severity: severity || 'medium'
      }
    });

    const violationCount = await prisma.violation.count({
      where: { sessionId }
    });

    const exam = await prisma.exam.findUnique({
      where: { id: session.examId }
    });

    if (violationCount >= exam.maxViolations) {
      await prisma.studentExamSession.update({
        where: { id: sessionId },
        data: { status: 'blocked' }
      });
      
      const io = req.app.get('io');
      io.to(`exam-${session.examId}`).emit('student-blocked', {
        studentId: session.studentId,
        sessionId: session.id,
        violationCount
      });
    }

    const io = req.app.get('io');
    io.to(`exam-${session.examId}`).emit('violation-detected', {
      violation,
      sessionId: session.id,
      studentId: session.studentId,
      totalViolations: violationCount
    });

    res.status(201).json({ 
      violation, 
      violationCount, 
      blocked: violationCount >= exam.maxViolations 
    });
  } catch (error) {
    res.status(500).json({ message: 'Error creating violation', error: error.message });
  }
};

export const getViolationsBySession = async (req, res) => {
  try {
    const violations = await prisma.violation.findMany({
      where: { sessionId: req.params.sessionId },
      orderBy: { timestamp: 'desc' }
    });
    
    res.json(violations);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching violations', error: error.message });
  }
};

export const getViolationsByExam = async (req, res) => {
  try {
    const violations = await prisma.violation.findMany({
      where: { examId: req.params.examId },
      include: {
        student: { select: { id: true, name: true, email: true } },
        session: true
      },
      orderBy: { timestamp: 'desc' }
    });
    
    res.json(violations);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching violations', error: error.message });
  }
};

export const resetViolations = async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await prisma.studentExamSession.findUnique({
      where: { id: sessionId }
    });

    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }

    await prisma.violation.deleteMany({
      where: { sessionId }
    });

    const io = req.app.get('io');
    io.to(`exam-${session.examId}`).emit('violations-reset', {
      sessionId,
      studentId: session.studentId
    });

    res.json({ message: 'Violations reset successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error resetting violations', error: error.message });
  }
};
