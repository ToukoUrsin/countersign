You own the written submission for Countersign, our entry to the Junction 2026 hackathon challenge "Earned Trust in AI Code" (Tieto). Judges weigh the concept more than the implementation, and Clarity is 30% of the score, so this text decides the result. The product changed a lot since the docs were written and the docs are now wrong in many places. Rewrite them so that every sentence is true of the product as it runs right now. Do the work yourself; start no subagents. Deadline: done and reported within 40 minutes of starting (check `date -u`).

## Read first
- The challenge brief and judging criteria: /home/ubuntu/junction/linearcodereview/work/judging/CHALLENGE.md (every line).
- The three round-1 judge verdicts, to see which claims they found false, unclear or unconvincing: /bulk2/runs/linearcodereview/judging/r1/verdicts/{opus,sol,fable}.md. Read the sections "BROKEN OR UNCONVINCING", "THE 3 REASONS IT LOSES" and "WHAT WOULD MOVE EACH SCORE".
- The current docs (stale): README.md, docs/CONCEPT.md, docs/WALKTHROUGH.md, docs/LESSONS.md, docs/SUBMISSION.md, and the in-app concept page content web/src/content/concept.ts (rendered by web/src/pages/Concept.tsx).
- The numbers: run `cd /home/ubuntu/junction/linearcodereview && bun work/facts.ts` (every number about the five sample reviews), `cat data/backtest/summary.json` (the backtest), `curl -s localhost:4318/api/ledger | head -c 6000` (the ledger view: seeded, real, backtest), and the policy files policy/default.yml and policy/messagepack.countersign.yml. Quote numbers only from these. Never from the old docs or from memory.
- The product, as a first-time user, so the walkthrough is exact: http://localhost:4318 (a throwaway copy with three synthetic reviewers; it never posts to GitHub; you may click, judge, read and sign there). `/` Inbox, `/pr/toukoursin__junction26-messagepack-csharp__N` N=1..5 (opens on the Brief; chapters via `?c=`: brief, R1.., FN1.., U1.., sign, then evidence: change, how, asked, proof, reviewer, skipped, limits), `/ledger`, `/concept`. Use headless Chrome through playwright-core (see /bulk2/runs/linearcodereview/shoot for working scripts) or curl the API (`/api/dossiers`, `/api/dossiers/<slug>`, `/api/dossiers/<slug>/github`, `/api/me`, `/api/ledger`, `/api/policy`). NEVER write to http://localhost:4317 (the real instance that posts to GitHub); reading it is fine.
- The code that enforces the claims, when you need to check one: shared/gate.ts (the sign-off gate), server/index.ts (identity, reading record, statement, sign-off, GitHub card), server/people.ts (who the reviewer is), server/ledger.ts (trust, provisional and rushed sign-offs), pipeline/review.ts and pipeline/stages/*.ts (the review pipeline, including selftest.ts, audit.ts, consistency.ts, route.ts).

## Timing of the numbers
Some of the five reviews are being re-run while you start (`bun work/facts.ts` prints `running` for those, and may print no self-test yet). Read and write the structure first. Take every number in a final pass once all five print `ready`; check again every few minutes. If one is still not ready 30 minutes in, use the numbers that exist, never write a placeholder, and say in your report which review was not final.

## What changed since the docs were written (verify each in the product or the code before you write it)
Identity and reading are now the server's record, not the browser's:
- The reviewer is decided by the server (cookie session). Three kinds: signed in with a personal GitHub token that the server checks against GitHub (the check on the PR is then posted with that person's account); the server's own GitHub account when nobody signed in; a synthetic reviewer on demo copies (Aino Laine, Mikael Berg, Sara Niemi), chosen from the reviewer chip, so a second signer can be tried. There is no OAuth app or SSO; token sign-in is the stand-in.
- The server keeps the reading record per person and per pull request: a heartbeat clock that only counts time between beats at most 15 s apart, and seconds per unit. A unit can be marked read only after it has been open for its floor: half a second per changed line, 4 to 30 s. Units routed to "skim" also need a mark now (a sixth of a second per line, 3 to 12 s) and the attestation says "skimmed", not "read". Too early gets HTTP 425 and the button counts down. This is a floor on attention, not proof of understanding; say so.
- One server function builds both the statement the signer previews and the attestation that is signed, so they cannot differ. Review time on the attestation is the server's clock.
- Findings and answers are locked once the change is signed (409).
- A sign-off faster than max(20 s, 20% of the plan's estimated time) is recorded as rushed and never counts toward trust in the code area.
- A real sign-off is provisional for 14 days (policy `cleanAfterDays`) and counts as clean only after that with no revert or incident. Seeded history is exempt and labelled.
- Overrides: if the signer judged a major or blocker finding real, or chose a decision option the commit does not implement, the default action becomes "Request changes". Accepting anyway needs a written reason of at least 20 characters, which goes into the attestation word for word.
- Probation is built: an area at trust level 0 means every line is read and a second person must co-sign after their own read. The same person cannot give both signatures. Until the second signature nothing is accepted.
- A review whose core stage failed (intent, map, review, verify or route) ends as failed: no advice, nothing to sign. (We saw the opposite happen: see "new failure modes".)
- The UI never claims a green check when the copy does not post to GitHub.
The pull request side:
- The base branch of our copy of the sample repository has a protection rule that requires the `countersign/sign-off` check, and the sign chapter shows what GitHub itself reports right now, read live by the server: the check and its text, whether GitHub blocks the merge, and the dossier comment (`/api/dossiers/<slug>/github`).
The review pipeline:
- New stages after routing: `audit` (a second model family, GPT, reads the lines the plan lets a person skip or skim and reports issues; its findings are shown un-reproduced and move the advice away from "accept") and `consistency` (deterministic fixes so the advice, criteria and findings cannot contradict each other).
- The self-test was rebuilt: bugs are planted by a different model family than the reviewer, include multi-line and cross-file kinds, and a catch needs the right place and the right meaning, not just a location within 3 lines. Report the numbers `bun work/facts.ts` prints, including misses. If it prints no self-test for a review, say that review has none.
- A finding against a unit whose skip rested on tests cancels that skip (a look for a minor finding, a full read for a major one). Because findings differ between runs, the reading plan can differ between two runs of the same commit: REQ-2283 was 39 of 228 lines in the first run. Report the current numbers and name this as a limit: routing is deterministic given the findings; the findings are not.
- A fifth sample: PR #5 (REQ-2204), a mechanical change across about 92 files, added to show the light path. Report what its dossier actually asks of a person.
Measurement:
- The ledger page now has three separate sections that are never blended: "Measured on this server" (real sign-offs made here: provisional, clean, rushed, escaped), "Backtest on merged history" and "Seeded history" (118 synthetic sign-offs over 13 calendar weeks).
- The backtest: merged pull requests of the challenge's sample repository, labelled by whether a later fix changed their lines (SZZ), replayed through the unchanged pipeline. Report the result exactly as data/backtest/summary.json has it, including that the sample is tiny, what share was routed to a person, how many later-fixed changes the AI flagged itself, and the caveats. Do not dress it up. Identify backtest pull requests by number and title only, no links.
The interface:
- A review opens on a one-screen Brief: what was asked, the advice, what you must do with minutes, why each unit got its depth, what nobody checked. The rail is split into "Needs you" and "Evidence (optional)"; `N` and Enter walk only what needs you.
- The inbox is sorted least work first.

## New failure modes to add to the lessons log (all real, from tonight)
- A failed review that looked like a pass: one run lost its model login mid-way; four stages failed and the dossier still said "ready, accept, nothing to read". Fix: core-stage failure fails the review.
- Rubber-stamping raised trust: a round-1 judge signed in one second through the raw API and the ledger counted it as a clean sign-off and improved the headline review time. Fix: server-side reading record, read floors, rushed sign-offs never count, provisional for 14 days, real data never blended into the seeded curve.
- The browser was the witness: read marks and review seconds came from the client. Fix: the server keeps both.
- Advice softer than the evidence: "accept after decisions" next to a reproduced major regression. Fix: overrides, and the consistency stage.
- The same commit, two reading plans (see above). Not fixed; disclosed.
- The light sample was drawn for a spot check by its commit hash, so it showed the full-read path. We added an empty commit to show the path that was not drawn; the draw itself is shown on a different review if one is drawn (check facts.ts). Say this plainly.

## Deliverables
1. docs/CONCEPT.md: the Concept card, readable in 3 minutes: recommendation; principles (few, each a rule the code enforces); trade-offs with their cost; limits, blunt; how trust is measured (the brief's metrics: reverts and incidents do not rise as review time falls, AI findings are real and accepted, time to merge, share routed to humans; for each: how it is measured, and what is real, backtested or seeded today); who owns the decision; how it scales and what breaks first; when Countersign says "read everything".
2. docs/WALKTHROUGH.md: the live walkthrough, 5 minutes spoken, where trust comes from step by step, on the review that shows the most (pick after looking at all five; mention the light one too). It starts in the product on the Brief, uses the real keys, and never hard-codes a port. Each step ends with what it proves.
3. docs/LESSONS.md: what the reviews showed (table from facts.ts), what the AI found, what it refused to decide and why, how the evidence lets a named person accept without a full read, failure modes (keep the true old ones, add the new), what we would not trust yet, the decision log with times (add tonight's: 01:00 to 02:30 UTC Saturday 14 November for the server-side record, overrides, probation co-sign, provisional and rushed, required check on the base branch, backtest, second-family audit), and what is still not built.
4. docs/SUBMISSION.md: project name, one-line pitch, 120-word description, what it does, the four judging criteria one-to-one with evidence, the three judge questions in two sentences each, sample data statement, links (keep the literal placeholders `DEMO_URL` and `VIDEO_URL`).
5. README.md: what it is in three lines, how to run it, env vars (include CS_DEMO_SIGNERS, CS_NO_PUBLISH), layout, links.
6. web/src/content/concept.ts in line with CONCEPT.md. Keep the TypeScript shape exactly (same exports and field names). Check with `cd web && bunx tsc -b`. Do not run `bun run build` and do not edit any other file under web/, server/, pipeline/, shared/, data/.

## Writing rules
- Write for a senior engineer at Tieto who has read forty submissions today. Plain words, short sentences, the answer first. Concrete numbers and names from the product.
- No hype words, no em dashes, no rhetorical questions, no "not X but Y" more than once per page, no filler headings.
- Never overclaim. A judge who catches one inflated claim discounts everything. Where something is a stand-in, seeded or untested, say so. Where a number got worse since round 1, report the worse number.
- One definition each, used the same everywhere: pipeline wall time (minutes from first stage start to last stage end), metered model cost (what the stages report; say which stages are not metered), human minutes (the plan's estimate from the policy file's reading speeds, not measured).
- Shorter than the current docs where possible. The Concept card must stay one page.
- Do not mention, name or link the upstream repositories of the sample code; say "the challenge's sample repository".
- `rm` only literal paths.

## Report back (short)
What you changed per file; every claim you could not verify and therefore cut; anything the product should do or show to make a claim true, ranked by how much it would move a judge.
