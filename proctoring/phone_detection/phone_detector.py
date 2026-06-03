# phone_detection/phone_detector.py
# ─────────────────────────────────────────────────────────────────────────────
# Module 6 — PhoneDetector: thin YOLO wrapper
#
# Responsibilities
# ────────────────
# • Load and own the YOLOv8 model (any .pt file — no code changes needed).
# • Run inference on a single BGR frame.
# • Filter to the configured target class labels.
# • Return a clean PhoneDetectionResult — no YOLO types leak out.
#
# This class does NOT:
# • Manage frame scheduling (that's PhoneService).
# • Hold any violation state (that's PhoneViolationTracker in phone_service.py).
# • Draw anything (that's display.py).
#
# Model replacement
# ─────────────────
# Change config.PHONE_MODEL_PATH to:
#   "yolov8n.pt"   (default, fastest)
#   "yolov8s.pt"   (more accurate, ~2× slower)
#   "custom.pt"    (custom-trained model for cheat sheets, calculators, etc.)
# The rest of the system requires zero changes.
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import time
from typing import FrozenSet, List, Optional, Set

import numpy as np

import config
from phone_detection.phone_models import PhoneDetection, PhoneDetectionResult


class PhoneDetectorError(RuntimeError):
    """Raised when the YOLO model fails to load or run inference."""


class PhoneDetector:
    """
    YOLOv8-based object detector, pre-filtered to a configurable set of
    target class labels.

    Parameters
    ----------
    model_path : str
        Path to the YOLOv8 ``.pt`` weights file.
        Defaults to :data:`config.PHONE_MODEL_PATH`.
    confidence_threshold : float
        Minimum detection confidence to accept.
        Defaults to :data:`config.PHONE_CONFIDENCE_THRESHOLD`.
    target_labels : set of str, optional
        COCO class names to keep.  All other detections are silently
        discarded.  Defaults to ``{"cell phone"}``.
        Override with a superset to detect cheat sheets, books, etc.

    Notes
    -----
    The ultralytics import is deferred to :meth:`open` so that importing
    this module never triggers a CUDA/torch initialisation — useful for
    fast unit tests and analytics modules that only consume the models.
    """

    # Default target — the COCO class name for mobile phones.
    # Extend this set (or pass a custom set) for future object classes.
    DEFAULT_TARGETS: FrozenSet[str] = frozenset({"cell phone"})

    def __init__(
        self,
        model_path:           str   = config.PHONE_MODEL_PATH,
        confidence_threshold: float = config.PHONE_CONFIDENCE_THRESHOLD,
        target_labels:        Optional[Set[str]] = None,
    ) -> None:
        self._model_path  = model_path
        self._conf_thresh = confidence_threshold
        self._targets     = (
            frozenset(target_labels)
            if target_labels is not None
            else self.DEFAULT_TARGETS
        )
        self._model = None   # loaded lazily in open()

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def open(self) -> None:
        """
        Load the YOLOv8 model into memory.

        Deferred import of ultralytics keeps the rest of the system fast
        to import on machines without a GPU.

        Raises
        ------
        PhoneDetectorError
            If the model file cannot be loaded.
        """
        try:
            # Deferred import — only happens once per process lifetime.
            from ultralytics import YOLO  # type: ignore[import-untyped]
            self._model = YOLO(self._model_path)
            # Warm up: run a dummy inference so the first real frame isn't slow.
            dummy = np.zeros((64, 64, 3), dtype=np.uint8)
            self._model(dummy, verbose=False)
            print(
                f"[PhoneDetector] Model loaded: '{self._model_path}'  "
                f"conf≥{self._conf_thresh}  "
                f"targets={sorted(self._targets)}"
            )
        except Exception as exc:
            raise PhoneDetectorError(
                f"Failed to load YOLO model '{self._model_path}': {exc}\n"
                "  • Ensure ultralytics is installed:  pip install ultralytics\n"
                "  • If using a custom model, check the path in config.py."
            ) from exc

    def close(self) -> None:
        """Release model resources."""
        self._model = None
        print("[PhoneDetector] Model released.")

    # ------------------------------------------------------------------
    # Inference
    # ------------------------------------------------------------------

    def detect(
        self,
        bgr_frame:   np.ndarray,
        frame_index: int = 0,
    ) -> PhoneDetectionResult:
        """
        Run YOLO inference on a single BGR frame.

        Parameters
        ----------
        bgr_frame   : np.ndarray  BGR image from OpenCV VideoCapture.
        frame_index : int         Monotonic frame counter (for correlation).

        Returns
        -------
        PhoneDetectionResult
            All detected objects matching the target labels above the
            confidence threshold.

        Raises
        ------
        PhoneDetectorError
            If :meth:`open` has not been called.
        """
        if self._model is None:
            raise PhoneDetectorError(
                "PhoneDetector.open() must be called before detect()."
            )

        t0 = time.perf_counter()

        # ultralytics expects BGR or RGB — it handles both automatically.
        results = self._model(
            bgr_frame,
            conf=self._conf_thresh,
            verbose=False,
        )

        inference_ms = (time.perf_counter() - t0) * 1000.0

        detections: List[PhoneDetection] = []

        for result in results:
            if result.boxes is None:
                continue
            for box in result.boxes:
                # class_id is a 1-element tensor
                class_id   = int(box.cls[0])
                label      = result.names.get(class_id, str(class_id))
                confidence = float(box.conf[0])

                # Filter to target labels only
                if label not in self._targets:
                    continue

                # xyxy format: (x1, y1, x2, y2)
                x1, y1, x2, y2 = (int(v) for v in box.xyxy[0].tolist())

                detections.append(
                    PhoneDetection(
                        label=label,
                        confidence=round(confidence, 4),
                        bbox=(x1, y1, x2, y2),
                        class_id=class_id,
                    )
                )

        return PhoneDetectionResult(
            detections=detections,
            inference_time_ms=round(inference_ms, 2),
            frame_index=frame_index,
            is_stale=False,
        )

    # ------------------------------------------------------------------
    # Context-manager support
    # ------------------------------------------------------------------

    def __enter__(self) -> "PhoneDetector":
        self.open()
        return self

    def __exit__(self, *_) -> None:
        self.close()
