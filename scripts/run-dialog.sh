#!/usr/bin/env bash
set -euo pipefail

# Allow calling directory from anywhere in repo
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "${SCRIPT_DIR}")"

cd "$PROJECT_ROOT"

SKILL_ID="amzn1.ask.skill.b4347dae-06f3-415c-b5d0-12f68537241d"
UTTERANCE=${*:-"ask codex to run the smoke tests"}
LOG_FILE="/home/branchmanager/websites/degenduel/logs/nginx_logs/nginx-conf-access.log"

START_LINES=$(sudo wc -l "$LOG_FILE" | awk '{print $1}')

printf "[codelexa] Running Alexa dialog: %s\n" "$UTTERANCE"

ask dialog -l en-US -s "$SKILL_ID" <<EOF
launch codex
$UTTERANCE
.quit
EOF

END_LINES=$(sudo wc -l "$LOG_FILE" | awk '{print $1}')

if [ "$END_LINES" -gt "$START_LINES" ]; then
  NEW_LINES=$(sudo sed -n "$((START_LINES + 1)),${END_LINES}p" "$LOG_FILE")
  MATCHING=$(printf '%s\n' "$NEW_LINES" | grep "/alexa" || true)
  if [ -n "$MATCHING" ]; then
    printf "[codelexa] New /alexa hits detected:\n%s\n" "$MATCHING"
  else
    printf "[codelexa] No /alexa requests in new nginx entries (%s new lines).\n" "$((END_LINES - START_LINES))"
  fi
else
  printf "[codelexa] No new nginx /alexa entries detected.\n"
fi
