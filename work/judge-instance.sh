#!/usr/bin/env bash
# A throwaway copy of the product for judges, recordings and test runs: its own data, never posts to GitHub.
# Usage: work/judge-instance.sh [port=4318] [dist dir=web/dist]   (resets that copy to pristine and restarts it)
set -euo pipefail
cd "$(dirname "$0")/.."
PORT_=${1:-4318}
DIST_=${2:-}
J=/bulk2/runs/linearcodereview/judge-data-$PORT_
P=$(ss -ltnp 2>/dev/null | grep ":$PORT_ " | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1 || true)
[ -n "${P:-}" ] && kill "$P" && sleep 1
mkdir -p "$J"
rsync -a --delete data/ "$J/"
# decisions and the ledger come from the clean backup, so every run starts unsigned
for s in /bulk2/runs/linearcodereview/data-backup/dossiers/*/; do n=$(basename "$s"); [ -f "$s/dossier.json" ] && cp "$s/dossier.json" "$J/dossiers/$n/dossier.json"; rm -f "${J:?}/dossiers/${n:?}/reviews.json"; done
[ -f /bulk2/runs/linearcodereview/data-backup/ledger.jsonl ] && cp /bulk2/runs/linearcodereview/data-backup/ledger.jsonl "$J/ledger.jsonl"
(set -a; . work/server.env; set +a; unset CS_BASIC; export PORT=$PORT_ CS_DATA="$J" CS_NO_PUBLISH=1 CS_DEMO_SIGNERS=1 CS_LIVE_BUDGET=3000; [ -n "$DIST_" ] && export CS_DIST="$DIST_"; setsid nohup hsec exec --only GEMINI_API_KEY -- bun server/index.ts > "work/logs/judge-server-$PORT_.log" 2>&1 &)
sleep 3
curl -sf "localhost:$PORT_/api/live" >/dev/null && echo "instance up on :$PORT_"
