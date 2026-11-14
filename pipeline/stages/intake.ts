import type { Criterion, Dossier } from '../../shared/dossier';
import { MODELS, UNTRUSTED, runAgent } from '../lib/agent';
import { Ctx, STAGES } from '../lib/ctx';
import { parseDiff, preCluster } from '../lib/diff';
import { fetchIssue, fetchPr, prepareRepo, slugOf } from '../lib/gh';
import { loadPolicy } from '../lib/policy';
import { setSdks } from '../lib/sandbox';
import { norm } from '../lib/util';

export function emptyDossier(slug: string, url: string): Dossier {
  return {
    schema: 1,
    id: '',
    slug,
    status: 'running',
    generatedAt: new Date().toISOString(),
    pr: { owner: '', repo: '', number: 0, url, title: 'Loading…', body: '', author: '', authorKind: 'agent', baseRef: '', headRef: '', baseSha: '', headSha: '', additions: 0, deletions: 0, changedFiles: 0, createdAt: '' },
    requirement: { id: '', title: '', sourceUrl: '', body: '', criteria: [] },
    story: { headline: '', before: '', after: '', steps: [], alsoTouches: [] },
    diagrams: [],
    units: [],
    files: [],
    evidence: [],
    findings: [],
    discarded: [],
    refusals: [],
    notChecked: [],
    routing: { tier: 'T3', score: 0, areas: [], readLines: 0, skimLines: 0, skipLines: 0, totalLines: 0, estMinutes: 0, spotCheck: { selected: false, reason: '' }, policyVersion: '', rulesFired: [] },
    recommendation: { verdict: 'full-read-required', summary: 'Review in progress.', distrustIf: [] },
    stages: STAGES.map(([name, title]) => ({ name, title, status: 'pending' })),
  };
}

export async function intake(ctx: Ctx, url: string) {
  const { pr } = await fetchPr(url);
  const d = ctx.dossier;
  d.pr = pr;
  d.id = `${pr.owner}/${pr.repo}#${pr.number}`;
  d.slug = slugOf(pr.owner, pr.repo, pr.number);
  ctx.save();

  const { repoDir, mergeBase, baseTip, diff } = await prepareRepo(pr);
  ctx.repoDir = repoDir;
  ctx.mergeBase = mergeBase;
  pr.baseSha = mergeBase;
  ctx.policy = await loadPolicy(repoDir, baseTip);
  setSdks(ctx.policy.sandbox.sdk);
  d.routing.policyVersion = `${ctx.policy.version} · ${ctx.policy.source}`;
  d.files = parseDiff(diff);
  ctx.clusters = preCluster(d.files);

  // requirement: named by the PR, fetched from the tracker — never taken from the PR's own prose
  const hay = `${pr.title}\n${pr.body}\n${pr.headRef}`;
  const m = new RegExp(ctx.policy.requirement.pattern, 'i').exec(hay) ?? /(?:issue|fixes|closes|resolves)[-\s#]*(\d+)/i.exec(hay);
  if (m) {
    const n = Number(m[1]);
    const trackerRepo = ctx.policy.requirement.repo || `${pr.owner}/${pr.repo}`;
    try {
      const issue = await fetchIssue(trackerRepo, n);
      d.requirement = { id: `REQ-${n}`, title: issue.title, sourceUrl: issue.url, body: issue.body ?? '', criteria: [] };
    } catch (e) {
      d.requirement = { id: `REQ-${n}`, title: `Requirement ${n} could not be fetched`, sourceUrl: '', body: '', criteria: [] };
      d.notChecked.push({ what: `Requirement REQ-${n} text`, why: `Could not fetch issue ${n} from ${trackerRepo}: ${(e as Error).message.slice(0, 120)}` });
    }
  } else {
    d.requirement = { id: 'NONE', title: 'No requirement linked', sourceUrl: '', body: '', criteria: [] };
  }
  ctx.detail('intake', `${d.files.length} files · ${d.files.reduce((a, f) => a + f.hunks.length, 0)} hunks · ${ctx.clusters.length} repetitive cluster(s) · ${d.requirement.id}`);
}

const CRITERIA_SCHEMA = {
  type: 'object',
  properties: {
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'One testable acceptance criterion, one sentence, observable behaviour.' },
          sourceQuote: { type: 'string', description: 'Verbatim quote (<= 200 chars) from the requirement that this criterion comes from. Empty for implicit criteria.' },
          kind: { type: 'string', enum: ['functional', 'non-functional', 'implicit'] },
        },
        required: ['text', 'sourceQuote', 'kind'],
      },
    },
    ambiguities: { type: 'array', items: { type: 'string' }, description: 'Things the requirement leaves open that a human must decide. Empty if none.' },
  },
  required: ['criteria', 'ambiguities'],
};

/**
 * Acceptance criteria come from the requirement ALONE. This agent never sees the diff or the PR
 * description, so the change cannot define its own success.
 */
export async function intent(ctx: Ctx) {
  const d = ctx.dossier;
  if (d.requirement.id === 'NONE' || !d.requirement.body.trim()) {
    ctx.skip('intent', 'no requirement text');
    d.refusals.push({
      id: 'R0',
      question: 'This change names no requirement. What is it for, and who asked for it?',
      why: 'Without a requirement there is nothing to trace evidence to. The AI will not invent the intent of a change.',
      reasonKind: 'missing-context',
      options: [
        { id: 'link', label: 'Link a requirement and re-run', consequence: 'Countersign re-reviews against the linked requirement.' },
        { id: 'own', label: 'I state the intent myself and take a full read', consequence: 'Every unit is routed to you as T3.' },
      ],
      context: 'Policy `requirement.missing: full-read` applies.',
      evidenceIds: [],
      blocking: true,
    });
    return { ambiguities: [] as string[] };
  }
  const r = await ctx.cached('intent', () =>
    runAgent<{ criteria: { text: string; sourceQuote: string; kind: Criterion['kind'] }[]; ambiguities: string[] }>({
      name: 'intent',
      model: MODELS.default,
      cwd: ctx.runDir,
      tools: [],
      system: `You turn a software requirement into acceptance criteria for a reviewer. ${UNTRUSTED}`,
      schema: CRITERIA_SCHEMA,
      prompt: `Requirement ${d.requirement.id}: ${d.requirement.title}\n\n<requirement>\n${d.requirement.body.slice(0, 12000)}\n</requirement>\n\nDerive 3–6 acceptance criteria that a change must satisfy to fulfil this requirement.\nRules:\n- Each criterion is one sentence describing observable behaviour that a test or a check could confirm or refute.\n- Functional / non-functional criteria MUST carry a verbatim sourceQuote copied from the requirement text.\n- Add at most two "implicit" criteria that any change in this area must respect even though the requirement does not say so (e.g. "existing diagnostics for source-declared types are still reported", "no existing test regresses"). Implicit criteria have an empty sourceQuote.\n- Do not describe a solution or name implementation details the requirement does not name.\n- List ambiguities: decisions the requirement leaves open.`,
    }),
  );
  ctx.detail('intent', `${r.out.criteria.length} criteria`, r.costUsd);
  const body = norm(d.requirement.body);
  d.requirement.criteria = r.out.criteria.map((c, i) => {
    const quoteOk = !c.sourceQuote || body.includes(norm(c.sourceQuote));
    return {
      id: `AC${i + 1}`,
      text: c.text,
      kind: c.kind,
      // a quote that is not in the requirement is dropped rather than shown as if it were
      sourceQuote: quoteOk ? c.sourceQuote || undefined : undefined,
      status: 'unproven',
      evidenceIds: [],
      note: quoteOk ? undefined : 'The model cited requirement text that does not exist verbatim; the citation was removed.',
    };
  });
  return { ambiguities: r.out.ambiguities };
}
