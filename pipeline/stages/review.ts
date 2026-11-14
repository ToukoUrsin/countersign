import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CodeRef, DiscardedFinding, Finding, Refusal, RunResult } from '../../shared/dossier';
import { MODELS, UNTRUSTED, runAgent } from '../lib/agent';
import type { Ctx } from '../lib/ctx';
import { describeCommand, makeWorktree, runTests } from '../lib/sandbox';
import { norm, pool } from '../lib/util';
import { renderDiff } from './map';
import { makeToolScript } from './probe';
import type { TestPlan } from './prove';
import { stackAdapter } from '../lib/adapter';

export interface RawFinding {
  title: string;
  severity: Finding['severity'];
  category: Finding['category'];
  body: string;
  scenario: string;
  refs: { path: string; startLine: number; endLine: number; quote: string }[];
  suggestion: string;
  testable: boolean;
}

export interface RawRefusal {
  question: string;
  why: string;
  reasonKind: Refusal['reasonKind'];
  options: { label: string; consequence: string; implemented?: boolean; implementedWhy?: string }[];
  context: string;
  refs: { path: string; startLine: number; endLine: number; quote: string }[];
  blocking: boolean;
}

export interface ReviewOut {
  findings: RawFinding[];
  refusals: RawRefusal[];
  notChecked: { what: string; why: string }[];
}

const REF = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    startLine: { type: 'integer' },
    endLine: { type: 'integer' },
    quote: { type: 'string', description: 'One line copied VERBATIM from the file at that location (the PR head). It will be checked mechanically.' },
  },
  required: ['path', 'startLine', 'endLine', 'quote'],
};

export const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '<= 90 chars, states the defect.' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'note'] },
          category: { type: 'string', enum: ['correctness', 'security', 'performance', 'api-compat', 'maintainability', 'test-gap', 'scope'] },
          body: { type: 'string', description: 'What is wrong and why, 2–4 sentences, plain language.' },
          scenario: { type: 'string', description: 'Concrete input/state → wrong outcome.' },
          refs: { type: 'array', items: REF },
          suggestion: { type: 'string' },
          testable: { type: 'boolean', description: 'true if a unit test in this repo could demonstrate it.' },
        },
        required: ['title', 'severity', 'category', 'body', 'scenario', 'refs', 'suggestion', 'testable'],
      },
    },
    refusals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'A yes/no or choose-one question for the accountable human.' },
          why: { type: 'string', description: 'Why an AI reviewer must not decide this.' },
          reasonKind: { type: 'string', enum: ['policy', 'product-intent', 'compatibility', 'risk-appetite', 'missing-context', 'security-posture'] },
          options: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, consequence: { type: 'string' }, implemented: { type: 'boolean' }, implementedWhy: { type: 'string' } }, required: ['label', 'consequence', 'implemented', 'implementedWhy'] } },
          context: { type: 'string', description: 'What you know that bears on the decision (facts, not a recommendation).' },
          refs: { type: 'array', items: REF },
          blocking: { type: 'boolean' },
        },
        required: ['question', 'why', 'reasonKind', 'options', 'context', 'refs', 'blocking'],
      },
    },
    notChecked: { type: 'array', items: { type: 'object', properties: { what: { type: 'string' }, why: { type: 'string' } }, required: ['what', 'why'] } },
  },
  required: ['findings', 'refusals', 'notChecked'],
};

const LENSES: Record<string, string> = {
  correctness:
    'LENS: correctness and behaviour. Trace the changed code paths end to end. Look for: wrong conditions, cases the fix does not cover, cases it over-covers (behaviour changed for inputs nobody asked about), swallowed errors, null/empty handling, ordering, concurrency, and whether the requirement is actually met.',
  surface:
    'LENS: compatibility, security, tests and scope. Look for: public API or diagnostics changes users will notice, backwards-compatibility breaks, generated-code or build-time effects on consumers, unsafe handling of untrusted input, performance on hot paths, tests that would pass even if the code were wrong, missing negative tests, and changes that the requirement did not ask for.',
};

export function reviewPrompt(ctx: Ctx, lens: string, diffText: string, ambiguities: string[]) {
  const d = ctx.dossier;
  const criteria = d.requirement.criteria.map((c) => `${c.id} [${c.kind}] ${c.text}`).join('\n') || '(none)';
  const units = d.units.map((u) => `${u.id} (${u.kind}) ${u.title} — hunks ${u.hunkIds.slice(0, 12).join(', ')}${u.hunkIds.length > 12 ? ` … (+${u.hunkIds.length - 12})` : ''}`).join('\n');
  return `Requirement ${d.requirement.id}: ${d.requirement.title}\n\n<requirement>\n${d.requirement.body.slice(0, 8000)}\n</requirement>\n\nAcceptance criteria:\n${criteria}\n${ambiguities.length ? `\nThe requirement leaves these open:\n${ambiguities.map((a) => '- ' + a).join('\n')}\n` : ''}\nChange units:\n${units}\n\nThe diff (your working directory is the PR head; use Read/Grep/Glob for full context — callers, related code, existing tests):\n\n${diffText}\n\n${LENSES[lens]}\n\nProduce:\n1. findings — only defects you can point at. Every finding needs at least one ref whose quote is copied verbatim from the head file; findings whose quotes do not match the file are thrown away automatically, and each surviving finding is handed to a skeptic who will try to refute it by running code. Prefer 0–5 solid findings over many weak ones. No style nits. Severity: blocker = must not merge; major = likely bug or broken promise; minor = real but small; note = worth knowing.\n2. refusals — decisions that are NOT yours to make: product intent, compatibility policy, risk appetite, security posture, or anything that depends on context you do not have. Phrase each as a question with 2–3 concrete options and their consequences. Do not recommend an option. For every option, read the PR-head code and set implemented true only when that option is what the code currently does; set implemented false otherwise, and give implementedWhy as one short file:line citation. 0–3 items. blocking = the change should not merge until a human answers.\n3. notChecked — things relevant to this change that NOBODY in this review checks (e.g. other target frameworks, performance, platforms, downstream consumers, runtime behaviour beyond the tests). A separate sandbox stage already builds the code and runs the PR's tests, the full test project and per-hunk ablation, so do NOT list "I could not build or run the tests". At most 4 items, most important first, one sentence each; this list is shown to the human who signs.`;
}

const SYSTEM = `You are a senior reviewer of code written by another AI agent. Your output is advice with evidence for a named human who stays accountable; you never approve. You only state what you can point at in the code. Where you are unsure, say what you did not check instead of guessing. ${UNTRUSTED}`;

export async function review(ctx: Ctx, ambiguities: string[]) {
  const diffText = renderDiff(ctx, 150_000);
  const lenses = Object.keys(LENSES);
  const outs = await Promise.all(
    lenses.map((lens) =>
      ctx.cached(`review.${lens}`, () =>
        runAgent<ReviewOut>({ name: `review/${lens}`, model: MODELS.review, cwd: ctx.wt('head'), system: SYSTEM, schema: REVIEW_SCHEMA, prompt: reviewPrompt(ctx, lens, diffText, ambiguities), timeoutMs: 25 * 60_000 }),
      ),
    ),
  );
  const cost = outs.reduce((a, o) => a + o.costUsd, 0);
  ctx.detail('review', `${outs.reduce((a, o) => a + o.out.findings.length, 0)} candidate findings · ${outs.reduce((a, o) => a + o.out.refusals.length, 0)} refusals · 2 lenses`, cost);
  return outs.map((o, i) => ({ lens: lenses[i], ...o.out }));
}

// ───────────────────────────── verification ─────────────────────────────

const words = (s: string) => new Set(norm(s.toLowerCase()).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter((w) => w.length > 3));
const jaccard = (a: string, b: string) => {
  const A = words(a);
  const B = words(b);
  const inter = [...A].filter((w) => B.has(w)).length;
  return inter / Math.max(1, A.size + B.size - inter);
};
const overlap = (a: CodeRef[], b: CodeRef[]) => a.some((x) => b.some((y) => x.path === y.path && x.startLine <= y.endLine + 3 && y.startLine <= x.endLine + 3));

/** Deterministic quote check: the cited line must exist in the head file. Fixes line numbers; drops refs that do not exist. */
export function checkRefs(wt: string, refs: RawFinding['refs']): { ok: CodeRef[]; bad: number } {
  const ok: CodeRef[] = [];
  let bad = 0;
  for (const r of refs) {
    const p = resolve(wt, r.path);
    if (!existsSync(p) || !r.quote?.trim()) {
      bad++;
      continue;
    }
    const lines = readFileSync(p, 'utf8').split('\n');
    const q = norm(r.quote);
    const first = norm(r.quote.split('\n')[0]);
    let at = -1;
    const near = (i: number) => Math.abs(i + 1 - r.startLine);
    for (let i = 0; i < lines.length; i++) {
      const l = norm(lines[i]);
      if (!l) continue;
      if (l === first || (first.length > 12 && l.includes(first)) || (l.length > 12 && q.includes(l) && first.startsWith(l.slice(0, 12)))) {
        if (at < 0 || near(i) < near(at)) at = i;
      }
    }
    if (at < 0) {
      bad++;
      continue;
    }
    const len = Math.max(0, r.endLine - r.startLine);
    ok.push({ path: r.path, startLine: at + 1, endLine: at + 1 + Math.min(len, 40), quote: lines[at].trim().slice(0, 240) });
  }
  return { ok, bad };
}

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['confirmed-by-test', 'confirmed-by-reading', 'refuted', 'cannot-verify'] },
    explanation: { type: 'string', description: '2–4 sentences: what you did and what it showed.' },
    testClass: { type: 'string', description: 'Name of the test class you wrote, or empty.' },
    testFile: { type: 'string', description: 'Path of the test file you wrote relative to the repo root, or empty.' },
    introducedByPr: { type: 'string', enum: ['yes', 'no', 'unknown'], description: 'Does the defect exist because of this PR (yes) or did it exist before (no)?' },
  },
  required: ['verdict', 'explanation', 'testClass', 'testFile', 'introducedByPr'],
};

interface Verdict {
  verdict: 'confirmed-by-test' | 'confirmed-by-reading' | 'refuted' | 'cannot-verify';
  explanation: string;
  testClass: string;
  testFile: string;
  introducedByPr: 'yes' | 'no' | 'unknown';
  run?: RunResult;
  code?: string;
}

const SEV = { blocker: 0, major: 1, minor: 2, note: 3 } as const;

/**
 * Nothing a reviewer says reaches the human unverified:
 *  1. quote check (deterministic) — cited code must exist;
 *  2. duplicates merged;
 *  3. a skeptic agent tries to refute each finding, by running a test when one can be written;
 *  4. Countersign re-runs that test itself. Killed findings are kept and shown.
 */
export async function verify(ctx: Ctx, raws: (ReviewOut & { lens: string })[], plan: TestPlan | undefined) {
  const d = ctx.dossier;
  const head = ctx.wt('head');
  const discarded: DiscardedFinding[] = [];
  const kill = (title: string, claimed: string, reason: DiscardedFinding['reason'], detail: string) => discarded.push({ id: `X${discarded.length + 1}`, title, claimed: claimed.slice(0, 500), reason, detail });

  // 1 + 2
  type Cand = RawFinding & { lens: string; okRefs: CodeRef[] };
  const cands: Cand[] = [];
  const all = raws.flatMap((r) => r.findings.map((f) => ({ ...f, lens: r.lens }))).sort((a, b) => SEV[a.severity] - SEV[b.severity]);
  for (const f of all) {
    const { ok, bad } = checkRefs(head, f.refs ?? []);
    if (!ok.length) {
      kill(f.title, f.body, 'quote-not-found', bad ? `The reviewer cited ${bad} code location(s); none of the quoted lines exist in the PR head. A finding that cannot point at real code is not shown as a finding.` : 'The reviewer gave no code location.');
      continue;
    }
    const dup = cands.find((c) => (overlap(c.okRefs, ok) && (c.category === f.category || jaccard(c.title + c.body, f.title + f.body) > 0.25)) || jaccard(c.title, f.title) > 0.6);
    if (dup) {
      kill(f.title, f.body, 'duplicate', `Same defect as "${dup.title}" (raised by the ${dup.lens} lens); merged.`);
      continue;
    }
    cands.push({ ...f, okRefs: ok });
  }

  // 3 + 4
  const project = plan?.primary;
  const adapter = stackAdapter(ctx.policy.sandbox.adapter);
  const canRun = !!project && ['dotnet', 'python'].includes(ctx.policy.sandbox.adapter);
  const fw = ctx.policy.sandbox.framework || undefined;
  const toVerify = cands.filter((c) => c.severity !== 'note').slice(0, 8);
  const verdicts = new Map<Cand, Verdict>();
  await pool(toVerify, 6, async (c, i) => {
    const v = await ctx.cached(`verify.${i}.${hash(c.title)}`, async () => {
      const wt = canRun && c.testable ? await makeWorktree(ctx.repoDir, ctx.wt(`verify-${i}`), d.pr.headSha) : head;
      const file = `CountersignFinding${i + 1}.${adapter.id === 'python' ? 'py' : 'cs'}`;
      const cls = `CountersignFinding${i + 1}`;
      const tool = canRun && c.testable ? makeToolScript(ctx, `verify-${i}`, { head: wt, project: project!, file }) : null;
      const r = await runAgent<Verdict>({
        name: `verify/${i + 1}`,
        model: MODELS.default,
        cwd: wt,
        allowWrite: !!tool,
        allowBash: tool ? [tool] : undefined,
        timeoutMs: 30 * 60_000,
        system: `You are the skeptic in a code-review pipeline. A reviewer raised a finding; your job is to try to REFUTE it. Findings you cannot refute survive. You are rewarded for killing false findings and for proving real ones by execution, never for agreeing. ${UNTRUSTED}`,
        schema: VERIFY_SCHEMA,
        prompt: `Requirement ${d.requirement.id}: ${d.requirement.title}\n\nFinding under test:\nTitle: ${c.title}\nSeverity: ${c.severity} · Category: ${c.category}\nClaim: ${c.body}\nScenario: ${c.scenario}\nCited code:\n${c.okRefs.map((r) => `  ${r.path}:${r.startLine}  ${r.quote}`).join('\n')}\n\nYour working directory is the PR head. Read the cited code and its callers first.\n${
          tool
            ? `If the claim is about behaviour, decide it by execution: write ONE test file \`${project}/${file}\` with \`public class ${cls}\` containing a test that asserts the CORRECT (expected) behaviour for the reviewer's scenario — so that the test FAILS on this code if the finding is real and PASSES if the reviewer is wrong. Study an existing test file in \`${project}\` for the harness first. Run it with (the only shell command you may use):\n    ${tool} head "FullyQualifiedName~${cls}"\nIt prints JSON (outcome pass|fail|build-error, failing names, excerpt); a run takes 1–3 minutes. At most 4 runs. Do not modify other files. A test that fails for a reason unrelated to the claim proves nothing — check the failure message.`
            : 'No sandbox is available for this finding; decide by reading only.'
        }\nVerdicts: confirmed-by-test (your test fails for the claimed reason), confirmed-by-reading (you traced the code and the defect is certainly there, but it is not testable here), refuted (the claim is wrong — say exactly why), cannot-verify.\nAlso say whether the defect is introduced by this PR or pre-existing (check the base behaviour by reading the diff).`,
      });
      const v: Verdict = { ...r.out };
      if (tool && v.testClass && existsSync(resolve(wt, project!, file))) {
        v.code = readFileSync(resolve(wt, project!, file), 'utf8').slice(0, 7000);
        // official run by Countersign — the agent's reported outcome is not trusted
        v.run = await runTests({ adapter: adapter.id, worktree: wt, project: project!, filter: adapter.id === 'python' ? cls : `FullyQualifiedName~${cls}`, framework: fw, evDir: ctx.evDir, name: `finding-${i + 1}`, label: 'PR head + skeptic’s test', sha: d.pr.headSha });
      }
      return v;
    });
    verdicts.set(c, v);
  });

  for (const c of cands) {
    const v = verdicts.get(c);
    const base: Finding = {
      id: '',
      title: c.title,
      severity: c.severity,
      category: c.category,
      body: c.body,
      scenario: c.scenario || undefined,
      refs: c.okRefs,
      strength: 'reasoned',
      evidenceIds: [],
      suggestion: c.suggestion || undefined,
      unitId: unitOf(ctx, c.okRefs),
    };
    if (!v) {
      // notes and overflow: quote exists, nobody tried to refute it → weakest strength, labelled as such
      d.findings.push({ ...base, id: `FN${d.findings.length + 1}` });
      continue;
    }
    const ran = v.run && (v.run.outcome === 'fail' || v.run.outcome === 'pass');
    if (ran && v.run!.outcome === 'fail' && v.verdict !== 'refuted') {
      const ev = ctx.addEvidence({
        kind: 'repro',
        strength: 'executed',
        title: `Reproduced: ${c.title.slice(0, 60)}`,
        conclusion: `A skeptic agent wrote a test asserting the correct behaviour; Countersign ran it on the PR head and it fails (${v.run!.failed} failing). ${v.explanation}`,
        polarity: 'undermines',
        command: describeCommand({ adapter: adapter.id, project: project!, filter: adapter.id === 'python' ? v.testClass : `FullyQualifiedName~${v.testClass}`, framework: fw }, d.pr.headSha.slice(0, 8) + ` # plus ${v.testFile || 'the probe file'}`),
        head: v.run,
        probeSource: v.code ? { path: v.testFile || `${project}/${v.testClass}.${adapter.id === 'python' ? 'py' : 'cs'}`, language: adapter.testLanguage, code: v.code } : undefined,
        refs: c.okRefs,
        producedBy: 'verify (skeptic agent) + sandbox',
      });
      d.findings.push({ ...base, id: `FN${d.findings.length + 1}`, strength: 'executed', evidenceIds: [ev], body: v.introducedByPr === 'no' ? `${c.body}\n\nNote: the skeptic judged this defect to pre-date this PR.` : c.body });
    } else if (ran && v.run!.outcome === 'pass') {
      kill(c.title, c.body, 'repro-failed', `A skeptic wrote a test for the claimed scenario; it passes on the PR head, so the claimed defect did not occur. ${v.explanation}`);
    } else if (v.verdict === 'refuted') {
      kill(c.title, c.body, 'contradicted-by-evidence', v.explanation);
    } else if (v.verdict === 'confirmed-by-reading' || v.verdict === 'confirmed-by-test') {
      const ev = ctx.addEvidence({
        kind: 'quote-check',
        strength: 'verified-static',
        title: `Cross-checked: ${c.title.slice(0, 60)}`,
        conclusion: `The cited code exists verbatim in the PR head, and a second agent instructed to refute the finding could not. ${v.explanation}`,
        polarity: 'undermines',
        refs: c.okRefs,
        producedBy: 'verify (quote check + skeptic agent)',
      });
      d.findings.push({ ...base, id: `FN${d.findings.length + 1}`, strength: 'verified-static', evidenceIds: [ev] });
    } else {
      d.findings.push({ ...base, id: `FN${d.findings.length + 1}`, strength: 'reasoned', body: `${c.body}\n\nThe skeptic could neither confirm nor refute this: ${v.explanation}` });
    }
  }
  d.discarded.push(...discarded);

  // refusals: quote-checked, de-duplicated, capped
  const refs: Refusal[] = [];
  for (const r of raws.flatMap((x) => x.refusals).sort((a, b) => Number(b.blocking) - Number(a.blocking))) {
    if (refs.some((x) => jaccard(x.question, r.question) > 0.45 || jaccard(x.question + x.context, r.question + r.context) > 0.4)) continue;
    if (refs.length >= 4) break;
    const ok = checkRefs(head, r.refs ?? []).ok;
    refs.push({
      id: `R${d.refusals.length + refs.length + 1}`,
      question: r.question,
      why: r.why,
      reasonKind: r.reasonKind,
          options: (r.options ?? []).slice(0, 4).map((o, i) => ({ id: `o${i + 1}`, label: o.label, consequence: o.consequence, implemented: o.implemented, implementedWhy: o.implementedWhy })),
      context: r.context,
      evidenceIds: [],
      refs: ok,
      unitId: unitOf(ctx, ok),
      blocking: r.blocking,
    });
  }
  d.refusals.push(...refs.filter((r) => r.options.length >= 2));

  const seen: string[] = d.notChecked.map((n) => n.what);
  // reviewers are read-only; "I could not run the tests" is noise when the sandbox stage did exactly that
  const ranIt = d.evidence.some((e) => e.kind === 'regression' && e.strength === 'executed');
  const sandboxDid = /\b(tests?|suite|build)\b.{0,60}\b(pass|fail|clean|green|compile)|fail on the base|red.?green/i;
  let kept = 0;
  for (const n of raws.flatMap((x) => x.notChecked.slice(0, 5))) {
    if (kept >= 7) break;
    if (ranIt && sandboxDid.test(n.what)) continue;
    if (seen.some((s) => jaccard(s, n.what) > 0.5)) continue;
    kept++;
    seen.push(n.what);
    d.notChecked.push(n);
  }
  const executed = d.findings.filter((f) => f.strength === 'executed').length;
  ctx.detail('verify', `${cands.length} candidates → ${d.findings.length} kept (${executed} reproduced by execution) · ${discarded.length} killed`);
}

function unitOf(ctx: Ctx, refs: CodeRef[]): string | undefined {
  for (const r of refs)
    for (const f of ctx.dossier.files)
      if (f.path === r.path)
        for (const h of f.hunks) {
          const end = h.newStart + h.lines.filter((l) => l.t !== 'del').length;
          if (r.startLine <= end + 3 && r.endLine >= h.newStart - 3 && h.unitId) return h.unitId;
        }
  return undefined;
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
