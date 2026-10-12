import prisma from '../utils/db.js';

export const createSubmission = async (req, res) => {
  try {
    const { examId, questionId, code, language, output } = req.body;

    const existing = await prisma.submission.findFirst({
      where: {
        studentId: req.user.id,
        examId: examId,
        question: questionId
      }
    });

    let submission;
    if (existing) {
      submission = await prisma.submission.update({
        where: { id: existing.id },
        data: {
          code,
          language,
          output,
          submittedAt: new Date()
        }
      });
    } else {
      submission = await prisma.submission.create({
        data: {
          studentId: req.user.id,
          examId,
          question: questionId,
          code,
          language,
          output
        }
      });
    }

    res.status(201).json(submission);
  } catch (error) {
    res.status(500).json({ message: 'Error creating submission', error: error.message });
  }
};

export const getSubmissionsByExam = async (req, res) => {
  try {
    const submissions = await prisma.submission.findMany({
      where: { examId: req.params.examId },
      include: {
        student: { select: { id: true, name: true, email: true } }
      },
      orderBy: { submittedAt: 'desc' }
    });
    
    res.json(submissions);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching submissions', error: error.message });
  }
};

export const getSubmissionByStudent = async (req, res) => {
  try {
    const { examId, studentId } = req.params;
    
    if (req.user.role === 'student' && req.user.id !== studentId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const submissions = await prisma.submission.findMany({
      where: {
        examId,
        studentId
      },
      orderBy: { submittedAt: 'desc' }
    });
    
    res.json(submissions);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching submission', error: error.message });
  }
};

export const gradeSubmission = async (req, res) => {
  try {
    const { score, feedback } = req.body;

    const submission = await prisma.submission.update({
      where: { id: req.params.id },
      data: { 
        score,
        feedback,
        gradedById: req.user.id,
        gradedAt: new Date()
      }
    });

    res.json(submission);
  } catch (error) {
    res.status(500).json({ message: 'Error grading submission', error: error.message });
  }
};
