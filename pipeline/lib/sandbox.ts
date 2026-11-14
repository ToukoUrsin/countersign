import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RunResult } from '../../shared/dossier';
import { SANDBOX, ensureDir, exec, log } from './util';

/** Detached worktree of `commit` at `dest`; optionally overlay paths from another commit (e.g. base source + PR tests). */
export async function makeWorktree(repoDir: string, dest: string, commit: string, overlay?: { from: string; paths: string[] }) {
  const args = [dest, commit];
  if (overlay && overlay.paths.length) args.push('--overlay', overlay.from, '--', ...overlay.paths);
  await exec(resolve(SANDBOX, 'worktree.sh'), args, { env: { REPO: repoDir }, check: true, timeoutMs: 300_000 });
  return dest;
}

export interface TestRun {
  worktree: string;
  project: string;
  filter?: string;
  framework?: string;
  /** absolute evidence dir for this dossier */
  evDir: string;
  /** sub-directory name for this run's log + result */
  name: string;
  label: string;
  sha: string;
  timeoutSec?: number;
  /** stack adapter selected by the repository policy (dotnet is the legacy default). */
  adapter?: string;
}

/** Per-project SDK overrides from the policy (`sandbox.sdk`), e.g. a test project that needs a newer compiler. */
let sdks: Record<string, string> = {};
export const setSdks = (m?: Record<string, string>) => {
  sdks = m ?? {};
};

/** Run tests inside the docker sandbox. Never throws: infrastructure problems come back as outcome 'error'. */
export async function runTests(t: TestRun): Promise<RunResult> {
  const out = ensureDir(resolve(t.evDir, t.name));
  const args = ['--worktree', t.worktree, '--project', t.project, '--out', out];
  if (t.filter) args.push('--filter', t.filter);
  if (t.framework) args.push('--framework', t.framework);
  if (t.timeoutSec) args.push('--timeout', String(t.timeoutSec));
  if (sdks[t.project]) args.push('--sdk', sdks[t.project]);
  const t0 = Date.now();
  const runner = t.adapter === 'python' ? 'run-python-tests.sh' : 'run-tests.sh';
  const r = await exec(resolve(SANDBOX, runner), args, { timeoutMs: ((t.timeoutSec ?? 1500) + 120) * 1000 });
  const rp = resolve(out, 'result.json');
  if (!existsSync(rp)) {
    log('sandbox', `${t.name}: no result.json (exit ${r.code}) ${r.stderr.slice(-200)}`);
    return { sha: t.sha, label: t.label, outcome: 'error', passed: 0, failed: 0, skipped: 0, durationMs: Date.now() - t0, excerpt: (r.stderr || r.stdout).slice(-1200), log: `${t.name}/log.txt` };
  }
  const j = JSON.parse(readFileSync(rp, 'utf8'));
  log('sandbox', `${t.name}: ${j.outcome} ${j.passed}✓ ${j.failed}✗ ${j.skipped}- in ${Math.round((Date.now() - t0) / 1000)}s`);
  return {
    sha: t.sha,
    label: t.label,
    outcome: j.outcome,
    passed: j.passed ?? 0,
    failed: j.failed ?? 0,
    skipped: j.skipped ?? 0,
    durationMs: j.durationMs ?? Date.now() - t0,
    failing: (j.failing ?? []).slice(0, 30),
    excerpt: j.excerpt,
    log: `${t.name}/${j.log ?? 'log.txt'}`,
  };
}

export const describeCommand = (t: Pick<TestRun, 'project' | 'filter' | 'framework' | 'adapter'>, checkout: string) =>
  t.adapter === 'python'
    ? `git checkout ${checkout} && pytest ${t.project}${t.filter ? ` -k "${t.filter}"` : ''}`
    : `git checkout ${checkout} && dotnet test ${t.project}${t.framework ? ` -f ${t.framework}` : ''}${t.filter ? ` --filter "${t.filter}"` : ''}`;
