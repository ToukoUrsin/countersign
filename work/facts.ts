// bun work/facts.ts [dataDir=data] — every number the docs quote, read from the dossiers the product serves.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import type { Dossier } from '../shared/dossier';
import { fullReadReason } from '../shared/gate';

const dir = process.argv[2] ?? 'data';
const ds: Dossier[] = readdirSync(`${dir}/dossiers`)
  .sort()
  .map((n) => `${dir}/dossiers/${n}/dossier.json`)
  .filter(existsSync)
  .map((p) => JSON.parse(readFileSync(p, 'utf8')));
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const min = (ms: number) => (ms / 60000).toFixed(1);

for (const d of ds) {
  const abl = d.evidence.filter((e) => e.kind === 'ablation' && e.ablation);
  const wall = d.stages.length ? Math.max(...d.stages.filter((s) => s.startedAt && s.durationMs).map((s) => new Date(s.startedAt!).getTime() + s.durationMs!)) - Math.min(...d.stages.filter((s) => s.startedAt).map((s) => new Date(s.startedAt!).getTime())) : 0;
  const cost = sum(d.stages.map((s) => s.costUsd ?? 0));
  const st = d.selfTest;
  console.log(
    [
      `${d.pr.repo}#${d.pr.number} ${d.requirement.id} ${d.status} @${d.pr.headSha.slice(0, 7)}`,
      `  files ${d.pr.changedFiles} lines ${d.routing.totalLines}: read ${d.routing.readLines} skim ${d.routing.skimLines} skip ${d.routing.skipLines} · ${d.routing.tier} · ~${d.routing.estMinutes} min · advice ${d.recommendation.verdict}`,
      `  full read: ${fullReadReason(d) ?? 'no'} · spot check drawn: ${d.routing.spotCheck.selected}`,
      `  criteria ${d.requirement.criteria.map((c) => c.status).join(',')}`,
      `  findings ${d.findings.length} (executed ${d.findings.filter((f) => f.strength === 'executed').length}, static ${d.findings.filter((f) => f.strength === 'verified-static').length}; ${d.findings.map((f) => f.severity[0]).join('')}) · killed ${d.discarded.length} (${d.discarded.map((x) => x.reason).join(',')})`,
      `  refusals ${d.refusals.length} blocking ${d.refusals.filter((r) => r.blocking).length} · options not implemented ${sum(d.refusals.map((r) => r.options.filter((o) => o.implemented === false).length))}`,
      `  self-test ${st ? `${st.caught}/${st.planted} reviewer, tests ${st.canaries.filter((c) => c.caughtByTests).length}, kinds ${st.canaries.map((c) => `${c.kind ?? '?'}:${c.caughtByReviewer ? 'R' : '-'}${c.caughtByTests ? 'T' : '-'}`).join(' ')}, planter ${st.planterModel ?? '?'} (${st.planterFamily ?? '?'})` : 'none'}`,
      `  audit ${d.audit ? `${d.audit.model} lines ${d.audit.linesAudited} units ${d.audit.unitsAudited} issues ${d.audit.issues.length}` : 'none'} · consistency fixed ${d.consistency ? d.consistency.fixed.length : 'none'}`,
      `  ablation noticed ${abl.filter((e) => e.ablation!.killed).length}/${abl.length} · not checked ${d.notChecked.length}`,
      `  wall ${min(wall)} min · metered $${cost.toFixed(2)} (${d.stages.filter((s) => s.costUsd).map((s) => `${s.name} ${s.costUsd!.toFixed(2)}`).join(', ')}) · no metered cost: ${d.stages.filter((s) => !s.costUsd && s.status === 'done').map((s) => s.name).join(' ')} · stages not done: ${d.stages.filter((s) => s.status !== 'done').map((s) => `${s.name}:${s.status}`).join(' ') || 'none'}`,
    ].join('\n'),
  );
}
const t = (f: (d: Dossier) => number) => sum(ds.map(f));
console.log('\nTOTAL', ds.length, 'PRs');
console.log(`lines ${t((d) => d.routing.totalLines)}: read ${t((d) => d.routing.readLines)} skim ${t((d) => d.routing.skimLines)} skip ${t((d) => d.routing.skipLines)} · read share ${((100 * t((d) => d.routing.readLines)) / t((d) => d.routing.totalLines)).toFixed(1)}%`);
console.log(`after full-read rules: read ${t((d) => (fullReadReason(d) ? d.routing.totalLines : d.routing.readLines))}`);
console.log(`findings shown ${t((d) => d.findings.length)} executed ${t((d) => d.findings.filter((f) => f.strength === 'executed').length)} killed ${t((d) => d.discarded.length)} · raised ${t((d) => d.findings.length + d.discarded.length)}`);
const reasons: Record<string, number> = {};
for (const d of ds) for (const x of d.discarded) reasons[x.reason] = (reasons[x.reason] ?? 0) + 1;
console.log('killed by reason', JSON.stringify(reasons));
console.log(`refusals ${t((d) => d.refusals.length)} blocking ${t((d) => d.refusals.filter((r) => r.blocking).length)}`);
console.log(`self-test planted ${t((d) => d.selfTest?.planted ?? 0)} reviewer ${t((d) => d.selfTest?.caught ?? 0)} tests ${t((d) => d.selfTest?.canaries.filter((c) => c.caughtByTests).length ?? 0)}`);
const kinds: Record<string, [number, number]> = {};
for (const d of ds) for (const c of d.selfTest?.canaries ?? []) { const k = (kinds[c.kind ?? '?'] ??= [0, 0]); k[1]++; if (c.caughtByReviewer) k[0]++; }
console.log('self-test by kind (caught/planted)', JSON.stringify(kinds));
console.log(`audit lines ${t((d) => d.audit?.linesAudited ?? 0)} issues ${t((d) => d.audit?.issues.length ?? 0)}`);
console.log(`criteria ${t((d) => d.requirement.criteria.length)} proven ${t((d) => d.requirement.criteria.filter((c) => c.status === 'proven').length)}`);
