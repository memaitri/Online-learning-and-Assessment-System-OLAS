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

# ─────────────────────────────────────────────────────────────────────────────
# Dependency check — runs before any detector is initialised.
# Exits with a clear message if the environment is broken.
# ─────────────────────────────────────────────────────────────────────────────

def ensure_models() -> None:
    """
    Check that every model file required by config.py exists in the
    proctoring directory.  Any missing file is downloaded automatically
    from the official Google MediaPipe CDN before any detector starts.
    """
    import urllib.request

    # Map config attribute → (filename, official download URL)
    MODELS = [
        (
            config.FACE_DETECTION_MODEL,
            "https://storage.googleapis.com/mediapipe-models/"
            "face_detector/blaze_face_short_range/float16/1/"
            "blaze_face_short_range.tflite",
        ),
        (
            config.FACE_MESH_MODEL,
            "https://storage.googleapis.com/mediapipe-models/"
            "face_landmarker/face_landmarker/float16/1/"
            "face_landmarker.task",
        ),
        # YOLO is downloaded automatically by ultralytics on first use,
        # but we list it here so the log confirms its presence.
        (
            config.PHONE_MODEL_PATH,
            None,   # ultralytics handles this itself
        ),
    ]

    all_ok = True
    for model_path, url in MODELS:
        if os.path.isfile(model_path):
            size = os.path.getsize(model_path)
            print(f"[FS:MODEL] Found    {model_path} ({size:,} bytes)", file=sys.stderr, flush=True)
            continue

        if url is None:
            # Let ultralytics download it during PhoneService.start()
            print(f"[FS:MODEL] {model_path} not found — ultralytics will auto-download", file=sys.stderr, flush=True)
            continue

        print(f"[FS:MODEL] Missing  {model_path} — downloading from official source…", file=sys.stderr, flush=True)
        try:
            def _progress(block: int, block_size: int, total: int) -> None:
                if total > 0:
                    pct = min(100, block * block_size * 100 // total)
                    print(f"[FS:MODEL] {model_path}  {pct}%", end="\r", file=sys.stderr, flush=True)

            urllib.request.urlretrieve(url, model_path, reporthook=_progress)
            size = os.path.getsize(model_path)
            print(f"\n[FS:MODEL] Downloaded {model_path} ({size:,} bytes) OK", file=sys.stderr, flush=True)
        except Exception as exc:
            print(f"\n[FS:MODEL] FAILED to download {model_path}: {exc}", file=sys.stderr, flush=True)
            all_ok = False

    if not all_ok:
        print("[FS:MODEL] One or more models could not be downloaded — exiting.", file=sys.stderr, flush=True)
        sys.exit(1)


def verify_dependencies() -> None:
    """
    Verify that all required packages are importable and at compatible versions.
    Prints a summary and exits with code 1 on any failure so the Node process
    sees a non-zero exit code and logs a clear error instead of hanging.
    """
    import importlib, platform

    checks = [
        ("mediapipe",  "0.10.30", None),   # min 0.10.30 for Python 3.13 wheels
        ("cv2",        "4.9.0",   None),
        ("numpy",      "1.26.0",  None),
        ("ultralytics","8.0.0",   None),
    ]

    print(f"[FS:ENV] Python  {sys.version.split()[0]}  ({platform.system()} {platform.machine()})",
          file=sys.stderr, flush=True)

    failed = False
    for pkg, min_ver, _ in checks:
        try:
            mod = importlib.import_module(pkg)
            ver = getattr(mod, "__version__", "unknown")
            print(f"[FS:ENV] {pkg:<20s} {ver}", file=sys.stderr, flush=True)
        except ImportError as exc:
            print(f"[FS:ENV] MISSING  {pkg:<20s} — {exc}", file=sys.stderr, flush=True)
            failed = True

    # Verify the specific MediaPipe Tasks API used by the detectors
    try:
        import mediapipe as mp
        _ = mp.tasks.vision.FaceDetector
        _ = mp.tasks.vision.FaceLandmarker
        print("[FS:ENV] mediapipe.tasks.vision  OK", file=sys.stderr, flush=True)
    except Exception as exc:
        print(f"[FS:ENV] BROKEN   mediapipe.tasks.vision — {exc}", file=sys.stderr, flush=True)
        print("[FS:ENV] FIX: pip uninstall tensorflow -y  &&  pip install mediapipe==0.10.35",
              file=sys.stderr, flush=True)
        failed = True

    if failed:
        print("[FS:ENV] Dependency check FAILED — exiting. Fix the errors above and restart.",
              file=sys.stderr, flush=True)
        sys.exit(1)

    print("[FS:ENV] All dependencies OK.", file=sys.stderr, flush=True)


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
        print("[FS:DIAG] Frame server run() called. session_id=" + str(self.db_session_id), file=sys.stderr, flush=True)
        print("[FS] Frame server starting...", file=sys.stderr, flush=True)
        ensure_models()
        verify_dependencies()

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
                              file=sys.stderr, flush=True)
                        # Flush stdout so any buffered startup output reaches Node
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
        print("[FS:DIAG] _read_loop started — waiting for stdin lines", file=sys.stderr, flush=True)
        line_count = 0
        # Use readline() in a while-loop instead of iterating sys.stdin.
        # The file iterator uses internal read-ahead buffering that can delay
        # line delivery on Windows pipes even with buffering=1 set.
        # readline() returns immediately when a complete line is available.
        while True:
            raw_line = sys.stdin.readline()
            if not raw_line:   # EOF — stdin was closed (STOP + stdin.end() from Node)
                print("[FS:DIAG] stdin EOF — exiting read loop", file=sys.stderr, flush=True)
                break
            line = raw_line.strip()
            line_count += 1

            if not line:
                continue

            if line.upper() == "STOP":
                print("[FS:DIAG] Received STOP signal.", file=sys.stderr, flush=True)
                break

            # ── Browser-side violation injection ───────────────────────
            if line.startswith("VIOLATION:"):
                print(f"[FS:DIAG] Browser violation received: {line[:80]}", file=sys.stderr, flush=True)
                try:
                    payload    = json.loads(line[len("VIOLATION:"):])
                    event_str  = payload.get("eventType", "LOOKING_AWAY")
                    event_type = EventType(event_str)
                    meta       = payload.get("metadata", {})
                    risk_service.record_event(event_type, metadata=meta)
                    print(f"[FS:DIAG] BrowserViolation recorded: {event_str}", file=sys.stderr, flush=True)
                except Exception as exc:
                    print(f"[FS:DIAG] Could not parse VIOLATION message: {exc}", file=sys.stderr, flush=True)
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
            print(f"[FS:DIAG] Frame line received (len={len(line)}, line#{line_count})", file=sys.stderr, flush=True)
            frame = decode_frame(line)
            if frame is None:
                print("[FS:DIAG] Frame decode FAILED — skipping", file=sys.stderr, flush=True)
                self._emit_result({"error": "decode_failed"})
                continue

            frame_h, frame_w = frame.shape[:2]
            self.frame_index += 1
            self._fps.tick()

            if self.frame_index == 1:
                print(f"[FS:DIAG] First frame decoded OK: {frame_w}x{frame_h}", file=sys.stderr, flush=True)

            # ── Detection pipeline (identical to main.py loop body) ────
            detection_result = detector.detect(frame)
            print(f"[FS:DIAG] FaceDetector: faces={detection_result.face_count}", file=sys.stderr, flush=True)

            mesh_result = mesh_detector.detect(frame)
            print(f"[FS:DIAG] FaceMesh: mesh_faces={len(mesh_result.faces)}", file=sys.stderr, flush=True)

            gaze_results = []
            for face in mesh_result.faces:
                g = gaze_tracker.analyse(face)
                gaze_tracker.violation_tracker.update(g.direction)
                gaze_results.append(g)
            if gaze_results:
                print(f"[FS:DIAG] Gaze: direction={gaze_results[0].direction.value}", file=sys.stderr, flush=True)

            pose_results = []
            for face in mesh_result.faces:
                p = head_estimator.estimate(face, frame_w, frame_h)
                head_estimator.violation_tracker.update(p)
                pose_results.append(p)
            if pose_results:
                print(f"[FS:DIAG] HeadPose: direction={pose_results[0].direction.value}", file=sys.stderr, flush=True)

            phone_result = phone_service.submit(frame, self.frame_index)
            phone_service.violation_tracker.update(phone_result)
            p_count = phone_result.phone_count if phone_result else 0
            print(f"[FS:DIAG] Phone: detected={p_count}", file=sys.stderr, flush=True)

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
            print(f"[FS:DIAG] Emitting result: frame={self.frame_index} risk={result['riskScore']} level={result['riskLevel']} faces={result['faceCount']}", file=sys.stderr, flush=True)
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
        # write_through=True on both streams so every print() reaches Node immediately
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8',
                                       errors='replace', write_through=True)
        # write_through=True ensures each print() flushes immediately to Node's readline
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8',
                                       errors='replace', write_through=True)

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
        # Use line-buffering (buffering=1) to ensure Python processes each line
        # as Node writes it — without this, block-buffering can delay frames
        # until the internal buffer fills (typically 4-8 KB), stalling the loop.
        sys.stdin = open(sys.stdin.fileno(), 'r', encoding='utf-8',
                         newline='', buffering=1)

    server = FrameServer(
        db_session_id=args.session_id,
        output_file=args.output_file,
    )
    server.run()
