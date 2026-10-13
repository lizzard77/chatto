#!/usr/bin/env bash
# Schickt Phil eine Chatto-DM vom Hermes-Bot (Markdown auf stdin oder als Argument).
#   tools/notify.sh "Text"        echo "Text" | tools/notify.sh
# Andere Räume: CHATTO_NOTIFY_ROOM=<Raum-ID>; der Bot muss Mitglied sein.
# Läuft im Hermes-Container direkt, sonst per `ssh nas` + `docker exec hermes` – das Bot-Token
# (CHATTO_TOKEN in /opt/data/.env) bleibt im Container.
set -euo pipefail
ROOM="${CHATTO_NOTIFY_ROOM:-b2f2f66a32d348}"   # DM Phil <-> Hermes
MSG="${1:-$(cat)}"
[ -n "${MSG//[[:space:]]/}" ] || { echo "notify.sh: leere Nachricht" >&2; exit 2; }
b64="$(printf '%s' "$MSG" | base64 -w0)"

PY='
import base64, json, os, sys, urllib.request, urllib.error
env = dict(l.split("=", 1) for l in open("/opt/data/.env").read().splitlines() if l.startswith("CHATTO_"))
body = base64.b64decode(os.environ["MSG_B64"]).decode().strip()
req = urllib.request.Request(env["CHATTO_BASE_URL"].strip() + "/api/connect/chatto.api.v1.MessageService/CreateMessage",
    json.dumps({"roomId": os.environ["ROOM"], "body": body}).encode(),
    {"Authorization": "Bearer " + env["CHATTO_TOKEN"].strip(), "Content-Type": "application/json"})
try:
    urllib.request.urlopen(req, timeout=30); print("notify ok")
except urllib.error.HTTPError as e:
    print(f"notify failed: {e.code} {e.read()[:300]}", file=sys.stderr); sys.exit(1)
'

if [ -r /opt/data/.env ]; then
  MSG_B64="$b64" ROOM="$ROOM" python3 -c "$PY"
else
  printf '%s' "$PY" | ssh -o BatchMode=yes nas \
    "docker exec -i -u hermes -e MSG_B64=$b64 -e ROOM=$ROOM hermes sh -c 'python3 -c \"\$(cat)\"'"
fi
