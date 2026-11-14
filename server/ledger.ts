import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AreaTrust, Backtest, LedgerEvent, LedgerEventType, LedgerView, RealLedger, RealSignoff, WeeklyMetric } from '../shared/dossier';
import { type Policy, defaultPolicy } from '../pipeline/lib/policy';
import { DATA, ROOT } from '../pipeline/lib/util';

/**
 * The trust ledger: an append-only, hash-chained log of what was reviewed, who signed, what the
 * AI got right or wrong, and what escaped. Trust levels are never stored — they are recomputed
 * from the log, so anyone can audit why an area is trusted.
 */
const FILE = resolve(DATA, 'ledger.jsonl');
const GENESIS = '0'.repeat(64);

const canonical = (e: Omit<LedgerEvent, 'hash'>) => JSON.stringify([e.id, e.at, e.type, e.pr ?? '', e.area ?? '', e.actor, e.summary, e.data ?? {}, !!e.synthetic, e.prevHash]);
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function readEvents(): LedgerEvent[] {
  if (!existsSync(FILE)) return [];
  return readFileSync(FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

export function verifyChain(events: LedgerEvent[]) {
  let prev = GENESIS;
  for (const e of events) {
    const { hash, ...rest } = e;
    if (e.prevHash !== prev || sha256(canonical(rest)) !== hash) return false;
    prev = hash;
  }
  return true;
}

export function lastHash() {
  const ev = readEvents();
  return ev.length ? ev[ev.length - 1].hash : GENESIS;
}

export interface NewEvent {
  type: LedgerEventType;
  pr?: string;
  area?: string;
  actor: string;
  summary: string;
  data?: Record<string, unknown>;
  synthetic?: boolean;
  at?: string;
}

export function ledgerPolicy(): Policy {
  // areas shown in the ledger come from the policy registered for the demo repo
  const def = defaultPolicy();
  const file = process.env.CS_POLICY_FILE || resolve(ROOT, 'policy/messagepack.countersign.yml');
  if (!existsSync(file)) return def;
  const over = (Bun as any).YAML.parse(readFileSync(file, 'utf8'));
  return { ...def, ...over, source: '.countersign.yml on the base branch', sandbox: { ...def.sandbox, ...(over.sandbox ?? {}) }, requirement: { ...def.requirement, ...(over.requirement ?? {}) } } as Policy;
}

/** Append an event; if it moves an area's trust level, a trust-change event is appended too. */
export function append(ev: NewEvent): LedgerEvent {
  const policy = ledgerPolicy();
  const before = computeAreas(readEvents(), policy);
  const e = write(ev);
  const after = computeAreas(readEvents(), policy);
  for (const a of after) {
    const b = before.find((x) => x.area === a.area);
    if (b && b.level !== a.level) {
      write({
        type: 'trust-change',
        area: a.area,
        pr: ev.pr,
        actor: 'countersign',
        summary: `${a.area}: ${b.label} → ${a.label} (${a.history[a.history.length - 1]?.reason ?? ''})`,
        data: { from: b.level, to: a.level },
        synthetic: ev.synthetic,
        at: ev.at,
      });
    }
  }
  return e;
}

function write(ev: NewEvent): LedgerEvent {
  const events = readEvents();
  const prevHash = events.length ? events[events.length - 1].hash : GENESIS;
  const rest: Omit<LedgerEvent, 'hash'> = { id: `L${events.length + 1}`, at: ev.at ?? new Date().toISOString(), type: ev.type, pr: ev.pr, area: ev.area, actor: ev.actor, summary: ev.summary, data: ev.data, synthetic: ev.synthetic, prevHash };
  const e: LedgerEvent = { ...rest, hash: sha256(canonical(rest)) };
  appendFileSync(FILE, JSON.stringify(e) + '\n');
  return e;
}

export const cleanAfterDays = (policy: Policy) => policy.trust.cleanAfterDays ?? 14;

export function computeAreas(events: LedgerEvent[], policy: Policy): AreaTrust[] {
  const T = policy.trust;
  const areas = new Map<string, AreaTrust>();
  const get = (name: string) => {
    if (!areas.has(name)) {
      const def = policy.areas.find((a) => a.name === name);
      areas.set(name, { area: name, paths: def?.paths ?? [], criticality: def?.criticality ?? 'medium', level: policy.defaultTrustLevel, label: '', effect: '', signoffs: 0, escapes: 0, spotChecks: 0, spotCheckMisses: 0, findingsAccepted: 0, findingsRejected: 0, cleanStreak: 0, history: [] });
    }
    return areas.get(name)!;
  };
  for (const a of policy.areas) get(a.name);
  const now = Date.now();
  const WAIT = cleanAfterDays(policy) * 86400_000;
  const escaped = new Set(events.filter((e) => e.type === 'escape' && !e.synthetic).map((e) => e.pr ?? ''));
  const set = (a: AreaTrust, level: number, at: string, reason: string) => {
    level = Math.max(0, Math.min(T.labels.length - 1, level));
    if (level === a.level) return;
    a.level = level;
    a.history.push({ at, level, reason });
  };
  for (const e of events) {
    const names = ((e.data?.areas as string[] | undefined) ?? (e.area ? [e.area] : [])).filter(Boolean);
    for (const n of names) {
      const a = get(n);
      if (e.type === 'signoff' && e.data?.decision === 'accepted') {
        a.signoffs++;
        // A signature is not an outcome. It counts as clean only once the waiting period has passed with no
        // revert, and never when it was faster than the floor for its reading plan. (Seeded history is
        // generated as already-settled outcomes.)
        if (e.data?.rushed) {
          a.rushed = (a.rushed ?? 0) + 1;
          continue;
        }
        if (!e.synthetic && (escaped.has(e.pr ?? '') || now - new Date(e.at).getTime() < WAIT)) {
          if (!escaped.has(e.pr ?? '')) a.provisional = (a.provisional ?? 0) + 1;
          continue;
        }
        a.cleanStreak++;
        const need = T.promoteAtCleanStreak[a.level];
        if (need !== undefined && a.cleanStreak >= need) set(a, a.level + 1, e.at, `${a.cleanStreak} clean signed changes in a row`);
      } else if (e.type === 'escape') {
        a.escapes++;
        if (T.onEscape.resetStreak) a.cleanStreak = 0;
        set(a, a.level - T.onEscape.demoteBy, e.at, `escape: ${e.summary}`);
      } else if (e.type === 'spot-check') {
        a.spotChecks++;
        if (e.data?.missed) {
          a.spotCheckMisses++;
          if (T.onSpotCheckMiss.resetStreak) a.cleanStreak = 0;
          set(a, a.level - T.onSpotCheckMiss.demoteBy, e.at, `spot-check found something the AI missed`);
        }
      } else if (e.type === 'finding-feedback') {
        if (e.data?.verdict === 'accepted') a.findingsAccepted++;
        else if (e.data?.verdict === 'rejected') a.findingsRejected++;
      }
    }
  }
  for (const a of areas.values()) {
    a.label = T.labels[a.level];
    a.effect = T.effects[a.level];
    a.nextLevelAt = T.promoteAtCleanStreak[a.level];
  }
  return [...areas.values()];
}

export function trustLevels(): Map<string, AreaTrust> {
  return new Map(computeAreas(readEvents(), ledgerPolicy()).map((a) => [a.area, a]));
}

const weekOf = (iso: string) => {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
};
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** What really happened on this server. Kept apart from the seeded history: the two are never blended into one number. */
function realLedger(events: LedgerEvent[], policy: Policy): RealLedger {
  const real = events.filter((e) => !e.synthetic);
  const num = (e: LedgerEvent, k: string) => Number(e.data?.[k] ?? 0);
  // a change reviewed again (new commit, re-run) counts once, by its latest dossier
  const reviews = new Map<string, LedgerEvent>();
  for (const e of real) if (e.type === 'review' && e.pr) reviews.set(e.pr, e);
  const rv = [...reviews.values()];
  const totalLines = rv.reduce((a, e) => a + num(e, 'totalLines'), 0);
  const readLines = rv.reduce((a, e) => a + num(e, 'readLines'), 0);
  const fb = new Map<string, LedgerEvent>();
  for (const e of real) if (e.type === 'finding-feedback') fb.set(`${e.pr}:${e.data?.findingId}`, e);
  const escaped = new Set(real.filter((e) => e.type === 'escape').map((e) => e.pr ?? ''));
  const wait = cleanAfterDays(policy) * 86400_000;
  const sc = real.filter((e) => e.type === 'spot-check');
  return {
    reviews: rv.length,
    totalLines,
    readLines,
    readShare: totalLines ? readLines / totalLines : 0,
    findingsShown: rv.reduce((a, e) => a + num(e, 'findings'), 0),
    findingsJudged: fb.size,
    findingsAccepted: [...fb.values()].filter((e) => e.data?.verdict === 'accepted').length,
    escapes: escaped.size,
    spotChecks: sc.length,
    spotCheckMisses: sc.filter((e) => e.data?.missed).length,
    signoffs: real
      .filter((e) => e.type === 'signoff' && (e.data?.decision === 'accepted' || e.data?.decision === 'rejected'))
      .map((e) => {
        const t = new Date(e.at).getTime();
        const accepted = e.data?.decision === 'accepted';
        const state = !accepted ? 'rejected' : escaped.has(e.pr ?? '') ? 'escaped' : e.data?.rushed ? 'rushed' : Date.now() - t >= wait ? 'clean' : 'provisional';
        return {
          pr: e.pr ?? '',
          signer: e.actor,
          cosigner: e.data?.cosigner as string | undefined,
          at: e.at,
          decision: accepted ? ('accepted' as const) : ('rejected' as const),
          minutes: Math.round((num(e, 'reviewSeconds') / 60) * 10) / 10,
          readLines: num(e, 'readLines'),
          totalLines: num(e, 'totalLines'),
          state: state as RealSignoff['state'],
          countsFrom: state === 'provisional' ? new Date(t + wait).toISOString() : undefined,
        };
      }),
  };
}

function backtest(): Backtest | undefined {
  const f = resolve(DATA, 'backtest/summary.json');
  if (!existsSync(f)) return undefined;
  try {
    const b = JSON.parse(readFileSync(f, 'utf8')) as Backtest;
    return b.completed > 0 ? b : undefined;
  } catch {
    return undefined;
  }
}

export function view(): LedgerView {
  const all = readEvents();
  const policy = ledgerPolicy();
  const areas = computeAreas(all, policy);
  // every chart and headline below is the seeded history alone; real events are reported in `real`
  const events = all.filter((e) => e.synthetic);
  const weeks = new Map<string, { ev: LedgerEvent[] }>();
  for (const e of events) {
    const w = weekOf(e.at);
    if (!weeks.has(w)) weeks.set(w, { ev: [] });
    weeks.get(w)!.ev.push(e);
  }
  const num = (e: LedgerEvent, k: string) => Number(e.data?.[k] ?? 0);
  const weekly: WeeklyMetric[] = [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, { ev }]) => {
    const so = ev.filter((e) => e.type === 'signoff');
    const fb = ev.filter((e) => e.type === 'finding-feedback');
    const sc = ev.filter((e) => e.type === 'spot-check');
    const tier = (t: string) => so.filter((e) => e.data?.tier === t).length;
    return {
      week,
      prs: so.length,
      medianReviewMinutes: Math.round(median(so.map((e) => num(e, 'reviewSeconds') / 60)) * 10) / 10,
      medianTimeToMergeHours: Math.round(median(so.map((e) => num(e, 'timeToMergeHours')).filter((x) => x > 0)) * 10) / 10,
      escapes: ev.filter((e) => e.type === 'escape').length,
      findingsRaised: ev.filter((e) => e.type === 'review').reduce((a, e) => a + num(e, 'findings'), 0),
      findingsAccepted: fb.filter((e) => e.data?.verdict === 'accepted').length,
      routedT0: tier('T0'),
      routedT1: tier('T1'),
      routedT2: tier('T2'),
      routedT3: tier('T3'),
      spotChecks: sc.length,
      spotCheckMisses: sc.filter((e) => e.data?.missed).length,
      synthetic: true,
    };
  });
  const so = events.filter((e) => e.type === 'signoff');
  const fb = events.filter((e) => e.type === 'finding-feedback');
  const acc = fb.filter((e) => e.data?.verdict === 'accepted').length;
  const sc = events.filter((e) => e.type === 'spot-check');
  const escapes = events.filter((e) => e.type === 'escape').length;
  const read = so.reduce((a, e) => a + num(e, 'readLines'), 0);
  const total = so.reduce((a, e) => a + num(e, 'totalLines'), 0);
  const recent = so.slice(-30);
  return {
    areas,
    events: [...all].reverse().slice(0, 400),
    weekly,
    totals: {
      prs: events.filter((e) => e.type === 'review').length,
      signed: so.length,
      escapes,
      escapeRate: so.length ? escapes / so.length : 0,
      findingPrecision: fb.length ? acc / fb.length : 0,
      humanReadShare: total ? read / total : 0,
      medianReviewMinutes: Math.round(median(recent.map((e) => num(e, 'reviewSeconds') / 60)) * 10) / 10,
      spotCheckAgreement: sc.length ? 1 - sc.filter((e) => e.data?.missed).length / sc.length : 1,
    },
    real: realLedger(all, policy),
    backtest: backtest(),
    cleanAfterDays: cleanAfterDays(policy),
    chainOk: verifyChain(all),
  };
}
