#!/usr/bin/env bash
# Startet den täglichen Chatto-Update-Check headless mit Claude Code (Opus).
# Aufgerufen vom systemd-User-Timer chatto-update-check.timer (siehe README.md).
set -uo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
LOGDIR="$HOME/.local/state/chatto-update-check"
mkdir -p "$LOGDIR"
LOG="$LOGDIR/$(date +%F_%H%M).log"
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:$PATH"
cd "$REPO" || exit 1

claude -p "$(cat "$REPO/tools/update-check/prompt.md")" \
  --model opus \
  --allowedTools "Bash Read Edit Write Glob Grep" \
  --permission-mode acceptEdits \
  > "$LOG" 2>&1
rc=$?
if [ $rc -ne 0 ]; then
  printf '⚠️ Chatto-Update-Check ist abgebrochen (Exit %s). Log: `%s`\n' "$rc" "$LOG" \
    | "$REPO/tools/update-check/notify.sh" || true
fi
# alte Logs aufräumen
find "$LOGDIR" -name '*.log' -mtime +30 -delete
exit $rc
