import type { Diagram, Story } from '../../shared/dossier';
import { MODELS, UNTRUSTED, runAgent } from '../lib/agent';
import type { Ctx } from '../lib/ctx';

const NODE = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    label: { type: 'string', description: '<= 28 chars' },
    sublabel: { type: 'string', description: '<= 44 chars, optional detail (file, role)' },
    role: { type: 'string', enum: ['changed', 'added', 'removed', 'affected', 'context', 'test', 'external', 'requirement'] },
    group: { type: 'string', description: 'group id or empty' },
    unitId: { type: 'string', description: 'change unit id this node belongs to, or empty' },
  },
  required: ['id', 'label', 'sublabel', 'role', 'group', 'unitId'],
};
const EDGE = {
  type: 'object',
  properties: {
    from: { type: 'string' },
    to: { type: 'string' },
    label: { type: 'string', description: '<= 24 chars or empty' },
    role: { type: 'string', enum: ['new', 'removed', 'existing', 'broken'] },
  },
  required: ['from', 'to', 'label', 'role'],
};
const DIAGRAM = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    caption: { type: 'string', description: 'One sentence telling the reader what to notice.' },
    nodes: { type: 'array', items: NODE },
    edges: { type: 'array', items: EDGE },
    groups: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' } }, required: ['id', 'label'] } },
  },
  required: ['title', 'caption', 'nodes', 'edges', 'groups'],
};
const SCHEMA = {
  type: 'object',
  properties: {
    story: {
      type: 'object',
      properties: {
        headline: { type: 'string', description: 'One sentence a non-author understands: what this change makes true.' },
        before: { type: 'string', description: '1–3 sentences: what was broken or missing, in terms of observable behaviour.' },
        after: { type: 'string', description: '1–3 sentences: what is true after the change.' },
        steps: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, unitIds: { type: 'array', items: { type: 'string' } } }, required: ['text', 'unitIds'] } },
        alsoTouches: { type: 'array', items: { type: 'string' }, description: 'Side effects and behaviour changes outside the requirement. Empty if none.' },
      },
      required: ['headline', 'before', 'after', 'steps', 'alsoTouches'],
    },
    changeMap: DIAGRAM,
    beforeAfter: DIAGRAM,
  },
  required: ['story', 'changeMap', 'beforeAfter'],
};

type Raw = { story: Story; changeMap: Omit<Diagram, 'id' | 'kind'>; beforeAfter: Omit<Diagram, 'id' | 'kind'> };

/** The story a human checks, and the pictures that go with it. Written last, from what the pipeline established. */
export async function explain(ctx: Ctx) {
  const d = ctx.dossier;
  const units = d.units.map((u) => `${u.id} (${u.kind}, +${u.additions} −${u.deletions}, ${u.fileCount} file(s)) ${u.title}: ${u.summary}`).join('\n');
  const blast = d.evidence.filter((e) => e.kind === 'reference-scan').map((e) => `- ${e.conclusion} e.g. ${(e.references?.sample ?? []).slice(0, 3).map((s) => s.path.split('/').pop() + ':' + s.startLine).join(', ')}`).join('\n');
  const findings = d.findings.map((f) => `- [${f.severity}/${f.strength}] ${f.title}`).join('\n') || '(none)';
  const r = await ctx.cached('explain', () =>
    runAgent<Raw>({
      name: 'explain',
      model: MODELS.default,
      cwd: ctx.wt('head'),
      system: `You explain a code change to the engineer who must sign for it, so they can check the explanation instead of reconstructing it from the diff. Plain language, short sentences, no praise, no hedging adjectives. You may Read/Grep the PR head (your working directory) to get names and call paths right. ${UNTRUSTED}`,
      schema: SCHEMA,
      prompt: `Requirement ${d.requirement.id}: ${d.requirement.title}\n\n<requirement>\n${d.requirement.body.slice(0, 5000)}\n</requirement>\n\nChange units (already grouped and ordered):\n${units}\n\nMeasured blast radius:\n${blast || '(none measured)'}\n\nReviewer findings so far:\n${findings}\n\nWrite:\n1. story — headline, before, after, 3–6 steps in narrative order (each step names the unit ids it covers; every unit should appear in some step), and alsoTouches: at most 4 plain facts, one sentence each, about what the code now does BEYOND what the requirement asked for (other inputs, other callers, user-visible output). State the behaviour, not a judgment. Do not restate or list the findings and never start an item with "Finding"; findings are shown in their own section.\n\n2. changeMap — a diagram of WHAT IS BEING BUILT AND WHAT IT AFFECTS. 8–14 nodes:\n   - one "requirement" node (${d.requirement.id});\n   - "changed"/"added" nodes for the code this PR touches (one per unit or per key symbol; set unitId);\n   - "affected" nodes for existing code or consumers whose behaviour changes because of it (callers, downstream stages, the user's build);\n   - "context" nodes for unchanged neighbours needed to understand the flow;\n   - "test" nodes for the tests that cover it; "external" for things outside the repo (user project, compiler, IDE).\n   Edges follow the real call/data flow (role "existing"), mark flow introduced by this PR as "new". Use 2–4 groups (e.g. "User project", "Source generator", "Analyzer", "Tests"). Labels are short names, not sentences.\n\n3. beforeAfter — the SAME scenario from the requirement drawn as a flow, showing where it failed before and what happens now. 6–12 nodes. Use groups "Before" and "After" (duplicate the nodes with distinct ids). In "Before", mark the failing step's outgoing edge role "broken" and the node role "removed" if it is the faulty step; in "After", mark the new/changed step "changed" or "added" and new edges "new".\n\nEvery edge must reference existing node ids. Use unitId only from: ${d.units.map((u) => u.id).join(', ')}.`,
      timeoutMs: 15 * 60_000,
    }),
  );
  ctx.detail('explain', '', r.costUsd);
  const unitIds = new Set(d.units.map((u) => u.id));
  r.out.story.alsoTouches = (r.out.story.alsoTouches ?? []).filter((x) => !/^\s*finding\b/i.test(x)).slice(0, 4);
  d.story = { ...r.out.story, steps: r.out.story.steps.map((s) => ({ text: s.text, unitIds: (s.unitIds ?? []).filter((u) => unitIds.has(u)) })) };
  const clean = (x: Raw['changeMap'], id: string, kind: Diagram['kind']): Diagram => {
    const ids = new Set(x.nodes.map((n) => n.id));
    const tiers = new Map(d.units.map((u) => [u.id, u.tier]));
    return {
      id,
      kind,
      title: x.title,
      caption: x.caption,
      nodes: x.nodes.map((n) => ({ id: n.id, label: n.label, sublabel: n.sublabel || undefined, role: n.role, group: n.group || undefined, unitId: n.unitId && unitIds.has(n.unitId) ? n.unitId : undefined, tier: n.unitId ? tiers.get(n.unitId) : undefined })),
      edges: x.edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to).map((e) => ({ from: e.from, to: e.to, label: e.label || undefined, role: e.role, style: e.role === 'broken' ? 'dashed' : 'solid' })),
      groups: (x.groups ?? []).filter((g) => x.nodes.some((n) => n.group === g.id)),
    };
  };
  d.diagrams = [clean(r.out.changeMap, 'D1', 'change-map'), clean(r.out.beforeAfter, 'D2', 'before-after')];
}
