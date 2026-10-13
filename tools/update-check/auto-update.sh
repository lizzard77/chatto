#!/usr/bin/env bash
# Täglicher Chatto-Update-Check, deterministischer Teil. Läuft als Pre-run-Skript des Hermes-Cron-Jobs
# `chatto-update` (siehe README.md), funktioniert aber genauso lokal.
#
# Keine neue Upstream-Version (oder schon einmal versucht) → letzte Zeile {"wakeAgent": false}, Hermes bleibt still.
# Sonst: Patches rebasen → Build + svelte-check → patches/ + CHATTO_VERSION committen und pushen →
# GitHub-Action abwarten → Image-Tag in selfhosted-services bumpen. Die Ausgabe ist ein Bericht
# (STATUS: done | conflict | build-failed | …), mit dem der Agent die Nachricht schreibt oder weiterarbeitet.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/chatto-update-check"
mkdir -p "$STATE"
cd "$ROOT" || exit 1
export GIT_AUTHOR_NAME="Phil Reif" GIT_AUTHOR_EMAIL="pr@sambal.net"
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME" GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"

# SemVer-Sortierschlüssel: X.Y.Z-beta.N < X.Y.Z-rc.N < X.Y.Z (alpha und Sonstiges fliegen raus)
semkey() {
  sed -E -n 's/^([0-9]+\.[0-9]+\.[0-9]+)-beta\.([0-9]+)$/\1.1.\2/p; s/^([0-9]+\.[0-9]+\.[0-9]+)-rc\.([0-9]+)$/\1.2.\2/p; s/^([0-9]+\.[0-9]+\.[0-9]+)$/\1.3.0/p'
}
latest_upstream() {
  git ls-remote --tags --refs https://github.com/chattocorp/chatto.git 'v*' \
    | sed 's#.*refs/tags/v##' \
    | while read -r v; do k="$(semkey <<<"$v")"; [ -n "$k" ] && echo "$k $v"; done \
    | sort -V -k1,1 | tail -1 | cut -d' ' -f2
}
newer() { [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$(semkey <<<"$1")" "$(semkey <<<"$2")" | sort -V | tail -1)" = "$(semkey <<<"$1")" ]; }

OLD="$(tr -d '[:space:]' < CHATTO_VERSION)"
NEW="$(latest_upstream)"
quiet() { echo '{"wakeAgent": false}'; exit 0; }
[ -n "$NEW" ] || { echo "STATUS: precondition-failed"; echo "Upstream-Tags nicht abrufbar (git ls-remote)."; exit 0; }
newer "$NEW" "$OLD" || quiet
# Pro Version nur ein automatischer Versuch; erneut: Datei löschen
MARK="$STATE/attempted-$NEW"
[ -e "$MARK" ] && quiet
date -Is > "$MARK"

LOG="$STATE/$NEW.log"
: > "$LOG"
report() {
  echo "STATUS: $1"
  echo "OLD: $OLD"
  echo "NEW: $NEW"
  echo "REPO: $ROOT"
  echo "LOG: $LOG"
  [ -n "${2:-}" ] && printf '%s\n' "$2"
  exit 0
}
step() { printf '\n===== %s\n' "$*" >> "$LOG"; }

step "Vorbedingungen"
[ "$(git rev-parse --abbrev-ref HEAD)" = fork ] || report precondition-failed "Branch ist nicht fork."
[ -z "$(git status --porcelain)" ] || report precondition-failed "Arbeitsverzeichnis nicht sauber: $(git status --porcelain | head -5)"
git pull -q --ff-only >> "$LOG" 2>&1 || report precondition-failed "git pull --ff-only fehlgeschlagen: $(tail -5 "$LOG")"
OLD="$(tr -d '[:space:]' < CHATTO_VERSION)"
newer "$NEW" "$OLD" || quiet

step "scripts/upstream.sh $NEW"
if ! scripts/upstream.sh "$NEW" >> "$LOG" 2>&1; then
  report conflict "git am in upstream/ ist stehen geblieben:
$(tail -30 "$LOG")
--- git -C upstream status --short:
$(git -C upstream status --short 2>&1 | head -40)"
fi
THREEWAY="$(grep -c 'Falling back to patching base and 3-way merge' "$LOG")"

step "scripts/build.sh --check"
if ! CHATTO_VERSION="$NEW" scripts/build.sh --check >> "$LOG" 2>&1; then
  report build-failed "Build oder svelte-check fehlgeschlagen (Ende des Logs):
$(tail -60 "$LOG")"
fi

step "release.sh $NEW"
"$HERE/release.sh" "$NEW" >> "$LOG" 2>&1 || report push-failed "$(tail -20 "$LOG")"
SHA="$(git rev-parse HEAD)"

step "wait-build.sh $SHA"
"$HERE/wait-build.sh" "$SHA" 2700 >> "$LOG" 2>&1
case $? in
  0) ;;
  2) report action-pending "Image-Build für ${SHA:0:9} nach 45 min nicht fertig. $(tail -3 "$LOG")" ;;
  *) report action-failed "Image-Build für ${SHA:0:9} fehlgeschlagen: $(tail -5 "$LOG")" ;;
esac

step "bump-compose.sh $NEW"
"$HERE/bump-compose.sh" "$NEW" >> "$LOG" 2>&1 || report compose-failed "Image ist gebaut, aber der Compose-Bump scheiterte: $(tail -10 "$LOG")"

PROTO="$(git -C upstream diff --stat "v$OLD" "v$NEW" -- proto/chatto/realtime proto/chatto/api/v1/messages.proto proto/chatto/api/v1/viewer.proto 2>&1)"
report done "COMMIT: ${SHA:0:9}
PATCHES_3WAY: $THREEWAY (Patches, die nur per 3-way-Merge passten)
PATCH_DIFF (Änderungen an patches/ ohne Index-/Offset-Rauschen):
$(git show "$SHA" -- patches | grep -E '^[+-][^+-]' | grep -vE '^[+-](index |@@|From [0-9a-f]{40})' | head -60)
PROTO_DIFF:
${PROTO:-keine}"
