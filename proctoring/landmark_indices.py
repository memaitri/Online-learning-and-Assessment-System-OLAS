# proctoring/landmark_indices.py
# ─────────────────────────────────────────────────────────────────────────────
# MediaPipe FaceLandmarker — canonical landmark index registry
#
# The FaceLandmarker model outputs 478 landmarks per face.
# Indices 0-467 are the standard 468-point face mesh.
# Indices 468-477 are the 10 iris landmarks (5 per eye), appended at the end.
#
# This file is the SINGLE SOURCE OF TRUTH for every landmark index used
# across the entire proctoring system.  Future modules (gaze tracking,
# head-pose estimation, blink detection, mouth detection) must import
# their indices from here — never hard-code numbers in business logic.
#
# Reference
# ─────────
#   https://github.com/google/mediapipe/blob/master/mediapipe/modules/
#   face_geometry/data/canonical_face_model_uv_visualization.png
#
#   Iris landmarks reference:
#   https://google.github.io/mediapipe/solutions/face_mesh.html#python-solution-api
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations
from typing import Tuple


# ─────────────────────────────────────────────────────────────────────────────
# Total landmark count
# ─────────────────────────────────────────────────────────────────────────────

TOTAL_LANDMARKS: int = 478       # 468 mesh + 10 iris
MESH_LANDMARKS:  int = 468       # standard face mesh only
IRIS_LANDMARKS:  int = 10        # 5 left + 5 right (appended after mesh)


# ─────────────────────────────────────────────────────────────────────────────
# Iris landmarks  (indices 468–477)
# ─────────────────────────────────────────────────────────────────────────────
# Layout per eye (relative to the eye's 5-point group):
#   0 = centre of iris
#   1 = right edge of iris
#   2 = top  edge of iris
#   3 = left edge of iris
#   4 = bottom edge of iris

class IrisIndex:
    """
    Landmark indices for the iris region.

    Used by: Module 4 (Eye Gaze Tracking), Module 6 (Blink Detection).
    """
    # ── Left iris (from subject's perspective) ───────────────────────────────
    LEFT_IRIS_CENTER:  int = 468
    LEFT_IRIS_RIGHT:   int = 469
    LEFT_IRIS_TOP:     int = 470
    LEFT_IRIS_LEFT:    int = 471
    LEFT_IRIS_BOTTOM:  int = 472

    # ── Right iris ───────────────────────────────────────────────────────────
    RIGHT_IRIS_CENTER: int = 473
    RIGHT_IRIS_RIGHT:  int = 474
    RIGHT_IRIS_TOP:    int = 475
    RIGHT_IRIS_LEFT:   int = 476
    RIGHT_IRIS_BOTTOM: int = 477

    # ── Convenience groups ───────────────────────────────────────────────────
    LEFT_IRIS_ALL:  Tuple[int, ...] = (468, 469, 470, 471, 472)
    RIGHT_IRIS_ALL: Tuple[int, ...] = (473, 474, 475, 476, 477)
    ALL_IRIS:       Tuple[int, ...] = (468, 469, 470, 471, 472,
                                       473, 474, 475, 476, 477)


# ─────────────────────────────────────────────────────────────────────────────
# Eye contour landmarks  (standard mesh, indices 0-467)
# ─────────────────────────────────────────────────────────────────────────────
# Used by: Module 6 (Blink Detection) via EAR (Eye Aspect Ratio).
#
# Each eye has 6 contour points arranged so that points 1/4 are the
# horizontal ends and 2/3/5/6 are the vertical pairs.
# EAR = (||p2-p6|| + ||p3-p5||) / (2 * ||p1-p4||)

class EyeIndex:
    """
    Landmark indices for the eye contours (blink / openness detection).

    Used by: Module 6 (Blink Detection).
    """
    # ── Left eye ─────────────────────────────────────────────────────────────
    LEFT_EYE_OUTER:        int = 33    # left-most point
    LEFT_EYE_INNER:        int = 133   # right-most point (near nose)
    LEFT_EYE_TOP_OUTER:    int = 159   # upper-lid, outer
    LEFT_EYE_TOP_INNER:    int = 158   # upper-lid, inner
    LEFT_EYE_BOTTOM_OUTER: int = 145   # lower-lid, outer
    LEFT_EYE_BOTTOM_INNER: int = 153   # lower-lid, inner

    # EAR 6-point set (matches dlib convention): outer, top-outer, top-inner,
    # inner, bottom-inner, bottom-outer
    LEFT_EAR_POINTS: Tuple[int, ...] = (33, 159, 158, 133, 153, 145)

    # ── Right eye ────────────────────────────────────────────────────────────
    RIGHT_EYE_OUTER:        int = 362
    RIGHT_EYE_INNER:        int = 263
    RIGHT_EYE_TOP_OUTER:    int = 386
    RIGHT_EYE_TOP_INNER:    int = 385
    RIGHT_EYE_BOTTOM_OUTER: int = 374
    RIGHT_EYE_BOTTOM_INNER: int = 380

    RIGHT_EAR_POINTS: Tuple[int, ...] = (362, 386, 385, 263, 380, 374)


# ─────────────────────────────────────────────────────────────────────────────
# Head-pose anchor landmarks
# ─────────────────────────────────────────────────────────────────────────────
# These 6 anatomically stable points are used to solve the PnP problem
# (solvePnP) for head-pose estimation (pitch / yaw / roll).
#
# Used by: Module 5 (Head Pose Estimation).

class HeadPoseIndex:
    """
    Landmark indices for head-pose estimation via PnP.

    Used by: Module 5 (Head Pose Estimation).

    The 6 points below correspond to the same anatomical landmarks used in
    the classic 6-point head-pose method (Gaze estimation, Zhu & Ramanan 2012).
    """
    NOSE_TIP:          int = 1      # tip of the nose
    CHIN:              int = 152    # bottom of the chin
    LEFT_EYE_CORNER:   int = 226    # outer left eye corner
    RIGHT_EYE_CORNER:  int = 446    # outer right eye corner
    LEFT_MOUTH:        int = 57     # left mouth corner
    RIGHT_MOUTH:       int = 287    # right mouth corner

    # Ordered tuple — must stay in this order for solvePnP
    PNP_POINTS: Tuple[int, ...] = (1, 152, 226, 446, 57, 287)


# ─────────────────────────────────────────────────────────────────────────────
# Mouth landmarks
# ─────────────────────────────────────────────────────────────────────────────
# Used by: Module 7 (Mouth Open / Yawn Detection) via MAR (Mouth Aspect Ratio).

class MouthIndex:
    """
    Landmark indices for mouth-openness / yawn detection.

    Used by: Module 7 (Mouth Open Detection).
    """
    UPPER_LIP_TOP:    int = 13     # top of the upper lip (centre)
    LOWER_LIP_BOTTOM: int = 14     # bottom of the lower lip (centre)
    MOUTH_LEFT:       int = 61     # left mouth corner
    MOUTH_RIGHT:      int = 291    # right mouth corner

    # 8-point MAR set (vertical and horizontal pairs)
    MAR_POINTS: Tuple[int, ...] = (61, 39, 37, 0, 267, 269, 291, 17)
