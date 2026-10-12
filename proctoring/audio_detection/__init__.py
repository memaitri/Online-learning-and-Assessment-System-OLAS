# audio_detection/__init__.py
# ─────────────────────────────────────────────────────────────────────────────
# Audio Detection sub-package — public surface
#
# Usage in main.py (and analytics modules):
#
#   from audio_detection import AudioDetectionResult, AudioService
# ─────────────────────────────────────────────────────────────────────────────

from audio_detection.audio_models  import AudioDetectionResult
from audio_detection.audio_service import AudioService

__all__ = [
    "AudioDetectionResult",
    "AudioService",
]
