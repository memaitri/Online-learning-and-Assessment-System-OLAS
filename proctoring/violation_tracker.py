# proctoring/violation_tracker.py
# ─────────────────────────────────────────────────────────────────────────────
# Tracks proctoring violations and fires callbacks only on state *changes*.
#
# Design goal: the tracker is deliberately decoupled from display and logging.
# The caller (main.py) decides what to do when a violation is reported —
# this class only decides *when* to report it.
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

from enum import Enum, auto
from typing import Callable, Optional


class ProctoringStatus(Enum):
    """
    All possible proctoring states.

    ``OK``              — Exactly one face detected; everything is fine.
    ``NO_FACE``         — Zero faces detected.
    ``MULTIPLE_FACES``  — More than one face detected.
    ``UNKNOWN``         — Initial / indeterminate state (before any frame is
                          processed).
    """
    UNKNOWN = auto()
    OK = auto()
    NO_FACE = auto()
    MULTIPLE_FACES = auto()


# Human-readable labels for overlay display.
STATUS_LABELS: dict[ProctoringStatus, str] = {
    ProctoringStatus.UNKNOWN:         "Initialising…",
    ProctoringStatus.OK:              "OK — Face Detected",
    ProctoringStatus.NO_FACE:         "Violation: No Face Detected",
    ProctoringStatus.MULTIPLE_FACES:  "Violation: Multiple Faces Detected",
}


class ViolationTracker:
    """
    Stateful tracker that converts per-frame face counts into violations.

    Violation counting rule
    -----------------------
    A violation counter is incremented **once** when the system *enters* a
    violation state (NO_FACE or MULTIPLE_FACES).  Subsequent frames that
    remain in the same violation state do *not* increment the counter.
    The counter resets the state machine when the face count returns to 1.

    Parameters
    ----------
    on_violation : callable, optional
        ``on_violation(status, face_count)`` is called each time a new
        violation state is entered.  Use this hook to trigger logging,
        alerts, or UI updates.

    Example
    -------
        def handle(status, count):
            print(f"New violation: {status.name}, faces={count}")

        tracker = ViolationTracker(on_violation=handle)
        tracker.update(0)   # → fires handle(NO_FACE, 0)
        tracker.update(0)   # → no callback (same state)
        tracker.update(1)   # → state resets to OK, no callback
        tracker.update(2)   # → fires handle(MULTIPLE_FACES, 2)
    """

    def __init__(
        self,
        on_violation: Optional[Callable[[ProctoringStatus, int], None]] = None,
    ) -> None:
        self._on_violation = on_violation
        self._current_status: ProctoringStatus = ProctoringStatus.UNKNOWN
        self._violation_count: int = 0

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def update(self, face_count: int) -> ProctoringStatus:
        """
        Feed the latest face count and update internal state.

        Parameters
        ----------
        face_count : int
            Number of faces detected in the current frame.

        Returns
        -------
        ProctoringStatus
            The status that applies to the current frame (may be unchanged
            from the previous call).
        """
        new_status = self._classify(face_count)

        if new_status != self._current_status:
            self._current_status = new_status

            # Increment counter and fire callback only when entering a
            # violation state — not when returning to OK or UNKNOWN.
            if new_status in (ProctoringStatus.NO_FACE, ProctoringStatus.MULTIPLE_FACES):
                self._violation_count += 1
                if self._on_violation is not None:
                    self._on_violation(new_status, face_count)

        return self._current_status

    @property
    def status(self) -> ProctoringStatus:
        """The most-recently computed :class:`ProctoringStatus`."""
        return self._current_status

    @property
    def violation_count(self) -> int:
        """Total number of distinct violation events recorded so far."""
        return self._violation_count

    @property
    def status_label(self) -> str:
        """Human-readable label for the current status."""
        return STATUS_LABELS.get(self._current_status, "Unknown")

    def reset(self) -> None:
        """Reset state and counters (e.g. between exam sessions)."""
        self._current_status = ProctoringStatus.UNKNOWN
        self._violation_count = 0

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _classify(face_count: int) -> ProctoringStatus:
        """Map a raw face count to a :class:`ProctoringStatus`."""
        if face_count == 0:
            return ProctoringStatus.NO_FACE
        if face_count == 1:
            return ProctoringStatus.OK
        return ProctoringStatus.MULTIPLE_FACES
