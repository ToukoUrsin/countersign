/**
 * A review is a brief, then a short path of things only the signer can do, then the evidence behind
 * them. This derives the chapters from a dossier.
 */
import type { Dossier } from '../../../shared/dossier';
import { fullReadReason } from '../../../shared/gate';

export type ChapterKind = 'brief' | 'change' | 'how' | 'asked' | 'proof' | 'reviewer' | 'finding' | 'refusal' | 'unit' | 'skipped' | 'limits' | 'sign';
/** brief: the one-screen summary. you: what the signer has to do. evidence: what backs it, one click away, never required. */
export type ChapterSection = 'brief' | 'you' | 'evidence';
export type ChapterGroup = 'Brief' | 'Decisions' | 'Findings' | 'Read' | 'Sign off' | 'Evidence';
export type ChapterState = 'todo' | 'seen' | 'needs' | 'done';

export interface Chapter {
  /** stable key, used in the URL */
  id: string;
  kind: ChapterKind;
  section: ChapterSection;
  group: ChapterGroup;
  label: string;
  /** id of the finding, decision or unit this chapter is about */
  ref?: string;
  /** must be done before the sign-off is accepted */
  required: boolean;
}

export function chapters(d: Dossier): Chapter[] {
  const you = (c: Omit<Chapter, 'section'>): Chapter => ({ ...c, section: 'you' });
  const ev = (id: ChapterKind, label: string): Chapter => ({ id, kind: id, section: 'evidence', group: 'Evidence', label, required: false });
  const out: Chapter[] = [{ id: 'brief', kind: 'brief', section: 'brief', group: 'Brief', label: 'Brief', required: false }];

  // what needs the signer: decisions first (no proof removes them), then findings, then the reading
  for (const r of [...d.refusals].sort((a, b) => Number(b.blocking) - Number(a.blocking))) out.push(you({ id: r.id, kind: 'refusal', group: 'Decisions', label: r.question, ref: r.id, required: r.blocking }));
  const sev = { blocker: 0, major: 1, minor: 2, note: 3 } as const;
  for (const f of [...d.findings].sort((a, b) => sev[a.severity] - sev[b.severity])) out.push(you({ id: f.id, kind: 'finding', group: 'Findings', label: f.title, ref: f.id, required: true }));

  const rank = { read: 0, skim: 1, none: 2 } as const;
  const units = [...d.units].sort((a, b) => rank[a.ask] - rank[b.ask] || a.storyOrder - b.storyOrder);
  // when the reading plan is void (spot check, or the review could not earn a skip) every unit is a chapter the signer must read
  const full = !!fullReadReason(d);
  for (const u of units.filter((x) => full || x.ask !== 'none')) out.push(you({ id: u.id, kind: 'unit', group: 'Read', label: u.title, ref: u.id, required: full || u.ask !== 'none' }));
  out.push(you({ id: 'sign', kind: 'sign', group: 'Sign off', label: d.signoff ? (d.signoff.decision === 'accepted' ? 'Countersigned' : 'Changes requested') : 'Countersign', required: false }));

  // the evidence: never required, always one click away
  out.push(ev('change', 'The change'), ev('how', 'How it works'), ev('asked', 'What was asked'), ev('proof', 'What was run'));
  if (d.selfTest || d.discarded.length || d.audit) out.push(ev('reviewer', 'Is the reviewer any good'));
  if (!full && units.some((u) => u.ask === 'none')) out.push(ev('skipped', 'Skipped with proof'));
  out.push(ev('limits', 'What nobody checked'));
  return out;
}

export function chapterState(ch: Chapter, d: Dossier, readIds: Set<string>, seen: Set<string>): ChapterState {
  if (ch.kind === 'finding') return d.findings.find((f) => f.id === ch.ref)?.feedback ? 'done' : 'needs';
  if (ch.kind === 'refusal') {
    const r = d.refusals.find((x) => x.id === ch.ref);
    return r?.answer ? 'done' : r?.blocking ? 'needs' : seen.has(ch.id) ? 'seen' : 'todo';
  }
  if (ch.kind === 'unit') return readIds.has(ch.ref!) ? 'done' : ch.required ? 'needs' : seen.has(ch.id) ? 'seen' : 'todo';
  if (ch.kind === 'sign') return d.signoff ? 'done' : 'todo';
  return seen.has(ch.id) ? 'seen' : 'todo';
}

/** The groups inside "needs you", in the order they are walked. */
export const GROUPS: ChapterGroup[] = ['Decisions', 'Findings', 'Read', 'Sign off'];

/** Where a chapter sits among the chapters of its own section: "3 of 9". */
export function place(list: Chapter[], ch: Chapter): { i: number; n: number } {
  const own = list.filter((c) => c.section === ch.section);
  return { i: own.indexOf(ch) + 1, n: own.length };
}
