import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Dossier, ReproofEntry, Evidence } from '../../shared/dossier';
import type { Ctx } from '../lib/ctx';
import { makeWorktree, runTests } from '../lib/sandbox';

function projectOf(path: string) {
  const i = path.lastIndexOf('/');
  return i > 0 ? path.slice(0, i) : '';
}

function filterOf(command?: string, source?: string) {
  const m = command?.match(/--filter\s+"([^"]+)"/);
  if (m) return m[1];
  const cls = source?.match(/class\s+(\w+)/)?.[1];
  return cls ? `FullyQualifiedName~${cls}` : undefined;
}

export interface ReproofResult {
  entries: ReproofEntry[];
  carried: Dossier['findings'];
}

/** Re-run the exact source and command recorded in the previous round on the new head. */
export async function reproof(ctx: Ctx, previous?: Dossier): Promise<ReproofResult> {
  const empty: ReproofResult = { entries: [], carried: [] };
  if (!previous) return empty;
  const candidates = previous.findings.flatMap((finding) => {
    const ev = previous.evidence.find((e) => finding.evidenceIds.includes(e.id) && e.kind === 'repro' && e.probeSource);
    return ev ? [{ finding, ev }] : [];
  });
  if (!candidates.length) return empty;
  const fromRound = previous.rounds?.length || 1;
  const adapter = ctx.policy.sandbox.adapter;
  for (let i = 0; i < candidates.length; i++) {
    const { finding, ev } = candidates[i];
    const src = ev.probeSource!;
    const project = projectOf(src.path);
    const entryBase = { fromRound, findingId: finding.id, title: finding.title };
    if (!project || !src.code.trim() || !existsSync(resolve(ctx.wt('head'), project))) {
      const id = ctx.addEvidence({ kind: 'repro', strength: 'executed', title: `Re-proof could not run: ${finding.id}`, conclusion: `The previous reproduction for ${finding.id} could not be applied on ${ctx.dossier.pr.headSha.slice(0, 7)}: its recorded test project or source was unavailable.`, polarity: 'neutral', command: ev.command, producedBy: 'reproof' });
      empty.entries.push({ ...entryBase, status: 'could-not-rerun', evidenceId: id, reason: 'test project or source unavailable' });
      continue;
    }
    let outcome: 'fixed' | 'still-fails' | 'could-not-rerun';
    let run;
    try {
      const wt = await makeWorktree(ctx.repoDir, ctx.wt(`reproof-${i}`), ctx.dossier.pr.headSha);
      const target = resolve(wt, src.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, src.code);
      run = await runTests({ adapter, worktree: wt, project, filter: filterOf(ev.command, src.code), framework: ctx.policy.sandbox.framework || undefined, evDir: ctx.evDir, name: `reproof-${i + 1}`, label: `re-proof of ${finding.id} on new head`, sha: ctx.dossier.pr.headSha });
      outcome = run.outcome === 'pass' ? 'fixed' : run.outcome === 'fail' ? 'still-fails' : 'could-not-rerun';
    } catch (e) {
      outcome = 'could-not-rerun';
    }
    const id = ctx.addEvidence({
      kind: 'repro', strength: 'executed', title: `Re-proof ${finding.id}: ${outcome}`,
      conclusion: outcome === 'fixed' ? `${finding.id} of round ${fromRound}: its failing test passes on ${ctx.dossier.pr.headSha.slice(0, 7)}.` : outcome === 'still-fails' ? `${finding.id} of round ${fromRound}: the same test still fails on ${ctx.dossier.pr.headSha.slice(0, 7)}.` : `${finding.id} of round ${fromRound}: the same test could not be rerun on ${ctx.dossier.pr.headSha.slice(0, 7)}.`,
      polarity: outcome === 'fixed' ? 'supports' : outcome === 'still-fails' ? 'undermines' : 'neutral', command: ev.command, head: run, probeSource: src, producedBy: 'reproof (unchanged prior reproduction)',
    });
    empty.entries.push({ ...entryBase, status: outcome, evidenceId: id, reason: outcome === 'could-not-rerun' ? 'sandbox run did not produce a usable pass/fail result' : undefined });
    if (outcome === 'still-fails') empty.carried.push({ ...finding, evidenceIds: [id], strength: 'executed', reproduced: true });
  }
  ctx.dossier.reproof = empty.entries;
  ctx.detail('reproof', `${empty.entries.filter((x) => x.status === 'fixed').length} fixed · ${empty.entries.filter((x) => x.status === 'still-fails').length} still-fails · ${empty.entries.filter((x) => x.status === 'could-not-rerun').length} could-not-rerun`);
  return empty;
}
