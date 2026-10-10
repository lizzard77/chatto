#!/usr/bin/env bash
# Usage: notify.sh <<< "Markdown-Text"   – schickt eine DM von Pantheon an Phil (Chatto auf he1)
set -euo pipefail
ROOM="${CHATTO_NOTIFY_ROOM:-b9d1bc00fb4b19}"   # DM Phil <-> Pantheon
dir="$(cd "$(dirname "$0")" && pwd)"
b64="$(base64 -w0)"
ssh -o BatchMode=yes phil@he1.lizzard77.dev \
  "docker exec -i -e MSG_B64=$b64 -e ROOM=$ROOM chatto-pantheon node --input-type=module -" < "$dir/notify.js"
