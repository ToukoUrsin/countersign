# Task: add a fifth sample pull request that honestly needs almost nothing from a human

You work alone, overnight, no human to ask. Do not start subagents. Deadline: **02:00 UTC** (check `date -u`).

## Background

`/home/ubuntu/junction/linearcodereview` is "Countersign" (Junction 2026, Tieto challenge "Earned Trust in AI Code"): a pipeline turns a GitHub pull request written by a coding agent into a dossier and routes to a named human only the lines no executed check covers. Read `docs/CONCEPT.md` and `policy/default.yml` + `policy/messagepack.countersign.yml` (the points table: tiers T0 skip, T1 skim, T2/T3 read).

The four sample PRs (`ToukoUrsin/junction26-messagepack-csharp` #1 to #4, our private copy of the challenge's sample repository) all land in the top tier T3. Judges said: "show one example of a PR that needs almost nothing from a person" and "demonstrate a fresh PR end to end". That is this task.

## What to do

1. Look at PRs #1 to #4 with `gh pr view N -R ToukoUrsin/junction26-messagepack-csharp` (title, body, branch naming, how the requirement is named: `REQ-<upstream issue number>`; requirements are fetched from the public issue tracker named in `policy/messagepack.countersign.yml`). Mimic their form exactly.
2. Pick a real, small, open or recently closed issue from that public tracker that a careful agent can fix in a low-risk way: an analyzer message or diagnostic detail, a small bug with an obvious test, or documentation. Not the runtime core (`src/MessagePack/**` is security-sensitive and always read), not public API. Read-only use of `gh` on the public tracker.
3. In your own clone of `ToukoUrsin/junction26-messagepack-csharp` (clone into `/bulk2/runs/linearcodereview/light-pr/`), branch `ju26-issue-<N>` from `main`, write the fix as a careful coding agent would: minimal, with a test that fails on base and passes on head where the change is code. Build and run the relevant tests in the project's sandbox (`sandbox/run-tests.sh`, see how `pipeline/lib/sandbox.ts` calls it) before pushing. Push the branch and open PR #5 against `main` of **our copy only** with a body in the same form as #1 to #4. Plain text only: no links or `owner/repo#N` references to any other repository, and never post, comment or push anywhere else.
4. Run the pipeline on it, the same way the others were run (see `work/logs`, `pipeline/review.ts`): `cd /home/ubuntu/junction/linearcodereview && set -a && . work/server.env && set +a && bun pipeline/review.ts https://github.com/ToukoUrsin/junction26-messagepack-csharp/pull/5`. It takes 7-10 minutes and posts its comment and a pending status on PR #5, which is intended. Models run on a shared pool that sometimes returns 503 rate-limit errors: retry after a pause.
5. Read the dossier (`data/dossiers/toukoursin__junction26-messagepack-csharp__5/dossier.json`). The goal is an honest light review: tier T0 or T1, a handful of lines (or none) to read, a minute or two of human time. **Do not touch the policy, the pipeline or the dossier to get there.** If it lands at T2/T3, say why (which points), and if the reason is that the change itself is riskier than intended, make one more attempt with a different, smaller change (new branch, close the old PR with a one-line comment, the new one becomes the sample). If the pipeline finds a real bug in your change, that is a fine result too: leave it.

## Rules
- Only write inside `/bulk2/runs/linearcodereview/light-pr/` and whatever the pipeline itself writes under `data/`. Do not edit project files.
- Do not print secrets. `gh` is already signed in.

## Final answer
PR URL, the requirement, what changed (files, lines), and the dossier's outcome: tier, lines read/skim/skip, estimated minutes, findings, decisions, verdict, wall-clock and cost. One paragraph, blunt.
