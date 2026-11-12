<div align="center">

# 🎓 OLAS
### Online Learning & Assessment System

<p align="center">
  <img src="https://img.shields.io/badge/React-18.2-61DAFB?style=for-the-badge&logo=react&logoColor=white" />
  <img src="https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js&logoColor=white" />
  <img src="https://img.shields.io/badge/Python-3.10+-3776AB?style=for-the-badge&logo=python&logoColor=white" />
  <img src="https://img.shields.io/badge/MySQL-8.0-4479A1?style=for-the-badge&logo=mysql&logoColor=white" />
  <img src="https://img.shields.io/badge/Prisma-5-2D3748?style=for-the-badge&logo=prisma&logoColor=white" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/YOLOv8-Phone%20Detection-FF6B35?style=for-the-badge" />
  <img src="https://img.shields.io/badge/MediaPipe-Face%20AI-00897B?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Socket.IO-Real--Time-010101?style=for-the-badge&logo=socket.io&logoColor=white" />
  <img src="https://img.shields.io/badge/Monaco-Code%20Editor-007ACC?style=for-the-badge&logo=visual-studio-code&logoColor=white" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" />
</p>

<br/>

> **A full-stack, AI-powered online examination platform** built for educational institutions that need secure, monitored, and fair assessments — without the need for physical invigilation.

<br/>

[✨ Features](#-features) • [🛠 Tech Stack](#-tech-stack) • [🏗 Architecture](#-architecture) • [🚀 Getting Started](#-getting-started) • [🤖 AI Proctoring](#-ai-proctoring-system) • [📡 API Reference](#-api-reference)

</div>

---

## 🧩 The Problem We're Solving

Online assessments are broken. When students take exams remotely, institutions face a simple but hard problem: **how do you ensure academic integrity without a physical invigilator in the room?**

| ❌ Common Pain Points | ✅ How OLAS Solves It |
|---|---|
| Students switch tabs, open notes, or use phones | AI webcam + audio monitoring with real-time risk scoring |
| All students share the same question on WhatsApp | Randomised per-student question assignment with seeded RNG |
| Faculty have zero live visibility | Real-time exam monitor with risk levels, code updates, and violation alerts |
| Enterprise proctoring tools cost thousands | Open-source, self-hosted, free forever |
| LMS platforms don't execute code | Built-in sandboxed multi-language code runner |

---

## 👥 Who Benefits

<table>
<tr>
<td align="center" width="25%">

**🎓 Students**

Fair, transparent exam experience with a professional code editor, instant execution, and clear rules.

</td>
<td align="center" width="25%">

**👨‍🏫 Faculty**

Create exams in minutes, upload question banks from Word files, and watch every session live.

</td>
<td align="center" width="25%">

**🏛 Institutions**

Deploy a full proctoring system without enterprise licensing. Self-host it, own your data.

</td>
<td align="center" width="25%">

**🌍 Remote Learners**

Take proctored assessments from home without travelling to a testing centre.

</td>
</tr>
</table>

---

## ✨ Features

### 🎓 Student Experience

| Feature | Description |
|---|---|
| 🔐 **Secure Login** | JWT-based authentication with role enforcement |
| 📊 **Dashboard** | View enrolled classes, upcoming exams, active exams, and past results |
| 🖥 **Fullscreen Enforcement** | Exam auto-enters fullscreen; exiting counts as a violation |
| ⌨️ **Monaco Code Editor** | The same engine powering VS Code — syntax highlighting, autocomplete |
| 🌐 **Multi-language Support** | Write and run code in JavaScript, Python, Java, C, or C++ |
| ▶️ **Code Execution** | Run code with custom input and see stdout/stderr instantly |
| 🧪 **Test Cases** | Test code against faculty-defined test cases before submitting |
| 📤 **Per-question Submission** | Submit each question independently; faculty sees it immediately |
| 🎲 **Randomised Question** | Each student gets a unique question (if faculty enables it) |
| ⏱ **Real-time Timer** | Countdown with auto-submit when time expires |
| 🛡 **Anti-cheat Controls** | Blocks tab switching, copy/paste, right-click, DevTools, keyboard shortcuts |
| 👁 **AI Webcam Monitoring** | Real-time risk scoring — phone, face count, gaze, head pose |
| 🎙 **Audio Monitoring** | Microphone-based speech and noise detection |
| 📋 **Violation Tracking** | Each violation logged with timestamp and type |
| 🔄 **Session Resume** | Reconnect and continue if connection drops |

### 👨‍🏫 Faculty Tools

| Feature | Description |
|---|---|
| 📝 **Exam Creation** | Set title, class, times, duration, languages, and max violations |
| 📁 **Question Bank Upload** | Upload `.txt`, `.doc`, `.docx` — questions auto-extracted |
| ✏️ **Manual Questions** | Add or edit questions directly in the exam creation form |
| 🎲 **Random Assignment** | Toggle to assign unique questions per student from the bank |
| 👁 **Assignment Preview** | See exactly which student gets which question before publishing |
| 🌱 **Reproducible Seed** | Set a seed for identical distributions across re-runs (audit-friendly) |
| 🔀 **Two Assignment Modes** | Unique (no repeats) or Allow Repetition (for large cohorts) |
| 📡 **Live Exam Monitor** | Real-time view of all students — risk level, violations, submission status |
| 💻 **Code Review** | Read each student's submitted code per question inline |
| 🏆 **Grading** | Assign score and written feedback per submission |
| 🚫 **Student Blocking** | Block a student mid-exam if violations exceed threshold |
| ✅ **Unblock Students** | Manually unblock and reset their violation count |
| 📊 **Proctoring Reports** | Full AI session report after the exam ends |

### 🔧 Admin Controls

| Feature | Description |
|---|---|
| 👥 **User Management** | Create, view, reset passwords, and delete users across all roles |
| 🏫 **Class Management** | View and delete all classes and their enrolments |
| 📋 **Exam Oversight** | Monitor all exams across all faculty |
| 📈 **System-wide Stats** | Total users, classes, exams, and violations at a glance |

---

## 🛠 Tech Stack

### 🖥 Frontend

<p>
  <img src="https://img.shields.io/badge/React-18.2-61DAFB?style=flat-square&logo=react" />
  <img src="https://img.shields.io/badge/Vite-5-646CFF?style=flat-square&logo=vite" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-3.4-38B2AC?style=flat-square&logo=tailwind-css" />
  <img src="https://img.shields.io/badge/React_Router-v6-CA4245?style=flat-square&logo=react-router" />
  <img src="https://img.shields.io/badge/Axios-1.6-5A29E4?style=flat-square" />
  <img src="https://img.shields.io/badge/Socket.IO_Client-4.6-010101?style=flat-square&logo=socket.io" />
  <img src="https://img.shields.io/badge/Monaco_Editor-4.6-007ACC?style=flat-square&logo=visual-studio-code" />
</p>

| Package | Version | Role |
|---|---|---|
| React | 18.2 | UI framework |
| Vite | 5 | Dev server and build tool |
| Tailwind CSS | 3.4 | Utility-first styling |
| React Router | v6.21 | Client-side navigation |
| Axios | 1.6 | REST API calls |
| Socket.IO Client | 4.6 | Real-time push events |
| `@monaco-editor/react` | 4.6 | Embedded VS Code editor engine |
| react-hot-toast | 2.4 | In-app toast notifications |

### ⚙️ Backend

<p>
  <img src="https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js" />
  <img src="https://img.shields.io/badge/Express.js-4.18-000000?style=flat-square&logo=express" />
  <img src="https://img.shields.io/badge/Prisma-5.22-2D3748?style=flat-square&logo=prisma" />
  <img src="https://img.shields.io/badge/MySQL-8.0-4479A1?style=flat-square&logo=mysql" />
  <img src="https://img.shields.io/badge/JWT-9.0-000000?style=flat-square&logo=json-web-tokens" />
  <img src="https://img.shields.io/badge/Socket.IO-4.6-010101?style=flat-square&logo=socket.io" />
</p>

| Package | Version | Role |
|---|---|---|
| Node.js | >= 18 | Runtime |
| Express.js | 4.18 | REST API server |
| Socket.IO | 4.6 | WebSocket server |
| Prisma ORM | 5.22 | Type-safe DB access and migrations |
| MySQL | 8.0 | Relational database |
| jsonwebtoken | 9.0 | Stateless JWT authentication |
| bcryptjs | 2.4 | Password hashing |
| multer | 2.2 | Multipart file upload handling |
| mammoth | 1.12 | `.docx` to plain text extraction |
| express-validator | 7.0 | Input validation |

### 🤖 Python AI Engine

<p>
  <img src="https://img.shields.io/badge/Python-3.10+-3776AB?style=flat-square&logo=python" />
  <img src="https://img.shields.io/badge/MediaPipe-0.10-00897B?style=flat-square" />
  <img src="https://img.shields.io/badge/OpenCV-4.x-5C3EE8?style=flat-square&logo=opencv" />
  <img src="https://img.shields.io/badge/YOLOv8-ultralytics-FF6B35?style=flat-square" />
  <img src="https://img.shields.io/badge/PyAudio-audio-FF6B35?style=flat-square" />
  <img src="https://img.shields.io/badge/NumPy-1.x-013243?style=flat-square&logo=numpy" />
</p>

| Library | Role |
|---|---|
| MediaPipe 0.10 | BlazeFace detection + 478-landmark face mesh |
| OpenCV (`cv2`) | Frame decoding and image processing |
| NumPy | Array math operations |
| YOLOv8n (`ultralytics`) | Real-time phone detection (COCO class 67) |
| PyAudio | Microphone speech/noise analysis |

### ☁️ Edge / Infrastructure

| Technology | Role |
|---|---|
| Cloudflare Workers (TypeScript) | Supabase reverse proxy — bypasses ISP DNS blocking |
| Wrangler | Cloudflare Worker deployment tooling |

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                   🌐 Browser (React + Vite)                     │
│   Exam UI · Monaco Editor · WebcamProctor · ProctoringSystem    │
└────────────────────────┬────────────────────────────────────────┘
                         │  REST + Socket.IO
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│            ⚙️  Node.js / Express  (port 5000)                   │
│   Auth · Classes · Exams · Submissions · Violations             │
│   Question Bank · Proctoring Controller · Code Sandbox          │
│                         │                                        │
│          proctoringService.js  ◄──  stdin/stdout pipe           │
└────────────────────────┬────────────────────────────────────────┘
                         │ spawn()
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│          🤖 Python AI Engine  (frame_server.py)                 │
│   FaceDetector · FaceMesh · GazeTracker · HeadPoseEstimator     │
│   PhoneService (YOLOv8) · AudioDetector · RiskService (0–100)   │
└─────────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              🗄️  MySQL Database (Prisma ORM)                    │
│   User · Class · Exam · StudentExamSession                      │
│   Submission · Violation · QuestionBank                         │
│   StudentQuestionAssignment                                      │
└─────────────────────────────────────────────────────────────────┘
```

### 🔌 Node ↔ Python IPC Protocol

The browser sends webcam frames to Node, which pipes them to the Python engine over OS stdin/stdout using line-delimited JSON — no HTTP overhead, no polling.

```
Node → Python stdin:
  <base64-jpeg>\n              →  process frame, return JSON on stdout
  VIOLATION:<json>\n           →  inject browser violation into risk engine
  STOP\n + stdin.close()       →  graceful shutdown, write final report

Python → Node stdout:
  {"frameIndex":42,"riskScore":15.0,"riskLevel":"LOW","faceCount":1,
   "gazeDirection":"CENTER","headDirection":"FORWARD",...}\n
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js >= 18
- Python >= 3.10
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

Visit **[http://localhost:5173](http://localhost:5173)**

### 🔑 Demo Credentials

| Role | Email | Password |
|---|---|---|
| 🔴 Admin | admin@olas.com | admin123 |
| 🟡 Faculty | faculty@olas.com | faculty123 |
| 🟢 Student | student@olas.com | student123 |

---

## 🌍 Environment Variables

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

## 📁 Project Structure

```
OLAS/
├── 🖥  client/                         # React frontend
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
│       ├── context/AuthContext.jsx     # JWT token + user state
│       └── services/
│           ├── api.js                  # Axios + all API functions
│           └── socket.js              # Socket.IO singleton
│
├── ⚙️  server/                         # Node.js + Express backend
│   ├── controllers/                   # 8 controller files (business logic)
│   ├── routes/                        # 8 route files
│   ├── proctoring/
│   │   ├── proctoringController.js
│   │   ├── proctoringRoutes.js
│   │   └── proctoringService.js       # Python subprocess manager
│   ├── middleware/auth.js             # JWT authenticate + authorize
│   ├── sandbox/executor.js            # Sandboxed multi-language code runner
│   ├── sockets/index.js              # Socket.IO handlers
│   ├── prisma/schema.prisma          # Database schema (8 models)
│   ├── utils/db.js                    # Prisma singleton
│   └── server.js                     # Entry point
│
├── 🤖 proctoring/                     # Python AI engine
│   ├── frame_server.py               # Headless entry point (stdin/stdout)
│   ├── main.py                        # Interactive mode (webcam + OpenCV)
│   ├── face_detector.py              # MediaPipe BlazeFace
│   ├── face_mesh_detector.py         # 478-landmark face mesh
│   ├── gaze_tracker.py               # Iris ratio gaze detection
│   ├── head_pose_estimator.py        # Yaw/pitch/roll estimation
│   ├── violation_tracker.py          # Face count state machine
│   ├── phone_detection/              # YOLOv8 phone detector
│   ├── audio_detection/              # Microphone speech detector
│   ├── risk_engine/                  # Scoring engine (0–100)
│   ├── config.py                     # All tunable thresholds
│   └── requirements.txt
│
└── ☁️  olas/                           # Cloudflare Worker
    └── src/index.ts                  # Supabase reverse proxy
```

---

## 🤖 AI Proctoring System

The proctoring engine runs as a **Python subprocess spawned by Node.js**. The browser sends webcam frames to the Node server, which pipes them through to the Python engine over OS stdin/stdout — no network overhead, no polling.

### 🔍 What It Detects

| Detection | Method | Trigger |
|---|---|---|
| 👤 **Face presence** | MediaPipe BlazeFace | 0 or multiple faces in frame |
| 🫥 **Face landmarks** | MediaPipe FaceLandmarker | 478-point mesh per face |
| 👀 **Gaze direction** | Iris ratio geometry | LEFT / RIGHT / UP / DOWN / CENTER |
| 🧭 **Head pose** | Transformation matrix | Yaw / pitch / roll in degrees |
| 📱 **Phone usage** | YOLOv8n (COCO class 67) | Mobile phone detected in frame |
| 🎙 **Audio / speech** | PyAudio RMS analysis | Sustained speech or sudden noise spikes |
| 🔁 **Tab switching** | Browser focus events | Injected from frontend via violation API |
| 🖥 **Fullscreen exit** | Fullscreen change events | Injected from frontend via violation API |
| 📋 **Copy / paste** | Keyboard event listeners | Injected from frontend via violation API |
| 🛠 **DevTools** | Window size heuristics | Injected from frontend via violation API |

### 📊 Risk Score Weights

| Event | Points Added |
|---|---|
| 📱 Phone detected | +50 |
| 👥 Multiple faces in frame | +30 |
| 🔊 Noise spike | +20 |
| 🚫 No face detected | +15 |
| 🗣 Speech detected | +10 |
| 🔁 Tab switch / fullscreen exit | +10 |
| 🧭 Head turned away | +8 |
| 👀 Looking away (gaze) | +5 |

### 🚦 Risk Levels

| Score | Level | Colour |
|---|---|---|
| 0 – 20 | 🟢 SAFE | Green |
| 21 – 40 | 🟩 LOW | Light green |
| 41 – 60 | 🟡 MEDIUM | Yellow |
| 61 – 80 | 🟠 HIGH | Orange |
| 81 – 100 | 🔴 CRITICAL | Red |

---

## 🎲 Randomised Question Assignment

Faculty upload a question bank and enable random assignment. Each student gets a **different question**, making answer-sharing useless.

### Assignment Modes

| Mode | Behaviour |
|---|---|
| **Unique Assignment** | No question repeats until all are exhausted |
| **Allow Repetition** | Multiple students can get the same question (useful when students > questions) |

### Reproducible Seed

Setting a **Random Seed** (e.g. `42`) with a Mulberry32 PRNG + Fisher-Yates shuffle guarantees the **same distribution every run** — perfect for re-evaluation, appeals, and audit trails.

### Workflow

```
1. Create exam → Upload .txt / .doc / .docx or add questions manually
2. Toggle 🎲 Random Question Assignment
3. Set questions per student and choose Unique or Repetition mode
4. Click 👁 Preview Allocation → see the exact student→question map
5. Click Create Exam & Assign Questions → written to DB atomically
6. Students see only their assigned question with a 🔒 badge
```

---

## 🎙 Audio Proctoring

The audio module runs as a **background thread** inside the Python engine, analysing the student's microphone in real time.

| Setting | Default | Description |
|---|---|---|
| Sample rate | 16,000 Hz | Standard for speech detection |
| Chunk size | 1,024 frames | ~64 ms per analysis window |
| RMS speech threshold | 500 | Normal speech detection sensitivity |
| RMS spike threshold | 4,000 | Sudden shout or loud noise |
| Speech timeout | 3 seconds | Sustained speech before violation fires |

Violations are fed directly into the risk engine and appear on the faculty monitor in real time.

---

## 📡 API Reference

### 🔐 Auth
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Register user |
| `POST` | `/api/auth/login` | Login, returns JWT |
| `GET` | `/api/auth/profile` | Get current user |

### 📋 Exams
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/exams` | List exams (role-filtered) |
| `POST` | `/api/exams` | Create exam |
| `PUT` | `/api/exams/:id` | Edit exam |
| `DELETE` | `/api/exams/:id` | Delete exam |
| `POST` | `/api/exams/:id/start` | Start exam session |
| `POST` | `/api/exams/:id/submit` | Submit exam |
| `GET` | `/api/exams/:id/sessions` | All student sessions (faculty) |

### 📤 Submissions
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/submissions` | Submit code for a question |
| `GET` | `/api/submissions/exam/:id` | Get all submissions for an exam |
| `POST` | `/api/submissions/:id/grade` | Grade a submission |

### 🚨 Violations
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/violations` | Record a violation |
| `GET` | `/api/violations/session/:id` | Get violations for a session |
| `POST` | `/api/violations/unblock` | Unblock a student |

### 📚 Question Bank
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/question-bank/upload` | Parse uploaded file |
| `POST` | `/api/question-bank/save` | Save question bank |
| `GET` | `/api/question-bank/:examId` | Get bank for exam |
| `POST` | `/api/question-bank/:examId/assign` | Assign questions randomly |
| `GET` | `/api/question-bank/:examId/assignments` | Faculty assignment view |
| `GET` | `/api/question-bank/:examId/my-question` | Student's assigned question |

### 🤖 Proctoring
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/proctoring/start` | Spawn Python engine |
| `POST` | `/api/proctoring/frame` | Submit webcam frame |
| `POST` | `/api/proctoring/violation` | Record browser violation |
| `GET` | `/api/proctoring/status` | Get live risk data |
| `GET` | `/api/proctoring/report/:sessionId` | Final session report |
| `POST` | `/api/proctoring/stop` | Stop engine, save report |

---

## 📄 License

This project is licensed under the **MIT License** — use it, modify it, deploy it.

---

<div align="center">

Made with ❤️ for academic integrity

**[⬆ back to top](#-olas)**

</div>
