import type { ChangeUnit, FileDiff, Hunk, UnitKind } from '../../shared/dossier';
import { MODELS, UNTRUSTED, runAgent } from '../lib/agent';
import type { Ctx } from '../lib/ctx';
import { changedLines, renderHunk } from '../lib/diff';
import { isTestPath } from '../lib/policy';
import { exec } from '../lib/util';

/** Facts the mapper asserts about a unit. The policy turns facts into points; the model never sets a tier. */
export type FactKey = 'publicApi' | 'securitySensitive' | 'behaviourChangeOutsideRequirement' | 'novelLogic' | 'errorHandling' | 'dependency';

export interface UnitDraft {
  title: string;
  kind: UnitKind;
  summary: string;
  hunkIds: string[];
  clusterIds: string[];
  criteriaIds: string[];
  storyOrder: number;
  readingNote: string;
  facts: { key: FactKey; why: string }[];
  blastSymbols: string[];
}

/** Compact, id-annotated rendering of the diff. Repetitive clusters are shown as rule + samples. */
export function renderDiff(ctx: Ctx, maxChars = 170_000): string {
  const d = ctx.dossier;
  const inCluster = new Map<string, string>();
  for (const c of ctx.clusters) for (const f of c.fileIds) inCluster.set(f, c.id);
  const parts: string[] = [];
  for (const c of ctx.clusters) {
    const fs = c.fileIds.map((id) => d.files.find((f) => f.id === id)!);
    parts.push(
      `=== CLUSTER ${c.id}: ${c.totalFiles} files (+${c.additions} −${c.deletions}) whose every changed line is one of these ${c.vocabulary.length} lines ===\n${c.vocabulary.join('\n')}\nFiles (first 10 of ${fs.length}):\n${fs.slice(0, 10).map((f) => '  ' + f.path).join('\n')}\nSample hunks:\n${fs.slice(0, 2).flatMap((f) => f.hunks.slice(0, 2).map((h) => renderHunk(f, h, 40))).join('\n\n')}\n=== END CLUSTER ${c.id} ===`,
    );
  }
  let budget = maxChars - parts.join('\n').length;
  for (const f of d.files) {
    if (inCluster.has(f.id)) continue;
    parts.push(`\n##### FILE ${f.id} ${f.path} (${f.status}, +${f.additions} −${f.deletions})`);
    for (const h of f.hunks) {
      const cap = budget > 60_000 ? 260 : budget > 20_000 ? 80 : 25;
      const s = renderHunk(f, h, cap);
      budget -= s.length;
      parts.push(s);
    }
  }
  if (budget < 20_000) parts.push('\n(Some hunks were truncated. Use Read on the file in the working directory — it is the PR head — to see everything.)');
  return parts.join('\n');
}

const MAP_SCHEMA = {
  type: 'object',
  properties: {
    units: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Imperative, specific, <= 70 chars. What this unit does.' },
          kind: { type: 'string', enum: ['core-logic', 'api-surface', 'test', 'generated', 'mechanical', 'docs', 'build-config'] },
          summary: { type: 'string', description: '1–2 plain sentences a reviewer who has not seen the code understands.' },
          hunkIds: { type: 'array', items: { type: 'string' } },
          clusterIds: { type: 'array', items: { type: 'string' } },
          criteriaIds: { type: 'array', items: { type: 'string' }, description: 'Acceptance criteria this unit serves. Empty ONLY if it serves none (scope creep).' },
          storyOrder: { type: 'integer' },
          readingNote: { type: 'string', description: 'If a human reads this unit: the one thing to look at and question. One sentence.' },
          facts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                key: { type: 'string', enum: ['publicApi', 'securitySensitive', 'behaviourChangeOutsideRequirement', 'novelLogic', 'errorHandling', 'dependency'] },
                why: { type: 'string', description: 'The concrete observation, citing the symbol or line.' },
              },
              required: ['key', 'why'],
            },
          },
          blastSymbols: { type: 'array', items: { type: 'string' }, description: 'Up to 3 identifiers (method/type/property names, no namespaces) EXISTING before this PR whose behaviour this unit changes; used to measure blast radius by reference count.' },
        },
        required: ['title', 'kind', 'summary', 'hunkIds', 'clusterIds', 'criteriaIds', 'storyOrder', 'readingNote', 'facts', 'blastSymbols'],
      },
    },
  },
  required: ['units'],
};

export async function mapUnits(ctx: Ctx) {
  const d = ctx.dossier;
  const criteria = d.requirement.criteria.map((c) => `${c.id} [${c.kind}] ${c.text}`).join('\n') || '(no requirement — every unit is untraced)';
  const r = await ctx.cached('map', () =>
    runAgent<{ units: UnitDraft[] }>({
      name: 'map',
      model: MODELS.default,
      cwd: ctx.wt('head'),
      system: `You are the mapper in a code-review pipeline. You group a diff into Change Units: each unit is ONE idea a reviewer can hold in their head, regardless of how many files it spans. You state checkable facts; you do not judge quality and you do not assign risk. Your working directory is a checkout of the PR head — use Read/Grep/Glob to understand what the changed code does and who calls it. ${UNTRUSTED}`,
      schema: MAP_SCHEMA,
      prompt: `Requirement ${d.requirement.id}: ${d.requirement.title}\n\nAcceptance criteria (derived from the requirement only):\n${criteria}\n\nPR title: ${d.pr.title}\n\nThe diff (hunk ids in [brackets]; repetitive clusters are summarised as a rule plus samples):\n\n${renderDiff(ctx)}\n\nGroup ALL hunks and ALL clusters into change units.\nRules:\n- Every hunk id and every cluster id must appear in exactly one unit.\n- Split by idea, not by file: one file may feed several units; several files may form one unit. Keep the behavioural core in small units (ideally one decision each) — these are what a human will read.\n- Tests that prove a behaviour are their own unit(s) of kind "test". Golden/snapshot/generated outputs are "generated". Identical repeated edits are "mechanical". Docs are "docs". Project/dependency/CI files are "build-config". New or changed public types, attributes, diagnostics ids, options are "api-surface".\n- criteriaIds: which acceptance criteria the unit serves (tests and docs: the criteria they test/document). Leave empty only when the unit serves no criterion — that is important information, do not paper over it.\n- facts: only facts that are TRUE for the unit, each with the concrete observation:\n  publicApi = adds/changes something users of the library can see or call;\n  securitySensitive = touches parsing of untrusted input, auth, crypto, file/network access, code generation that runs in users' builds;\n  behaviourChangeOutsideRequirement = changes behaviour for cases the requirement did not ask about;\n  novelLogic = new branching/algorithm rather than a mechanical edit;\n  errorHandling = adds/removes/swallows errors, diagnostics, exceptions, null handling;\n  dependency = adds or bumps a dependency or toolchain version.\n- storyOrder: the order in which to explain the change (1 = start here): cause → core fix → consequences → tests → docs/mechanical.\n- blastSymbols: existing identifiers whose behaviour changes (not newly added ones).`,
      timeoutMs: 15 * 60_000,
    }),
  );
  ctx.detail('map', '', r.costUsd);

  const hunkById = new Map<string, { f: FileDiff; h: Hunk }>();
  for (const f of d.files) for (const h of f.hunks) hunkById.set(h.id, { f, h });
  const taken = new Set<string>();
  const units: (ChangeUnit & { draft: UnitDraft })[] = [];
  const drafts = [...r.out.units].sort((a, b) => a.storyOrder - b.storyOrder);
  for (const u of drafts) {
    const ids: string[] = [];
    for (const cid of u.clusterIds ?? []) {
      const c = ctx.clusters.find((x) => x.id === cid);
      if (c) for (const fid of c.fileIds) for (const h of d.files.find((f) => f.id === fid)!.hunks) ids.push(h.id);
    }
    for (const id of u.hunkIds ?? []) ids.push(id);
    const mine = [...new Set(ids)].filter((id) => hunkById.has(id) && !taken.has(id));
    if (!mine.length) continue;
    mine.forEach((id) => taken.add(id));
    units.push(makeUnit(ctx, `U${units.length + 1}`, u, mine, hunkById));
  }
  // anything the mapper forgot is not silently dropped: it becomes an explicit untraced unit
  const left = [...hunkById.keys()].filter((id) => !taken.has(id));
  if (left.length) {
    const byKind = new Map<UnitKind, string[]>();
    for (const id of left) {
      const p = hunkById.get(id)!.f.path;
      const k: UnitKind = p.endsWith('.md') ? 'docs' : isTestPath(ctx.policy, p) ? 'test' : 'core-logic';
      byKind.set(k, [...(byKind.get(k) ?? []), id]);
    }
    for (const [k, ids] of byKind)
      units.push(
        makeUnit(ctx, `U${units.length + 1}`, { title: `Changes the mapper did not explain (${k})`, kind: k, summary: 'These hunks were not assigned to any idea by the mapper. Treat as unexplained.', hunkIds: ids, clusterIds: [], criteriaIds: [], storyOrder: 99, readingNote: 'Nobody explained why these lines changed.', facts: [], blastSymbols: [] }, ids, hunkById),
      );
  }
  const validCrit = new Set(d.requirement.criteria.map((c) => c.id));
  units.forEach((u, i) => {
    u.storyOrder = i + 1;
    u.criteriaIds = u.criteriaIds.filter((c) => validCrit.has(c));
    u.traced = u.criteriaIds.length > 0;
    for (const id of u.hunkIds) hunkById.get(id)!.h.unitId = u.id;
  });
  ctx.detail('map', `${units.length} units from ${hunkById.size} hunks`);
  return units;
}

function makeUnit(ctx: Ctx, id: string, u: UnitDraft, hunkIds: string[], hunkById: Map<string, { f: FileDiff; h: Hunk }>): ChangeUnit & { draft: UnitDraft } {
  let add = 0;
  let del = 0;
  const files = new Set<string>();
  for (const hid of hunkIds) {
    const { f, h } = hunkById.get(hid)!;
    files.add(f.path);
    for (const l of h.lines) {
      if (l.t === 'add') add++;
      else if (l.t === 'del') del++;
    }
  }
  return { id, title: u.title, kind: u.kind, summary: u.summary, hunkIds, fileCount: files.size, additions: add, deletions: del, tier: 'T3', riskFactors: [], criteriaIds: u.criteriaIds ?? [], traced: false, ask: 'read', storyOrder: u.storyOrder, readingNote: u.readingNote || undefined, draft: u };
}

/** Blast radius: count references to the symbols a unit changes, outside the PR's own added lines. */
export async function scanReferences(ctx: Ctx, units: (ChangeUnit & { draft: UnitDraft })[]) {
  const d = ctx.dossier;
  const out = new Map<string, { evidenceId: string; count: number }>();
  for (const u of units) {
    const syms = (u.draft.blastSymbols ?? []).filter((s) => /^[A-Za-z_][A-Za-z0-9_]{3,}$/.test(s)).slice(0, 3);
    if (!syms.length || u.kind === 'test' || u.kind === 'docs') continue;
    let best: { symbol: string; count: number; sample: { path: string; startLine: number; endLine: number; quote: string }[] } | null = null;
    for (const s of syms) {
      const r = await exec('git', ['grep', '-n', '-w', '-F', s, '--', '*.cs', '*.ts', '*.tsx', '*.js', '*.py', '*.go', '*.java', '*.tt'], { cwd: ctx.wt('head') });
      const added = new Set(d.files.flatMap((f) => f.hunks.flatMap((h) => h.lines.filter((l) => l.t === 'add').map((l) => `${f.path}:${l.n}`))));
      const hits = r.stdout.split('\n').filter(Boolean).map((l) => /^([^:]+):(\d+):(.*)$/.exec(l)).filter((m): m is RegExpExecArray => !!m && !added.has(`${m[1]}:${m[2]}`));
      if (!best || hits.length > best.count) best = { symbol: s, count: hits.length, sample: hits.slice(0, 6).map((m) => ({ path: m[1], startLine: Number(m[2]), endLine: Number(m[2]), quote: m[3].trim().slice(0, 160) })) };
    }
    if (!best) continue;
    const evidenceId = ctx.addEvidence({
      kind: 'reference-scan',
      strength: 'verified-static',
      title: `Blast radius of ${best.symbol}`,
      conclusion: `\`${best.symbol}\` is referenced on ${best.count} line(s) outside this change.`,
      polarity: 'neutral',
      command: `git grep -n -w -F ${best.symbol}`,
      references: best,
      producedBy: 'map/reference-scan',
    });
    out.set(u.id, { evidenceId, count: best.count });
  }
  return out;
}

export const unitChangedLines = (ctx: Ctx, u: ChangeUnit) => {
  const set = new Set(u.hunkIds);
  let n = 0;
  for (const f of ctx.dossier.files) for (const h of f.hunks) if (set.has(h.id)) n += changedLines(h);
  return n;
};
