import { existsSync, readFileSync, copyFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Dossier, ReviewRound } from '../../shared/dossier';
import type { Ctx } from './ctx';

/** Archive the previous head before the pipeline writes dossier.json for a new head. */
export function archivePrevious(ctx: Ctx): Dossier | undefined {
  const file = resolve(ctx.dir, 'dossier.json');
  const fromArchive = () => {
    const names = readdirSync(ctx.dir).filter((n) => /^dossier\.[0-9a-f]{7}\.json$/.test(n)).sort();
    const last = names.at(-1);
    if (!last) return undefined;
    try { return JSON.parse(readFileSync(resolve(ctx.dir, last), 'utf8')) as Dossier; } catch { return undefined; }
  };
  if (!existsSync(file)) return fromArchive();
  try {
    const previous = JSON.parse(readFileSync(file, 'utf8')) as Dossier;
    if (!previous.pr?.headSha || previous.pr.headSha === 'Loading…') return fromArchive();
    const archive = resolve(ctx.dir, `dossier.${previous.pr.headSha.slice(0, 7)}.json`);
    if (!existsSync(archive)) copyFileSync(file, archive);
    return previous;
  } catch {
    return fromArchive();
  }
}

export function compactRound(d: Dossier): ReviewRound {
  return {
    headSha: d.pr.headSha,
    at: d.generatedAt,
    verdict: d.recommendation.verdict,
    findings: d.findings.map((f) => {
      const e = d.evidence.find((x) => f.evidenceIds.includes(x.id) && x.kind === 'repro');
      return { id: f.id, title: f.title, severity: f.severity, strength: f.strength, reproTest: e ? { evidenceId: e.id, command: e.command, source: e.probeSource?.code } : undefined };
    }),
    signoff: d.signoff ? { signer: d.signoff.signer, decision: d.signoff.decision, at: d.signoff.at } : undefined,
  };
}

export function carriedRounds(previous?: Dossier): ReviewRound[] {
  if (!previous) return [];
  const existing = previous.rounds ?? [];
  return existing.at(-1)?.headSha === previous.pr.headSha ? [...existing] : [...existing, compactRound(previous)];
}
