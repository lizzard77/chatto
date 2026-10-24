#!/usr/bin/env bash
# Bots Pantheon und Erato auf dem laufenden Dev-Server (scripts/dev.sh) einrichten und starten.
#   scripts/dev-bots.sh                        nur einrichten (falls nötig) und Keys anzeigen
#   scripts/dev-bots.sh pantheon               Pantheon gegen den Dev-Server starten
#   scripts/dev-bots.sh erato [<datei>]        Erato im Channel general starten (Standard: Testton);
#                                              DM-Steuerung für alice, ohne Zusatzquellen aus bots/erato/.env
# Einrichten legt die Bots als alice an, gibt ihnen serverweit die nötigen Rechte, lässt sie
# #general beitreten und schreibt die API-Keys nach .dev/bots.env. Nach `dev.sh --reset` erneut.
source "$(dirname "$0")/lib.sh"
URL="http://localhost:${CHATTO_DEV_PORT:-4400}"
ENV_FILE="$ROOT/.dev/bots.env"
PERMISSIONS="room.list room.join message.read message.post message.post-in-thread message.manage
  message.react call.start call.join call.voice call.camera call.screenshare"

rpc() { # rpc <token> <service/Method> <json>
  curl -sf -X POST "$URL/api/connect/$2" -H "Authorization: Bearer $1" \
    -H 'Content-Type: application/json' -d "$3"
}

setup() {
  local token general
  token="$(curl -sf -X POST "$URL/auth/login" -H 'Content-Type: application/json' \
    -d '{"login":"alice","password":"foobar123"}' | jq -r .token)" \
    || { echo "Dev-Server unter $URL nicht erreichbar – erst scripts/dev.sh" >&2; exit 1; }
  rpc "$token" chatto.api.v1.ViewerService/ActivatePrivilegedMode '{}' >/dev/null
  general="$(rpc "$token" chatto.api.v1.RoomDirectoryService/ListRooms '{}' \
    | jq -r '.rooms[] | select(.room.name == "general") | .room.id')"
  : > "$ENV_FILE"
  for bot in pantheon erato; do
    local created id key
    created="$(rpc "$token" chatto.api.v1.BotService/CreateBot \
      "{\"login\":\"$bot\",\"displayName\":\"${bot^}\"}")" \
      || { echo "Bot $bot lässt sich nicht anlegen (gibt es ihn schon ohne Key in .dev/bots.env? → dev.sh --reset)" >&2; exit 1; }
    id="$(jq -r .bot.user.id <<<"$created")"
    key="$(jq -r .apiKey <<<"$created")"
    for p in $PERMISSIONS; do
      rpc "$token" chatto.admin.v1.AdminPermissionService/SetUserPermission \
        "{\"userId\":\"$id\",\"permission\":\"$p\",\"decision\":\"PERMISSION_DECISION_ALLOW\"}" >/dev/null
    done
    rpc "$key" chatto.api.v1.RoomService/JoinRoom "{\"roomId\":\"$general\"}" >/dev/null
    echo "${bot^^}_API_KEY=$key" >> "$ENV_FILE"
    say "Bot $bot angelegt ($id)"
  done
}

# Keys gültig? Sonst (frischer Server) neu einrichten
if [ ! -s "$ENV_FILE" ] || ! rpc "$(sed -n 's/^PANTHEON_API_KEY=//p' "$ENV_FILE")" \
    chatto.api.v1.ViewerService/GetViewer '{}' >/dev/null; then
  setup
fi
source "$ENV_FILE"

case "${1:-}" in
  "") cat "$ENV_FILE" ;;
  pantheon)
    cd "$ROOT/bots/pantheon"
    [ -d node_modules ] || npm ci
    CHATTO_URL="$URL" CHATTO_API_KEY="$PANTHEON_API_KEY" exec node bot.mjs ;;
  erato)
    cd "$ROOT/bots/erato"
    [ -d node_modules ] || npm ci
    file="${2:-$ROOT/.dev/tone.ogg}"
    [ -f "$file" ] || ffmpeg -hide_banner -loglevel error -f lavfi -i "sine=frequency=440:duration=5" "$file"
    # Leere Variablen gehen vor bots/erato/.env (das gilt dem echten Server)
    CHATTO_URL="$URL" CHATTO_API_KEY="$ERATO_API_KEY" CHATTO_ROOM_ID= ERATO_SOURCES= \
      ERATO_DM_USERS="${ERATO_DM_USERS:-alice}" exec node erato.mjs general "$file" ;;
  *) echo "unbekannt: $1 (pantheon oder erato)" >&2; exit 2 ;;
esac
