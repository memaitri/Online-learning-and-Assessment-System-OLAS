# audio_detection/audio_detector.py
# ─────────────────────────────────────────────────────────────────────────────
# Low-level microphone capture and RMS analysis.
#
# Wraps PyAudio to open the system microphone, read PCM chunks, and
# classify each chunk as speech, noise-spike, or silent based on RMS
# amplitude thresholds defined in config.py.
#
# This class is NOT thread-safe — it is intended to be called from a
# single background thread (AudioService._capture_loop).
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import math
import re
from typing import Optional

import numpy as np

import config
from audio_detection.audio_models import AudioDetectionResult, AudioAlert


# ─────────────────────────────────────────────────────────────────────────────
# Exception
# ─────────────────────────────────────────────────────────────────────────────

class AudioDetectorError(Exception):
    """Raised when PyAudio is missing or the microphone cannot be opened."""
    pass


def _resolve_input_device(pa, requested_index: Optional[int]) -> Optional[int]:
    if requested_index is not None:
        return requested_index

    default_info = pa.get_default_input_device_info()
    default_index = int(default_info["index"])
    default_name = str(default_info.get("name", "")).lower()
    virtual_markers = ("virtual", "cable", "loopback", "stereo mix")
    if not any(marker in default_name for marker in virtual_markers):
        return default_index

    candidates = []
    for index in range(pa.get_device_count()):
        info = pa.get_device_info_by_index(index)
        name = str(info.get("name", ""))
        normalized_name = name.lower()
        if info.get("maxInputChannels", 0) <= 0:
            continue
        if any(marker in normalized_name for marker in virtual_markers):
            continue
        if "microphone" in normalized_name or re.search(r"\bmic\b", normalized_name):
            candidates.append((index, name))

    if candidates:
        index, name = candidates[0]
        print(
            f"[AudioDetector] System default '{default_info.get('name', 'Unknown')}' "
            f"is virtual; using microphone '{name}' (device {index})."
        )
        return index

    print(
        f"[AudioDetector] Warning: system default '{default_info.get('name', 'Unknown')}' "
        "appears virtual, and no physical microphone was found; using the default."
    )
    return default_index


# ─────────────────────────────────────────────────────────────────────────────
# AudioDetector
# ─────────────────────────────────────────────────────────────────────────────

class AudioDetector:
    """
    Microphone capture and per-chunk RMS analysis.

    Usage
    ─────
        detector = AudioDetector()
        detector.open()
        result = detector.analyse()   # AudioDetectionResult
        detector.close()

    Or as a context manager::

        with AudioDetector() as detector:
            result = detector.analyse()
    """

    def __init__(
        self,
        sample_rate:    int   = config.AUDIO_SAMPLE_RATE,
        chunk_size:      int   = config.AUDIO_CHUNK_SIZE,
        device_index:    Optional[int] = config.AUDIO_DEVICE_INDEX,
        rms_threshold:   float = config.AUDIO_RMS_THRESHOLD,
        spike_threshold: float = config.AUDIO_SPIKE_THRESHOLD,
    ) -> None:
        self._sample_rate    = sample_rate
        self._chunk_size     = chunk_size
        self._device_index   = device_index
        self._rms_threshold  = rms_threshold
        self._spike_threshold = spike_threshold
        self._pa:    Optional[object] = None
        self._stream: Optional[object] = None

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
            import pyaudio
        except ImportError:
            raise AudioDetectorError(
                "PyAudio is not installed.\n"
                "  Install it with:  pip install pyaudio\n"
                "  On Windows if that fails:  pip install pipwin && pipwin install pyaudio"
            )

        try:
            self._pa = pyaudio.PyAudio()
            device_index = _resolve_input_device(self._pa, self._device_index)
            self._device_index = device_index
            self._stream = self._pa.open(
                format=pyaudio.paInt16,
                channels=1,
                rate=self._sample_rate,
                input=True,
                input_device_index=device_index,
                frames_per_buffer=self._chunk_size,
            )
            print(
                f"[AudioDetector] Microphone opened: '"
                f"{self._get_device_name()}'  "
                f"rate={self._sample_rate} Hz  chunk={self._chunk_size}  "
                f"rms_threshold={self._rms_threshold:.0f}  "
                f"spike_threshold={self._spike_threshold:.0f}"
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
            if self._pa is not None:
                self._pa.terminate()
            print("[AudioDetector] Microphone closed.")
        except Exception as exc:
            print(f"[AudioDetector] Warning during close: {exc}")

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
            return AudioDetectionResult.silent(
                sample_rate=self._sample_rate,
                chunk_size=self._chunk_size,
            )

        try:
            raw = self._stream.read(self._chunk_size, exception_on_overflow=False)
        except Exception as exc:
            print(f"[AudioDetector] Read error (non-fatal): {exc}")
            return AudioDetectionResult.silent(
                sample_rate=self._sample_rate,
                chunk_size=self._chunk_size,
            )

        # Convert raw PCM bytes → numpy int16 → float32 for math
        data = np.frombuffer(raw, dtype=np.int16).astype(np.float32)
        if len(data) == 0:
            return AudioDetectionResult.silent(
                sample_rate=self._sample_rate,
                chunk_size=self._chunk_size,
            )

        # RMS amplitude
        rms = float(np.sqrt(np.mean(data ** 2)))

        # Approximate dB SPL (relative to full-scale 16-bit)
        if rms > 0.0:
            db = 20.0 * math.log10(rms / 32768.0)
            db = max(-96.0, db)
        else:
            db = -96.0

        # Classify
        is_speech = rms >= self._rms_threshold

        if rms >= self._spike_threshold:
            alert = AudioAlert.NOISE_SPIKE
        elif is_speech:
            alert = AudioAlert.TALKING
        else:
            alert = AudioAlert.NONE

        return AudioDetectionResult(
            rms_level=round(rms, 1),
            db_level=round(db, 1),
            is_speech=is_speech,
            alert=alert,
            seconds_loud=0.0,   # filled in by AudioViolationTracker
            sample_rate=self._sample_rate,
            chunk_size=self._chunk_size,
        )

    # ------------------------------------------------------------------

    def _get_device_name(self) -> str:
        """Return the name of the active input device (best-effort)."""
        try:
            if self._device_index is not None and self._pa is not None:
                info = self._pa.get_device_info_by_index(self._device_index)
            elif self._pa is not None:
                info = self._pa.get_default_input_device_info()
            else:
                return "Unknown"
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
