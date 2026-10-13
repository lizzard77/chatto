#!/usr/bin/env bash
# Setzt in selfhosted-services/he1/chatto/docker-compose.yml das Image auf ghcr.io/lizzard77/chatto:<Version>,
# committet und pusht auf main. Deployt nicht – pull/up -d auf he1 bleibt manuell.
#   tools/update-check/bump-compose.sh <Version>
# Repo-Pfad: $SELFHOSTED_DIR, Standard ist das Nachbarverzeichnis dieses Repos.
set -euo pipefail
NEW="${1:?usage: $0 <Version>}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIR="${SELFHOSTED_DIR:-$(dirname "$ROOT")/selfhosted-services}"
FILE=he1/chatto/docker-compose.yml
cd "$DIR"
git pull -q --ff-only
grep -q 'image: ghcr.io/lizzard77/chatto:' "$FILE" || { echo "kein chatto-Image in $FILE" >&2; exit 1; }
sed -i -E "s#(image: ghcr.io/lizzard77/chatto):[^[:space:]]+#\1:$NEW#" "$FILE"
if git diff --quiet -- "$FILE"; then echo "$FILE steht schon auf $NEW"; exit 0; fi
git add "$FILE"
git commit -q -m "Chatto $NEW" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -q origin HEAD
git log --oneline -1
