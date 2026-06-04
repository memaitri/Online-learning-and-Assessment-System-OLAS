# proctoring/frame_server.py
# ─────────────────────────────────────────────────────────────────────────────
# Headless frame-server entry point.
#
# Instead of opening a webcam and an OpenCV window, this script:
#   1. Reads base64-encoded JPEG frames from stdin, one per line.
#   2. Decodes each frame into a numpy BGR array.
#   3. Runs the FULL existing detection pipeline (unchanged):
#        Face Detection → Face Mesh → Gaze → Head Pose → Phone → Risk Engine
#   4. Writes the live JSON snapshot to session_output.json every 2 s.
#   5. After each frame, prints one JSON line to stdout so Node can read it.
#   6. On receiving "STOP\n" on stdin (or EOF), runs the final report and exits.
#
# No cv2.imshow(), no cv2.waitKey(), no webcam, no OpenCV window.
# All detection modules are imported and used exactly as in main.py.
#
# Usage (Node spawns this):
#   python frame_server.py --session-id <id> --output-file <path>
#
# Node writes to stdin:
#   <base64-jpeg>\n      → process one frame, print JSON result
#   STOP\n               → graceful shutdown
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import threading
import time
from typing import Optional

import cv2
import numpy as np

# ── Detection modules (all unchanged from main.py) ───────────────────────────
from face_detector      import FaceDetector,    FaceDetectorError
from face_mesh_detector import FaceMeshDetector, FaceMeshDetectorError
from gaze_tracker       import GazeTracker,     GazeResult,   GazeDirection
from head_pose_estimator import HeadPoseEstimator, HeadPoseResult, HeadDirection
from phone_detection    import PhoneService
from phone_detection.phone_detector import PhoneDetectorError
from risk_engine        import RiskService,     EventType
from fps_counter        import FPSCounter
from violation_tracker  import ViolationTracker, ProctoringStatus
from logs               import ViolationLogger
import config


# ─────────────────────────────────────────────────────────────────────────────
# Violation handler factories (identical to main.py)
# ─────────────────────────────────────────────────────────────────────────────

def _make_violation_handler(logger: ViolationLogger, risk: RiskService):
    def handle(status: ProctoringStatus, face_count: int) -> None:
        logger.log(status, face_count)
        event_type = (EventType.NO_FACE if status == ProctoringStatus.NO_FACE
                      else EventType.MULTIPLE_FACES)
        risk.record_event(event_type, metadata={"faces": face_count})
        print(f"[FS] Violation {status.name} faces={face_count}", file=sys.stderr)
    return handle

def _make_gaze_violation_handler(logger: ViolationLogger, risk: RiskService):
    def handle(direction: GazeDirection, duration_s: float) -> None:
        logger.log_gaze_violation(direction.value, duration_s)
        risk.record_event(EventType.LOOKING_AWAY, duration_s=duration_s,
                          metadata={"direction": direction.value})
        print(f"[FS] GazeViolation {direction.value} {duration_s:.1f}s", file=sys.stderr)
    return handle

def _make_head_violation_handler(logger: ViolationLogger, risk: RiskService):
    def handle(direction: HeadDirection, yaw: float, pitch: float,
               roll: float, duration_s: float) -> None:
        logger.log_head_violation(direction.value, yaw, pitch, roll, duration_s)
        risk.record_event(EventType.HEAD_TURNED_AWAY, duration_s=duration_s,
                          metadata={"direction": direction.value,
                                    "yaw": round(yaw, 1), "pitch": round(pitch, 1)})
        print(f"[FS] HeadViolation {direction.value} yaw={yaw:+.1f}", file=sys.stderr)
    return handle

def _make_phone_violation_handler(logger: ViolationLogger, risk: RiskService):
    def handle(phone_count: int, confidence: float) -> None:
        logger.log_phone_violation(phone_count, confidence)
        risk.record_event(EventType.PHONE_DETECTED,
                          metadata={"count": phone_count,
                                    "confidence": round(confidence, 3)})
        print(f"[FS] PhoneViolation count={phone_count} conf={confidence:.3f}",
              file=sys.stderr)
    return handle


# ─────────────────────────────────────────────────────────────────────────────
# decode_frame: base64 JPEG string → BGR numpy array
# ─────────────────────────────────────────────────────────────────────────────

def decode_frame(b64_str: str) -> Optional[np.ndarray]:
    """Decode a base64-encoded JPEG string into a BGR numpy array."""
    try:
        # Strip the data-URL prefix if present ("data:image/jpeg;base64,...")
        if ',' in b64_str:
            b64_str = b64_str.split(',', 1)[1]
        raw    = base64.b64decode(b64_str)
        arr    = np.frombuffer(raw, dtype=np.uint8)
        frame  = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        return frame
    except Exception as exc:
        print(f"[FS] decode_frame error: {exc}", file=sys.stderr)
        return None


# ─────────────────────────────────────────────────────────────────────────────
# FrameServer — main class
# ─────────────────────────────────────────────────────────────────────────────

class FrameServer:
    """
    Headless proctoring engine driven by frames received on stdin.

    Flow per frame:
        1. Receive base64 JPEG on stdin
        2. Decode → numpy BGR array
        3. Run full detection pipeline (identical to main.py loop body)
        4. Update risk snapshot
        5. Write one JSON result line to stdout
    """

    def __init__(
        self,
        db_session_id: Optional[str],
        output_file:   str,
    ) -> None:
        self.db_session_id = db_session_id
        self.output_file   = output_file
        self.frame_index   = 0
        self._stop_event   = threading.Event()
        self._fps          = FPSCounter(window=30)

    # ------------------------------------------------------------------

    def run(self) -> None:
        """
        Main execution: initialise all detectors, then read frames from stdin
        until "STOP" or EOF.
        """
        print("[FS] Frame server starting...", file=sys.stderr)

        with ViolationLogger() as logger:
            risk_service   = RiskService(session_id=self.db_session_id)
            risk_service.start()

            tracker        = ViolationTracker(
                on_violation=_make_violation_handler(logger, risk_service))
            gaze_tracker   = GazeTracker(
                on_violation=_make_gaze_violation_handler(logger, risk_service))
            head_estimator = HeadPoseEstimator(
                on_violation=_make_head_violation_handler(logger, risk_service))
            phone_service  = PhoneService(
                on_violation=_make_phone_violation_handler(logger, risk_service),
                # Headless mode: browser sends ~1 frame/2s, so run YOLO on every frame.
                frame_skip=config.PHONE_FRAME_SKIP_HEADLESS,
            )

            # Background JSON writer (same as main.py)
            self._start_json_writer(risk_service)

            try:
                phone_service.start()

                with FaceMeshDetector() as mesh_detector:
                    with FaceDetector() as detector:
                        print("[FS] All detectors ready. Waiting for frames...",
                              file=sys.stderr)
                        # Flush so Node knows Python is ready
                        sys.stdout.flush()

                        self._read_loop(
                            detector, mesh_detector,
                            gaze_tracker, head_estimator,
                            phone_service, tracker,
                            risk_service,
                        )

            except (FaceDetectorError, FaceMeshDetectorError, PhoneDetectorError) as exc:
                print(f"[FS] Detector error: {exc}", file=sys.stderr)
            except Exception as exc:
                print(f"[FS] Unexpected error: {exc}", file=sys.stderr)
            finally:
                self._stop_event.set()
                phone_service.stop()
                report = risk_service.end_session()
                risk_service.stop()
                self._write_final_output(report)
                print("[FS] Frame server stopped.", file=sys.stderr)

    # ------------------------------------------------------------------

    def _read_loop(
        self,
        detector,
        mesh_detector,
        gaze_tracker,
        head_estimator,
        phone_service,
        tracker,
        risk_service,
    ) -> None:
        """Read base64 frames from stdin and run the detection pipeline."""
        for raw_line in sys.stdin:
            line = raw_line.strip()

            if not line:
                continue

            if line.upper() == "STOP":
                print("[FS] Received STOP signal.", file=sys.stderr)
                break

            # ── Browser-side violation injection ───────────────────────
            # Node sends "VIOLATION:<json>" when a keyboard/fullscreen
            # violation fires in the browser, so RiskService gets it too.
            if line.startswith("VIOLATION:"):
                try:
                    payload    = json.loads(line[len("VIOLATION:"):])
                    event_str  = payload.get("eventType", "LOOKING_AWAY")
                    event_type = EventType(event_str)
                    meta       = payload.get("metadata", {})
                    risk_service.record_event(event_type, metadata=meta)
                    print(f"[FS] BrowserViolation recorded: {event_str}", file=sys.stderr)
                except Exception as exc:
                    print(f"[FS] Could not parse VIOLATION message: {exc}", file=sys.stderr)
                # Emit updated snapshot
                snap   = risk_service.snapshot
                counts = snap.event_counts
                self._emit_result({
                    "frameIndex":      self.frame_index,
                    "riskScore":       round(snap.score, 1),
                    "riskLevel":       snap.level.value,
                    "totalViolations": snap.total_events,
                    "phoneDetections": counts.get("PHONE_DETECTED", 0),
                    "multipleFaces":   counts.get("MULTIPLE_FACES", 0),
                    "noFace":          counts.get("NO_FACE", 0),
                    "lookingAway":     counts.get("LOOKING_AWAY", 0),
                    "headTurns":       counts.get("HEAD_TURNED_AWAY", 0),
                    "sessionSeconds":  round(snap.session_seconds, 1),
                    "lastEvent":       snap.last_event,
                    "status":          "running",
                })
                continue

            # ── Decode frame ───────────────────────────────────────────
            frame = decode_frame(line)
            if frame is None:
                self._emit_result({"error": "decode_failed"})
                continue

            frame_h, frame_w = frame.shape[:2]
            self.frame_index += 1
            self._fps.tick()

            if self.frame_index == 1:
                print(f"[FS] First frame received: {frame_w}×{frame_h}", file=sys.stderr)

            # ── Detection pipeline (identical to main.py loop body) ────
            detection_result = detector.detect(frame)
            mesh_result      = mesh_detector.detect(frame)

            gaze_results = []
            for face in mesh_result.faces:
                g = gaze_tracker.analyse(face)
                gaze_tracker.violation_tracker.update(g.direction)
                gaze_results.append(g)

            pose_results = []
            for face in mesh_result.faces:
                p = head_estimator.estimate(face, frame_w, frame_h)
                head_estimator.violation_tracker.update(p)
                pose_results.append(p)

            phone_result = phone_service.submit(frame, self.frame_index)
            phone_service.violation_tracker.update(phone_result)

            status = tracker.update(detection_result.face_count)

            # ── Build per-frame result JSON ────────────────────────────
            snap   = risk_service.snapshot
            counts = snap.event_counts

            result = {
                "frameIndex":    self.frame_index,
                "fps":           round(self._fps.fps, 1),
                "faceCount":     detection_result.face_count,
                "faceStatus":    status.name,
                "riskScore":     round(snap.score, 1),
                "riskLevel":     snap.level.value,
                "totalViolations": snap.total_events,
                "phoneDetections": counts.get("PHONE_DETECTED", 0),
                "multipleFaces":   counts.get("MULTIPLE_FACES", 0),
                "noFace":          counts.get("NO_FACE", 0),
                "lookingAway":     counts.get("LOOKING_AWAY", 0),
                "headTurns":       counts.get("HEAD_TURNED_AWAY", 0),
                "gazeDirection":  gaze_results[0].direction.value if gaze_results else "UNKNOWN",
                "headDirection":  pose_results[0].direction.value if pose_results else "UNKNOWN",
                "sessionSeconds": round(snap.session_seconds, 1),
                "lastEvent":      snap.last_event,
                "status":         "running",
            }
            if self.frame_index % 5 == 0:
                print(f"[FS] Frame {self.frame_index}: faces={detection_result.face_count} risk={round(snap.score,1)} level={snap.level.value}", file=sys.stderr)
            self._emit_result(result)

    # ------------------------------------------------------------------

    def _emit_result(self, result: dict) -> None:
        """Write one JSON line to stdout (Node reads this)."""
        try:
            print(json.dumps(result), flush=True)
        except Exception:
            pass

    def _start_json_writer(self, risk_service: RiskService) -> None:
        """Write session_output.json every 2 s (background thread)."""
        db_sid       = self.db_session_id
        output_file  = self.output_file
        stop_event   = self._stop_event

        def _write() -> None:
            while not stop_event.is_set():
                try:
                    snap   = risk_service.snapshot
                    counts = snap.event_counts
                    payload = {
                        "sessionId":       db_sid or risk_service.session_id,
                        "riskScore":       round(snap.score, 1),
                        "riskLevel":       snap.level.value,
                        "totalViolations": snap.total_events,
                        "phoneDetections": counts.get("PHONE_DETECTED", 0),
                        "multipleFaces":   counts.get("MULTIPLE_FACES", 0),
                        "noFace":          counts.get("NO_FACE", 0),
                        "lookingAway":     counts.get("LOOKING_AWAY", 0),
                        "headTurns":       counts.get("HEAD_TURNED_AWAY", 0),
                        "sessionSeconds":  round(snap.session_seconds, 1),
                        "lastEvent":       snap.last_event,
                        "status":          "running",
                    }
                    with open(output_file, "w", encoding="utf-8") as fh:
                        json.dump(payload, fh)
                except Exception:
                    pass
                stop_event.wait(timeout=2.0)

        t = threading.Thread(target=_write, daemon=True)
        t.start()

    def _write_final_output(self, report) -> None:
        """Write the final completed payload to session_output.json."""
        try:
            counts = report.event_counts
            payload = {
                "sessionId":       self.db_session_id,
                "riskScore":       round(report.final_score, 1),
                "riskLevel":       report.final_level.value,
                "totalViolations": report.total_events,
                "phoneDetections": counts.get("PHONE_DETECTED", 0),
                "multipleFaces":   counts.get("MULTIPLE_FACES", 0),
                "noFace":          counts.get("NO_FACE", 0),
                "lookingAway":     counts.get("LOOKING_AWAY", 0),
                "headTurns":       counts.get("HEAD_TURNED_AWAY", 0),
                "sessionSeconds":  round(report.duration_s, 1),
                "lastEvent":       "Session ended",
                "status":          "completed",
                "integrityPassed": report.integrity_passed,
                "reportPath":      os.path.join(config.LOG_DIR, "session_report.txt"),
            }
            with open(self.output_file, "w", encoding="utf-8") as fh:
                json.dump(payload, fh)

            # Also emit final result on stdout so Node gets it
            self._emit_result({**payload, "frameIndex": self.frame_index})
            print(f"[FS] Final output written -> {self.output_file}", file=sys.stderr)
        except Exception as exc:
            print(f"[FS] Warning: could not write final output: {exc}", file=sys.stderr)


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    # Force UTF-8 output on Windows so Unicode characters in log messages
    # don't crash with UnicodeEncodeError on cp1252 consoles.
    if sys.platform == "win32":
        import io
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

    parser = argparse.ArgumentParser(description="OLAS Headless Frame Server")
    parser.add_argument("--session-id",  type=str, default=None)
    parser.add_argument(
        "--output-file", type=str,
        default=os.path.join(os.path.dirname(__file__), "session_output.json"),
    )
    args = parser.parse_args()

    # On Windows, stdin must be set to binary mode to avoid CR/LF mangling
    # of the base64 payload.  msvcrt.setmode uses the Windows _setmode value
    # for binary (0x8000), not os.O_BINARY which is not always defined.
    if sys.platform == "win32":
        import msvcrt
        msvcrt.setmode(sys.stdin.fileno(), 0x8000)   # 0x8000 == _O_BINARY
        sys.stdin = open(sys.stdin.fileno(), 'r', encoding='utf-8', newline='')

    server = FrameServer(
        db_session_id=args.session_id,
        output_file=args.output_file,
    )
    server.run()
