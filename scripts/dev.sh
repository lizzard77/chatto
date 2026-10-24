#!/usr/bin/env bash
# Startet einen lokalen Chatto-Dev-Server aus upstream/ (mit allen Patches) samt LiveKit für Calls.
#   scripts/dev.sh            bauen + starten
#   scripts/dev.sh --no-build nur starten
#   scripts/dev.sh --reset    Daten löschen (frischer Server mit Testusern; LiveKit-Binary bleibt)
# Erststart legt die Testuser aus upstream/cli/chatto.toml an: alice / bob (Passwort steht dort).
# Bots für den Dev-Server: scripts/dev-bots.sh.
# Port: CHATTO_DEV_PORT (Standard 4400; LiveKit +5, UDP +6, NATS +4). Alles Lokale liegt in .dev/:
#   data/            Daten des Servers
#   bin/             livekit-server (beim ersten Start per `go install` gebaut, Version aus upstream/mise.toml)
#   livekit.yaml     LiveKit-Konfiguration (bei jedem Start neu geschrieben)
#   bots.env         API-Keys der Dev-Bots (scripts/dev-bots.sh)
source "$(dirname "$0")/lib.sh"
need_upstream
PORT="${CHATTO_DEV_PORT:-4400}"
DEV="$ROOT/.dev"
DATA="$DEV/data"
# Der Operator-Socket-Pfad muss kurz sein (<108 Zeichen) und sein Ordner Modus 700 haben.
SOCKDIR="${XDG_RUNTIME_DIR:-/tmp}/chatto-dev"
LK_PORT=$((PORT + 5))
LK_KEY=devkey
LK_SECRET=chatto-dev-livekit-secret-0123456789
build=1
for arg in "$@"; do
  case "$arg" in
    --no-build) build=0 ;;
    --reset) rm -rf "$DATA" "$DEV/bots.env"; echo "Daten gelöscht" ;;
    *) echo "unbekannt: $arg" >&2; exit 2 ;;
  esac
done
[ $build = 1 ] && "$ROOT/scripts/build.sh"
mkdir -p "$DATA" "$DEV/bin" "$SOCKDIR"; chmod 700 "$SOCKDIR"

LK="$DEV/bin/livekit-server"
if [ ! -x "$LK" ]; then
  pkg="$(sed -n 's/^CHATTO_DEV_LIVEKIT_SERVER = "go:\(.*\)"/\1/p' "$UPSTREAM/mise.toml")"
  say "LiveKit bauen: $pkg"
  GOBIN="$DEV/bin" go install "$pkg"
  mv "$DEV/bin/server" "$LK"
fi
cat > "$DEV/livekit.yaml" <<EOF
port: $LK_PORT
bind_addresses: [127.0.0.1]
rtc:
  tcp_port: 0
  udp_port: $((PORT + 6))
  use_external_ip: false
  enable_loopback_candidate: true
  node_ip: 127.0.0.1
keys: { $LK_KEY: $LK_SECRET }
webhook:
  urls: ["http://127.0.0.1:$PORT/webhooks/livekit"]
  api_key: $LK_KEY
logging: { level: warn }
EOF
"$LK" --config "$DEV/livekit.yaml" &
LK_PID=$!
trap 'kill $LK_PID 2>/dev/null' EXIT

say "Chatto: http://localhost:$PORT  (alice / bob, siehe upstream/cli/chatto.toml), LiveKit :$LK_PORT"
cd "$UPSTREAM/cli"
export CHATTO_WEBSERVER_PORT="$PORT" \
  CHATTO_WEBSERVER_URL="http://localhost:$PORT" \
  CHATTO_NATS_EMBEDDED_PORT="$((PORT + 4))" \
  CHATTO_NATS_EMBEDDED_DATA_DIR="$DATA/nats" \
  CHATTO_SEARCH_PROVIDER_DIRECTORY="$DATA/search" \
  CHATTO_OPERATOR_API_SOCKET_PATH="$SOCKDIR/op.sock" \
  CHATTO_LIVEKIT_ENABLED=true \
  CHATTO_LIVEKIT_URL="ws://localhost:$LK_PORT" \
  CHATTO_LIVEKIT_API_KEY="$LK_KEY" \
  CHATTO_LIVEKIT_API_SECRET="$LK_SECRET"
bin/chatto run
