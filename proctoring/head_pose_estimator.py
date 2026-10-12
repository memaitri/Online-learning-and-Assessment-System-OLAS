# proctoring/head_pose_estimator.py
# ─────────────────────────────────────────────────────────────────────────────
# Module 5 — Head Pose Estimation
# ─────────────────────────────────────────────────────────────────────────────
#
# Determines where the candidate's head is pointing — FORWARD, LEFT, RIGHT,
# UP, or DOWN — using OpenCV solvePnP.  No ML model is used here.
#
# ┌─────────────────────────────────────────────────────────────────────────┐
# │  MATHEMATICAL FOUNDATION                                                │
# │                                                                         │
# │  We use the classic 6-point head-pose method (Zhu & Ramanan, 2012).    │
# │  The idea: map 6 well-known 3-D face landmarks in a canonical model     │
# │  to their 2-D projections on the camera image, then invert the          │
# │  projection to recover the camera-relative rotation.                    │
# │                                                                         │
# │  Step 1 — 3-D canonical face model                                      │
# │  ───────────────────────────────────                                    │
# │  Six anatomical points in a coordinate system centred at the nose tip,  │
# │  in millimetres (averaged human adult measurements):                    │
# │                                                                         │
# │    Nose tip         (  0,    0,    0)                                   │
# │    Chin             (  0,  -63,  -10)  63 mm below, 10 mm back          │
# │    Left eye corner  (-43,   32,  -26)  43 mm left,  32 mm up            │
# │    Right eye corner ( 43,   32,  -26)  43 mm right, 32 mm up            │
# │    Left mouth       (-28,  -28,  -24)  28 mm left,  28 mm down          │
# │    Right mouth      ( 28,  -28,  -24)  28 mm right, 28 mm down          │
# │                                                                         │
# │  Step 2 — 2-D image points                                              │
# │  ────────────────────────────                                           │
# │  Read the same 6 landmark pixel positions from FaceLandmarksResult      │
# │  (HeadPoseIndex.PNP_POINTS), which were designed in Module 3            │
# │  specifically for this purpose.                                         │
# │                                                                         │
# │  Step 3 — Camera intrinsics (pinhole model)                             │
# │  ────────────────────────────────────────────                           │
# │  We approximate the camera matrix using the focal length heuristic:     │
# │    focal_length ≈ frame_width                                           │
# │    cx = frame_width  / 2                                                │
# │    cy = frame_height / 2                                                │
# │  This is accurate for most webcams at normal distances.                  │
# │                                                                         │
# │  Step 4 — solvePnP                                                      │
# │  ──────────────────                                                     │
# │  cv2.solvePnP(model_3d, image_2d, camera_matrix, dist_coeffs)          │
# │  → rotation vector  rvec  (Rodrigues notation)                          │
# │  → translation vector tvec                                              │
# │                                                                         │
# │  Step 5 — Rodrigues → Euler angles                                      │
# │  ─────────────────────────────────                                      │
# │  R, _ = cv2.Rodrigues(rvec)                                             │
# │  Then decompose R into pitch, yaw, roll using:                          │
# │                                                                         │
# │    pitch = arcsin(-R[2,1])           (nodding: positive = look up)      │
# │    yaw   = arctan2(R[2,0], R[2,2])  (turning: positive = turn left)    │
# │    roll  = arctan2(R[0,1], R[1,1])  (tilting: positive = tilt right)   │
# │                                                                         │
# │  All angles are in degrees after conversion.                            │
# │                                                                         │
# │  Step 6 — Classification                                                │
# │  ─────────────────────────                                              │
# │  Pitch and yaw check take priority over roll.  Ranges (degrees):        │
# │    yaw   < -HEAD_YAW_THRESHOLD   → RIGHT (head turned to own right)     │
# │    yaw   >  HEAD_YAW_THRESHOLD   → LEFT                                 │
# │    pitch < -HEAD_PITCH_THRESHOLD → DOWN  (looking down)                 │
# │    pitch >  HEAD_PITCH_THRESHOLD → UP    (looking up)                   │
# │    otherwise                     → FORWARD                              │
# │                                                                         │
# │  Sign convention follows the right-hand rule with the z-axis pointing   │
# │  out of the camera toward the subject.                                  │
# └─────────────────────────────────────────────────────────────────────────┘
#
# Violation rule
# ──────────────
# When head direction is NOT FORWARD for >= HEAD_AWAY_TIMEOUT seconds
# continuously, a "Head Turned Away" violation fires once per episode.
# The counter resets when the head returns to FORWARD.
# Architecture is identical to GazeViolationTracker (Module 4).
#
# Future compatibility
# ────────────────────
# HeadPoseResult is a frozen dataclass.  Every field is present so
# Risk Scoring, Analytics Dashboard, and Exam Report Generator can
# consume it directly without knowing anything about solvePnP.
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import dataclasses
import math
import time
from enum import Enum, auto
from typing import Callable, Optional, Tuple

import cv2
import numpy as np

import config
from face_mesh_detector import FaceLandmarksResult
from landmark_indices import HeadPoseIndex


# ─────────────────────────────────────────────────────────────────────────────
# 3-D canonical face model (millimetres, nose-centred)
# ─────────────────────────────────────────────────────────────────────────────
# Point order must match HeadPoseIndex.PNP_POINTS exactly:
#   (1) Nose tip, (152) Chin, (226) Left eye corner, (446) Right eye corner,
#   (57) Left mouth, (287) Right mouth.

_MODEL_POINTS_3D: np.ndarray = np.array([
    [  0.0,    0.0,    0.0],   # Nose tip
    [  0.0,  -63.6,  -12.5],   # Chin
    [-43.3,   32.7,  -26.0],   # Left eye outer corner
    [ 43.3,   32.7,  -26.0],   # Right eye outer corner
    [-28.9,  -28.9,  -24.1],   # Left mouth corner
    [ 28.9,  -28.9,  -24.1],   # Right mouth corner
], dtype=np.float64)

# Assume no lens distortion for the webcam approximation.
_DIST_COEFFS: np.ndarray = np.zeros((4, 1), dtype=np.float64)


# ─────────────────────────────────────────────────────────────────────────────
# Enums & data models
# ─────────────────────────────────────────────────────────────────────────────

class HeadDirection(Enum):
    """
    Five possible head orientations classified by HeadPoseEstimator.

    Values are string labels for direct JSON / CSV serialisation.
    """
    FORWARD = "FORWARD"
    LEFT    = "LEFT"     # subject's head turned to THEIR left  (yaw > 0)
    RIGHT   = "RIGHT"    # subject's head turned to THEIR right (yaw < 0)
    UP      = "UP"       # head tilted up   (pitch > 0)
    DOWN    = "DOWN"     # head tilted down (pitch < 0)
    UNKNOWN = "UNKNOWN"  # landmarks missing or solvePnP failed


@dataclasses.dataclass(frozen=True)
class HeadPoseResult:
    """
    Complete, structured output of one HeadPoseEstimator.estimate() call.

    Every field is immutable and self-documenting so downstream consumers
    (Risk Scoring, Analytics Dashboard, Exam Report Generator) can ingest
    it directly.

    Attributes
    ----------
    direction       : HeadDirection — Classified head orientation.
    yaw             : float  — Rotation around Y-axis, degrees.
                               Positive = turned LEFT (subject's perspective).
    pitch           : float  — Rotation around X-axis, degrees.
                               Positive = tilted UP.
    roll            : float  — Rotation around Z-axis, degrees.
                               Positive = tilted RIGHT (subject's perspective).
    nose_tip_px     : Tuple[int, int]  — Nose-tip pixel (x, y) for drawing.
    nose_end_px     : Tuple[int, int]  — Projected nose-direction endpoint.
    is_turned_away  : bool   — True when direction != FORWARD.
    face_index      : int    — Which face this result belongs to.

    Example — downstream usage
    ──────────────────────────
    # Risk scoring
    risk += abs(result.yaw)   / 90.0 * WEIGHT_YAW
    risk += abs(result.pitch) / 90.0 * WEIGHT_PITCH
    if result.is_turned_away:
        risk += WEIGHT_HEAD_AWAY

    # Analytics / report
    report_row = {
        "direction": result.direction.value,
        "yaw":       result.yaw,
        "pitch":     result.pitch,
        "roll":      result.roll,
    }
    """
    direction:      HeadDirection
    yaw:            float
    pitch:          float
    roll:           float
    nose_tip_px:    Tuple[int, int]
    nose_end_px:    Tuple[int, int]
    is_turned_away: bool
    face_index:     int = 0

    @classmethod
    def unknown(cls, face_index: int = 0) -> "HeadPoseResult":
        """
        Sentinel result when landmarks are missing or solvePnP failed.

        Confidence / analytics consumers should disregard results with
        direction == UNKNOWN.
        """
        return cls(
            direction=HeadDirection.UNKNOWN,
            yaw=0.0, pitch=0.0, roll=0.0,
            nose_tip_px=(0, 0),
            nose_end_px=(0, 0),
            is_turned_away=False,
            face_index=face_index,
        )


# ─────────────────────────────────────────────────────────────────────────────
# Head-pose violation state machine
# ─────────────────────────────────────────────────────────────────────────────
# Reuses the exact same pattern as GazeViolationTracker (Module 4).

class _HeadViolationState(Enum):
    """Internal states of the sustained head-turn timer."""
    FORWARD  = auto()   # head is facing forward — no violation
    AWAY     = auto()   # head is turned away — timer running
    VIOLATED = auto()   # timeout exceeded — violation already fired this episode


class HeadViolationTracker:
    """
    Fires a callback exactly once when head direction has been away from
    FORWARD for longer than ``timeout`` seconds continuously.

    Resets to FORWARD as soon as the head returns, allowing a new
    violation to accumulate in the next away episode.

    Parameters
    ----------
    timeout      : float
        Seconds of continuous away-from-FORWARD before a violation fires.
        Defaults to :data:`config.HEAD_AWAY_TIMEOUT`.
    on_violation : callable, optional
        ``on_violation(direction, yaw, pitch, roll, duration_s)`` called
        when the timeout is exceeded.
    """

    def __init__(
        self,
        timeout: float = config.HEAD_AWAY_TIMEOUT,
        on_violation: Optional[
            Callable[[HeadDirection, float, float, float, float], None]
        ] = None,
    ) -> None:
        self._timeout      = timeout
        self._on_violation = on_violation
        self._state        = _HeadViolationState.FORWARD
        self._away_since:  Optional[float] = None
        self._violation_count: int = 0
        # Store last seen yaw/pitch/roll so the callback can log them
        self._last_yaw:   float = 0.0
        self._last_pitch: float = 0.0
        self._last_roll:  float = 0.0

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def update(self, result: HeadPoseResult) -> bool:
        """
        Feed the latest HeadPoseResult and advance the state machine.

        Parameters
        ----------
        result : HeadPoseResult

        Returns
        -------
        bool
            ``True`` when a violation is currently active (timeout exceeded),
            ``False`` otherwise.
        """
        self._last_yaw   = result.yaw
        self._last_pitch = result.pitch
        self._last_roll  = result.roll
        is_away = result.direction not in (
            HeadDirection.FORWARD, HeadDirection.UNKNOWN
        )
        now = time.perf_counter()

        if not is_away:
            self._state      = _HeadViolationState.FORWARD
            self._away_since = None
            return False

        # Head is away ─────────────────────────────────────────────────
        if self._state == _HeadViolationState.FORWARD:
            self._state      = _HeadViolationState.AWAY
            self._away_since = now
            return False

        if self._state == _HeadViolationState.AWAY:
            duration = now - self._away_since   # type: ignore[operator]
            if duration >= self._timeout:
                self._state = _HeadViolationState.VIOLATED
                self._violation_count += 1
                if self._on_violation is not None:
                    self._on_violation(
                        result.direction,
                        self._last_yaw,
                        self._last_pitch,
                        self._last_roll,
                        duration,
                    )
            return self._state == _HeadViolationState.VIOLATED

        return True   # already VIOLATED — stay until FORWARD

    @property
    def violation_count(self) -> int:
        """Total number of distinct head-away violation episodes."""
        return self._violation_count

    @property
    def seconds_away(self) -> float:
        """Seconds in the current away episode; 0.0 when FORWARD."""
        if self._away_since is None:
            return 0.0
        return time.perf_counter() - self._away_since

    @property
    def is_currently_violated(self) -> bool:
        """True if the timeout is currently exceeded."""
        return self._state == _HeadViolationState.VIOLATED

    def reset(self) -> None:
        """Full reset — clears timer, state, and violation count."""
        self._state           = _HeadViolationState.FORWARD
        self._away_since      = None
        self._violation_count = 0


# ─────────────────────────────────────────────────────────────────────────────
# Pure geometry helpers
# ─────────────────────────────────────────────────────────────────────────────

def _build_camera_matrix(width: int, height: int) -> np.ndarray:
    """
    Construct a pinhole camera matrix from frame dimensions.

    Uses the common heuristic  focal_length ≈ frame_width.
    Accurate to within ~5% for most webcams at distances of 0.4–1.5 m.

    Parameters
    ----------
    width, height : int  Frame dimensions in pixels.

    Returns
    -------
    np.ndarray  3×3 camera intrinsic matrix.
    """
    f  = float(width)                    # focal length approximation
    cx = width  / 2.0
    cy = height / 2.0
    return np.array([
        [f,   0.0, cx],
        [0.0, f,   cy],
        [0.0, 0.0, 1.0],
    ], dtype=np.float64)


def _rotation_matrix_to_euler(R: np.ndarray) -> Tuple[float, float, float]:
    """
    Decompose a 3×3 rotation matrix into (pitch, yaw, roll) in degrees.

    Convention (ZYX Euler / Tait-Bryan, camera-aligned):
        pitch : rotation around X — positive = head tilted UP
        yaw   : rotation around Y — positive = head turned LEFT (subject's left)
        roll  : rotation around Z — positive = head tilted RIGHT

    Parameters
    ----------
    R : np.ndarray  3×3 rotation matrix (output of cv2.Rodrigues).

    Returns
    -------
    (pitch, yaw, roll) : Tuple[float, float, float]  All in degrees.
    """
    # Clamp R[2,1] to [-1, 1] to guard against floating-point overflows
    # before arcsin.
    pitch_rad = math.asin(max(-1.0, min(1.0, -R[2, 1])))
    yaw_rad   = math.atan2(R[2, 0], R[2, 2])
    roll_rad  = math.atan2(R[0, 1], R[1, 1])

    pitch_deg = math.degrees(pitch_rad)
    yaw_deg   = math.degrees(yaw_rad)
    roll_deg  = math.degrees(roll_rad)

    return pitch_deg, yaw_deg, roll_deg


def _classify_head_direction(
    yaw: float,
    pitch: float,
) -> HeadDirection:
    """
    Map (yaw, pitch) angles to a HeadDirection using config thresholds.

    Pitch check takes priority over yaw, matching the same vertical-first
    priority used in GazeTracker (Module 4) for consistency.

    Parameters
    ----------
    yaw   : float  Yaw angle in degrees.   Positive = turned LEFT.
    pitch : float  Pitch angle in degrees. Positive = tilted UP.

    Returns
    -------
    HeadDirection
    """
    if pitch > config.HEAD_PITCH_THRESHOLD:
        return HeadDirection.UP
    if pitch < -config.HEAD_PITCH_THRESHOLD:
        return HeadDirection.DOWN
    if yaw > config.HEAD_YAW_THRESHOLD:
        return HeadDirection.LEFT
    if yaw < -config.HEAD_YAW_THRESHOLD:
        return HeadDirection.RIGHT
    return HeadDirection.FORWARD


def _project_nose_vector(
    nose_tip_3d:    np.ndarray,
    rvec:           np.ndarray,
    tvec:           np.ndarray,
    camera_matrix:  np.ndarray,
    length_mm:      float = 50.0,
) -> Tuple[Tuple[int, int], Tuple[int, int]]:
    """
    Project the nose-tip and a point ``length_mm`` in front of it into
    image space to get the two endpoints of the direction arrow.

    Parameters
    ----------
    nose_tip_3d   : 1×3 array  The 3-D nose-tip point from the model.
    rvec, tvec    : PnP output.
    camera_matrix : 3×3 intrinsic matrix.
    length_mm     : How far ahead to project the arrow endpoint (mm).

    Returns
    -------
    (tip_px, end_px) : pixel (x, y) tuples for drawing.
    """
    # Project nose tip
    tip_2d, _ = cv2.projectPoints(
        nose_tip_3d.reshape(1, 3),
        rvec, tvec, camera_matrix, _DIST_COEFFS,
    )
    tip_px = (int(tip_2d[0][0][0]), int(tip_2d[0][0][1]))

    # Project a point along the nose's local z-axis
    nose_forward = nose_tip_3d.copy()
    nose_forward[2] -= length_mm          # move forward (negative z = toward camera)
    end_2d, _ = cv2.projectPoints(
        nose_forward.reshape(1, 3),
        rvec, tvec, camera_matrix, _DIST_COEFFS,
    )
    end_px = (int(end_2d[0][0][0]), int(end_2d[0][0][1]))

    return tip_px, end_px


# ─────────────────────────────────────────────────────────────────────────────
# HeadPoseEstimator — main class
# ─────────────────────────────────────────────────────────────────────────────

class HeadPoseEstimator:
    """
    Estimates head pose from facial landmarks using OpenCV solvePnP.

    Stateless per-frame analysis
    ────────────────────────────
    :meth:`estimate` is a pure transformation: same landmarks + same frame
    dimensions → same result.  No internal state is mutated so it is safe
    to call from multiple faces per frame.

    Violation tracking state
    ────────────────────────
    :attr:`violation_tracker` holds the sustained-away timer.  The main
    loop calls ``estimator.violation_tracker.update(result)`` after each
    :meth:`estimate` call.

    Parameters
    ----------
    on_violation : callable, optional
        Forwarded to :class:`HeadViolationTracker`.
        Signature: ``on_violation(direction, yaw, pitch, roll, duration_s)``.

    Example — typical main-loop usage
    ──────────────────────────────────
        estimator = HeadPoseEstimator(on_violation=handle_head_violation)

        # In the frame loop:
        h, w = frame.shape[:2]
        for face in mesh_result.faces:
            result = estimator.estimate(face, w, h)
            estimator.violation_tracker.update(result)
    """

    def __init__(
        self,
        on_violation: Optional[
            Callable[[HeadDirection, float, float, float, float], None]
        ] = None,
    ) -> None:
        self.violation_tracker = HeadViolationTracker(
            timeout=config.HEAD_AWAY_TIMEOUT,
            on_violation=on_violation,
        )
        # Cache the last camera matrix to avoid rebuilding when frame size
        # is stable (saves one numpy allocation per frame).
        self._last_size:   Tuple[int, int] = (0, 0)
        self._camera_mat:  Optional[np.ndarray] = None

    # ------------------------------------------------------------------
    # Per-frame estimation  (stateless)
    # ------------------------------------------------------------------

    def estimate(
        self,
        face:   FaceLandmarksResult,
        width:  int,
        height: int,
    ) -> HeadPoseResult:
        """
        Compute head pose for a single face.

        Parameters
        ----------
        face          : FaceLandmarksResult
            Output of :meth:`FaceMeshDetector.detect` for one face.
            Must contain the 6 HeadPoseIndex.PNP_POINTS landmarks.
        width, height : int
            Current frame dimensions in pixels (used for camera matrix
            and for pixel coordinate conversion).

        Returns
        -------
        HeadPoseResult
            Structured result with direction, yaw, pitch, roll, and
            pixel-space nose vector for drawing.
            Returns ``HeadPoseResult.unknown()`` on any failure.
        """
        # ── 1. Extract 2-D image points ───────────────────────────────────
        pnp_landmarks = face.head_pose_points   # List[Landmark], 6 items
        if len(pnp_landmarks) < 6:
            return HeadPoseResult.unknown(face.face_index)

        image_points_2d = np.array(
            [lm.pixel(width, height) for lm in pnp_landmarks],
            dtype=np.float64,
        )

        # ── 2. Get (or rebuild) camera matrix ─────────────────────────────
        if (width, height) != self._last_size:
            self._camera_mat  = _build_camera_matrix(width, height)
            self._last_size   = (width, height)

        # ── 3. solvePnP ───────────────────────────────────────────────────
        success, rvec, tvec = cv2.solvePnP(
            _MODEL_POINTS_3D,
            image_points_2d,
            self._camera_mat,
            _DIST_COEFFS,
            flags=cv2.SOLVEPNP_ITERATIVE,
        )

        if not success:
            return HeadPoseResult.unknown(face.face_index)

        # ── 4. Rodrigues → rotation matrix → Euler angles ─────────────────
        R, _ = cv2.Rodrigues(rvec)
        pitch, yaw, roll = _rotation_matrix_to_euler(R)

        # ── 5. Classify direction ─────────────────────────────────────────
        direction = _classify_head_direction(yaw, pitch)

        # ── 6. Project nose direction vector for visualisation ─────────────
        nose_tip_px, nose_end_px = _project_nose_vector(
            _MODEL_POINTS_3D[0],    # nose-tip model point
            rvec, tvec,
            self._camera_mat,       # type: ignore[arg-type]
            length_mm=config.HEAD_NOSE_VECTOR_LENGTH_MM,
        )

        return HeadPoseResult(
            direction=direction,
            yaw=round(yaw, 2),
            pitch=round(pitch, 2),
            roll=round(roll, 2),
            nose_tip_px=nose_tip_px,
            nose_end_px=nose_end_px,
            is_turned_away=(direction != HeadDirection.FORWARD),
            face_index=face.face_index,
        )
