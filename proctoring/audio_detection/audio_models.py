# audio_detection/audio_models.py
# ─────────────────────────────────────────────────────────────────────────────
# Data models for the audio proctoring module.
#
# Zero-dependency (no PyAudio, no numpy) so these models can be imported
# by the risk engine, REST API layer, and unit tests without pulling in
# the audio capture stack.
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import dataclasses
from enum import Enum


# ─────────────────────────────────────────────────────────────────────────────
# AudioAlert — category of audio event that raised a proctoring alert
# ─────────────────────────────────────────────────────────────────────────────

class AudioAlert(Enum):
    """
    Category of audio event that raised a proctoring alert.

    NONE        — No alert; audio is within acceptable limits.
    TALKING     — Sustained speech detected above the configured RMS threshold
                  for longer than AUDIO_SPEECH_TIMEOUT seconds.
    NOISE_SPIKE — A sudden loud burst (single chunk spike) above
                  AUDIO_SPIKE_THRESHOLD was detected.
    """
    NONE        = "NONE"
    TALKING     = "TALKING"
    NOISE_SPIKE = "NOISE_SPIKE"


# ─────────────────────────────────────────────────────────────────────────────
# AudioDetectionResult — complete output of one AudioDetector analysis window
# ─────────────────────────────────────────────────────────────────────────────

@dataclasses.dataclass
class AudioDetectionResult:
    """
    Complete output of one AudioDetector analysis window.

    Attributes
    ----------
    rms_level       : float       Root-mean-square amplitude in the window
                                  (0.0 – ~32 000 for 16-bit PCM; normalised
                                  to 0.0–1.0 when ``normalise=True``).
    db_level        : float       Approximate dB SPL relative to full-scale
                                  (negative; 0 dB = max amplitude).
    is_speech       : bool        True when RMS exceeds AUDIO_RMS_THRESHOLD.
    alert           : AudioAlert  Type of violation detected (NONE if clean).
    seconds_loud    : float       How long audio has been above threshold in
                                  the current continuous episode (seconds).
    sample_rate     : int         Sample rate used for this window (Hz).
    chunk_size      : int         PCM frames per analysis chunk.

    Example — downstream usage
    ───────────────────────────
    if result.alert != AudioAlert.NONE:
        risk_engine.record_event(EventType.AUDIO_VIOLATION, ...)
    """
    rms_level:   float     = 0.0
    db_level:    float     = -96.0
    is_speech:   bool      = False
    alert:       AudioAlert = AudioAlert.NONE
    seconds_loud: float    = 0.0
    sample_rate: int       = 16000
    chunk_size:  int       = 1024

    @classmethod
    def silent(cls, sample_rate: int = 16000, chunk_size: int = 1024) -> "AudioDetectionResult":
        """Construct a result representing a silent / clean audio window."""
        return cls(
            rms_level=0.0,
            db_level=-96.0,
            is_speech=False,
            alert=AudioAlert.NONE,
            seconds_loud=0.0,
            sample_rate=sample_rate,
            chunk_size=chunk_size,
        )
