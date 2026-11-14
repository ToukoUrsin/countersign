import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Canary, FileDiff, SelfTest } from '../../shared/dossier';
import { MODELS, UNTRUSTED, runAgent } from '../lib/agent';
import type { Ctx } from '../lib/ctx';
import { isTestPath } from '../lib/policy';
import { makeWorktree, runTests } from '../lib/sandbox';
import { exec, norm, pool } from '../lib/util';
import { renderDiff } from './map';
import type { TestPlan } from './prove';
import { stackAdapter } from '../lib/adapter';
import { REVIEW_SCHEMA, type ReviewOut, checkRefs, reviewPrompt } from './review';

type BugKind = 'single-line' | 'multi-line' | 'cross-file';
interface Edit { path: string; line: number; endLine?: number; original: string; mutated: string }
interface Mutation { kind: BugKind; description: string; edits: Edit[] }
interface CanaryRaw { m: Mutation; valid: boolean; testOutcome: string; caughtByTests: boolean; caughtByReviewer: boolean; reviewerSaid?: string; nearMiss?: string; matchWhy?: string }

const family = 'gpt';
const PLANT_SCHEMA = { type: 'object', properties: { mutations: { type: 'array', items: { type: 'object', properties: {
  kind: { type: 'string', enum: ['single-line', 'multi-line', 'cross-file'] }, description: { type: 'string' },
  edits: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, line: { type: 'integer' }, endLine: { type: 'integer' }, original: { type: 'string' }, mutated: { type: 'string' } }, required: ['path', 'line', 'original', 'mutated'] } },
}, required: ['kind', 'description', 'edits'] } } }, required: ['mutations'] };

async function codexJson<T>(ctx: Ctx, name: string, cwd: string, prompt: string): Promise<T> {
  const out = resolve(ctx.runDir, `${name.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
  const r = await exec('codex', ['exec', '-m', 'gpt-6.1-sol', '-s', 'read-only', '--json', '--skip-git-repo-check', '-C', cwd, '-o', out, '-'], { cwd, input: prompt, timeoutMs: 15 * 60_000 });
  const raw = existsSync(out) ? readFileSync(out, 'utf8') : r.stdout;
  for (const s of [raw, ...raw.split('\\n').reverse()]) {
    try { return JSON.parse(s) as T; } catch {}
    const a = s.indexOf('{'); const b = s.lastIndexOf('}');
    if (a >= 0 && b > a) try { return JSON.parse(s.slice(a, b + 1)) as T; } catch {}
  }
  throw new Error(`codex ${name} produced no JSON (exit ${r.code})`);
}

function changedSource(ctx: Ctx) {
  const adapter = stackAdapter(ctx.policy.sandbox.adapter);
  return ctx.dossier.files.filter((f) => !adapter.isTestFile(f.path, ctx.policy) && adapter.sourceExtensions.test(f.path) && f.additions > 0 && f.status !== 'deleted');
}

function normaliseMutation(ctx: Ctx, x: Mutation): Mutation | null {
  if (!x || !['single-line', 'multi-line', 'cross-file'].includes(x.kind) || !Array.isArray(x.edits)) return null;
  const edits: Edit[] = [];
  for (const e of x.edits) {
    const p = resolve(ctx.wt('head'), e.path);
    const replacement = e.mutated ?? (e as any).replacement;
    if (!existsSync(p) || !e.original?.trim() || !replacement?.trim() || norm(e.original) === norm(replacement)) continue;
    const lines = readFileSync(p, 'utf8').split('\n');
    let idx = Math.max(0, (e.line ?? 0) - 1);
    if (norm(lines[idx] ?? '') !== norm(e.original)) { const found = lines.findIndex((l) => norm(l) === norm(e.original)); if (found >= 0) idx = found; }
    if (idx < 0 || idx >= lines.length) continue;
    edits.push({ path: e.path, line: idx + 1, endLine: e.endLine ? idx + 1 + Math.max(0, e.endLine - e.line) : undefined, original: lines[idx], mutated: replacement });
  }
  const paths = new Set(edits.map((e) => e.path));
  if (x.kind === 'single-line' && edits.length !== 1) return null;
  if (x.kind === 'multi-line' && (edits.length < 2 || paths.size !== 1)) return null;
  if (x.kind === 'cross-file' && paths.size < 2) return null;
  const description = x.description?.trim() && !/planted defect/i.test(x.description) ? x.description.trim() : `The change from \`${edits[0]?.original?.trim().slice(0, 100)}\` to \`${edits[0]?.mutated?.trim().slice(0, 100)}\` changes behaviour in ${edits[0]?.path}:${edits[0]?.line}.`;
  return { kind: x.kind, description, edits };
}

function applyMutation(wt: string, m: Mutation) {
  const byPath = new Map<string, Edit[]>();
  for (const e of m.edits) byPath.set(e.path, [...(byPath.get(e.path) ?? []), e]);
  for (const [path, es] of byPath) {
    const p = resolve(wt, path); const lines = readFileSync(p, 'utf8').split('\n');
    for (const e of [...es].sort((a, b) => b.line - a.line)) lines[e.line - 1] = /^\s*/.exec(lines[e.line - 1])![0] + e.mutated.trim();
    writeFileSync(p, lines.join('\n'));
  }
}

function overlaps(m: Mutation, refs: { path: string; startLine: number; endLine: number }[]) {
  return m.edits.every((e) => refs.some((r) => r.path === e.path && r.startLine <= (e.endLine ?? e.line) && r.endLine >= e.line));
}
const MATCH_SCHEMA = { type: 'object', properties: { caught: { type: 'boolean' }, findingIndex: { type: 'integer' }, why: { type: 'string' } }, required: ['caught', 'findingIndex', 'why'] };

export async function selfTest(ctx: Ctx, plan: TestPlan | undefined): Promise<CanaryRaw[] | null> {
  const d = ctx.dossier;
  const sourceFiles = changedSource(ctx);
  if (!sourceFiles.length || ctx.policy.sandbox.canaries <= 0) { ctx.skip('selftest', 'no changed source code to plant bugs in'); return null; }
  return ctx.cached('selftest.v2', async () => {
    const added = sourceFiles.map((f) => `### ${f.path}\\n${f.hunks.flatMap((h) => h.lines.filter((l) => l.t === 'add' && l.s.trim().length > 8).map((l) => `${l.n}: ${l.s}`)).join('\\n')}`).join('\\n\\n');
    let planted: { mutations: Mutation[] }; let plantedRaw: any;
    try {
      plantedRaw = await codexJson<any>(ctx, 'selftest-plan', ctx.wt('head'), `You are a bug planter. The PR head is in the current read-only repository. Return JSON only matching the requested schema. Propose at least twelve realistic compiling defect candidates: at least 4 kind single-line, 4 kind multi-line (a changed block or omission spanning at least two lines), and 4 kind cross-file (the defect only exists because edits in at least two files disagree). The pipeline will run candidates and retain exactly 2 valid bugs of each kind; candidates that do not compile are discarded. Use only added executable source lines below, and read the full files to ensure every edit compiles. Never use syntax errors, comments, tests, or formatting-only changes. Each edit has a path, a 1-based line, the complete original line, and a complete replacement line.\\n\\n${added.slice(0, 100000)}`);
    } catch (e) { ctx.detail('selftest', `Codex planter failed: ${(e as Error).message.slice(0, 120)}`); return []; }
    planted = { mutations: Array.isArray(plantedRaw) ? plantedRaw : (plantedRaw.mutations ?? plantedRaw.defects ?? plantedRaw.bugs ?? plantedRaw.candidates ?? []) };
    const muts: Mutation[] = [];
    for (const x of planted.mutations ?? []) { const m = normaliseMutation(ctx, x); if (m && !muts.some((z) => z.kind === m.kind && z.edits[0].path === m.edits[0].path && z.edits[0].line === m.edits[0].line)) muts.push(m); }
    const kinds: BugKind[] = ['single-line', 'single-line', 'single-line', 'single-line', 'multi-line', 'multi-line', 'multi-line', 'multi-line', 'cross-file', 'cross-file', 'cross-file', 'cross-file'];
    const selected: Mutation[] = [];
    for (const k of kinds) { const m = muts.find((x) => x.kind === k && !selected.includes(x)); if (m) selected.push(m); }
    const fw = ctx.policy.sandbox.framework || undefined;
    const adapter = stackAdapter(ctx.policy.sandbox.adapter);
    const canRun = !!plan?.primary && ['dotnet', 'python'].includes(ctx.policy.sandbox.adapter);
    return pool(selected, 2, async (m, i): Promise<CanaryRaw> => {
      const wt = await makeWorktree(ctx.repoDir, ctx.wt(`canary-${i + 1}`), d.pr.headSha);
      applyMutation(wt, m);
      const testP = canRun ? runTests({ adapter: adapter.id, worktree: wt, project: plan!.primary!, framework: fw, evDir: ctx.evDir, name: `canary-${i + 1}`, label: `PR head with planted ${m.kind} bug #${i + 1}`, sha: d.pr.headSha }) : Promise.resolve(null);
      const files: FileDiff[] = d.files.map((f) => ({ ...f, hunks: f.hunks.map((h) => ({ ...h, lines: h.lines.map((l) => { const e = m.edits.find((x) => x.path === f.path && l.t === 'add' && l.n === x.line); return e ? { ...l, s: e.mutated } : l; }) })) }));
      const saved = d.files; d.files = files; const diffText = renderDiff(ctx, 120_000); d.files = saved;
      const revP = runAgent<ReviewOut>({ name: `selftest/review-${i + 1}`, model: process.env.CS_REVIEW_MODEL || 'claude-fable-5-2', cwd: wt, system: `You are a blind senior reviewer. Find only defects that are actually present in the mutated code. A near miss or a neighbour is a miss. Cite exact overlapping lines for the defect. ${UNTRUSTED}`, schema: REVIEW_SCHEMA, prompt: reviewPrompt(ctx, 'correctness', diffText, []) + '\\n\\nThis is a sensitivity test. Be strict: report the planted defect only if your finding describes the same causal change, with refs overlapping every edited file and line.', timeoutMs: 20 * 60_000 }).catch(() => null);
      const [run, rev] = await Promise.all([testP, revP]);
      let caught = false; let said: string | undefined; let near: string | undefined; let matchWhy: string | undefined;
      const candidates = (rev?.out.findings ?? []).map((f, index) => ({ f, index, refs: checkRefs(wt, f.refs ?? []).ok })).filter((x) => overlaps(m, x.refs));
      if (!candidates.length) matchWhy = 'No reviewer finding cited every mutated path and line; the strict semantic judgment was not run.';
      if (candidates.length) {
        try {
          const judgment = await runAgent<{ caught: boolean; findingIndex: number; why: string }>({ name: `selftest/match-${i + 1}`, model: MODELS.fast, cwd: wt, tools: ['Read', 'Grep', 'Glob'], schema: MATCH_SCHEMA, system: `You are the strict judge for a reviewer self-test. Decide whether one overlapping reviewer finding identifies the exact planted defect, with the same wrong behaviour. A nearby or related defect is a miss. ${UNTRUSTED}`, prompt: `Mutation kind: ${m.kind}\nDescription: ${m.description}\nEdits:\n${m.edits.map((e) => `${e.path}:${e.line}\nORIGINAL: ${e.original}\nMUTATED: ${e.mutated}`).join('\n')}\n\nOverlapping reviewer findings:\n${candidates.map((x, j) => `[${j}] ${x.f.title}: ${x.f.body}`).join('\n')}\nReturn caught=true only if a finding describes this exact mutation's behaviour; otherwise false.`, timeoutMs: 8 * 60_000 });
          matchWhy = judgment.out.why; const chosen = candidates[judgment.out.findingIndex];
          if (judgment.out.caught && chosen) { caught = true; said = chosen.f.title; } else if (chosen) near = chosen.f.title;
        } catch (e) { matchWhy = `Strict match judgment unavailable: ${(e as Error).message.slice(0, 160)}`; }

      }
      return { m, valid: run ? run.outcome !== 'build-error' && run.outcome !== 'error' : true, testOutcome: run?.outcome ?? 'not-run', caughtByTests: run?.outcome === 'fail', caughtByReviewer: caught, reviewerSaid: said, nearMiss: near, matchWhy };
    });
  });
}

export function recordSelfTest(ctx: Ctx, raws: CanaryRaw[]) {
  const valid = raws.filter((r) => r.valid);
  const kindCounts = new Map<BugKind, number>();
  const chosen = valid.filter((r) => { const n = kindCounts.get(r.m.kind) ?? 0; if (n >= 2) return false; kindCounts.set(r.m.kind, n + 1); return true; });
  const canaries: Canary[] = chosen.map((r, i) => {
    const lines = r.m.edits.map((e) => e.line); const end = r.m.edits.map((e) => e.endLine ?? e.line);
    const missReason = !r.caughtByReviewer ? (r.nearMiss ? `Near miss (not counted): ${r.nearMiss}` : r.reviewerSaid ? `Reviewer said: ${r.reviewerSaid}` : 'Reviewer did not identify this defect.') : undefined;
    return { id: `K${i + 1}`, kind: r.m.kind, description: r.m.description, path: r.m.edits[0].path, line: Math.min(...lines), endLine: Math.max(...end), caughtByTests: r.caughtByTests, caughtByReviewer: r.caughtByReviewer, note: r.caughtByReviewer ? `Reviewer: “${r.reviewerSaid}”` : missReason, missReason, matchWhy: r.matchWhy };
  });
  const caught = canaries.filter((c) => c.caughtByReviewer).length;
  const byKind = (k: BugKind) => canaries.filter((c) => c.kind === k);
  const st: SelfTest = { planted: canaries.length, caught, canaries, planterModel: 'gpt-6.1-sol', planterFamily: family,
    reading: canaries.length ? `${canaries.length} bugs were planted by GPT (2 single-line, ${byKind('multi-line').length} multi-line, ${byKind('cross-file').length} cross-file). The blind reviewer caught ${caught}; the PR tests caught ${canaries.filter((c) => c.caughtByTests).length}. A reviewer miss is counted even when a PR test catches it.${caught < canaries.length ? ' Units containing reviewer misses are escalated to a human read.' : ''}${raws.length - chosen.length ? ` ${raws.length - chosen.length} candidate mutation(s) were discarded or did not compile.` : ''}` : 'The GPT planter produced no valid compiling canaries, so sensitivity is unmeasured.' };
  ctx.dossier.selfTest = st;
  const id = ctx.addEvidence({ kind: 'canary', strength: canaries.length ? 'executed' : 'none', title: 'Reviewer self-test: GPT-planted bugs', conclusion: st.reading, polarity: !canaries.length ? 'neutral' : caught === canaries.length ? 'supports' : 'undermines', refs: canaries.map((c) => ({ path: c.path, startLine: c.line, endLine: c.endLine ?? c.line })), producedBy: 'selftest (GPT planter, blind reviewer, sandbox)' });
  ctx.detail('selftest', `${caught}/${canaries.length} reviewer catches · tests caught ${canaries.filter((c) => c.caughtByTests).length}`);
  return { evidenceId: id, missed: canaries.filter((c) => !c.caughtByReviewer) };
}

