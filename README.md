# Countersign

**AI reviews. A named human countersigns.**

Countersign reviews a pull request written by an AI agent against its requirement, runs the evidence in a sandbox, and routes to a person only the lines no executed check covers and the decisions the AI refuses to make. That person reads under a clock the server keeps and signs one statement of what was and was not checked; GitHub blocks the merge until then. Junction 2026, Tieto challenge "Earned Trust in AI Code". A reference implementation, not a product.

- Concept card: [docs/CONCEPT.md](docs/CONCEPT.md)
- Live walkthrough: [docs/WALKTHROUGH.md](docs/WALKTHROUGH.md)
- Lessons, failure modes, decision log: [docs/LESSONS.md](docs/LESSONS.md)
- Submission text: [docs/SUBMISSION.md](docs/SUBMISSION.md)

## What happens to a PR

```
PR + requirement ID
  intake       diff, policy from the BASE branch, requirement text
  intent       requirement -> acceptance criteria (the agent never sees the diff)
  map          diff -> change units; repetitive edits -> one rule + exceptions
  prove        docker, no network while tests run: red-green, regression, revert each hunk
  probe        independent tests per criterion
  review       two reviewer lenses -> verify: quote check, skeptic, reproduction re-run by Countersign
  selftest     a second model family (GPT) plants bugs; do the tests and a blind reviewer catch them
  explain      story and diagrams
  route        policy points table -> skip / skim / read per unit, advice (never approval)
  audit        GPT reads every line the plan lets a person skip or skim
  consistency  deterministic fixes so advice, criteria and findings cannot contradict
  publish      PR comment + check countersign/sign-off = pending
human          Brief, then judge findings, answer decisions, read routed units, sign
  -> attestation on the PR, check = success, hash-chained ledger event, trust per area
```

If intent, map, review, verify or route fails, the review is failed: no advice, nothing to sign.

## Run it

Requirements: `bun`, `docker`, `gh` (logged in; without a signed-in reviewer this account signs), `claude` (Claude Code CLI, headless, for most pipeline agents), `codex` (for the self-test planter and the audit).

```bash
bun install && (cd web && bun install && bun run build)
docker build -t countersign-sandbox:dotnet8.0.402-r3 sandbox/   # .NET adapter
bun server/seed.ts --force                                       # synthetic ledger history, labelled
bun server/index.ts                                              # serves the UI and API on $PORT
bun pipeline/review.ts https://github.com/<owner>/<repo>/pull/<n>
```

The reviewed repository needs a `.countersign.yml` on its base branch (example: [policy/messagepack.countersign.yml](policy/messagepack.countersign.yml), defaults: [policy/default.yml](policy/default.yml)). Without one the PR gets the default policy and no sandbox, and the review says so under "What nobody checked". To make the sign-off binding, add a branch protection rule that requires the `countersign/sign-off` check.

GitHub webhook: point `pull_request` events at `POST /api/github/webhook`. Every new head commit gets a fresh review and needs a new signature.

Reviewers sign in with a personal GitHub token, which the server checks with GitHub; the check is then posted by their account. There is no OAuth app or SSO.

## Environment

| Variable | What |
|---|---|
| `PORT` | Server port |
| `CS_PUBLIC_URL` | Link used in PR comments and checks |
| `CS_NO_PUBLISH=1` | Never write to GitHub. The UI then never claims a green check |
| `CS_DEMO_SIGNERS=1` | Demo copy: three synthetic reviewers (Aino Laine, Mikael Berg, Sara Niemi) chosen from the reviewer chip |
| `CS_BASIC=user:pass` | Basic auth on every write; reading stays open |
| `CS_MODEL`, `CS_REVIEW_MODEL`, `CS_FAST_MODEL` | Pipeline models (Claude Code CLI) |
| `CS_DATA` | Data directory, default `data/` |
| `CS_DIST` | Built UI directory, default `web/dist` |
| `CS_POLICY_FILE` | Local policy file instead of the base branch's (testing) |
| `CS_SANDBOX_PARALLEL` | Parallel sandbox test runs |
| `GEMINI_API_KEY` | Enables live diagrams and "Ask"; without it they are off |
| `CS_GEMINI_DRAW_MODEL`, `CS_GEMINI_ASK_MODEL` | Gemini models for diagrams and answers |
| `CS_LIVE_BUDGET` | Live generations per server process |

## Layout

| Path | What |
|---|---|
| `shared/dossier.ts` | The dossier contract between pipeline, server and UI |
| `shared/gate.ts` | The sign-off gate, used by the server (which enforces it) and the UI |
| `pipeline/` | Stages (`pipeline/stages/*.ts`) and the orchestrator (`review.ts`) |
| `sandbox/` | Docker image, test runner, worktree helper |
| `policy/` | Routing policy defaults and the sample repository's policy |
| `server/` | API, identity (`people.ts`), reading record, statement and sign-off, GitHub card, ledger, seed |
| `web/` | Reviewer UI (React): inbox, Brief and guided review, ledger, concept page |
| `data/` | Dossiers with evidence logs, the ledger, the backtest (`data/backtest/`) |
| `work/facts.ts` | Prints every number the docs quote, from the dossiers |
| `docs/` | Concept card, walkthrough, lessons, submission text |

Run output (screenshots, videos, logs) lives outside the repo in `/bulk2/runs/linearcodereview/`.

## Sample data

Agent-written changes in our copy of the challenge's sample repository, each with its requirement ID (REQ-2283, REQ-2234, REQ-2129, REQ-2297 from the challenge, and REQ-2204, a mechanical change we added to show the light path). The backtest replays merged PRs of the same repository. Ledger history before them is synthetic and labelled in the UI.
