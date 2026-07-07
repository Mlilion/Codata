#!/usr/bin/env bash
set -euo pipefail

bundle_dir="${1:-}"
identity="${2:-}"
entitlements="${3:-}"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "sign-macos-bundle.sh only runs on macOS." >&2
  exit 1
fi

if [ -z "$bundle_dir" ] || [ -z "$identity" ]; then
  echo "Usage: scripts/sign-macos-bundle.sh <bundle-dir> <developer-id-identity> [entitlements.plist]" >&2
  exit 1
fi

if [ ! -d "$bundle_dir" ]; then
  echo "Bundle directory does not exist: $bundle_dir" >&2
  exit 1
fi

if [ -n "$entitlements" ] && [ ! -f "$entitlements" ]; then
  echo "Entitlements file does not exist: $entitlements" >&2
  exit 1
fi

tmp_candidates="$(mktemp)"
trap 'rm -f "$tmp_candidates"' EXIT

find "$bundle_dir" -type f -print0 | while IFS= read -r -d '' file_path; do
  file_type="$(file -b "$file_path")"
  case "$file_type" in
    *Mach-O*)
      depth="${file_path//[^\/]/}"
      printf '%05d\t%s\n' "${#depth}" "$file_path" >> "$tmp_candidates"
      ;;
  esac
done

if [ ! -s "$tmp_candidates" ]; then
  echo "No Mach-O files found in $bundle_dir" >&2
  exit 1
fi

echo "Signing Mach-O files in $bundle_dir"
sort -rn "$tmp_candidates" | cut -f2- | while IFS= read -r file_path; do
  echo "Signing $file_path"
  codesign_args=(--force --options runtime --timestamp --sign "$identity")
  if [ -n "$entitlements" ]; then
    codesign_args+=(--entitlements "$entitlements")
  fi
  codesign "${codesign_args[@]}" "$file_path"
  codesign --verify --strict --verbose=2 "$file_path"
done

launcher="$bundle_dir/codata-backend"
if [ -f "$launcher" ]; then
  codesign --verify --deep --strict --verbose=2 "$launcher"
fi
