/**
 * API client. Talks to the Countersign server on the same origin; falls back to an
 * in-memory mock (fixtures) when VITE_MOCK=1 or when /api is unreachable.
 */
import type { Attestation, Dossier, DossierSummary, GitHubNow, LedgerEvent, LedgerEventType, LedgerView, RunResult } from '../../shared/dossier';
import { mpDossier } from './fixtures/dossier-mp';
import { fakeHash, ledgerFixture, LEVELS } from './fixtures/ledger';
import { liteDossiers, makeLite, makeRunning, me as meFixture, policy as policyFixture, stagesAt } from './fixtures/others';

export interface Me {
  login: string;
  name: string;
  avatarUrl: string;
  /** signed in with their own GitHub token · the server's own GitHub account · a synthetic reviewer on a demo copy */
  kind?: 'github' | 'server' | 'demo';
  demo?: boolean;
  /** demo copies only: the synthetic reviewers one can switch between */
  people?: { login: string; name: string }[];
  /** false on copies that never post to GitHub */
  publishes?: boolean;
}
/** What was read and for how long is the server's own record; the request only carries what the signer decides and writes. */
export interface SignoffInput {
  decision: 'accepted' | 'rejected';
  /** risk the signer typed, word for word */
  residualRisk: string[];
  /** written reason for accepting over confirmed problems */
  override?: string;
  /** what a full read found, when the change was drawn for a spot check */
  spotCheck?: { missed: boolean; note?: string };
}
/** The exact statement a signature would go under right now (built by the same server function that signs). */
export interface Statement {
  checkedByAI: string[];
  checkedByHuman: string[];
  notChecked: string[];
  residualRisk: string[];
  humanRisk: string[];
  /** confirmed problems an accept would be given over */
  overrides: string[];
  override?: { items: string[]; reason: string };
  signer: { login: string; name: string; kind: string };
  headSha: string;
  reviewSeconds: number;
  planSeconds: number;
  rushed: boolean;
  rushedBelowSeconds: number;
  /** why the server would refuse an accept right now; empty = it would sign */
  reasons: string[];
  needsCosign: boolean;
  firstSign?: { signer: string; signerName?: string; at: string };
}

type Mode = 'live' | 'mock';
let mode: Mode | undefined;
const listeners = new Set<(m: Mode) => void>();

async function resolveMode(): Promise<Mode> {
  if (mode) return mode;
  if (import.meta.env.VITE_MOCK === '1') mode = 'mock';
  else {
    try {
      const r = await fetch('/api/me', { signal: AbortSignal.timeout(2500) });
      mode = r.ok && (r.headers.get('content-type') ?? '').includes('json') ? 'live' : 'mock';
    } catch {
      mode = 'mock';
    }
  }
  listeners.forEach((l) => l(mode!));
  return mode;
}
let modePromise: Promise<Mode> | undefined;
const getMode = () => (modePromise ??= resolveMode());
export const onMode = (l: (m: Mode) => void) => {
  listeners.add(l);
  if (mode) l(mode);
  else void getMode();
  return () => void listeners.delete(l);
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function http<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try {
      const j = await r.clone().json();
      msg = j.error ?? j.message ?? msg;
    } catch {
      /* keep status text */
    }
    throw new ApiError(r.status, msg);
  }
  return (await r.json()) as T;
}

export function summarize(d: Dossier): DossierSummary {
  return {
    id: d.id,
    slug: d.slug,
    status: d.status,
    title: d.pr.title,
    prUrl: d.pr.url,
    number: d.pr.number,
    repo: `${d.pr.owner}/${d.pr.repo}`,
    author: d.pr.author,
    authorKind: d.pr.authorKind,
    requirementId: d.requirement.id,
    tier: d.routing.tier,
    verdict: d.recommendation.verdict,
    readLines: d.routing.readLines,
    totalLines: d.routing.totalLines,
    estMinutes: d.routing.estMinutes,
    changedFiles: d.pr.changedFiles,
    criteriaProven: d.requirement.criteria.filter((c) => c.status === 'proven').length,
    criteriaTotal: d.requirement.criteria.length,
    findings: d.findings.length,
    blockers: d.findings.filter((f) => f.severity === 'blocker').length,
    refusalsOpen: d.refusals.filter((r) => !r.answer).length,
    signer: d.signoff?.signer,
    generatedAt: d.generatedAt,
  };
}

// ───────────────────────────── mock backend ─────────────────────────────

const clone = <T>(x: T): T => structuredClone(x);
const db = {
  dossiers: new Map<string, Dossier>(),
  running: new Map<string, number>(), // slug → started (ms)
  ledger: clone(ledgerFixture),
};
const seedRunning = makeRunning('te-industry-tech-office', 'junction26-messagepack-csharp', 18, new Date().toISOString());
seedRunning.pr.title = 'Emit [Preserve] on generated formatters for IL2CPP';
seedRunning.requirement.id = 'REQ-2302';
seedRunning.pr.author = 'ju26-coding-agent';
for (const d of [mpDossier, ...liteDossiers, seedRunning]) db.dossiers.set(d.slug, clone(d));
db.running.set(seedRunning.slug, Date.now() - 9000);

const mockLive = (): NonNullable<Dossier['live']> => ({ me: { login: meFixture.login, name: meFixture.name, kind: 'demo' }, read: [], activeSeconds: 0, unitSeconds: {}, floors: {}, probation: [], overrides: [], publishes: false, cleanAfterDays: 14 });
const delay = (ms = 140) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();

function tick(slug: string): Dossier {
  const d = db.dossiers.get(slug);
  if (!d) throw new ApiError(404, `No dossier ${slug}`);
  const started = db.running.get(slug);
  if (d.status === 'running' && started !== undefined) {
    const { stages, done } = stagesAt(Date.now() - started);
    d.stages = stages;
    if (done) {
      const ready = makeLite({
        owner: d.pr.owner,
        repo: d.pr.repo,
        number: d.pr.number,
        title: d.pr.title,
        req: d.requirement.id === 'REQ-…' ? `REQ-${2300 + d.pr.number}` : d.requirement.id,
        reqTitle: 'Generated formatters are stripped by IL2CPP managed code stripping',
        author: d.pr.author === 'unknown' ? 'ju26-coding-agent' : d.pr.author,
        tier: 'T1',
        verdict: 'accept',
        area: 'Source generator',
        trust: [1, 'Supervised'],
        minutes: 2,
        shape: 'small',
        generatedAt: now(),
      });
      db.dossiers.set(slug, ready);
      db.running.delete(slug);
      addEvent('review', 'countersign', `Dossier produced: T1, read 0 of ${ready.routing.totalLines} lines`, ready.id, 'Source generator');
      return ready;
    }
  }
  return d;
}

function addEvent(type: LedgerEventType, actor: string, summary: string, pr?: string, area?: string, data?: Record<string, unknown>) {
  const L = db.ledger;
  const prevHash = L.events.at(-1)?.hash ?? '0'.repeat(64);
  const at = now();
  const e: LedgerEvent = { id: `L${L.events.length + 1}`, at, type, pr, area, actor, summary, data, prevHash, hash: fakeHash(prevHash + at + type + summary) };
  L.events.push(e);
  return e;
}

function setLevel(areaName: string, level: number, reason: string) {
  const a = db.ledger.areas.find((x) => x.area === areaName);
  if (!a) return;
  const from = a.label;
  a.level = Math.max(0, Math.min(3, level));
  a.label = LEVELS[a.level].label;
  a.effect = LEVELS[a.level].effect;
  a.nextLevelAt = LEVELS[a.level].nextAt;
  a.history.push({ at: now(), level: a.level, reason });
  if (from !== a.label) addEvent('trust-change', 'countersign', `${areaName} ${level < LEVELS.findIndex((l) => l.label === from) ? 'demoted' : 'promoted'} ${from} → ${a.label}: ${reason}`, undefined, areaName);
}

function composeLog(r: RunResult, command?: string): string {
  const head = [`# ${r.label} @ ${r.sha.slice(0, 7)}`, command ? `$ ${command}` : '', ''];
  const body = [
    '  Determining projects to restore...',
    '  All projects are up-to-date for restore.',
    '  MessagePack.Annotations -> /work/mp/bin/MessagePack.Annotations/Release/netstandard2.0/MessagePack.Annotations.dll',
    '  MessagePack.SourceGenerator -> /work/mp/bin/MessagePack.SourceGenerator/Release/netstandard2.0/MessagePack.SourceGenerator.dll',
    '  MessagePack.SourceGenerator.Tests -> /work/mp/bin/MessagePack.SourceGenerator.Tests/Release/net8.0/MessagePack.SourceGenerator.Tests.dll',
    'Test run for /work/mp/bin/MessagePack.SourceGenerator.Tests/Release/net8.0/MessagePack.SourceGenerator.Tests.dll (.NETCoreApp,Version=v8.0)',
    'VSTest version 17.11.1 (x64)',
    '',
    'Starting test execution, please wait...',
    'A total of 1 test files matched the specified pattern.',
    ...(r.failing ?? []).map((f, i) => `[xUnit.net 00:00:0${4 + i}.${10 + i * 7}]     ${f} [FAIL]`),
    '',
    r.excerpt ?? '',
    '',
    `exit code ${r.outcome === 'pass' ? 0 : 1} · ${(r.durationMs / 1000).toFixed(1)} s`,
  ];
  return [...head, ...body].join('\n');
}

const mock = {
  async me(): Promise<Me> {
    await delay(40);
    return meFixture;
  },
  async dossiers(): Promise<DossierSummary[]> {
    await delay();
    return [...db.dossiers.keys()].map((s) => summarize(tick(s)));
  },
  async dossier(slug: string): Promise<Dossier> {
    await delay();
    return clone(tick(slug));
  },
  async evidence(slug: string, path: string): Promise<string> {
    await delay(260);
    const d = tick(slug);
    for (const e of d.evidence) {
      for (const r of [e.base, e.head, e.ablation?.result]) if (r?.log === path) return composeLog(r, e.command);
    }
    throw new ApiError(404, `No log at ${path}`);
  },
  async review(prUrl: string): Promise<{ slug: string }> {
    await delay(300);
    const m = /github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/.exec(prUrl);
    if (!m) throw new ApiError(400, 'That is not a GitHub pull request URL. Expected https://github.com/owner/repo/pull/123');
    const d = makeRunning(m[1], m[2], +m[3], now());
    if (db.dossiers.has(d.slug)) return { slug: d.slug };
    db.dossiers.set(d.slug, d);
    db.running.set(d.slug, Date.now());
    return { slug: d.slug };
  },
  async answer(slug: string, body: { refusalId: string; optionId: string; note?: string }): Promise<Dossier> {
    await delay();
    const d = tick(slug);
    const r = d.refusals.find((x) => x.id === body.refusalId);
    if (!r) throw new ApiError(404, 'No such decision');
    r.answer = { optionId: body.optionId, by: meFixture.login, at: now(), note: body.note };
    return clone(d);
  },
  async feedback(slug: string, body: { findingId: string; verdict: 'accepted' | 'rejected'; note?: string }): Promise<Dossier> {
    await delay();
    const d = tick(slug);
    const f = d.findings.find((x) => x.id === body.findingId);
    if (!f) throw new ApiError(404, 'No such finding');
    const prev = f.feedback?.verdict;
    f.feedback = { verdict: body.verdict, by: meFixture.login, at: now(), note: body.note };
    const areaName = d.routing.areas[0]?.area;
    const a = db.ledger.areas.find((x) => x.area === areaName);
    if (a && prev !== body.verdict) {
      if (prev === 'accepted') a.findingsAccepted--;
      if (prev === 'rejected') a.findingsRejected--;
      if (body.verdict === 'accepted') a.findingsAccepted++;
      else a.findingsRejected++;
    }
    addEvent('finding-feedback', meFixture.login, `Finding marked ${body.verdict === 'accepted' ? 'real' : 'not real'}: ${f.title}`, d.id, areaName);
    return clone(d);
  },
  async signoff(slug: string, body: SignoffInput): Promise<Dossier> {
    await delay(420);
    const d = tick(slug);
    const prevHash = db.ledger.events.at(-1)?.hash ?? '0'.repeat(64);
    const at = now();
    const att: Attestation = {
      signer: meFixture.login,
      signerName: meFixture.name,
      at,
      decision: body.decision,
      headSha: d.pr.headSha,
      readUnitIds: d.live?.read ?? [],
      answers: d.refusals.filter((r) => r.answer).map((r) => ({ refusalId: r.id, optionId: r.answer!.optionId, label: r.options.find((o) => o.id === r.answer!.optionId)?.label ?? r.answer!.optionId, note: r.answer!.note })),
      findingFeedback: d.findings.filter((f) => f.feedback).map((f) => ({ findingId: f.id, verdict: f.feedback!.verdict })),
      checkedByAI: d.evidence.filter((e) => e.polarity === 'supports' && e.strength !== 'reasoned' && e.strength !== 'none').map((e) => e.title),
      checkedByHuman: [...(d.live?.read ?? []).map((u) => `Read ${u}`), ...d.refusals.filter((r) => r.answer).map((r) => `Decided ${r.id}`)],
      notChecked: d.notChecked.map((n) => n.what),
      residualRisk: body.residualRisk,
      reviewSeconds: d.live?.activeSeconds ?? 0,
      prevHash,
      hash: fakeHash(prevHash + at + slug + body.decision + body.residualRisk.join('|')),
      github: { statusUrl: `${d.pr.url}/checks`, commentUrl: `${d.pr.url}#issuecomment-countersign` },
    };
    d.signoff = att;
    d.status = body.decision === 'accepted' ? 'signed' : 'rejected';
    const areaName = d.routing.areas[0]?.area;
    const mins = Math.max(1, Math.round((d.live?.activeSeconds ?? 0) / 60));
    addEvent('signoff', meFixture.login, `${body.decision === 'accepted' ? 'Accepted' : 'Rejected'} in ${mins} min${body.residualRisk.length ? ` with ${body.residualRisk.length} residual risk${body.residualRisk.length > 1 ? 's' : ''}` : ''}`, d.id, areaName, { hash: att.hash });
    const a = db.ledger.areas.find((x) => x.area === areaName);
    if (a && body.decision === 'accepted') {
      a.signoffs++;
      a.cleanStreak++;
      if (a.nextLevelAt && a.cleanStreak >= a.nextLevelAt) setLevel(a.area, a.level + 1, `${a.cleanStreak} clean sign-offs`);
    }
    db.ledger.totals.signed++;
    return clone(d);
  },
  async presence(slug: string, _unitId?: string): Promise<{ activeSeconds: number; unitSeconds: number }> {
    const d = tick(slug);
    const l = (d.live ??= mockLive());
    l.activeSeconds += 5;
    return { activeSeconds: l.activeSeconds, unitSeconds: 60 };
  },
  async read(slug: string, body: { unitId: string; read: boolean }): Promise<Dossier> {
    await delay(80);
    const d = tick(slug);
    const l = (d.live ??= mockLive());
    l.read = body.read ? [...new Set([...l.read, body.unitId])] : l.read.filter((x) => x !== body.unitId);
    return clone(d);
  },
  async statement(slug: string, body: Omit<SignoffInput, 'decision'>): Promise<Statement> {
    const d = tick(slug);
    return {
      checkedByAI: d.evidence.filter((e) => e.polarity === 'supports' && e.strength !== 'reasoned' && e.strength !== 'none').map((e) => `[${e.id}] ${e.title}`),
      checkedByHuman: [...(d.live?.read ?? []).map((u) => `Read ${u}`), ...d.refusals.filter((r) => r.answer).map((r) => `Decided ${r.id}`)],
      notChecked: d.notChecked.map((n) => n.what),
      residualRisk: body.residualRisk,
      humanRisk: body.residualRisk,
      overrides: [],
      signer: { login: meFixture.login, name: meFixture.name, kind: 'demo' },
      headSha: d.pr.headSha,
      reviewSeconds: d.live?.activeSeconds ?? 0,
      planSeconds: d.routing.estMinutes * 60,
      rushed: false,
      rushedBelowSeconds: 20,
      reasons: [],
      needsCosign: false,
    };
  },
  async ledger(): Promise<LedgerView> {
    await delay();
    return clone(db.ledger);
  },
  async escape(body: { slug: string; kind: 'revert' | 'incident'; note: string }): Promise<LedgerView> {
    await delay(300);
    const d = tick(body.slug);
    const areaName = d.routing.areas[0]?.area;
    const a = db.ledger.areas.find((x) => x.area === areaName);
    addEvent('escape', meFixture.login, `${body.kind === 'revert' ? 'Revert' : 'Incident'}: ${body.note || 'no note'}`, d.id, areaName, { kind: body.kind });
    if (a) {
      a.escapes++;
      a.cleanStreak = 0;
      setLevel(a.area, a.level - 1, `Escape: ${d.id.split('/').pop()} ${body.kind === 'revert' ? 'reverted' : 'caused an incident'}`);
    }
    const t = db.ledger.totals;
    t.escapes++;
    t.escapeRate = t.escapes / Math.max(1, t.signed);
    const w = db.ledger.weekly.at(-1);
    if (w) w.escapes++;
    return clone(db.ledger);
  },
  async spotCheck(body: { slug: string; missed: boolean; note: string }): Promise<LedgerView> {
    await delay(300);
    const d = tick(body.slug);
    const areaName = d.routing.areas[0]?.area;
    const a = db.ledger.areas.find((x) => x.area === areaName);
    addEvent('spot-check', meFixture.login, body.missed ? `Full read found something the AI missed: ${body.note || 'no note'}` : `Full read: nothing the AI missed${body.note ? `. ${body.note}` : ''}`, d.id, areaName, { missed: body.missed });
    if (a) {
      a.spotChecks++;
      if (body.missed) {
        a.spotCheckMisses++;
        a.cleanStreak = 0;
        setLevel(a.area, a.level - 1, 'Spot-check found something the AI missed');
      }
    }
    const w = db.ledger.weekly.at(-1);
    if (w) {
      w.spotChecks++;
      if (body.missed) w.spotCheckMisses++;
    }
    const sc = db.ledger.areas.reduce((s, x) => s + x.spotChecks, 0);
    const miss = db.ledger.areas.reduce((s, x) => s + x.spotCheckMisses, 0);
    db.ledger.totals.spotCheckAgreement = sc ? (sc - miss) / sc : 1;
    return clone(db.ledger);
  },
  async policy(): Promise<unknown> {
    await delay();
    return policyFixture;
  },
};

// ───────────────────────────── public API ─────────────────────────────

const enc = encodeURIComponent;
const live = async () => (await getMode()) === 'live';

export const api = {
  me: async () => ((await live()) ? http<Me>('GET', '/api/me') : mock.me()),
  dossiers: async () => ((await live()) ? http<DossierSummary[]>('GET', '/api/dossiers') : mock.dossiers()),
  dossier: async (slug: string) => ((await live()) ? http<Dossier>('GET', `/api/dossiers/${enc(slug)}`) : mock.dossier(slug)),
  evidence: async (slug: string, path: string) => {
    if (!(await live())) return mock.evidence(slug, path);
    const r = await fetch(`/api/dossiers/${enc(slug)}/evidence/${path.split('/').map(enc).join('/')}`);
    if (!r.ok) throw new ApiError(r.status, `Could not load the log (${r.status})`);
    return r.text();
  },
  review: async (prUrl: string) => ((await live()) ? http<{ slug: string }>('POST', '/api/reviews', { prUrl }) : mock.review(prUrl)),
  answer: async (slug: string, body: { refusalId: string; optionId: string; note?: string }) =>
    (await live()) ? http<Dossier>('POST', `/api/dossiers/${enc(slug)}/answers`, body) : mock.answer(slug, body),
  feedback: async (slug: string, body: { findingId: string; verdict: 'accepted' | 'rejected'; note?: string }) =>
    (await live()) ? http<Dossier>('POST', `/api/dossiers/${enc(slug)}/feedback`, body) : mock.feedback(slug, body),
  signoff: async (slug: string, body: SignoffInput) => ((await live()) ? http<Dossier>('POST', `/api/dossiers/${enc(slug)}/signoff`, body) : mock.signoff(slug, body)),
  presence: async (slug: string, unitId?: string) => ((await live()) ? http<{ activeSeconds: number; unitSeconds: number }>('POST', `/api/dossiers/${enc(slug)}/presence`, { unitId }) : mock.presence(slug, unitId)),
  read: async (slug: string, body: { unitId: string; read: boolean }) => ((await live()) ? http<Dossier>('POST', `/api/dossiers/${enc(slug)}/read`, body) : mock.read(slug, body)),
  statement: async (slug: string, body: Omit<SignoffInput, 'decision'>) => ((await live()) ? http<Statement>('POST', `/api/dossiers/${enc(slug)}/statement`, body) : mock.statement(slug, body)),
  /** the commit status and dossier comment as GitHub reports them right now; undefined on fixtures */
  github: async (slug: string) => ((await live()) ? http<GitHubNow & { publishes: boolean }>('GET', `/api/dossiers/${enc(slug)}/github`) : undefined),
  /** switch reviewer on a demo copy, or sign in with a GitHub token */
  signIn: async (body: { login?: string; token?: string }) => http<Me>('POST', '/api/session', body),
  signOut: async () => http<{ ok: boolean }>('DELETE', '/api/session'),
  ledger: async () => ((await live()) ? http<LedgerView>('GET', '/api/ledger') : mock.ledger()),
  escape: async (body: { slug: string; kind: 'revert' | 'incident'; note: string }) => ((await live()) ? http<LedgerView>('POST', '/api/ledger/escape', body) : mock.escape(body)),
  spotCheck: async (body: { slug: string; missed: boolean; note: string }) => ((await live()) ? http<LedgerView>('POST', '/api/ledger/spot-check', body) : mock.spotCheck(body)),
  policy: async () => ((await live()) ? http<unknown>('GET', '/api/policy') : mock.policy()),
};
