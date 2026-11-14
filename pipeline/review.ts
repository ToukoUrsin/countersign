#!/usr/bin/env bun
/**
 * Countersign review pipeline.
 *   bun pipeline/review.ts <github PR url> [--fresh all|stage[,stage]] [--no-publish]
 */
import { readFileSync } from 'node:fs';
import { consolidate } from './stages/consolidate';
import { append } from '../server/ledger';
import { Ctx } from './lib/ctx';
import { parsePrUrl, prepareRepo, slugOf } from './lib/gh';
import { makeWorktree } from './lib/sandbox';
import { log } from './lib/util';
import { explain } from './stages/explain';
import { emptyDossier, intake, intent } from './stages/intake';
import { mapUnits, scanReferences } from './stages/map';
import { preCluster } from './lib/diff';
import { loadPolicy } from './lib/policy';
import { setSdks } from './lib/sandbox';
import { probe, recordProbe } from './stages/probe';
import { planTests, prove, recordProof } from './stages/prove';
import { publish } from './stages/publish';
import { review, verify } from './stages/review';
import { route } from './stages/route';
import { recordSelfTest, selfTest } from './stages/selftest';
import { audit } from './stages/audit';
import { consistency } from './stages/consistency';
import { security } from './stages/security';
import { reproof } from './stages/reproof';
import { archivePrevious, carriedRounds, compactRound } from './lib/rounds';
import { provenance } from './stages/provenance';

export async function runReview(url: string, fresh: string[] = []) {
  const { owner, repo, number } = parsePrUrl(url);
  const slug = slugOf(owner, repo, number);
  const ctx = new Ctx(slug, fresh);
  const previous = archivePrevious(ctx);
  ctx.dossier = emptyDossier(slug, url);
  ctx.dossier.rounds = carriedRounds(previous);
  ctx.save();
  const d = ctx.dossier;

  try {
    await ctx.stage('intake', async () => {
      await intake(ctx, url);
      await makeWorktree(ctx.repoDir, ctx.wt('head'), d.pr.headSha);
    });
    if (!ctx.repoDir) throw new Error('intake failed');
    await ctx.stage('provenance', async () => provenance(ctx));

    const it = await ctx.stage('intent', () => intent(ctx));
    const ambiguities = it?.ambiguities ?? [];

    const units = (await ctx.stage('map', () => mapUnits(ctx))) ?? [];
    d.units = units;
    await ctx.stage('security', () => security(ctx, units));
    const refScan = await scanReferences(ctx, units);
    ctx.save();

    const plan = ['dotnet', 'python'].includes(ctx.policy.sandbox.adapter) ? planTests(ctx) : undefined;
    const prior = await ctx.stage('reproof', () => reproof(ctx, previous));

    // everything below runs concurrently: sandbox proofs, independent probes, review→verify, self-test
    let proof: ReturnType<typeof recordProof> | undefined;
    let canaryMissed: { path: string; line: number }[] = [];
    await Promise.all([
      ctx.stage('prove', async () => {
        const r = await prove(ctx);
        if (r) {
          proof = recordProof(ctx, r);
          const rg = proof.redGreen.filter((x) => x.ok).length;
          ctx.detail('prove', `red→green ${rg}/${proof.redGreen.length} · regression ${proof.regression.filter((x) => x.ok).length}/${proof.regression.length} · ablation ${[...proof.ablation.values()].filter((a) => a.killed).length}/${proof.ablation.size} hunks noticed by tests`);
        }
      }),
      ctx.stage('probe', async () => {
        const r = await probe(ctx, plan);
        if (r) {
          recordProbe(ctx, r);
          ctx.detail('probe', `${r.tests.length} independent test(s) · head ${r.head.outcome} · base ${r.base.outcome}`);
        }
      }),
      (async () => {
        const raws = await ctx.stage('review', () => review(ctx, ambiguities), {});
        await ctx.stage('verify', () => verify(ctx, raws ?? [], plan));
      })(),
      ctx.stage('selftest', async () => {
        const r = await selfTest(ctx, plan);
        if (r) canaryMissed = recordSelfTest(ctx, r).missed.map((c) => ({ path: c.path, line: c.line }));
      }),
    ]);

    const sev = { blocker: 0, major: 1, minor: 2, note: 3 } as const;
    const str = { executed: 0, 'verified-static': 1, reasoned: 2, none: 3 } as const;
    d.findings.sort((a, b) => sev[a.severity] - sev[b.severity] || str[a.strength] - str[b.strength]);
    for (const carried of prior?.carried ?? []) d.findings.push(carried);
    d.findings.sort((a, b) => sev[a.severity] - sev[b.severity] || str[a.strength] - str[b.strength]);
    d.findings.forEach((f, i) => (f.id = `FN${i + 1}`));

    await ctx.stage('explain', async () => {
      await consolidate(ctx);
      await explain(ctx);
    });
    await ctx.stage('route', async () => {
      route(ctx, { units, proof, refScan, canaryMissed, ambiguities });
      ctx.detail('route', `${d.routing.tier} · read ${d.routing.readLines}/${d.routing.totalLines} lines · ~${d.routing.estMinutes} min · advice: ${d.recommendation.verdict}`);
    });
    await ctx.stage('audit', () => audit(ctx));
    await ctx.stage('consistency', async () => {
      await consistency(ctx);
      // Audit findings are deliberately un-reproduced. Keep them visible, but route advice away from accept.
      if (d.audit?.issues.length && d.recommendation.verdict === 'accept') d.recommendation.verdict = 'accept-after-decisions';
    });
    // A review that could not do its core work is a failed review, never a pass: no advice, nothing to sign.
    const CORE = ['intent', 'map', 'review', 'verify', 'route'];
    const broken = d.stages.filter((s) => CORE.includes(s.name) && s.status === 'failed');
    if (broken.length) throw new Error(`${broken.map((s) => `“${s.title}”`).join(', ')} did not complete (${broken[0].detail ?? 'no detail'}). Nothing here can be signed; run the review again.`);
    d.status = 'ready';
    d.generatedAt = new Date().toISOString();
    d.rounds = [...(d.rounds ?? []), compactRound(d)];
    ctx.save();
    await ctx.stage('publish', () => publish(ctx));
    append({
      type: 'review',
      pr: d.id,
      actor: 'countersign',
      summary: `Dossier for ${d.id} (${d.requirement.id}): ${d.routing.tier}, advice ${d.recommendation.verdict}`,
      data: { areas: d.routing.areas.map((a) => a.area), tier: d.routing.tier, findings: d.findings.length, discarded: d.discarded.length, refusals: d.refusals.length, readLines: d.routing.readLines, totalLines: d.routing.totalLines, selfTest: d.selfTest ? `${d.selfTest.caught}/${d.selfTest.planted}` : null, round: d.rounds.length, reproof: d.reproof?.map((r) => `${r.findingId}:${r.status}`) ?? [] },
    });
    ctx.save();
    log('done', `${d.id} → ${d.recommendation.verdict} · ${d.routing.tier}`);
  } catch (e) {
    d.status = 'failed';
    d.recommendation.summary = `The review pipeline failed: ${(e as Error).message}`;
    ctx.save();
    log('fatal', String((e as Error).stack));
    throw e;
  }
  return slug;
}

/** Re-run only the deterministic security lens and routing on an existing dossier. */
export async function runSecurityOnly(url: string) {
  const { owner, repo, number } = parsePrUrl(url);
  const slug = slugOf(owner, repo, number);
  const ctx = new Ctx(slug, ['security', 'route']);
  const existing = readFileSync(`${ctx.dir}/dossier.json`, 'utf8');
  ctx.dossier = JSON.parse(existing);
  const prepared = await prepareRepo(ctx.dossier.pr);
  ctx.repoDir = prepared.repoDir;
  ctx.mergeBase = prepared.mergeBase;
  ctx.dossier.pr.baseSha = prepared.mergeBase;
  ctx.policy = await loadPolicy(ctx.repoDir, prepared.baseTip);
  setSdks(ctx.policy.sandbox.sdk);
  ctx.clusters = preCluster(ctx.dossier.files);
  const units = ctx.dossier.units;
  await ctx.stage('security', () => security(ctx, units));
  await ctx.stage('route', async () => {
    route(ctx, { units, proof: undefined, refScan: new Map(), canaryMissed: [], ambiguities: [] });
  });
  ctx.save();
  log('done', `${ctx.dossier.id} security-only → ${ctx.dossier.routing.tier} · ${ctx.dossier.security?.hits.length ?? 0} rule hit(s)`);
  return slug;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const url = args.find((a) => a.startsWith('http'));
  if (!url) {
    console.error('usage: bun pipeline/review.ts <github PR url> [--fresh all|stage,stage] [--no-publish]');
    process.exit(2);
  }
  const fi = args.indexOf('--fresh');
  const fresh = fi >= 0 ? (args[fi + 1] ?? 'all').split(',') : [];
  if (args.includes('--no-publish')) process.env.CS_NO_PUBLISH = '1';
  const run = args.includes('--security-only') ? runSecurityOnly(url) : runReview(url, fresh);
  run.then(
    () => process.exit(0),
    () => process.exit(1),
  );
}
