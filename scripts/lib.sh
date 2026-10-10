# Gemeinsame Helfer für die Skripte in scripts/ (wird per `source` geladen).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM="$ROOT/upstream"
VERSION="${CHATTO_VERSION:-$(tr -d '[:space:]' < "$ROOT/CHATTO_VERSION")}"
UPSTREAM_URL="https://github.com/chattocorp/chatto.git"
PATCH_BRANCH="lizzard-patched"

# Node 24 und die pnpm-Version aus Upstreams mise.toml; sharp darf keine System-libvips nehmen.
export SHARP_IGNORE_GLOBAL_LIBVIPS=1
pnpm_version() {
  sed -n 's/^pnpm = "\(.*\)"/\1/p' "$UPSTREAM/mise.toml" | head -1
}
pnpm() {
  local v; v="$(pnpm_version)"
  if command -v fnm >/dev/null; then
    fnm exec --using=24 npx -y "pnpm@${v:-latest}" "$@"
  else
    npx -y "pnpm@${v:-latest}" "$@"
  fi
}

need_upstream() {
  [ -d "$UPSTREAM/.git" ] || [ -f "$UPSTREAM/.git" ] || {
    echo "upstream/ fehlt – erst scripts/upstream.sh ausführen" >&2; exit 1; }
}

say() { printf '\033[1m==> %s\033[0m\n' "$*"; }
