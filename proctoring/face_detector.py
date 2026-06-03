# proctoring/face_detector.py
# ─────────────────────────────────────────────────────────────────────────────
# Module 2 — Face Detection using MediaPipe Tasks API (v0.10+)
# ─────────────────────────────────────────────────────────────────────────────
#
# Uses the new mp.tasks.vision.FaceDetector (BlazeFace model) introduced in
# MediaPipe 0.10.  The older mp.solutions.face_detection API was removed in
# this version family.
#
# Model file required: blaze_face_short_range.tflite
# Placed in the same directory as this file (see config.FACE_DETECTION_MODEL).
#
# Typical usage
# ─────────────
#   with FaceDetector() as detector:
#       result: DetectionResult = detector.detect(bgr_frame)
#       for face in result.faces:
#           print(face.bbox, face.confidence)
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import dataclasses
import os
from typing import List, Optional, Tuple

import cv2
import mediapipe as mp
import numpy as np

import config

# Convenience aliases for the MediaPipe Tasks vision namespace.
_vision = mp.tasks.vision
_core   = mp.tasks


# ─────────────────────────────────────────────────────────────────────────────
# Data containers
# ─────────────────────────────────────────────────────────────────────────────

@dataclasses.dataclass(frozen=True)
class BoundingBox:
    """
    Absolute pixel coordinates of a detected face box.

    Attributes
    ----------
    x, y    : Top-left corner (pixels).
    width   : Box width  (pixels).
    height  : Box height (pixels).
    """
    x: int
    y: int
    width: int
    height: int

    @property
    def top_left(self) -> Tuple[int, int]:
        """(x, y) of the top-left corner."""
        return (self.x, self.y)

    @property
    def bottom_right(self) -> Tuple[int, int]:
        """(x + width, y + height) of the bottom-right corner."""
        return (self.x + self.width, self.y + self.height)


@dataclasses.dataclass(frozen=True)
class FaceDetection:
    """
    A single detected face.

    Attributes
    ----------
    bbox        : Bounding box in absolute pixel coordinates.
    confidence  : Detection score in [0.0, 1.0].
    """
    bbox: BoundingBox
    confidence: float


@dataclasses.dataclass
class DetectionResult:
    """
    The full output of one call to :meth:`FaceDetector.detect`.

    Attributes
    ----------
    faces      : List of all detected faces (may be empty).
    face_count : Convenience alias for ``len(faces)``.
    """
    faces: List[FaceDetection] = dataclasses.field(default_factory=list)

    @property
    def face_count(self) -> int:
        """Number of faces detected in this frame."""
        return len(self.faces)


# ─────────────────────────────────────────────────────────────────────────────
# Detector
# ─────────────────────────────────────────────────────────────────────────────

class FaceDetectorError(RuntimeError):
    """Raised when the face detector fails to initialise or hits a fatal error."""


class FaceDetector:
    """
    MediaPipe Tasks-based face detector (BlazeFace short-range model).

    Parameters
    ----------
    model_path      : str
        Path to the ``.tflite`` model file.
        Defaults to :data:`config.FACE_DETECTION_MODEL`.
    min_confidence  : float
        Minimum detection confidence threshold (0.0–1.0).
        Defaults to :data:`config.FACE_DETECTION_CONFIDENCE`.
    """

    def __init__(
        self,
        model_path: str = config.FACE_DETECTION_MODEL,
        min_confidence: float = config.FACE_DETECTION_CONFIDENCE,
    ) -> None:
        self._model_path = model_path
        self._min_confidence = min_confidence
        self._detector: Optional[_vision.FaceDetector] = None

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def open(self) -> None:
        """
        Initialise the MediaPipe FaceDetector from the TFLite model file.

        Raises
        ------
        FaceDetectorError
            If the model file is missing or MediaPipe fails to initialise.
        """
        if not os.path.isfile(self._model_path):
            raise FaceDetectorError(
                f"Model file not found: '{self._model_path}'\n"
                "Download it from:\n"
                "  https://storage.googleapis.com/mediapipe-models/"
                "face_detector/blaze_face_short_range/float16/1/"
                "blaze_face_short_range.tflite\n"
                "and place it in the proctoring/ directory."
            )

        try:
            options = _vision.FaceDetectorOptions(
                base_options=_core.BaseOptions(model_asset_path=self._model_path),
                min_detection_confidence=self._min_confidence,
                running_mode=_vision.RunningMode.IMAGE,
            )
            self._detector = _vision.FaceDetector.create_from_options(options)
            print(
                f"[FaceDetector] Initialised  "
                f"(model='{self._model_path}', "
                f"min_confidence={self._min_confidence})"
            )
        except Exception as exc:
            raise FaceDetectorError(
                f"Failed to initialise MediaPipe FaceDetector: {exc}"
            ) from exc

    def close(self) -> None:
        """Release MediaPipe resources."""
        if self._detector is not None:
            self._detector.close()
            self._detector = None
            print("[FaceDetector] Resources released.")

    # ------------------------------------------------------------------
    # Detection
    # ------------------------------------------------------------------

    def detect(self, bgr_frame: np.ndarray) -> DetectionResult:
        """
        Run face detection on a single BGR frame.

        Parameters
        ----------
        bgr_frame : np.ndarray
            A BGR image as returned by ``cv2.VideoCapture.read()``.

        Returns
        -------
        DetectionResult
            Contains a (possibly empty) list of :class:`FaceDetection` objects.

        Raises
        ------
        FaceDetectorError
            If :meth:`open` has not been called yet.
        """
        if self._detector is None:
            raise FaceDetectorError(
                "FaceDetector.open() must be called before detect()."
            )

        h, w = bgr_frame.shape[:2]

        # MediaPipe Tasks API expects an mp.Image in RGB format.
        rgb_frame = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)

        mp_result = self._detector.detect(mp_image)

        faces: List[FaceDetection] = []

        if mp_result.detections:
            for detection in mp_result.detections:
                # Confidence score from the first (and only) category.
                confidence = float(
                    detection.categories[0].score
                    if detection.categories
                    else 0.0
                )

                # The Tasks API returns relative coordinates in bounding_box.
                bb = detection.bounding_box
                # bb.origin_x / origin_y are already in pixels for IMAGE mode
                x      = max(0, bb.origin_x)
                y      = max(0, bb.origin_y)
                box_w  = min(bb.width,  w - x)
                box_h  = min(bb.height, h - y)

                faces.append(
                    FaceDetection(
                        bbox=BoundingBox(x=x, y=y, width=box_w, height=box_h),
                        confidence=confidence,
                    )
                )

        return DetectionResult(faces=faces)

    # ------------------------------------------------------------------
    # Context-manager support
    # ------------------------------------------------------------------

    def __enter__(self) -> "FaceDetector":
        self.open()
        return self

    def __exit__(self, *_) -> None:
        self.close()
