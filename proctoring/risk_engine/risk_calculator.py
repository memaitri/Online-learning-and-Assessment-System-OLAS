# risk_engine/risk_calculator.py
# ─────────────────────────────────────────────────────────────────────────────
# Module 7 — Pure risk calculation logic (no side effects, fully testable).
#
# All functions here are stateless — given inputs, they return outputs.
# RiskService owns the state; this module owns the math.
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import datetime
import uuid
from typing import Dict, List, Optional

from risk_engine.risk_config import (
    THRESHOLD_SAFE, THRESHOLD_LOW, THRESHOLD_MEDIUM, THRESHOLD_HIGH,
    WEIGHT_NO_FACE, WEIGHT_MULTIPLE_FACES, WEIGHT_LOOKING_AWAY,
    WEIGHT_HEAD_TURNED_AWAY, WEIGHT_PHONE_DETECTED,
    WEIGHT_CHEAT_SHEET, WEIGHT_BOOK_DETECTED, WEIGHT_CALCULATOR,
    SCORE_DECAY_PER_MINUTE,
)
from risk_engine.risk_models import (
    EventType, RiskLevel,
    RiskEvent, RiskSnapshot, SessionRiskReport,
)


# ─────────────────────────────────────────────────────────────────────────────
# Default weight map — maps EventType → score contribution
# ─────────────────────────────────────────────────────────────────────────────

DEFAULT_WEIGHTS: Dict[EventType, float] = {
    EventType.NO_FACE:          WEIGHT_NO_FACE,
    EventType.MULTIPLE_FACES:   WEIGHT_MULTIPLE_FACES,
    EventType.LOOKING_AWAY:     WEIGHT_LOOKING_AWAY,
    EventType.HEAD_TURNED_AWAY: WEIGHT_HEAD_TURNED_AWAY,
    EventType.PHONE_DETECTED:   WEIGHT_PHONE_DETECTED,
    EventType.CHEAT_SHEET:      WEIGHT_CHEAT_SHEET,
    EventType.BOOK_DETECTED:    WEIGHT_BOOK_DETECTED,
    EventType.CALCULATOR:       WEIGHT_CALCULATOR,
}


# ─────────────────────────────────────────────────────────────────────────────
# Pure functions
# ─────────────────────────────────────────────────────────────────────────────

def score_to_level(score: float) -> RiskLevel:
    """
    Map a numeric score (0–100) to a :class:`RiskLevel`.

    Parameters
    ----------
    score : float  Risk score in [0, 100].

    Returns
    -------
    RiskLevel
    """
    if score <= THRESHOLD_SAFE:
        return RiskLevel.SAFE
    if score <= THRESHOLD_LOW:
        return RiskLevel.LOW
    if score <= THRESHOLD_MEDIUM:
        return RiskLevel.MEDIUM
    if score <= THRESHOLD_HIGH:
        return RiskLevel.HIGH
    return RiskLevel.CRITICAL


def apply_event(
    current_score:  float,
    event_type:     EventType,
    weights:        Dict[EventType, float],
) -> float:
    """
    Apply one violation event to the current score.

    Parameters
    ----------
    current_score : float                   Current cumulative score (0–100).
    event_type    : EventType               The violation that occurred.
    weights       : Dict[EventType, float]  Active weight map.

    Returns
    -------
    float  New score, clamped to [0, 100].
    """
    delta = weights.get(event_type, 0.0)
    return min(100.0, current_score + delta)


def apply_decay(
    current_score: float,
    elapsed_minutes: float,
) -> float:
    """
    Apply time-based score decay (optional; disabled when
    ``SCORE_DECAY_PER_MINUTE == 0``).

    Parameters
    ----------
    current_score    : float  Current score.
    elapsed_minutes  : float  Minutes elapsed since last decay application.

    Returns
    -------
    float  Decayed score, clamped to [0, 100].
    """
    if SCORE_DECAY_PER_MINUTE <= 0.0:
        return current_score
    decay = SCORE_DECAY_PER_MINUTE * elapsed_minutes
    return max(0.0, current_score - decay)


def build_event_record(
    event_type:   EventType,
    score_before: float,
    score_after:  float,
    weights:      Dict[EventType, float],
    duration_s:   float = 0.0,
    metadata:     Optional[Dict[str, object]] = None,
) -> RiskEvent:
    """
    Construct an immutable :class:`RiskEvent` for the timeline.

    Parameters
    ----------
    event_type   : EventType
    score_before : float       Score before the event.
    score_after  : float       Score after the event.
    weights      : dict        Active weight map (used to record the weight).
    duration_s   : float       How long the condition lasted (optional).
    metadata     : dict        Extra context (direction, confidence, …).

    Returns
    -------
    RiskEvent
    """
    return RiskEvent(
        event_type=event_type,
        timestamp=datetime.datetime.now(datetime.timezone.utc),
        weight=weights.get(event_type, 0.0),
        score_before=round(score_before, 2),
        score_after=round(score_after, 2),
        duration_s=round(duration_s, 2),
        metadata=metadata,
    )


def build_snapshot(
    score:           float,
    event_counts:    Dict[str, int],
    last_event:      str,
    started_at:      datetime.datetime,
) -> RiskSnapshot:
    """
    Build the lightweight per-frame :class:`RiskSnapshot`.

    Parameters
    ----------
    score        : float   Current risk score.
    event_counts : dict    Running occurrence counts.
    last_event   : str     Human-readable label for the most recent event.
    started_at   : datetime Session start time.

    Returns
    -------
    RiskSnapshot
    """
    elapsed = (
        datetime.datetime.now(datetime.timezone.utc) - started_at
    ).total_seconds()

    return RiskSnapshot(
        score=round(score, 1),
        level=score_to_level(score),
        event_counts=dict(event_counts),
        last_event=last_event,
        session_seconds=round(elapsed, 1),
    )


def build_session_report(
    session_id:  str,
    started_at:  datetime.datetime,
    final_score: float,
    event_counts:    Dict[str, int],
    event_durations: Dict[str, float],
    events:      list,             # List[RiskEvent]
) -> SessionRiskReport:
    """
    Assemble the final :class:`SessionRiskReport`.

    Called once when the session ends.

    Parameters
    ----------
    session_id       : str
    started_at       : datetime
    final_score      : float
    event_counts     : dict
    event_durations  : dict
    events           : List[RiskEvent]

    Returns
    -------
    SessionRiskReport
    """
    ended_at      = datetime.datetime.now(datetime.timezone.utc)
    duration_s    = (ended_at - started_at).total_seconds()
    final_level   = score_to_level(final_score)
    total_events  = sum(event_counts.values())
    integrity_ok  = final_level in (RiskLevel.SAFE, RiskLevel.LOW, RiskLevel.MEDIUM)

    # Generate a plain-English summary paragraph.
    summary = _generate_summary(
        final_score, final_level, event_counts, duration_s, integrity_ok
    )

    return SessionRiskReport(
        session_id=session_id,
        started_at=started_at,
        ended_at=ended_at,
        duration_s=round(duration_s, 1),
        final_score=round(final_score, 1),
        final_level=final_level,
        event_counts=dict(event_counts),
        event_durations={k: round(v, 1) for k, v in event_durations.items()},
        total_events=total_events,
        events=list(events),
        integrity_passed=integrity_ok,
        summary_text=summary,
    )


def _generate_summary(
    score:        float,
    level:        RiskLevel,
    counts:       Dict[str, int],
    duration_s:   float,
    passed:       bool,
) -> str:
    """
    Generate a short human-readable integrity summary paragraph.

    Used in the session report and as LLM context.
    """
    verdict = "PASSED" if passed else "FLAGGED FOR REVIEW"
    lines   = [
        f"Session integrity: {verdict}. "
        f"Final risk score {score:.1f}/100 ({level.value}). "
        f"Exam duration: {duration_s / 60:.1f} minutes."
    ]

    highlights = []
    if counts.get(EventType.PHONE_DETECTED.value, 0) > 0:
        highlights.append(
            f"Mobile phone detected {counts[EventType.PHONE_DETECTED.value]} time(s)."
        )
    if counts.get(EventType.MULTIPLE_FACES.value, 0) > 0:
        highlights.append(
            f"Multiple faces detected {counts[EventType.MULTIPLE_FACES.value]} time(s)."
        )
    if counts.get(EventType.NO_FACE.value, 0) > 0:
        highlights.append(
            f"Face absent from frame {counts[EventType.NO_FACE.value]} time(s)."
        )
    if counts.get(EventType.LOOKING_AWAY.value, 0) > 0:
        highlights.append(
            f"Sustained gaze avoidance: {counts[EventType.LOOKING_AWAY.value]} episode(s)."
        )
    if counts.get(EventType.HEAD_TURNED_AWAY.value, 0) > 0:
        highlights.append(
            f"Head turned away: {counts[EventType.HEAD_TURNED_AWAY.value]} episode(s)."
        )

    if highlights:
        lines.append("Key findings: " + " ".join(highlights))
    else:
        lines.append("No significant violations detected during this session.")

    return " ".join(lines)
