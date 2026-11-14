# Running Countersign

The commands below assume a clean clone and a shell in its root. The review pipeline needs Bun, Docker and the GitHub CLI; the UI-only demo server needs Bun. `bun install` installs the root packages and `cd web && bun install` installs the Vite app packages. The production bundle is built with Vite directly so the UI can ship while the app type-check is completed independently.

```sh
git clone https://github.com/ToukoUrsin/countersign.git
cd countersign
bun install
cd web && bun install && bunx vite build && cd ..
```

For a normal install, create `work/server.env` (it is ignored) with `CS_BASIC` as `username:password` for write actions and `CS_PUBLIC_URL` as the public URL. The optional variables are:

| Variable | Purpose |
| --- | --- |
| `CS_DATA` | Data directory; defaults to `data/`. |
| `CS_DIST` | Built web directory; defaults to `web/dist`. |
| `CS_PUBLIC_URL` | URL placed in GitHub statuses and attestation links. |
| `CS_BASIC` | Basic-auth `username:password` for write actions on a tunnel. |
| `CS_NO_PUBLISH=1` | Disable GitHub status/comment publishing (use for local demos). |
| `CS_DEMO_SIGNERS=1` | Use the three synthetic reviewers instead of a GitHub login. |
| `CS_LIVE_BUDGET` | Maximum live Gemini explanations for this process. |
| `GEMINI_API_KEY` | Gemini key for live diagrams and Ask; omit to disable live explanations. |
| `CS_WEBHOOK_SECRET` | Secret used to verify GitHub pull-request webhooks. |

Start the server after building:

```sh
PORT=4317 bun server/index.ts
```

With `gh` authenticated and Docker available, a review can be started from the inbox by pasting a GitHub pull-request URL. The same operation is `curl -X POST http://localhost:4317/api/reviews -H 'content-type: application/json' -d '{"prUrl":"https://github.com/OWNER/REPO/pull/1"}'`. The pipeline uses Docker for the sandbox: .NET reviews use `sandbox/Dockerfile`, Python reviews use `sandbox/python.Dockerfile`; those images run tests with no network. A machine running only the server and viewing existing dossiers does not need Docker.

For a throwaway read-and-try copy, use the supplied judge script. It resets its own data directory, never posts to GitHub and exposes synthetic signers:

```sh
work/judge-instance.sh 4318
open http://localhost:4318
```

The public demo is deployed with `deploy/deploy.sh`. That command refreshes `deploy/demo-data/` from the clean backup, captures read-only GitHub snapshots, builds the Bun image, updates Fly and smoke-tests `/api/live` and `/api/dossiers`. The public image sets `CS_PUBLIC_DEMO=1`, `CS_NO_PUBLISH=1`, `CS_DEMO_SIGNERS=1` and a low `CS_LIVE_BUDGET`; it cannot start a review or call GitHub. Its visitor data resets at machine start and every 30 minutes after a signature.
