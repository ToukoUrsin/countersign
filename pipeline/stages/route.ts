import type { ChangeUnit, Recommendation, RiskFactor, RiskTier } from '../../shared/dossier';
import { trustLevels } from '../../server/ledger';
import type { Ctx } from '../lib/ctx';
import { areaOf, isTestPath } from '../lib/policy';
import type { UnitDraft } from './map';
import { unitChangedLines } from './map';
import type { ProveResult, recordProof } from './prove';

type Unit = ChangeUnit & { draft?: UnitDraft };
const ORDER: RiskTier[] = ['T0', 'T1', 'T2', 'T3'];
const maxTier = (a: RiskTier, b: RiskTier) => (ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b);

const FACT_LABEL: Record<string, string> = {
  publicApi: 'Public API',
  securitySensitive: 'Security-sensitive',
  behaviourChangeOutsideRequirement: 'Behaviour change nobody asked for',
  novelLogic: 'New logic',
  errorHandling: 'Changes error handling',
  dependency: 'Dependency / toolchain change',
};
const FACT_KEY: Record<string, RiskFactor['key']> = {
  publicApi: 'public-api',
  securitySensitive: 'security-sensitive',
  behaviourChangeOutsideRequirement: 'behaviour-change',
  novelLogic: 'novel-logic',
  errorHandling: 'error-handling',
  dependency: 'dependency',
};

export interface RouteInputs {
  units: Unit[];
  proof?: ReturnType<typeof recordProof>;
  proveRaw?: ProveResult | null;
  refScan: Map<string, { evidenceId: string; count: number }>;
  canaryMissed: { path: string; line: number }[];
  ambiguities: string[];
}

/**
 * Deterministic routing. The model supplied facts and the sandbox supplied measurements; this
 * function is the only place a tier is decided, and every point it adds is shown to the human.
 */
export function route(ctx: Ctx, inp: RouteInputs) {
  const d = ctx.dossier;
  const P = ctx.policy;
  const W = P.weights;
  const trust = trustLevels();
  const fileOfHunk = new Map<string, string>();
  for (const f of d.files) for (const h of f.hunks) fileOfHunk.set(h.id, f.path);
  const rules = new Set<string>();
  const areaLines = new Map<string, number>();

  for (const u of inp.units) {
    const F: RiskFactor[] = [];
    const add = (key: RiskFactor['key'], label: string, detail: string, points: number, evidenceIds?: string[]) => {
      if (points !== 0 || key === 'area-trust') F.push({ key, label, detail, points, evidenceIds });
    };
    const paths = [...new Set(u.hunkIds.map((h) => fileOfHunk.get(h)!))];
    const lines = unitChangedLines(ctx, u);
    const flags = new Set<string>();

    add(u.kind === 'docs' ? 'docs-only' : u.kind === 'test' ? 'test-only' : 'novel-logic', `Kind: ${u.kind}`, `Base weight for a ${u.kind} unit (policy weights.kind).`, W.kind[u.kind] ?? 1);

    for (const f of u.draft?.facts ?? []) {
      if (flags.has(f.key)) continue;
      flags.add(f.key);
      add(FACT_KEY[f.key], FACT_LABEL[f.key], f.why, (W as any)[f.key] ?? 0);
    }
    // area facts declared in the policy apply even if the mapper did not notice them
    const areas = [...new Set(paths.map((p) => areaOf(P, p)))];
    for (const a of areas) {
      if (a.securitySensitive && !flags.has('securitySensitive') && u.kind !== 'docs') {
        flags.add('securitySensitive');
        add('security-sensitive', 'Security-sensitive area', `Policy marks area "${a.name}" as security-sensitive.`, W.securitySensitive);
      }
      if (a.publicApi && !flags.has('publicApi') && u.kind !== 'docs') {
        flags.add('publicApi');
        add('public-api', 'Public API area', `Policy marks area "${a.name}" as public API.`, W.publicApi);
      }
    }
    if (!u.traced && u.kind !== 'docs') {
      flags.add('untraced');
      add('untraced', 'Not traceable to the requirement', 'The mapper found no acceptance criterion this unit serves.', W.untraced);
    }
    const scan = inp.refScan.get(u.id);
    if (scan) {
      const pts = scan.count >= W.blastRadius.manyAt ? W.blastRadius.many : scan.count >= W.blastRadius.someAt ? W.blastRadius.some : 0;
      add('blast-radius', `Referenced from ${scan.count} place(s)`, `git grep reference count for the symbol whose behaviour changes (≥${W.blastRadius.someAt} → +${W.blastRadius.some}, ≥${W.blastRadius.manyAt} → +${W.blastRadius.many}).`, pts, [scan.evidenceId]);
    }
    add('size', `${lines} changed lines`, `≥${W.size.mediumAt} lines → +${W.size.medium}, ≥${W.size.largeAt} → +${W.size.large}.`, u.kind === 'mechanical' || u.kind === 'generated' ? 0 : lines >= W.size.largeAt ? W.size.large : lines >= W.size.mediumAt ? W.size.medium : 0);

    let proof: string[] = [];
    // ablation
    const abl = u.hunkIds.map((h) => inp.proof?.ablation.get(h)).filter((x): x is { id: string; killed: boolean } => !!x);
    const survived = abl.filter((a) => !a.killed);
    if (survived.length) add('untested', `No test notices ${survived.length} hunk(s)`, 'Ablation: these hunks were reverted one at a time and the whole test project still passed.', W.untested, survived.map((a) => a.id));
    else if (abl.length) {
      add('untested', `Tests notice every hunk (${abl.length})`, 'Ablation: each hunk was reverted in turn and the build or a test failed every time.', W.ablationKilled, abl.map((a) => a.id));
      proof.push(...abl.map((a) => a.id));
    }
    // red→green for test units
    if (u.kind === 'test') {
      const rg = (inp.proof?.redGreen ?? []).filter((g) => paths.some((p) => p.startsWith(g.project + '/')));
      if (rg.length && rg.every((g) => g.ok)) {
        add('test-only', 'Tests fail on base, pass on head', 'Red→green: executed in the sandbox. The tests demonstrably detect the absence of the change, so their bodies need no line-by-line read.', W.redGreen, rg.map((g) => g.id));
        proof.push(...rg.map((g) => g.id));
      }
    }
    // mechanical clusters
    const cl = ctx.clusters.filter((c) => c.fileIds.every((fid) => d.files.find((f) => f.id === fid)!.hunks.every((h) => u.hunkIds.includes(h.id))));
    if (cl.length && (u.kind === 'mechanical' || u.kind === 'generated')) {
      const covered = new Set(cl.flatMap((c) => c.fileIds));
      const unitFiles = new Set(paths);
      const exceptions = [...unitFiles].filter((p) => !covered.has(d.files.find((f) => f.path === p)!.id));
      const vocab = [...new Set(cl.flatMap((c) => c.vocabulary))];
      const ev = ctx.addEvidence({
        kind: 'mechanical',
        strength: 'verified-static',
        title: `Mechanical rule holds for ${covered.size} of ${unitFiles.size} files`,
        conclusion: `In ${covered.size} of the ${unitFiles.size} files of this unit, every changed line is one of ${vocab.length} fixed line(s). ${exceptions.length ? `${exceptions.length} file(s) differ and are listed as exceptions.` : 'There are no exceptions.'}`,
        polarity: 'supports',
        command: `git diff ${ctx.mergeBase.slice(0, 8)}..${d.pr.headSha.slice(0, 8)} -- <files> | grep '^[+-]' | sort | uniq -c`,
        mechanical: { rule: vocab.join('\n'), matched: covered.size, total: unitFiles.size, exceptions: exceptions.slice(0, 20) },
        producedBy: 'intake/pre-cluster (deterministic)',
      });
      if (!exceptions.length) {
        add('mechanical-verified', `Same ${vocab.length}-line edit in ${covered.size} files`, 'Deterministic check: every changed line in every file of this unit matches the rule. Read the rule once instead of every file.', W.mechanicalVerified, [ev]);
        proof.push(ev);
      } else {
        add('mechanical-verified', `Same ${vocab.length}-line edit in ${covered.size} of ${unitFiles.size} files; ${exceptions.length} exception(s) listed`, 'Deterministic check: all but the listed files follow one rule. Read the rule once and open the exceptions.', u.kind === 'generated' ? Math.round(W.mechanicalVerified / 2) : 0, [ev]);
        // for expected-output files the passing golden test covers the exceptions too, so the rule may stand as proof next to it
        if (u.kind === 'generated') proof.push(ev);
      }
    }
    if (u.kind === 'generated') {
      const reg = (inp.proof?.regression ?? []).filter((g) => g.ok && paths.some((p) => p.startsWith(g.project + '/')));
      if (reg.length) {
        add('generated-verified', 'Golden files re-derived by a passing test run', 'These files are expected outputs. The test project that compares them against freshly generated output passes on the PR head.', W.generatedVerified, reg.map((g) => g.id));
        proof.push(...reg.map((g) => g.id));
      }
    }
    // Deterministic security hits come from the base policy. A rule marked `read`
    // floors its unit at T2 and therefore cannot be skipped or skimmed.
    const securityHits = (d.security?.hits ?? []).filter((h) => h.unitId === u.id || (!h.unitId && paths.includes(h.path)));
    const byRule = new Map<string, (typeof securityHits)[number][]>();
    for (const h of securityHits) byRule.set(h.ruleId, [...(byRule.get(h.ruleId) ?? []), h]);
    let securityRead = false;
    for (const [ruleId, hs] of byRule) {
      const h = hs[0];
      add('security-rule', `Security rule ${ruleId} matched ${hs.length} added line(s)`, `${h.description}; deterministic policy scan in ${h.path}:${h.line}.`, h.points, d.security?.evidenceIds);
      if (h.route === 'read') securityRead = true;
    }
    // findings and canaries on this unit
    const fs = d.findings.filter((f) => f.unitId === u.id && f.strength !== 'reasoned');
    const weakTest = fs.find((f) => /test|text only|never compil|weak|assert/i.test(`${f.title} ${f.body}`));
    if (fs.some((f) => f.severity === 'blocker')) add('behaviour-change', 'Has a verified blocker finding', fs.find((f) => f.severity === 'blocker')!.title, W.findingBlocker);
    else if (fs.some((f) => f.severity === 'major')) add('behaviour-change', 'Has a verified major finding', fs.find((f) => f.severity === 'major')!.title, W.findingMajor);
    const missed = inp.canaryMissed.filter((c) => paths.includes(c.path) && d.files.find((f) => f.path === c.path)!.hunks.some((h) => u.hunkIds.includes(h.id) && c.line >= h.newStart - 1 && c.line <= h.newStart + h.lines.length));
    if (missed.length) add('untested', `Self-test: ${missed.length} planted bug(s) went unnoticed here`, 'A bug planted in this unit was caught neither by the tests nor by the blind reviewer.', W.canaryMissed * missed.length);

    // area trust (the least-trusted area the unit touches)
    const tl = areas.map((a) => ({ a, t: trust.get(a.name)?.level ?? P.defaultTrustLevel })).sort((x, y) => x.t - y.t)[0];
    add('area-trust', `Area “${tl.a.name}” is ${P.trust.labels[tl.t]}`, `Trust level ${tl.t} of ${P.trust.labels.length - 1}, earned from the ledger: ${P.trust.effects[tl.t]}`, W.areaTrust[tl.t] ?? 0);
    for (const a of areas) areaLines.set(a.name, (areaLines.get(a.name) ?? 0) + lines / areas.length);

    const score = F.reduce((a, f) => a + f.points, 0);
    let tier: RiskTier = score >= P.tiers.T3 ? 'T3' : score >= P.tiers.T2 ? 'T2' : score >= P.tiers.T1 ? 'T1' : 'T0';
    const floor = (when: string, cond: boolean) => {
      const fl = P.floors.find((x) => x.when === when);
      if (!fl || !cond) return;
      const t = maxTier(tier, fl.min);
      if (t !== tier) {
        tier = t;
        rules.add(`${u.id}: floor "${when}" → at least ${fl.min}. ${fl.why}`);
      }
    };
    floor('untraced', flags.has('untraced'));
    floor('publicApi', flags.has('publicApi'));
    floor('securitySensitive', flags.has('securitySensitive'));
    floor('behaviourChangeOutsideRequirement', flags.has('behaviourChangeOutsideRequirement'));
    floor('noProof', proof.length === 0);
    floor('criticalityHigh', areas.some((a) => a.criticality === 'high') && u.kind !== 'test' && u.kind !== 'docs');
    if (securityRead) {
      tier = maxTier(tier, 'T2');
      rules.add(`${u.id}: security rule with route "read" → at least T2; read the matched added line(s).`);
    }
    if (tl.t === 0) tier = maxTier(tier, 'T2'); // probation: everything is read

    u.riskFactors = F.sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
    u.tier = tier;
    u.ask = tier === 'T0' ? 'none' : tier === 'T1' ? 'skim' : 'read';
    u.skipProof = tier === 'T0' ? { text: F.filter((f) => f.points < 0).map((f) => f.label).join(' · '), evidenceIds: [...new Set(proof)] } : undefined;
    // a verified finding that the tests are weak voids the skip those tests earned: a look for a minor one, a full read for a major one
    if (weakTest && u.ask === 'none') {
      const grave = weakTest.severity === 'major' || weakTest.severity === 'blocker';
      u.ask = grave ? 'read' : 'skim';
      u.tier = maxTier(u.tier, grave ? 'T2' : 'T1');
      u.skipProof = undefined;
      u.readingNote = `${weakTest.id} says these tests are weak, so the skip they earned is cancelled: ${grave ? 'read them' : 'look them over'} with that finding in mind.`;
      rules.add(`${u.id}: test skip cancelled by ${weakTest.id} (${weakTest.severity}); weak tests need a human ${grave ? 'read' : 'look'}`);
    }
  }

  // strip pipeline-only fields and publish units
  d.units = inp.units.map(({ draft: _d, ...u }) => u);
  const tiers = new Map(d.units.map((u) => [u.id, u.tier]));
  for (const g of d.diagrams) for (const n of g.nodes) if (n.unitId) n.tier = tiers.get(n.unitId);

  const sum = (ask: ChangeUnit['ask']) => d.units.filter((u) => u.ask === ask).reduce((a, u) => a + unitChangedLines(ctx, u), 0);
  const readLines = sum('read');
  const skimLines = sum('skim');
  const skipLines = sum('none');
  const openDecisions = d.refusals.length;
  const R = P.reading;
  const est = readLines / R.readLinesPerMinute + skimLines / R.skimLinesPerMinute + openDecisions * R.minutesPerDecision + d.findings.length * R.minutesPerFinding;
  const areaList = [...areaLines.entries()].sort((a, b) => b[1] - a[1]).map(([area]) => {
    const lvl = trust.get(area)?.level ?? P.defaultTrustLevel;
    return { area, trustLevel: lvl, trustLabel: P.trust.labels[lvl] };
  });
  const codeAreas = areaList.filter((a) => !['tests', 'docs', 'generated-snapshots'].includes(a.area));
  const minTrust = Math.min(...(codeAreas.length ? codeAreas : areaList).map((a) => a.trustLevel), P.trust.labels.length - 1);
  const rate = P.trust.spotCheckRate[minTrust] ?? 0.2;
  const roll = parseInt(d.pr.headSha.slice(0, 8), 16) / 0xffffffff;
  d.routing = {
    tier: d.units.reduce<RiskTier>((a, u) => maxTier(a, u.tier), 'T0'),
    score: Math.max(0, ...d.units.map((u) => u.riskFactors.reduce((a, f) => a + f.points, 0))),
    areas: areaList,
    readLines,
    skimLines,
    skipLines,
    totalLines: readLines + skimLines + skipLines,
    estMinutes: Math.max(1, Math.round(est)),
    spotCheck: {
      selected: roll < rate,
      reason: roll < rate ? `Sampled for a full read (rate ${Math.round(rate * 100)}% at trust level “${P.trust.labels[minTrust]}”). Read everything and record whether you found anything the AI missed — that is how the reviewer is audited.` : `Not sampled this time (rate ${Math.round(rate * 100)}% at trust level “${P.trust.labels[minTrust]}”; the draw is a deterministic function of the head commit).`,
    },
    policyVersion: d.routing.policyVersion,
    rulesFired: [...rules],
  };

  settleCriteria(ctx, inp);
  d.recommendation = recommend(ctx, inp);
}

/** Criteria that no independent probe decided fall back to weaker, clearly labelled support. */
function settleCriteria(ctx: Ctx, inp: RouteInputs) {
  const d = ctx.dossier;
  for (const c of d.requirement.criteria) {
    const testUnits = d.units.filter((u) => u.kind === 'test' && u.criteriaIds.includes(c.id));
    const fileOf = (hid: string) => d.files.find((f) => f.hunks.some((h) => h.id === hid))!.path;
    const rg = (inp.proof?.redGreen ?? []).filter((g) => g.ok && testUnits.some((u) => u.hunkIds.some((h) => fileOf(h).startsWith(g.project + '/'))));
    for (const g of rg) if (!c.evidenceIds.includes(g.id)) c.evidenceIds.push(g.id);
    if (c.kind === 'implicit') for (const g of inp.proof?.regression ?? []) if (g.ok && !c.evidenceIds.includes(g.id)) c.evidenceIds.push(g.id);
    if (c.status === 'unproven' && c.evidenceIds.length) {
      c.status = 'supported';
      c.note = (c.note ? c.note + ' ' : '') + (c.kind === 'implicit' ? 'Supported by the regression run only; no test targets this criterion specifically.' : 'Supported by the PR author’s own tests (which do fail without the change), not by an independent probe.');
    }
    if (c.status === 'unproven') c.note = (c.note ? c.note + ' ' : '') + 'No executed evidence addresses this criterion.';
    // a verified finding that names this criterion contests it: "proven" by one test cannot stand next to a reproduced counter-example
    const against = d.findings.filter((f) => f.strength !== 'reasoned' && (f.severity === 'blocker' || f.severity === 'major') && new RegExp(`\\b${c.id}\\b`).test(`${f.title} ${f.body} ${f.scenario ?? ''}`));
    if (against.length && c.status !== 'violated') {
      if (c.status === 'proven') c.status = 'supported';
      for (const f of against) for (const e of f.evidenceIds) if (!c.evidenceIds.includes(e)) c.evidenceIds.push(e);
      c.note = `${c.note ? c.note + ' ' : ''}Contested by ${against.map((f) => f.id).join(', ')} (${against[0].strength === 'executed' ? 'reproduced by running code' : 'verified in code'}): the tests that pass do not cover that case.`;
    }
  }
}

function recommend(ctx: Ctx, inp: RouteInputs): Recommendation {
  const d = ctx.dossier;
  const cr = d.requirement.criteria;
  const proven = cr.filter((c) => c.status === 'proven').length;
  const violated = cr.filter((c) => c.status === 'violated');
  const blockers = d.findings.filter((f) => f.severity === 'blocker' && f.strength !== 'reasoned');
  const reproducedMajor = d.findings.filter((f) => (f.severity === 'major' || f.severity === 'blocker') && f.strength === 'executed' && f.evidenceIds.some((id) => d.evidence.find((e) => e.id === id)?.kind === 'repro'));
  const executed = d.evidence.filter((e) => e.strength === 'executed').length;
  const st = d.selfTest;
  const weakSelfTest = !!st && st.planted >= 2 && st.caught / st.planted < 0.5;
  let verdict: Recommendation['verdict'];
  // the reading plan is void in these three cases whatever the verdict is (shared/gate.ts enforces it)
  const voidPlan = d.requirement.id === 'NONE' || executed === 0 || weakSelfTest;
  if (blockers.length || violated.length || reproducedMajor.length) verdict = 'changes-requested';
  else if (voidPlan) verdict = 'full-read-required';
  else if (d.refusals.length) verdict = 'accept-after-decisions';
  else verdict = 'accept';

  const parts = [
    cr.length ? `${proven} of ${cr.length} acceptance criteria are proven by execution` : 'There is no requirement to trace to',
    `${d.findings.length} finding(s)${d.findings.length ? ` (${d.findings.filter((f) => f.strength === 'executed').length} reproduced by running code)` : ''}`,
    `${d.refusals.length} decision(s) the AI will not make`,
    voidPlan ? `no line is skipped: you are asked to read all ${d.routing.totalLines} changed lines` : `you are asked to read ${d.routing.readLines} of ${d.routing.totalLines} changed lines`,
  ];
  const lead =
    verdict === 'changes-requested'
      ? blockers.length
        ? `Do not merge as is: ${blockers[0].title}.`
        : reproducedMajor.length
          ? `Do not merge as is: ${reproducedMajor[0].title} was reproduced by a failing test.`
          : `Do not merge as is: an independent test for ${violated.map((c) => c.id).join(', ')} fails.`
      : verdict === 'full-read-required'
        ? weakSelfTest
          ? 'The reviewer failed its own self-test on this change; read all of it.'
          : executed === 0
            ? 'Nothing could be executed for this change; read all of it.'
            : 'No requirement is linked; read all of it.'
        : verdict === 'accept-after-decisions'
          ? 'Acceptable once you have made the decisions below.'
          : 'No reason found not to accept.';

  const distrust: string[] = [];
  if (st && st.planted > 0 && st.caught < st.planted) distrust.push(`The self-test caught ${st.caught} of ${st.planted} planted bugs — a real bug of the kind that was missed could be in here too.`);
  if (!st || st.planted === 0) distrust.push('No reviewer self-test ran for this change, so the reviewer’s sensitivity here is unmeasured.');
  const onlyAuthor = cr.filter((c) => c.status === 'supported' && c.kind !== 'implicit');
  if (onlyAuthor.length) distrust.push(`${onlyAuthor.map((c) => c.id).join(', ')} rest on the author agent’s own tests, not on an independent probe.`);
  const unproven = cr.filter((c) => c.status === 'unproven');
  if (unproven.length) distrust.push(`${unproven.map((c) => c.id).join(', ')} ha${unproven.length > 1 ? 've' : 's'} no executed evidence at all.`);
  const surv = d.evidence.filter((e) => e.kind === 'ablation' && e.ablation && !e.ablation.killed).length;
  if (surv) distrust.push(`${surv} source hunk(s) can be reverted without any test failing — tests would not notice if that code were wrong.`);
  if (inp.ambiguities.length) distrust.push(`The requirement is ambiguous (${inp.ambiguities.length} open point(s)); we checked the change against our reading of it.`);
  if (ctx.policy.sandbox.framework) distrust.push(`Everything was executed on ${ctx.policy.sandbox.framework} / Linux only.`);
  distrust.push('If you find a defect in a unit we told you to skip or skim, record a spot-check miss: it means a proof we relied on was not enough, and trust in this area drops.');
  const why = verdict === 'changes-requested' && voidPlan ? (weakSelfTest ? ` The reviewer caught ${st!.caught} of ${st!.planted} bugs planted in this change, so its reading plan is void.` : executed === 0 ? ' Nothing could be executed, so the reading plan is void.' : ' No requirement is linked, so the reading plan is void.') : '';
  return { verdict, summary: `${lead}${why} ${parts.join('; ')}.`, distrustIf: distrust };
}

export { isTestPath };
