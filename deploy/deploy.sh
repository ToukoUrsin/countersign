#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
APP=${FLY_APP:-countersign-demo}
./deploy/refresh-demo-data.sh
hsec exec --only GEMINI_API_KEY,FLY_API_TOKEN -- sh -c 'flyctl secrets set GEMINI_API_KEY="$GEMINI_API_KEY" --app "$1"' sh "$APP"
hsec exec --only FLY_API_TOKEN -- flyctl deploy --app "$APP" --config deploy/fly.toml
URL="https://${APP}.fly.dev"
curl --fail --silent --show-error "$URL/api/live" >/dev/null
curl --fail --silent --show-error "$URL/api/dossiers" >/dev/null
echo "$URL"
