#!/usr/bin/env bash
set -u
set -o pipefail
n="$1"; base="$2"; head="$3"
export n base head
export CS_DATA=/bulk2/runs/linearcodereview/backtest/data
export CS_POLICY_FILE=/bulk2/runs/linearcodereview/backtest/src/messagepack.countersign.yml
export CS_NO_PUBLISH=1
export CS_BACKTEST_BASE_SHA="$base"
cd /bulk2/runs/linearcodereview/backtest/src
hsec exec --only CLIPROXY_API_KEY -- bash -lc 'export ANTHROPIC_BASE_URL=http://127.0.0.1:8317; export ANTHROPIC_API_KEY="$CLIPROXY_API_KEY"; bun pipeline/review.ts "https://github.com/MessagePack-CSharp/MessagePack-CSharp/pull/$n" --no-publish' 2>&1 | tee "/bulk2/runs/linearcodereview/backtest/logs/pr-$n.log"
rc=${PIPESTATUS[0]}
flock /tmp/countersign-backtest-aggregate.lock python3 /home/ubuntu/junction/linearcodereview/work/backtest/aggregate.py >/bulk2/runs/linearcodereview/backtest/logs/aggregate-$n.log 2>&1 || true
exit "$rc"
