You are the designer on Countersign for round 2 of an overnight judging loop (Junction 2026, Tieto challenge "Earned Trust in AI Code": AI reviews an AI-written pull request, a named human countersigns). Bar: linear.app quality in type, spacing, hierarchy, motion and states; nothing that looks AI-generated. You fix things in code, you do not just critique. Do the work yourself; start no subagents. Deadline: built, verified and reported by **02:35 UTC** (check `date -u`).

First read, in this order:
1. `/home/ubuntu/junction/linearcodereview/work/judging/brief-designer.md`: the section "Where things are" (stack, build command, instances, routes, keys, screenshot tooling, Linear reference shots) and "Rules" still apply in full. Its defect list is done; do not redo it.
2. The three round-1 judge verdicts: `/bulk2/runs/linearcodereview/judging/r1/verdicts/{opus,sol,fable}.md`. Read the UI-related complaints yourself.
3. The current UI: last round's final screenshots are in `/bulk2/runs/linearcodereview/shoot/r1/final/`; re-shoot what you change.
Use the skill `impeccable` (Skill tool; this is an Operate surface: precision, restraint, colour = state only).

## What the judges said that is yours to fix

**A. "Too heavy to grasp in 2 minutes" (Opus, Clarity).** "A 30-second 'one PR, one screen' view before the wizard: the verdict, the 3 things you must do, and the signature. Cut the chapter count for low-risk PRs." Today a PR opens on a 16 to 26 chapter guided review.
Build the **Brief**: the first thing `/pr/:slug` shows (a new first chapter `brief`, `?c=brief`, default when no `c`). One screen, no scrolling at 1440×900 or 1280×720, readable in 30 seconds by someone who has never seen the product:
- the requirement in one line and the AI's advice in one line (advice, clearly not a decision);
- **what you must do**, as a short checklist with counts and minutes, each row jumping to its first item: decisions the AI refused (n), findings to judge (n), lines to read (n of total, with the units named), spot check if drawn; state per row (done / left);
- **what you can skip and why**: lines skipped with the proof in plain words (for example "189 lines: the PR's tests fail without the change and pass with it"), and lines only skimmed;
- **why this depth**: the routing in one compact table a judge can photograph: per unit or per group, tier, read/skim/skip, and the two or three facts that put it there (data: `d.units[].factors`, `d.routing`, the policy's points; see how the existing Change and unit chapters explain it);
- **what nobody checked**: count plus the top two, linking to the limits chapter;
- the sign-off state and the one primary action: "Start (n things left for you)" or, when nothing is left, "Go to sign-off".
It must hold up on all sample PRs, including the full-read ones (`fullReadReason` in `shared/gate.ts`; PR3 is drawn for a spot check: the Brief must say "read all 1043 lines" and why) and on a low-risk PR where the list is nearly empty (a fifth sample, PR #5, is being reviewed during your work and may appear at `/pr/toukoursin__junction26-messagepack-csharp__5`; design the near-empty state so "nothing to read, two minutes" looks like the product working, not like a blank page).
Then **shorten the path**: chapters split into "needs you" (decisions, findings, units to read, spot check, sign) and "evidence" (how it works, what was asked, what was run, is the reviewer any good, skipped with proof, what nobody checked). The rail shows both groups; the counter, `N` and Enter-on-Brief walk only "needs you". A reviewer can sign after Brief plus the needs-you items; the evidence chapters stay one click away and are never required. Keep every existing chapter and shortcut working (`web/src/lib/chapters.ts`, `Guide.tsx`, `Review.tsx` key handling).

**B. Concept and Trust ledger pages are "long walls of text" (Sol), the rule should be "on one screen a judge can photograph" (Fable).** Redesign `web/src/pages/Concept.tsx` (wording lives in `web/src/content/concept.ts`; you may restructure and cut for layout, but do not change what a claim says): first viewport = the one rule, the read-everything conditions, who owns what (AI: evidence and advice; human: decisions and the signature), in a composed layout a judge would photograph. Principles, trade-offs, limits and the routing table below, scannable, with an in-page index. At 1440 nothing wraps awkwardly or truncates. Do NOT touch `web/src/pages/Ledger.tsx` this round: another engineer is rebuilding its data right now.

**C. Diagrams.** Dense maps on PR3 and PR4 shrink boxes, wrap labels to three lines and scroll sideways at 1280×720; PR1's map scrolls vertically at 1280×720; the phone map scrolls sideways. Fix in `web/src/components/Flow.tsx` (rank wrapping, grouping, or a layout that fits the pane); the owner asked for 10/10 diagrams.

**D. Small things the judges hit.** Lowercase `r` did nothing on a read unit (only Shift+R or the button): make `r` work. Evidence ids like E3 and AC1 shown with no meaning: give them words or a tooltip. Pipeline jargon in data strings ("red→green, regression, ablation", "FAWMN trigger"): `tidy()` in `web/src/lib/util.ts` is the place, but it must only ever run on AI-written text: text a human typed (decision notes, risk statements, spot-check notes) must be shown exactly as typed. A judge typed "I decided R1 = …" and the UI showed "the agent decided R1 = …"; find every place human text passes through `tidy()`/`Rich` and stop it.

## Files another engineer is editing right now (do not edit these regions)
- `web/src/pages/Ledger.tsx`, `web/src/pages/Inbox.tsx`, `web/src/api.ts`, `web/src/components/review/ctx.tsx`, `web/src/components/Shell.tsx` (he is adding a signed-in reviewer chip),
- the Sign chapter in `web/src/components/review/Guide.tsx` (the `sign` section and its attestation preview) and the sign-off / presence code in `web/src/pages/Review.tsx`.
You own everything else in `Guide.tsx`, `Stage.tsx`, `chapters.ts`, `Flow.tsx`, `Concept.tsx`, `atoms.tsx`, `index.css`. If `bunx tsc -b` fails in a file you did not touch, wait 30 s and retry; do not "fix" his file. He will also restart the server on :4318 a few times; if a page fails to load, retry.
Do not change `server/`, `pipeline/`, `shared/`, `data/`, `docs/`.

## Finish
Rebuild, re-shoot every screen you touched at 1440×900, 1280×720 and 390×844, dark and light, and LOOK at them. Run a real keyboard flow on :4318 in headless Chrome on PR1 (Brief → N through everything that needs you → sign chapter; `r`, `1`/`2`, option keys, `/`, `[` `]`, Space) and check the console. Put screenshots under `/bulk2/runs/linearcodereview/shoot/r2/`.

Report (short): your honest score vs Linear now (cleanliness, flow, diagrams, interaction, copy); what you changed, one line each with file names; what is still below the bar; whether you have nothing left to fix.
