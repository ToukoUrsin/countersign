#!/usr/bin/env bash
set -u
set -o pipefail
n="$1"; base="$2"; head="$3"
export CS_DATA=/bulk2/runs/linearcodereview/backtest/data2
export CS_POLICY_FILE=/bulk2/runs/linearcodereview/backtest/src2/policy/messagepack.countersign.yml
export CS_NO_PUBLISH=1
export CS_BACKTEST_REQ=pr-text
export CS_BACKTEST_BASE_SHA="$base"
cd /bulk2/runs/linearcodereview/backtest/src2
hsec exec --only CLIPROXY_API_KEY -- bash -lc 'export ANTHROPIC_BASE_URL=http://127.0.0.1:8317; export ANTHROPIC_API_KEY="$CLIPROXY_API_KEY"; bun pipeline/review.ts "https://github.com/MessagePack-CSharp/MessagePack-CSharp/pull/'"$n"'" --no-publish' 2>&1 | tee "/bulk2/runs/linearcodereview/backtest/logs2/pr-$n.log"
rc=${PIPESTATUS[0]}
exit "$rc"
