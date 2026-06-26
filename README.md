# OLAS — Online Learning and Assessment System

> A full-stack, AI-powered online examination platform with real-time proctoring, randomised question assignment, live faculty monitoring, and secure code execution.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Project Structure](#project-structure)
- [AI Proctoring System](#ai-proctoring-system)
- [Randomised Question Assignment](#randomised-question-assignment)
- [API Reference](#api-reference)
- [Screenshots](#screenshots)
- [License](#license)

---

## Overview

OLAS is a comprehensive online assessment platform designed for educational institutions. It combines a full-featured coding examination interface with an intelligent AI proctoring engine that monitors students via webcam in real time — detecting phone usage, multiple faces, gaze direction, and head pose. Faculty can create exams, upload question banks, assign questions randomly to students, monitor live sessions, and review submitted code.

---

## Features

### Student
- 🔐 Secure login with JWT authentication
- 📋 View enrolled classes and scheduled exams
- 🖥️ Fullscreen-enforced exam environment
- 💻 Monaco code editor (VS Code engine) with syntax highlighting
- ▶️ Run code with custom input and see output instantly
- 🧪 Test code against question test cases
- 📤 Submit code per question — visible to faculty immediately
- 🎲 Assigned a unique randomised question (if enabled by faculty)
- ⏱️ Real-time countdown timer with auto-submit on expiry
- 🔒 Browser-level anti-cheat: blocks tab switch, copy/paste, DevTools, right-click

### Faculty
- 📝 Create exams with custom questions, time windows, and language options
- 📂 Upload question bank from `.txt`, `.doc`, or `.docx` files
- ✏️ Auto-extract, preview, edit, and save questions from uploaded files
- 🎲 Enable random question assignment per student
  - Mode 1: Unique (no repeats)
  - Mode 2: Allow repetition (for large cohorts)
  - Reproducible seed for audit purposes
- 👁️ Preview allocation before publishing
- 📊 Live exam monitor: active students, violations, submissions
- 📋 View each student's submitted code per question
- 🏆 Grade submissions with score and feedback inline
- 🔓 Unblock students and reset violations

### Admin
- 👥 Manage all users (create, edit, delete)
- 🏫 Manage all classes and enrolments
- 📋 Full access to all exams and monitoring dashboards

### AI Proctoring Engine (Python)
- 👤 Face detection (MediaPipe BlazeFace)
- 📐 478-point facial landmark tracking (MediaPipe FaceLandmarker)
- 👁️ Gaze direction tracking (iris ratio geometry)
- 🔄 Head pose estimation (yaw / pitch / roll from transformation matrix)
- 📱 Phone detection (YOLOv8n — COCO class 67)
- 📊 Cumulative risk score (0–100) with five levels: SAFE / LOW / MEDIUM / HIGH / CRITICAL
- ⚡ Real-time live feed: shows exactly what was detected each frame
- 📄 Session report generated on exam submission

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18, Vite, Tailwind CSS, Axios, Socket.IO client |
| **Code Editor** | Monaco Editor (`@monaco-editor/react`) |
| **Backend** | Node.js, Express.js |
| **Database** | MySQL 8, Prisma ORM |
| **Real-time** | Socket.IO |
| **Auth** | JWT (jsonwebtoken), bcryptjs |
| **AI Engine** | Python 3.13, MediaPipe 0.10, OpenCV, YOLOv8 (ultralytics), NumPy |
| **File Parsing** | multer, mammoth (`.docx` → text) |
| **Edge Proxy** | Cloudflare Workers (TypeScript) — Supabase reverse proxy |

---

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                    Browser (React + Vite)                      │
│  Exam UI · Monaco Editor · WebcamProctor · ProctoringSystem    │
└───────────────────────┬────────────────────────────────────────┘
                        │  REST + Socket.IO
                        ▼
┌────────────────────────────────────────────────────────────────┐
│              Node.js / Express  (port 5000)                    │
│  Auth · Classes · Exams · Submissions · Violations             │
│  Question Bank · Proctoring Controller                         │
│                        │                                       │
│          proctoringService.js  ←──  stdin/stdout pipe          │
└───────────────────────┬────────────────────────────────────────┘
                        │ spawn()
                        ▼
┌────────────────────────────────────────────────────────────────┐
│         Python AI Engine  (frame_server.py)                    │
│  FaceDetector · FaceMesh · GazeTracker · HeadPoseEstimator     │
│  PhoneService (YOLOv8) · RiskService (0–100 score)             │
└────────────────────────────────────────────────────────────────┘
                        │
                        ▼
┌────────────────────────────────────────────────────────────────┐
│                MySQL Database (Prisma ORM)                     │
│  User · Class · Exam · StudentExamSession                      │
│  Submission · Violation · QuestionBank                         │
│  StudentQuestionAssignment                                     │
└────────────────────────────────────────────────────────────────┘
```

---

## Getting Started

### Prerequisites

- Node.js ≥ 18
- Python ≥ 3.10
- MySQL 8.0
- Git

### 1. Clone the repository

```bash
git clone https://github.com/memaitri/Online-learning-and-Assessment-System-OLAS.git
cd Online-learning-and-Assessment-System-OLAS
```

### 2. Set up the server

```bash
cd server
cp .env.example .env
# Edit .env with your MySQL credentials and JWT secret
npm install
npx prisma db push
npx prisma generate
node utils/seed.js       # Creates demo users, classes, and exam
npm run dev              # Starts on port 5000
```

### 3. Set up the client

```bash
cd ../client
cp .env.example .env
# Edit .env: VITE_API_URL=http://localhost:5000/api
npm install
npm run dev              # Starts on port 5173
```

### 4. Set up the Python AI engine

```bash
cd ../proctoring
pip install mediapipe opencv-python numpy ultralytics mammoth
# Model files (.tflite, .task, .pt) are auto-downloaded on first run
```

### 5. Open the app

Visit **http://localhost:5173**

**Demo credentials (created by seed.js):**

| Role | Email | Password |
|---|---|---|
| Admin | admin@olas.com | admin123 |
| Faculty | faculty@olas.com | faculty123 |
| Student | student@olas.com | student123 |

---

## Environment Variables

### `server/.env`

```env
PORT=5000
DATABASE_URL="mysql://root:yourpassword@localhost:3306/olas"
JWT_SECRET=your_jwt_secret_here
NODE_ENV=development
CLIENT_URL=http://localhost:5173
```

### `client/.env`

```env
VITE_API_URL=http://localhost:5000/api
VITE_SOCKET_URL=http://localhost:5000
```

---

## Project Structure

```
OLAS/
├── client/                         # React frontend
│   └── src/
│       ├── components/
│       │   ├── ProctoringSystem.jsx    # Browser guard + AI live feed panel
│       │   ├── WebcamProctor.jsx       # Webcam capture + frame upload
│       │   ├── QuestionBankManager.jsx # Upload/edit/assign question bank
│       │   ├── Layout.jsx
│       │   └── PrivateRoute.jsx
│       ├── pages/
│       │   ├── ExamTake.jsx            # Student exam interface
│       │   ├── ExamMonitor.jsx         # Faculty live monitor
│       │   ├── FacultyDashboard.jsx    # Exam creation + question bank
│       │   ├── StudentDashboard.jsx
│       │   ├── AdminDashboard.jsx
│       │   ├── Classes.jsx / ClassDetail.jsx
│       │   ├── Exams.jsx / ExamEdit.jsx
│       │   └── Login.jsx
│       ├── context/AuthContext.jsx
│       └── services/
│           ├── api.js                  # Axios + all API functions
│           └── socket.js              # Socket.IO singleton
│
├── server/                         # Node.js + Express backend
│   ├── controllers/
│   │   ├── authController.js
│   │   ├── examController.js
│   │   ├── classController.js
│   │   ├── submissionController.js
│   │   ├── violationController.js
│   │   ├── userController.js
│   │   └── questionBankController.js  # Question bank + random assignment
│   ├── routes/
│   │   ├── auth.js / exams.js / classes.js
│   │   ├── submissions.js / violations.js
│   │   └── questionBank.js
│   ├── proctoring/
│   │   ├── proctoringController.js
│   │   ├── proctoringRoutes.js
│   │   └── proctoringService.js       # Python subprocess manager
│   ├── middleware/auth.js             # JWT authenticate + authorize
│   ├── utils/db.js                    # Prisma singleton
│   ├── sockets/index.js              # Socket.IO handlers
│   ├── prisma/schema.prisma          # Database schema
│   └── server.js                     # Entry point
│
├── proctoring/                     # Python AI engine
│   ├── frame_server.py             # Headless entry point (stdin/stdout)
│   ├── face_detector.py            # MediaPipe BlazeFace
│   ├── face_mesh_detector.py       # 478-landmark face mesh
│   ├── gaze_tracker.py             # Iris ratio gaze detection
│   ├── head_pose_estimator.py      # Yaw/pitch/roll estimation
│   ├── violation_tracker.py        # Face count state machine
│   ├── phone_detection/            # YOLOv8 phone detector
│   │   ├── phone_detector.py
│   │   ├── phone_service.py        # Background thread + queue
│   │   └── phone_models.py
│   ├── risk_engine/                # Scoring engine (0–100)
│   │   ├── risk_models.py          # EventType, RiskLevel, dataclasses
│   │   ├── risk_config.py          # Weights and thresholds
│   │   ├── risk_calculator.py      # Pure math functions
│   │   └── risk_service.py         # Stateful session manager
│   ├── config.py                   # All tunable thresholds
│   └── requirements.txt
│
└── olas/                           # Cloudflare Worker
    └── src/index.ts                # Supabase reverse proxy
```

---

## AI Proctoring System

The proctoring engine runs as a Python subprocess spawned by Node.js. Communication is over OS pipes (stdin/stdout) using a line-delimited protocol.

### Protocol

```
Node → Python stdin:
  <base64-jpeg>\n              → process frame, return JSON on stdout
  VIOLATION:<json>\n           → inject browser violation into risk engine
  STOP\n + stdin.close()       → graceful shutdown, write final report

Python → Node stdout:
  {"frameIndex":42,"riskScore":15.0,"riskLevel":"LOW","faceCount":1,
   "gazeDirection":"CENTER","headDirection":"FORWARD",...}\n
```

### Risk Score Weights

| Event | Weight |
|---|---|
| Phone detected | +50 pts |
| Multiple faces | +30 pts |
| No face | +15 pts |
| Head turned away | +8 pts |
| Looking away | +5 pts |

### Risk Levels

| Score | Level |
|---|---|
| 0–20 | SAFE |
| 21–40 | LOW |
| 41–60 | MEDIUM |
| 61–80 | HIGH |
| 81–100 | CRITICAL |

---

## Randomised Question Assignment

Faculty can upload a question bank (`.txt`, `.doc`, `.docx`) and enable random assignment when creating an exam.

### Modes

| Mode | Behaviour |
|---|---|
| Unique Assignment | No question repeats until all questions are used |
| Allow Repetition | Multiple students can receive the same question |

### Reproducible Seed

Setting a **Random Seed** (e.g. `42`) guarantees the same distribution every time — useful for re-evaluation and audit.

### Workflow

1. Create exam → Upload file or add questions manually
2. Toggle **🎲 Random Question Assignment**
3. Set questions per student and mode
4. Click **👁 Preview Allocation** — see exactly which student gets which question
5. Click **Create Exam & Assign Questions** — assignments written to DB atomically
6. Students see only their assigned question with a 🔒 badge

---

## API Reference

### Auth
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/register` | Register user |
| POST | `/api/auth/login` | Login, returns JWT |
| GET | `/api/auth/profile` | Get current user |

### Exams
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/exams` | List exams (role-filtered) |
| POST | `/api/exams` | Create exam |
| POST | `/api/exams/:id/start` | Start exam session |
| POST | `/api/exams/:id/submit` | Submit exam |
| GET | `/api/exams/:id/sessions` | All student sessions (faculty) |

### Question Bank
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/question-bank/upload` | Parse uploaded file |
| POST | `/api/question-bank/save` | Save question bank |
| GET | `/api/question-bank/:examId` | Get bank for exam |
| POST | `/api/question-bank/:examId/assign` | Assign questions randomly |
| GET | `/api/question-bank/:examId/assignments` | Faculty assignment view |
| GET | `/api/question-bank/:examId/my-question` | Student assigned question |

### Proctoring
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/proctoring/start` | Spawn Python engine |
| POST | `/api/proctoring/frame` | Submit webcam frame |
| POST | `/api/proctoring/violation` | Record browser violation |
| GET | `/api/proctoring/status` | Get live risk data |
| GET | `/api/proctoring/report/:sessionId` | Final session report |
| POST | `/api/proctoring/stop` | Stop engine, save report |

---

## License

This project is licensed under the MIT License.

---

<p align="center">Built with ❤️ for academic integrity</p>
