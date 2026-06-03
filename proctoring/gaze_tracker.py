# proctoring/gaze_tracker.py
# ─────────────────────────────────────────────────────────────────────────────
# Module 4 — Eye Gaze Tracking
# ─────────────────────────────────────────────────────────────────────────────
#
# Determines where the user is looking — LEFT, RIGHT, UP, DOWN, or CENTER —
# using only landmark geometry from Module 3.  No ML model is used here.
#
# ┌─────────────────────────────────────────────────────────────────────────┐
# │  MATHEMATICAL FOUNDATION                                                │
# │                                                                         │
# │  For each eye we have:                                                  │
# │    • The iris centre landmark (single point)                            │
# │    • The eye contour: outer corner, inner corner, top edge, bottom edge │
# │                                                                         │
# │  Horizontal ratio  h_ratio                                              │
# │  ──────────────────────────                                             │
# │  We measure how far the iris centre sits along the horizontal span      │
# │  of the eye socket:                                                     │
# │                                                                         │
# │      h_ratio = (iris_x - eye_left_x) / (eye_right_x - eye_left_x)      │
# │                                                                         │
# │  Convention (normalised image coords, x increases left→right):         │
# │    • eye_left_x  = outer corner (smaller x for the LEFT eye)            │
# │    • eye_right_x = inner corner (larger  x for the LEFT eye)            │
# │                                                                         │
# │  We average the ratio across both eyes for robustness.                  │
# │                                                                         │
# │  Interpretation:                                                        │
# │    h_ratio < GAZE_LEFT_THRESHOLD  → looking LEFT                        │
# │    h_ratio > GAZE_RIGHT_THRESHOLD → looking RIGHT                       │
# │    otherwise                      → horizontal centre                   │
# │                                                                         │
# │  Vertical ratio  v_ratio                                                │
# │  ────────────────────────                                               │
# │  Same principle on the vertical axis:                                   │
# │                                                                         │
# │      v_ratio = (iris_y - eye_top_y) / (eye_bottom_y - eye_top_y)       │
# │                                                                         │
# │  Interpretation:                                                        │
# │    v_ratio < GAZE_UP_THRESHOLD   → looking UP                           │
# │    v_ratio > GAZE_DOWN_THRESHOLD → looking DOWN                         │
# │    otherwise                     → vertical centre                      │
# │                                                                         │
# │  Confidence                                                             │
# │  ──────────                                                             │
# │  Confidence is the minimum eye-width in normalised coords.              │
# │  A very narrow eye (partially closed or at extreme angle) produces a    │
# │  small eye-width, making the ratio unreliable.  We surface this so      │
# │  downstream consumers (risk scoring, analytics) can down-weight         │
# │  low-confidence readings rather than treating them as hard facts.        │
# │                                                                         │
# │  h_confidence = min(eye_width_left, eye_width_right)                   │
# │  v_confidence = min(eye_height_left, eye_height_right)                 │
# │  confidence   = min(h_confidence, v_confidence)                        │
# │  (clamped to [0, 1])                                                    │
# └─────────────────────────────────────────────────────────────────────────┘
#
# Violation rule
# ──────────────
# When gaze is NOT CENTER for >= GAZE_AWAY_TIMEOUT seconds continuously, a
# "Looking Away" violation fires.  The counter increments only on the
# state *transition* from "sustained off-center" → "reset", following
# exactly the same pattern as ViolationTracker in Module 2.
#
# Future compatibility
# ────────────────────
# GazeResult is a frozen dataclass with all computed values.  It is
# intentionally self-contained so Risk Scoring, Analytics Dashboard,
# and Behavioural Analysis modules can import and aggregate it without
# knowing anything about how the ratios were computed.
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import dataclasses
import time
from enum import Enum, auto
from typing import Callable, List, Optional, Tuple

import config
from face_mesh_detector import FaceLandmarksResult
from landmark_indices import EyeIndex, IrisIndex


# ─────────────────────────────────────────────────────────────────────────────
# Enums & data models
# ─────────────────────────────────────────────────────────────────────────────

class GazeDirection(Enum):
    """
    The five possible gaze directions classified by GazeTracker.

    Values are string labels so they serialise naturally to JSON / CSV
    without extra mapping tables.
    """
    CENTER = "CENTER"
    LEFT   = "LEFT"
    RIGHT  = "RIGHT"
    UP     = "UP"
    DOWN   = "DOWN"
    UNKNOWN = "UNKNOWN"    # emitted when landmarks are absent / unreliable


@dataclasses.dataclass(frozen=True)
class EyeMetrics:
    """
    Intermediate per-eye geometry computed during gaze analysis.

    Kept separate from GazeResult so analytics modules can drill into
    individual eye data if needed.

    Attributes
    ----------
    iris_x, iris_y   : Normalised iris centre coordinates.
    eye_left_x       : Normalised x of the outer eye corner.
    eye_right_x      : Normalised x of the inner eye corner.
    eye_top_y        : Normalised y of the upper eyelid midpoint.
    eye_bottom_y     : Normalised y of the lower eyelid midpoint.
    h_ratio          : Horizontal gaze ratio in [0, 1].
    v_ratio          : Vertical gaze ratio in [0, 1].
    eye_width        : Normalised horizontal eye span (right_x - left_x).
    eye_height       : Normalised vertical eye span (bottom_y - top_y).
    """
    iris_x:      float
    iris_y:      float
    eye_left_x:  float
    eye_right_x: float
    eye_top_y:   float
    eye_bottom_y: float
    h_ratio:     float
    v_ratio:     float
    eye_width:   float
    eye_height:  float


@dataclasses.dataclass(frozen=True)
class GazeResult:
    """
    Complete, structured output of one GazeTracker.analyse() call.

    This is the object that downstream modules (Risk Scoring, Analytics
    Dashboard, Behavioural Analysis) consume.  Every field is immutable
    and self-documenting.

    Attributes
    ----------
    direction        : GazeDirection  — Classified gaze direction.
    horizontal_ratio : float          — Averaged h_ratio across both eyes
                                        (0 = far left, 1 = far right).
    vertical_ratio   : float          — Averaged v_ratio across both eyes
                                        (0 = far up, 1 = far down).
    confidence       : float          — Reliability score in [0, 1].
                                        Low when eyes are mostly closed or
                                        landmarks are at extreme angles.
    left_eye         : EyeMetrics     — Per-eye geometry for the left eye.
    right_eye        : EyeMetrics     — Per-eye geometry for the right eye.
    is_looking_away  : bool           — True when direction != CENTER.
    face_index       : int            — Which face this result belongs to.

    Example — downstream usage
    ──────────────────────────
    # Risk scoring
    risk += (1 - result.confidence) * WEIGHT_GAZE_UNRELIABLE
    if result.is_looking_away:
        risk += WEIGHT_GAZE_AWAY

    # Analytics dashboard
    gaze_log.append({
        "direction":        result.direction.value,
        "h_ratio":          result.horizontal_ratio,
        "v_ratio":          result.vertical_ratio,
        "confidence":       result.confidence,
    })
    """
    direction:        GazeDirection
    horizontal_ratio: float
    vertical_ratio:   float
    confidence:       float
    left_eye:         Optional[EyeMetrics]
    right_eye:        Optional[EyeMetrics]
    is_looking_away:  bool
    face_index:       int = 0

    @classmethod
    def unknown(cls, face_index: int = 0) -> "GazeResult":
        """
        Construct a sentinel GazeResult when landmarks are unavailable.

        All numeric fields are 0.0 and confidence is 0.0 to signal
        that this result should be disregarded by analytics.
        """
        return cls(
            direction=GazeDirection.UNKNOWN,
            horizontal_ratio=0.0,
            vertical_ratio=0.0,
            confidence=0.0,
            left_eye=None,
            right_eye=None,
            is_looking_away=False,
            face_index=face_index,
        )


# ─────────────────────────────────────────────────────────────────────────────
# Gaze violation state machine
# ─────────────────────────────────────────────────────────────────────────────

class GazeViolationState(Enum):
    """Internal states of the sustained-gaze-away timer."""
    CENTER   = auto()   # user is looking at screen — no violation
    AWAY     = auto()   # user is looking away — timer running
    VIOLATED = auto()   # timer exceeded — violation already fired this episode


class GazeViolationTracker:
    """
    Fires a callback exactly once when gaze has been away from CENTER
    for longer than ``timeout`` seconds continuously.

    The counter resets to CENTER as soon as the gaze returns, so a new
    violation can accumulate in the next off-center episode.

    Parameters
    ----------
    timeout     : float
        Seconds of continuous off-center gaze before a violation fires.
        Defaults to :data:`config.GAZE_AWAY_TIMEOUT`.
    on_violation : callable, optional
        ``on_violation(direction, duration_s)`` called when the timeout is
        exceeded.  ``duration_s`` is how long the gaze has been away.
    """

    def __init__(
        self,
        timeout: float = config.GAZE_AWAY_TIMEOUT,
        on_violation: Optional[Callable[[GazeDirection, float], None]] = None,
    ) -> None:
        self._timeout     = timeout
        self._on_violation = on_violation
        self._state        = GazeViolationState.CENTER
        self._away_since:  Optional[float] = None   # perf_counter timestamp
        self._violation_count: int = 0

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def update(self, direction: GazeDirection) -> bool:
        """
        Feed the latest gaze direction and advance the state machine.

        Parameters
        ----------
        direction : GazeDirection
            Current per-frame gaze direction from GazeTracker.

        Returns
        -------
        bool
            ``True`` when a violation is *currently active* (timer
            exceeded), ``False`` otherwise.
        """
        is_away = (direction not in (GazeDirection.CENTER, GazeDirection.UNKNOWN))
        now     = time.perf_counter()

        if not is_away:
            # Back to center — reset regardless of previous state
            self._state      = GazeViolationState.CENTER
            self._away_since = None
            return False

        # Gaze is away ──────────────────────────────────────────────────
        if self._state == GazeViolationState.CENTER:
            # Start the timer
            self._state      = GazeViolationState.AWAY
            self._away_since = now
            return False

        if self._state == GazeViolationState.AWAY:
            duration = now - self._away_since  # type: ignore[operator]
            if duration >= self._timeout:
                # Transition: AWAY → VIOLATED (fire once)
                self._state = GazeViolationState.VIOLATED
                self._violation_count += 1
                if self._on_violation is not None:
                    self._on_violation(direction, duration)
            return self._state == GazeViolationState.VIOLATED

        # Already in VIOLATED state — stay there until gaze returns
        return True

    @property
    def violation_count(self) -> int:
        """Total number of sustained-away violations recorded."""
        return self._violation_count

    @property
    def seconds_away(self) -> float:
        """
        How many seconds the gaze has been away in the current episode.
        Returns 0.0 when gaze is at CENTER.
        """
        if self._away_since is None:
            return 0.0
        return time.perf_counter() - self._away_since

    @property
    def is_currently_violated(self) -> bool:
        """True if the sustained-away violation is currently active."""
        return self._state == GazeViolationState.VIOLATED

    def reset(self) -> None:
        """Full reset — clears timer, state, and violation count."""
        self._state           = GazeViolationState.CENTER
        self._away_since      = None
        self._violation_count = 0


# ─────────────────────────────────────────────────────────────────────────────
# Core geometry helpers  (pure functions — no side effects)
# ─────────────────────────────────────────────────────────────────────────────

def _safe_ratio(numerator: float, denominator: float) -> float:
    """
    Compute numerator / denominator, clamped to [0, 1].

    Returns 0.5 (centre) when the denominator is effectively zero
    (eye fully closed or degenerate geometry) so downstream logic
    stays stable.
    """
    if abs(denominator) < 1e-6:
        return 0.5
    return max(0.0, min(1.0, numerator / denominator))


def _compute_eye_metrics(
    iris_center_x: float,
    iris_center_y: float,
    outer_x:       float,   # eye left/outer corner x
    inner_x:       float,   # eye right/inner corner x
    top_y:         float,   # upper eyelid y (average of top landmarks)
    bottom_y:      float,   # lower eyelid y (average of bottom landmarks)
) -> EyeMetrics:
    """
    Compute gaze ratios and geometry for a single eye.

    All inputs are normalised landmark coordinates (0.0–1.0).

    Parameters
    ----------
    iris_center_x, iris_center_y
        Normalised coordinates of the iris centre landmark.
    outer_x   : x of the temporal (outer) eye corner.
    inner_x   : x of the nasal   (inner) eye corner.
    top_y     : y of the upper eyelid midpoint (average of top landmarks).
    bottom_y  : y of the lower eyelid midpoint (average of bottom landmarks).

    Returns
    -------
    EyeMetrics with h_ratio, v_ratio, eye_width, eye_height computed.
    """
    eye_width  = inner_x - outer_x          # positive when outer < inner
    eye_height = bottom_y - top_y           # positive when top < bottom

    h_ratio = _safe_ratio(iris_center_x - outer_x, eye_width)
    v_ratio = _safe_ratio(iris_center_y - top_y,   eye_height)

    return EyeMetrics(
        iris_x=iris_center_x,
        iris_y=iris_center_y,
        eye_left_x=outer_x,
        eye_right_x=inner_x,
        eye_top_y=top_y,
        eye_bottom_y=bottom_y,
        h_ratio=h_ratio,
        v_ratio=v_ratio,
        eye_width=eye_width,
        eye_height=eye_height,
    )


def _classify_direction(
    h_ratio:   float,
    v_ratio:   float,
) -> GazeDirection:
    """
    Map (h_ratio, v_ratio) to a GazeDirection using config thresholds.

    Vertical check takes priority over horizontal so that looking
    "up-left" reads as UP rather than LEFT, which is the more salient
    signal in a proctoring context.

    Parameters
    ----------
    h_ratio : float  Horizontal ratio in [0, 1].  Low = left, high = right.
    v_ratio : float  Vertical ratio   in [0, 1].  Low = up,   high = down.

    Returns
    -------
    GazeDirection
    """
    if v_ratio < config.GAZE_UP_THRESHOLD:
        return GazeDirection.UP
    if v_ratio > config.GAZE_DOWN_THRESHOLD:
        return GazeDirection.DOWN
    if h_ratio < config.GAZE_LEFT_THRESHOLD:
        return GazeDirection.LEFT
    if h_ratio > config.GAZE_RIGHT_THRESHOLD:
        return GazeDirection.RIGHT
    return GazeDirection.CENTER


# ─────────────────────────────────────────────────────────────────────────────
# GazeTracker — main class
# ─────────────────────────────────────────────────────────────────────────────

class GazeTracker:
    """
    Converts a :class:`FaceLandmarksResult` into a :class:`GazeResult`.

    Stateless per-frame analysis
    ────────────────────────────
    :meth:`analyse` is a pure transformation: same landmarks → same result.
    No internal state is mutated by analysis so it is safe to call from
    multiple threads.

    Violation tracking state
    ────────────────────────
    :attr:`violation_tracker` (a :class:`GazeViolationTracker`) holds the
    sustained-away timer.  Call ``gaze_tracker.violation_tracker.update(result.direction)``
    in the main loop after each :meth:`analyse` call.

    Parameters
    ----------
    on_violation : callable, optional
        Forwarded to :class:`GazeViolationTracker`.
        Signature: ``on_violation(direction: GazeDirection, duration_s: float)``.

    Example — typical main-loop usage
    ───────────────────────────────────
        gaze_tracker = GazeTracker(on_violation=handle_gaze_violation)

        # Inside the frame loop:
        if mesh_result.faces:
            gaze_result = gaze_tracker.analyse(mesh_result.faces[0])
            gaze_tracker.violation_tracker.update(gaze_result.direction)
    """

    def __init__(
        self,
        on_violation: Optional[Callable[[GazeDirection, float], None]] = None,
    ) -> None:
        self.violation_tracker = GazeViolationTracker(
            timeout=config.GAZE_AWAY_TIMEOUT,
            on_violation=on_violation,
        )

    # ------------------------------------------------------------------
    # Per-frame analysis  (stateless)
    # ------------------------------------------------------------------

    def analyse(self, face: FaceLandmarksResult) -> GazeResult:
        """
        Compute gaze direction and confidence for a single face.

        Parameters
        ----------
        face : FaceLandmarksResult
            Output of :meth:`FaceMeshDetector.detect` for one face.
            Must contain iris landmarks (indices 468–477).

        Returns
        -------
        GazeResult
            Structured result with direction, ratios, confidence,
            and per-eye geometry.  Returns ``GazeResult.unknown()``
            if required landmarks are missing.
        """
        left_metrics  = self._extract_eye_metrics_left(face)
        right_metrics = self._extract_eye_metrics_right(face)

        if left_metrics is None and right_metrics is None:
            return GazeResult.unknown(face.face_index)

        # Average the ratios from whichever eyes are available.
        # Using both eyes smooths out asymmetric blinking artefacts.
        available = [m for m in (left_metrics, right_metrics) if m is not None]

        avg_h_ratio = sum(m.h_ratio  for m in available) / len(available)
        avg_v_ratio = sum(m.v_ratio  for m in available) / len(available)

        # Confidence: minimum normalised eye width across available eyes.
        # Narrow eyes → small denominator → unreliable ratio → low confidence.
        # We scale by a factor of 10 (typical eye_width ≈ 0.05–0.15) so the
        # final value lives comfortably in [0, 1].
        confidence = min(
            min(m.eye_width  for m in available) * 10.0,
            min(m.eye_height for m in available) * 10.0,
        )
        confidence = max(0.0, min(1.0, confidence))

        direction = _classify_direction(avg_h_ratio, avg_v_ratio)

        return GazeResult(
            direction=direction,
            horizontal_ratio=round(avg_h_ratio, 4),
            vertical_ratio=round(avg_v_ratio, 4),
            confidence=round(confidence, 4),
            left_eye=left_metrics,
            right_eye=right_metrics,
            is_looking_away=(direction != GazeDirection.CENTER),
            face_index=face.face_index,
        )

    # ------------------------------------------------------------------
    # Private per-eye extraction helpers
    # ------------------------------------------------------------------

    def _extract_eye_metrics_left(
        self, face: FaceLandmarksResult
    ) -> Optional[EyeMetrics]:
        """
        Extract gaze metrics for the LEFT eye.

        The MediaPipe FaceLandmarker model defines the left eye from the
        subject's own perspective.  In the camera image this is on the
        RIGHT side of the frame.

        Landmark roles used
        ───────────────────
        Outer corner (temporal) : EyeIndex.LEFT_EYE_OUTER  (33)
        Inner corner (nasal)    : EyeIndex.LEFT_EYE_INNER  (133)
        Upper eyelid midpoints  : EyeIndex.LEFT_EYE_TOP_OUTER (159)
                                  EyeIndex.LEFT_EYE_TOP_INNER (158)
        Lower eyelid midpoints  : EyeIndex.LEFT_EYE_BOTTOM_OUTER (145)
                                  EyeIndex.LEFT_EYE_BOTTOM_INNER (153)
        Iris centre             : IrisIndex.LEFT_IRIS_CENTER (468)
        """
        iris = face.get(IrisIndex.LEFT_IRIS_CENTER)
        outer  = face.get(EyeIndex.LEFT_EYE_OUTER)
        inner  = face.get(EyeIndex.LEFT_EYE_INNER)
        top_o  = face.get(EyeIndex.LEFT_EYE_TOP_OUTER)
        top_i  = face.get(EyeIndex.LEFT_EYE_TOP_INNER)
        bot_o  = face.get(EyeIndex.LEFT_EYE_BOTTOM_OUTER)
        bot_i  = face.get(EyeIndex.LEFT_EYE_BOTTOM_INNER)

        if any(lm is None for lm in (iris, outer, inner, top_o, top_i, bot_o, bot_i)):
            return None

        top_y    = (top_o.y + top_i.y) / 2.0       # type: ignore[union-attr]
        bottom_y = (bot_o.y + bot_i.y) / 2.0       # type: ignore[union-attr]

        return _compute_eye_metrics(
            iris_center_x=iris.x,                  # type: ignore[union-attr]
            iris_center_y=iris.y,                  # type: ignore[union-attr]
            outer_x=outer.x,                       # type: ignore[union-attr]
            inner_x=inner.x,                       # type: ignore[union-attr]
            top_y=top_y,
            bottom_y=bottom_y,
        )

    def _extract_eye_metrics_right(
        self, face: FaceLandmarksResult
    ) -> Optional[EyeMetrics]:
        """
        Extract gaze metrics for the RIGHT eye.

        The MediaPipe FaceLandmarker model defines the right eye from the
        subject's own perspective.  In the camera image this is on the
        LEFT side of the frame.

        Landmark roles used
        ───────────────────
        Outer corner (temporal) : EyeIndex.RIGHT_EYE_OUTER  (362)
        Inner corner (nasal)    : EyeIndex.RIGHT_EYE_INNER  (263)
        Upper eyelid midpoints  : EyeIndex.RIGHT_EYE_TOP_OUTER (386)
                                  EyeIndex.RIGHT_EYE_TOP_INNER (385)
        Lower eyelid midpoints  : EyeIndex.RIGHT_EYE_BOTTOM_OUTER (374)
                                  EyeIndex.RIGHT_EYE_BOTTOM_INNER (380)
        Iris centre             : IrisIndex.RIGHT_IRIS_CENTER (473)

        Note on axis direction for the right eye
        ────────────────────────────────────────
        For the right eye, the outer (temporal) corner has a LARGER x than
        the inner (nasal) corner, so eye_width = outer_x - inner_x (positive).
        We pass inner_x as outer_x and outer_x as inner_x to _compute_eye_metrics
        so the formula iris_x - outer_x / eye_width stays consistent.
        """
        iris  = face.get(IrisIndex.RIGHT_IRIS_CENTER)
        outer = face.get(EyeIndex.RIGHT_EYE_OUTER)
        inner = face.get(EyeIndex.RIGHT_EYE_INNER)
        top_o = face.get(EyeIndex.RIGHT_EYE_TOP_OUTER)
        top_i = face.get(EyeIndex.RIGHT_EYE_TOP_INNER)
        bot_o = face.get(EyeIndex.RIGHT_EYE_BOTTOM_OUTER)
        bot_i = face.get(EyeIndex.RIGHT_EYE_BOTTOM_INNER)

        if any(lm is None for lm in (iris, outer, inner, top_o, top_i, bot_o, bot_i)):
            return None

        top_y    = (top_o.y + top_i.y) / 2.0       # type: ignore[union-attr]
        bottom_y = (bot_o.y + bot_i.y) / 2.0       # type: ignore[union-attr]

        # For the right eye: inner corner (263) is at a smaller x than outer (362).
        # We pass inner as outer_x and outer as inner_x so the ratio formula
        # h_ratio = (iris_x - outer_x) / (inner_x - outer_x)
        # correctly maps 0=LEFT, 1=RIGHT from the subject's perspective.
        return _compute_eye_metrics(
            iris_center_x=iris.x,                  # type: ignore[union-attr]
            iris_center_y=iris.y,                  # type: ignore[union-attr]
            outer_x=inner.x,   # nasal (smaller x) acts as the "left" anchor
            inner_x=outer.x,   # temporal (larger x) acts as the "right" anchor
            top_y=top_y,
            bottom_y=bottom_y,
        )
