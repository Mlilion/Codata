#!/usr/bin/env bash
set -euo pipefail

artifact="${1:-}"
if [ -z "$artifact" ]; then
  echo "Usage: bash scripts/validate-macos-staple.sh <app-or-dmg>" >&2
  exit 2
fi

result="$(mktemp)"
trap 'rm -f "$result"' EXIT

max_attempts=5
for ((attempt = 1; attempt <= max_attempts; attempt++)); do
  status=0
  xcrun stapler validate "$artifact" >"$result" 2>&1 || status=$?
  cat "$result"
  if [ "$status" -eq 0 ]; then
    exit 0
  fi

  if ! grep -Eqi 'NSURLErrorDomain Code=-1005|network connection was lost|CloudKit.s response is inconsistent with expections|Error 68' "$result"; then
    echo "Staple validation failed (exit $status); error is not a recognized transient network failure." >&2
    exit "$status"
  fi

  if [ "$attempt" -eq "$max_attempts" ]; then
    echo "Staple validation failed after $max_attempts attempts (exit $status)." >&2
    exit "$status"
  fi

  echo "Apple ticket validation hit a transient network error (attempt $attempt/$max_attempts); retrying in 10 seconds." >&2
  sleep 10
done
