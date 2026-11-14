# Lessons log

Junction 2026 · Tieto "Earned Trust in AI Code" · team Countersign

Everything below happened on five agent-written changes in our copy of the challenge's sample repository, reviewed for real: agents on Claude models, a second family (GPT) for planted bugs and the audit, tests in a docker sandbox, net8.0 on Linux. Numbers are read from the dossiers the product serves.

Definitions used everywhere: **pipeline wall time** is minutes from the first stage start to the last stage end. **Metered model cost** is what the stages report; intent, map, review and explain are metered, the self-test only on some runs, and the independent tester, the refuting agent and the audit not at all. **Human minutes** are the plan's estimate from the reading speeds in the policy file (6 lines a minute to read, 40 to skim, plus time per decision and finding), not measured.

## What the five reviews showed

| Requirement | Size | Plan for the person | Findings shown (reproduced) | Decisions (blocking) | Self-test | Advice |
|---|---|---|---|---|---|---|
| REQ-2283 crash on a generic struct from a referenced assembly | 4 files, 228 lines | read 29, skim 199, ~14 min | 5 (3) | 2 (1) | reviewer 0 of 2, tests 1 of 2 | request changes |
| REQ-2234 analyzer silent when generation is suppressed | 4 files, 266 lines | read 22, skim 51, ~10 min | 6 (4) | 3 (1) | reviewer 3 of 6, tests 2 of 6 | accept after decisions |
| REQ-2129 formatters for types in a referenced assembly | 28 files, 1043 lines | all 1043: drawn for a spot check | 6 (5) | 3 (2) | reviewer 5 of 6, tests 2 of 6 | request changes |
| REQ-2297 exclude generated code from coverage | 237 files, 1392 lines | read 49, skim 133, ~16 min | 6 (4) | 2 (2) | reviewer 3 of 4, tests 4 of 4 | request changes |
| REQ-2204 remove a redundant semicolon from generated code | 92 files, 210 lines | read 8, ~2 min | 0 | 1 (0) | no valid bug planted | accept after decisions |

Pipeline wall time 5.3 to 8.5 minutes and metered model cost $0.80 to $7.17 per PR. 570 of 3139 changed lines are routed to read (18.2%), 609 to skim, 1960 skipped with a named proof. Across the five: 34 findings raised, 11 killed (9 duplicates, 2 whose reproduction passed), 23 shown, 16 reproduced by a failing test. 16 of 29 criteria proven by a run.

The self-test: GPT planted 18 bugs on four samples (8 single-line, 4 multi-line, 6 cross-file). The blind reviewer caught 11 and the tests 9; 3 were caught by neither (one on REQ-2283, two cross-file on REQ-2234). The reviewer caught 6 of 8 single-line, 3 of 4 multi-line and 2 of 6 cross-file. A catch needs the right place and the right meaning.

### What the AI found

- **REQ-2283.** The fix stops the crash by filtering diagnostics, and the filter also drops Error-level diagnostics for code the user owns. Reproduced by a failing test.
- **REQ-2234.** The PR's own tests pass without the change. No hunk depends on the setting the requirement names.
- **REQ-2129.** Settings on the declaring assembly's type are ignored, which AC4 asks for; the independent test for AC4 fails on the head.
- **REQ-2297.** The attribute is guarded out on netstandard2.0 and .NET Framework, where it exists. On a user's partial resolver it can break the build with CS0579.
- **REQ-2204.** Nothing. The audit read the 202 skipped lines and raised nothing either. Across all five it read 2569 skip or skim lines and raised 0 issues.

### What the AI refused to decide, and why

- *Should the consuming build drop a diagnostic for a type in a referenced assembly, report it without a location, or report it on the consuming member?* Product intent. The PR picks "drop".
- *Is the duplicate-key analyzer crash the failure REQ-2234 reports?* Missing context.
- *Should the attribute be emitted for netstandard2.0 and .NET Framework consumers?* Compatibility.
- *Is updating the snapshots enough regression protection for REQ-2204, or is a dedicated test needed?* Missing context.

Each has options with consequences and no recommendation. Blocking ones stop the signature.

### How the evidence lets a named person accept without a full read

On REQ-2297 the person reads 49 of 1392 lines:

- 221 of 222 snapshot files carry the same 3-line edit. A deterministic check confirms it and lists the one exception. A passing test run regenerated them.
- The new test file is skimmed, not skipped.
- A GPT audit read every skipped and skimmed line and raised nothing.
- What is left are the three generator units, and that is where every major finding is.

The signer then owns one statement, built by the server: checked by the AI with evidence IDs, checked by me, not checked, residual risk. Judging the majors real makes "Request changes" the default; accepting needs a written reason.

## Failure modes we saw

| # | Failure mode | What happened | What we changed |
|---|---|---|---|
| 1 | **Silent downgrade** | GitHub reported the base commit from when the PR was opened. It had no policy file, so the run skipped the sandbox and still produced a tidy dossier. | Policy comes from the live base branch. Skipped and failed stages are listed under "What nobody checked". |
| 2 | **The sandbox blamed the change** | Two test projects need a newer compiler. They failed on base and head, and the pipeline raised a blocker on three PRs. | A project that fails on the untouched base is a sandbox limit, listed as not checked. |
| 3 | **A green run of zero tests** | The test filter matched a data class; zero tests ran. | Zero tests is an error, never a pass. |
| 4 | **Tests that prove nothing** | Reverting a hunk and seeing whether any test notices: REQ-2297 2 of 10 noticed, REQ-2234 3 of 6. REQ-2234's tests pass without the change. | A red-green run and a revert per hunk on every PR. Unnoticed code goes to a person. |
| 5 | **"Proven" next to a counter-example** | REQ-2129: an independent test passed for AC4 while a reproduced finding refuted it. | A verified major finding that names a criterion downgrades it. |
| 6 | **Two reviewers, one finding** | Most killed findings are the two reviewer lenses reporting the same thing: 9 of 11 tonight. | Duplicates merged, a skeptic tries to refute the rest, Countersign re-runs the test. Killed findings stay visible. |
| 7 | **Model text acts on GitHub** | Review text contained cross-repository references and `@` mentions. | Everything posted is defused first. |
| 8 | **Concurrent reviews collide** | Reviews sharing one clone failed on a git ref lock. | Each review writes only its own refs. |
| 9 | **An explanation that looks like proof** | A generated diagram sat next to test output and read as just as certain. | Live diagrams and answers are labelled "not evidence" and never enter the attestation. |
| 10 | **A failed review that looked like a pass** | One run lost its model login mid-way. Four stages failed and the dossier still said "ready, accept, nothing to read". | If intent, map, review, verify or route fails, the review is failed: no advice, nothing to sign. |
| 11 | **Rubber-stamping raised trust** | A round-1 judge signed in one second through the raw API. The ledger counted it as clean and the headline review time improved. | Server-side reading record and read floors; sign-offs faster than max(20 s, 20% of the plan) are rushed and never count; real sign-offs are provisional for 14 days; real data is never blended into the seeded curve. |
| 12 | **The browser was the witness** | Read marks and review seconds came from the client. | The server keeps both, per person and per PR, from a heartbeat clock that only counts gaps of 15 s or less. |
| 13 | **Advice softer than the evidence** | "Accept after decisions" next to a reproduced major regression. | Overrides: a confirmed major or an unimplemented option makes "Request changes" the default. A consistency stage removes contradictions between advice, criteria and findings. REQ-2234 still shows "accept after decisions" with a reproduced major finding until the signer judges it. |
| 14 | **The same commit, three reading plans** | REQ-2283 asked for 39 of 228 lines to read in the first run, 218 in the next, and 29 plus 199 to skim in the latest. The findings differed each time, and a finding that tests are weak cancels the skip they earned (a look for a minor one, a read for a major one). | Not fixed. Routing is deterministic given the findings; the findings are not. Disclosed. |
| 15 | **The light sample drew the heavy path** | The spot-check draw is a function of the commit hash, and REQ-2204's first commit was drawn, so the light sample showed a full read. | We added an empty commit so REQ-2204 shows the path that was not drawn. The draw itself is shown on REQ-2129. |
| 16 | **A stage skipped itself wrongly** | The self-test on REQ-2283 and REQ-2234 reported "no changed source code to plant bugs in", though both change source. | Fixed and re-run. Both now have a self-test. |
| 17 | **A weak self-test that changed nothing** | On REQ-2283 the reviewer caught 0 of 2 planted bugs, which should void the plan. The advice was already "Request changes", and that takes precedence, so the plan of 29 lines stood. | Not fixed. Disclosed on the concept card. |
| 18 | **Prompt injection through the PR** | Not observed. Designed for, not tested. | PR content is marked untrusted, reviewers are read-only, policy never comes from the PR head. |

Failure modes 1, 3 and 10 are the dangerous kind: the tool was wrong and looked fine. Number 11 is the measurement version of the same danger.

## What we would not trust yet

- A criterion proven by one test written by the same model family that wrote the code.
- The reviewer's sensitivity: 11 of 18 planted bugs, 2 of 6 cross-file.
- Skips in areas whose trust level comes from seeded history.
- The backtest: six PRs, and every line of every one was routed to a person, so it shows nothing about selective routing.
- The reading-time estimate, and the read floor as a sign of understanding.
- Anything outside .NET, net8.0, Linux.

## Decision log

Friday 13 and Saturday 14 November 2026, UTC.

| When | Decision | Why |
|---|---|---|
| Fri 19:30 | A dossier per PR instead of comments on a diff | The owner must answer "does it do what was asked". |
| Fri 19:40 | A strength ladder (executed, verified in code, reasoned) instead of confidence scores | A model's number cannot be audited. A run can be repeated. |
| Fri 19:45 | Criteria from the requirement only, by an agent that never sees the diff | Otherwise the change defines its own success. |
| Fri 19:50 | Routing from a points table in a policy file | A depth must be explainable. |
| Fri 19:55 | The AI never approves; the check turns green only on a human sign-off | Accountability needs a name. |
| Fri 20:00 | Policy from the base branch | A stale base silently skipped execution. |
| Fri 20:05 | Countersign re-runs every test an agent writes | "It failed for me" from an agent is a claim. |
| Fri 20:10 | Trust per code area | Docs and the generator core do not deserve the same leash. |
| Fri 20:25 | Synthetic ledger history, labelled | The challenge allows synthetic data only, and a trust curve needs months. |
| Fri 22:00 | A guided review replaces the dossier page | One long page was a wall to read. |
| Fri 22:40 | Live explanations stay out of the dossier and the attestation | Nobody ran them. |
| Sat 00:55 | One gate definition shared by server and UI | The UI enforced more than the server. |
| Sat 01:00 to 02:30 | Server-side reading record, clock and identity | Round-1 judges signed in one second through the API. |
| Sat 01:00 to 02:30 | Overrides with a written reason | Decisions and confirmed findings had no consequence. |
| Sat 01:00 to 02:30 | Probation co-sign by a second person | It was in the policy text only. |
| Sat 01:00 to 02:30 | Provisional for 14 days; rushed sign-offs never count | A sign-off with no escape yet is not a clean one. |
| Sat 01:00 to 02:30 | Required check on the base branch, read live from GitHub | The merge gate was claimed, not shown. |
| Sat 01:00 to 02:30 | Backtest on merged history | Every outcome number was seeded. |
| Sat 01:00 to 02:30 | Second model family for planted bugs and an audit of skipped lines | One model family was checking itself. |

## Still not built

- Sign-in through OAuth or SSO. Token sign-in is the stand-in.
- Escapes read from the repository automatically. Today a person reports them on the ledger.
- A check that the reader understood, beyond time on the unit.
- Stable findings between runs, so the same commit gets the same plan.
- A self-test that plants bugs on every sample, and a weak self-test that voids the plan whatever the advice.
- A backtest larger than six PRs, and with a plan that skips anything.
- Sandbox adapters for other stacks, and a call graph for blast radius.
