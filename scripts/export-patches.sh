#!/usr/bin/env bash
# Schreibt die Commits in upstream/ (seit dem Upstream-Tag) nach patches/ zurück.
# Bestehende Dateinamen bleiben erhalten (gleiche Nummer = gleicher Name).
#   scripts/export-patches.sh [Version]   Basis-Tag, Standard: Version aus CHATTO_VERSION
source "$(dirname "$0")/lib.sh"
need_upstream
BASE="v${1:-$VERSION}"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
git -C "$UPSTREAM" format-patch -q -N --zero-commit -o "$tmp" "$BASE..HEAD"
shopt -s nullglob
old=("$ROOT"/patches/*.patch)
rm -f "${old[@]}"
for f in "$tmp"/*.patch; do
  n="$(basename "$f" | cut -c1-4)"
  name="$(basename "$f")"
  for o in "${old[@]}"; do [[ "$(basename "$o")" == "$n-"* ]] && name="$(basename "$o")"; done
  cp "$f" "$ROOT/patches/$name"
  echo "patches/$name"
done
