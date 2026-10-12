import prisma from '../utils/db.js';

export const createClass = async (req, res) => {
  try {
    const { name, code, description } = req.body;

    const existingClass = await prisma.class.findUnique({ where: { code } });
    if (existingClass) {
      return res.status(400).json({ message: 'Class code already exists' });
    }

    const newClass = await prisma.class.create({
      data: {
        name,
        code,
        description,
        facultyId: req.user.id,
        createdById: req.user.id
      },
      include: {
        faculty: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true, email: true } }
      }
    });

    res.status(201).json(newClass);
  } catch (error) {
    res.status(500).json({ message: 'Error creating class', error: error.message });
  }
};

export const getAllClasses = async (req, res) => {
  try {
    let where = {};

    if (req.user.role === 'faculty') {
      where.facultyId = req.user.id;
    }

    if (req.user.role === 'student') {
      where.students = {
        some: { id: req.user.id }
      };
    }

    const classes = await prisma.class.findMany({
      where,
      include: {
        faculty: { select: { id: true, name: true, email: true } },
        students: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true, email: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(classes);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching classes', error: error.message });
  }
};

export const getClassById = async (req, res) => {
  try {
    const classData = await prisma.class.findUnique({
      where: { id: req.params.id },
      include: {
        faculty: { select: { id: true, name: true, email: true } },
        students: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true, email: true } }
      }
    });

    if (!classData) {
      return res.status(404).json({ message: 'Class not found' });
    }

    res.json(classData);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching class', error: error.message });
  }
};

export const updateClass = async (req, res) => {
  try {
    const classData = await prisma.class.findUnique({
      where: { id: req.params.id }
    });

    if (!classData) {
      return res.status(404).json({ message: 'Class not found' });
    }

    if (req.user.role === 'faculty' && classData.facultyId !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to update this class' });
    }

    const updatedClass = await prisma.class.update({
      where: { id: req.params.id },
      data: req.body,
      include: {
        faculty: { select: { id: true, name: true, email: true } },
        students: { select: { id: true, name: true, email: true } }
      }
    });

    res.json(updatedClass);
  } catch (error) {
    res.status(500).json({ message: 'Error updating class', error: error.message });
  }
};

export const deleteClass = async (req, res) => {
  try {
    await prisma.class.delete({
      where: { id: req.params.id }
    });

    res.json({ message: 'Class deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting class', error: error.message });
  }
};

export const enrollStudent = async (req, res) => {
  try {
    const { studentId } = req.body;

    const student = await prisma.user.findUnique({ where: { id: studentId } });
    if (!student || student.role !== 'student') {
      return res.status(404).json({ message: 'Student not found' });
    }

    const classData = await prisma.class.update({
      where: { id: req.params.id },
      data: {
        students: {
          connect: { id: studentId }
        }
      },
      include: {
        students: { select: { id: true, name: true, email: true } }
      }
    });

    res.json({ message: 'Student enrolled successfully', class: classData });
  } catch (error) {
    res.status(500).json({ message: 'Error enrolling student', error: error.message });
  }
};

export const removeStudent = async (req, res) => {
  try {
    const { studentId } = req.params;

    const classData = await prisma.class.update({
      where: { id: req.params.id },
      data: {
        students: {
          disconnect: { id: studentId }
        }
      },
      include: {
        students: { select: { id: true, name: true, email: true } }
      }
    });

    res.json({ message: 'Student removed successfully', class: classData });
  } catch (error) {
    res.status(500).json({ message: 'Error removing student', error: error.message });
  }
};
