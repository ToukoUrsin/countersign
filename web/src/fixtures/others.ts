/** Secondary fixtures: a running dossier, small "lite" dossiers for the inbox, me, policy. */
import type { Dossier, FileDiff, RiskTier, StageTrace } from '../../../shared/dossier';

export const me = {
  login: 'ToukoUrsin',
  name: 'Touko Ursin',
  avatarUrl: 'https://avatars.githubusercontent.com/u/125314120?v=4',
};

export const STAGE_PLAN: { name: string; title: string; model?: string; ms: number; detail?: string }[] = [
  { name: 'fetch', title: 'Fetch PR and requirement', ms: 2200, detail: 'PR, linked issue, diff' },
  { name: 'criteria', title: 'Derive acceptance criteria from the requirement', model: 'claude-opus-5-5', ms: 4200, detail: 'PR description withheld from the model' },
  { name: 'units', title: 'Group the diff into change units', model: 'claude-sonnet-5-5', ms: 3600 },
  { name: 'sandbox', title: 'Build, red→green, regression', ms: 7800, detail: 'base and head worktrees' },
  { name: 'ablation', title: 'Ablation: revert each unit', ms: 4600 },
  { name: 'review', title: 'Review and write probes', model: 'claude-fable-5-2', ms: 6400 },
  { name: 'verify', title: 'Verify findings', model: 'claude-opus-5-5', ms: 3800 },
  { name: 'selftest', title: 'Reviewer self-test (canaries)', model: 'claude-fable-5-2', ms: 5200 },
  { name: 'route', title: 'Risk tiers and reading plan', ms: 900 },
  { name: 'compose', title: 'Compose dossier', model: 'claude-sonnet-5-5', ms: 2400 },
];

export function stagesAt(elapsedMs: number): { stages: StageTrace[]; done: boolean } {
  let t = 0;
  let done = true;
  const stages = STAGE_PLAN.map((s): StageTrace => {
    const start = t;
    t += s.ms;
    if (elapsedMs >= t) return { name: s.name, title: s.title, status: 'done', durationMs: s.ms * 9, model: s.model, detail: s.detail };
    done = false;
    if (elapsedMs >= start) return { name: s.name, title: s.title, status: 'running', model: s.model, detail: s.detail };
    return { name: s.name, title: s.title, status: 'pending', model: s.model };
  });
  return { stages, done };
}

interface LiteSpec {
  owner?: string;
  repo?: string;
  number: number;
  title: string;
  req: string;
  reqTitle: string;
  author: string;
  authorKind?: 'agent' | 'human';
  tier: RiskTier;
  verdict: Dossier['recommendation']['verdict'];
  status?: Dossier['status'];
  area: string;
  trust: [number, string];
  minutes: number;
  shape: 'mechanical' | 'risky' | 'small';
  generatedAt: string;
}

const sha = (n: number) => (BigInt(n) * 0x9e3779b97f4a7c15n + 0x1234567890abcdefn).toString(16).padStart(40, '0').slice(-40);

/** A small but complete dossier so every inbox row opens to something real in mock mode. */
export function makeLite(s: LiteSpec): Dossier {
  const owner = s.owner ?? 'te-industry-tech-office';
  const repo = s.repo ?? 'junction26-messagepack-csharp';
  const slug = `${owner}__${repo}__${s.number}`;
  const path = s.shape === 'mechanical' ? 'src/MessagePack/Formatters/PrimitiveFormatter.cs' : s.shape === 'risky' ? 'src/MessagePack/Resolvers/DynamicObjectResolver.cs' : 'src/MessagePack/MessagePackSerializerOptions.cs';
  const file: FileDiff = {
    id: 'F1',
    path,
    status: 'modified',
    additions: 6,
    deletions: 4,
    language: 'csharp',
    hunks: [
      {
        id: 'F1.H1',
        header: '@@ -118,9 +118,11 @@ public sealed class Formatter',
        oldStart: 118,
        newStart: 118,
        unitId: 'U1',
        lines: [
          { t: 'ctx', o: 118, n: 118, s: '        public void Serialize(ref MessagePackWriter writer, T value, MessagePackSerializerOptions options)' },
          { t: 'ctx', o: 119, n: 119, s: '        {' },
          { t: 'del', o: 120, s: '            if (value == null)' },
          { t: 'del', o: 121, s: '            {' },
          { t: 'add', n: 120, s: '            if (value is null)' },
          { t: 'add', n: 121, s: '            {' },
          { t: 'add', n: 122, s: '                // Null is encoded as nil, never as an empty map.' },
          { t: 'ctx', o: 122, n: 123, s: '                writer.WriteNil();' },
          { t: 'ctx', o: 123, n: 124, s: '                return;' },
          { t: 'ctx', o: 124, n: 125, s: '            }' },
          { t: 'del', o: 125, s: '            options.Security.DepthStep(ref writer);' },
          { t: 'del', o: 126, s: '            writer.WriteMapHeader(count);' },
          { t: 'add', n: 126, s: '' },
          { t: 'add', n: 127, s: '            options.Security.DepthStep(ref writer);' },
          { t: 'add', n: 128, s: '            writer.WriteMapHeader(this.memberCount);' },
          { t: 'ctx', o: 127, n: 129, s: '        }' },
        ],
      },
    ],
  };
  const total = s.shape === 'mechanical' ? 412 : s.shape === 'risky' ? 96 : 38;
  const read = s.tier === 'T0' ? 0 : s.tier === 'T1' ? 0 : s.tier === 'T2' ? Math.round(total * 0.3) : total;
  const skim = s.tier === 'T1' ? Math.round(total * 0.4) : 0;
  const signed = s.status === 'signed' || s.status === 'rejected';
  return {
    schema: 1,
    id: `${owner}/${repo}#${s.number}`,
    slug,
    status: s.status ?? 'ready',
    generatedAt: s.generatedAt,
    pr: {
      owner,
      repo,
      number: s.number,
      url: `https://github.com/${owner}/${repo}/pull/${s.number}`,
      title: s.title,
      body: '',
      author: s.author,
      authorKind: s.authorKind ?? 'agent',
      baseRef: 'develop',
      headRef: `agent/${s.req.toLowerCase()}`,
      baseSha: sha(s.number),
      headSha: sha(s.number + 1000),
      additions: Math.round(total * 0.7),
      deletions: total - Math.round(total * 0.7),
      changedFiles: s.shape === 'mechanical' ? 31 : 3,
      createdAt: s.generatedAt,
    },
    requirement: {
      id: s.req,
      title: s.reqTitle,
      sourceUrl: `https://github.com/MessagePack-CSharp/MessagePack-CSharp/issues/${s.req.replace(/\D/g, '')}`,
      body: s.reqTitle,
      criteria: [
        { id: 'AC1', text: s.reqTitle, kind: 'functional', status: 'proven', evidenceIds: ['E1'] },
        { id: 'AC2', text: 'Nothing that passed before the change fails after it.', kind: 'implicit', status: s.shape === 'risky' ? 'unproven' : 'proven', evidenceIds: s.shape === 'risky' ? [] : ['E2'] },
      ],
    },
    story: {
      headline: s.title,
      before: 'The behaviour described in the requirement.',
      after: 'The requirement holds, shown by a test that fails on base and passes on head.',
      steps: [{ text: s.title, unitIds: ['U1'] }],
      alsoTouches: [],
    },
    diagrams: [],
    units: [
      {
        id: 'U1',
        title: s.title,
        kind: s.shape === 'mechanical' ? 'mechanical' : 'core-logic',
        summary: s.shape === 'mechanical' ? 'The same rewrite applied at every call site; each site was checked against the rule.' : 'The behavioural change itself.',
        hunkIds: ['F1.H1'],
        fileCount: 1,
        additions: 6,
        deletions: 4,
        tier: s.tier,
        riskFactors:
          s.shape === 'mechanical'
            ? [{ key: 'mechanical-verified', label: 'Mechanical, 227/227 sites verified', detail: 'AST equivalence check of `== null` → `is null` at every site.', points: -4, evidenceIds: ['E3'] }]
            : [
                { key: 'blast-radius', label: 'Called from 14 places', detail: 'Reference scan at head.', points: 3 },
                { key: 'area-trust', label: `Area "${s.area}" is ${s.trust[1]}`, detail: 'From the trust ledger.', points: s.trust[0] === 0 ? 3 : 0 },
              ],
        criteriaIds: ['AC1'],
        traced: true,
        ask: s.tier === 'T0' ? 'none' : s.tier === 'T1' ? 'skim' : 'read',
        skipProof: s.tier === 'T0' ? { text: 'Every site matches the rewrite rule and the suite is unchanged.', evidenceIds: ['E3', 'E2'] } : undefined,
        storyOrder: 1,
      },
    ],
    files: [file],
    evidence: [
      {
        id: 'E1',
        kind: 'red-green',
        strength: 'executed',
        title: 'PR test: red on base, green on head',
        conclusion: 'The test added by the PR fails on base and passes on head.',
        polarity: 'supports',
        command: 'dotnet test tests/MessagePack.Tests --filter "FullyQualifiedName~Regression"',
        base: { sha: sha(s.number), label: 'base source + PR tests', outcome: 'fail', passed: 0, failed: 1, skipped: 0, durationMs: 9100, failing: ['Regression.Requirement_Holds'], excerpt: 'Failed!  - Failed: 1, Passed: 0' },
        head: { sha: sha(s.number + 1000), label: 'head', outcome: 'pass', passed: 1, failed: 0, skipped: 0, durationMs: 8800, excerpt: 'Passed!  - Failed: 0, Passed: 1' },
        producedBy: 'sandbox.red-green',
      },
      {
        id: 'E2',
        kind: 'regression',
        strength: 'executed',
        title: 'Existing suite: no regressions',
        conclusion: 'Everything that passed on base passes on head.',
        polarity: 'supports',
        command: 'dotnet test tests/MessagePack.Tests -c Release',
        base: { sha: sha(s.number), label: 'base', outcome: 'pass', passed: 4102, failed: 0, skipped: 11, durationMs: 412000 },
        head: { sha: sha(s.number + 1000), label: 'head', outcome: 'pass', passed: 4103, failed: 0, skipped: 11, durationMs: 409000 },
        producedBy: 'sandbox.regression',
      },
      {
        id: 'E3',
        kind: 'mechanical',
        strength: 'verified-static',
        title: 'Every site matches the rewrite rule',
        conclusion: 'All changed sites are the same AST rewrite; none deviates.',
        polarity: 'supports',
        mechanical: { rule: '`x == null` → `x is null` with identical operand', matched: 227, total: 227, exceptions: [] },
        producedBy: 'static.mechanical',
      },
    ],
    findings: [],
    discarded: [],
    refusals:
      s.shape === 'risky'
        ? [
            {
              id: 'R1',
              question: 'Is a 4% slower cold start acceptable for this fix?',
              why: 'Performance budgets are a product decision.',
              reasonKind: 'risk-appetite',
              options: [
                { id: 'yes', label: 'Yes', consequence: 'Merge as is.' },
                { id: 'no', label: 'No', consequence: 'Request changes.' },
              ],
              context: 'Measured once in the sandbox; variance not characterised.',
              evidenceIds: ['E1'],
              blocking: true,
            },
          ]
        : [],
    notChecked: [{ what: 'Unity and IL2CPP targets', why: 'Not available in the sandbox.' }],
    selfTest: { planted: 5, caught: 5, canaries: [], reading: 'All planted bugs were caught.' },
    routing: {
      tier: s.tier,
      score: { T0: -3, T1: 1, T2: 6, T3: 11 }[s.tier],
      areas: [{ area: s.area, trustLevel: s.trust[0], trustLabel: s.trust[1] }],
      readLines: read,
      skimLines: skim,
      skipLines: total - read - skim,
      totalLines: total,
      estMinutes: s.minutes,
      spotCheck: { selected: s.shape === 'mechanical', reason: s.shape === 'mechanical' ? 'Sampled: 1 in 20 PRs in a Proven area gets a full human read.' : 'Not sampled.' },
      policyVersion: '2026-11-12.3',
      rulesFired: [],
    },
    recommendation: {
      verdict: s.verdict,
      summary: s.shape === 'mechanical' ? 'A mechanical rewrite, verified site by site.' : s.shape === 'risky' ? 'Touches an area on probation; every line needs the owner.' : 'Small, proven by a red→green test.',
      distrustIf: [],
    },
    stages: stagesAt(1e9).stages,
    signoff: signed
      ? {
          signer: s.status === 'signed' ? 'aarnio' : 'mlindqvist',
          signerName: s.status === 'signed' ? 'Aino Aarnio' : 'Mikael Lindqvist',
          at: s.generatedAt,
          decision: s.status === 'signed' ? 'accepted' : 'rejected',
          headSha: sha(s.number + 1000),
          readUnitIds: s.tier === 'T0' ? [] : ['U1'],
          answers: [],
          findingFeedback: [],
          checkedByAI: ['PR test: red on base, green on head', 'Existing suite: no regressions'],
          checkedByHuman: s.tier === 'T0' ? [] : ['Read U1'],
          notChecked: ['Unity and IL2CPP targets'],
          residualRisk: [],
          reviewSeconds: s.minutes * 60 - 14,
          hash: 'b7e1' + sha(s.number + 7) + sha(s.number + 9).slice(0, 20),
          prevHash: '03fa' + sha(s.number + 3) + sha(s.number + 5).slice(0, 20),
          github: { statusUrl: `https://github.com/${owner}/${repo}/pull/${s.number}/checks`, commentUrl: `https://github.com/${owner}/${repo}/pull/${s.number}#issuecomment-1` },
        }
      : undefined,
  };
}

export const liteDossiers: Dossier[] = [
  makeLite({ number: 17, title: 'Bound recursion depth in DynamicObjectResolver for self-referential unions', req: 'REQ-2291', reqTitle: 'Stack overflow when a union type references itself through a generic argument', author: 'ju26-coding-agent', tier: 'T3', verdict: 'full-read-required', area: 'Resolvers / AOT', trust: [0, 'Probation'], minutes: 14, shape: 'risky', generatedAt: '2026-11-13T16:20:00Z' }),
  makeLite({ number: 15, title: 'Replace `== null` with `is null` in formatters', req: 'REQ-2240', reqTitle: 'Formatters must not invoke overloaded equality operators on user types', author: 'ju26-coding-agent', tier: 'T0', verdict: 'accept', area: 'Runtime formatters', trust: [2, 'Trusted'], minutes: 1, shape: 'mechanical', generatedAt: '2026-11-13T15:05:00Z' }),
  makeLite({ number: 11, title: 'Honour CompressionMinLength = 0 in serializer options', req: 'REQ-2268', reqTitle: 'CompressionMinLength of 0 is ignored and the default of 64 is used', author: 'dependabot-fixer', tier: 'T1', verdict: 'accept', status: 'signed', area: 'Runtime formatters', trust: [2, 'Trusted'], minutes: 2, shape: 'small', generatedAt: '2026-11-12T11:40:00Z' }),
  makeLite({ number: 9, title: 'Cache resolver lookups in a static generic class', req: 'REQ-2255', reqTitle: 'Resolver lookup allocates on every call under NativeAOT', author: 'ju26-coding-agent', tier: 'T3', verdict: 'changes-requested', status: 'rejected', area: 'Resolvers / AOT', trust: [0, 'Probation'], minutes: 11, shape: 'risky', generatedAt: '2026-11-11T09:15:00Z' }),
];

export function makeRunning(owner: string, repo: string, number: number, startedAt: string): Dossier {
  const base = makeLite({ owner, repo, number, title: `Pull request #${number}`, req: 'REQ-…', reqTitle: 'Requirement is being fetched', author: 'unknown', tier: 'T1', verdict: 'accept', area: 'Unclassified', trust: [1, 'Supervised'], minutes: 0, shape: 'small', generatedAt: startedAt });
  return {
    ...base,
    status: 'running',
    requirement: { ...base.requirement, criteria: [] },
    story: { headline: '', before: '', after: '', steps: [], alsoTouches: [] },
    units: [],
    files: [],
    evidence: [],
    notChecked: [],
    selfTest: undefined,
    routing: { ...base.routing, readLines: 0, skimLines: 0, skipLines: 0, totalLines: 0 },
    stages: stagesAt(0).stages,
  };
}

export const policy = {
  version: '2026-11-12.3',
  principle: 'The AI advises. A named human countersigns. Reading is spent where judgment is needed; everything else must carry a named proof or be listed as not checked.',
  tiers: [
    { tier: 'T0', name: 'Covered by proof', score: '≤ 0', ask: 'No human read', requires: 'An executed or deterministic proof attached to the unit' },
    { tier: 'T1', name: 'Skim', score: '1–3', ask: 'Skim with the reviewer’s note', requires: 'Red→green or regression evidence' },
    { tier: 'T2', name: 'Read', score: '4–8', ask: 'Read every line', requires: 'Named owner' },
    { tier: 'T3', name: 'Deep read', score: '≥ 9', ask: 'Owner reads, plus a second pair of eyes', requires: 'Owner and one more reviewer' },
  ],
  factors: [
    { factor: 'behaviour-change', points: '+3', when: 'Observable behaviour changes outside the requirement' },
    { factor: 'untraced', points: '+3', when: 'The unit serves no acceptance criterion' },
    { factor: 'blast-radius', points: '+1 to +3', when: 'By number of callers found in the reference scan' },
    { factor: 'security-sensitive', points: '+4', when: 'Auth, crypto, deserialization of untrusted input' },
    { factor: 'public-api', points: '+2', when: 'Public surface, attributes or diagnostic ids change' },
    { factor: 'area-trust', points: '+3 to 0', when: 'Probation +3, Supervised +1, Trusted and Proven 0' },
    { factor: 'untested', points: '+2 / −3', when: '+2 if no test reaches it; −3 if red→green and ablation killed' },
    { factor: 'mechanical-verified', points: '−4', when: 'Every site matches one rewrite rule' },
    { factor: 'test-only / docs-only', points: '−3 / −2', when: 'Nothing in the unit ships' },
  ],
  hardRules: [
    'A behaviour change outside the requirement is never below T2.',
    'An untraced unit is always read, whatever its size.',
    'A unit can be T0 only with executed or deterministic evidence attached. Reasoning alone never lowers a tier.',
    'If the reviewer self-test misses a planted bug of some kind, units of that kind are not skipped.',
    'The AI never approves. A blocking decision cannot be answered by a model.',
  ],
  trustLevels: [
    { level: 0, label: 'Probation', promoteAfter: '5 clean sign-offs', spotCheck: 'every PR', effect: 'Every changed line is read by the owner. AI routing is advisory only.' },
    { level: 1, label: 'Supervised', promoteAfter: '8 clean sign-offs', spotCheck: '1 in 5', effect: 'T0 units may be skipped. Test units are skimmed.' },
    { level: 2, label: 'Trusted', promoteAfter: '20 clean sign-offs', spotCheck: '1 in 10', effect: 'T0 and T1 units may be skipped.' },
    { level: 3, label: 'Proven', promoteAfter: '—', spotCheck: '1 in 20', effect: 'Only T2 and T3 units are read.' },
  ],
  demotion: [
    'An escape (revert or incident traced to a signed PR) drops the area one level and resets its clean streak.',
    'A spot-check that finds something the AI missed drops the area one level.',
    'Two escapes within 30 days put the area on Probation.',
  ],
};
