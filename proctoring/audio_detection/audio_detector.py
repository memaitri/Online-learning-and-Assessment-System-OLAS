# audio_detection/audio_detector.py
# ─────────────────────────────────────────────────────────────────────────────
# AudioDetector — microphone capture and RMS-based speech detection.
#
# Responsibilities
# ────────────────
# • Open the system microphone via PyAudio.
# • Read one chunk of PCM audio per call to analyse().
# • Compute RMS amplitude and approximate dB level.
# • Classify the chunk as speech / noise-spike / silent.
# • Return an AudioDetectionResult — no violation state lives here.
#
# This class does NOT:
# • Track how long speech has been sustained (that's AudioViolationTracker).
# • Fire violation callbacks (that's AudioService).
# • Draw anything (that's display.py).
#
# Dependencies
# ────────────
# • PyAudio  — pip install pyaudio
# • numpy    — already in requirements.txt
#
# Notes on PyAudio installation on Windows
# ─────────────────────────────────────────
# If `pip install pyaudio` fails on Windows due to missing PortAudio headers,
# use the pre-built wheel:
#   pip install pipwin && pipwin install pyaudio
# or:
#   pip install pyaudio --find-links https://www.lfd.uci.edu/~gohlke/pythonlibs/
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import math
from typing import Optional

import numpy as np

import config
from audio_detection.audio_models import AudioDetectionResult, AudioAlert


class AudioDetectorError(RuntimeError):
    """Raised when the microphone cannot be opened or audio capture fails."""


class AudioDetector:
    """
    Reads audio chunks from the system microphone and classifies them.

    Parameters
    ----------
    sample_rate         : int   Microphone sample rate (Hz). Default 16 000.
    chunk_size          : int   PCM frames per read buffer. Default 1 024.
    device_index        : int, optional
                                PyAudio input device index.  None = system
                                default microphone.
    rms_threshold       : float RMS level above which audio is classified as
                                speech.  Defaults to config.AUDIO_RMS_THRESHOLD.
    spike_threshold     : float RMS level for an instant noise-spike violation.
                                Defaults to config.AUDIO_SPIKE_THRESHOLD.

    Usage
    -----
        detector = AudioDetector()
        detector.open()

        result = detector.analyse()   # call every ~64 ms (1024 / 16000)

        detector.close()
    """

    def __init__(
        self,
        sample_rate:     int   = 16_000,
        chunk_size:      int   = 1_024,
        device_index:    Optional[int] = None,
        rms_threshold:   float = config.AUDIO_RMS_THRESHOLD,
        spike_threshold: float = config.AUDIO_SPIKE_THRESHOLD,
    ) -> None:
        self._sample_rate     = sample_rate
        self._chunk_size      = chunk_size
        self._device_index    = device_index
        self._rms_threshold   = rms_threshold
        self._spike_threshold = spike_threshold

        self._pa     = None   # pyaudio.PyAudio  — loaded lazily in open()
        self._stream = None   # pyaudio.Stream

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def open(self) -> None:
        """
        Initialise PyAudio and open the microphone input stream.

        Raises
        ------
        AudioDetectorError
            If PyAudio is not installed or the microphone cannot be opened.
        """
        try:
            import pyaudio  # deferred import keeps startup fast if not used
            self._pa = pyaudio.PyAudio()
            self._stream = self._pa.open(
                format=pyaudio.paInt16,
                channels=1,
                rate=self._sample_rate,
                input=True,
                input_device_index=self._device_index,
                frames_per_buffer=self._chunk_size,
            )
            device_name = self._get_device_name()
            print(
                f"[AudioDetector] Microphone opened: '{device_name}'  "
                f"rate={self._sample_rate} Hz  "
                f"chunk={self._chunk_size}  "
                f"rms_threshold={self._rms_threshold:.0f}  "
                f"spike_threshold={self._spike_threshold:.0f}"
            )
        except ImportError:
            raise AudioDetectorError(
                "PyAudio is not installed.\n"
                "  Install it with:  pip install pyaudio\n"
                "  On Windows if that fails:  pip install pipwin && pipwin install pyaudio"
            )
        except Exception as exc:
            raise AudioDetectorError(
                f"Failed to open microphone: {exc}\n"
                "  • Check that a microphone is connected and not in use by another app.\n"
                "  • Set AUDIO_DEVICE_INDEX in config.py to select a specific device."
            ) from exc

    def close(self) -> None:
        """Stop and close the audio stream, release PyAudio resources."""
        try:
            if self._stream is not None:
                self._stream.stop_stream()
                self._stream.close()
                self._stream = None
            if self._pa is not None:
                self._pa.terminate()
                self._pa = None
            print("[AudioDetector] Microphone closed.")
        except Exception as exc:
            print(f"[AudioDetector] Warning during close: {exc}")

    # ------------------------------------------------------------------
    # Analysis
    # ------------------------------------------------------------------

    def analyse(self) -> AudioDetectionResult:
        """
        Read one audio chunk and return a classification result.

        Returns ``AudioDetectionResult.silent()`` if:
        • The detector has not been opened.
        • A read error occurs (stream overflow etc.) — non-fatal.

        Returns
        -------
        AudioDetectionResult
        """
        if self._stream is None:
            return AudioDetectionResult.silent(self._sample_rate, self._chunk_size)

        try:
            raw = self._stream.read(self._chunk_size, exception_on_overflow=False)
        except Exception as exc:
            print(f"[AudioDetector] Read error (non-fatal): {exc}")
            return AudioDetectionResult.silent(self._sample_rate, self._chunk_size)

        # Convert raw bytes → int16 numpy array
        pcm = np.frombuffer(raw, dtype=np.int16).astype(np.float32)

        # RMS amplitude (0 – ~32 768 range for 16-bit PCM)
        rms = float(np.sqrt(np.mean(pcm ** 2))) if len(pcm) > 0 else 0.0

        # dB relative to full-scale (−96 dB when silent)
        if rms > 0:
            db = 20.0 * math.log10(rms / 32768.0)
        else:
            db = -96.0

        # Classify
        is_speech = rms >= self._rms_threshold
        is_spike  = rms >= self._spike_threshold

        if is_spike:
            alert = AudioAlert.NOISE_SPIKE
        elif is_speech:
            alert = AudioAlert.TALKING    # confirmed to TALKING after timeout
        else:
            alert = AudioAlert.NONE

        return AudioDetectionResult(
            rms_level=round(rms, 1),
            db_level=round(db, 1),
            is_speech=is_speech,
            alert=alert,
            seconds_loud=0.0,           # filled in by AudioViolationTracker
            sample_rate=self._sample_rate,
            chunk_size=self._chunk_size,
        )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _get_device_name(self) -> str:
        """Return the name of the active input device (best-effort)."""
        try:
            if self._device_index is not None:
                info = self._pa.get_device_info_by_index(self._device_index)
            else:
                info = self._pa.get_default_input_device_info()
            return str(info.get("name", "Unknown"))
        except Exception:
            return "Unknown"

    # ------------------------------------------------------------------
    # Context-manager support
    # ------------------------------------------------------------------

    def __enter__(self) -> "AudioDetector":
        self.open()
        return self

    def __exit__(self, *_) -> None:
        self.close()
