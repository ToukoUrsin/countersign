import { MODELS, UNTRUSTED, runAgent } from '../lib/agent';
import type { Ctx } from '../lib/ctx';
import { log } from '../lib/util';

const SCHEMA = {
  type: 'object',
  properties: {
    refusalGroups: {
      type: 'array',
      description: 'Groups of refusal indices that ask the same decision. Every index appears in exactly one group; a refusal with no duplicate is a group of one.',
      items: { type: 'array', items: { type: 'integer' } },
    },
    notChecked: {
      type: 'array',
      description: 'The limits that survive, most important first, at most 8.',
      items: {
        type: 'object',
        properties: {
          from: { type: 'array', items: { type: 'integer' }, description: 'Indices of the input items this line stands for.' },
          what: { type: 'string', description: 'What was not checked, at most 14 words, no first person.' },
          why: { type: 'string', description: 'Why, and what it could hide, at most 30 words, no first person.' },
        },
        required: ['from', 'what', 'why'],
      },
    },
  },
  required: ['refusalGroups', 'notChecked'],
};

/**
 * Several independent agents each list decisions they refuse and things they did not check. They do
 * not see each other or the sandbox, so the raw lists repeat themselves and contain "I could not run
 * the tests" from read-only reviewers while the sandbox did run them. One editor pass merges
 * duplicates and removes limits that executed evidence already covers. It may only merge and drop;
 * it cannot add, and it cannot touch findings or criteria.
 */
export async function consolidate(ctx: Ctx) {
  const d = ctx.dossier;
  if (d.refusals.length < 2 && d.notChecked.length < 5) return;
  const executed = d.evidence.filter((e) => e.strength === 'executed').map((e) => `- ${e.title}: ${e.conclusion.slice(0, 160)}`);
  const prompt = `Executed in the sandbox by the pipeline (these things WERE checked):\n${executed.join('\n') || '(nothing)'}\n\nRefusals (decisions left to the human):\n${d.refusals.map((r, i) => `[${i}] ${r.blocking ? '(blocking) ' : ''}${r.question}`).join('\n') || '(none)'}\n\nNot-checked items collected from all stages:\n${d.notChecked.map((n, i) => `[${i}] ${n.what} — ${n.why.slice(0, 300)}`).join('\n')}\n\nTasks:\n1. refusalGroups: group refusals that ask for the same decision, even when worded differently. Two refusals are the same decision when one answer from the owner would settle both.\n2. notChecked: produce the final list for the person who signs. Merge items that say the same thing. DROP items that the executed evidence above already covers (for example "could not build or run the tests" when a regression run is listed). Keep limits that are real: platforms and frameworks not run, criteria with no executed evidence, budget cuts, files nobody opened, tools that were not available. Keep the criterion ID when an item names one. Plain words, no first person. At most 8 items.`;
  try {
    const r = await ctx.cached('consolidate', () =>
      runAgent<{ refusalGroups: number[][]; notChecked: { from: number[]; what: string; why: string }[] }>({
        name: 'consolidate',
        model: MODELS.fast,
        cwd: ctx.runDir,
        tools: [],
        system: `You edit lists for a code review dossier. You only merge and drop; you never invent content. ${UNTRUSTED}`,
        schema: SCHEMA,
        prompt,
        timeoutMs: 5 * 60_000,
      }),
    );
    // refusals: keep the first of each group; a group is blocking if any member is
    const drop = new Set<number>();
    for (const g of r.out.refusalGroups) {
      const idx = g.filter((i) => Number.isInteger(i) && i >= 0 && i < d.refusals.length).sort((a, b) => Number(d.refusals[b].blocking) - Number(d.refusals[a].blocking) || a - b);
      if (idx.length < 2) continue;
      d.refusals[idx[0]].blocking = idx.some((i) => d.refusals[i].blocking);
      for (const i of idx.slice(1)) drop.add(i);
    }
    const before = { r: d.refusals.length, n: d.notChecked.length };
    d.refusals = d.refusals.filter((_, i) => !drop.has(i));
    d.refusals.forEach((x, i) => (x.id = x.id === 'R0' ? 'R0' : `R${i + 1}`));
    const nc = r.out.notChecked.filter((n) => n.what?.trim() && n.from?.some((i) => i >= 0 && i < d.notChecked.length)).slice(0, 8);
    // lines the pipeline wrote about its own failures are pinned: the editor cannot drop them
    const pinned = d.notChecked.filter((n) => /did not complete|does not build on the unmodified base|Nothing was executed/.test(n.what + n.why));
    if (nc.length) d.notChecked = [...pinned, ...nc.map((n) => ({ what: n.what.trim(), why: n.why.trim() })).filter((n) => !pinned.some((p) => p.what === n.what))];
    log('consolidate', `refusals ${before.r} → ${d.refusals.length} · not checked ${before.n} → ${d.notChecked.length}`);
  } catch (e) {
    // an editor failure must not lose limits: keep the raw lists
    log('consolidate', `skipped: ${(e as Error).message.slice(0, 120)}`);
  }
}
