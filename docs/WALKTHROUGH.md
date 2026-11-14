# Live walkthrough (5 minutes)

Where trust comes from, step by step, on PR #4: an agent's change for **REQ-2297** (exclude generated code from coverage). 237 files, 1392 changed lines. It shows the most: a large diff with a small reading plan, three major findings, two blocking decisions, and the advice "Request changes".

Open the demo URL. You are a synthetic reviewer (Aino Laine); the chip at the top right switches to Mikael Berg or Sara Niemi. This copy never posts to GitHub.

Keys: `Enter` on the Brief starts the work, `N` next thing that needs you, `→` `←` next and previous chapter, `1` `2` judge a finding real or not real, `1` `2` `3` pick an option, `R` mark a unit read, `[` `]` switch tabs, `/` ask.

## 0. One sentence (15 s)

"A line goes unread only when a check that ran covers it. One named person signs for everything else, and the server keeps the record of what they did."

## 1. Inbox (20 s)

Five agent PRs, least work first. REQ-2204 at the top: 92 files, 8 lines to read. REQ-2297: 49 of 1392 lines, advice "Request changes". Open REQ-2297.
**Proves:** attention follows risk, not diff size.

## 2. The Brief (40 s)

One screen. What was asked: REQ-2297, 1 of 6 criteria proven by a run, 1 violated. The advice: request changes, labelled as advice. What you must do, with minutes: decide 2 blocking questions, judge 6 findings, read 49 lines and skim 133, sign. "Why this depth": U1 to U3 are core logic, security-sensitive and a behaviour change nobody asked for, so read closely. The 1210 snapshot lines are skipped because the same 3-line edit holds in 221 of 222 files and a passing test run regenerated them; the one exception is listed. What nobody checked, with a count.
**Proves:** the reviewer sees the whole job and the reason for each depth before starting. No model judged the risk; a points table in the policy file did.

## 3. Findings (60 s)

Press `Enter`. The rail splits into "Needs you" and "Evidence (optional)"; `N` walks only the first.

- **FN1** (major): the independent test for AC2 fails on the PR head. Countersign ran it. Press `1` (real).
- **FN2** (major): the `#if` guard strips the attribute on netstandard2.0 and .NET Framework, where it exists. Reproduced by a failing test. Press `1`.
- `N` through the rest. Each says how it was verified: executed, verified in code, or reasoned.

**Proves:** a finding is a test you can re-run, not an opinion. Judging two majors real has a consequence, shown at the end.

## 4. Decisions (40 s)

- **R1**: should the attribute be emitted for netstandard2.0 and .NET Framework consumers, or is excluding them intended? Labelled "The AI will not decide this", blocking, options with consequences and no recommendation. Press `1`.
- **R2**: should the user's own partial resolver class be excluded from coverage as a whole? Press a number.

**Proves:** the AI names the calls that are not its own, and the signature waits for a person to make them.

## 5. Read (40 s)

`N` to U1. Press `R` at once: the button counts down. The server takes the mark only after the unit has been open for half a second per changed line (4 to 30 s); a skim needs a sixth of a second per line. Wait, press `R`. Do the same for U2, U3 and the skim unit.
**Proves:** the server, not the browser, keeps the reading record and the clock. It is a floor on attention, not proof of understanding.

## 6. Evidence, optional (20 s)

Click "Skipped with proof": each skipped unit names the run that replaces the read. Click "Is the reviewer any good": GPT planted 4 bugs; the blind reviewer caught 3, the tests all 4. The miss was cross-file. Click "What nobody checked": for example, no coverage tool was run on generated code.
**Proves:** the signature never covers more than what was looked at, and the gaps are stated.

## 7. Countersign (50 s)

The attestation on the right: "I, Aino Laine, accept this change at commit a0aa5ab", review time from the server's clock, then checked by the AI with evidence IDs, checked by me, not checked, residual risk. The server builds this text and signs the same lines.

Because FN1 and FN2 were judged real, the default action is "Request changes". To accept, write a reason of at least 20 characters; it goes into the attestation word for word.

Below: "On GitHub right now", read live from GitHub by the server. The check `countersign/sign-off` is pending, the merge is blocked by GitHub because a protection rule on the base branch requires that check, and the dossier comment is posted. This copy never posts, so signing here changes nothing on GitHub, and the page says so.

Hold to countersign (or request changes).
**Proves:** a named owner, a record of exactly what they owned, and a merge gate that GitHub enforces.

## 8. Trust ledger (20 s)

Open Trust ledger. Three sections, never blended: "Measured on this server" (your sign-off appears as provisional: it counts as clean only after 14 days without a revert or incident, and a sign-off faster than the plan's floor is marked rushed and never counts), "Backtest on merged history" (six merged PRs of the challenge's sample repository, three of them fixed later), and "Seeded history" (118 synthetic sign-offs, labelled).
**Proves:** trust is earned per area from outcomes, and seeded data is kept away from what was measured.

## If asked

- **The light path:** REQ-2204 asks for 8 of 210 lines; 90 snapshot files are skipped because the same 2-line edit holds in all of them and a passing test run regenerated them. One decision, not blocking.
- **Not trust our own output:** no requirement, nothing executed, the reviewer catching under half of the bugs planted in this change, an area on probation, or a spot-check draw. Then every unit must be read before the server takes a signature.
- **Who owns it:** the person who signs, for one commit.
- **Scale:** decisions run out first, about three per PR.
