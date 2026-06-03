# proctoring/webcam.py
# Webcam abstraction layer.
# Wraps OpenCV VideoCapture so the rest of the system never
# has to deal with raw capture handles or error-prone boilerplate.

import cv2
import sys
from typing import Optional, Tuple

import config


class WebcamError(RuntimeError):
    """Raised when the webcam cannot be opened or a frame cannot be read."""


class Webcam:
    """
    Manages a single OpenCV VideoCapture instance.

    Usage
    -----
        cam = Webcam()
        cam.open()
        ok, frame = cam.read_frame()
        cam.release()

    Or as a context manager:
        with Webcam() as cam:
            ok, frame = cam.read_frame()
    """

    def __init__(
        self,
        index: int = config.CAMERA_INDEX,
        width: int = config.FRAME_WIDTH,
        height: int = config.FRAME_HEIGHT,
    ) -> None:
        self._index = index
        self._width = width
        self._height = height
        self._cap: Optional[cv2.VideoCapture] = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def open(self) -> None:
        """
        Open the webcam and apply the requested resolution.

        Raises
        ------
        WebcamError
            If the camera cannot be accessed (e.g. no device, permission denied).
        """
        self._cap = cv2.VideoCapture(self._index)

        if not self._cap.isOpened():
            raise WebcamError(
                f"Cannot open camera at index {self._index}. "
                "Make sure the webcam is connected and not in use by another application."
            )

        # Request the desired resolution; the driver may silently clamp to what
        # it supports, so we read back the actual values and log them.
        self._cap.set(cv2.CAP_PROP_FRAME_WIDTH, self._width)
        self._cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self._height)

        actual_w = int(self._cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        actual_h = int(self._cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        print(f"[Webcam] Opened camera {self._index} at {actual_w}×{actual_h}")

    def read_frame(self) -> Tuple[bool, Optional[object]]:
        """
        Capture a single frame from the webcam.

        Returns
        -------
        (success, frame)
            success : bool   – True when a valid frame was grabbed.
            frame   : ndarray | None – The BGR image or None on failure.
        """
        if self._cap is None or not self._cap.isOpened():
            return False, None

        success, frame = self._cap.read()
        return success, frame if success else None

    def release(self) -> None:
        """Release the VideoCapture resource."""
        if self._cap is not None:
            self._cap.release()
            self._cap = None
            print("[Webcam] Camera released.")

    # ------------------------------------------------------------------
    # Context-manager support  (with Webcam() as cam: …)
    # ------------------------------------------------------------------

    def __enter__(self) -> "Webcam":
        self.open()
        return self

    def __exit__(self, *_) -> None:
        self.release()
