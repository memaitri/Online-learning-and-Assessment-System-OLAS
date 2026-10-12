import jwt from 'jsonwebtoken';

export const setupSocketHandlers = (io) => {
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    
    if (!token) {
      return next(new Error('Authentication error'));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id;
      socket.userRole = decoded.role;
      next();
    } catch (error) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.userId} (${socket.userRole})`);

    // Students join the exam as participants
    socket.on('join-exam', ({ examId }) => {
      socket.join(`exam-${examId}`);
      console.log(`Student ${socket.userId} joined exam ${examId}`);
      
      // Only broadcast if it's a student
      if (socket.userRole === 'student') {
        socket.to(`exam-${examId}`).emit('user-joined', {
          userId: socket.userId,
          role: socket.userRole
        });
      }
    });

    // Faculty/Admin monitor the exam (don't broadcast join)
    socket.on('monitor-exam', ({ examId }) => {
      socket.join(`exam-${examId}`);
      console.log(`Monitor ${socket.userId} (${socket.userRole}) watching exam ${examId}`);
      // Don't broadcast - monitors are invisible to students
    });

    socket.on('leave-exam', ({ examId }) => {
      socket.leave(`exam-${examId}`);
      console.log(`User ${socket.userId} left exam ${examId}`);
      
      // Only broadcast if it's a student
      if (socket.userRole === 'student') {
        socket.to(`exam-${examId}`).emit('user-left', {
          userId: socket.userId
        });
      }
    });

    socket.on('stop-monitoring', ({ examId }) => {
      socket.leave(`exam-${examId}`);
      console.log(`Monitor ${socket.userId} stopped watching exam ${examId}`);
      // Don't broadcast - monitors are invisible
    });

    socket.on('proctoring-data', ({ examId, data }) => {
      socket.to(`exam-${examId}`).emit('student-proctoring-update', {
        studentId: socket.userId,
        data,
        timestamp: new Date()
      });
    });

    socket.on('tab-switch', ({ examId }) => {
      socket.to(`exam-${examId}`).emit('violation-alert', {
        studentId: socket.userId,
        type: 'tab_switch',
        timestamp: new Date()
      });
    });

    socket.on('code-update', ({ examId, questionId, code, language }) => {
      socket.to(`exam-${examId}`).emit('student-code-update', {
        studentId: socket.userId,
        questionId,
        code,
        language,
        timestamp: new Date()
      });
    });

    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.userId}`);
    });
  });
};
