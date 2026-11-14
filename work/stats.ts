for (const n of [1,2,3,4]) {
  const d=JSON.parse(require("fs").readFileSync(`data/dossiers/toukoursin__junction26-messagepack-csharp__${n}/dossier.json`,"utf8"));
  const abl=d.evidence.filter((e:any)=>e.kind==='ablation'&&e.ablation);
  console.log(n,d.status,d.requirement.id,d.recommendation.verdict,`files ${d.pr.changedFiles} lines ${d.routing.totalLines} read ${d.routing.readLines} skim ${d.routing.skimLines} min ${d.routing.estMinutes}`,
   `find ${d.findings.length} exec ${d.findings.filter((f:any)=>f.strength==='executed').length} killed ${d.discarded.length}`,
   `ref ${d.refusals.length} blocking ${d.refusals.filter((r:any)=>r.blocking).length}`,
   `crit ${d.requirement.criteria.map((c:any)=>c.status[0]).join('')}`,
   `selftest ${d.selfTest?.caught}/${d.selfTest?.planted} tests ${d.selfTest?.canaries.filter((c:any)=>c.caughtByTests).length}`,
   `abl noticed ${abl.filter((e:any)=>e.ablation.killed).length}/${abl.length}`, `nc ${d.notChecked.length}`, `comment ${!!d.published||''}`);
}
