# proctoring/fps_counter.py
# Rolling-average FPS counter.
# A simple ring buffer keeps the last N frame intervals so the displayed
# value is stable instead of jumping every frame.

import time
from collections import deque


class FPSCounter:
    """
    Calculates a smoothed frames-per-second value.

    Parameters
    ----------
    window : int
        Number of recent frame durations to average over.
        Larger → smoother but slower to react to sudden changes.
        Default: 30 frames.

    Example
    -------
        counter = FPSCounter()
        while capturing:
            counter.tick()
            fps = counter.fps
    """

    def __init__(self, window: int = 30) -> None:
        self._window = window
        self._timestamps: deque[float] = deque(maxlen=window)

    def tick(self) -> None:
        """Record the timestamp of the current frame."""
        self._timestamps.append(time.perf_counter())

    @property
    def fps(self) -> float:
        """
        Return the rolling-average FPS.

        Returns 0.0 if fewer than 2 frames have been recorded yet.
        """
        if len(self._timestamps) < 2:
            return 0.0

        # Total elapsed time across the window
        elapsed = self._timestamps[-1] - self._timestamps[0]
        if elapsed <= 0:
            return 0.0

        return (len(self._timestamps) - 1) / elapsed
