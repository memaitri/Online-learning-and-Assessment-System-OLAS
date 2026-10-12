# risk_engine/risk_service.py
# ─────────────────────────────────────────────────────────────────────────────
# Module 7 — RiskService: session lifecycle, score accumulation, logging.
#
# Responsibilities
# ────────────────
# • Own the running risk score and full event timeline.
# • Accept violation events from main.py via record_event().
# • Maintain a RiskSnapshot that the display layer can read every frame.
# • Write a structured risk_log.txt on every event.
# • Generate a SessionRiskReport when the session ends.
# • Write session_report.txt to the logs directory.
#
# main.py contract
# ────────────────
#   service = RiskService()
#   service.start()
#
#   # In each violation callback:
#   service.record_event(EventType.PHONE_DETECTED, metadata={…})
#
#   # In the display loop:
#   snapshot = service.snapshot     # zero-allocation read
#
#   # On exit:
#   report = service.end_session()
#   service.stop()
#
# Nothing else from this package should ever be called from main.py.
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import datetime
import logging
import os
import threading
import uuid
from typing import Dict, List, Optional

import config
from risk_engine.risk_config   import (
    RISK_LOG_FILENAME, REPORT_FILENAME,
)
from risk_engine.risk_calculator import DEFAULT_WEIGHTS as _DEFAULT_WEIGHTS
from risk_engine.risk_models   import (
    EventType, RiskLevel,
    RiskEvent, RiskSnapshot, SessionRiskReport,
)
from risk_engine.risk_calculator import (
    DEFAULT_WEIGHTS as _DEFAULT_WEIGHTS,
    apply_event, apply_decay, build_event_record,
    build_snapshot, build_session_report, score_to_level,
)


class RiskService:
    """
    Stateful risk scoring engine for one exam session.

    Thread safety
    ─────────────
    :meth:`record_event` acquires a lock so it is safe to call from
    multiple violation callbacks that may fire from different threads in
    future async architectures.  :attr:`snapshot` is read without a lock
    (eventual consistency is fine for the display layer).

    Parameters
    ----------
    session_id : str, optional
        Unique identifier for this session.  Auto-generated if omitted.
    weights : dict, optional
        Custom ``{EventType: float}`` map.  Falls back to DEFAULT_WEIGHTS
        for any event type not present.  Pass a superset to add new
        detectors without changing this class.
    log_dir : str, optional
        Directory for risk_log.txt and session_report.txt.
        Defaults to :data:`config.LOG_DIR`.
    """

    def __init__(
        self,
        session_id: Optional[str] = None,
        weights:    Optional[Dict[EventType, float]] = None,
        log_dir:    str = config.LOG_DIR,
    ) -> None:
        self._session_id  = session_id or str(uuid.uuid4())[:8].upper()
        self._weights     = dict(_DEFAULT_WEIGHTS)
        if weights:
            self._weights.update(weights)          # caller overrides take precedence
        self._log_dir     = log_dir

        # ── Mutable session state (protected by _lock) ─────────────────────
        self._lock:          threading.Lock      = threading.Lock()
        self._score:         float               = 0.0
        self._events:        List[RiskEvent]     = []
        self._event_counts:  Dict[str, int]      = {}
        self._event_durations: Dict[str, float]  = {}
        self._last_event_label: str              = "—"
        self._started_at:    Optional[datetime.datetime] = None

        # ── Public snapshot (display layer reads this; never None after start) ─
        self._snapshot: RiskSnapshot = RiskSnapshot()

        # ── File logger ────────────────────────────────────────────────────
        self._risk_logger: Optional[logging.Logger] = None

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self) -> None:
        """
        Begin a new session: reset all counters and open the risk log file.

        Must be called before any :meth:`record_event` calls.
        """
        self._started_at = datetime.datetime.now(datetime.timezone.utc)
        self._score      = 0.0
        self._events.clear()
        self._event_counts.clear()
        self._event_durations.clear()
        self._last_event_label = "—"
        self._snapshot = RiskSnapshot()

        os.makedirs(self._log_dir, exist_ok=True)
        self._risk_logger = self._setup_logger()

        self._risk_logger.info(
            f"SESSION_START  id={self._session_id}  "
            f"started_at={self._started_at.isoformat()}"
        )
        print(
            f"[RiskService] Session {self._session_id} started.  "
            f"Log → {os.path.join(self._log_dir, RISK_LOG_FILENAME)}"
        )

    def stop(self) -> None:
        """Flush and close the risk log file handle."""
        if self._risk_logger:
            for handler in list(self._risk_logger.handlers):
                handler.flush()
                handler.close()
                self._risk_logger.removeHandler(handler)
        print(f"[RiskService] Session {self._session_id} stopped.")

    # ------------------------------------------------------------------
    # Core API — called from violation callbacks in main.py
    # ------------------------------------------------------------------

    def record_event(
        self,
        event_type: EventType,
        duration_s: float = 0.0,
        metadata:   Optional[Dict[str, object]] = None,
    ) -> RiskSnapshot:
        """
        Record one violation event, update the score, and return a snapshot.

        This is the **only** method main.py needs to call on the risk engine.

        Parameters
        ----------
        event_type : EventType    Which violation occurred.
        duration_s : float        How long the condition lasted (optional).
        metadata   : dict         Extra context — e.g. ``{"direction": "LEFT"}``.

        Returns
        -------
        RiskSnapshot  Updated snapshot (same object available via .snapshot).
        """
        with self._lock:
            score_before = self._score
            self._score  = apply_event(self._score, event_type, self._weights)
            score_after  = self._score

            # Build and store immutable event record.
            event = build_event_record(
                event_type=event_type,
                score_before=score_before,
                score_after=score_after,
                weights=self._weights,
                duration_s=duration_s,
                metadata=metadata,
            )
            self._events.append(event)

            # Update running counters.
            key = event_type.value
            self._event_counts[key]     = self._event_counts.get(key, 0) + 1
            self._event_durations[key]  = (
                self._event_durations.get(key, 0.0) + duration_s
            )
            self._last_event_label = (
                f"{event_type.value} (+{event.weight:.0f})"
            )

            # Write to risk log.
            self._log_event(event)

            # Rebuild snapshot.
            self._snapshot = build_snapshot(
                score=self._score,
                event_counts=self._event_counts,
                last_event=self._last_event_label,
                started_at=self._started_at or datetime.datetime.now(datetime.timezone.utc),
            )

        return self._snapshot

    # ------------------------------------------------------------------
    # Session-end report
    # ------------------------------------------------------------------

    def end_session(self) -> SessionRiskReport:
        """
        Finalise the session: build the report and write it to disk.

        Safe to call multiple times — subsequent calls regenerate the report
        with the current state.

        Returns
        -------
        SessionRiskReport
        """
        with self._lock:
            started_at = self._started_at or datetime.datetime.now(
                datetime.timezone.utc
            )
            report = build_session_report(
                session_id=self._session_id,
                started_at=started_at,
                final_score=self._score,
                event_counts=dict(self._event_counts),
                event_durations=dict(self._event_durations),
                events=list(self._events),
            )

        # Write plain-text report.
        report_path = os.path.join(self._log_dir, REPORT_FILENAME)
        try:
            with open(report_path, "w", encoding="utf-8") as fh:
                fh.write(report.to_plain_text())
            print(f"[RiskService] Session report → {report_path}")
        except OSError as exc:
            print(f"[RiskService] Warning: could not write report: {exc}")

        if self._risk_logger:
            self._risk_logger.info(
                f"SESSION_END  id={self._session_id}  "
                f"score={report.final_score:.1f}  "
                f"level={report.final_level.value}  "
                f"events={report.total_events}  "
                f"passed={report.integrity_passed}"
            )

        return report

    # ------------------------------------------------------------------
    # Properties — display layer reads these
    # ------------------------------------------------------------------

    @property
    def snapshot(self) -> RiskSnapshot:
        """Latest :class:`RiskSnapshot` — updated on every recorded event."""
        return self._snapshot

    @property
    def score(self) -> float:
        """Current cumulative risk score (0–100)."""
        return self._score

    @property
    def level(self) -> RiskLevel:
        """Current :class:`RiskLevel`."""
        return score_to_level(self._score)

    @property
    def session_id(self) -> str:
        """Unique session identifier."""
        return self._session_id

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _setup_logger(self) -> logging.Logger:
        """Configure a named logger writing to risk_log.txt."""
        logger = logging.getLogger(f"olas.risk.{self._session_id}")
        logger.setLevel(logging.DEBUG)
        if not logger.handlers:
            path = os.path.join(self._log_dir, RISK_LOG_FILENAME)
            fh   = logging.FileHandler(path, encoding="utf-8")
            fh.setLevel(logging.DEBUG)
            fh.setFormatter(
                logging.Formatter(
                    fmt="[%(asctime)s]  %(message)s",
                    datefmt="%Y-%m-%d %H:%M:%S",
                )
            )
            logger.addHandler(fh)
        return logger

    def _log_event(self, event: RiskEvent) -> None:
        """Write one structured line to risk_log.txt."""
        if self._risk_logger is None:
            return
        meta_str = ""
        if event.metadata:
            meta_str = "  " + "  ".join(
                f"{k}={v}" for k, v in event.metadata.items()
            )
        self._risk_logger.info(
            f"EVENT  "
            f"{event.event_type.value:<22s}  "
            f"weight={event.weight:>5.1f}  "
            f"score_before={event.score_before:>6.1f}  "
            f"score_after={event.score_after:>6.1f}"
            f"{meta_str}"
        )
