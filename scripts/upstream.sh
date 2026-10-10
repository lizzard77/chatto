#!/usr/bin/env bash
# Checkt den Upstream-Quellcode von Chatto in upstream/ aus (git worktree, Branch
# lizzard-patched) und wendet patches/*.patch als Commits an.
#
#   scripts/upstream.sh                  Version aus CHATTO_VERSION
#   scripts/upstream.sh 0.5.0-beta.13    andere Version (z. B. zum Rebasen auf ein Update)
#
# Dann in upstream/ entwickeln, committen und mit scripts/export-patches.sh zurückschreiben.
# Konflikte beim Anwenden: in upstream/ lösen, `git am --continue`, danach export-patches.sh.
source "$(dirname "$0")/lib.sh"
TARGET="${1:-$VERSION}"

cd "$ROOT"
git remote get-url upstream >/dev/null 2>&1 || git remote add upstream "$UPSTREAM_URL"
say "Tags v$TARGET und v$VERSION holen"
git fetch -q upstream tag "v$TARGET" --no-tags
[ "$TARGET" = "$VERSION" ] || git fetch -q upstream tag "v$VERSION" --no-tags

if [ -e "$UPSTREAM/.git" ]; then
  if [ -n "$(git -C "$UPSTREAM" status --porcelain --untracked-files=no)" ]; then
    echo "upstream/ hat uncommittete Änderungen – erst committen/exportieren oder verwerfen" >&2
    exit 1
  fi
  git -C "$UPSTREAM" am --abort >/dev/null 2>&1 || true
  git -C "$UPSTREAM" checkout -q -B "$PATCH_BRANCH" "v$TARGET"
else
  say "Worktree upstream/ anlegen"
  git worktree add -q -B "$PATCH_BRANCH" "$UPSTREAM" "v$TARGET"
fi

say "Patches auf v$TARGET anwenden"
git -C "$UPSTREAM" am --3way "$ROOT"/patches/*.patch
git -C "$UPSTREAM" log --oneline "v$TARGET..HEAD"
[ "$TARGET" = "$VERSION" ] || echo "Hinweis: CHATTO_VERSION steht noch auf $VERSION – nach erfolgreichem Check auf $TARGET setzen."
