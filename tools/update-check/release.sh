#!/usr/bin/env bash
# Übernimmt den Stand aus upstream/ für <Version>: patches/ exportieren, CHATTO_VERSION setzen,
# auf fork committen und pushen (löst die GitHub-Action für das Image aus).
#   tools/update-check/release.sh <Version>
set -euo pipefail
NEW="${1:?usage: $0 <Version>}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
scripts/export-patches.sh "$NEW"
echo "$NEW" > CHATTO_VERSION
git add CHATTO_VERSION patches
git commit -q -m "Chatto $NEW, rebase patches" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -q origin fork
git log --oneline -1
