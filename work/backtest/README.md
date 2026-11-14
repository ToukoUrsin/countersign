# Countersign merged-history backtest

This run used `collect_population.py` to query merged PR metadata, `szz.py` to blame later fix diffs, and `selection.json` (seed `20261114`) to fix the sample before execution. `run_one.sh` runs the real `pipeline/review.ts` from the immutable snapshot at `/bulk2/runs/linearcodereview/backtest/src`; it sets `CS_DATA`, `CS_POLICY_FILE`, `CS_NO_PUBLISH=1`, and uses the seat pool through `hsec exec --only CLIPROXY_API_KEY`.

The snapshot has one merged-history compatibility change in `pipeline/lib/gh.ts`: `CS_BACKTEST_BASE_SHA` supplies the PR's merge-time base SHA and skips fetching a deleted base branch (PR 2273's `develop`). `sandbox/worktree.sh` was made root-relative so snapshot worktrees are accepted. No main pipeline files were changed. The snapshot repository is `/bulk2/runs/linearcodereview/backtest/repo`.

To rerun a selected row, use `./work/backtest/run_one.sh <pr> <baseRefOid> <headRefOid>` after preparing the snapshot and empty data directory. `aggregate.py` rewrites `data/backtest/summary.json` and `results.jsonl` atomically from completed dossiers; the full dossiers and evidence remain under `/bulk2/runs/linearcodereview/backtest/data`.
