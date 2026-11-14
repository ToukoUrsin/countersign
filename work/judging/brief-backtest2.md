# Task: backtest round 2, so the skip rule is actually tested on merged history

You work alone, overnight, no human to ask. Decide everything yourself. Do not start subagents. Hard stop: final results written by **04:20 UTC** (check `date -u`). A smaller finished set beats a bigger unfinished one. Rewrite the summary after every finished run so an early stop still leaves valid data.

## Where things stand

`/home/ubuntu/junction/linearcodereview` is "Countersign" (hackathon project): an AI review pipeline that turns a GitHub pull request into a dossier and routes to a named human only the lines no executed check covers. A first backtest exists. Read these first, they tell you how everything works:

- `work/judging/brief-backtest.md` (the first backtest's task: method, scoring, rules; all its rules still apply unless changed below)
- `work/backtest/README.md`, `run_one.sh`, `aggregate.py`, `szz.py`, `collect_population.py`, `select.py`, `population.json`, `szz.json`, `selection.json`
- `data/backtest/summary.json` (the result so far)
- `pipeline/review.ts`, `pipeline/stages/intake.ts`, `pipeline/stages/route.ts`, `pipeline/lib/gh.ts`, `shared/gate.ts` (`fullReadReason`)

The first backtest's result is honest but proves little: 6 runs, 5 completed, 3 later-fixed ("escaped") changes, and **every** change was routed to a full read, because none of those merged pull requests names a requirement and the product's rule is "no requirement, no skip". So the rule that lets a person skip lines was never exercised, and the AI flagged 0 of the 3 later-fixed defects. Three hackathon judges scored Measurement 6 to 7 out of 10 and want to know one thing: **when the plan lets a person skip lines, do bugs hide in the skipped lines?**

## What to do

1. **Keep the strict result.** Copy `data/backtest/summary.json` to `data/backtest/summary-strict.json` and `results.jsonl` to `results-strict.jsonl` before anything else. Do not rerun it.
2. **New snapshot of today's pipeline.** rsync the current `pipeline/ server/ shared/ policy/ sandbox/ package.json bun.lock tsconfig.json` (symlink `node_modules`) into `/bulk2/runs/linearcodereview/backtest/src2/`. Re-apply the two compatibility changes the first snapshot has (see README: `CS_BACKTEST_BASE_SHA` in `pipeline/lib/gh.ts`, root-relative `sandbox/worktree.sh`, the policy file copy). Use a new empty data dir `/bulk2/runs/linearcodereview/backtest/data2` and log dir `logs2`. The pipeline now has more stages than the first snapshot (self-test v2 planted by GPT through the codex CLI, `audit` by GPT, `consistency`); they must all run, unchanged.
3. **One declared relaxation, in the snapshot only:** in `src2/pipeline/stages/intake.ts`, when no requirement is linked and `CS_BACKTEST_REQ=pr-text` is set, use the pull request's own title and description as the requirement (`id: 'PR-TEXT'`, title = PR title, body = PR title + body, sourceUrl = the PR url). In the product this never happens (the requirement must come from the tracker, never from the author's own prose); here it is the only way to let the skip rule run on history, and the result will be labelled as such. If a PR does link an issue, the normal path applies and the row records `requirementSource: "issue"`. Everything else in the pipeline stays exactly as it is. Never put anything about the future (the fix, its number, the label) where a pipeline agent can read it.
4. **Bigger population.** The first run considered 36 merged PRs (2025-06 to 2026-10) and found 14 eligible and 3 escaped. Extend the window back to 2024-01-01 with the same scripts and the same eligibility rule (source-touching, 10 to about 600 changed lines), rerun SZZ, and record considered / eligible / escaped counts. Then fix the run list before running anything: all escaped PRs, plus controls in seeded-shuffle order (seed 20261115, recorded), up to **30 runs in total** or what fits before the deadline, newest first within each group when you must cut. Old commits that do not build in the sandbox are a real outcome (nothing executed, full read), not something to drop. If commits before some date cannot even restore packages for an infrastructure reason, say so and stop going further back.
5. **Run** each with `CS_BACKTEST_REQ=pr-text`, `CS_NO_PUBLISH=1`, `--no-publish`, the snapshot policy file, the base sha as before. **At most 2 pipelines at once** (the model pool is shared with other work tonight and rate-limits with 503s); retry a failed run once after a pause. The earlier failure on #2310 was a sandbox restore problem: look at why and fix the infrastructure cause if it is ours.
6. **Score** exactly as the first brief says (caught / routed / skim / missed, strict model judgment for caught with a one-sentence reason). For every escaped row also record where the later-fixed lines sit in the plan: `fixedLinesIn: "read" | "skim" | "skip"` (worst case if they span several), and for `missed` rows one sentence on why the proof that earned the skip did not cover the defect. For every row record lines read / skim / skip, tier, whether the whole change was a full read and the reason, findings shown, self-test planted/caught if present, audit issues, estimated human minutes, wall minutes, cost.

## Output

`data/backtest/summary.json`, same schema as now (the UI reads it; keep every existing field valid), computed from the new runs, plus these new top-level fields:

```json
{
  "requirementSource": "pr-text",
  "relaxation": "one or two plain sentences: what was relaxed and why, and that the product itself would have demanded a full read",
  "strict": { "runs": 0, "completed": 0, "escapedPrs": 0, "caught": 0, "routed": 0, "missed": 0, "readFraction": 1.0, "note": "one sentence" },
  "escapedDetail": { "fixedLinesInRead": 0, "fixedLinesInSkim": 0, "fixedLinesInSkip": 0 },
  "skipExercised": { "prsWithSkippedLines": 0, "linesSkipped": 0, "linesSkimmed": 0 },
  "afterCutoff": { "prs": 0, "note": "how many of the runs were merged after June 2026, i.e. after the reviewing models' training data ends, so they cannot have been memorised" }
}
```

and per row the extra fields `requirementSource`, `fixedLinesIn` (escaped rows), `fullReadReason` (string or null). Also `results.jsonl` (one line per run) as before. Identify pull requests by number and title only; put no URLs of the upstream repository into `summary.json`.

`caveats` must be blunt and true: the relaxation; SZZ noise; sample size; one repository and stack; that findings differ between runs of the same commit; what could not be built.

Update `work/backtest/README.md` (how to re-run both variants) and extend `aggregate.py` (or add `aggregate2.py`) so the summary can be rebuilt from `data2`.

## Rules

- Never post, comment, push or open anything on any GitHub repository. Read-only `gh` only.
- The only main-project paths you may write: `data/backtest/` and `work/backtest/`. Do not touch `pipeline/`, `server/`, `shared/`, `web/`, `docs/`, `data/dossiers`, `data/ledger.jsonl`.
- Do not print or log secrets. Models run through the seat pool exactly as `run_one.sh` does it (`hsec exec --only CLIPROXY_API_KEY`).
- Report only numbers you measured. If bugs hid in skipped lines, that is the result and it must be in the summary.
- `rm` only literal paths.

## Final answer

Short: the numbers (runs, completed, failed; escaped: caught / routed / skim / missed and where the later-fixed lines sat; lines read / skim / skip; controls and findings per control), what you changed, the caveats, the paths.
