/**
 * The sign-off gate: what a named person must have done before an "accept" is taken.
 * One definition, used by the server (which enforces it) and the UI (which shows it), so they cannot drift.
 */
import type { ChangeUnit, Dossier, Finding, Refusal } from './dossier';

/** Why the reading plan is void and every unit must be read; undefined when the plan stands. */
export function fullReadReason(d: Dossier): string | undefined {
  // These hold whatever the verdict is: a change the AI already wants sent back still gets no skipped line
  // when there is no requirement, when the reviewer missed the bugs planted in it, or when nothing ran.
  if (d.requirement.id === 'NONE') return 'No requirement is linked, so nothing here could be traced to an intent. No line is skipped.';
  const st = d.selfTest;
  if (st && st.planted >= 2 && st.caught / st.planted < 0.5) return `The reviewer caught ${st.caught} of ${st.planted} bugs planted in this change. Its proofs are not trusted here, so no line is skipped.`;
  const ran = d.evidence.some((e) => e.strength === 'executed');
  if (d.recommendation.verdict === 'full-read-required' || (d.status !== 'running' && d.status !== 'failed' && !ran)) return 'Nothing could be executed for this change, so no skip was earned. Every line is yours.';
  const prob = d.live?.probation ?? [];
  if (prob.length) return `${prob.join(' and ')} ${prob.length > 1 ? 'are' : 'is'} on probation after an escape. Every line is read, and a second person co-signs.`;
  if (d.routing.spotCheck.selected) return 'This change was drawn for a spot check of the reviewer. Read all of it, then say whether you found anything the AI missed.';
  return undefined;
}

/**
 * Units the signer must mark before signing: every unit routed to "read", and every unit routed to "skim".
 * A skim is a shorter look, not an optional one: the server takes the mark only after the unit was on screen.
 * Only units a run or a deterministic check stands in for ("none") need no mark.
 */
export const mustRead = (d: Dossier): ChangeUnit[] => (fullReadReason(d) ? d.units : d.units.filter((u) => u.ask !== 'none'));
/** A skim, where the reading plan stands. When the plan is void every unit is a full read. */
export const isSkim = (d: Dossier, u: ChangeUnit) => u.ask === 'skim' && !fullReadReason(d);

/**
 * Confirmed problems an accept would be given over: a major or blocker finding the signer judged real, or a
 * decision answered with an option this commit does not implement. The default then is to request changes;
 * accepting takes a written reason, which goes into the attestation word for word.
 */
export function overrides(d: Dossier): string[] {
  const out: string[] = [];
  for (const f of d.findings) if (f.feedback?.verdict === 'accepted' && (f.severity === 'blocker' || f.severity === 'major')) out.push(`${f.id} is a ${f.severity} finding you judged real, and this commit does not fix it: ${f.title}`);
  for (const r of d.refusals) {
    const o = r.options.find((x) => x.id === r.answer?.optionId);
    if (o && o.implemented === false) out.push(`${r.id}: you chose “${o.label}”, which this commit does not do`);
  }
  return out;
}
export const OVERRIDE_MIN = 20;

export interface GateInput {
  readUnitIds: Iterable<string>;
  /** the signer's written reason for accepting over confirmed problems */
  override?: string;
  /** required when the change was drawn for a spot check */
  spotCheck?: { missed: boolean; note?: string };
}

export interface GateState {
  unread: ChangeUnit[];
  undecided: Refusal[];
  unjudged: Finding[];
  /** the change was sampled and the signer has not yet said what the full read found */
  spotCheckOpen: boolean;
  /** confirmed problems this accept would be given over (see `overrides`) */
  overrides: string[];
  /** human-readable reasons an accept is refused; empty = the gate is open */
  reasons: string[];
}

const n = (k: number, one: string, many = one + 's') => `${k} ${k === 1 ? one : many}`;

export function gate(d: Dossier, input: GateInput): GateState {
  const read = new Set(input.readUnitIds);
  const unread = mustRead(d).filter((u) => !read.has(u.id));
  const undecided = d.refusals.filter((r) => r.blocking && !r.answer);
  const unjudged = d.findings.filter((f) => !f.feedback);
  const spotCheckOpen = d.routing.spotCheck.selected && (!input.spotCheck || typeof input.spotCheck.missed !== 'boolean' || (input.spotCheck.missed && !input.spotCheck.note?.trim()));
  const reasons: string[] = [];
  if (unjudged.length) reasons.push(`${n(unjudged.length, 'finding')} not judged real or not real: ${unjudged.map((f) => f.id).join(', ')}`);
  if (undecided.length) reasons.push(`${n(undecided.length, 'blocking decision')} unanswered: ${undecided.map((r) => r.id).join(', ')}`);
  if (unread.length) reasons.push(`${n(unread.length, 'unit')} not marked read or skimmed: ${unread.map((u) => u.id).join(', ')}`);
  if (spotCheckOpen) reasons.push('this change was drawn for a spot check: say whether your full read found anything the AI missed (with a note if it did)');
  const ov = overrides(d);
  if (ov.length && (input.override?.trim().length ?? 0) < OVERRIDE_MIN) reasons.push(`${n(ov.length, 'confirmed problem')} open: request changes, or write why you accept this commit anyway (at least ${OVERRIDE_MIN} characters)`);
  return { unread, undecided, unjudged, spotCheckOpen, overrides: ov, reasons };
}

/** Minutes the plan asks of the signer. When the plan is void, the skimmed and skipped lines are read at full reading speed too. */
export const planMinutes = (d: Dossier): number =>
  fullReadReason(d) ? Math.round(d.routing.estMinutes + d.routing.skimLines * (1 / 6 - 1 / 40) + d.routing.skipLines / 6) : d.routing.estMinutes;
