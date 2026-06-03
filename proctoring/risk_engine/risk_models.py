# risk_engine/risk_models.py
# ─────────────────────────────────────────────────────────────────────────────
# Module 7 — Risk Scoring Engine data models.
#
# Deliberately zero-dependency (no OpenCV, no YOLO, no MediaPipe imports).
# Every model here can be safely imported by:
#   • Analytics Dashboard
#   • LLM Report Generator
#   • REST API layer
#   • Unit tests
# without pulling in any ML stack.
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import dataclasses
import datetime
from enum import Enum
from typing import Dict, List, Optional


# ─────────────────────────────────────────────────────────────────────────────
# EventType — all violation categories the engine understands
# ─────────────────────────────────────────────────────────────────────────────

class EventType(Enum):
    """
    Every violation type the risk engine can process.

    Values are stable string identifiers used in logs, reports, and APIs.
    Add new types here when new detection modules are built — no other
    file needs to change.
    """
    # ── Current modules ───────────────────────────────────────────────────
    NO_FACE          = "NO_FACE"
    MULTIPLE_FACES   = "MULTIPLE_FACES"
    LOOKING_AWAY     = "LOOKING_AWAY"
    HEAD_TURNED_AWAY = "HEAD_TURNED_AWAY"
    PHONE_DETECTED   = "PHONE_DETECTED"

    # ── Future modules (weights pre-configured in risk_config.py) ─────────
    CHEAT_SHEET      = "CHEAT_SHEET"
    BOOK_DETECTED    = "BOOK_DETECTED"
    CALCULATOR       = "CALCULATOR"


# ─────────────────────────────────────────────────────────────────────────────
# RiskLevel — five-tier integrity classification
# ─────────────────────────────────────────────────────────────────────────────

class RiskLevel(Enum):
    """
    Five-tier exam integrity risk level.

    Each level maps to a score range (defined in risk_config.py) and a
    display colour (defined in the main config.py overlay section).
    """
    SAFE     = "SAFE"      # 0 – 20
    LOW      = "LOW"       # 21 – 40
    MEDIUM   = "MEDIUM"    # 41 – 60
    HIGH     = "HIGH"      # 61 – 80
    CRITICAL = "CRITICAL"  # 81 – 100


# ─────────────────────────────────────────────────────────────────────────────
# RiskEvent — a single recorded violation occurrence
# ─────────────────────────────────────────────────────────────────────────────

@dataclasses.dataclass(frozen=True)
class RiskEvent:
    """
    An immutable record of one violation occurrence.

    Stored in the engine's timeline for report generation and analytics.

    Attributes
    ----------
    event_type      : EventType       — What happened.
    timestamp       : datetime        — When it was recorded (UTC wall-clock).
    weight          : float           — Score contribution at time of recording.
    score_before    : float           — Risk score immediately before this event.
    score_after     : float           — Risk score immediately after this event.
    duration_s      : float, optional — How long the condition lasted (where
                                        applicable, e.g. gaze/head timeouts).
    metadata        : dict, optional  — Extra context (direction, confidence…).
                                        Kept as plain strings/floats so it
                                        serialises to JSON without adapters.

    Example — LLM report usage
    ──────────────────────────
    for ev in report.events:
        print(f"{ev.timestamp.isoformat()}  {ev.event_type.value:<20s}  "
              f"+{ev.weight:.0f}pts  → {ev.score_after:.1f}")
    """
    event_type:   EventType
    timestamp:    datetime.datetime
    weight:       float
    score_before: float
    score_after:  float
    duration_s:   float = 0.0
    metadata:     Optional[Dict[str, object]] = None

    @property
    def delta(self) -> float:
        """Score increase caused by this event."""
        return self.score_after - self.score_before


# ─────────────────────────────────────────────────────────────────────────────
# RiskSnapshot — real-time per-frame summary (zero allocation on hot path)
# ─────────────────────────────────────────────────────────────────────────────

@dataclasses.dataclass
class RiskSnapshot:
    """
    A lightweight, mutable summary updated every frame.

    The display layer reads this; the heavy timeline is kept in the service.

    Attributes
    ----------
    score           : float     — Current cumulative risk score (0–100).
    level           : RiskLevel — Current tier.
    event_counts    : dict      — How many times each EventType has fired.
    last_event      : str       — Human-readable description of most recent event.
    session_seconds : float     — Elapsed exam session time.
    """
    score:           float     = 0.0
    level:           RiskLevel = RiskLevel.SAFE
    event_counts:    Dict[str, int] = dataclasses.field(default_factory=dict)
    last_event:      str       = "—"
    session_seconds: float     = 0.0

    @property
    def total_events(self) -> int:
        """Total number of violation events recorded so far."""
        return sum(self.event_counts.values())


# ─────────────────────────────────────────────────────────────────────────────
# SessionRiskReport — generated at session end
# ─────────────────────────────────────────────────────────────────────────────

@dataclasses.dataclass
class SessionRiskReport:
    """
    Complete post-session integrity assessment.

    Generated once when the session ends.  Designed to be:
    • Written to a plain-text file by RiskService.
    • Consumed by an LLM report generator.
    • Serialised to JSON for a REST API.
    • Displayed in an analytics dashboard.

    Attributes
    ----------
    session_id       : str            — Unique session identifier.
    started_at       : datetime       — Session start time (UTC).
    ended_at         : datetime       — Session end time (UTC).
    duration_s       : float          — Total session length in seconds.
    final_score      : float          — Final cumulative risk score (0–100).
    final_level      : RiskLevel      — Final tier.
    event_counts     : dict           — Per-EventType occurrence counts.
    event_durations  : dict           — Per-EventType total duration in seconds.
    total_events     : int            — Sum of all event counts.
    events           : List[RiskEvent]— Full ordered timeline.
    integrity_passed : bool           — True when final_level ≤ MEDIUM.
    summary_text     : str            — Human-readable paragraph (for reports).
    """
    session_id:       str
    started_at:       datetime.datetime
    ended_at:         datetime.datetime
    duration_s:       float
    final_score:      float
    final_level:      RiskLevel
    event_counts:     Dict[str, int]
    event_durations:  Dict[str, float]
    total_events:     int
    events:           List[RiskEvent]
    integrity_passed: bool
    summary_text:     str = ""

    def to_plain_text(self) -> str:
        """
        Render the report as a human-readable plain-text document.

        Suitable for writing to ``session_report.txt`` or feeding into
        an LLM prompt as structured context.
        """
        sep = "─" * 60
        lines = [
            sep,
            "  OLAS Exam Integrity Report",
            sep,
            f"  Session ID    : {self.session_id}",
            f"  Started       : {self.started_at.strftime('%Y-%m-%d %H:%M:%S')}",
            f"  Ended         : {self.ended_at.strftime('%Y-%m-%d %H:%M:%S')}",
            f"  Duration      : {self.duration_s:.1f}s  "
            f"({self.duration_s / 60:.1f} min)",
            sep,
            f"  Final Score   : {self.final_score:.1f} / 100",
            f"  Risk Level    : {self.final_level.value}",
            f"  Passed        : {'YES' if self.integrity_passed else 'NO — REVIEW REQUIRED'}",
            sep,
            "  Violation Summary",
            sep,
        ]

        for ev_name, count in sorted(self.event_counts.items()):
            dur = self.event_durations.get(ev_name, 0.0)
            lines.append(
                f"  {ev_name:<22s}  count={count:<4d}  total_duration={dur:.1f}s"
            )

        lines += [
            sep,
            "  Event Timeline",
            sep,
        ]
        for ev in self.events:
            meta = ""
            if ev.metadata:
                meta = "  " + "  ".join(
                    f"{k}={v}" for k, v in ev.metadata.items()
                )
            lines.append(
                f"  {ev.timestamp.strftime('%H:%M:%S')}  "
                f"{ev.event_type.value:<22s}  "
                f"+{ev.weight:.0f}pts → {ev.score_after:.1f}"
                f"{meta}"
            )

        if self.summary_text:
            lines += [sep, "  Summary", sep, f"  {self.summary_text}"]

        lines.append(sep)
        return "\n".join(lines)
