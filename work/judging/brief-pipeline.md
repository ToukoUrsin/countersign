# Task: harden the Countersign review pipeline where the judges found it weak

You work alone, overnight, no human to ask. Decide everything yourself. Do not start subagents. Deadline: everything rerun and verified by **02:50 UTC** (check `date -u`). Do the items in order; a finished earlier item beats a half-done later one.

## Background

`/home/ubuntu/junction/linearcodereview` is "Countersign" (Junction 2026, Tieto challenge "Earned Trust in AI Code"): a pipeline (`pipeline/review.ts`, stages in `pipeline/stages/`, agents run through the `claude` CLI in `pipeline/lib/agent.ts`) turns a GitHub pull request into a dossier (`data/dossiers/<slug>/dossier.json`, type in `shared/dossier.ts`); a server (`server/`) and web UI (`web/`) show it; a named human signs. Read `docs/CONCEPT.md`, then the pipeline code, then one dossier, before changing anything. Round-1 judge verdicts are in `/bulk2/runs/linearcodereview/judging/r1/verdicts/{sol,opus,fable}.md`; read the "BROKEN OR UNCONVINCING" and "WHAT WOULD MOVE EACH SCORE" sections.

Four sample PRs are reviewed: `ToukoUrsin/junction26-messagepack-csharp` #1 to #4 (private copy of the challenge's sample repository). A fifth (#5, a small low-risk change) is being added by someone else during your work; include it in your reruns if `data/dossiers/toukoursin__junction26-messagepack-csharp__5` exists by then.

Run: `cd /home/ubuntu/junction/linearcodereview && set -a && . work/server.env && set +a && bun pipeline/review.ts <PR url> --fresh <stage,...>` (look at how `work/` scripts and `work/logs` ran it before; stage outputs are cached, `--fresh` reruns the named stages and what depends on them). Publishing updates the comment and the pending status on our own private PRs, which is fine. **Never post to any other repository.** Models run on a shared pool that rate-limits (503 `auth_unavailable` / `rate_limit_error`): at most 2 pipeline runs at once, retry after a pause.

## Items, in priority order

### 1. The signed lists must not contradict themselves (judges: Fable, Sol)
Judge findings, all real:
- PR #1 lists "AC3 proven by execution: app.dll contains a GeneratedMessagePackResolver" under checked-by-AI and "Real two-project build and resolver present in app.dll: No build was run" under not-checked. Same claim on both sides.
- PR #4 not-checked list says "About 400 updated snapshot files... about 218 in cluster C1"; the PR has 237 files and a cluster of 222. A model invented numbers in a list a human signs.
- PR #4: AC1 is marked violated, yet the first evidence shown for it reads "an independently written test for AC1 fails on base and passes on the PR head".
- PR #4: 130 test lines are skipped because "bodies need no line-by-line read" while finding FN4 on the same PR says those tests "check text only, never compiled". A shown finding that says a unit's tests are weak must cancel any skip that rests on those tests (route it to skim or read) and the reason must say so.
- A pipeline artefact ("Tests were removed from the worktree on purpose") appears in the not-checked list.
- Copy: "1 file differ and are listed as exceptions", "a second agent agent".
Fix the causes in the pipeline (prompts, consolidate, route), and add a deterministic **consistency stage** at the end that (a) rejects or rewrites a not-checked item that contradicts a checked claim or an evidence record, (b) replaces counts in not-checked items with numbers computed from the dossier (files, cluster sizes, lines) or drops the number, (c) drops internal pipeline notes from human-facing lists, (d) records what it changed in the dossier (`consistency: { fixed: [...] }`) so it is visible. Model help is fine for (a) but the numbers must be computed.

### 2. Decisions must know what the code does (judges: Fable, Opus)
For every refused decision (`refusals` in the dossier) record which option, if any, the PR head currently implements: add `implemented?: boolean` to the option type in `shared/dossier.ts` and set it from an agent that reads the code, with a one-line `implementedWhy` citing file:line. The server will use it: choosing an option the code does not implement can then no longer be signed as a plain accept. Also make the pipeline's advice stricter: when a shown finding of severity major or blocker was reproduced by a failing test, the verdict must not be an "accept" variant; find where the verdict is computed and make it `request-changes`-flavoured with the reason (keep the type's existing verdict names if one fits; otherwise add one and tell me).

### 3. A harder self-test, planted by a different model family (all three judges)
Today (`pipeline/stages/selftest.ts`): 4 single-line bugs per PR, planted by a Claude model, counted as caught when a finding lands within 3 lines. 16 of 16 caught looks too easy. Change it:
- Plant with a **different model family**: GPT through the Codex CLI (`codex exec`, already signed in on this box; find the non-interactive flags with `codex exec --help`; read-only sandbox, JSON out; model `gpt-6.1-sol`). If Codex cannot be made to work in 15 minutes, use Gemini (`GEMINI_API_KEY` is injected with `hsec exec --only GEMINI_API_KEY -- <cmd>`; never print it; see `server/live.ts` for a working call). Record the planter's model in the dossier.
- 6 bugs per PR: 2 single-line, 2 multi-line (the defect spans several lines or is an omission), 2 cross-file (only wrong given code in another file). Realistic bugs an agent would write, not syntax errors; each must compile.
- Strict matching: caught only when a reviewer finding identifies that defect (right file, overlapping lines, and a strict model judgment that the finding describes this defect and not a neighbour). Near miss = missed, and say so.
- Keep "caught by the PR's own tests" as a separate column. Show misses: per bug kind, description, where, caught by reviewer yes/no, caught by tests yes/no, and for a miss what the reviewer said instead.
- Route already reacts to missed canaries (`canaryMissed`, and `shared/gate.ts` forces a full read under 50%); keep that working with the new shape.
Whatever the catch rate turns out to be is the number we publish. Do not tune the bugs until the reviewer catches them.

### 4. Independent audit by the other model family (all three judges)
New stage after routing: the same second family (GPT via Codex, read-only in the PR-head worktree) (a) reads every unit the plan lets the human skip or skim and looks for defects, with the requirement and criteria but without the first reviewer's findings, and (b) tries to refute each shown finding. Record `audit: { model, family, linesAudited, unitsAudited, issues: [{ unitId, path, line, title, why, severity }], findings: [{ id, verdict: 'agrees'|'disputes', why }] , durationMs }` in the dossier. Any issue it raises in a skipped or skimmed unit escalates that unit to `read` with the reason "raised by the independent audit" (re-run route or apply the escalation deterministically), and the issue is shown to the human as a finding marked as coming from the audit (not reproduced unless you reproduce it). This is real measurement: "lines the plan skipped: N; second-family audit of those lines found: M issues".

### 5. Rerun and verify
Rerun the affected stages on all sample PRs. Then check each dossier by reading it: lists consistent, self-test shape, audit present, implemented flags present, routing numbers sane. `bun test server/gate.test.ts` must pass (update the test only if a dossier legitimately changed shape). Do not edit anything under `web/` or `server/` except `server/gate.test.ts`; in `shared/` only add optional fields (another engineer is editing `server/`, `web/` and `shared/gate.ts` at the same time; if you must change `shared/gate.ts`, keep it to the self-test shape). Keep `shared/` free of bun/node-only imports (the web build type-checks it). After the reruns, do NOT copy anything into `/bulk2/runs/linearcodereview/data-backup/`; I do that after checking.

## Final answer
For each item: done / partly / not done, what changed (files), and the new numbers per PR (lines read/skim/skip, tier, verdict, self-test caught/planted by kind, audit issues, units escalated). List every place where a number the docs quote will now be different. Be blunt about anything that got worse.
