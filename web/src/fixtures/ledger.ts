/** Seeded trust-ledger history. Everything here is synthetic and tagged as such. */
import type { AreaTrust, LedgerEvent, LedgerEventType, LedgerView, WeeklyMetric } from '../../../shared/dossier';

export const LEVELS = [
  { label: 'Probation', effect: 'Every changed line is read by the owner. AI routing is advisory only.', nextAt: 5 },
  { label: 'Supervised', effect: 'T0 units may be skipped. Test units are skimmed. 1 in 5 PRs gets a full spot-check read.', nextAt: 8 },
  { label: 'Trusted', effect: 'T0 and T1 units may be skipped. 1 in 10 PRs is spot-checked.', nextAt: 20 },
  { label: 'Proven', effect: 'Only T2 and T3 units are read. 1 in 20 PRs is spot-checked.', nextAt: undefined },
] as const;

/** deterministic 64-hex pseudo-hash for fixture chains (the real server uses sha256) */
export function fakeHash(input: string): string {
  let out = '';
  let h = 0x811c9dc5;
  for (let r = 0; r < 8; r++) {
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i) + r * 131;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out += h.toString(16).padStart(8, '0');
  }
  return out;
}

const area = (a: string, paths: string[], criticality: AreaTrust['criticality'], level: number, n: Partial<AreaTrust>, history: AreaTrust['history']): AreaTrust => ({
  area: a,
  paths,
  criticality,
  level,
  label: LEVELS[level].label,
  effect: LEVELS[level].effect,
  signoffs: 0,
  escapes: 0,
  spotChecks: 0,
  spotCheckMisses: 0,
  findingsAccepted: 0,
  findingsRejected: 0,
  cleanStreak: 0,
  nextLevelAt: LEVELS[level].nextAt,
  history,
  ...n,
});

const areas: AreaTrust[] = [
  area('Source generator', ['src/MessagePack.SourceGenerator/**', 'src/MessagePack.Analyzers/**'], 'high', 1, { signoffs: 31, escapes: 1, spotChecks: 7, spotCheckMisses: 1, findingsAccepted: 22, findingsRejected: 6, cleanStreak: 4 }, [
    { at: '2026-08-24T08:00:00Z', level: 0, reason: 'Area registered. Every area starts on Probation.' },
    { at: '2026-09-11T14:10:00Z', level: 1, reason: '5 clean sign-offs.' },
    { at: '2026-10-06T09:30:00Z', level: 2, reason: '8 clean sign-offs, 3 spot-checks agreed.' },
    { at: '2026-10-22T16:45:00Z', level: 1, reason: 'Escape: #6 reverted, generated formatter dropped init-only members.' },
  ]),
  area('Runtime formatters', ['src/MessagePack/Formatters/**'], 'high', 2, { signoffs: 58, escapes: 0, spotChecks: 9, spotCheckMisses: 0, findingsAccepted: 31, findingsRejected: 5, cleanStreak: 17 }, [
    { at: '2026-08-24T08:00:00Z', level: 0, reason: 'Area registered.' },
    { at: '2026-09-04T10:00:00Z', level: 1, reason: '5 clean sign-offs.' },
    { at: '2026-09-25T13:20:00Z', level: 2, reason: '8 clean sign-offs, 4 spot-checks agreed.' },
  ]),
  area('Resolvers / AOT', ['src/MessagePack/Resolvers/**', 'src/MessagePack/Internal/**'], 'high', 0, { signoffs: 24, escapes: 2, spotChecks: 8, spotCheckMisses: 2, findingsAccepted: 14, findingsRejected: 7, cleanStreak: 1 }, [
    { at: '2026-08-24T08:00:00Z', level: 0, reason: 'Area registered.' },
    { at: '2026-09-15T11:00:00Z', level: 1, reason: '5 clean sign-offs.' },
    { at: '2026-09-23T15:30:00Z', level: 0, reason: 'Escape: incident, resolver cache returned a stale formatter under trimming.' },
    { at: '2026-10-14T09:00:00Z', level: 1, reason: '5 clean sign-offs.' },
    { at: '2026-11-04T10:20:00Z', level: 0, reason: 'Spot-check found a missed race in the lookup cache.' },
  ]),
  area('Build & packaging', ['**/*.csproj', 'Directory.*.props', 'azure-pipelines/**'], 'medium', 2, { signoffs: 37, escapes: 0, spotChecks: 5, spotCheckMisses: 0, findingsAccepted: 9, findingsRejected: 4, cleanStreak: 12 }, [
    { at: '2026-08-24T08:00:00Z', level: 0, reason: 'Area registered.' },
    { at: '2026-09-08T10:00:00Z', level: 1, reason: '5 clean sign-offs.' },
    { at: '2026-10-01T12:00:00Z', level: 2, reason: '8 clean sign-offs.' },
  ]),
  area('Docs', ['README.md', 'doc/**'], 'low', 3, { signoffs: 48, escapes: 0, spotChecks: 3, spotCheckMisses: 0, findingsAccepted: 6, findingsRejected: 2, cleanStreak: 48 }, [
    { at: '2026-08-24T08:00:00Z', level: 0, reason: 'Area registered.' },
    { at: '2026-08-31T10:00:00Z', level: 1, reason: '5 clean sign-offs.' },
    { at: '2026-09-14T10:00:00Z', level: 2, reason: '8 clean sign-offs.' },
    { at: '2026-10-19T10:00:00Z', level: 3, reason: '20 clean sign-offs, no escapes.' },
  ]),
];

const med = [31, 29, 27, 24, 22, 19, 17, 15, 13, 12, 10, 9];
const esc = [0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const prs = [11, 13, 14, 15, 17, 16, 19, 18, 21, 22, 23, 23];
const mix: [number, number, number, number][] = [
  [0, 1, 4, 6],
  [0, 2, 5, 6],
  [1, 3, 5, 5],
  [2, 4, 5, 4],
  [3, 5, 5, 4],
  [4, 5, 4, 3],
  [6, 6, 4, 3],
  [6, 6, 4, 2],
  [8, 7, 4, 2],
  [9, 7, 4, 2],
  [10, 8, 3, 2],
  [10, 8, 3, 2],
];
const weekly: WeeklyMetric[] = med.map((m, i) => {
  const d = new Date(Date.UTC(2026, 7, 24 + i * 7));
  const raised = Math.round(prs[i] * 1.4);
  return {
    week: d.toISOString().slice(0, 10),
    prs: prs[i],
    medianReviewMinutes: m,
    medianTimeToMergeHours: Math.round(26 - i * 1.6),
    escapes: esc[i],
    findingsRaised: raised,
    findingsAccepted: Math.round(raised * (0.62 + i * 0.017)),
    routedT0: mix[i][0],
    routedT1: mix[i][1],
    routedT2: mix[i][2],
    routedT3: mix[i][3],
    spotChecks: i % 3 === 0 ? 3 : 2,
    spotCheckMisses: i === 1 || i === 10 ? 1 : 0,
    synthetic: true,
  };
});

type Seed = [at: string, type: LedgerEventType, actor: string, summary: string, pr?: string, area?: string];
const R = 'te-industry-tech-office/junction26-messagepack-csharp#';
const seeds: Seed[] = [
  ['2026-10-19T10:00:00Z', 'trust-change', 'countersign', 'Docs promoted to Proven after 20 clean sign-offs', undefined, 'Docs'],
  ['2026-10-20T09:12:00Z', 'review', 'countersign', 'Dossier produced: T1, read 0 of 64 lines', R + '5', 'Runtime formatters'],
  ['2026-10-20T09:31:00Z', 'signoff', 'aarnio', 'Accepted in 3 min. 1 unit skimmed, 0 decisions', R + '5', 'Runtime formatters'],
  ['2026-10-21T13:02:00Z', 'review', 'countersign', 'Dossier produced: T2, read 41 of 180 lines', R + '6', 'Source generator'],
  ['2026-10-21T13:40:00Z', 'finding-feedback', 'mlindqvist', 'Finding marked real: init-only members skipped by the new emitter path', R + '6', 'Source generator'],
  ['2026-10-21T14:05:00Z', 'signoff', 'mlindqvist', 'Accepted in 9 min with 1 residual risk', R + '6', 'Source generator'],
  ['2026-10-22T16:40:00Z', 'escape', 'mlindqvist', 'Revert: generated formatter dropped init-only members in a downstream app', R + '6', 'Source generator'],
  ['2026-10-22T16:45:00Z', 'trust-change', 'countersign', 'Source generator demoted Trusted → Supervised after an escape', undefined, 'Source generator'],
  ['2026-10-27T10:20:00Z', 'spot-check', 'aarnio', 'Full read of a sampled T0 PR: nothing the AI missed', R + '7', 'Build & packaging'],
  ['2026-10-28T11:15:00Z', 'review', 'countersign', 'Dossier produced: T0, read 0 of 212 lines', R + '8', 'Docs'],
  ['2026-10-28T11:16:00Z', 'signoff', 'aarnio', 'Accepted in 1 min. Covered by proof', R + '8', 'Docs'],
  ['2026-11-02T15:30:00Z', 'finding-feedback', 'aarnio', 'Finding marked not real: claimed allocation in hot path, benchmark flat', R + '8', 'Runtime formatters'],
  ['2026-11-04T10:05:00Z', 'spot-check', 'mlindqvist', 'Full read found a race in the lookup cache the AI missed', R + '9', 'Resolvers / AOT'],
  ['2026-11-04T10:20:00Z', 'trust-change', 'countersign', 'Resolvers / AOT demoted Supervised → Probation after a missed spot-check', undefined, 'Resolvers / AOT'],
  ['2026-11-06T09:40:00Z', 'review', 'countersign', 'Dossier produced: T1, read 0 of 38 lines', R + '10', 'Runtime formatters'],
  ['2026-11-06T09:52:00Z', 'signoff', 'aarnio', 'Accepted in 2 min', R + '10', 'Runtime formatters'],
  ['2026-11-11T09:15:00Z', 'review', 'countersign', 'Dossier produced: T3, full read required', R + '9', 'Resolvers / AOT'],
  ['2026-11-11T09:58:00Z', 'finding-feedback', 'mlindqvist', 'Finding marked real: static cache keyed by open generic type', R + '9', 'Resolvers / AOT'],
  ['2026-11-11T10:02:00Z', 'signoff', 'mlindqvist', 'Rejected after 11 min: cache is not trim-safe', R + '9', 'Resolvers / AOT'],
  ['2026-11-12T11:40:00Z', 'review', 'countersign', 'Dossier produced: T1, read 0 of 38 lines', R + '11', 'Runtime formatters'],
  ['2026-11-12T11:44:00Z', 'signoff', 'aarnio', 'Accepted in 2 min. 1 unit skimmed', R + '11', 'Runtime formatters'],
  ['2026-11-13T15:05:00Z', 'review', 'countersign', 'Dossier produced: T0, read 0 of 412 lines, sampled for spot-check', R + '15', 'Runtime formatters'],
  ['2026-11-13T16:20:00Z', 'review', 'countersign', 'Dossier produced: T3, full read required (area on Probation)', R + '17', 'Resolvers / AOT'],
  ['2026-11-13T17:42:00Z', 'review', 'countersign', 'Dossier produced: T2, read 28 of 228 lines, 2 decisions for the owner', R + '14', 'Source generator'],
];

let prev = '0'.repeat(64);
const events: LedgerEvent[] = seeds.map(([at, type, actor, summary, pr, a], i) => {
  const hash = fakeHash(prev + at + type + summary);
  const e: LedgerEvent = { id: `L${i + 1}`, at, type, pr, area: a, actor, summary, synthetic: i < seeds.length - 3, prevHash: prev, hash };
  prev = hash;
  return e;
});

export const ledgerFixture: LedgerView = {
  areas,
  events,
  weekly,
  totals: {
    prs: prs.reduce((a, b) => a + b, 0),
    signed: 198,
    escapes: esc.reduce((a, b) => a + b, 0),
    escapeRate: 3 / 198,
    findingPrecision: 82 / (82 + 24),
    humanReadShare: 0.19,
    medianReviewMinutes: 9,
    spotCheckAgreement: 29 / 32,
  },
  real: { reviews: 0, totalLines: 0, readLines: 0, readShare: 0, findingsShown: 0, findingsJudged: 0, findingsAccepted: 0, escapes: 0, spotChecks: 0, spotCheckMisses: 0, signoffs: [] },
  cleanAfterDays: 14,
  chainOk: true,
};
