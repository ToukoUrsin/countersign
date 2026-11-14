#!/usr/bin/env bash
# Restart a throwaway copy on new server code WITHOUT resetting its data. Usage: work/restart-instance.sh <port>
set -euo pipefail
cd "$(dirname "$0")/.."
PORT_=${1:?port}
J=/bulk2/runs/linearcodereview/judge-data-$PORT_
P=$(ss -ltnp 2>/dev/null | grep ":$PORT_ " | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1 || true)
DIST_=""
[ -n "${P:-}" ] && DIST_=$(tr '\0' '\n' < /proc/$P/environ | sed -n 's/^CS_DIST=//p') && kill "$P" && sleep 1
(set -a; . work/server.env; set +a; unset CS_BASIC; export PORT=$PORT_ CS_DATA="$J" CS_NO_PUBLISH=1 CS_DEMO_SIGNERS=1 CS_LIVE_BUDGET=3000; [ -n "$DIST_" ] && export CS_DIST="$DIST_"; setsid nohup hsec exec --only GEMINI_API_KEY -- bun server/index.ts >> "work/logs/judge-server-$PORT_.log" 2>&1 &)
sleep 3
curl -sf "localhost:$PORT_/api/live" >/dev/null && echo "instance up on :$PORT_"
