import type { Diagram, Dossier, FixRequest } from '../../shared/dossier';
import type { Ctx } from '../lib/ctx';
import { postComment, setStatus, upsertComment } from '../lib/gh';
import { append } from '../../server/ledger';

export const publicUrl = () => (process.env.CS_PUBLIC_URL || 'http://localhost:4317').replace(/\/$/, '');

const ADVICE: Record<string, string> = {
  accept: 'accept',
  'accept-after-decisions': 'accept after the owner’s decisions',
  'changes-requested': 'request changes',
  'full-read-required': 'full human read required',
};
const STATUS_ICON: Record<string, string> = { proven: '🟢', supported: '🟡', unproven: '⚪', violated: '🔴' };
const STRENGTH: Record<string, string> = { executed: 'reproduced by running code', 'verified-static': 'verified in code', reasoned: 'reasoning only', none: 'no evidence' };

function mermaid(g: Diagram) {
  const id = (s: string) => 'n' + s.replace(/[^A-Za-z0-9]/g, '_');
  const esc = (s: string) => s.replace(/["\[\]{}|<>]/g, ' ');
  const lines = ['flowchart LR'];
  const cls: Record<string, string[]> = {};
  const emit = (n: Diagram['nodes'][number]) => {
    (cls[n.role] ??= []).push(id(n.id));
    return `    ${id(n.id)}["${esc(n.label)}${n.sublabel ? `<br/><small>${esc(n.sublabel)}</small>` : ''}"]`;
  };
  for (const grp of g.groups ?? []) {
    lines.push(`  subgraph g_${id(grp.id)}["${esc(grp.label)}"]`);
    for (const n of g.nodes.filter((n) => n.group === grp.id)) lines.push(emit(n));
    lines.push('  end');
  }
  for (const n of g.nodes.filter((n) => !n.group || !(g.groups ?? []).some((x) => x.id === n.group))) lines.push(emit(n));
  for (const e of g.edges) lines.push(`  ${id(e.from)} ${e.role === 'broken' ? '-.->' : e.role === 'new' ? '==>' : '-->'}${e.label ? `|${esc(e.label)}|` : ''} ${id(e.to)}`);
  lines.push('  classDef changed fill:#fde68a,stroke:#b45309,color:#111', '  classDef added fill:#bbf7d0,stroke:#15803d,color:#111', '  classDef affected fill:#fff,stroke:#b45309,stroke-dasharray:4 3,color:#111', '  classDef test fill:#dbeafe,stroke:#1d4ed8,color:#111', '  classDef requirement fill:#ede9fe,stroke:#6d28d9,color:#111', '  classDef removed fill:#fecaca,stroke:#b91c1c,color:#111');
  for (const [role, ids] of Object.entries(cls)) if (['changed', 'added', 'affected', 'test', 'requirement', 'removed'].includes(role)) lines.push(`  class ${ids.join(',')} ${role}`);
  return lines.join('\n');
}

export function dossierMarkdown(d: Dossier) {
  const url = `${publicUrl()}/pr/${d.slug}`;
  const cr = d.requirement.criteria;
  const proven = cr.filter((c) => c.status === 'proven').length;
  const st = d.selfTest;
  const out: string[] = [];
  out.push(`## Countersign dossier · ${d.requirement.id}`);
  out.push(`**${d.story.headline || d.pr.title}**`);
  out.push('');
  out.push(`> **AI advice: ${ADVICE[d.recommendation.verdict]}.** ${d.recommendation.summary}`);
  out.push(`> The AI does not approve. A named human countersigns — status \`countersign/sign-off\` stays pending until then.`);
  out.push('');
  out.push(`| Criteria proven | You read | Findings | Decisions for you | Reviewer self-test |`);
  out.push(`|---|---|---|---|---|`);
  out.push(`| **${proven} / ${cr.length}** | **${d.routing.readLines} of ${d.routing.totalLines}** changed lines · ~${d.routing.estMinutes} min | **${d.findings.length}** (${d.findings.filter((f) => f.strength === 'executed').length} reproduced) · ${d.discarded.length} killed by verifier | **${d.refusals.length}** | ${st && st.planted ? `**${st.caught} / ${st.planted}** planted bugs caught` : 'not run'} |`);
  out.push('');
  out.push(`### Requirement trace`);
  for (const c of cr) out.push(`- ${STATUS_ICON[c.status]} **${c.id}** ${c.text} — _${c.status}_${c.evidenceIds.length ? ` (${c.evidenceIds.join(', ')})` : ''}`);
  if (d.refusals.length) {
    out.push('', `### Decisions the AI refused to make`);
    for (const r of d.refusals) out.push(`- **${r.question}**${r.blocking ? ' _(blocking)_' : ''}<br/>${r.why}`);
  }
  if (d.findings.length) {
    out.push('', `### Findings (verified before posting)`);
    for (const f of d.findings) out.push(`- \`${f.severity}\` **${f.title}** — ${STRENGTH[f.strength]}${f.refs[0] ? ` · \`${f.refs[0].path}:${f.refs[0].startLine}\`` : ''}`);
  }
  const read = d.units.filter((u) => u.ask === 'read');
  const skip = d.units.filter((u) => u.ask === 'none');
  out.push('', `### Reading plan`);
  for (const u of read) out.push(`- **Read** \`${u.tier}\` ${u.title} (+${u.additions} −${u.deletions})`);
  for (const u of d.units.filter((u) => u.ask === 'skim')) out.push(`- Skim \`${u.tier}\` ${u.title} (+${u.additions} −${u.deletions})`);
  for (const u of skip) out.push(`- Skip \`${u.tier}\` ${u.title} (+${u.additions} −${u.deletions}, ${u.fileCount} file(s)) — ${u.skipProof?.text ?? 'covered by proof'}`);
  const g = d.diagrams.find((x) => x.kind === 'change-map');
  if (g && g.nodes.length) out.push('', `<details><summary>What it builds and what it affects</summary>`, '', '```mermaid', mermaid(g), '```', '', `</details>`);
  if (d.notChecked.length) {
    out.push('', `<details><summary>Not checked (${d.notChecked.length})</summary>`, '');
    for (const n of d.notChecked) out.push(`- **${n.what}** — ${n.why}`);
    out.push('', `</details>`);
  }
  out.push('', `[Open the full dossier, evidence and sign-off →](${url})`);
  out.push('', `<sub>Countersign · policy ${d.routing.policyVersion} · head \`${d.pr.headSha.slice(0, 8)}\` · every executed claim lists the command to re-run it</sub>`);
  return out.join('\n');
}

export async function publish(ctx: Ctx) {
  const d = ctx.dossier;
  if (process.env.CS_NO_PUBLISH === '1') {
    ctx.skip('publish', 'CS_NO_PUBLISH=1');
    return;
  }
  const url = `${publicUrl()}/pr/${d.slug}`;
  const comment = await upsertComment(d.pr, dossierMarkdown(d));
  const open = d.refusals.length;
  await setStatus(d.pr, 'pending', `Awaiting a named human: read ${d.routing.readLines}/${d.routing.totalLines} lines, ${open} decision(s), ${d.findings.length} finding(s)`, url);
  ctx.detail('publish', comment);
  if (ctx.policy.fixRequests === 'auto') {
    const request = await postFixRequest(ctx.dossier);
    if (request) {
      const round = ctx.dossier.rounds?.at(-1);
      if (round) round.fixRequest = request;
      append({ type: 'fix-request', pr: ctx.dossier.id, actor: 'countersign', summary: `Fix request for ${ctx.dossier.id} round ${request.round}`, data: { round: request.round, findings: request.findings.map((f) => f.findingId), commentUrl: request.commentUrl } });
      ctx.save();
      ctx.detail('publish', `${comment}; fix request ${request.commentUrl}`);
    }
  }
}

/** Build and post an evidence-only request for the author agent. */
export async function postFixRequest(d: Dossier): Promise<FixRequest | undefined> {
  const round = d.rounds?.length || 1;
  if (round > 2) return undefined;
  const reproduced = d.findings.flatMap((f) => {
    const e = d.evidence.find((x) => f.evidenceIds.includes(x.id) && x.kind === 'repro' && x.strength === 'executed' && x.probeSource);
    return e ? [{ findingId: f.id, title: f.title, severity: f.severity, evidenceId: e.id, testSource: e.probeSource!.code, command: e.command }] : [];
  });
  if (!reproduced.length) return undefined;
  const contextFindings = d.findings.filter((f) => !reproduced.some((x) => x.findingId === f.id)).map((f) => ({ findingId: f.id, title: f.title }));
  const request: FixRequest = { round, at: new Date().toISOString(), findings: reproduced, contextFindings, decisionsStayWithHuman: d.refusals.length > 0 };
  const lines = reproduced.map((f) => `### ${f.findingId} · ${f.severity} · ${f.title}\nFailing test (${f.evidenceId}):\n\n\`\`\`\n${f.testSource}\n\`\`\`\nRun it with:\n\`\`\`sh\n${f.command ?? '(command recorded in the dossier)'}\n\`\`\``).join('\n\n');
  const context = contextFindings.length ? `\n\nContext only (no order): ${contextFindings.map((f) => `${f.findingId} ${f.title}`).join('; ')}.` : '';
  const body = `## Countersign fix request · round ${round}\n\nThe following reproduced tests fail on commit \`${d.pr.headSha.slice(0, 7)}\`. Make the smallest correct change that makes each test pass, and add the regression tests to the suite. Do not weaken or delete tests.\n\n${lines}${context}\n\nOpen decisions stay with the human; do not resolve them. Reasoned findings without a failing test are context, not orders.\n\n<!-- countersign-fix-request-json\n${JSON.stringify(request)}\n-->`;
  request.commentUrl = await postComment(d.pr, body, '<!-- countersign-fix-request -->');
  return request;
}
