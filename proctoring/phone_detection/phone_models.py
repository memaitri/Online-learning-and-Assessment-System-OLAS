# phone_detection/phone_models.py
# ─────────────────────────────────────────────────────────────────────────────
# Module 6 — Data models for phone (and future object) detection.
#
# Deliberately kept free of any YOLO or OpenCV imports so these models
# can be imported safely by analytics, risk-scoring, and dashboard modules
# without dragging in ML dependencies.
#
# Future compatibility
# ────────────────────
# The same models are intentionally reusable for:
#   • Cheat-sheet detection  (label="book" / custom class)
#   • Calculator detection   (label="calculator" / custom class)
#   • Any COCO object class  — just change PhoneDetector's target_labels set
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import dataclasses
from typing import List, Optional, Tuple


@dataclasses.dataclass(frozen=True)
class PhoneDetection:
    """
    A single detected object instance from one YOLO inference pass.

    Attributes
    ----------
    label       : str              — COCO class name (e.g. ``"cell phone"``).
    confidence  : float            — Detection score in [0.0, 1.0].
    bbox        : Tuple[int,int,int,int]
                                   — Bounding box as (x1, y1, x2, y2) in
                                     absolute pixel coordinates.
    class_id    : int              — COCO numeric class ID.

    Notes
    -----
    ``bbox`` uses (x1, y1, x2, y2) rather than (x, y, w, h) to match the
    format returned directly by ultralytics, avoiding an extra conversion
    and making ``cv2.rectangle`` calls straightforward.

    Example — downstream usage
    ──────────────────────────
    # Risk scoring
    risk += det.confidence * WEIGHT_PHONE_DETECTION

    # Analytics dashboard
    event = {
        "label":      det.label,
        "confidence": det.confidence,
        "bbox":       det.bbox,
    }
    """
    label:      str
    confidence: float
    bbox:       Tuple[int, int, int, int]   # (x1, y1, x2, y2)
    class_id:   int

    @property
    def top_left(self) -> Tuple[int, int]:
        """(x1, y1) corner for cv2.rectangle."""
        return (self.bbox[0], self.bbox[1])

    @property
    def bottom_right(self) -> Tuple[int, int]:
        """(x2, y2) corner for cv2.rectangle."""
        return (self.bbox[2], self.bbox[3])

    @property
    def area(self) -> int:
        """Bounding-box area in pixels²."""
        return (self.bbox[2] - self.bbox[0]) * (self.bbox[3] - self.bbox[1])


@dataclasses.dataclass
class PhoneDetectionResult:
    """
    Complete output of one PhoneDetector.detect() call.

    Attributes
    ----------
    detections      : List of all detected objects in this frame.
    phone_count     : Number of detected objects (convenience alias).
    inference_time_ms : How long YOLO inference took (milliseconds).
                        0.0 when the frame was skipped (frame-skip logic).
    frame_index     : Which frame number this result corresponds to.
                      Used by the service layer to correlate with the
                      main capture loop.
    is_stale        : True when this result was carried over from a
                      previous inference (frame was skipped).

    Example — downstream usage
    ──────────────────────────
    if result.phone_count > 0:
        risk_engine.flag_violation("PHONE_DETECTED", result)
    """
    detections:        List[PhoneDetection] = dataclasses.field(default_factory=list)
    inference_time_ms: float = 0.0
    frame_index:       int   = 0
    is_stale:          bool  = False

    @property
    def phone_count(self) -> int:
        """Number of objects detected in this result."""
        return len(self.detections)

    @property
    def max_confidence(self) -> float:
        """Highest confidence score among all detections; 0.0 if none."""
        if not self.detections:
            return 0.0
        return max(d.confidence for d in self.detections)

    @classmethod
    def empty(cls, frame_index: int = 0, is_stale: bool = False) -> "PhoneDetectionResult":
        """Construct an empty result (no detections this frame/skip)."""
        return cls(
            detections=[],
            inference_time_ms=0.0,
            frame_index=frame_index,
            is_stale=is_stale,
        )
