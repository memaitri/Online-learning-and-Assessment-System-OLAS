# OLAS — Online Learning and Assessment System

> A full-stack, AI-powered online examination platform built for educational institutions that need secure, monitored, and fair assessments — without the need for physical invigilation.

---

## Table of Contents

- [The Problem We're Solving](#the-problem-were-solving)
- [Who Benefits](#who-benefits)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Project Structure](#project-structure)
- [AI Proctoring System](#ai-proctoring-system)
- [Randomised Question Assignment](#randomised-question-assignment)
- [Audio Proctoring](#audio-proctoring)
- [API Reference](#api-reference)
- [License](#license)

---

## The Problem We're Solving

Online assessments are broken. When students take exams remotely, institutions face a simple but hard problem: **how do you ensure academic integrity without a physical invigilator in the room?**

Common issues with existing solutions:

- **Cheating is easy** — students can switch tabs, open notes, use their phone, or have someone else in the room without any detection.
- **Question sharing** — when all students get the same question, answers circulate within minutes via WhatsApp or Discord.
- **Faculty have no visibility** — they submit the exam and hope for the best, with no insight into what happened during the session.
- **Proctoring tools are expensive** — enterprise solutions like ProctorU cost thousands per institution and require students to install heavyweight software.
- **Code exams have no execution** — most LMS platforms don't let students actually run and test their code during the exam.

OLAS solves all of this in a single open-source platform. It combines a fully functional coding examination environment with an AI proctoring engine that monitors students in real time — detecting phones, multiple people, gaze direction, and suspicious audio — while giving faculty complete live visibility into every session.

---

## Who Benefits

### Students
Get a fair, transparent exam experience with a professional code editor, instant code execution, and clear rules. No surprises, no ambiguity.

### Faculty / Instructors
Create exams in minutes, upload question banks from Word or text files, assign questions randomly to prevent sharing, and watch every student's session live — including their risk score, violations, and submitted code.

### Academic Institutions
Deploy a full proctoring and assessment system without paying enterprise licensing fees. Self-host it, own the data, and customise it to your institution's needs.

### Students in Remote / Hybrid Programs
Participate in proctored assessments from home without needing to travel to a testing centre or install heavyweight proctoring agents.

---

## Features

### For Students

| Feature | Description |
|---|---|
| **Secure Login** | JWT-based authentication with role enforcement |
| **Dashboard** | View enrolled classes, upcoming exams, active exams, and past results |
| **Fullscreen Enforcement** | Exam automatically enters fullscreen; exiting counts as a violation |
| **Monaco Code Editor** | The same engine powering VS Code — syntax highlighting, autocomplete, multiple languages |
| **Multi-language Support** | Write and run code in JavaScript, Python, Java, C, or C++ |
| **Code Execution** | Run code with custom input and see stdout/stderr instantly |
| **Test Cases** | Test code against faculty-defined test cases before submitting |
| **Per-question Submission** | Submit each question independently; faculty sees it immediately |
| **Randomised Question** | Each student gets a unique question from the bank (if faculty enables it) |
| **Real-time Timer** | Countdown with auto-submit when time expires |
| **Anti-cheat Controls** | Blocks tab switching, copy/paste, right-click, DevTools, and keyboard shortcuts |
| **AI Webcam Monitoring** | Real-time risk scoring via webcam — phone, face count, gaze, head pose |
| **Audio Monitoring** | Microphone-based speech and noise detection |
| **Violation Tracking** | Each violation is logged with timestamp and type |
| **Session Resume** | Reconnect and continue an in-progress exam if connection drops |

### For Faculty

| Feature | Description |
|---|---|
| **Exam Creation** | Set title, class, start/end times, duration, language options, and max violations |
| **Question Bank Upload** | Upload `.txt`, `.doc`, or `.docx` — questions auto-extracted and editable |
| **Manual Questions** | Add or edit questions directly in the exam creation form |
| **Random Assignment** | Toggle to assign unique questions per student from the uploaded bank |
| **Assignment Preview** | See exactly which student gets which question before publishing |
| **Reproducible Seed** | Set a seed number for identical distributions across re-runs (audit-friendly) |
| **Two Assignment Modes** | Unique (no repeats) or Allow Repetition (for large cohorts) |
| **Live Exam Monitor** | Real-time view of all active students, their risk levels, violation counts, and submission status |
| **Code Review** | Read each student's submitted code per question inline |
| **Grading** | Assign score and written feedback per submission |
| **Student Blocking** | Block a student mid-exam if violations exceed threshold |
| **Unblock Students** | Manually unblock a student and reset their violation count |
| **Proctoring Reports** | View the full AI session report after exam ends |

### For Admins

| Feature | Description |
|---|---|
| **User Management** | Create, view, reset passwords, and delete users across all roles |
| **Class Management** | View and delete all classes and their enrolments |
| **Exam Oversight** | Monitor all exams across all faculty |
| **System-wide Stats** | Total users, classes, exams, and violations at a glance |

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Frontend** | React 18, Vite 5 | UI framework and dev server |
| **Styling** | Tailwind CSS 3 | Utility-first CSS |
| **Code Editor** | Monaco Editor (`@monaco-editor/react`) | In-browser VS Code engine |
| **Routing** | React Router v6 | Client-side navigation |
| **HTTP Client** | Axios | REST API calls |
| **Real-time** | Socket.IO (client + server) | Live exam monitoring and violation push |
| **Notifications** | react-hot-toast | In-app toast messages |
| **Backend** | Node.js + Express.js | REST API server |
| **Database** | MySQL 8 | Relational data store |
| **ORM** | Prisma 5 | Type-safe DB queries and migrations |
| **Auth** | JWT (jsonwebtoken) + bcryptjs | Stateless authentication and password hashing |
| **File Parsing** | multer + mammoth | Upload handling and `.docx` → text extraction |
| **Code Execution** | Sandboxed subprocess (Node.js `vm` / shell) | Safe code runner |
| **AI Engine** | Python 3.10+, MediaPipe 0.10, OpenCV | Face detection and landmark tracking |
| **Object Detection** | YOLOv8n (ultralytics) | Real-time phone detection |
| **Audio Detection** | PyAudio | Microphone-based speech and noise analysis |
| **Risk Engine** | Custom Python scoring engine | Cumulative 0–100 risk score per session |
| **Edge Proxy** | Cloudflare Workers (TypeScript) | Supabase reverse proxy |
| **Process Bridge** | Node.js `child_process.spawn` + stdin/stdout pipes | Node ↔ Python IPC |

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
│  Question Bank · Proctoring Controller · Code Sandbox          │
│                        │                                       │
│          proctoringService.js  ←──  stdin/stdout pipe          │
└───────────────────────┬────────────────────────────────────────┘
                        │ spawn()
                        ▼
┌────────────────────────────────────────────────────────────────┐
│         Python AI Engine  (frame_server.py)                    │
│  FaceDetector · FaceMesh · GazeTracker · HeadPoseEstimator     │
│  PhoneService (YOLOv8) · AudioDetector · RiskService (0–100)   │
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
pip install mediapipe opencv-python numpy ultralytics pyaudio mammoth
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
│   ├── audio_detection/            # Microphone speech detector
│   │   ├── audio_detector.py
│   │   ├── audio_service.py        # Background thread
│   │   └── audio_models.py
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

The proctoring engine runs as a Python subprocess spawned by Node.js. The browser sends webcam frames to the Node server, which pipes them through to the Python engine over OS stdin/stdout using a line-delimited JSON protocol.

### What It Detects

| Detection | Method | Details |
|---|---|---|
| **Face presence** | MediaPipe BlazeFace | Detects 0, 1, or multiple faces |
| **Face landmarks** | MediaPipe FaceLandmarker | 478-point mesh per face |
| **Gaze direction** | Iris ratio geometry | LEFT / RIGHT / UP / DOWN / CENTER |
| **Head pose** | Transformation matrix | Yaw / pitch / roll in degrees |
| **Phone usage** | YOLOv8n (COCO class 67) | Detects mobile phones in frame |
| **Audio / speech** | PyAudio RMS analysis | Sustained speech or sudden noise spikes |
| **Tab switching** | Browser focus events | Injected from frontend via violation API |
| **Fullscreen exit** | Fullscreen change events | Injected from frontend via violation API |
| **Copy / paste** | Keyboard event listeners | Injected from frontend via violation API |
| **DevTools** | Window size heuristics | Injected from frontend via violation API |

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

| Event | Points Added |
|---|---|
| Phone detected | +50 |
| Multiple faces in frame | +30 |
| No face detected | +15 |
| Head turned away | +8 |
| Looking away (gaze) | +5 |
| Speech detected (audio) | +10 |
| Noise spike | +20 |
| Tab switch / fullscreen exit | +10 |

### Risk Levels

| Score | Level | Colour |
|---|---|---|
| 0–20 | SAFE | Green |
| 21–40 | LOW | Light green |
| 41–60 | MEDIUM | Yellow |
| 61–80 | HIGH | Orange |
| 81–100 | CRITICAL | Red |

---

## Randomised Question Assignment

Faculty can upload a question bank (`.txt`, `.doc`, `.docx`) and enable random assignment when creating an exam. This prevents students from sharing answers because each student gets a different question.

### Assignment Modes

| Mode | Behaviour |
|---|---|
| **Unique Assignment** | No question repeats until all questions are exhausted |
| **Allow Repetition** | Multiple students can receive the same question (useful when students > questions) |

### Reproducible Seed

Setting a **Random Seed** (e.g. `42`) guarantees the same distribution every time — useful for re-evaluation, appeals, and audit trails.

### Workflow

1. Create exam → Upload `.txt`/`.doc`/`.docx` or add questions manually
2. Toggle **🎲 Random Question Assignment**
3. Set questions per student and choose mode
4. Click **👁 Preview Allocation** — see exactly which student gets which question before saving
5. Click **Create Exam & Assign Questions** — assignments written to DB atomically
6. Students see only their assigned question with a 🔒 badge

---

## Audio Proctoring

The audio module runs as a background thread inside the Python engine, analysing the student's microphone in real time.

| Setting | Default | Description |
|---|---|---|
| Sample rate | 16,000 Hz | Standard for speech detection |
| Chunk size | 1,024 frames | ~64 ms per analysis window |
| RMS speech threshold | 500 | Normal speech detection sensitivity |
| RMS spike threshold | 4,000 | Sudden shout or loud noise |
| Speech timeout | 3 seconds | Sustained speech before violation fires |

Violations are fed directly into the risk engine and appear on the faculty monitor in real time.

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
| PUT | `/api/exams/:id` | Edit exam |
| DELETE | `/api/exams/:id` | Delete exam |
| POST | `/api/exams/:id/start` | Start exam session |
| POST | `/api/exams/:id/submit` | Submit exam |
| GET | `/api/exams/:id/sessions` | All student sessions (faculty) |

### Submissions
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/submissions` | Submit code for a question |
| GET | `/api/submissions/exam/:id` | Get all submissions for an exam |
| POST | `/api/submissions/:id/grade` | Grade a submission |

### Violations
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/violations` | Record a violation |
| GET | `/api/violations/session/:id` | Get violations for a session |
| POST | `/api/violations/unblock` | Unblock a student |

### Question Bank
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/question-bank/upload` | Parse uploaded file |
| POST | `/api/question-bank/save` | Save question bank |
| GET | `/api/question-bank/:examId` | Get bank for exam |
| POST | `/api/question-bank/:examId/assign` | Assign questions randomly |
| GET | `/api/question-bank/:examId/assignments` | Faculty assignment view |
| GET | `/api/question-bank/:examId/my-question` | Student's assigned question |

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
