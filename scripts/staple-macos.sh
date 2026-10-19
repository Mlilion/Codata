#!/usr/bin/env bash
set -euo pipefail

artifact="${1:-}"
if [ "$#" -ne 1 ] || { [ ! -f "$artifact" ] && [ ! -d "$artifact" ]; }; then
  echo "Usage: bash scripts/staple-macos.sh <existing-app-or-dmg>" >&2
  exit 2
fi

result="$(mktemp)"
trap 'rm -f "$result"' EXIT

retry_stapler() {
  local operation="$1"
  local max_attempts=6
  local attempt status
  local delay=10
  for ((attempt = 1; attempt <= max_attempts; attempt++)); do
    echo "stapler $operation: $artifact (attempt $attempt/$max_attempts)"
    status=0
    xcrun stapler "$operation" "$artifact" >"$result" 2>&1 || status=$?
    cat "$result"
    if [ "$status" -eq 0 ]; then
      return 0
    fi

    # Error 68 also covers unnotarized artifacts; require explicit network evidence.
    if ! grep -Eqi 'NSURLErrorDomain Code=-(1001|1003|1004|1005|1006|1009)([^0-9]|$)|The network connection was lost' "$result"; then
      echo "stapler $operation failed (exit $status); not a recognized transient network failure." >&2
      return "$status"
    fi

    if [ "$attempt" -eq "$max_attempts" ]; then
      echo "stapler $operation failed after $max_attempts attempts (exit $status)." >&2
      return "$status"
    fi

    echo "stapler $operation hit a transient network error; retrying in $delay seconds." >&2
    sleep "$delay"
    delay=$((delay * 2))
    if [ "$delay" -gt 60 ]; then
      delay=60
    fi
  done
}

retry_stapler staple
retry_stapler validate
