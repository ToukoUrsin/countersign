# Countersign: concept card

Junction 2026 · Tieto "Earned Trust in AI Code" · a reference implementation, not a product

## Recommendation

Do not read AI-written pull requests line by line, and never let a model approve one. A line may go unread only when a named check that ran covers it. A named engineer reads the rest, makes the decisions the AI refuses to make, and signs a statement of exactly what was and was not checked. The server, not the browser, keeps the record of what that person did.

In one sentence: **skip a line only when a run covers it, and sign by name for everything else.**

## Principles

Each is a rule the code enforces today.

1. **Only a run can replace a read.** A unit is skipped only when it names its proof: tests that fail on base and pass on head, a golden-file test that passes, or a mechanical rule checked on every file. A verified finding that those tests are weak cancels the skip. A model's opinion never lowers a risk score.
2. **The requirement sets the bar before anyone sees the code.** An agent that never sees the diff turns the requirement into acceptance criteria, and independent tests are written against them. Code that serves no criterion goes to a person.
3. **The reviewer is checked by something it does not control.** Every finding must survive an agent told to refute it, and Countersign re-runs the test that reproduces it. A second model family (GPT) plants bugs in the change to test the reviewer, and reads every line the plan lets a person skip or skim.
4. **A points table routes. A person decides.** The reading plan comes from a policy file on the base branch. Product intent, compatibility and risk appetite go to the owner as questions with options and no recommendation; blocking ones stop the signature.
5. **The signer owns one statement, built by the server.** One server function builds the statement the signer previews and the one that is signed, so they cannot differ. It lists what the AI checked (with evidence IDs), what the signer read, what nobody checked, and the risk they accept. Accepting over a problem the signer confirmed takes a written reason, quoted word for word.
6. **Trust belongs to a code area, earned slowly and lost at once.** 3, 8 and 20 clean sign-offs in a row raise an area one level. A sign-off counts as clean only 14 days after signing with no revert or incident, and a rushed one never counts. One escape drops the area two levels.

## Trade-offs

| We chose | What it costs |
|---|---|
| Compute over attention | 5.3 to 8.5 minutes of pipeline wall time and $0.80 to $7.17 of metered model cost per sample PR. Too heavy for a one-line change. |
| A points table for routing, no model judgment of risk | Crude. REQ-2283 asks a person to read 29 and skim 199 of 228 lines; REQ-2129 is a full read of 1043. |
| Skipping test files whose tests fail on base and pass on head | A test can tell base from head and still assert the wrong thing. A finding can cancel the skip, but only if a finding is raised. |
| No recommendation on refused decisions | 11 decisions on five PRs, 6 of them blocking. Owner time moves from reading to deciding. |
| A person signs every change, after a minimum time on each unit | No auto-merge. A change with almost nothing to read still waits for a name and a floor of seconds. |

Pipeline wall time: first stage start to last stage end. Metered model cost: what the stages report (intent, map, review, explain; the self-test on some runs; the tester, the refuting agent and the audit are not metered). Human minutes: the plan's estimate from the policy file's reading speeds, not measured.

## Limits

- **Reading floors measure attention, not understanding.** A unit can be marked read only after half a second per changed line on screen (4 to 30 s); a skim after a sixth. A tab left open passes.
- **Identity is a stand-in.** Signing in means pasting a personal GitHub token that the server checks with GitHub. No OAuth or SSO. Without sign-in the server's own GitHub account signs.
- **Findings differ between runs, so plans do.** Routing is deterministic given the findings; the findings are not. REQ-2283 asked for 39 of 228 lines in one run, 218 in the next and 29 (plus 199 to skim) in the latest, on the same commit.
- **The reviewer misses planted bugs.** GPT planted 18 bugs on four samples. The blind reviewer caught 11, the tests 9, and 3 were caught by neither. The reviewer caught 2 of 6 cross-file bugs, and on REQ-2283 0 of 2. REQ-2204 got no valid planted bug.
- **"Proven" means one independent test passed.** Criteria, tests and findings come from Claude models; only the planter and the audit are GPT.
- **Escapes are reported by hand.** A person records a revert or incident on the ledger. Nothing reads them from the repository yet.
- **One stack.** .NET, net8.0, Linux. The sandbox is not security reviewed, prompt injection is untested, blast radius is a text search.

## How trust is measured

Three sources, never blended: **measured** on this server, a **backtest** on merged history, and **seeded** history (118 synthetic sign-offs over 13 calendar weeks, labelled in the UI).

| Metric from the brief | How it is measured | What exists today |
|---|---|---|
| Reverts and incidents do not rise as review time falls | Escapes reported against a signed PR; server-clocked review time per sign-off | Measured: no real sign-off has passed its 14 days yet. Backtest: 3 later-fixed PRs, all routed to a person, but so was every backtest line, so this does not test selective routing. Seeded: 2 escapes in 118. |
| AI findings are real | Re-run reproduction, refutation, a second-family audit | Measured: 34 raised, 11 killed (9 duplicates, 2 not reproduced), 23 shown, 16 reproduced by a failing test. The audit read 2569 skip or skim lines and raised 0 issues, so its value is unproven. Backtest: the AI flagged 0 of the 3 later-fixed changes itself. |
| AI findings are accepted | The signer judges each finding real or not real | Measured: none judged on this server yet. Seeded: 83%. |
| Time to merge | PR opened to countersigned | Measured: none yet. Seeded only. |
| Share routed to humans | Changed lines routed to read, skim or skip | Measured: 570 of 3139 changed lines routed to read (18.2%), 609 to skim, 1960 skipped with a named proof; 1151 to read once the spot-check full read of REQ-2129 applies. Backtest: 503 of 503 to read. |

## Who owns the decision

The person who signs. The attestation reads "I, name, accept this change at commit abc1234", with review time from the server's clock. It is hash-chained into the ledger and posted to the pull request, and the check `countersign/sign-off` turns green. The base branch of our copy requires that check, so GitHub blocks the merge until then. The AI's verdict is labelled advice. If the signer confirms a major finding or picks an option the commit does not implement, the default becomes "Request changes"; accepting anyway takes a reason of at least 20 characters. Once signed, findings and answers are locked. A new commit needs a new signature.

## How it scales

Reading follows risk, not diff size: REQ-2204 touches 92 files and asks for 8 lines to read; REQ-2129 touches 28 and is read in full. 
What breaks first:
1. **Decisions.** About three per PR, and no proof removes them.
2. **Sandbox minutes.** Up to 10 hunk reverts and the planted bugs per PR, each a test run.
3. **New areas.** An area with no history starts at Supervised, where 1 in 3 PRs is drawn for a full read.

## When Countersign says "read everything"

The reading plan is void and the server takes no signature until every unit is marked read when:

| Condition | Extra |
|---|---|
| No requirement is linked | A blocking question: what is it for, and who asked for it |
| Nothing could be executed | |
| The reviewer caught under half of the bugs planted in this change | |
| An area is on probation (trust level 0) | A second person co-signs after their own read; the first signer cannot |
| The change is drawn for a spot check (rate by trust level, drawn from the head commit) | The signer records whether the full read found anything the AI missed |

A gap: when the advice is already "Request changes" (a violated criterion or a reproduced major finding), the first three conditions do not void the plan; a unit holding a planted bug the reviewer missed only gains 2 points per bug. On REQ-2283 the reviewer caught 0 of 2 and the plan stood. On the samples, the spot check drew REQ-2129. The other four have not occurred on a real change. Three are covered by unit tests of the gate; probation and its co-signature have no test yet.
