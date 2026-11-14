import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Provenance, ProvenanceCommit } from '../../shared/dossier';
import type { Ctx } from '../lib/ctx';

/** Read the author's local Entire checkpoint export, if the author-agent run produced one. */
export function provenance(ctx: Ctx) {
  const p = resolve('/bulk2/runs/linearcodereview/author-agent/provenance', `${ctx.dossier.pr.headSha}.json`);
  if (!existsSync(p)) return;
  try {
    const j = JSON.parse(readFileSync(p, 'utf8')) as ProvenanceCommit & { crossCheck?: string };
    const commit: ProvenanceCommit = { sha: j.sha, sessionId: j.sessionId, agent: j.agent, model: j.model, prompt: j.prompt.slice(0, 1000), toolCalls: j.toolCalls, testCommands: j.testCommands ?? [], files: j.files ?? [] };
    const out: Provenance = { tool: 'entire', commits: [commit], crossCheck: j.crossCheck, role: 'author-context-only' };
    ctx.dossier.provenance = out;
    ctx.detail('provenance', `Entire checkpoint ${commit.sessionId} linked to ${commit.sha.slice(0, 7)}; author context only`);
  } catch (e) {
    ctx.dossier.notChecked.push({ what: 'Author-agent provenance', why: `An Entire checkpoint export was present but unreadable: ${(e as Error).message.slice(0, 120)}` });
  }
}
