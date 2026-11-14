# Task: backtest Countersign on merged history (real outcome data)

You work alone, overnight, no human to ask. Decide everything yourself. Do not start subagents. Hard stop: have final results written by **03:05 UTC** (check `date -u`); a smaller finished set beats a bigger unfinished one. Write partial results as you go so an early stop still leaves usable data.

## Background

`/home/ubuntu/junction/linearcodereview` is "Countersign", a hackathon project (Junction 2026, Tieto challenge "Earned Trust in AI Code"): an AI review pipeline that turns a GitHub pull request into a dossier and routes to a named human only the lines no executed check covers. Read `docs/CONCEPT.md` (10 min) and `pipeline/review.ts` + `pipeline/stages/route.ts` + `pipeline/lib/gh.ts` + `pipeline/stages/intake.ts` so you know what a run produces (`data/dossiers/<slug>/dossier.json`, type in `shared/dossier.ts`).

Three hackathon judges scored its Measurement criterion 6-7/10 for the same reason: every outcome number is synthetic. They all asked for the same fix: "Run Countersign on 30 to 50 already-merged pull requests whose later reverts or bug-fix commits are known, and report how many escapes it would have caught or routed to a person." That is this task. The number must be real and honest, including the misses.

## What to build

A backtest on the public merged history of the open-source project the sample repository is a copy of (MessagePack-CSharp/MessagePack-CSharp on GitHub; a clone with history is under `work/repos/`, or clone it yourself into your scratch dir).

1. **Label escapes with SZZ.** Find bug-fix commits/PRs on the default branch (title or linked issue says fix / bug / regression; use `gh` read-only on the public repo for titles, labels and linked issues). For each fix, `git blame` the lines it deleted or changed, at the fix's parent, back to the commit that introduced them. If that commit belongs to an earlier merged PR X (and X is not itself the fix, and the lines are in `src/**`, not tests/docs), then X is an **escaped** PR: it was approved by humans, merged, and those lines later needed a bug fix. Keep the fix PR, days between, and the exact later-fixed lines mapped to X's head (path + line numbers in X's version).
2. **Pick the sample.** Recent PRs only (roughly the 18 months before the sample repo's base commit, so the .NET build works in our sandbox: see `policy/messagepack.countersign.yml` and `sandbox/`). Source-touching, 10 to ~600 changed lines. Target 12 escaped + 12 controls (merged PRs in the same period and size range for which SZZ finds no later fix). If time is short: fewer, but keep both groups. Record how many merged PRs you considered and how many were eligible, so the selection is auditable. Do not cherry-pick by outcome: fix the list (seeded shuffle, record the seed) before running anything.
3. **Run the real pipeline on each PR as it was at merge time.** No shortcuts and no special-casing: the same code path as the four samples.
   - Work from a **snapshot copy** of the project so other people's edits to `pipeline/` during the night do not change your runs: rsync `pipeline/ server/ shared/ policy/ sandbox/ package.json bun.lock tsconfig.json node_modules` (symlink node_modules) into `/bulk2/runs/linearcodereview/backtest/src/` and run from there.
   - `CS_DATA=/bulk2/runs/linearcodereview/backtest/data` (an empty ledger: no synthetic trust history may help a skip), `CS_POLICY_FILE=<snapshot>/policy/messagepack.countersign.yml`, and **`--no-publish` plus `CS_NO_PUBLISH=1` on every run. Nothing may ever be posted, commented or pushed to any GitHub repository. Read-only use of `gh` only.** Check the publish stage honours this before the first run.
   - `prepareRepo` in `pipeline/lib/gh.ts` assumes an open PR against the live base branch. A merged PR needs the base as it was (the PR's `base.sha` / the merge commit's first parent), otherwise the diff is empty or wrong. Make the smallest change in your snapshot that handles this (e.g. an env var for the base sha) and say what you changed.
   - The requirement: the PR's linked issue (`Fixes #N` etc.; intake has a fallback pattern). No linked issue is a legitimate result: the pipeline then demands a full read, count it as such.
   - The agents inside the pipeline must not see the future: they only get the worktree at the PR's head. Never put the fix, the fix PR number or the label into anything a pipeline agent reads.
   - Models run through the `claude` CLI on a shared pool that rate-limits (503 `auth_unavailable` / `rate_limit_error`). Run at most 3 pipelines at once, retry a failed run once after a pause, and if the pool is saturated drop to 2. A run takes about 7-10 minutes. Old commits that do not build are a real outcome ("nothing executed, full read"), not a failure to hide; infrastructure failures (rate limit, timeout) are `failed` and reported.
4. **Score each escaped PR** against its later-fixed lines, mechanically where possible:
   - `caught`: a finding the dossier *shows the human* (not a killed one) names the defect: same file, lines overlapping or adjacent to the later-fixed lines, and the description matches what the fix corrects. Use a strict model judgment given the finding text and the fix diff, and keep the judge's one-sentence reason. Near misses are not caught.
   - `routed`: not caught, but the later-fixed lines sit in a unit the plan asks the human to **read** (or the whole change is full-read).
   - `skim`: the lines are in a skim unit only.
   - `missed`: the plan let the human skip those lines and no shown finding named the bug. These are the escapes of the skip rule. Report every one with a sentence on why the proof did not cover it.
5. **Controls**: tier, lines read/skim/skip, findings shown (a false-alarm proxy), estimated human minutes.

## Output (exact paths and schema; a UI is being built against it in parallel)

`/home/ubuntu/junction/linearcodereview/data/backtest/summary.json`:

```json
{
  "generatedAt": "ISO time",
  "method": "3-5 plain sentences: population, how escapes were labelled, how runs were scored",
  "population": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD", "mergedPrsConsidered": 0, "eligible": 0, "seed": 0 },
  "runs": 0, "completed": 0, "failed": 0,
  "escaped": { "prs": 0, "caught": 0, "routed": 0, "skim": 0, "missed": 0, "fullRead": 0 },
  "controls": { "prs": 0, "findingsShown": 0, "findingsPerPr": 0 },
  "lines": { "total": 0, "read": 0, "skim": 0, "skip": 0 },
  "readFraction": 0.0,
  "medianEstMinutes": 0, "medianWallMinutes": 0, "totalCostUsd": 0,
  "caveats": ["one sentence each, blunt"],
  "rows": [
    { "pr": 0, "title": "", "mergedAt": "YYYY-MM-DD", "kind": "escaped|control",
      "fix": { "pr": 0, "title": "", "daysLater": 0, "lines": [{ "path": "", "line": 0 }] },
      "tier": "T0|T1|T2|T3", "lines": { "total": 0, "read": 0, "skim": 0, "skip": 0 },
      "findingsShown": 0, "outcome": "caught|routed|skim|missed|full-read|clean|failed",
      "why": "one plain sentence", "estMinutes": 0, "wallMinutes": 0, "costUsd": 0 }
  ]
}
```

`fix` only on escaped rows; controls get outcome `clean` (or `full-read` / `failed`). `escaped.fullRead` counts escaped PRs where the pipeline demanded a full read (they also count as routed). Also write one line per run to `data/backtest/results.jsonl` as each run finishes, and rewrite `summary.json` after every finished run (so a partial file is always valid). Keep the full dossiers and evidence under `/bulk2/runs/linearcodereview/backtest/data` and put your scripts in `/home/ubuntu/junction/linearcodereview/work/backtest/` with a short README on how to re-run.

Caveats that must be in `caveats` if true: the models may have seen these PRs and their fixes in training (so detection is an upper bound); SZZ labels are noisy (a later change to a line is not always a bug in it); sample size; one repository and stack; selection limits.

## Rules

- Never post, comment, push or open anything on any GitHub repository. Never touch `data/dossiers`, `data/ledger.jsonl` or anything under `web/`, `server/`, `docs/` in the main project. The only main-project paths you write are `data/backtest/` and `work/backtest/`.
- Do not print or log secrets. The GitHub CLI is already signed in.
- Do not report numbers you did not measure. If the backtest shows the pipeline missing bugs, that is the result.

## Final answer

Three short paragraphs: the numbers (escaped: caught / routed / skim / missed; controls; read fraction; runs completed and failed), what you had to change to run merged PRs, and the caveats. Then the paths.
