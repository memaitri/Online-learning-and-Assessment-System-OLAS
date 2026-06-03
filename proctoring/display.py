# proctoring/display.py
# ─────────────────────────────────────────────────────────────────────────────
# Overlay rendering helpers.
# All text and graphics drawn on top of the webcam frame live here.
# Every function mutates *frame* in-place but is side-effect-free otherwise.
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import cv2
import numpy as np

import config
from face_detector import DetectionResult
from violation_tracker import ProctoringStatus


# ─────────────────────────────────────────────────────────────────────────────
# Module 1 helpers  (carried over, kept intact)
# ─────────────────────────────────────────────────────────────────────────────

def draw_fps(frame: np.ndarray, fps: float) -> None:
    """
    Render the current FPS in the top-left corner of *frame* (in-place).

    Parameters
    ----------
    frame : np.ndarray  – BGR image to draw onto.
    fps   : float       – Frames per second to display.
    """
    cv2.putText(
        frame,
        f"FPS: {fps:.1f}",
        config.FPS_POSITION,
        cv2.FONT_HERSHEY_SIMPLEX,
        config.FPS_FONT_SCALE,
        config.FPS_COLOR,
        config.FPS_THICKNESS,
        cv2.LINE_AA,
    )


def draw_status(frame: np.ndarray, message: str) -> None:
    """
    Render a plain status string just below the FPS counter.

    Parameters
    ----------
    frame   : np.ndarray – BGR image to draw onto.
    message : str        – Short status text.
    """
    cv2.putText(
        frame,
        message,
        config.STATUS_POSITION,
        cv2.FONT_HERSHEY_SIMPLEX,
        config.STATUS_FONT_SCALE,
        config.STATUS_COLOR,
        config.STATUS_THICKNESS,
        cv2.LINE_AA,
    )


def draw_quit_hint(frame: np.ndarray) -> None:
    """
    Draw a small 'Press Q to exit' hint in the bottom-left corner.

    Parameters
    ----------
    frame : np.ndarray – BGR image to draw onto.
    """
    h = frame.shape[0]
    cv2.putText(
        frame,
        f"Press '{config.QUIT_KEY.upper()}' to exit",
        (15, h - 15),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.45,
        (200, 200, 200),
        1,
        cv2.LINE_AA,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Module 2 helpers  (face detection overlays)
# ─────────────────────────────────────────────────────────────────────────────

def draw_face_boxes(frame: np.ndarray, result: DetectionResult) -> None:
    """
    Draw a bounding box and confidence label for every detected face.

    Parameters
    ----------
    frame  : np.ndarray      – BGR image to draw onto.
    result : DetectionResult – Output of :meth:`FaceDetector.detect`.
    """
    for face in result.faces:
        bbox = face.bbox

        # ── Bounding rectangle ────────────────────────────────────────────
        cv2.rectangle(
            frame,
            bbox.top_left,
            bbox.bottom_right,
            config.FACE_BOX_COLOR,
            config.BOUNDING_BOX_THICKNESS,
            cv2.LINE_AA,
        )

        # ── Confidence label above the box ────────────────────────────────
        label = f"{face.confidence * 100:.1f}%"
        label_y = max(bbox.y - 8, 15)   # keep label inside the frame

        cv2.putText(
            frame,
            label,
            (bbox.x, label_y),
            cv2.FONT_HERSHEY_SIMPLEX,
            config.CONFIDENCE_FONT_SCALE,
            config.FACE_BOX_COLOR,
            config.CONFIDENCE_THICKNESS,
            cv2.LINE_AA,
        )


def draw_face_count(frame: np.ndarray, face_count: int) -> None:
    """
    Display the total number of detected faces on the overlay panel.

    Positioned on the right side so it does not overlap the left-side
    status block.

    Parameters
    ----------
    frame      : np.ndarray – BGR image to draw onto.
    face_count : int        – Number of faces in the current frame.
    """
    w = frame.shape[1]
    text = f"Faces: {face_count}"

    # Measure text to right-align it with a margin.
    (text_w, _), _ = cv2.getTextSize(
        text, cv2.FONT_HERSHEY_SIMPLEX, 0.75, 2
    )
    x = w - text_w - 15

    cv2.putText(
        frame,
        text,
        (x, 35),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.75,
        config.FPS_COLOR,
        2,
        cv2.LINE_AA,
    )


def draw_violation_counter(frame: np.ndarray, violation_count: int) -> None:
    """
    Display the cumulative violation count below the face count label.

    Parameters
    ----------
    frame           : np.ndarray – BGR image to draw onto.
    violation_count : int        – Total violations recorded so far.
    """
    w = frame.shape[1]
    text = f"Violations: {violation_count}"
    color = config.WARNING_COLOR if violation_count > 0 else config.OK_COLOR

    (text_w, _), _ = cv2.getTextSize(
        text, cv2.FONT_HERSHEY_SIMPLEX, 0.65, 2
    )
    x = w - text_w - 15

    cv2.putText(
        frame,
        text,
        (x, 65),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.65,
        color,
        2,
        cv2.LINE_AA,
    )


def draw_proctoring_status(frame: np.ndarray, status: ProctoringStatus, label: str) -> None:
    """
    Render the current proctoring status in the lower-right corner.

    Uses a filled semi-transparent banner so the text is always readable
    regardless of what is behind it.

    Parameters
    ----------
    frame  : np.ndarray      – BGR image to draw onto.
    status : ProctoringStatus – Current status (controls banner colour).
    label  : str             – Human-readable status string from the tracker.
    """
    h, w = frame.shape[:2]

    # Choose banner colour based on status.
    if status == ProctoringStatus.OK:
        banner_color = (0, 140, 0)          # dark green
    else:
        banner_color = (0, 0, 180)          # dark red

    # ── Draw a filled rectangle as the banner background ─────────────────
    banner_h = 40
    banner_y = h - banner_h
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, banner_y), (w, h), banner_color, -1)
    cv2.addWeighted(overlay, 0.55, frame, 0.45, 0, frame)   # semi-transparent

    # ── Measure text to centre it in the banner ───────────────────────────
    font_scale = 0.65
    thickness = 2
    (text_w, text_h), _ = cv2.getTextSize(
        label, cv2.FONT_HERSHEY_SIMPLEX, font_scale, thickness
    )
    text_x = (w - text_w) // 2
    text_y = banner_y + (banner_h + text_h) // 2

    cv2.putText(
        frame,
        label,
        (text_x, text_y),
        cv2.FONT_HERSHEY_SIMPLEX,
        font_scale,
        (255, 255, 255),
        thickness,
        cv2.LINE_AA,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Module 3 helpers  (face mesh overlays)
# ─────────────────────────────────────────────────────────────────────────────

# Lazy import — only pulled in when face mesh drawing functions are called.
from face_mesh_detector import MeshDetectionResult, FaceLandmarksResult

# MediaPipe FaceLandmarker tessellation connections (468-point mesh).
# We import them once at module load and cache the list for performance.
import mediapipe as mp
_FACE_CONNECTIONS: list = list(
    mp.tasks.vision.FaceLandmarksConnections.FACE_LANDMARKS_TESSELATION
)


def draw_face_mesh(frame: np.ndarray, result: MeshDetectionResult) -> None:
    """
    Draw the full face-mesh overlay for every detected face.

    Respects :data:`config.DRAW_FACE_MESH` — if ``False``, this is a no-op
    so callers do not need ``if`` guards.

    Parameters
    ----------
    frame  : np.ndarray         – BGR image to draw onto (mutated in-place).
    result : MeshDetectionResult – Output of :meth:`FaceMeshDetector.detect`.
    """
    if not config.DRAW_FACE_MESH:
        return

    h, w = frame.shape[:2]

    for face in result.faces:
        _draw_mesh_connections(frame, face, w, h)
        _draw_landmark_dots(frame, face, w, h)


def _draw_mesh_connections(
    frame: np.ndarray,
    face: FaceLandmarksResult,
    width: int,
    height: int,
) -> None:
    """
    Draw the tessellation lines between connected landmark pairs.

    Parameters
    ----------
    frame         : np.ndarray          – BGR image (mutated in-place).
    face          : FaceLandmarksResult – Per-face landmark data.
    width, height : int                  – Frame dimensions.
    """
    lm = face.all_landmarks
    for conn in _FACE_CONNECTIONS:
        start_idx = conn.start
        end_idx   = conn.end

        # Guard: iris landmarks (468-477) are not in the tessellation list,
        # but we check bounds to be safe against model version differences.
        if start_idx >= len(lm) or end_idx >= len(lm):
            continue

        pt1 = lm[start_idx].pixel(width, height)
        pt2 = lm[end_idx].pixel(width, height)

        cv2.line(
            frame,
            pt1,
            pt2,
            config.MESH_CONNECTION_COLOR,
            config.MESH_LINE_THICKNESS,
            cv2.LINE_AA,
        )


def _draw_landmark_dots(
    frame: np.ndarray,
    face: FaceLandmarksResult,
    width: int,
    height: int,
) -> None:
    """
    Draw a small filled circle at each landmark position.

    Parameters
    ----------
    frame         : np.ndarray          – BGR image (mutated in-place).
    face          : FaceLandmarksResult – Per-face landmark data.
    width, height : int                  – Frame dimensions.
    """
    for lm in face.all_landmarks:
        cx, cy = lm.pixel(width, height)
        cv2.circle(
            frame,
            (cx, cy),
            config.LANDMARK_RADIUS,
            config.LANDMARK_COLOR,
            -1,         # filled
            cv2.LINE_AA,
        )


def draw_mesh_status(frame: np.ndarray, result: MeshDetectionResult) -> None:
    """
    Overlay a "Face Mesh Active" label and total landmark count.

    Positioned on the left panel below the existing FPS / status rows so
    it does not collide with Module 2 overlays.

    Parameters
    ----------
    frame  : np.ndarray         – BGR image to draw onto (mutated in-place).
    result : MeshDetectionResult – Current detection result.
    """
    # Row 3 — mesh active indicator
    mesh_active = result.face_count > 0
    label       = "Face Mesh: Active" if mesh_active else "Face Mesh: Searching…"
    color       = config.LANDMARK_COLOR if mesh_active else (100, 100, 100)

    cv2.putText(
        frame,
        label,
        (15, 95),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.55,
        color,
        1,
        cv2.LINE_AA,
    )

    # Row 4 — total landmark count across all detected faces
    total_lm = sum(f.landmark_count for f in result.faces)
    cv2.putText(
        frame,
        f"Landmarks: {total_lm}",
        (15, 120),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.50,
        (200, 200, 200),
        1,
        cv2.LINE_AA,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Module 4 helpers  (eye gaze overlays)
# ─────────────────────────────────────────────────────────────────────────────

from gaze_tracker import GazeResult, GazeDirection, EyeMetrics

# Direction → display label (shown in the overlay)
_GAZE_LABELS: dict = {
    GazeDirection.CENTER:  "Gaze: CENTER",
    GazeDirection.LEFT:    "Gaze: LEFT",
    GazeDirection.RIGHT:   "Gaze: RIGHT",
    GazeDirection.UP:      "Gaze: UP",
    GazeDirection.DOWN:    "Gaze: DOWN",
    GazeDirection.UNKNOWN: "Gaze: --",
}

# Direction → arrow vector (dx, dy) used when DRAW_GAZE_VECTOR is True
_GAZE_ARROW: dict = {
    GazeDirection.LEFT:   (-1,  0),
    GazeDirection.RIGHT:  ( 1,  0),
    GazeDirection.UP:     ( 0, -1),
    GazeDirection.DOWN:   ( 0,  1),
    GazeDirection.CENTER: ( 0,  0),
    GazeDirection.UNKNOWN:( 0,  0),
}


def draw_gaze_overlay(
    frame: np.ndarray,
    gaze_results: list,          # List[GazeResult]
    violation_active: bool,
    seconds_away: float,
    gaze_violation_count: int,
) -> None:
    """
    Master gaze drawing function — call this once per frame.

    Renders:
    • Iris centre dots
    • Eye boundary rectangles (used for ratio computation)
    • Gaze-direction vector arrows
    • Gaze direction label (left panel, row 5)
    • Gaze violation counter and timer (left panel, rows 6-7)

    Parameters
    ----------
    frame                : np.ndarray      – BGR image (mutated in-place).
    gaze_results         : List[GazeResult]– One per detected face.
    violation_active     : bool            – Is the sustained-away timer live?
    seconds_away         : float           – How long gaze has been away.
    gaze_violation_count : int             – Total gaze violations so far.
    """
    h, w = frame.shape[:2]

    for result in gaze_results:
        # ── Per-eye geometry visuals ──────────────────────────────────────
        if result.left_eye is not None:
            _draw_single_eye(frame, result.left_eye, w, h, result.direction)
        if result.right_eye is not None:
            _draw_single_eye(frame, result.right_eye, w, h, result.direction)

    # ── Left panel text rows (below Module 3 rows at y=95, y=120) ────────

    # Row 5 — gaze direction label
    primary = gaze_results[0] if gaze_results else None
    direction = primary.direction if primary else GazeDirection.UNKNOWN
    label     = _GAZE_LABELS.get(direction, "Gaze: --")
    gaze_color = (
        config.OK_COLOR      if direction == GazeDirection.CENTER  else
        (100, 100, 100)      if direction == GazeDirection.UNKNOWN else
        config.WARNING_COLOR
    )
    cv2.putText(frame, label, (15, 150),
                cv2.FONT_HERSHEY_SIMPLEX, 0.60, gaze_color, 2, cv2.LINE_AA)

    # Row 6 — gaze violation count
    gv_color = config.WARNING_COLOR if gaze_violation_count > 0 else config.OK_COLOR
    cv2.putText(frame, f"Gaze Violations: {gaze_violation_count}", (15, 178),
                cv2.FONT_HERSHEY_SIMPLEX, 0.50, gv_color, 1, cv2.LINE_AA)

    # Row 7 — live away timer (only shown while timer is running)
    if violation_active or seconds_away > 0.1:
        timer_color = config.WARNING_COLOR if violation_active else (255, 165, 0)
        timer_label = (
            f"Away: {seconds_away:.1f}s"
            + (" [VIOLATION]" if violation_active else "")
        )
        cv2.putText(frame, timer_label, (15, 203),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.48, timer_color, 1, cv2.LINE_AA)


def _draw_single_eye(
    frame: np.ndarray,
    eye: EyeMetrics,
    width: int,
    height: int,
    direction: GazeDirection,
) -> None:
    """
    Draw iris dot, eye boundary, and optional gaze vector for one eye.

    Parameters
    ----------
    frame     : np.ndarray    – BGR image (mutated in-place).
    eye       : EyeMetrics    – Geometry for one eye.
    width, height : int       – Frame dimensions in pixels.
    direction : GazeDirection – Current classified direction (for arrow).
    """
    # Convert normalised → pixel
    iris_px  = (int(eye.iris_x  * width), int(eye.iris_y * height))
    left_px  = (int(eye.eye_left_x  * width), int(eye.iris_y  * height))
    right_px = (int(eye.eye_right_x * width), int(eye.iris_y  * height))
    top_px   = (int(eye.iris_x * width), int(eye.eye_top_y    * height))
    bot_px   = (int(eye.iris_x * width), int(eye.eye_bottom_y * height))

    # ── Iris centre dot ───────────────────────────────────────────────────
    if config.DRAW_IRIS_CENTERS:
        cv2.circle(frame, iris_px, config.IRIS_CENTER_RADIUS,
                   config.IRIS_CENTER_COLOR, -1, cv2.LINE_AA)

    # ── Eye boundary rectangle ────────────────────────────────────────────
    if config.DRAW_EYE_BOUNDARIES:
        tl = (int(eye.eye_left_x  * width), int(eye.eye_top_y    * height))
        br = (int(eye.eye_right_x * width), int(eye.eye_bottom_y * height))
        cv2.rectangle(frame, tl, br,
                      config.EYE_BOUNDARY_COLOR,
                      config.EYE_BOUNDARY_THICKNESS,
                      cv2.LINE_AA)

    # ── Gaze vector arrow ─────────────────────────────────────────────────
    if config.DRAW_GAZE_VECTOR and direction not in (
        GazeDirection.CENTER, GazeDirection.UNKNOWN
    ):
        dx, dy = _GAZE_ARROW.get(direction, (0, 0))
        L = config.GAZE_VECTOR_LENGTH
        end_px = (iris_px[0] + dx * L, iris_px[1] + dy * L)
        cv2.arrowedLine(frame, iris_px, end_px,
                        config.GAZE_VECTOR_COLOR, 2,
                        cv2.LINE_AA, tipLength=0.35)


def draw_gaze_ratios(frame: np.ndarray, result: GazeResult) -> None:
    """
    Draw a small debug panel showing the raw h/v ratios and confidence.

    Positioned in the top-right corner below the existing counters.
    Useful during threshold calibration — can be toggled via config.

    Parameters
    ----------
    frame  : np.ndarray  – BGR image (mutated in-place).
    result : GazeResult  – Current gaze result.
    """
    w = frame.shape[1]
    lines = [
        f"H-ratio: {result.horizontal_ratio:.2f}",
        f"V-ratio: {result.vertical_ratio:.2f}",
        f"Conf:    {result.confidence:.2f}",
    ]
    for i, line in enumerate(lines):
        (tw, _), _ = cv2.getTextSize(line, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
        cv2.putText(frame, line, (w - tw - 15, 95 + i * 22),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (180, 180, 180), 1, cv2.LINE_AA)


# ─────────────────────────────────────────────────────────────────────────────
# Module 5 helpers  (head pose overlays)
# ─────────────────────────────────────────────────────────────────────────────

from head_pose_estimator import HeadPoseResult, HeadDirection

# Direction → display label
_HEAD_LABELS: dict = {
    HeadDirection.FORWARD: "Head: FORWARD",
    HeadDirection.LEFT:    "Head: LEFT",
    HeadDirection.RIGHT:   "Head: RIGHT",
    HeadDirection.UP:      "Head: UP",
    HeadDirection.DOWN:    "Head: DOWN",
    HeadDirection.UNKNOWN: "Head: --",
}


def draw_head_pose_overlay(
    frame: np.ndarray,
    pose_results: list,           # List[HeadPoseResult]
    violation_active: bool,
    seconds_away: float,
    head_violation_count: int,
) -> None:
    """
    Master head-pose drawing function — call this once per frame.

    Renders:
    • Nose direction vector (arrow) for each face
    • Head direction label       (left panel, row 8)
    • Head violation counter     (left panel, row 9)
    • Live away-timer            (left panel, row 10)

    Parameters
    ----------
    frame                : np.ndarray        – BGR image (mutated in-place).
    pose_results         : List[HeadPoseResult] – One per detected face.
    violation_active     : bool              – Timer currently exceeded?
    seconds_away         : float             – Seconds in current episode.
    head_violation_count : int               – Total head violations so far.
    """
    # ── Per-face nose vector ──────────────────────────────────────────────
    for result in pose_results:
        if result.direction != HeadDirection.UNKNOWN and config.DRAW_NOSE_VECTOR:
            _draw_nose_vector(frame, result)

    # ── Left panel rows 8-10 (y=228, 253, 278) ───────────────────────────
    primary   = pose_results[0] if pose_results else None
    direction = primary.direction if primary else HeadDirection.UNKNOWN
    label     = _HEAD_LABELS.get(direction, "Head: --")
    head_color = (
        config.OK_COLOR      if direction == HeadDirection.FORWARD else
        (100, 100, 100)      if direction == HeadDirection.UNKNOWN else
        config.WARNING_COLOR
    )

    # Row 8 — head direction label
    cv2.putText(frame, label, (15, 228),
                cv2.FONT_HERSHEY_SIMPLEX, 0.60, head_color, 2, cv2.LINE_AA)

    # Row 9 — head violation count
    hv_color = config.WARNING_COLOR if head_violation_count > 0 else config.OK_COLOR
    cv2.putText(frame, f"Head Violations: {head_violation_count}", (15, 253),
                cv2.FONT_HERSHEY_SIMPLEX, 0.50, hv_color, 1, cv2.LINE_AA)

    # Row 10 — live away timer
    if violation_active or seconds_away > 0.1:
        tc = config.WARNING_COLOR if violation_active else (255, 165, 0)
        tl = (
            f"Head Away: {seconds_away:.1f}s"
            + (" [VIOLATION]" if violation_active else "")
        )
        cv2.putText(frame, tl, (15, 278),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.48, tc, 1, cv2.LINE_AA)


def _draw_nose_vector(frame: np.ndarray, result: HeadPoseResult) -> None:
    """
    Draw an arrow from the nose tip along the estimated head-pose direction.

    Parameters
    ----------
    frame  : np.ndarray     – BGR image (mutated in-place).
    result : HeadPoseResult – Contains pre-projected nose tip and end pixels.
    """
    tip = result.nose_tip_px
    end = result.nose_end_px

    # Guard against degenerate projections far outside frame bounds.
    h, w = frame.shape[:2]
    for pt in (tip, end):
        if not (0 <= pt[0] < w * 3 and 0 <= pt[1] < h * 3):
            return

    cv2.arrowedLine(
        frame,
        tip,
        end,
        config.NOSE_VECTOR_COLOR,
        config.NOSE_VECTOR_THICKNESS,
        cv2.LINE_AA,
        tipLength=0.3,
    )


def draw_head_angles(frame: np.ndarray, result: HeadPoseResult) -> None:
    """
    Draw yaw / pitch / roll values in the debug panel (top-right corner),
    below the gaze ratios from Module 4.

    Respects :data:`config.DRAW_HEAD_ANGLES`.

    Parameters
    ----------
    frame  : np.ndarray     – BGR image (mutated in-place).
    result : HeadPoseResult – Current head pose result.
    """
    if not config.DRAW_HEAD_ANGLES:
        return

    w = frame.shape[1]
    lines = [
        f"Yaw:   {result.yaw:+.1f}°",
        f"Pitch: {result.pitch:+.1f}°",
        f"Roll:  {result.roll:+.1f}°",
    ]
    # Start below the gaze debug rows (which end at y ≈ 95 + 3*22 = 161)
    y_start = 165
    for i, line in enumerate(lines):
        (tw, _), _ = cv2.getTextSize(line, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
        cv2.putText(frame, line, (w - tw - 15, y_start + i * 22),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (180, 180, 180), 1, cv2.LINE_AA)


# ─────────────────────────────────────────────────────────────────────────────
# Module 6 helpers  (phone detection overlays)
# ─────────────────────────────────────────────────────────────────────────────

from phone_detection.phone_models import PhoneDetectionResult


def draw_phone_overlay(
    frame: np.ndarray,
    result: PhoneDetectionResult,
    violation_count: int,
) -> None:
    """
    Master phone-detection drawing function — call once per frame.

    Renders:
    • Orange bounding box + confidence label for each detected phone
    • Left panel row 11 — phone status label
    • Left panel row 12 — phone violation count
    • Left panel row 13 — inference time (green when fresh, grey when stale)

    Parameters
    ----------
    frame           : np.ndarray            – BGR image (mutated in-place).
    result          : PhoneDetectionResult  – Latest result from PhoneService.
    violation_count : int                   – Total phone violation episodes.
    """
    # ── Phone bounding boxes ─────────────────────────────────────────────
    for det in result.detections:
        cv2.rectangle(
            frame,
            det.top_left,
            det.bottom_right,
            config.PHONE_BOX_COLOR,
            config.PHONE_BOX_THICKNESS,
            cv2.LINE_AA,
        )
        label = f"{det.label} {det.confidence * 100:.1f}%"
        label_y = max(det.top_left[1] - 8, 15)
        cv2.putText(
            frame, label,
            (det.top_left[0], label_y),
            cv2.FONT_HERSHEY_SIMPLEX, 0.55,
            config.PHONE_LABEL_COLOR, 2, cv2.LINE_AA,
        )

    # ── Left panel rows 11-13 (y = 303, 328, 353) ────────────────────────
    phone_detected = result.phone_count > 0

    # Row 11 — status
    status_label = (
        f"Phone: DETECTED ({result.phone_count})" if phone_detected
        else "Phone: Clear"
    )
    status_color = config.WARNING_COLOR if phone_detected else config.OK_COLOR
    cv2.putText(frame, status_label, (15, 303),
                cv2.FONT_HERSHEY_SIMPLEX, 0.60, status_color, 2, cv2.LINE_AA)

    # Row 12 — violation count
    vc_color = config.WARNING_COLOR if violation_count > 0 else config.OK_COLOR
    cv2.putText(frame, f"Phone Violations: {violation_count}", (15, 328),
                cv2.FONT_HERSHEY_SIMPLEX, 0.50, vc_color, 1, cv2.LINE_AA)

    # Row 13 — inference time (grey when stale / skipped frame)
    if result.inference_time_ms > 0:
        inf_color = (180, 255, 180)   # light green — fresh result
        inf_label = f"YOLO: {result.inference_time_ms:.1f}ms"
    else:
        inf_color = (120, 120, 120)   # grey — stale / skipped
        inf_label = "YOLO: skipped"
    cv2.putText(frame, inf_label, (15, 353),
                cv2.FONT_HERSHEY_SIMPLEX, 0.45, inf_color, 1, cv2.LINE_AA)


# ─────────────────────────────────────────────────────────────────────────────
# Module 7 helpers  (risk score overlay)
# ─────────────────────────────────────────────────────────────────────────────

from risk_engine.risk_models import RiskSnapshot, RiskLevel

# Risk level → BGR colour (from config.py)
def _risk_color(level: RiskLevel) -> tuple:
    """Return the BGR overlay colour for a given RiskLevel."""
    return {
        RiskLevel.SAFE:     config.RISK_COLOR_SAFE,
        RiskLevel.LOW:      config.RISK_COLOR_LOW,
        RiskLevel.MEDIUM:   config.RISK_COLOR_MEDIUM,
        RiskLevel.HIGH:     config.RISK_COLOR_HIGH,
        RiskLevel.CRITICAL: config.RISK_COLOR_CRITICAL,
    }.get(level, config.WARNING_COLOR)


def draw_risk_overlay(frame: np.ndarray, snapshot: RiskSnapshot) -> None:
    """
    Draw the real-time risk score panel in the right-side area of the frame.

    Layout (right-aligned, below the existing debug rows):
    ─────────────────────────────────────────────────────
    • Filled semi-transparent risk-level banner spanning full width,
      anchored to the TOP-right to be clearly visible at a glance.
    • Score gauge bar (horizontal progress bar).
    • Risk level label and numeric score.
    • Last event label.
    • Session elapsed time.
    • Total event count.

    The panel never overlaps the left-side text column (which ends at
    approximately x=300 on a 1280-wide frame) because all text is
    right-aligned, and the score bar is placed in the top-right corner.

    Parameters
    ----------
    frame    : np.ndarray    – BGR image (mutated in-place).
    snapshot : RiskSnapshot  – Latest snapshot from RiskService.
    """
    h, w = frame.shape[:2]
    color = _risk_color(snapshot.level)

    # ── 1. Top-right banner (semi-transparent filled rectangle) ───────────
    banner_h  = 55
    banner_x  = w // 2        # occupies the right half only
    overlay   = frame.copy()
    cv2.rectangle(overlay, (banner_x, 0), (w, banner_h), color, -1)
    cv2.addWeighted(overlay, 0.45, frame, 0.55, 0, frame)

    # ── 2. Risk level + score inside the banner ───────────────────────────
    risk_text = f"RISK: {snapshot.level.value}  {snapshot.score:.1f}/100"
    (tw, th), _ = cv2.getTextSize(risk_text, cv2.FONT_HERSHEY_SIMPLEX, 0.70, 2)
    tx = w - tw - 15
    ty = (banner_h + th) // 2 + 2
    cv2.putText(frame, risk_text, (tx, ty),
                cv2.FONT_HERSHEY_SIMPLEX, 0.70, (255, 255, 255), 2, cv2.LINE_AA)

    # ── 3. Score gauge bar (horizontal, right-aligned) ────────────────────
    bar_y      = banner_h + 10
    bar_h      = 12
    bar_margin = 15
    bar_total_w = w - banner_x - bar_margin * 2
    bar_fill_w  = int(bar_total_w * min(snapshot.score, 100.0) / 100.0)

    # Background track
    cv2.rectangle(frame,
                  (banner_x + bar_margin, bar_y),
                  (w - bar_margin,        bar_y + bar_h),
                  (60, 60, 60), -1)
    # Filled portion
    if bar_fill_w > 0:
        cv2.rectangle(frame,
                      (banner_x + bar_margin, bar_y),
                      (banner_x + bar_margin + bar_fill_w, bar_y + bar_h),
                      color, -1)
    # Border
    cv2.rectangle(frame,
                  (banner_x + bar_margin, bar_y),
                  (w - bar_margin, bar_y + bar_h),
                  (150, 150, 150), 1)

    # ── 4. Detail rows (right-aligned) ────────────────────────────────────
    detail_y_start = bar_y + bar_h + 18
    detail_lines = [
        f"Last: {snapshot.last_event}",
        f"Events: {snapshot.total_events}",
        f"Session: {_fmt_elapsed(snapshot.session_seconds)}",
    ]
    for i, line in enumerate(detail_lines):
        (lw, _), _ = cv2.getTextSize(line, cv2.FONT_HERSHEY_SIMPLEX, 0.42, 1)
        lx = w - lw - 15
        ly = detail_y_start + i * 20
        cv2.putText(frame, line, (lx, ly),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.42, (200, 200, 200), 1, cv2.LINE_AA)


def _fmt_elapsed(seconds: float) -> str:
    """Format elapsed seconds as  MM:SS  for the session timer."""
    m = int(seconds) // 60
    s = int(seconds) % 60
    return f"{m:02d}:{s:02d}"
