# phone_detection/phone_service.py
# ─────────────────────────────────────────────────────────────────────────────
# Module 6 — PhoneService: detection lifecycle + frame scheduling
#
# Why a service layer?
# ────────────────────
# YOLOv8n runs at ~20-30 ms per frame on CPU.  Running it on every frame
# would drop the webcam FPS from 30+ to ~15.  The service layer solves this
# by:
#
#   1. Running inference only every N frames (configurable via
#      config.PHONE_FRAME_SKIP).
#
#   2. Returning the last known result for skipped frames (is_stale=True)
#      so the display always has something to show without waiting.
#
#   3. Owning the PhoneDetector lifecycle (open/close) so main.py only
#      needs to call service.start() / service.stop().
#
#   4. Owning the PhoneViolationTracker so violation state is isolated
#      from both the detector and the display.
#
# Future API compatibility
# ────────────────────────
# The service interface is designed to be drop-in replaceable with a
# threaded or async version without changing any call sites in main.py:
#
#   service.submit(frame, frame_index)  → schedules or runs inference
#   service.latest_result               → always returns a PhoneDetectionResult
#   service.violation_tracker           → PhoneViolationTracker instance
#
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import time
from enum import Enum, auto
from typing import Callable, Optional

import numpy as np

import config
from phone_detection.phone_detector import PhoneDetector, PhoneDetectorError
from phone_detection.phone_models   import PhoneDetectionResult


# ─────────────────────────────────────────────────────────────────────────────
# Violation state machine (identical pattern to GazeViolationTracker)
# ─────────────────────────────────────────────────────────────────────────────

class _PhoneViolationState(Enum):
    """Internal states for the phone-present violation tracker."""
    CLEAR    = auto()   # no phone in frame
    PRESENT  = auto()   # phone detected, violation already fired this episode
    # Note: unlike gaze/head trackers there is no TIMEOUT — a phone is an
    # instant violation.  The state machine prevents re-firing on every frame.


class PhoneViolationTracker:
    """
    Fires a callback exactly once each time a phone *appears* in the frame.

    Resets to CLEAR when no phone is detected, allowing a new violation
    to fire if a phone appears again later.

    Parameters
    ----------
    on_violation : callable, optional
        ``on_violation(count, confidence)`` called once per appearance episode.
    """

    def __init__(
        self,
        on_violation: Optional[Callable[[int, float], None]] = None,
    ) -> None:
        self._on_violation    = on_violation
        self._state           = _PhoneViolationState.CLEAR
        self._violation_count: int = 0

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def update(self, result: PhoneDetectionResult) -> bool:
        """
        Feed the latest detection result and advance the state machine.

        Parameters
        ----------
        result : PhoneDetectionResult

        Returns
        -------
        bool  True when a violation is currently active (phone present).
        """
        phone_present = result.phone_count > 0

        if not phone_present:
            # Phone gone — reset so a future appearance can fire again.
            self._state = _PhoneViolationState.CLEAR
            return False

        # Phone is present ─────────────────────────────────────────────
        if self._state == _PhoneViolationState.CLEAR:
            # First frame with a phone → fire violation once.
            self._state = _PhoneViolationState.PRESENT
            self._violation_count += 1
            if self._on_violation is not None:
                self._on_violation(result.phone_count, result.max_confidence)

        return True   # PRESENT — stay until CLEAR

    @property
    def violation_count(self) -> int:
        """Total distinct phone-appearance episodes counted."""
        return self._violation_count

    @property
    def is_currently_violated(self) -> bool:
        """True while a phone is visible."""
        return self._state == _PhoneViolationState.PRESENT

    def reset(self) -> None:
        """Full reset — clears state and violation count."""
        self._state           = _PhoneViolationState.CLEAR
        self._violation_count = 0


# ─────────────────────────────────────────────────────────────────────────────
# PhoneService — public API used by main.py
# ─────────────────────────────────────────────────────────────────────────────

class PhoneService:
    """
    Manages the PhoneDetector lifecycle and per-frame scheduling.

    The service runs YOLO inference only every ``frame_skip`` frames.
    On skipped frames it returns the last known result with
    ``is_stale=True`` so callers always have a result to display.

    Parameters
    ----------
    on_violation : callable, optional
        Forwarded to :class:`PhoneViolationTracker`.
        Signature: ``on_violation(phone_count: int, confidence: float)``.
    model_path : str, optional
        Override :data:`config.PHONE_MODEL_PATH`.
    confidence_threshold : float, optional
        Override :data:`config.PHONE_CONFIDENCE_THRESHOLD`.
    frame_skip : int, optional
        Override :data:`config.PHONE_FRAME_SKIP`.
        1 = run every frame; 5 = run every 5th frame (default).

    Example — typical main-loop usage
    ───────────────────────────────────
        service = PhoneService(on_violation=handle_phone_violation)
        service.start()

        # Inside the frame loop:
        result = service.submit(frame, frame_index)
        service.violation_tracker.update(result)

        service.stop()
    """

    def __init__(
        self,
        on_violation:         Optional[Callable[[int, float], None]] = None,
        model_path:           str   = config.PHONE_MODEL_PATH,
        confidence_threshold: float = config.PHONE_CONFIDENCE_THRESHOLD,
        frame_skip:           int   = config.PHONE_FRAME_SKIP,
    ) -> None:
        self._frame_skip    = max(1, frame_skip)
        self._detector      = PhoneDetector(
            model_path=model_path,
            confidence_threshold=confidence_threshold,
        )
        self.violation_tracker = PhoneViolationTracker(on_violation=on_violation)
        self._last_result: PhoneDetectionResult = PhoneDetectionResult.empty()
        self._frame_counter: int = 0

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self) -> None:
        """
        Load the YOLO model and prepare the service for inference.

        Raises
        ------
        PhoneDetectorError
            If the model cannot be loaded.
        """
        self._detector.open()

    def stop(self) -> None:
        """Release the YOLO model and free GPU/CPU memory."""
        self._detector.close()

    # ------------------------------------------------------------------
    # Per-frame API
    # ------------------------------------------------------------------

    def submit(
        self,
        bgr_frame:   np.ndarray,
        frame_index: int,
    ) -> PhoneDetectionResult:
        """
        Submit a frame for detection according to the frame-skip schedule.

        On scheduled frames : runs YOLO inference, caches and returns result.
        On skipped frames   : returns the last cached result with
                              ``is_stale=True`` — zero inference cost.

        The caller is responsible for calling
        ``service.violation_tracker.update(result)`` after this returns.

        Parameters
        ----------
        bgr_frame   : np.ndarray  BGR image from OpenCV VideoCapture.
        frame_index : int         Monotonic frame counter.

        Returns
        -------
        PhoneDetectionResult
        """
        self._frame_counter += 1

        if self._frame_counter % self._frame_skip != 0:
            # Return the cached (stale) result — no inference this frame.
            stale = PhoneDetectionResult(
                detections=self._last_result.detections,
                inference_time_ms=0.0,
                frame_index=frame_index,
                is_stale=True,
            )
            return stale

        # Run inference on this frame.
        result = self._detector.detect(bgr_frame, frame_index=frame_index)
        self._last_result = result
        return result

    @property
    def latest_result(self) -> PhoneDetectionResult:
        """
        The most recently computed PhoneDetectionResult.

        Safe to read at any time — never None after :meth:`start`.
        """
        return self._last_result

    # ------------------------------------------------------------------
    # Context-manager support  (alternative to start/stop)
    # ------------------------------------------------------------------

    def __enter__(self) -> "PhoneService":
        self.start()
        return self

    def __exit__(self, *_) -> None:
        self.stop()
