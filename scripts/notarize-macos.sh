#!/usr/bin/env bash
set -euo pipefail

artifact="${1:-}"
if [ -z "$artifact" ] || [ ! -f "$artifact" ]; then
  echo "Usage: bash scripts/notarize-macos.sh <zip-or-dmg-file>" >&2
  exit 1
fi

if [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_PASSWORD:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ]; then
  credentials=(--apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID")
elif [ -n "${APPLE_API_ISSUER:-}" ] && [ -n "${APPLE_API_KEY:-}" ] && [ -f "${APPLE_API_KEY_PATH:-}" ]; then
  credentials=(--key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER")
else
  echo "Apple ID or App Store Connect API credentials are required for notarization." >&2
  exit 1
fi

result="$(mktemp)"
trap 'rm -f "$result"' EXIT
submit_status=0
xcrun notarytool submit "$artifact" "${credentials[@]}" --wait --output-format json > "$result" || submit_status=$?
cat "$result"
if [ "$submit_status" -ne 0 ]; then
  echo "Notarization submission failed (exit $submit_status)." >&2
  exit "$submit_status"
fi

status="$(node -e 'const r=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")); if(typeof r.status!=="string") throw new Error("Missing notarization status"); console.log(r.status)' "$result")"
if [ "$status" != "Accepted" ]; then
  submission_id="$(node -e 'const r=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")); if(typeof r.id!=="string" || !r.id) throw new Error("Missing notarization submission ID"); console.log(r.id)' "$result")"
  echo "Notarization rejected: $status (submission $submission_id)." >&2
  xcrun notarytool log "$submission_id" "${credentials[@]}"
  exit 1
fi
