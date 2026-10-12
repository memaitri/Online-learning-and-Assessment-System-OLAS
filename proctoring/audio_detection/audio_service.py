# audio_detection/audio_service.py
# ─────────────────────────────────────────────────────────────────────────────
# AudioService — microphone capture lifecycle, violation tracking, and the
# background capture thread.
#
# Why a background thread?
# ─────────────────────────
# Audio capture must run continuously at ~15 Hz (1024 samples / 16 kHz) to
# avoid microphone buffer overruns.  Running it synchronously inside the
# OpenCV frame loop (which may stall during YOLO inference or mediapipe
# landmark detection) would cause dropped audio chunks.  The solution is:
#
#   • A daemon thread reads audio chunks in a tight loop.
#   • The latest AudioDetectionResult is written to a thread-safe slot.
#   • main.py reads the slot once per video frame — zero blocking.
#
# AudioViolationTracker (inside this module) mirrors the pattern used by
# GazeViolationTracker and HeadViolationTracker:
#
#   • Speech must be SUSTAINED for AUDIO_SPEECH_TIMEOUT seconds before a
#     TALKING violation fires.  A cough or chair-scrape will NOT trigger.
#   • A NOISE_SPIKE fires immediately on the first supra-threshold chunk
#     (same instant-violation logic as phone detection).
#   • Both reset when audio returns to a normal level.
#
# Public API (called from main.py)
# ─────────────────────────────────
#   service = AudioService(on_violation=handle_audio)
#   service.start()
#
#   # Inside the frame loop (non-blocking — reads latest cached result):
#   result = service.latest_result
#   # violation_tracker is updated internally by the background thread
#
#   service.stop()
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import threading
import time
from enum import Enum, auto
from typing import Callable, Optional

import config
from audio_detection.audio_detector import AudioDetector, AudioDetectorError
from audio_detection.audio_models   import AudioDetectionResult, AudioAlert


# ─────────────────────────────────────────────────────────────────────────────
# AudioViolationTracker
# ─────────────────────────────────────────────────────────────────────────────

class _SpeechViolationState(Enum):
    """Internal states for the sustained-speech tracker."""
    SILENT    = auto()   # audio is below RMS threshold
    TIMING    = auto()   # audio is above threshold, clock is ticking
    VIOLATED  = auto()   # threshold exceeded for > AUDIO_SPEECH_TIMEOUT s


class AudioViolationTracker:
    """
    Fires callbacks when sustained speech or sudden noise spikes are detected.

    Speech (TALKING) violation logic
    ──────────────────────────────────
    • Each analysis chunk where is_speech=True advances a running timer.
    • Once the timer exceeds AUDIO_SPEECH_TIMEOUT, a TALKING violation fires.
    • The violation fires ONCE per episode.  Subsequent chunks in the same
      episode do NOT re-fire the callback.
    • When audio drops below the RMS threshold, the timer and state reset,
      allowing a future episode to fire again.

    Noise-spike (NOISE_SPIKE) violation logic
    ──────────────────────────────────────────
    • A NOISE_SPIKE fires immediately on the first chunk exceeding
      AUDIO_SPIKE_THRESHOLD — no timeout required.
    • Resets as soon as audio is no longer in spike territory.

    Parameters
    ----------
    on_violation : callable, optional
        ``on_violation(alert, rms_level, duration_s)``
        Called once per violation episode.
    speech_timeout : float
        Seconds of continuous speech before TALKING fires.
        Defaults to config.AUDIO_SPEECH_TIMEOUT.
    """

    def __init__(
        self,
        on_violation:   Optional[Callable[[AudioAlert, float, float], None]] = None,
        speech_timeout: float = config.AUDIO_SPEECH_TIMEOUT,
    ) -> None:
        self._on_violation    = on_violation
        self._speech_timeout  = speech_timeout
        self._state           = _SpeechViolationState.SILENT
        self._speech_start:   float = 0.0   # wall-clock time episode started
        self._violation_count: int  = 0
        self._spike_active:   bool  = False  # True while spike is ongoing

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def update(self, result: AudioDetectionResult) -> AudioDetectionResult:
        """
        Advance the state machine from the latest detection result.

        Fills in ``result.seconds_loud`` and updates ``result.alert``
        to reflect the current violation state.  Returns the enriched result.

        Parameters
        ----------
        result : AudioDetectionResult  Raw result from AudioDetector.analyse().

        Returns
        -------
        AudioDetectionResult  Same object with seconds_loud and alert updated.
        """
        now = time.monotonic()

        # ── Noise spike (instant, no timeout) ─────────────────────────────
        if result.alert == AudioAlert.NOISE_SPIKE:
            if not self._spike_active:
                # New spike episode
                self._spike_active = True
                self._violation_count += 1
                if self._on_violation is not None:
                    self._on_violation(AudioAlert.NOISE_SPIKE, result.rms_level, 0.0)
            # Keep state but reset speech timer — spike overrides speech
            self._state = _SpeechViolationState.SILENT
            result.seconds_loud = 0.0
            result.alert        = AudioAlert.NOISE_SPIKE
            return result
        else:
            self._spike_active = False   # spike episode ended

        # ── Sustained speech tracker ──────────────────────────────────────
        if result.is_speech:
            if self._state == _SpeechViolationState.SILENT:
                # Start timing this speech episode
                self._state        = _SpeechViolationState.TIMING
                self._speech_start = now

            seconds_loud = now - self._speech_start
            result.seconds_loud = round(seconds_loud, 1)

            if (
                self._state == _SpeechViolationState.TIMING
                and seconds_loud >= self._speech_timeout
            ):
                # Threshold exceeded — fire violation once
                self._state = _SpeechViolationState.VIOLATED
                self._violation_count += 1
                result.alert = AudioAlert.TALKING
                if self._on_violation is not None:
                    self._on_violation(
                        AudioAlert.TALKING, result.rms_level, seconds_loud
                    )
            elif self._state == _SpeechViolationState.VIOLATED:
                result.alert = AudioAlert.TALKING   # still in violation

        else:
            # Audio is quiet — reset speech episode
            self._state         = _SpeechViolationState.SILENT
            self._speech_start  = 0.0
            result.seconds_loud = 0.0
            result.alert        = AudioAlert.NONE

        return result

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def violation_count(self) -> int:
        """Total distinct violation episodes (TALKING + NOISE_SPIKE)."""
        return self._violation_count

    @property
    def is_currently_violated(self) -> bool:
        """True while a speech or spike violation is active."""
        return (
            self._state == _SpeechViolationState.VIOLATED
            or self._spike_active
        )

    @property
    def seconds_loud(self) -> float:
        """Elapsed seconds in the current speech episode (0 if silent)."""
        if self._state in (
            _SpeechViolationState.TIMING,
            _SpeechViolationState.VIOLATED,
        ):
            return round(time.monotonic() - self._speech_start, 1)
        return 0.0

    def reset(self) -> None:
        """Full reset — clears state and violation count."""
        self._state           = _SpeechViolationState.SILENT
        self._speech_start    = 0.0
        self._violation_count = 0
        self._spike_active    = False


# ─────────────────────────────────────────────────────────────────────────────
# AudioService — public API used by main.py
# ─────────────────────────────────────────────────────────────────────────────

class AudioService:
    """
    Manages the AudioDetector lifecycle and runs continuous capture in a
    background daemon thread.

    The background thread calls AudioDetector.analyse() in a tight loop,
    updates the AudioViolationTracker, and posts the latest result to a
    thread-safe slot.  main.py reads ``service.latest_result`` once per
    video frame — completely non-blocking.

    Parameters
    ----------
    on_violation   : callable, optional
        ``on_violation(alert, rms_level, duration_s)`` called once per
        violation episode.
    sample_rate    : int    Microphone sample rate.  Default 16 000 Hz.
    chunk_size     : int    PCM frames per read buffer.  Default 1 024.
    device_index   : int, optional
        PyAudio device index.  None = system default microphone.

    Example
    -------
        service = AudioService(on_violation=handle_audio_violation)
        service.start()

        # In frame loop:
        result = service.latest_result   # always available, never blocks

        service.stop()
    """

    def __init__(
        self,
        on_violation: Optional[Callable[[AudioAlert, float, float], None]] = None,
        sample_rate:  int           = config.AUDIO_SAMPLE_RATE,
        chunk_size:   int           = config.AUDIO_CHUNK_SIZE,
        device_index: Optional[int] = config.AUDIO_DEVICE_INDEX,
    ) -> None:
        self._detector = AudioDetector(
            sample_rate=sample_rate,
            chunk_size=chunk_size,
            device_index=device_index,
            rms_threshold=config.AUDIO_RMS_THRESHOLD,
            spike_threshold=config.AUDIO_SPIKE_THRESHOLD,
        )
        self.violation_tracker = AudioViolationTracker(
            on_violation=on_violation,
            speech_timeout=config.AUDIO_SPEECH_TIMEOUT,
        )
        self._latest_result: AudioDetectionResult = AudioDetectionResult.silent(
            sample_rate=sample_rate,
            chunk_size=chunk_size,
        )
        self._lock         = threading.Lock()
        self._stop_event   = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._started      = False

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self) -> None:
        """
        Open the microphone and start the background capture thread.

        Raises
        ------
        AudioDetectorError
            If PyAudio is not installed or the microphone cannot be opened.
        """
        self._detector.open()
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._capture_loop,
            name="AudioCaptureThread",
            daemon=True,
        )
        self._thread.start()
        self._started = True
        print("[AudioService] Background capture thread started.")

    def stop(self) -> None:
        """Stop the background thread and release the microphone."""
        if not self._started:
            return
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=2.0)
            self._thread = None
        self._detector.close()
        self._started = False
        print("[AudioService] Stopped.")

    # ------------------------------------------------------------------
    # Per-frame API (called from main.py)
    # ------------------------------------------------------------------

    @property
    def latest_result(self) -> AudioDetectionResult:
        """
        The most recent AudioDetectionResult from the background thread.

        Thread-safe read — never blocks.  Returns a silent result before
        the first audio chunk is processed.
        """
        with self._lock:
            return self._latest_result

    # ------------------------------------------------------------------
    # Background capture loop
    # ------------------------------------------------------------------

    def _capture_loop(self) -> None:
        """
        Tight loop: read chunk → analyse → update tracker → store result.

        Runs in a daemon thread so it is automatically killed when the
        main process exits.
        """
        while not self._stop_event.is_set():
            try:
                raw_result = self._detector.analyse()
                enriched   = self.violation_tracker.update(raw_result)
                with self._lock:
                    self._latest_result = enriched
            except Exception as exc:
                # Non-fatal: log and continue so the video loop keeps running
                print(f"[AudioService] Capture error (non-fatal): {exc}")
                self._stop_event.wait(timeout=0.1)

    # ------------------------------------------------------------------
    # Context-manager support
    # ------------------------------------------------------------------

    def __enter__(self) -> "AudioService":
        self.start()
        return self

    def __exit__(self, *_) -> None:
        self.stop()
