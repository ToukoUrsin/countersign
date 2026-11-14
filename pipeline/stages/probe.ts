import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RunResult } from '../../shared/dossier';
import { MODELS, UNTRUSTED, runAgent } from '../lib/agent';
import type { Ctx } from '../lib/ctx';
import { describeCommand, makeWorktree, runTests } from '../lib/sandbox';
import { SANDBOX, ensureDir, exec } from '../lib/util';
import type { TestPlan } from './prove';
import { stackAdapter } from '../lib/adapter';

/**
 * A tiny script the agent may call (the ONLY shell command it is allowed): run one test class
 * in the docker sandbox against a named worktree and print the JSON result.
 */
export function makeToolScript(ctx: Ctx, name: string, o: { head: string; base?: string; project: string; file: string }) {
  const dir = ensureDir(resolve(ctx.runDir, 'tools'));
  const p = resolve(dir, `${name}.sh`);
  const adapter = stackAdapter(ctx.policy.sandbox.adapter);
  const fw = ctx.policy.sandbox.framework;
  writeFileSync(
    p,
    `#!/usr/bin/env bash
# usage: ${name}.sh head|base "<test filter>"
set -u
which="\${1:-head}"; filter="\${2:-}"
case "$which" in
  head) wt=${JSON.stringify(o.head)} ;;
  base) ${o.base ? `wt=${JSON.stringify(o.base)}; mkdir -p "$(dirname "$wt/${o.project}/${o.file}")"; cp ${JSON.stringify(`${o.head}/${o.project}/${o.file}`)} "$wt/${o.project}/${o.file}"` : 'echo "{\\"error\\":\\"no base worktree for this tool\\"}"; exit 0'} ;;
  *) echo '{"error":"first argument must be head or base"}'; exit 0 ;;
esac
out=${JSON.stringify(resolve(ctx.runDir, 'toolruns', name))}-$which
mkdir -p "$out"
runFilter="$filter"
${adapter.id === 'python' ? '[[ "$runFilter" == "CountersignProbes" ]] && runFilter=""' : ''}
${JSON.stringify(resolve(SANDBOX, adapter.id === 'python' ? 'run-python-tests.sh' : 'run-tests.sh'))} --worktree "$wt" --project ${JSON.stringify(o.project)} --out "$out" ${fw ? `--framework ${fw}` : ''} --filter "$runFilter" >/dev/null 2>&1
cat "$out/result.json" 2>/dev/null || echo '{"error":"sandbox produced no result"}'
`,
  );
  chmodSync(p, 0o755);
  return p;
}

/** Head source with the BASE version of the test tree: the PR's own tests are not visible to the prober. */
async function headWithoutPrTests(ctx: Ctx, dest: string, plan: TestPlan) {
  await makeWorktree(ctx.repoDir, dest, ctx.dossier.pr.headSha);
  for (const p of plan.overlayPaths) {
    const onBase = (await exec('git', ['cat-file', '-e', `${ctx.mergeBase}:${p}`], { cwd: ctx.repoDir })).code === 0;
    if (onBase) await exec('git', ['checkout', ctx.mergeBase, '--', p], { cwd: dest });
    else if (existsSync(resolve(dest, p))) rmSync(resolve(dest, p));
  }
  return dest;
}

const PROBE_SCHEMA = {
  type: 'object',
  properties: {
    tests: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          criterionId: { type: 'string' },
          testName: { type: 'string', description: 'Method name inside class CountersignProbes.' },
          checks: { type: 'string', description: 'One sentence: what the test does and asserts.' },
          expectOnBase: { type: 'string', enum: ['fail', 'pass'], description: 'fail = the behaviour is missing/broken before the change; pass = an invariant that must hold before and after.' },
        },
        required: ['criterionId', 'testName', 'checks', 'expectOnBase'],
      },
    },
    untestable: { type: 'array', items: { type: 'object', properties: { criterionId: { type: 'string' }, why: { type: 'string' } }, required: ['criterionId', 'why'] } },
  },
  required: ['tests', 'untestable'],
};

export interface ProbeResult {
  project: string;
  tests: { criterionId: string; testName: string; checks: string; expectOnBase: 'fail' | 'pass' }[];
  untestable: { criterionId: string; why: string }[];
  base: RunResult;
  head: RunResult;
  code: string;
}

/**
 * Independent reproduction. A second agent, which cannot see the PR's tests, writes its own test per
 * acceptance criterion from the requirement text. Countersign (not the agent) then runs them on base and head.
 */
export async function probe(ctx: Ctx, plan: TestPlan | undefined): Promise<ProbeResult | null> {
  const d = ctx.dossier;
  if (!plan?.primary || !d.requirement.criteria.length) {
    ctx.skip('probe', !plan?.primary ? 'no runnable test project' : 'no criteria');
    if (d.requirement.criteria.length) d.notChecked.push({ what: 'Independent reproduction of the acceptance criteria', why: 'No runnable test project was found for this change, so criteria could not be reproduced by execution.' });
    return null;
  }
  const project = plan.primary;
  const adapter = stackAdapter(ctx.policy.sandbox.adapter);
  const probeFile = adapter.testFileName;
  return ctx.cached('probe', async () => {
    const head = await headWithoutPrTests(ctx, ctx.wt('probe-head'), plan);
    const base = await makeWorktree(ctx.repoDir, ctx.wt('probe-base'), ctx.mergeBase);
    const tool = makeToolScript(ctx, 'probe', { head, base, project, file: probeFile });
    const criteria = d.requirement.criteria.map((c) => `${c.id} [${c.kind}] ${c.text}`).join('\n');
    const r = await runAgent<Pick<ProbeResult, 'tests' | 'untestable'>>({
      name: 'probe',
      model: MODELS.default,
      cwd: head,
      allowWrite: true,
      allowBash: [tool],
      timeoutMs: 40 * 60_000,
      system: `You are an independent verifier. You did not write the change under review and you do not trust it. You write executable tests that decide, by running, whether acceptance criteria hold. ${UNTRUSTED}`,
      schema: PROBE_SCHEMA,
      prompt: `Requirement ${d.requirement.id}: ${d.requirement.title}\n\n<requirement>\n${d.requirement.body.slice(0, 9000)}\n</requirement>\n\nAcceptance criteria:\n${criteria}\n\nYour working directory is the repository at the PR head, but with the PR's own test changes removed — you cannot see how the author tested it, on purpose.\n\nTask: create exactly one file \`${project}/${probeFile}\` using the ${adapter.testLanguage} test harness, with one test per criterion you can decide by execution. Name methods/functions \`${adapter.id === 'python' ? 'test_<criterionId>_<ShortDescription>' : '<criterionId>_<ShortDescription>'}\`; pytest only collects Python functions or unittest methods whose names start with test_. Study existing tests first, derive tests from the requirement rather than the implementation, and run them only with ${tool} head "${adapter.id === 'python' ? 'CountersignProbes' : 'FullyQualifiedName~CountersignProbes'}" and the equivalent base command. Functional criteria must fail on base and pass on head; implicit criteria pass on both. Keep a real failing head test. Do not modify other files. Maximum 5 tests and 6 sandbox runs. Report tests kept and criteria you could not test.`,
    });
    const codePath = resolve(head, project, probeFile);
    const code = existsSync(codePath) ? readFileSync(codePath, 'utf8') : '';
    if (!code) return { project, tests: [], untestable: r.out.untestable, base: errRun(ctx.mergeBase), head: errRun(d.pr.headSha), code };
    // official runs — the agent's own claims about results are not used
    writeFileSync(resolve(ensureDir(resolve(base, project)), probeFile), code);
    const fw = ctx.policy.sandbox.framework || undefined;
    const filter = 'FullyQualifiedName~CountersignProbes';
    const pythonFilter = adapter.id === 'python' ? (r.out.tests.map((t) => t.testName).join(' or ') || '') : filter;
    const [hr, br] = await Promise.all([
      runTests({ adapter: adapter.id, worktree: head, project, filter: pythonFilter, framework: fw, evDir: ctx.evDir, name: 'probe-head', label: 'PR head + independent probes', sha: d.pr.headSha }),
      runTests({ adapter: adapter.id, worktree: base, project, filter: pythonFilter, framework: fw, evDir: ctx.evDir, name: 'probe-base', label: 'base + independent probes', sha: ctx.mergeBase }),
    ]);
    return { project, tests: r.out.tests, untestable: r.out.untestable, base: br, head: hr, code };
  });
}

const errRun = (sha: string): RunResult => ({ sha, label: 'not run', outcome: 'error', passed: 0, failed: 0, skipped: 0, durationMs: 0 });

const failedIn = (run: RunResult, test: string) => run.outcome === 'build-error' || (run.failing ?? []).some((f) => f.endsWith(test) || f.includes(`.${test}`) || f.includes(test));

/** Per-criterion evidence + status from the official probe runs. */
export function recordProbe(ctx: Ctx, r: ProbeResult) {
  const d = ctx.dossier;
  const adapter = stackAdapter(ctx.policy.sandbox.adapter);
  const fw = ctx.policy.sandbox.framework || undefined;
  for (const t of r.tests) {
    const c = d.requirement.criteria.find((x) => x.id === t.criterionId);
    if (!c) continue;
    if (r.head.outcome === 'error' || r.head.outcome === 'build-error') continue;
    const headFail = failedIn(r.head, t.testName);
    const baseKnown = r.base.outcome !== 'error';
    const baseFail = baseKnown && failedIn(r.base, t.testName);
    const one = (run: RunResult, fail: boolean): RunResult => ({ ...run, outcome: run.outcome === 'build-error' ? 'build-error' : fail ? 'fail' : 'pass', passed: fail ? 0 : 1, failed: fail ? 1 : 0, skipped: 0, failing: fail && run.outcome !== 'build-error' ? [`CountersignProbes.${t.testName}`] : [] });
    let conclusion: string;
    let polarity: 'supports' | 'undermines' | 'neutral';
    if (headFail) {
      conclusion = `An independently written test for ${c.id} FAILS on the PR head. Either the criterion is not met or the probe is wrong — a human must look.`;
      polarity = 'undermines';
      c.status = 'violated';
    } else if (baseFail) {
      conclusion = r.base.outcome === 'build-error' ? `An independently written test for ${c.id} passes on the PR head and cannot even compile on base (the capability did not exist).` : `An independently written test for ${c.id} fails on base and passes on the PR head.`;
      polarity = 'supports';
      c.status = 'proven';
    } else {
      conclusion = c.kind === 'implicit' ? `An independently written invariant test for ${c.id} passes on base and on the PR head: the behaviour is preserved.` : `An independently written test for ${c.id} passes on the PR head — but it also passes on base, so it does not show that this change is what makes it true.`;
      polarity = c.kind === 'implicit' ? 'supports' : 'neutral';
      if (c.status !== 'violated') c.status = c.kind === 'implicit' && baseKnown ? 'proven' : 'supported';
    }
    const id = ctx.addEvidence({
      kind: 'repro',
      strength: 'executed',
      title: `Independent probe: ${t.testName}`,
      conclusion,
      polarity,
      command: `# test written by the verifier agent without access to the PR's tests\n${describeCommand({ adapter: adapter.id, project: r.project, filter: adapter.id === 'python' ? t.testName : `FullyQualifiedName~CountersignProbes.${t.testName}`, framework: fw }, '<base | head>')}`,
      base: baseKnown ? one(r.base, baseFail) : undefined,
      head: one(r.head, headFail),
      probeSource: { path: `${r.project}/${adapter.testFileName}`, language: adapter.testLanguage, code: extractMethod(r.code, t.testName) },
      producedBy: 'probe (independent verifier agent) + sandbox',
    });
    c.evidenceIds.push(id);
    c.note = t.checks;
    if (headFail)
      d.findings.push({
        id: `FN${d.findings.length + 1}`,
        title: `Independent test for ${c.id} fails on the PR head`,
        severity: 'major',
        category: 'correctness',
        body: `${c.text}\n\nThe verifier's test (${t.checks}) fails on the PR head.${r.head.excerpt ? `\n\n${r.head.excerpt.slice(0, 600)}` : ''}`,
        refs: [],
        strength: 'executed',
        evidenceIds: [id],
      });
  }
  if (r.head.outcome === 'build-error' || r.head.outcome === 'error') d.notChecked.push({ what: 'Independent reproduction of the acceptance criteria', why: `The verifier agent's probe file did not produce a usable run on the PR head (${r.head.outcome}).` });
  for (const u of r.untestable) {
    const c = d.requirement.criteria.find((x) => x.id === u.criterionId);
    if (c) d.notChecked.push({ what: `${c.id} by independent execution`, why: u.why });
  }
}

/** Pull one test method out of the probe file for display; falls back to the whole file. */
function extractMethod(code: string, name: string) {
  const i = code.search(new RegExp(`(public|internal)\\s+(async\\s+)?[\\w<>.]+\\s+${name}\\s*\\(`));
  if (i < 0) return code.slice(0, 6000);
  let start = code.lastIndexOf('\n', i);
  // include attributes / doc comments directly above
  for (;;) {
    const prev = code.lastIndexOf('\n', start - 1);
    const line = code.slice(prev + 1, start).trim();
    if (line.startsWith('[') || line.startsWith('///')) start = prev;
    else break;
  }
  let depth = 0;
  let j = code.indexOf('{', i);
  if (j < 0) return code.slice(start, start + 4000);
  for (; j < code.length; j++) {
    if (code[j] === '{') depth++;
    else if (code[j] === '}' && --depth === 0) break;
  }
  return code.slice(start + 1, j + 1).slice(0, 6000);
}
