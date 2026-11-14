#!/usr/bin/env bun
/**
 * Seeds the trust ledger with 12 weeks of SYNTHETIC history (every event is flagged synthetic:true
 * and shown as such in the UI). The challenge asks for synthetic data only; the real events are the
 * reviews and sign-offs of the sample PRs, appended after this.
 *
 *   bun server/seed.ts --force
 */
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA } from '../pipeline/lib/util';
import { append, computeAreas, ledgerPolicy, readEvents, view } from './ledger';

const FILE = resolve(DATA, 'ledger.jsonl');
if (existsSync(FILE)) {
  if (!process.argv.includes('--force')) {
    console.error('ledger exists; pass --force to replace it');
    process.exit(1);
  }
  rmSync(FILE);
}

let seed = 20261114;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x100000000;
};
const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
const between = (a: number, b: number) => a + rnd() * (b - a);

const policy = ledgerPolicy();
const people = ['a.virtanen', 'm.korhonen', 's.lindqvist', 'j.nieminen', 'e.salo'];
// weekly volume per area
const volume: Record<string, number> = { 'source-generator': 2.2, analyzers: 1.3, 'runtime-core': 0.7, 'annotations-api': 0.4, tests: 2.0, docs: 2.2, build: 0.9, 'generated-snapshots': 0.5 };
// planned escapes: [week index, area, kind, note]
const escapes: [number, string, string, string][] = [
  [2, 'build', 'revert', 'dependency bump broke the netstandard2.0 pack; reverted'],
  [8, 'source-generator', 'incident', 'generated resolver missing for nested generic records in a consumer build'],
];
const misses: [number, string, string][] = [[5, 'analyzers', 'full read found a diagnostic id collision the AI review did not flag']];

const WEEKS = 12;
const end = new Date('2026-11-13T09:00:00Z');
const start = new Date(end.getTime() - WEEKS * 7 * 86400_000);
let prNo = 100;

for (let w = 0; w < WEEKS; w++) {
  const t = w / (WEEKS - 1); // 0 → 1 over the period
  const weekStart = new Date(start.getTime() + w * 7 * 86400_000);
  const jobs: { area: string; at: Date }[] = [];
  for (const [area, v] of Object.entries(volume)) {
    const n = Math.floor(v) + (rnd() < v - Math.floor(v) ? 1 : 0);
    for (let i = 0; i < n; i++) jobs.push({ area, at: new Date(weekStart.getTime() + between(0.2, 4.8) * 86400_000) });
  }
  jobs.sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const j of jobs) {
    const pr = `synthetic/messagepack#${++prNo}`;
    const level = computeAreas(readEvents(), policy).find((a) => a.area === j.area)?.level ?? 1;
    const crit = policy.areas.find((a) => a.name === j.area)?.criticality ?? 'medium';
    // tier mix: higher trust and lower criticality route lower
    const base = (crit === 'high' ? 2.2 : crit === 'medium' ? 1.5 : 0.6) - level * 0.45 + (1 - t) * 1.1 + between(-0.7, 0.7);
    const tier = base >= 2.4 ? 'T3' : base >= 1.4 ? 'T2' : base >= 0.5 ? 'T1' : 'T0';
    const total = Math.round(between(30, 420));
    const share = { T0: 0.03, T1: 0.12, T2: 0.32, T3: 0.7 }[tier] * between(0.7, 1.3);
    const readLines = Math.round(total * Math.min(1, share));
    // review time falls as routing sharpens (weeks) and with the tier
    const minutes = ({ T0: 3, T1: 6, T2: 13, T3: 30 }[tier] * (2.3 - 1.5 * t) + between(-1, 2)) * between(0.9, 1.15);
    const findings = rnd() < 0.55 ? 1 + Math.floor(rnd() * 2.2) : 0;
    const who = pick(people);
    const at = (plus: number) => new Date(j.at.getTime() + plus * 60_000).toISOString();
    append({ type: 'review', pr, actor: 'countersign', summary: `Dossier for ${pr}: ${tier}`, data: { areas: [j.area], tier, findings, readLines, totalLines: total }, synthetic: true, at: at(0) });
    for (let f = 0; f < findings; f++) {
      const real = rnd() < 0.74 + 0.16 * t;
      append({ type: 'finding-feedback', pr, area: j.area, actor: who, summary: `${who} judged an AI finding ${real ? 'real' : 'not real'}`, data: { areas: [j.area], verdict: real ? 'accepted' : 'rejected' }, synthetic: true, at: at(20 + f) });
    }
    append({
      type: 'signoff',
      pr,
      actor: who,
      summary: `${who} countersigned ${pr} after ${Math.round(minutes)} min; read ${readLines}/${total} lines`,
      data: { areas: [j.area], decision: 'accepted', tier, reviewSeconds: Math.round(Math.max(1.5, minutes) * 60), readLines, totalLines: total, timeToMergeHours: Math.round((26 - 17 * t + between(-4, 6)) * 10) / 10 },
      synthetic: true,
      at: at(40),
    });
    const rate = policy.trust.spotCheckRate[level] ?? 0.2;
    const miss = misses.find((m) => m[0] === w && m[1] === j.area);
    if (miss || rnd() < rate * 0.9) {
      if (miss) misses.splice(misses.indexOf(miss), 1);
      append({ type: 'spot-check', pr, actor: pick(people.filter((p) => p !== who)), summary: miss ? `Full read of ${pr}: ${miss[2]}` : `Full read of ${pr}: agrees with the AI review`, data: { areas: [j.area], missed: !!miss, note: miss?.[2] ?? '' }, synthetic: true, at: at(60 * 26) });
    }
    const esc = escapes.find((e) => e[0] === w && e[1] === j.area);
    if (esc) {
      escapes.splice(escapes.indexOf(esc), 1);
      append({ type: 'escape', pr, actor: pick(people), summary: `${esc[2]} traced to ${pr}: ${esc[3]}`, data: { areas: [j.area], kind: esc[2], note: esc[3] }, synthetic: true, at: at(60 * 50) });
    }
  }
}

const v = view();
console.log(`seeded ${readEvents().length} events · chain ok: ${v.chainOk}`);
for (const a of v.areas) console.log(`  ${a.area.padEnd(20)} L${a.level} ${a.label.padEnd(11)} signoffs ${String(a.signoffs).padStart(3)} streak ${String(a.cleanStreak).padStart(3)} escapes ${a.escapes} misses ${a.spotCheckMisses}`);
console.log(v.weekly.map((w) => `${w.week} prs ${w.prs} med ${w.medianReviewMinutes}m ttm ${w.medianTimeToMergeHours}h esc ${w.escapes} T0-3 ${w.routedT0}/${w.routedT1}/${w.routedT2}/${w.routedT3}`).join('\n'));
console.log(v.totals);
