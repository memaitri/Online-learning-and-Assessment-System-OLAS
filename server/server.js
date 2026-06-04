import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import prisma from './utils/db.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import classRoutes from './routes/classes.js';
import examRoutes from './routes/exams.js';
import codeRoutes from './routes/code.js';
import violationRoutes from './routes/violations.js';
import submissionRoutes from './routes/submissions.js';
import proctoringRoutes from './proctoring/proctoringRoutes.js';
import { stopAllSessions } from './proctoring/proctoringService.js';
import { setupSocketHandlers } from './sockets/index.js';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: [
      process.env.CLIENT_URL || 'http://localhost:5173',
      'http://localhost:5174'
    ],
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Middleware
app.use(cors({
  origin: [
    process.env.CLIENT_URL || 'http://localhost:5173',
    'http://localhost:5174'
  ],
  credentials: true
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Test database connection
prisma.$connect()
  .then(() => console.log('✅ Connected to MySQL Database'))
  .catch((err) => console.error('❌ Database connection error:', err));

// Make io accessible to routes
app.set('io', io);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/exams', examRoutes);
app.use('/api/code', codeRoutes);
app.use('/api/violations', violationRoutes);
app.use('/api/submissions', submissionRoutes);
app.use('/api/proctoring', proctoringRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Setup Socket.IO handlers
setupSocketHandlers(io);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    message: err.message || 'Internal Server Error',
    error: process.env.NODE_ENV === 'development' ? err : {}
  });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  stopAllSessions();       // kill any running Python proctoring processes
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  stopAllSessions();
  await prisma.$disconnect();
  process.exit(0);
});

const PORT = process.env.PORT || 5000;

httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Socket.IO ready for connections`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});

export { io, prisma };

