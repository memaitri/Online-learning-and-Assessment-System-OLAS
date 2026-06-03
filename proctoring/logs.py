# proctoring/logs.py
# ─────────────────────────────────────────────────────────────────────────────
# Structured violation logger.
#
# Writes one log entry per violation event to a plain-text file.
# Each entry is a fixed-width, human-readable line that is also easy
# to parse with standard tools (grep, awk, pandas).
#
# Log format
# ──────────
#   [2026-06-03 14:22:05.123]  VIOLATION  NO_FACE            faces=0
#   [2026-06-03 14:22:18.456]  VIOLATION  MULTIPLE_FACES     faces=3
#
# Usage
# ─────
#   logger = ViolationLogger()          # uses paths from config.py
#   logger.log(ProctoringStatus.NO_FACE, face_count=0)
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import os
import logging
from datetime import datetime
from typing import Optional

import config
from violation_tracker import ProctoringStatus


# ─────────────────────────────────────────────────────────────────────────────
# Logger class
# ─────────────────────────────────────────────────────────────────────────────

class ViolationLogger:
    """
    Append-only logger for proctoring violation events.

    Each :meth:`log` call writes one line containing:
    - ISO-8601 timestamp (millisecond precision)
    - Event category  (always ``VIOLATION``)
    - Violation type  (e.g. ``NO_FACE``, ``MULTIPLE_FACES``)
    - Face count at the time of the event

    Parameters
    ----------
    log_dir      : str, optional
        Directory where the log file will be created.
        Defaults to :data:`config.LOG_DIR`.
    log_filename : str, optional
        Name of the log file.
        Defaults to :data:`config.LOG_FILENAME`.
    """

    def __init__(
        self,
        log_dir: str = config.LOG_DIR,
        log_filename: str = config.LOG_FILENAME,
    ) -> None:
        self._log_dir = log_dir
        self._log_filename = log_filename
        self._log_path: str = os.path.join(log_dir, log_filename)
        self._logger: Optional[logging.Logger] = None

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def setup(self) -> None:
        """
        Create the log directory (if needed) and configure the file handler.

        Call once before :meth:`log`.
        """
        os.makedirs(self._log_dir, exist_ok=True)

        # Use a named logger so it is isolated from the root logger and
        # won't interfere with other libraries.
        self._logger = logging.getLogger("olas.proctoring.violations")
        self._logger.setLevel(logging.DEBUG)

        # Avoid adding duplicate handlers if setup() is called twice.
        if not self._logger.handlers:
            fh = logging.FileHandler(self._log_path, encoding="utf-8")
            fh.setLevel(logging.DEBUG)
            fh.setFormatter(
                logging.Formatter(
                    fmt="[%(asctime)s]  %(message)s",
                    datefmt="%Y-%m-%d %H:%M:%S",
                )
            )
            self._logger.addHandler(fh)

        print(f"[ViolationLogger] Logging to → {self._log_path}")

    def close(self) -> None:
        """Flush and close all file handlers."""
        if self._logger:
            for handler in list(self._logger.handlers):
                handler.flush()
                handler.close()
                self._logger.removeHandler(handler)

    # ------------------------------------------------------------------
    # Logging API
    # ------------------------------------------------------------------

    def log(self, status: ProctoringStatus, face_count: int) -> None:
        """
        Append one violation event to the log file.

        Parameters
        ----------
        status     : ProctoringStatus
            The violation type (``NO_FACE``, ``MULTIPLE_FACES``).
        face_count : int
            Number of faces that triggered this event.

        Notes
        -----
        Silently no-ops if :meth:`setup` has not been called yet, so the
        caller does not need to guard against an uninitialised logger.
        """
        if self._logger is None:
            return

        # Fixed-width columns make the log file easy to diff/grep.
        message = (
            f"VIOLATION  "
            f"{status.name:<20s}  "
            f"faces={face_count}"
        )
        self._logger.info(message)

    def log_gaze_violation(
        self,
        direction: str,
        duration_s: float,
    ) -> None:
        """
        Append one gaze-away violation event to the log file.

        Parameters
        ----------
        direction  : str    — GazeDirection value (e.g. "LEFT").
        duration_s : float  — How long the gaze was away (seconds).
        """
        if self._logger is None:
            return

        message = (
            f"VIOLATION  "
            f"{'LOOKING_AWAY':<20s}  "
            f"direction={direction:<8s}  "
            f"duration={duration_s:.2f}s"
        )
        self._logger.info(message)

    def log_head_violation(
        self,
        direction: str,
        yaw:       float,
        pitch:     float,
        roll:      float,
        duration_s: float,
    ) -> None:
        """
        Append one head-turned-away violation event to the log file.

        Parameters
        ----------
        direction  : str   — HeadDirection value (e.g. "LEFT").
        yaw        : float — Yaw angle in degrees at time of violation.
        pitch      : float — Pitch angle in degrees.
        roll       : float — Roll angle in degrees.
        duration_s : float — How long the head was turned away (seconds).
        """
        if self._logger is None:
            return

        message = (
            f"VIOLATION  "
            f"{'HEAD_TURNED_AWAY':<20s}  "
            f"direction={direction:<8s}  "
            f"yaw={yaw:+.1f}  "
            f"pitch={pitch:+.1f}  "
            f"roll={roll:+.1f}  "
            f"duration={duration_s:.2f}s"
        )
        self._logger.info(message)

    def log_phone_violation(
        self,
        phone_count: int,
        confidence:  float,
    ) -> None:
        """
        Append one phone-detection violation event to the log file.

        Parameters
        ----------
        phone_count : int   — Number of phones detected.
        confidence  : float — Highest confidence score among detections.
        """
        if self._logger is None:
            return

        message = (
            f"VIOLATION  "
            f"{'PHONE_DETECTED':<20s}  "
            f"count={phone_count}  "
            f"confidence={confidence:.3f}"
        )
        self._logger.info(message)

    # ------------------------------------------------------------------
    # Context-manager support
    # ------------------------------------------------------------------

    def __enter__(self) -> "ViolationLogger":
        self.setup()
        return self

    def __exit__(self, *_) -> None:
        self.close()
