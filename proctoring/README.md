# OLAS Proctoring — Module 1: Webcam Feed

Live webcam viewer with real-time FPS overlay, built as the first module
of the AI-Powered Online Proctoring System.

## Quick Start

```bash
# 1. Create and activate a virtual environment (recommended)
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS / Linux

# 2. Install dependencies
pip install -r requirements.txt

# 3. Run
python main.py
```

Press **Q** (or close the window) to exit.

---

## Project Structure

```
proctoring/
│
├── main.py           ← Entry point; bootstraps the capture loop
├── webcam.py         ← Webcam abstraction (open / read / release)
├── fps_counter.py    ← Rolling-average FPS calculator
├── display.py        ← Overlay rendering helpers (FPS, status, hint)
├── config.py         ← All tuneable settings in one place
├── requirements.txt  ← Python dependencies
└── README.md         ← This file
```

### File-by-file

| File | Responsibility |
|------|---------------|
| `config.py` | Camera index, resolution, colours, font sizes, quit key — edit here to tweak behaviour without touching logic |
| `webcam.py` | `Webcam` class wrapping `cv2.VideoCapture`; supports context-manager usage |
| `fps_counter.py` | `FPSCounter` using a `deque` ring-buffer for smooth FPS averaging |
| `display.py` | Pure functions that draw text overlays onto a frame |
| `main.py` | Wires everything together; handles errors and cleanup |

---

## Configuration (`config.py`)

| Setting | Default | Description |
|---------|---------|-------------|
| `CAMERA_INDEX` | `0` | Which camera to open (0 = built-in, 1 = first external, …) |
| `FRAME_WIDTH` | `1280` | Requested capture width in pixels |
| `FRAME_HEIGHT` | `720` | Requested capture height in pixels |
| `QUIT_KEY` | `"q"` | Key that stops the feed |

---

## What's Next (Module 2)

- Face detection using MediaPipe / dlib
- Head-pose estimation
- Gaze tracking
- Alert system for suspicious behaviour
