# Junction 2026 submission: Countersign

## Project name

Countersign

## One-line pitch

AI code review where a line goes unread only when a check that ran covers it, and a named engineer signs for everything else.

## Description (120 words)

Countersign reviews pull requests written by AI agents. It turns the requirement into acceptance criteria before anyone sees the code, then runs the change in a sandbox: tests that fail without the change, independent tests per criterion, and each hunk reverted to see if tests notice. Findings must survive an agent told to refute them and a test Countersign re-runs itself. A second model family plants bugs to test the reviewer and audits every line a person may skip. A points table routes to a person only what no run covers, plus the decisions the AI refuses to make. That person reads under a server-kept clock and signs one statement: what was checked, what was not, and the risk they accept.

## What it does

- **Inbox.** Agent PRs, least work first, with lines to read, decisions, findings and advice.
- **Brief.** One screen per PR: what was asked, the advice, what you must do with minutes, why each unit got its depth, what nobody checked. Then a rail split into "Needs you" and "Evidence (optional)".
- **Sign-off gate on the server.** No accept while a finding is unjudged, a blocking decision is open, or a required unit has not been open for its floor. Accepting over a confirmed major finding or an unimplemented decision takes a written reason. An area on probation needs a second signer.
- **GitHub.** A PR comment and the required check `countersign/sign-off`; the base branch's protection rule blocks the merge until a named person signs. The sign chapter shows what GitHub reports right now.
- **Trust ledger.** Trust per code area, in three separate sections: measured here, backtest, seeded.

## How it answers the challenge

| Criterion | Our answer | Evidence in the product |
|---|---|---|
| **Clarity (30%)** | One rule, six principles each enforced in code, five trade-offs with their cost, blunt limits. | `docs/CONCEPT.md` and the Concept page. The Brief puts one PR on one screen. |
| **Practicality (25%)** | Runs from a webhook on real PRs; GitHub itself blocks the merge until a named person signs. Identity is a GitHub token checked by the server, a stand-in for SSO. | Five sample PRs: 5.3 to 8.5 minutes of pipeline wall time and $0.80 to $7.17 of metered model cost each. REQ-2204 (92 files) asks for 8 lines. |
| **Measurement (25%)** | Each brief metric has a defined measurement and a label: measured, backtested or seeded. Rushed and young sign-offs never count. | Measured: 570 of 3139 changed lines routed to read; 23 findings shown of 34 raised, 16 reproduced; the blind reviewer caught 11 of 18 planted bugs, 2 of 6 cross-file. Backtest: 3 later-fixed PRs all routed to a person, though every backtest line was; the AI flagged 0 of 3 itself. Seeded: 118 sign-offs, labelled. |
| **Evidence (20%)** | Every criterion traces to the requirement and to executed evidence with a command to re-run. Refusals come with options and no recommendation. | REQ-2297: 49 of 1392 lines to read; 1210 snapshot lines skipped under a checked 3-line rule; 6 findings, 4 reproduced; 2 blocking decisions. |

## The three judge questions

**What would make you not trust your own output?** No linked requirement, nothing executed, the reviewer catching under half of the bugs planted in this change, an area on probation, or a spot-check draw: then every unit must be read before the server takes a signature. Short of that, each review lists its own reasons on the Brief, such as a criterion backed only by the author's tests, or a planted bug the reviewer missed. One gap: when the advice is already "Request changes", a weak self-test does not void the plan.

**Who owns the decision?** The engineer who signs, by name, for one commit, under a statement the server builds and a clock the server keeps. The AI's verdict is labelled advice, and accepting over a problem the signer confirmed needs a reason in their own words.

**How would this scale?** Reading follows risk, not diff size, and trust per area lowers it as clean sign-offs accumulate. Decisions run out first, about three per PR, then sandbox minutes.

## Sample data

Five agent-written changes in our copy of the challenge's sample repository, each with its requirement ID: the four from the challenge (REQ-2283, REQ-2234, REQ-2129, REQ-2297) and REQ-2204, a mechanical change we added to show the light path. The backtest replays merged pull requests of the same repository. Ledger history before them is synthetic and labelled in the UI and the API. Demo copies use three synthetic reviewers. No customer, personal or confidential data is used.

## Links

- Demo: `DEMO_URL`
- Video: `VIDEO_URL`
- Concept card: `docs/CONCEPT.md` · Walkthrough: `docs/WALKTHROUGH.md` · Lessons: `docs/LESSONS.md`
