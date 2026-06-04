# proctoring/main.py
# ─────────────────────────────────────────────────────────────────────────────
# OLAS AI-Powered Online Proctoring System
# Module 7 — Risk Scoring Engine
# (Builds on Modules 1-6)
# ─────────────────────────────────────────────────────────────────────────────
#
# Entry point.  Run from the proctoring/ directory:
#
#     python main.py
#
# What this module adds over Module 6
# ────────────────────────────────────
# 26. All violation callbacks forward events to RiskService.record_event().
# 27. A RiskSnapshot is read every frame and rendered as a top-right panel:
#     • Semi-transparent risk-level banner (colour-coded).
#     • Horizontal score gauge bar (0–100).
#     • Last event, total events, session elapsed time.
# 28. On exit, a SessionRiskReport is generated:
#     • Written to logs/session_report.txt (human-readable).
#     • Written to logs/risk_log.txt (structured, machine-parseable).
# 29. No risk calculation logic lives in this file — only record_event() calls.
#
# All Module 1-6 behaviour is UNCHANGED.
#
# Keyboard shortcut: press Q (or close the window) to exit.
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import os
import sys
import cv2

# Local modules
import config
from webcam import Webcam, WebcamError
from face_detector import FaceDetector, FaceDetectorError
from face_mesh_detector import FaceMeshDetector, FaceMeshDetectorError
from gaze_tracker import GazeTracker, GazeResult, GazeDirection
from head_pose_estimator import HeadPoseEstimator, HeadPoseResult, HeadDirection
from phone_detection import PhoneService
from phone_detection.phone_detector import PhoneDetectorError
from risk_engine import RiskService, EventType
from fps_counter import FPSCounter
from violation_tracker import ViolationTracker, ProctoringStatus
from logs import ViolationLogger
from display import (
    draw_fps,
    draw_quit_hint,
    draw_face_boxes,
    draw_face_count,
    draw_violation_counter,
    draw_proctoring_status,
    draw_face_mesh,
    draw_mesh_status,
    draw_gaze_overlay,
    draw_gaze_ratios,
    draw_head_pose_overlay,
    draw_head_angles,
    draw_phone_overlay,
    draw_risk_overlay,
)


# ─────────────────────────────────────────────────────────────────────────────
# Core capture-and-detect loop
# ─────────────────────────────────────────────────────────────────────────────

def run_proctoring_feed(
    cam: Webcam,
    detector: FaceDetector,
    mesh_detector: FaceMeshDetector,
    gaze_tracker: GazeTracker,
    head_estimator: HeadPoseEstimator,
    phone_service: PhoneService,
    tracker: ViolationTracker,
    logger: ViolationLogger,
    risk_service: RiskService,
) -> None:
    """
    Main loop: capture → detect → mesh → gaze → head → phone → risk → display.

    Parameters
    ----------
    cam            : Webcam             – Opened webcam.
    detector       : FaceDetector       – Module 2.
    mesh_detector  : FaceMeshDetector   – Module 3.
    gaze_tracker   : GazeTracker        – Module 4.
    head_estimator : HeadPoseEstimator  – Module 5.
    phone_service  : PhoneService       – Module 6.
    tracker        : ViolationTracker   – Face-count violations (Module 2).
    logger         : ViolationLogger    – Violation file logger.
    risk_service   : RiskService        – Risk accumulator (Module 7).
    """
    fps_counter   = FPSCounter(window=30)
    quit_key_code = ord(config.QUIT_KEY.lower())
    frame_index   = 0

    print(f"[Main] Streaming — press '{config.QUIT_KEY.upper()}' to quit.")

    while True:
        # ── 1. Grab a frame ───────────────────────────────────────────────
        success, frame = cam.read_frame()
        if not success or frame is None:
            print("[Main] Warning: failed to read frame — retrying…")
            continue

        frame_h, frame_w = frame.shape[:2]
        frame_index += 1

        # ── 2. Tick FPS counter ───────────────────────────────────────────
        fps_counter.tick()

        # ── 3. Face detection (Module 2) ──────────────────────────────────
        detection_result = detector.detect(frame)

        # ── 4. Face mesh / landmarks (Module 3) ───────────────────────────
        mesh_result = mesh_detector.detect(frame)

        # ── 5. Gaze analysis (Module 4) ───────────────────────────────────
        gaze_results: list[GazeResult] = []
        for face in mesh_result.faces:
            g = gaze_tracker.analyse(face)
            gaze_tracker.violation_tracker.update(g.direction)
            gaze_results.append(g)

        # ── 6. Head pose estimation (Module 5) ────────────────────────────
        pose_results: list[HeadPoseResult] = []
        for face in mesh_result.faces:
            p = head_estimator.estimate(face, frame_w, frame_h)
            head_estimator.violation_tracker.update(p)
            pose_results.append(p)

        # ── 7. Phone detection (Module 6) ─────────────────────────────────
        phone_result = phone_service.submit(frame, frame_index)
        phone_service.violation_tracker.update(phone_result)

        # ── 8. Face-count violation state (Module 2) ──────────────────────
        status = tracker.update(detection_result.face_count)

        # ── 9. Compose display frame ──────────────────────────────────────
        display_frame = frame.copy()

        # Layers: mesh → phone boxes → face boxes → text overlays
        draw_face_mesh(display_frame, mesh_result)
        draw_phone_overlay(
            display_frame, phone_result,
            violation_count=phone_service.violation_tracker.violation_count,
        )
        draw_face_boxes(display_frame, detection_result)

        # Left panel rows
        draw_fps(display_frame, fps_counter.fps)
        draw_mesh_status(display_frame, mesh_result)

        gvt = gaze_tracker.violation_tracker
        draw_gaze_overlay(
            display_frame, gaze_results,
            violation_active=gvt.is_currently_violated,
            seconds_away=gvt.seconds_away,
            gaze_violation_count=gvt.violation_count,
        )

        hvt = head_estimator.violation_tracker
        draw_head_pose_overlay(
            display_frame, pose_results,
            violation_active=hvt.is_currently_violated,
            seconds_away=hvt.seconds_away,
            head_violation_count=hvt.violation_count,
        )

        # Right panel: face count + violation counter + debug rows
        draw_face_count(display_frame, detection_result.face_count)
        draw_violation_counter(display_frame, tracker.violation_count)
        if gaze_results:
            draw_gaze_ratios(display_frame, gaze_results[0])
        if pose_results:
            draw_head_angles(display_frame, pose_results[0])

        # Module 7 — risk panel (top-right banner + gauge + detail rows)
        draw_risk_overlay(display_frame, risk_service.snapshot)

        # Bottom banner + quit hint
        draw_proctoring_status(display_frame, status, tracker.status_label)
        draw_quit_hint(display_frame)

        # ── 10. Show frame ────────────────────────────────────────────────
        cv2.imshow(config.WINDOW_TITLE, display_frame)

        # ── 11. Keyboard / window-close ───────────────────────────────────
        key = cv2.waitKey(1) & 0xFF
        if key == quit_key_code:
            print("[Main] Quit key pressed — exiting.")
            break

        if cv2.getWindowProperty(config.WINDOW_TITLE, cv2.WND_PROP_VISIBLE) < 1:
            print("[Main] Window closed — exiting.")
            break


# ─────────────────────────────────────────────────────────────────────────────
# Violation callback  (called by ViolationTracker on state change)
# ─────────────────────────────────────────────────────────────────────────────

def _make_violation_handler(logger: ViolationLogger, risk: RiskService):
    """Face-count violation → logs + risk engine."""
    def handle(status: ProctoringStatus, face_count: int) -> None:
        logger.log(status, face_count)
        event_type = (
            EventType.NO_FACE        if status == ProctoringStatus.NO_FACE
            else EventType.MULTIPLE_FACES
        )
        risk.record_event(event_type, metadata={"faces": face_count})
        print(f"[Violation] {status.name}  (faces={face_count})")
    return handle


def _make_gaze_violation_handler(logger: ViolationLogger, risk: RiskService):
    """Gaze-away violation → logs + risk engine."""
    def handle(direction: GazeDirection, duration_s: float) -> None:
        logger.log_gaze_violation(direction.value, duration_s)
        risk.record_event(
            EventType.LOOKING_AWAY,
            duration_s=duration_s,
            metadata={"direction": direction.value},
        )
        print(
            f"[GazeViolation] LOOKING_AWAY  "
            f"direction={direction.value}  duration={duration_s:.2f}s"
        )
    return handle


def _make_head_violation_handler(logger: ViolationLogger, risk: RiskService):
    """Head-turned-away violation → logs + risk engine."""
    def handle(
        direction: HeadDirection,
        yaw: float, pitch: float, roll: float,
        duration_s: float,
    ) -> None:
        logger.log_head_violation(direction.value, yaw, pitch, roll, duration_s)
        risk.record_event(
            EventType.HEAD_TURNED_AWAY,
            duration_s=duration_s,
            metadata={
                "direction": direction.value,
                "yaw": round(yaw, 1),
                "pitch": round(pitch, 1),
            },
        )
        print(
            f"[HeadViolation] HEAD_TURNED_AWAY  "
            f"direction={direction.value}  "
            f"yaw={yaw:+.1f}  pitch={pitch:+.1f}  duration={duration_s:.2f}s"
        )
    return handle


def _make_phone_violation_handler(logger: ViolationLogger, risk: RiskService):
    """Phone-detected violation → logs + risk engine."""
    def handle(phone_count: int, confidence: float) -> None:
        logger.log_phone_violation(phone_count, confidence)
        risk.record_event(
            EventType.PHONE_DETECTED,
            metadata={"count": phone_count, "confidence": round(confidence, 3)},
        )
        print(
            f"[PhoneViolation] PHONE_DETECTED  "
            f"count={phone_count}  confidence={confidence:.3f}"
        )
    return handle


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    """Bootstrap all subsystems, run the feed, and clean up on exit."""
    import argparse, json, threading, time

    # ── CLI args: accept --session-id so Node can pass the DB session ID ──
    parser = argparse.ArgumentParser(description="OLAS Proctoring Engine")
    parser.add_argument(
        "--session-id",
        type=str,
        default=None,
        help="Database session ID passed from the Node server",
    )
    parser.add_argument(
        "--output-file",
        type=str,
        default=os.path.join(os.path.dirname(__file__), "session_output.json"),
        help="Path where live session JSON is written for the backend to read",
    )
    args = parser.parse_args()

    db_session_id = args.session_id
    output_file   = args.output_file

    print("=" * 60)
    print("  OLAS Proctoring System — Module 7: Risk Scoring Engine")
    if db_session_id:
        print(f"  DB Session ID: {db_session_id}")
    print("=" * 60)

    # ── Live JSON writer (runs every 2 seconds in background) ─────────────
    _stop_writer = threading.Event()

    def _write_output(
        risk_svc: RiskService,
        face_tracker: ViolationTracker,
        gaze_vt,
        head_vt,
        phone_vt,
    ) -> None:
        """Write current state to session_output.json every 2 s."""
        while not _stop_writer.is_set():
            try:
                snap = risk_svc.snapshot
                counts = snap.event_counts
                payload = {
                    "sessionId":       db_session_id or risk_svc.session_id,
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
            _stop_writer.wait(timeout=2.0)

    with ViolationLogger() as logger:
        risk_service   = RiskService(session_id=db_session_id)
        risk_service.start()

        tracker        = ViolationTracker(
            on_violation=_make_violation_handler(logger, risk_service))
        gaze_tracker   = GazeTracker(
            on_violation=_make_gaze_violation_handler(logger, risk_service))
        head_estimator = HeadPoseEstimator(
            on_violation=_make_head_violation_handler(logger, risk_service))
        phone_service  = PhoneService(
            on_violation=_make_phone_violation_handler(logger, risk_service))

        # Start background JSON writer
        writer_thread = threading.Thread(
            target=_write_output,
            args=(risk_service, tracker,
                  gaze_tracker.violation_tracker,
                  head_estimator.violation_tracker,
                  phone_service.violation_tracker),
            daemon=True,
        )
        writer_thread.start()

        try:
            phone_service.start()

            with FaceMeshDetector() as mesh_detector:
                with FaceDetector() as detector:
                    with Webcam() as cam:
                        cv2.namedWindow(config.WINDOW_TITLE, cv2.WINDOW_NORMAL)
                        run_proctoring_feed(
                            cam, detector, mesh_detector,
                            gaze_tracker, head_estimator,
                            phone_service, tracker, logger,
                            risk_service,
                        )

        except WebcamError as exc:
            print(f"\n[ERROR] Webcam problem: {exc}")
            sys.exit(1)

        except FaceDetectorError as exc:
            print(f"\n[ERROR] Face detector problem: {exc}")
            sys.exit(1)

        except FaceMeshDetectorError as exc:
            print(f"\n[ERROR] Face mesh problem: {exc}")
            sys.exit(1)

        except PhoneDetectorError as exc:
            print(f"\n[ERROR] Phone detector problem: {exc}")
            sys.exit(1)

        except KeyboardInterrupt:
            print("\n[Main] Interrupted by user.")

        finally:
            # Stop background writer
            _stop_writer.set()

            phone_service.stop()
            cv2.destroyAllWindows()

            # Generate final report
            report = risk_service.end_session()
            risk_service.stop()

            # Write final state to session_output.json with status=completed
            try:
                counts = report.event_counts
                final_payload = {
                    "sessionId":       db_session_id or risk_service.session_id,
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
                    "reportPath":      os.path.join(
                        config.LOG_DIR, "session_report.txt"
                    ),
                }
                with open(output_file, "w", encoding="utf-8") as fh:
                    json.dump(final_payload, fh)
                print(f"[Main] Final output written → {output_file}")
            except Exception as exc:
                print(f"[Main] Warning: could not write final output: {exc}")

            print("\n" + report.to_plain_text())
            print(
                f"\n[Main] Session ended — "
                f"face: {tracker.violation_count}  "
                f"gaze: {gaze_tracker.violation_tracker.violation_count}  "
                f"head: {head_estimator.violation_tracker.violation_count}  "
                f"phone: {phone_service.violation_tracker.violation_count}  "
                f"risk: {report.final_score:.1f} ({report.final_level.value})"
            )
            print("[Main] All resources released. Goodbye.")


if __name__ == "__main__":
    main()
