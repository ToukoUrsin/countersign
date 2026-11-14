/** Derives the live checklist and the attestation preview from a dossier and local review state. */
import { mustRead } from '../../../shared/gate';
import type { ChangeUnit, CodeRef, Dossier, Evidence } from '../../../shared/dossier';

export interface Composed {
  required: ChangeUnit[];
  requiredRead: number;
  decisionsAnswered: number;
  decisionsTotal: number;
  blockingOpen: number;
  findingsJudged: number;
  findingsTotal: number;
  checkedByAI: Evidence[];
  checkedByHuman: string[];
  notChecked: string[];
  residualRisk: string[];
  /** why Countersign is disabled; empty = ready */
  blockers: string[];
}

export const unitOrder = (d: Dossier) => {
  const rank = { read: 0, skim: 1, none: 2 } as const;
  return [...d.units].sort((a, b) => rank[a.ask] - rank[b.ask] || a.storyOrder - b.storyOrder);
};

export function compose(d: Dossier, readIds: Set<string>, extraRisk: string[]): Composed {
  const required = mustRead(d);
  const requiredRead = required.filter((u) => readIds.has(u.id)).length;
  const answered = d.refusals.filter((r) => r.answer);
  const blockingOpen = d.refusals.filter((r) => r.blocking && !r.answer).length;
  const judged = d.findings.filter((f) => f.feedback);

  const checkedByAI = d.evidence.filter((e) => e.polarity === 'supports' && (e.strength === 'executed' || e.strength === 'verified-static'));

  const checkedByHuman = [
    ...d.units.filter((u) => readIds.has(u.id)).map((u) => `Read ${u.id}: ${u.title}`),
    ...answered.map((r) => `Decided ${r.id}: ${r.options.find((o) => o.id === r.answer!.optionId)?.label ?? r.answer!.optionId}`),
    ...judged.map((f) => `Judged ${f.id} ${f.feedback!.verdict === 'accepted' ? 'real' : 'not real'}: ${f.title}`),
  ];

  const notChecked = [
    ...d.notChecked.map((n) => n.what),
    ...d.units.filter((u) => u.ask === 'skim' && !readIds.has(u.id)).map((u) => `${u.id} not skimmed by a human: ${u.title}`),
  ];

  const realFindings = d.findings.filter((f) => f.feedback?.verdict === 'accepted');
  const coveredEvidence = new Set(d.findings.flatMap((f) => f.evidenceIds));
  const survivors = d.evidence.filter((e) => e.kind === 'ablation' && e.ablation && !e.ablation.killed);
  const residualRisk = [
    ...realFindings.map((f) => `${f.id} (${f.severity}), accepted as real and not fixed: ${f.title}`),
    // ablation survivors are one risk, not one line each (same wording as the server's attestation)
    ...(survivors.length ? [`${survivors.length} source hunk${survivors.length > 1 ? 's' : ''} can be reverted without any test failing (${survivors.map((e) => e.id).join(', ')}): no test notices this code`] : []),
    ...d.evidence.filter((e) => e.polarity === 'undermines' && !coveredEvidence.has(e.id) && !survivors.includes(e)).map((e) => `${e.id}: ${e.conclusion}`),
    ...d.requirement.criteria.filter((c) => c.status === 'unproven' || c.status === 'violated').map((c) => `${c.id} ${c.status}: ${c.text}`),
    ...extraRisk,
  ];

  const blockers: string[] = [];
  if (requiredRead < required.length) blockers.push(`Read ${required.length - requiredRead} more required unit${required.length - requiredRead > 1 ? 's' : ''}`);
  if (blockingOpen) blockers.push(`Answer ${blockingOpen} blocking decision${blockingOpen > 1 ? 's' : ''}`);
  if (judged.length < d.findings.length) blockers.push(`Judge ${d.findings.length - judged.length} finding${d.findings.length - judged.length > 1 ? 's' : ''}`);

  return {
    required,
    requiredRead,
    decisionsAnswered: answered.length,
    decisionsTotal: d.refusals.length,
    blockingOpen,
    findingsJudged: judged.length,
    findingsTotal: d.findings.length,
    checkedByAI,
    checkedByHuman,
    notChecked,
    residualRisk,
    blockers,
  };
}

/** Which unit contains a code reference (by file path and head line). */
export function unitForRef(d: Dossier, r: CodeRef): string | undefined {
  const f = d.files.find((x) => x.path === r.path);
  if (!f) return undefined;
  for (const h of f.hunks) {
    if (h.lines.some((l) => (r.side === 'base' ? l.o : l.n) !== undefined && (r.side === 'base' ? l.o! : l.n!) >= r.startLine && (r.side === 'base' ? l.o! : l.n!) <= r.endLine)) return h.unitId;
  }
  return undefined;
}

export const SECTIONS = [
  { id: 'story', label: 'Story' },
  { id: 'requirement', label: 'Requirement trace' },
  { id: 'decisions', label: 'Decisions for you' },
  { id: 'findings', label: 'Findings' },
  { id: 'reading', label: 'Reading plan' },
  { id: 'selftest', label: 'Reviewer self-test' },
  { id: 'notchecked', label: 'Not checked' },
  { id: 'pipeline', label: 'Pipeline trace' },
] as const;
export type SectionId = (typeof SECTIONS)[number]['id'];
