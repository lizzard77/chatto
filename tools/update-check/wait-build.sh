#!/usr/bin/env bash
# Wartet auf den Lauf von images.yml für einen Commit (öffentliche GitHub-API, kein gh/Token nötig).
#   tools/update-check/wait-build.sh <sha> [max. Sekunden, Standard 540]
# Exit 0 = erfolgreich, 1 = fehlgeschlagen, 2 = noch nicht fertig (einfach erneut aufrufen).
set -uo pipefail
SHA="${1:?usage: $0 <sha> [sekunden]}"
MAX="${2:-540}"
API="https://api.github.com/repos/lizzard77/chatto/actions/workflows/images.yml/runs?head_sha=$SHA&per_page=1"
end=$((SECONDS + MAX))
while :; do
  read -r status conclusion url < <(curl -fsS "$API" 2>/dev/null | python3 -c '
import json, sys
r = (json.load(sys.stdin).get("workflow_runs") or [None])[0]
print(*(("none", "-", "-") if not r else (r["status"], r["conclusion"] or "-", r["html_url"])))' 2>/dev/null || echo "error - -")
  if [ "$status" = completed ]; then
    echo "images.yml $conclusion: $url"
    [ "$conclusion" = success ] && exit 0 || exit 1
  fi
  if [ $SECONDS -ge $end ]; then
    echo "images.yml noch nicht fertig (status=$status) $url"
    exit 2
  fi
  sleep 60
done
