# audio_detection/__init__.py
# ─────────────────────────────────────────────────────────────────────────────
# Audio Proctoring sub-package.
#
# Public surface:
#   from audio_detection import AudioDetectionResult, AudioService
# ─────────────────────────────────────────────────────────────────────────────

from audio_detection.audio_models  import AudioDetectionResult
from audio_detection.audio_service import AudioService

__all__ = [
    "AudioDetectionResult",
    "AudioService",
]
