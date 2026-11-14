import type { Ctx } from '../lib/ctx';
import type { NotChecked } from '../../shared/dossier';
import { unitChangedLines } from './map';
import { runAgent } from '../lib/agent';

const INTERNAL = /tests were removed from the worktree|worktree on purpose|second agent agent|pipeline (?:error|artefact)|stage ".+" did not complete|could not run the tests/i;

function numbers(ctx: Ctx) {
  const d = ctx.dossier;
  const files = d.pr.changedFiles || d.files.length;
  const lines = d.files.reduce((n, f) => n + f.hunks.reduce((m, h) => m + h.lines.filter((l) => l.t !== 'ctx').length, 0), 0);
  const clusters = ctx.clusters.map((c) => ({ id: c.id, files: c.totalFiles, additions: c.additions, deletions: c.deletions }));
  const unitLines = new Map(d.units.map((u) => [u.id, unitChangedLines(ctx, u)]));
  return { files, lines, clusters, unitLines };
}

function rewriteNumbers(ctx: Ctx, n: NotChecked): NotChecked | null {
  const x = numbers(ctx);
  let what = n.what; let why = n.why; let changed = false;
  let clusterCount = false;
  for (const c of x.clusters) {
    const re = new RegExp(`\\b\\d+\\s+files?\\b[^.]{0,40}\\b${c.id}\\b`, 'i');
    if (re.test(what + ' ' + why)) { what = what.replace(/\b\d+\s+files?\b/gi, `${c.files} files`); why = why.replace(/\b\d+\s+files?\b/gi, `${c.files} files`); changed = true; clusterCount = true; }
  }
  if (!clusterCount && (/\b\d+\s+files?\b/i.test(what) || /\b\d+\s+files?\b/i.test(why))) { what = what.replace(/\b\d+\s+files?\b/gi, `${x.files} files`); why = why.replace(/\b\d+\s+files?\b/gi, `${x.files} files`); changed = true; }
  if (/\b\d+\s+lines?\b/i.test(what) || /\b\d+\s+lines?\b/i.test(why)) {
    const ids = [...(what + ' ' + why).matchAll(/\bU\d+\b/g)].map((m) => m[0]);
    const count = ids.length ? ids.reduce((s, id) => s + (x.unitLines.get(id) ?? 0), 0) : x.lines;
    what = what.replace(/\b\d+\s+lines?\b/gi, `${count} lines`); why = why.replace(/\b\d+\s+lines?\b/gi, `${count} lines`); changed = true;
  }
  return changed ? { what, why } : n;
}

const DECISION_SCHEMA = { type: 'object', properties: { decisions: { type: 'array', items: { type: 'object', properties: { refusalId: { type: 'string' }, options: { type: 'array', items: { type: 'object', properties: { optionId: { type: 'string' }, implemented: { type: 'boolean' }, implementedWhy: { type: 'string' } }, required: ['optionId', 'implemented', 'implementedWhy'] } } }, required: ['refusalId', 'options'] } } }, required: ['decisions'] };

async function annotateDecisions(ctx: Ctx) {
  if (!ctx.dossier.refusals.length) return;
  try {
    const r = await runAgent<{ decisions: { refusalId: string; options: { optionId: string; implemented: boolean; implementedWhy: string }[] }[] }>({
      name: 'decision-implementation', model: process.env.CS_FAST_MODEL || 'claude-sonnet-5-5', cwd: ctx.wt('head'), tools: ['Read', 'Grep', 'Glob'], schema: DECISION_SCHEMA,
      system: 'You read the PR head code to annotate options in a code-review dossier. Return facts only; never recommend an option.',
      prompt: ctx.dossier.refusals.map((r) => `${r.id}: ${r.question}\n${r.options.map((o) => `${o.id}: ${o.label} — ${o.consequence}`).join('\n')}\nExisting refs: ${(r.refs ?? []).map((x) => `${x.path}:${x.startLine}`).join(', ')}`).join('\n\n') + '\n\nFor every option, decide whether the PR-head code currently implements it. Cite one exact file:line in implementedWhy.', timeoutMs: 10 * 60_000,
    });
    for (const d of r.out.decisions) {
      const ref = ctx.dossier.refusals.find((x) => x.id === d.refusalId); if (!ref) continue;
      for (const o of d.options ?? []) { const target = ref.options.find((x) => x.id === o.optionId); if (target) { target.implemented = !!o.implemented; target.implementedWhy = o.implementedWhy?.trim() || 'Code-reading agent found no implementation citation.'; } }
    }
  } catch (e) { ctx.detail('consistency', `decision implementation annotation failed: ${(e as Error).message.slice(0, 120)}`); }
}

export async function consistency(ctx: Ctx) {
  await annotateDecisions(ctx);
  const d = ctx.dossier; const fixed: string[] = []; const executed = d.evidence.filter((e) => e.strength === 'executed');
  for (const c of d.requirement.criteria.filter((x) => x.status === 'violated')) {
    const before = c.evidenceIds.length;
    c.evidenceIds = c.evidenceIds.filter((id) => d.evidence.find((e) => e.id === id)?.polarity !== 'supports');
    if (before !== c.evidenceIds.length) fixed.push(`removed supporting evidence from violated ${c.id}`);
  }
  const before = d.notChecked.length;
  const out: NotChecked[] = [];
  for (const original of d.notChecked) {
    if (INTERNAL.test(original.what + ' ' + original.why)) { fixed.push(`dropped internal pipeline note: ${original.what}`); continue; }
    const n = rewriteNumbers(ctx, original)!;
    if (n.what !== original.what || n.why !== original.why) fixed.push(`recomputed numbers in not-checked item: ${original.what}`);
    const text = `${n.what} ${n.why}`;
    const contradiction = /no (?:build|tests?|execution)|(?:build|tests?) (?:were )?not run|nothing was executed/i.test(text) && executed.length > 0;
    if (contradiction) { fixed.push(`dropped contradiction with executed evidence: ${n.what}`); continue; }
    if (!out.some((x) => x.what === n.what && x.why === n.why)) out.push(n);
  }
  d.notChecked = out;
  d.consistency = { fixed };
  ctx.detail('consistency', `${before} not-checked items → ${out.length}; ${fixed.length} fix(es)`);
  ctx.save();
}

