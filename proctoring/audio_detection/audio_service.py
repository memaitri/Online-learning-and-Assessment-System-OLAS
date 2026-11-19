# audio_detection/audio_service.py
# ─────────────────────────────────────────────────────────────────────────────
# Background-thread audio monitoring service.
#
# AudioService wraps AudioDetector in a daemon thread that continuously
# reads microphone chunks, classifies them, and fires an on_violation
# callback when speech or noise-spike thresholds are exceeded.
#
# The violation tracker implements a state machine:
#   SILENT → (speech starts) → TIMING → (sustained > timeout) → VIOLATED
#   Any state → (silence) → SILENT
#   Any state → (noise spike) → immediate violation + reset to SILENT
#
# Usage (mirrors PhoneService):
#   service = AudioService(on_violation=callback)
#   service.start()          # opens mic + starts background thread
#   result = service.latest_result()
#   service.stop()
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import threading
import time
from enum import Enum, auto
from typing import Callable, Optional

import config
from audio_detection.audio_detector import AudioDetector, AudioDetectorError
from audio_detection.audio_models  import AudioDetectionResult, AudioAlert


# ─────────────────────────────────────────────────────────────────────────────
# Internal state machine for sustained-speech tracking
# ─────────────────────────────────────────────────────────────────────────────

class _SpeechViolationState(Enum):
    """Internal states for the sustained-speech tracker."""
    SILENT   = auto()
    TIMING   = auto()
    VIOLATED = auto()


# ─────────────────────────────────────────────────────────────────────────────
# AudioViolationTracker — state machine for speech / spike violations
# ─────────────────────────────────────────────────────────────────────────────

class AudioViolationTracker:
    """
    State machine that converts raw AudioDetectionResult objects into
    discrete violation events.

    Sustained speech requires ``speech_timeout`` seconds of continuous
    audio above the RMS threshold before a TALKING violation fires.

    Noise spikes fire immediately (single-chunk detection).
    """

    def __init__(
        self,
        on_violation:  Optional[Callable[[AudioAlert, float, float], None]],
        speech_timeout: float = config.AUDIO_SPEECH_TIMEOUT,
    ) -> None:
        self._on_violation   = on_violation
        self._speech_timeout = speech_timeout
        self._state:          _SpeechViolationState = _SpeechViolationState.SILENT
        self._speech_start:   float = 0.0
        self._violation_count: int   = 0
        self._spike_active:    bool  = False

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

        # ── Noise spike — immediate violation, then reset ────────────────
        if result.alert == AudioAlert.NOISE_SPIKE:
            if not self._spike_active:
                self._spike_active = True
                self._violation_count += 1
                if self._on_violation is not None:
                    self._on_violation(AudioAlert.NOISE_SPIKE, result.rms_level, 0.0)

            # Reset speech state after a spike
            self._state = _SpeechViolationState.SILENT
            result.seconds_loud = 0.0
            result.alert = AudioAlert.NOISE_SPIKE
            return result

        # Not a spike — clear spike flag
        self._spike_active = False

        # ── Sustained speech state machine ──────────────────────────────
        if result.is_speech:
            if self._state == _SpeechViolationState.SILENT:
                self._state = _SpeechViolationState.TIMING
                self._speech_start = now

            # Always update seconds_loud
            seconds_loud = now - self._speech_start
            result.seconds_loud = round(seconds_loud, 1)

            # Check if sustained speech exceeds timeout
            if self._state == _SpeechViolationState.TIMING:
                if seconds_loud >= self._speech_timeout:
                    self._state = _SpeechViolationState.VIOLATED
                    self._violation_count += 1
                    result.alert = AudioAlert.TALKING
                    if self._on_violation is not None:
                        self._on_violation(
                            AudioAlert.TALKING,
                            result.rms_level,
                            seconds_loud,
                        )
                    return result

            if self._state == _SpeechViolationState.VIOLATED:
                result.alert = AudioAlert.TALKING

            return result

        # ── Silence — reset state machine ───────────────────────────────
        self._state = _SpeechViolationState.SILENT
        self._speech_start = 0.0
        result.seconds_loud = 0.0
        result.alert = AudioAlert.NONE
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
        if self._state in (_SpeechViolationState.TIMING, _SpeechViolationState.VIOLATED):
            return round(time.monotonic() - self._speech_start, 1)
        return 0.0

    def reset(self) -> None:
        """Full reset — clears state and violation count."""
        self._state = _SpeechViolationState.SILENT
        self._speech_start = 0.0
        self._violation_count = 0
        self._spike_active = False


# ─────────────────────────────────────────────────────────────────────────────
# AudioService — background-thread audio monitor
# ─────────────────────────────────────────────────────────────────────────────

class AudioService:
    """
    Background-thread audio proctoring service.

    Opens the microphone, continuously reads and classifies audio chunks
    in a daemon thread, and fires ``on_violation`` when speech or noise
    spikes are detected.

    Parameters
    ----------
    on_violation : callable(alert: AudioAlert, rms_level: float, seconds_loud: float)
        Callback fired on each violation episode.
    sample_rate  : int   Microphone sample rate (Hz).  Default: config.AUDIO_SAMPLE_RATE.
    chunk_size   : int   PCM frames per analysis chunk.  Default: config.AUDIO_CHUNK_SIZE.
    device_index : int   PyAudio device index.  Default: config.AUDIO_DEVICE_INDEX.
    """

    def __init__(
        self,
        on_violation:  Optional[Callable[[AudioAlert, float, float], None]],
        sample_rate:   int  = config.AUDIO_SAMPLE_RATE,
        chunk_size:    int  = config.AUDIO_CHUNK_SIZE,
        device_index:  Optional[int] = config.AUDIO_DEVICE_INDEX,
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
            sample_rate=sample_rate, chunk_size=chunk_size,
        )
        self._lock:       threading.Lock  = threading.Lock()
        self._stop_event: threading.Event = threading.Event()
        self._thread:     Optional[threading.Thread] = None
        self._started:    bool = False

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
        self._started = False
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=2.0)
        self._detector.close()
        print("[AudioService] Stopped.")

    # ------------------------------------------------------------------

    def latest_result(self) -> AudioDetectionResult:
        """
        The most recent AudioDetectionResult from the background thread.

        Thread-safe read — never blocks.  Returns a silent result before
        the first audio chunk is processed.
        """
        with self._lock:
            return self._latest_result

    # ------------------------------------------------------------------

    def _capture_loop(self) -> None:
        """
        Tight loop: read chunk → analyse → update tracker → store result.

        Runs in a daemon thread so it is automatically killed when the
        main process exits.
        """
        while not self._stop_event.is_set():
            try:
                result = self._detector.analyse()
                result = self.violation_tracker.update(result)
                with self._lock:
                    self._latest_result = result
            except Exception as exc:
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
