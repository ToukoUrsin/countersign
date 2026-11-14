import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FileDiff, Hunk, RunResult } from '../../shared/dossier';
import type { Ctx } from '../lib/ctx';
import { changedLines, hunkPatch } from '../lib/diff';
import { isTestPath } from '../lib/policy';
import { describeCommand, makeWorktree, runTests } from '../lib/sandbox';
import { stackAdapter, type StackTestPlan } from '../lib/adapter';
import { exec, log, pool } from '../lib/util';

export type TestProject = import('../lib/adapter').StackTestProject;
export type TestPlan = StackTestPlan;

export function planTests(ctx: Ctx): TestPlan {
  return stackAdapter(ctx.policy.sandbox.adapter).plan(ctx);
}

export interface ProveResult {
  plan: TestPlan;
  redGreen: { project: string; filter: string; base: RunResult; head: RunResult }[];
  regression: { project: string; base: RunResult; head: RunResult }[];
  ablations: { hunkId: string; path: string; project: string; result: RunResult }[];
  ablationSkipped: string[];
}

export function ablationTargets(ctx: Ctx): { f: FileDiff; h: Hunk }[] {
  const out: { f: FileDiff; h: Hunk }[] = [];
  const sourceExtensions = stackAdapter(ctx.policy.sandbox.adapter).sourceExtensions;
  for (const f of ctx.dossier.files) {
    if (isTestPath(ctx.policy, f.path) || /\.(md|txt)$/i.test(f.path) || f.status === 'deleted') continue;
    if (!sourceExtensions.test(f.path) && !/\.(ts|tsx|js|py|go|java)$/i.test(f.path)) continue;
    for (const h of f.hunks) out.push({ f, h });
  }
  return out.sort((a, b) => changedLines(b.h) - changedLines(a.h));
}

/** All sandbox execution that needs no model: the numbers a human can re-run. */
export async function prove(ctx: Ctx): Promise<ProveResult | null> {
  const d = ctx.dossier;
  const pol = ctx.policy.sandbox;
  if (!['dotnet', 'python'].includes(pol.adapter)) {
    ctx.skip('prove', `no sandbox adapter for this repo (policy sandbox.adapter = ${pol.adapter})`);
    d.notChecked.push({ what: 'Nothing was executed', why: 'This repository has no sandbox adapter configured, so there is no red→green, regression or ablation evidence. All claims rest on reading the code.' });
    return null;
  }
  return ctx.cached('prove', async () => {
    const plan = planTests(ctx);
    const adapter = stackAdapter(pol.adapter);
    const fw = pol.framework || undefined;
    const base = ctx.mergeBase;
    const head = d.pr.headSha;
    if (!plan.projects.length) return { plan, redGreen: [], regression: [], ablations: [], ablationSkipped: [] };

    await makeWorktree(ctx.repoDir, ctx.wt('base'), base);
    await makeWorktree(ctx.repoDir, ctx.wt('base-prtests'), base, { from: head, paths: plan.overlayPaths });

    const targets = ablationTargets(ctx);
    const chosen = targets.slice(0, pol.maxAblations);
    const skipped = targets.slice(pol.maxAblations).map((t) => t.h.id);
    const ablProject = plan.primary!;

    const jobs: (() => Promise<void>)[] = [];
    const res: ProveResult = { plan, redGreen: [], regression: [], ablations: [], ablationSkipped: skipped };

    for (const p of plan.projects) {
      const key = p.project.replace(/[^A-Za-z0-9]+/g, '_');
      if (p.prFilter) {
        const rg = { project: p.project, filter: p.prFilter, base: null as unknown as RunResult, head: null as unknown as RunResult };
        res.redGreen.push(rg);
        jobs.push(async () => {
          rg.head = await runTests({ adapter: adapter.id, worktree: ctx.wt('head'), project: p.project, filter: p.prFilter, framework: fw, evDir: ctx.evDir, name: `redgreen-head-${key}`, label: 'PR head', sha: head });
        });
        jobs.push(async () => {
          rg.base = await runTests({ adapter: adapter.id, worktree: ctx.wt('base-prtests'), project: p.project, filter: p.prFilter, framework: fw, evDir: ctx.evDir, name: `redgreen-base-${key}`, label: 'base source + the PR’s tests', sha: base });
        });
      }
      const reg = { project: p.project, base: null as unknown as RunResult, head: null as unknown as RunResult };
      res.regression.push(reg);
      // separate worktrees so the filtered and the full run never share obj/bin
      jobs.push(async () => {
        const wt = await makeWorktree(ctx.repoDir, ctx.wt(`reg-head-${key}`), head);
        reg.head = await runTests({ adapter: adapter.id, worktree: wt, project: p.project, framework: fw, evDir: ctx.evDir, name: `regression-head-${key}`, label: 'PR head, full project', sha: head });
      });
      jobs.push(async () => {
        const wt = await makeWorktree(ctx.repoDir, ctx.wt(`reg-base-${key}`), base);
        reg.base = await runTests({ adapter: adapter.id, worktree: wt, project: p.project, framework: fw, evDir: ctx.evDir, name: `regression-base-${key}`, label: 'base, full project', sha: base });
      });
    }
    for (const t of chosen) {
      jobs.push(async () => {
        const name = `ablation-${t.h.id.replace('.', '-')}`;
        const wt = await makeWorktree(ctx.repoDir, ctx.wt(name), head);
        const patch = resolve(ctx.runDir, `${name}.patch`);
        writeFileSync(patch, hunkPatch(t.f, t.h));
        const ap = await exec('git', ['apply', '-R', '--whitespace=nowarn', patch], { cwd: wt });
        if (ap.code !== 0) {
          log('prove', `ablation ${t.h.id}: could not revert hunk (${ap.stderr.slice(0, 120)})`);
          res.ablationSkipped.push(t.h.id);
          return;
        }
        const result = await runTests({ adapter: adapter.id, worktree: wt, project: ablProject, framework: fw, evDir: ctx.evDir, name, label: `PR head with hunk ${t.h.id} reverted`, sha: head });
        res.ablations.push({ hunkId: t.h.id, path: t.f.path, project: ablProject, result });
      });
    }
    await pool(jobs, Number(process.env.CS_SANDBOX_PARALLEL || 8), (j) => j());
    return res;
  });
}

/** Turn raw sandbox results into Evidence. Returns ids the router and criteria logic use. */
export function recordProof(ctx: Ctx, r: ProveResult) {
  const d = ctx.dossier;
  const fw = ctx.policy.sandbox.framework || undefined;
  const out = { redGreen: [] as { id: string; ok: boolean; project: string }[], regression: [] as { id: string; ok: boolean; project: string }[], ablation: new Map<string, { id: string; killed: boolean }>() };
  const short = (s: string) => s.slice(0, 8);

  // A project that does not build on the untouched base says something about the sandbox, not about the PR.
  const brokenBaseline = new Set(r.regression.filter((g) => g.base.outcome === 'build-error').map((g) => g.project));
  for (const p of brokenBaseline)
    d.notChecked.push({ what: `Tests in ${p.split('/').pop()}`, why: 'This test project does not build on the unmodified base commit in the sandbox, so its results say nothing about the change. Nothing in it counts as evidence.' });

  for (const g of r.redGreen) {
    const red = g.base.outcome === 'fail' || g.base.outcome === 'build-error';
    const green = g.head.outcome === 'pass';
    const infra = g.base.outcome === 'error' || g.head.outcome === 'error' || (brokenBaseline.has(g.project) && g.head.outcome === 'build-error');
    const ok = red && green;
    const conclusion = infra
      ? 'The sandbox could not complete this run; it proves nothing either way.'
      : ok
        ? g.base.outcome === 'build-error'
          ? `The PR's tests do not even compile against the base source and pass (${g.head.passed}) on the PR head: they exercise code that only exists after this change.`
          : `${g.base.failed} of the PR's tests fail on the base source and all ${g.head.passed} pass on the PR head: the tests detect the absence of this change.`
        : green
          ? `The PR's tests pass with AND without the source change (${g.base.passed} pass on base). They do not demonstrate that the change does anything.`
          : `The PR's own tests do not pass on the PR head (${g.head.failed} failing, outcome ${g.head.outcome}).`;
    const id = ctx.addEvidence({
      kind: 'red-green',
      strength: infra ? 'none' : 'executed',
      title: `Red → green: ${g.project.split('/').pop()}`,
      conclusion,
      polarity: infra ? 'neutral' : ok ? 'supports' : 'undermines',
      command: `# red:   ${describeCommand({ adapter: ctx.policy.sandbox.adapter, project: g.project, filter: g.filter, framework: fw }, `${short(ctx.mergeBase)} && git checkout ${short(d.pr.headSha)} -- <the PR's test files>`)}\n# green: ${describeCommand({ adapter: ctx.policy.sandbox.adapter, project: g.project, filter: g.filter, framework: fw }, short(d.pr.headSha))}`,
      base: g.base,
      head: g.head,
      producedBy: 'prove/red-green',
      durationMs: g.base.durationMs + g.head.durationMs,
    });
    out.redGreen.push({ id, ok, project: g.project });
    if (!infra && !ok)
      d.findings.push({
        id: `FN${d.findings.length + 1}`,
        title: green ? "The PR's tests pass without the change" : "The PR's own tests fail on the PR head",
        severity: green ? 'major' : 'blocker',
        category: green ? 'test-gap' : 'correctness',
        body: conclusion,
        refs: [],
        strength: 'executed',
        evidenceIds: [id],
      });
  }

  for (const g of r.regression) {
    const infra = g.base.outcome === 'error' || g.head.outcome === 'error' || brokenBaseline.has(g.project);
    const baseFail = new Set(g.base.failing ?? []);
    const newly = (g.head.failing ?? []).filter((t) => !baseFail.has(t));
    const headBroken = g.head.outcome === 'build-error';
    const ok = !infra && !headBroken && newly.length === 0 && (g.head.outcome === 'pass' || g.head.failed <= g.base.failed);
    const pre = g.head.failed - newly.length;
    const conclusion = infra
      ? brokenBaseline.has(g.project)
        ? 'This test project does not build on the unmodified base in the sandbox; regression status is unknown.'
        : 'The sandbox could not complete the full-suite run; regression status is unknown.'
      : headBroken
        ? 'The test project does not build on the PR head.'
        : ok
          ? `${g.head.passed} tests pass on the PR head (base: ${g.base.passed}). Nothing that passed before fails now${pre > 0 ? `; ${pre} test(s) fail identically on base and head (pre-existing)` : ''}.`
          : `${newly.length} test(s) that pass on base fail on the PR head.`;
    const id = ctx.addEvidence({
      kind: 'regression',
      strength: infra ? 'none' : 'executed',
      title: `Regression run: ${g.project.split('/').pop()}`,
      conclusion,
      polarity: infra ? 'neutral' : ok ? 'supports' : 'undermines',
      command: `${describeCommand({ adapter: ctx.policy.sandbox.adapter, project: g.project, framework: fw }, short(ctx.mergeBase))}\n${describeCommand({ adapter: ctx.policy.sandbox.adapter, project: g.project, framework: fw }, short(d.pr.headSha))}`,
      base: g.base,
      head: { ...g.head, failing: newly.length ? newly : g.head.failing },
      producedBy: 'prove/regression',
      durationMs: g.base.durationMs + g.head.durationMs,
    });
    out.regression.push({ id, ok, project: g.project });
    if (!infra && !ok)
      d.findings.push({
        id: `FN${d.findings.length + 1}`,
        title: headBroken ? `${g.project.split('/').pop()} does not build on the PR head` : `${newly.length} existing test(s) regress`,
        severity: 'blocker',
        category: 'correctness',
        body: `${conclusion}${newly.length ? ' Newly failing: ' + newly.slice(0, 8).join(', ') : ''}`,
        refs: [],
        strength: 'executed',
        evidenceIds: [id],
      });
  }

  for (const a of r.ablations) {
    const infra = a.result.outcome === 'error';
    const killed = a.result.outcome === 'fail' || a.result.outcome === 'build-error';
    const { f, h } = locate(ctx, a.hunkId);
    const where = `${f.path.split('/').pop()}:${h.newStart}`;
    const id = ctx.addEvidence({
      kind: 'ablation',
      strength: infra ? 'none' : 'executed',
      title: `Ablation: revert ${where}`,
      conclusion: infra
        ? 'The sandbox could not complete this run.'
        : a.result.outcome === 'build-error'
          ? `With this hunk reverted the code no longer compiles — the rest of the change depends on it.`
          : killed
            ? `With this hunk reverted, ${a.result.failed} test(s) fail. The tests notice when this code is missing.`
            : `With this hunk reverted, all ${a.result.passed} tests still pass. No test notices whether this code exists.`,
      polarity: infra ? 'neutral' : killed ? 'supports' : 'undermines',
      command: `git checkout ${short(d.pr.headSha)} && git apply -R <hunk ${a.hunkId}> && dotnet test ${a.project}${fw ? ` -f ${fw}` : ''}`,
      ablation: { unitId: h.unitId, result: a.result, killed },
      refs: [{ path: f.path, startLine: h.newStart, endLine: h.newStart + h.lines.filter((l) => l.t !== 'del').length - 1 }],
      producedBy: 'prove/ablation',
      durationMs: a.result.durationMs,
    });
    if (!infra) out.ablation.set(a.hunkId, { id, killed });
  }
  if (r.ablationSkipped.length) d.notChecked.push({ what: `Ablation of ${r.ablationSkipped.length} source hunk(s)`, why: `Budget: the policy runs at most ${ctx.policy.sandbox.maxAblations} ablations per PR (largest hunks first). For the rest we do not know whether any test depends on them.` });
  return out;
}

export function locate(ctx: Ctx, hunkId: string) {
  for (const f of ctx.dossier.files) for (const h of f.hunks) if (h.id === hunkId) return { f, h };
  throw new Error(`unknown hunk ${hunkId}`);
}
