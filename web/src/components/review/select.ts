/** What is selected inside a chapter when the reviewer has not picked anything yet. */
import type { Dossier, Evidence } from '../../../../shared/dossier';
import type { Chapter } from '../../lib/chapters';

export interface ProofGroup {
  id: 'red-green' | 'regression' | 'ablation' | 'probe' | 'mechanical' | 'radius';
  label: string;
  items: Evidence[];
}

/** Evidence that is a run or a deterministic check about the change itself, in reading order. */
export function proofGroups(d: Dossier): ProofGroup[] {
  const of = (f: (e: Evidence) => boolean) => d.evidence.filter(f);
  const groups: ProofGroup[] = [
    { id: 'red-green', label: 'The tests this PR adds', items: of((e) => e.kind === 'red-green') },
    { id: 'regression', label: 'The tests that already existed', items: of((e) => e.kind === 'regression' || e.kind === 'build') },
    { id: 'ablation', label: 'Does a test notice each changed hunk', items: of((e) => e.kind === 'ablation') },
    { id: 'probe', label: 'Independent tests, written from the requirement', items: of((e) => e.kind === 'repro' && e.polarity !== 'undermines') },
    { id: 'mechanical', label: 'Repetitive edits, checked by rule', items: of((e) => e.kind === 'mechanical') },
    { id: 'radius', label: 'How far the change reaches', items: of((e) => e.kind === 'reference-scan') },
  ];
  return groups.filter((g) => g.items.length);
}

export function selected(ch: Chapter, d: Dossier, sel: Record<string, string | undefined>): string | undefined {
  const s = sel[ch.id];
  if (s) return s;
  if (ch.kind === 'asked') return d.requirement.criteria[0]?.id;
  if (ch.kind === 'proof') return proofGroups(d)[0]?.items[0]?.id;
  if (ch.kind === 'reviewer') return d.selfTest?.canaries[0]?.id ?? d.discarded[0]?.id;
  if (ch.kind === 'skipped') return d.units.find((u) => u.ask === 'none')?.id;
  return undefined;
}
