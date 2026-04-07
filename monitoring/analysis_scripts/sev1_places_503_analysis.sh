#!/usr/bin/env bash
# sev1_places_503_analysis.sh
# SEV-1 blast radius analysis: places-api-service HTTP 503 on /places/search
# Incident window: 2026-04-04T00:00:00Z → 2026-04-06T23:59:59Z
#
# Usage:
#   LOG_FILE=/path/to/pino.log \
#   START_TS=1743724800000 \
#   END_TS=1743983999000 \
#   bash sev1_places_503_analysis.sh
#
#   bash sev1_places_503_analysis.sh --self-test
#
# Dependencies: bash, jq
# PII rules: raw IP addresses (.req.remoteAddress) are NEVER emitted.
#             .reqId values are SHA-256-hashed before any uniqueness counting.

set -euo pipefail

# ─── Defaults ────────────────────────────────────────────────────────────────
: "${LOG_FILE:=}"
: "${START_TS:=1743724800000}"   # 2026-04-04T00:00:00Z
: "${END_TS:=1743983999000}"     # 2026-04-06T23:59:59Z

# ─── Self-test ────────────────────────────────────────────────────────────────
run_self_test() {
  echo "Running self-test..."

  SAMPLE_LOG=$(cat <<'EOF'
{"level":30,"time":1743800000000,"pid":1,"hostname":"prod","reqId":"req-abc123","req":{"method":"GET","url":"/places/search","remoteAddress":"1.2.3.4"},"res":{"statusCode":503},"responseTime":12}
{"level":30,"time":1743810000000,"pid":1,"hostname":"prod","reqId":"req-def456","req":{"method":"GET","url":"/places/search","remoteAddress":"5.6.7.8"},"res":{"statusCode":503},"responseTime":15}
{"level":30,"time":1743820000000,"pid":1,"hostname":"prod","reqId":"req-ghi789","req":{"method":"GET","url":"/places/search","remoteAddress":"9.10.11.12"},"res":{"statusCode":200},"responseTime":45}
{"level":30,"time":1743830000000,"pid":1,"hostname":"prod","reqId":"req-jkl012","req":{"method":"GET","url":"/health","remoteAddress":"1.2.3.4"},"res":{"statusCode":503},"responseTime":5}
{"level":30,"time":9999999999999,"pid":1,"hostname":"prod","reqId":"req-zzz999","req":{"method":"GET","url":"/places/search","remoteAddress":"2.3.4.5"},"res":{"statusCode":503},"responseTime":10}
EOF
)

  TMPFILE=$(mktemp)
  echo "$SAMPLE_LOG" > "$TMPFILE"

  RESULT=$(LOG_FILE="$TMPFILE" START_TS=1743724800000 END_TS=1743983999000 bash "$0" 2>/dev/null)
  rm -f "$TMPFILE"

  PASS=true

  # Expect total 503 count = 2 (req-abc123 and req-def456 match; req-ghi789 is 200; req-jkl012 is /health not /places/search; req-zzz999 is outside window)
  if echo "$RESULT" | grep -q "Total 503 count.*: *2"; then
    echo "  [PASS] Total 503 count = 2"
  else
    echo "  [FAIL] Total 503 count — expected 2. Got:"
    echo "$RESULT" | grep -i "total" || echo "    (no total line found)"
    PASS=false
  fi

  # Expect unique hashed reqId count = 2
  if echo "$RESULT" | grep -q "Unique request IDs.*: *2"; then
    echo "  [PASS] Unique request IDs = 2"
  else
    echo "  [FAIL] Unique request IDs — expected 2. Got:"
    echo "$RESULT" | grep -i "unique" || echo "    (no unique line found)"
    PASS=false
  fi

  # Ensure no raw IP addresses appear in output
  if echo "$RESULT" | grep -qE '\b([0-9]{1,3}\.){3}[0-9]{1,3}\b'; then
    echo "  [FAIL] Raw IP address found in output — PII leak"
    PASS=false
  else
    echo "  [PASS] No raw IP addresses in output"
  fi

  # Expect per-hour breakdown to contain an entry for the matching hours
  # 1743800000000 ms → 2026-04-04 18:13 UTC → hour 18
  # 1743810000000 ms → 2026-04-04 20:53 UTC → hour 20
  if echo "$RESULT" | grep -qE "^[[:space:]]*[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:00Z"; then
    echo "  [PASS] Per-hour breakdown table present"
  else
    echo "  [FAIL] Per-hour breakdown table missing or malformed"
    PASS=false
  fi

  echo ""
  if $PASS; then
    echo "Self-test result: PASS"
    exit 0
  else
    echo "Self-test result: FAIL"
    exit 1
  fi
}

if [[ "${1:-}" == "--self-test" ]]; then
  run_self_test
fi

# ─── Validate inputs ─────────────────────────────────────────────────────────
if [[ -z "$LOG_FILE" ]]; then
  echo "ERROR: LOG_FILE env var must be set" >&2
  exit 1
fi

if [[ ! -f "$LOG_FILE" ]]; then
  echo "ERROR: LOG_FILE '$LOG_FILE' not found" >&2
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is required but not installed" >&2
  exit 1
fi

# ─── Filter matching log lines ───────────────────────────────────────────────
# Criteria:
#   .res.statusCode == 503
#   .req.url contains "/places/search"
#   .time between START_TS and END_TS inclusive
# PII: .req.remoteAddress is NEVER emitted.

MATCHING=$(jq -c --argjson ts_start "$START_TS" --argjson ts_end "$END_TS" 'select(.res.statusCode == 503 and (.req.url // "" | contains("/places/search")) and (.time >= $ts_start) and (.time <= $ts_end)) | {time: .time, reqId: (.reqId // ""), url: .req.url}' "$LOG_FILE" 2>/dev/null)

if [[ -z "$MATCHING" ]]; then
  echo "No matching log lines found for the given window."
  echo "Total 503 count               : 0"
  echo "Unique request IDs (hashed)   : 0"
  exit 0
fi

# ─── Total 503 count ─────────────────────────────────────────────────────────
TOTAL=$(echo "$MATCHING" | wc -l | tr -d ' ')

# ─── Unique hashed reqIds ─────────────────────────────────────────────────────
# SHA-256 hash each reqId, then count distinct hashes.
# This preserves the ability to count uniques without exposing raw IDs.
UNIQUE_COUNT=$(echo "$MATCHING" \
  | jq -r '.reqId' \
  | while IFS= read -r rid; do
      printf '%s' "$rid" | sha256sum | awk '{print $1}'
    done \
  | sort -u \
  | wc -l \
  | tr -d ' ')

# ─── Per-hour breakdown ───────────────────────────────────────────────────────
# .time is epoch ms; divide by 1000 to get seconds, truncate to hour boundary.
HOUR_BREAKDOWN=$(echo "$MATCHING" \
  | jq -r '.time' \
  | awk '{ epoch_s = int($1 / 1000); hour_s = epoch_s - (epoch_s % 3600); print hour_s }' \
  | sort \
  | uniq -c \
  | awk '{
      secs = $2
      # Format as YYYY-MM-DDTHH:00Z using shell date
      cmd = "date -u -d @" secs " +%Y-%m-%dT%H:00Z 2>/dev/null || date -u -r " secs " +%Y-%m-%dT%H:00Z"
      cmd | getline ts
      close(cmd)
      printf "  %-20s  %d\n", ts, $1
    }')

# ─── Output ───────────────────────────────────────────────────────────────────
echo "======================================================"
echo " SEV-1 places-api-service /places/search 503 Analysis"
echo "======================================================"
echo ""
echo "Incident window (UTC):"
printf "  Start : %s  (%s ms)\n" "$(date -u -d "@$((START_TS / 1000))" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -r "$((START_TS / 1000))" +%Y-%m-%dT%H:%M:%SZ)" "$START_TS"
printf "  End   : %s  (%s ms)\n" "$(date -u -d "@$((END_TS / 1000))" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -r "$((END_TS / 1000))" +%Y-%m-%dT%H:%M:%SZ)" "$END_TS"
echo ""
echo "Log file: $LOG_FILE"
echo ""
echo "Results:"
echo "  Total 503 count               : $TOTAL"
echo "  Unique request IDs (hashed)   : $UNIQUE_COUNT"
echo ""
echo "Note: .reqId values have been SHA-256 hashed before uniqueness counting."
echo "Note: .req.remoteAddress (IP) values are not present in this output (PII scrubbed)."
echo ""
echo "Per-hour breakdown (UTC):"
echo "  Hour (UTC)              Count"
echo "  ──────────────────────────────"
echo "$HOUR_BREAKDOWN"
echo ""
echo "======================================================"
echo " Confidence: LOW until production log access confirmed"
echo " This is a LOWER-BOUND estimate. One user may generate"
echo " multiple 503s. Bot traffic has not been filtered."
echo "======================================================"
