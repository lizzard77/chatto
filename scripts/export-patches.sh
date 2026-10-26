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
subject() { awk '/^Subject:/ { s = $0; while ((getline l) > 0 && l ~ /^ /) s = s l; print s; exit }' "$1"; }
old=("$ROOT"/patches/*.patch)
declare -A old_subject
for o in "${old[@]}"; do old_subject["$(basename "$o")"]="$(subject "$o")"; done
rm -f "${old[@]}"
for f in "$tmp"/*.patch; do
  n="$(basename "$f" | cut -c1-4)"
  name="$(basename "$f")"
  # Zuerst über den Subject zuordnen: fällt ein Patch weg (upstream gefixt), behalten
  # die übrigen ihren Namen statt den des Vorgängers zu erben. Sonst über die Nummer.
  s="$(subject "$f")"; match=""
  for o in "${!old_subject[@]}"; do [[ "${old_subject[$o]}" == "$s" ]] && match="$o"; done
  if [ -z "$match" ]; then
    for o in "${!old_subject[@]}"; do [[ "$o" == "$n-"* ]] && match="$o"; done
  fi
  [ -n "$match" ] && name="$match"
  cp "$f" "$ROOT/patches/$name"
  echo "patches/$name"
done
