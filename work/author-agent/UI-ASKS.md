# UI asks: fix loop fields

The dossier contract now has three optional, additive fields. Existing dossiers omit them.

- `rounds`: compact history for each reviewed head. Render the commit short SHA, timestamp, verdict, finding summaries (id, title, severity, strength), and any `fixRequest` (round, comment URL, reproduced finding ids). Example: `rounds[0].headSha = 9df83c3…`, verdict `changes-requested`, `findings[0] = { id: "FN1", title: "New filter silently drops Error-level diagnostics…", severity: "major", strength: "executed" }`.
- `reproof`: results carried from the previous round. Render status chips `fixed`, `still-fails`, or `could-not-rerun`, plus the evidence link. Example: `{ fromRound: 1, findingId: "FN1", title: "New filter silently drops Error-level diagnostics…", status: "fixed", evidenceId: "E1" }` means the unchanged failing test now passes on the new head.
- `provenance`: author session context, never evidence. Render the Entire tool label, commit/session, agent/model, prompt, tool-call count, test commands and files, with a clear “author account / context only” label. Example: `{ tool: "entire", role: "author-context-only", commits: [{ sha: "<fix sha>", sessionId: "local-entire-…", agent: "author-agent", testCommands: [{ cmd: "dotnet test …", lastOutcome: "observed in author session" }] }] }`.

The server serves these fields unchanged from `/api/dossiers/:slug`; no `web/src` changes are included in this task.
