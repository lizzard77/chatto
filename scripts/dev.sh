#!/usr/bin/env bash
# Startet einen lokalen Chatto-Dev-Server aus upstream/ (mit allen Patches).
#   scripts/dev.sh            bauen + starten
#   scripts/dev.sh --no-build nur starten
#   scripts/dev.sh --reset    Daten löschen (frischer Server mit Testusern)
# Erststart legt die Testuser aus upstream/cli/chatto.toml an: alice / bob (Passwort steht dort).
# Port: CHATTO_DEV_PORT (Standard 4400), Daten in .dev/.
source "$(dirname "$0")/lib.sh"
need_upstream
PORT="${CHATTO_DEV_PORT:-4400}"
DATA="$ROOT/.dev/data"
# Der Operator-Socket-Pfad muss kurz sein (<108 Zeichen) und sein Ordner Modus 700 haben.
SOCKDIR="${XDG_RUNTIME_DIR:-/tmp}/chatto-dev"
build=1
for arg in "$@"; do
  case "$arg" in
    --no-build) build=0 ;;
    --reset) rm -rf "$ROOT/.dev"; echo "Daten gelöscht" ;;
    *) echo "unbekannt: $arg" >&2; exit 2 ;;
  esac
done
[ $build = 1 ] && "$ROOT/scripts/build.sh"
mkdir -p "$DATA" "$SOCKDIR"; chmod 700 "$SOCKDIR"
say "Chatto: http://localhost:$PORT  (alice / bob, siehe upstream/cli/chatto.toml)"
cd "$UPSTREAM/cli"
export CHATTO_WEBSERVER_PORT="$PORT" \
  CHATTO_WEBSERVER_URL="http://localhost:$PORT" \
  CHATTO_NATS_EMBEDDED_PORT="$((PORT + 4))" \
  CHATTO_NATS_EMBEDDED_DATA_DIR="$DATA/nats" \
  CHATTO_SEARCH_PROVIDER_DIRECTORY="$DATA/search" \
  CHATTO_OPERATOR_API_SOCKET_PATH="$SOCKDIR/op.sock"
exec bin/chatto run
