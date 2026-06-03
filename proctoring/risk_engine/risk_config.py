# risk_engine/risk_config.py
# ─────────────────────────────────────────────────────────────────────────────
# Risk Scoring Engine — configurable weights and thresholds.
#
# All numeric knobs live here.  Adjust weights to calibrate risk sensitivity
# for a specific exam context without touching any business logic.
#
# Design principle: weights are ADDITIVE per event occurrence.
# The score is maintained on a 0–100 scale.  Each event adds its weight,
# capped at 100.  The score never decreases during a session (violations
# leave a permanent record), but the CURRENT_RISK snapshot reflects
# real-time severity.
#
# Future events (cheat sheet, book, calculator) can be added here and in
# EventType without changing any other file.
# ─────────────────────────────────────────────────────────────────────────────

# ── Event weights (0–100 scale, additive) ────────────────────────────────────
# Higher weight = more severe violation.

WEIGHT_NO_FACE:          float = 15.0   # face disappeared from frame
WEIGHT_MULTIPLE_FACES:   float = 30.0   # another person visible
WEIGHT_LOOKING_AWAY:     float = 5.0    # eyes off-screen for > threshold
WEIGHT_HEAD_TURNED_AWAY: float = 8.0    # head turned away for > threshold
WEIGHT_PHONE_DETECTED:   float = 50.0   # mobile phone visible in frame

# Reserved weights for future modules (set 0 to disable):
WEIGHT_CHEAT_SHEET:      float = 40.0   # cheat sheet / paper detected
WEIGHT_BOOK_DETECTED:    float = 35.0   # textbook detected
WEIGHT_CALCULATOR:       float = 25.0   # calculator detected

# ── Risk level thresholds (score boundaries) ─────────────────────────────────
# Score ranges map to levels:  0-20 SAFE | 21-40 LOW | 41-60 MEDIUM | 61-80 HIGH | 81-100 CRITICAL

THRESHOLD_SAFE:     float = 20.0
THRESHOLD_LOW:      float = 40.0
THRESHOLD_MEDIUM:   float = 60.0
THRESHOLD_HIGH:     float = 80.0
# Above HIGH → CRITICAL

# ── Score decay (optional, disabled by default) ───────────────────────────────
# Set SCORE_DECAY_PER_MINUTE > 0 to slowly reduce the score over time,
# modelling the idea that older violations matter less.
# 0.0 = no decay (recommended for most exam scenarios).
SCORE_DECAY_PER_MINUTE: float = 0.0

# ── Session report settings ───────────────────────────────────────────────────
RISK_LOG_FILENAME:  str = "risk_log.txt"   # written inside config.LOG_DIR
REPORT_FILENAME:    str = "session_report.txt"
