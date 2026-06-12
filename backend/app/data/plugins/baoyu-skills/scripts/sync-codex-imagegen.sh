#!/bin/bash
# Sync packages/baoyu-codex-imagegen/src/*.ts (excluding tests) into
# skills/baoyu-image-gen/scripts/codex-imagegen/ so the skill stays
# self-contained (no `../../../../packages/...` lookups at runtime).
#
# Run this whenever packages/baoyu-codex-imagegen/src/ changes,
# and always before tagging a release.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$REPO_ROOT/packages/baoyu-codex-imagegen/src"
DST_DIR="$REPO_ROOT/skills/baoyu-image-gen/scripts/codex-imagegen"

if [[ ! -d "$SRC_DIR" ]]; then
  echo "Error: source dir missing: $SRC_DIR" >&2
  exit 1
fi

mkdir -p "$DST_DIR"

changed=0
for f in cache.ts logger.ts main.ts parser.ts spawn.ts types.ts validator.ts; do
  src="$SRC_DIR/$f"
  dst="$DST_DIR/$f"
  if [[ ! -f "$src" ]]; then
    echo "Error: missing source file: $src" >&2
    exit 1
  fi
  if [[ ! -f "$dst" ]] || ! cmp -s "$src" "$dst"; then
    cp "$src" "$dst"
    echo "synced: $f"
    changed=$((changed + 1))
  fi
done

chmod +x "$DST_DIR/main.ts"

# Drop any stale .ts files in DST that don't exist in SRC.
for dst in "$DST_DIR"/*.ts; do
  [[ -e "$dst" ]] || continue
  name="$(basename "$dst")"
  case "$name" in
    *.test.ts) rm -f "$dst"; echo "removed test artifact: $name" ;;
    *)
      if [[ ! -f "$SRC_DIR/$name" ]]; then
        rm -f "$dst"
        echo "removed stale: $name"
        changed=$((changed + 1))
      fi
      ;;
  esac
done

if [[ "$changed" -eq 0 ]]; then
  echo "codex-imagegen sync: up to date"
else
  echo "codex-imagegen sync: $changed file(s) updated"
fi
