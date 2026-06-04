# proctoring/config.py
# Central configuration for the proctoring system.
# Adjust these values to tune behavior without touching core logic.

# -------------------------------------------------------------------
# Webcam settings
# -------------------------------------------------------------------
CAMERA_INDEX: int = 0          # 0 = default system camera; change to 1, 2 … for external cams
FRAME_WIDTH: int = 1280        # Requested capture width  (pixels)
FRAME_HEIGHT: int = 720        # Requested capture height (pixels)

# -------------------------------------------------------------------
# Display / overlay settings
# -------------------------------------------------------------------
WINDOW_TITLE: str = "OLAS Proctoring - Module 7: Risk Scoring Engine"
FPS_FONT_SCALE: float = 0.8
FPS_COLOR: tuple = (0, 255, 0)          # BGR green
FPS_THICKNESS: int = 2
FPS_POSITION: tuple = (15, 35)          # (x, y) of the FPS label

STATUS_FONT_SCALE: float = 0.55
STATUS_COLOR: tuple = (255, 255, 255)   # white
STATUS_THICKNESS: int = 1
STATUS_POSITION: tuple = (15, 65)       # (x, y) of the status label

# -------------------------------------------------------------------
# Quit key
# -------------------------------------------------------------------
QUIT_KEY: str = "q"

# -------------------------------------------------------------------
# Module 2 — Face Detection
# -------------------------------------------------------------------

# Path to the BlazeFace TFLite model (MediaPipe Tasks API).
# Download: https://storage.googleapis.com/mediapipe-models/face_detector/
#           blaze_face_short_range/float16/1/blaze_face_short_range.tflite
FACE_DETECTION_MODEL: str = "blaze_face_short_range.tflite"

# Minimum confidence score (0.0–1.0) for a detection to be accepted.
# Lower values catch more faces but increase false positives.
FACE_DETECTION_CONFIDENCE: float = 0.5

# Thickness (px) of the bounding box rectangle drawn around each face.
BOUNDING_BOX_THICKNESS: int = 2

# BGR colour of the face bounding box.
FACE_BOX_COLOR: tuple = (0, 255, 0)        # green

# BGR colour used for violation text and indicators.
WARNING_COLOR: tuple = (0, 0, 255)         # red

# BGR colour used for "OK / normal" status text.
OK_COLOR: tuple = (0, 255, 0)              # green

# Font scale and thickness for the confidence label above each box.
CONFIDENCE_FONT_SCALE: float = 0.5
CONFIDENCE_THICKNESS: int = 1

# -------------------------------------------------------------------
# Module 3 — Face Mesh Infrastructure
# -------------------------------------------------------------------

# Path to the FaceLandmarker task bundle (MediaPipe Tasks API).
# Download: https://storage.googleapis.com/mediapipe-models/
#           face_landmarker/face_landmarker/float16/1/face_landmarker.task
FACE_MESH_MODEL: str = "face_landmarker.task"

# Maximum number of faces to track simultaneously.
FACE_MESH_MAX_FACES: int = 1

# Confidence thresholds for the three internal stages.
FACE_MESH_DETECTION_CONFIDENCE: float = 0.5   # initial face detection
FACE_MESH_PRESENCE_CONFIDENCE:  float = 0.5   # face still present in frame
FACE_MESH_TRACKING_CONFIDENCE:  float = 0.5   # tracking across frames

# Set True to compute blendshape scores (needed for mouth/blink modules).
# Adds ~2 ms/frame — keep False until Module 6/7.
FACE_MESH_BLENDSHAPES: bool = False

# Set True to output 4×4 transformation matrices per face.
# Required for Module 5 (Head Pose Estimation).
FACE_MESH_TRANSFORM_MATRIX: bool = False

# ── Visualisation ────────────────────────────────────────────────────────────

# Toggle the entire mesh overlay on/off without code changes.
DRAW_FACE_MESH: bool = True

# Radius (px) of each landmark dot drawn on screen.
LANDMARK_RADIUS: int = 1

# BGR colour of individual landmark dots.
LANDMARK_COLOR: tuple = (0, 255, 255)      # cyan

# BGR colour of the tessellation lines connecting mesh landmarks.
MESH_CONNECTION_COLOR: tuple = (0, 180, 180)  # darker cyan

# Thickness of the mesh connection lines.
MESH_LINE_THICKNESS: int = 1

# -------------------------------------------------------------------
# Module 4 — Eye Gaze Tracking
# -------------------------------------------------------------------

# ── Classification thresholds ────────────────────────────────────────────────
# h_ratio (horizontal): 0 = iris at far-left of eye, 1 = iris at far-right.
# v_ratio (vertical):   0 = iris at top of eye,      1 = iris at bottom.
#
# Tune these values to match your camera distance and lighting conditions.
# Start with defaults, then adjust until CENTER feels natural.

GAZE_LEFT_THRESHOLD:  float = 0.40   # h_ratio below this  → LEFT
GAZE_RIGHT_THRESHOLD: float = 0.60   # h_ratio above this  → RIGHT
GAZE_UP_THRESHOLD:    float = 0.40   # v_ratio below this  → UP
GAZE_DOWN_THRESHOLD:  float = 0.70   # v_ratio above this  → DOWN

# Seconds of continuous off-center gaze before a violation fires.
GAZE_AWAY_TIMEOUT: float = 3.0

# ── Visualisation ────────────────────────────────────────────────────────────

# Draw a filled circle at each iris centre.
DRAW_IRIS_CENTERS: bool = True
IRIS_CENTER_RADIUS: int = 4
IRIS_CENTER_COLOR:  tuple = (0, 140, 255)    # BGR orange

# Draw the eye-boundary box used for ratio computation.
DRAW_EYE_BOUNDARIES: bool = True
EYE_BOUNDARY_COLOR:  tuple = (255, 180, 0)   # BGR light-blue
EYE_BOUNDARY_THICKNESS: int = 1

# Draw a gaze-direction vector arrow from each iris centre.
DRAW_GAZE_VECTOR: bool = True
GAZE_VECTOR_COLOR:  tuple = (0, 255, 255)    # cyan
GAZE_VECTOR_LENGTH: int = 30                 # pixels

# -------------------------------------------------------------------
# Module 5 — Head Pose Estimation
# -------------------------------------------------------------------

# ── Classification thresholds (degrees) ──────────────────────────────────────
# Yaw:   positive = head turned to subject's LEFT.  Threshold: left/right check.
# Pitch: positive = head tilted UP.                 Threshold: up/down check.
# Roll:  logged but not used for direction classification (cosmetic tilt).

HEAD_YAW_THRESHOLD:   float = 20.0   # |yaw|   > this → LEFT or RIGHT
HEAD_PITCH_THRESHOLD: float = 15.0   # |pitch| > this → UP   or DOWN
HEAD_ROLL_THRESHOLD:  float = 20.0   # logged only — not used for classification

# Seconds of continuous away-from-FORWARD before a violation fires.
HEAD_AWAY_TIMEOUT: float = 3.0

# ── Visualisation ─────────────────────────────────────────────────────────────

# Draw the nose-direction vector (arrow from nose tip in pose direction).
DRAW_NOSE_VECTOR: bool = True
NOSE_VECTOR_COLOR: tuple = (255, 100, 0)   # BGR blue-ish
NOSE_VECTOR_THICKNESS: int = 3

# Length of the projected nose vector arrow (millimetres in model space).
HEAD_NOSE_VECTOR_LENGTH_MM: float = 50.0

# Draw yaw / pitch / roll values in the debug panel (top-right corner).
DRAW_HEAD_ANGLES: bool = True

# -------------------------------------------------------------------
# Module 6 — Phone Detection (YOLOv8)
# -------------------------------------------------------------------

# Path to the YOLOv8 weights file.
# "yolov8n.pt" is auto-downloaded by ultralytics on first run.
# Replace with "yolov8s.pt" for better accuracy, or a custom .pt file
# for cheat-sheet / calculator / book detection — no code changes needed.
PHONE_MODEL_PATH: str = "yolov8n.pt"

# Minimum YOLO confidence score to accept a detection.
PHONE_CONFIDENCE_THRESHOLD: float = 0.45

# Run YOLO inference every N frames.
# 1 = every frame (highest accuracy, highest CPU cost).
# 5 = every 5th frame (good balance at 30 fps, default).
# Skipped frames reuse the last result (is_stale=True).
PHONE_FRAME_SKIP: int = 5

# When running in headless frame-server mode (frame_server.py), the browser
# sends one frame every 2 seconds — effectively 0.5 fps.  Running YOLO on
# every frame is correct here because there are very few frames.
# frame_server.py overrides this to 1 automatically.
PHONE_FRAME_SKIP_HEADLESS: int = 1

# ── Visualisation ─────────────────────────────────────────────────────────────

# BGR colour of phone bounding boxes.
PHONE_BOX_COLOR: tuple = (0, 165, 255)      # orange

# Thickness of phone bounding box rectangles.
PHONE_BOX_THICKNESS: int = 2

# BGR colour of the confidence label above phone boxes.
PHONE_LABEL_COLOR: tuple = (0, 165, 255)    # orange

# -------------------------------------------------------------------
# Module 7 — Risk Scoring Engine
# -------------------------------------------------------------------
# Weights and thresholds are in risk_engine/risk_config.py.
# These settings control only the visual overlay.

# BGR colours for each RiskLevel (used by draw_risk_overlay in display.py).
# Order: SAFE, LOW, MEDIUM, HIGH, CRITICAL
RISK_COLOR_SAFE:     tuple = (0, 200, 0)       # green
RISK_COLOR_LOW:      tuple = (0, 200, 100)     # light green
RISK_COLOR_MEDIUM:   tuple = (0, 200, 220)     # yellow (BGR)
RISK_COLOR_HIGH:     tuple = (0, 100, 255)     # orange
RISK_COLOR_CRITICAL: tuple = (0, 0, 255)       # red

# -------------------------------------------------------------------
# Logging
# -------------------------------------------------------------------
LOG_DIR: str = "logs"                      # relative to the proctoring/ directory
LOG_FILENAME: str = "violations.log"       # plain-text log file
