# proctoring/face_mesh_detector.py
# ─────────────────────────────────────────────────────────────────────────────
# Module 3 — Face Mesh Infrastructure
# ─────────────────────────────────────────────────────────────────────────────
#
# Wraps MediaPipe FaceLandmarker (Tasks API, v0.10+) and exposes a clean,
# typed API that downstream modules can import without knowing anything about
# MediaPipe internals.
#
# Design goals
# ────────────
# • Zero coupling to FaceDetector or ViolationTracker.
# • All 478 landmarks (468 mesh + 10 iris) returned as structured objects.
# • Named landmark groups (iris, eyes, head-pose anchors, mouth) are
#   accessible directly from FaceLandmarksResult so future modules never
#   have to slice raw lists.
# • Supports optional blendshapes and transformation matrices for future
#   head-pose module (disabled by default to save CPU).
# • Context-manager support for deterministic resource cleanup.
#
# Landmark index reference → landmark_indices.py
#
# Model file: face_landmarker.task  (place in proctoring/ directory)
# Download:   https://storage.googleapis.com/mediapipe-models/
#             face_landmarker/face_landmarker/float16/1/face_landmarker.task
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import dataclasses
import os
from typing import List, Optional, Sequence, Tuple

import cv2
import mediapipe as mp
import numpy as np

import config
from landmark_indices import (
    IrisIndex, EyeIndex, HeadPoseIndex, MouthIndex,
    TOTAL_LANDMARKS,
)

# MediaPipe Tasks namespace aliases
_vision = mp.tasks.vision
_core   = mp.tasks


# ─────────────────────────────────────────────────────────────────────────────
# Data models
# ─────────────────────────────────────────────────────────────────────────────

@dataclasses.dataclass(frozen=True)
class Landmark:
    """
    A single 3-D facial landmark in normalised image coordinates.

    Attributes
    ----------
    x : float   Normalised x coordinate [0.0, 1.0] (left → right).
    y : float   Normalised y coordinate [0.0, 1.0] (top  → bottom).
    z : float   Depth relative to the face's centre plane.
                Negative = closer to the camera.
    index : int Landmark index in the 478-point set (see landmark_indices.py).

    Notes
    -----
    Use :meth:`pixel` to convert to absolute pixel coordinates.
    """
    x: float
    y: float
    z: float
    index: int

    def pixel(self, width: int, height: int) -> Tuple[int, int]:
        """
        Convert normalised coordinates to absolute pixel (x, y).

        Parameters
        ----------
        width, height : int  Frame dimensions in pixels.

        Returns
        -------
        (px, py) : Tuple[int, int]
        """
        return (int(self.x * width), int(self.y * height))


@dataclasses.dataclass
class FaceLandmarksResult:
    """
    Structured landmarks for a single detected face.

    All 478 landmarks are available via :attr:`all_landmarks`.
    Convenience accessors provide named subsets so future modules
    never need to index raw lists or import landmark_indices directly.

    Attributes
    ----------
    all_landmarks : List[Landmark]
        All 478 landmarks in index order.
    face_index : int
        Which face this result belongs to (0-based, for multi-face support).
    """
    all_landmarks: List[Landmark]
    face_index: int = 0

    # ------------------------------------------------------------------
    # Landmark count
    # ------------------------------------------------------------------

    @property
    def landmark_count(self) -> int:
        """Total number of landmarks in this result."""
        return len(self.all_landmarks)

    # ------------------------------------------------------------------
    # Named subsets — future modules import these, not raw indices
    # ------------------------------------------------------------------

    def get(self, index: int) -> Optional[Landmark]:
        """
        Return the landmark at *index*, or ``None`` if out of range.

        Parameters
        ----------
        index : int  0-based landmark index (see landmark_indices.py).
        """
        if 0 <= index < len(self.all_landmarks):
            return self.all_landmarks[index]
        return None

    def get_group(self, indices: Sequence[int]) -> List[Landmark]:
        """
        Return a list of landmarks for a sequence of indices.

        Landmarks missing from the result are silently skipped.

        Parameters
        ----------
        indices : Sequence[int]  E.g. ``IrisIndex.LEFT_IRIS_ALL``.
        """
        return [lm for i in indices if (lm := self.get(i)) is not None]

    # ── Iris ─────────────────────────────────────────────────────────────────

    @property
    def left_iris(self) -> List[Landmark]:
        """5 left-iris landmarks (centre + 4 edges). Module 4 ready."""
        return self.get_group(IrisIndex.LEFT_IRIS_ALL)

    @property
    def right_iris(self) -> List[Landmark]:
        """5 right-iris landmarks (centre + 4 edges). Module 4 ready."""
        return self.get_group(IrisIndex.RIGHT_IRIS_ALL)

    @property
    def left_iris_center(self) -> Optional[Landmark]:
        """Centre point of the left iris. Module 4 ready."""
        return self.get(IrisIndex.LEFT_IRIS_CENTER)

    @property
    def right_iris_center(self) -> Optional[Landmark]:
        """Centre point of the right iris. Module 4 ready."""
        return self.get(IrisIndex.RIGHT_IRIS_CENTER)

    # ── Eyes (blink / EAR) ───────────────────────────────────────────────────

    @property
    def left_eye_ear_points(self) -> List[Landmark]:
        """6-point set for left EAR calculation. Module 6 ready."""
        return self.get_group(EyeIndex.LEFT_EAR_POINTS)

    @property
    def right_eye_ear_points(self) -> List[Landmark]:
        """6-point set for right EAR calculation. Module 6 ready."""
        return self.get_group(EyeIndex.RIGHT_EAR_POINTS)

    # ── Head pose ────────────────────────────────────────────────────────────

    @property
    def head_pose_points(self) -> List[Landmark]:
        """6 anatomically stable landmarks for PnP head-pose estimation. Module 5 ready."""
        return self.get_group(HeadPoseIndex.PNP_POINTS)

    # ── Mouth ────────────────────────────────────────────────────────────────

    @property
    def mouth_mar_points(self) -> List[Landmark]:
        """8-point set for MAR (mouth aspect ratio) yawn detection. Module 7 ready."""
        return self.get_group(MouthIndex.MAR_POINTS)


@dataclasses.dataclass
class MeshDetectionResult:
    """
    Output of one call to :meth:`FaceMeshDetector.detect`.

    Attributes
    ----------
    faces          : List of per-face landmark results.
    face_count     : Number of faces with landmarks detected.
    """
    faces: List[FaceLandmarksResult] = dataclasses.field(default_factory=list)

    @property
    def face_count(self) -> int:
        """Number of faces for which landmarks were extracted."""
        return len(self.faces)


# ─────────────────────────────────────────────────────────────────────────────
# FaceMeshDetector
# ─────────────────────────────────────────────────────────────────────────────

class FaceMeshDetectorError(RuntimeError):
    """Raised when the face-mesh detector fails to initialise or hits a fatal error."""


class FaceMeshDetector:
    """
    MediaPipe FaceLandmarker wrapper.

    Runs the 478-point face-mesh model on each frame and returns clean,
    typed :class:`MeshDetectionResult` objects.

    Parameters
    ----------
    model_path : str
        Path to ``face_landmarker.task``.
        Defaults to :data:`config.FACE_MESH_MODEL`.
    min_face_detection_confidence : float
        Minimum confidence for face detection stage.
        Defaults to :data:`config.FACE_MESH_DETECTION_CONFIDENCE`.
    min_face_presence_confidence : float
        Minimum confidence that a face is present in the frame.
        Defaults to :data:`config.FACE_MESH_PRESENCE_CONFIDENCE`.
    min_tracking_confidence : float
        Minimum confidence for tracking between frames.
        Defaults to :data:`config.FACE_MESH_TRACKING_CONFIDENCE`.
    num_faces : int
        Maximum number of faces to detect per frame.
        Defaults to :data:`config.FACE_MESH_MAX_FACES`.
    output_face_blendshapes : bool
        If ``True``, blendshape scores are computed and available for
        mouth-open / blink detection (adds ~2 ms/frame).
        Defaults to :data:`config.FACE_MESH_BLENDSHAPES`.
    output_facial_transformation_matrixes : bool
        If ``True``, 4×4 transformation matrices are output per face.
        Required by Module 5 (Head Pose Estimation).
        Defaults to :data:`config.FACE_MESH_TRANSFORM_MATRIX`.
    """

    def __init__(
        self,
        model_path: str  = config.FACE_MESH_MODEL,
        min_face_detection_confidence: float = config.FACE_MESH_DETECTION_CONFIDENCE,
        min_face_presence_confidence:  float = config.FACE_MESH_PRESENCE_CONFIDENCE,
        min_tracking_confidence:       float = config.FACE_MESH_TRACKING_CONFIDENCE,
        num_faces: int   = config.FACE_MESH_MAX_FACES,
        output_face_blendshapes:               bool = config.FACE_MESH_BLENDSHAPES,
        output_facial_transformation_matrixes: bool = config.FACE_MESH_TRANSFORM_MATRIX,
    ) -> None:
        self._model_path = model_path
        self._min_detection_conf  = min_face_detection_confidence
        self._min_presence_conf   = min_face_presence_confidence
        self._min_tracking_conf   = min_tracking_confidence
        self._num_faces           = num_faces
        self._blendshapes         = output_face_blendshapes
        self._transform_matrix    = output_facial_transformation_matrixes
        self._landmarker: Optional[_vision.FaceLandmarker] = None

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def open(self) -> None:
        """
        Initialise the MediaPipe FaceLandmarker from the task bundle file.

        Raises
        ------
        FaceMeshDetectorError
            If the model file is missing or MediaPipe fails to load it.
        """
        if not os.path.isfile(self._model_path):
            raise FaceMeshDetectorError(
                f"Face Mesh model file not found: '{self._model_path}'\n"
                "Download it from:\n"
                "  https://storage.googleapis.com/mediapipe-models/"
                "face_landmarker/face_landmarker/float16/1/face_landmarker.task\n"
                "and place it in the proctoring/ directory."
            )

        try:
            options = _vision.FaceLandmarkerOptions(
                base_options=_core.BaseOptions(model_asset_path=self._model_path),
                running_mode=_vision.RunningMode.IMAGE,
                num_faces=self._num_faces,
                min_face_detection_confidence=self._min_detection_conf,
                min_face_presence_confidence=self._min_presence_conf,
                min_tracking_confidence=self._min_tracking_conf,
                output_face_blendshapes=self._blendshapes,
                output_facial_transformation_matrixes=self._transform_matrix,
            )
            self._landmarker = _vision.FaceLandmarker.create_from_options(options)
            print(
                f"[FaceMeshDetector] Initialised  "
                f"(model='{self._model_path}', "
                f"max_faces={self._num_faces}, "
                f"det_conf={self._min_detection_conf})"
            )
        except FaceMeshDetectorError:
            raise
        except Exception as exc:
            raise FaceMeshDetectorError(
                f"Failed to initialise MediaPipe FaceLandmarker: {exc}"
            ) from exc

    def close(self) -> None:
        """Release MediaPipe FaceLandmarker resources."""
        if self._landmarker is not None:
            self._landmarker.close()
            self._landmarker = None
            print("[FaceMeshDetector] Resources released.")

    # ------------------------------------------------------------------
    # Detection
    # ------------------------------------------------------------------

    def detect(self, bgr_frame: np.ndarray) -> MeshDetectionResult:
        """
        Run face-mesh landmark detection on a single BGR frame.

        Parameters
        ----------
        bgr_frame : np.ndarray
            BGR image from OpenCV ``VideoCapture.read()``.

        Returns
        -------
        MeshDetectionResult
            Contains one :class:`FaceLandmarksResult` per detected face.
            Returns an empty result (``face_count == 0``) when no faces
            are found — never raises on a normal empty frame.

        Raises
        ------
        FaceMeshDetectorError
            If :meth:`open` has not been called, or MediaPipe raises
            an unexpected internal error.
        """
        if self._landmarker is None:
            raise FaceMeshDetectorError(
                "FaceMeshDetector.open() must be called before detect()."
            )

        # Convert BGR → RGB (MediaPipe requires RGB)
        rgb_frame = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB)
        mp_image  = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)

        try:
            mp_result = self._landmarker.detect(mp_image)
        except Exception as exc:
            raise FaceMeshDetectorError(
                f"MediaPipe FaceLandmarker.detect() failed: {exc}"
            ) from exc

        faces: List[FaceLandmarksResult] = []

        if mp_result.face_landmarks:
            for face_idx, raw_landmarks in enumerate(mp_result.face_landmarks):
                landmarks = [
                    Landmark(
                        x=lm.x,
                        y=lm.y,
                        z=lm.z,
                        index=i,
                    )
                    for i, lm in enumerate(raw_landmarks)
                ]
                faces.append(
                    FaceLandmarksResult(
                        all_landmarks=landmarks,
                        face_index=face_idx,
                    )
                )

        return MeshDetectionResult(faces=faces)

    # ------------------------------------------------------------------
    # Context-manager support
    # ------------------------------------------------------------------

    def __enter__(self) -> "FaceMeshDetector":
        self.open()
        return self

    def __exit__(self, *_) -> None:
        self.close()
