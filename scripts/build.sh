#!/usr/bin/env bash
# Baut upstream/ (Frontend + Go-Binary mit Dev-Bootstrap) nach upstream/cli/bin/chatto.
#   scripts/build.sh [--check]   --check: zusätzlich svelte-check (Typen) nach dem Build
source "$(dirname "$0")/lib.sh"
need_upstream
cd "$UPSTREAM"
say "pnpm install"
# Ab pnpm 10 bricht `pnpm install` ohne TTY ab (Rückfrage zum Entfernen von node_modules).
# Ohne Terminal, also im Cron-Lauf oder in der CI, darum CI=true setzen.
[ -t 0 ] || export CI=true
pnpm install --frozen-lockfile >/dev/null
say "Frontend bauen"
CHATTO_BUILD_VERSION="${VERSION}-dev" pnpm run build:frontend
bash tools/prepare-embedded-frontend.sh apps/frontend/build cli/internal/http_server/.client
if [ "${1:-}" = "--check" ]; then
  say "svelte-check (erst nach dem Build sinnvoll)"
  (cd apps/frontend && pnpm exec svelte-check --threshold error)
fi
say "Go-Binary bauen"
mkdir -p cli/cmd/embedded
cp LICENSES/AGPL-3.0-or-later.txt cli/LICENSE
cp LICENSES/AGPL-3.0-or-later.txt cli/cmd/embedded/LICENSE
cp NOTICE cli/NOTICE
cp NOTICE cli/cmd/embedded/NOTICE
(cd cli && go build -trimpath -tags 'bootstrap nomsgpack' -ldflags "-w -X main.Version=${VERSION}-dev" -o bin/chatto .)
echo "upstream/cli/bin/chatto"
