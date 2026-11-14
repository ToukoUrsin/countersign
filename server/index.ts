import { fullReadReason, gate, isSkim, overrides, planMinutes } from '../shared/gate';
import { spawn } from 'node:child_process';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, openSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { resolve, normalize } from 'node:path';
import { type Context, Hono } from 'hono';
import type { Attestation, ChangeUnit, Dossier, DossierSummary, ReviewerCheck, ReviewerState } from '../shared/dossier';
import { githubNow, parsePrUrl, setStatus, slugOf, upsertComment } from '../pipeline/lib/gh';
import type { GitHubNow } from '../shared/dossier';
import { areaOf } from '../pipeline/lib/policy';
import { DATA, ROOT, WORK, ensureDir } from '../pipeline/lib/util';
import { emptyDossier } from '../pipeline/stages/intake';
import { publicUrl } from '../pipeline/stages/publish';
import { findReverts } from './escapes';
import { append, cleanAfterDays, lastHash, ledgerPolicy, readEvents, sha256, trustLevels, view } from './ledger';
import { type Person, demoMode, demoPeople, person, publicPerson, signIn, signOut } from './people';
import { registerLive } from './live';

const app = new Hono();
const DOSSIERS = ensureDir(resolve(DATA, 'dossiers'));
const TIER = { T0: 0, T1: 1, T2: 2, T3: 3 } as const;
/** false on copies that never post to GitHub (judging, recordings): the UI must then not claim a green check */
const PUBLIC_DEMO = process.env.CS_PUBLIC_DEMO === '1';
const PUBLISHES = process.env.CS_NO_PUBLISH !== '1';

// optional basic auth for when the UI is exposed through a tunnel: anyone with the link can read a
// dossier, but everything that acts (sign-off, answers, feedback, starting a review) needs the login,
// because those actions post to GitHub as the signer.
const BASIC = process.env.CS_BASIC;
if (BASIC) {
  app.use('*', async (c, next) => {
    if (c.req.method === 'GET' || c.req.method === 'HEAD') return next();
    const h = c.req.header('authorization') ?? '';
    if (h === 'Basic ' + Buffer.from(BASIC).toString('base64')) return next();
    // GitHub cannot send the login; a delivery is let through to its handler, which checks GitHub's signature instead
    if (c.req.path === '/api/github/webhook' && process.env.CS_WEBHOOK_SECRET) return next();
    // a reader who is not logged in is not reviewing: their heartbeat is dropped without a login prompt
    if (c.req.path.endsWith('/presence') || c.req.path.endsWith('/statement')) return c.json({ ignored: true, activeSeconds: 0, unitSeconds: 0 });
    return c.text('auth required', 401, { 'WWW-Authenticate': 'Basic realm="countersign"' });
  });
}

const pathOf = (slug: string) => resolve(DOSSIERS, slug.replace(/[^a-z0-9_.-]/gi, ''), 'dossier.json');
function load(slug: string): Dossier | null {
  const p = pathOf(slug);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}
function store(d: Dossier) {
  const p = pathOf(d.slug);
  writeFileSync(p + '.tmp', JSON.stringify({ ...d, live: undefined }, null, 1));
  renameSync(p + '.tmp', p);
}

function summary(d: Dossier): DossierSummary {
  const cr = d.requirement.criteria;
  return {
    id: d.id,
    slug: d.slug,
    status: d.status,
    title: d.pr.title,
    prUrl: d.pr.url,
    number: d.pr.number,
    repo: d.pr.owner ? `${d.pr.owner}/${d.pr.repo}` : '',
    author: d.pr.author,
    authorKind: d.pr.authorKind,
    requirementId: d.requirement.id,
    tier: d.routing.tier,
    verdict: d.recommendation.verdict,
    readLines: fullReadReason(d) ? d.routing.totalLines : d.routing.readLines,
    totalLines: d.routing.totalLines,
    // a voided reading plan costs what reading every line costs (6 lines a minute, the policy's own rate)
    estMinutes: planMinutes(d),
    fullRead: fullReadReason(d) ? (d.live?.probation.length ? 'probation' : d.routing.spotCheck.selected ? 'spot-check' : 'no-skip') : undefined,
    changedFiles: d.pr.changedFiles,
    criteriaProven: cr.filter((c) => c.status === 'proven').length,
    criteriaTotal: cr.length,
    findings: d.findings.length,
    blockers: d.findings.filter((f) => f.severity === 'blocker').length,
    refusalsOpen: d.refusals.filter((r) => !r.answer).length,
    signer: d.signoff?.signer,
    generatedAt: d.generatedAt,
  };
}

const me = async (c: Context) => ({ ...publicPerson(await person(c)), demo: demoMode(), people: demoPeople(), publishes: PUBLISHES });
app.get('/api/me', async (c) => c.json(await me(c)));
app.post('/api/session', async (c) => {
  try {
    const p = await signIn(c, await c.req.json<{ login?: string; token?: string }>());
    return c.json({ ...publicPerson(p), demo: demoMode(), people: demoPeople(), publishes: PUBLISHES });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});
app.delete('/api/session', (c) => {
  signOut(c);
  return c.json({ ok: true });
});

app.get('/api/dossiers', async (c) => {
  const who = await person(c);
  const list = readdirSync(DOSSIERS)
    .map((s) => load(s))
    .filter((d): d is Dossier => !!d)
    .map((d) => summary(withLive(d, who)));
  // the inbox is a work queue: running reviews first, then what waits for a person, least work first
  const rank = (s: DossierSummary) => (s.status === 'running' ? 0 : s.status === 'ready' ? 1 : s.status === 'failed' ? 2 : 3);
  list.sort((a, b) => rank(a) - rank(b) || a.estMinutes - b.estMinutes || TIER[a.tier] - TIER[b.tier] || b.generatedAt.localeCompare(a.generatedAt));
  return c.json(list);
});

app.get('/api/dossiers/:slug', async (c) => {
  const d = load(c.req.param('slug'));
  return d ? c.json(withLive(d, await person(c))) : c.json({ error: 'not found' }, 404);
});

app.get('/api/dossiers/:slug/evidence/*', (c) => {
  const slug = c.req.param('slug').replace(/[^a-z0-9_.-]/gi, '');
  const rel = normalize(decodeURIComponent(c.req.path.split('/evidence/')[1] ?? ''));
  const base = resolve(DOSSIERS, slug, 'evidence');
  const p = resolve(base, rel);
  if (!p.startsWith(base + '/') || !existsSync(p) || !statSync(p).isFile()) return c.text('not found', 404);
  let text = readFileSync(p, 'utf8');
  if (text.length > 600_000) text = text.slice(0, 200_000) + `\n\n… [${text.length - 400_000} characters omitted] …\n\n` + text.slice(-200_000);
  return c.text(text);
});

app.post('/api/reviews', async (c) => {
  if (PUBLIC_DEMO) return c.json({ error: 'Starting new reviews is disabled in the public demo.' }, 403);
  const { prUrl, fresh } = await c.req.json<{ prUrl: string; fresh?: string }>();
  try {
    return c.json({ slug: startReview(prUrl, fresh) });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

/** Start (or restart) a review for a PR url. Shared by the UI and the GitHub webhook. */
function startReview(prUrl: string, fresh?: string) {
  const p = parsePrUrl(prUrl);
  const slug = slugOf(p.owner, p.repo, p.number);
  const existing = load(slug);
  if (existing?.status === 'running' && Date.now() - new Date(existing.generatedAt).getTime() < 60 * 60_000) return slug;
  ensureDir(resolve(DOSSIERS, slug));
  // Keep the previous dossier in place until pipeline/review.ts archives it. This binds the
  // old evidence to its old head and lets the new run carry a compact round history.
  if (!existing) {
    const d = emptyDossier(slug, prUrl);
    d.pr = { ...d.pr, owner: p.owner, repo: p.repo, number: p.number, title: `${p.owner}/${p.repo}#${p.number}` };
    d.id = `${p.owner}/${p.repo}#${p.number}`;
    store(d);
  }
  const logDir = ensureDir(resolve(WORK, 'runs', slug));
  const out = openSync(resolve(logDir, 'pipeline.log'), 'a');
  const args = ['pipeline/review.ts', prUrl];
  if (fresh) args.push('--fresh', fresh);
  const child = spawn('bun', args, { cwd: ROOT, detached: true, stdio: ['ignore', out, out], env: { ...process.env, CS_PUBLIC_URL: publicUrl() } });
  child.unref();
  return slug;
}

/**
 * GitHub webhook (pull_request opened / synchronize / reopened). A new head commit invalidates the
 * previous dossier and any sign-off on it: evidence and attestation are bound to one head sha.
 */
app.post('/api/github/webhook', async (c) => {
  if (PUBLIC_DEMO) return c.json({ error: 'Starting new reviews is disabled in the public demo.' }, 403);
  const event = c.req.header('x-github-event');
  const raw = await c.req.text();
  // With CS_WEBHOOK_SECRET set, only deliveries GitHub signed with that secret start a review.
  const secret = process.env.CS_WEBHOOK_SECRET;
  if (secret) {
    const want = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
    const got = c.req.header('x-hub-signature-256') ?? '';
    if (got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) return c.json({ error: 'bad signature' }, 401);
  }
  let body: { action?: string; pull_request?: { html_url: string } };
  try {
    body = JSON.parse(raw);
  } catch {
    return c.json({ error: 'not JSON' }, 400);
  }
  if (event !== 'pull_request' || !body.pull_request || !['opened', 'synchronize', 'reopened'].includes(body.action ?? '')) return c.json({ ignored: true });
  return c.json({ slug: startReview(body.pull_request.html_url, 'all') });
});

// ───────────── the server's own record of each person's review ─────────────
// Read marks and review time are kept here, not in the browser: a sign-off cannot name units it never opened
// or claim minutes that did not pass.

interface ReviewFile {
  headSha: string;
  people: Record<string, ReviewerState>;
}
const reviewsPath = (slug: string) => resolve(DOSSIERS, slug.replace(/[^a-z0-9_.-]/gi, ''), 'reviews.json');
function reviewsOf(d: Dossier): ReviewFile {
  const p = reviewsPath(d.slug);
  if (existsSync(p)) {
    try {
      const j = JSON.parse(readFileSync(p, 'utf8')) as ReviewFile;
      if (j.headSha === d.pr.headSha) return j; // a new head commit starts every review over
    } catch {
      /* unreadable: start over */
    }
  }
  return { headSha: d.pr.headSha, people: {} };
}
const saveReviews = (d: Dossier, r: ReviewFile) => writeFileSync(reviewsPath(d.slug), JSON.stringify(r));
const mine = (r: ReviewFile, who: Person) => (r.people[who.login] ??= { login: who.login, name: who.name, startedAt: new Date().toISOString(), activeSeconds: 0, units: {} });
const linesOf = (u: ChangeUnit) => u.additions + u.deletions;
/**
 * Seconds a unit must have been open before its mark is taken. Read: half a second a changed line, 4 to 30 s.
 * Skim: a sixth of a second a line, 3 to 12 s. A floor, not a proof of understanding.
 */
const floorOf = (d: Dossier, u: ChangeUnit) => (isSkim(d, u) ? Math.round(Math.min(12, Math.max(3, linesOf(u) / 6))) : Math.round(Math.min(30, Math.max(4, linesOf(u) * 0.5))));
const readSet = (st?: ReviewerState) => new Set(Object.entries(st?.units ?? {}).filter(([, u]) => u.readAt).map(([id]) => id));

/** Clock a heartbeat. Time counts only between beats at most 15 s apart, so a closed or hidden tab adds nothing. */
function beat(st: ReviewerState, unitId?: string) {
  const now = Date.now();
  const gap = st.lastBeat ? (now - new Date(st.lastBeat).getTime()) / 1000 : 0;
  const add = st.lastBeat && gap <= 15 ? gap : 0;
  st.activeSeconds += add;
  if (unitId) {
    const u = (st.units[unitId] ??= { seconds: 0 });
    if (st.lastUnit === unitId) u.seconds += add;
  }
  st.lastBeat = new Date(now).toISOString();
  st.lastUnit = unitId;
}

/** What is true right now for this viewer: who they are, what the server has recorded, what the ledger says today. */
function withLive(d: Dossier, who: Person): Dossier {
  const st = reviewsOf(d).people[who.login];
  const trust = trustLevels();
  // trust withdrawn after an escape reaches every open change in that area at once, not at the next review
  const probation = d.signoff ? [] : d.routing.areas.map((a) => a.area).filter((a) => trust.get(a)?.level === 0);
  d.live = {
    me: publicPerson(who),
    read: [...readSet(st)],
    activeSeconds: Math.round(st?.activeSeconds ?? 0),
    unitSeconds: Object.fromEntries(Object.entries(st?.units ?? {}).map(([id, u]) => [id, Math.round(u.seconds)])),
    floors: Object.fromEntries(d.units.map((u) => [u.id, floorOf(d, u)])),
    probation,
    firstSign: d.firstSign ? { signer: d.firstSign.signer, signerName: d.firstSign.signerName, at: d.firstSign.at } : undefined,
    overrides: overrides(d),
    publishes: PUBLISHES,
    cleanAfterDays: cleanAfterDays(ledgerPolicy()),
  };
  return d;
}

/** Seconds of reading this plan asks for; a review far below it is recorded as rushed and never counts toward trust. */
const planSeconds = (d: Dossier) => summary(d).estMinutes * 60;
const RUSHED_BELOW = 0.2;
const isRushed = (d: Dossier, activeSeconds: number) => activeSeconds < Math.max(20, planSeconds(d) * RUSHED_BELOW);
const dur = (s: number) => (s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${Math.round(s)} s`);

interface SignBody {
  decision: 'accepted' | 'rejected';
  /** risk the signer typed, word for word */
  residualRisk?: string[];
  /** written reason for accepting over confirmed problems */
  override?: string;
  spotCheck?: { missed: boolean; note?: string };
}

/**
 * The statement a name goes under. One function builds both the preview the signer reads and the attestation
 * that is signed, so the two cannot differ.
 */
function statement(d: Dossier, st: ReviewerState | undefined, body: Pick<SignBody, 'residualRisk' | 'override'>) {
  const read = readSet(st);
  const ids = (xs: string[]) => (xs.length ? ` [${xs.join(', ')}]` : '');
  const strong = d.evidence.filter((e) => (e.strength === 'executed' || e.strength === 'verified-static') && e.polarity !== 'undermines');
  const abl = strong.filter((e) => e.kind === 'ablation');
  const checkedByAI = [
    ...d.requirement.criteria.filter((x) => x.status === 'proven').map((x) => `${x.id} proven by a run${ids(x.evidenceIds)}: ${x.text}`),
    ...strong.filter((e) => ['red-green', 'regression', 'mechanical', 'canary'].includes(e.kind)).map((e) => `[${e.id}] ${e.title}: ${e.conclusion}`),
    ...(abl.length ? [`${abl.length} source hunk${abl.length > 1 ? 's are' : ' is'} each noticed by the build or a test when reverted${ids(abl.map((e) => e.id))}`] : []),
    ...d.units.filter((u) => u.ask === 'none' && !read.has(u.id)).map((u) => `${u.id} “${u.title}” (${linesOf(u)} lines) not read by a person. Covered by${ids(u.skipProof?.evidenceIds ?? [])}: ${u.skipProof?.text ?? 'proof'}`),
  ];
  const checkedByHuman = [
    ...d.units.filter((u) => read.has(u.id)).map((u) => `${isSkim(d, u) ? 'Skimmed' : 'Read'} ${u.id} “${u.title}” (${linesOf(u)} lines, open for ${dur(st?.units[u.id]?.seconds ?? 0)})`),
    ...d.refusals.filter((r) => r.answer).map((r) => `Decided ${r.id}: ${r.question} → ${r.options.find((o) => o.id === r.answer!.optionId)?.label}`),
    ...d.findings.filter((f) => f.feedback).map((f) => `Judged ${f.id} ${f.feedback!.verdict === 'accepted' ? 'real' : 'not real'}: ${f.title}`),
  ];
  const notChecked = [
    ...d.units.filter((u) => u.ask !== 'none' && !read.has(u.id)).map((u) => `${u.id} “${u.title}” was routed to ${u.ask} and not marked ${u.ask === 'skim' ? 'skimmed' : 'read'}`),
    ...d.requirement.criteria.filter((x) => x.status === 'unproven').map((x) => `${x.id} has no executed evidence: ${x.text}`),
    ...d.notChecked.map((n) => `${n.what}: ${n.why}`),
  ];
  const surv = d.evidence.filter((e) => e.kind === 'ablation' && e.ablation && !e.ablation.killed);
  // tolerate a single string from API clients; anything else that is not text is dropped, never a server error
  const rr: unknown = body.residualRisk;
  const humanRisk = (Array.isArray(rr) ? rr : typeof rr === 'string' ? [rr] : []).filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean);
  const residualRisk = [
    ...d.findings.filter((f) => f.feedback?.verdict === 'accepted').map((f) => `${f.id} (${f.severity}, ${f.strength}) judged real and not fixed in this commit: ${f.title}`),
    ...d.requirement.criteria.filter((x) => x.status === 'violated').map((x) => `${x.id} is contradicted by an independent test${ids(x.evidenceIds)}`),
    ...(surv.length ? [`${surv.length} source hunk${surv.length > 1 ? 's' : ''} can be reverted without any test failing${ids(surv.map((e) => e.id))}: no test notices this code`] : []),
    ...humanRisk,
  ];
  const ov = overrides(d);
  const reason = body.override?.trim() ?? '';
  return { read, checkedByAI, checkedByHuman, notChecked, residualRisk, humanRisk, override: ov.length && reason ? { items: ov, reason } : undefined, overrides: ov };
}

app.post('/api/dossiers/:slug/presence', async (c) => {
  const d = load(c.req.param('slug'));
  if (!d) return c.json({ error: 'not found' }, 404);
  const who = await person(c);
  const { unitId } = await c.req.json<{ unitId?: string }>().catch(() => ({ unitId: undefined }));
  const r = reviewsOf(d);
  const st = mine(r, who);
  if (!d.signoff && d.status === 'ready') {
    beat(st, unitId && d.units.some((u) => u.id === unitId) ? unitId : undefined);
    saveReviews(d, r);
  }
  return c.json({ activeSeconds: Math.round(st.activeSeconds), unitSeconds: unitId ? Math.round(st.units[unitId]?.seconds ?? 0) : 0 });
});

app.post('/api/dossiers/:slug/read', async (c) => {
  const d = load(c.req.param('slug'));
  if (!d) return c.json({ error: 'not found' }, 404);
  if (d.signoff) return c.json({ error: 'already signed' }, 409);
  const who = await person(c);
  const { unitId, read } = await c.req.json<{ unitId: string; read: boolean }>();
  const u = d.units.find((x) => x.id === unitId);
  if (!u) return c.json({ error: 'unknown unit' }, 400);
  const r = reviewsOf(d);
  const st = mine(r, who);
  beat(st, unitId);
  const rec = (st.units[unitId] ??= { seconds: 0 });
  if (read) {
    const need = floorOf(d, u);
    if (rec.seconds < need) {
      saveReviews(d, r);
      const wait = Math.ceil(need - rec.seconds);
      return c.json({ error: `${u.id} has been open for ${Math.floor(rec.seconds)} s. Its ${linesOf(u)} changed lines take at least ${need} s before the server counts them as ${isSkim(d, u) ? 'skimmed' : 'read'}: ${wait} s to go.`, waitSeconds: wait }, 425);
    }
    rec.readAt ??= new Date().toISOString();
  } else delete rec.readAt;
  saveReviews(d, r);
  return c.json(withLive(d, who));
});

app.post('/api/dossiers/:slug/answers', async (c) => {
  const d = load(c.req.param('slug'));
  if (!d) return c.json({ error: 'not found' }, 404);
  if (d.signoff || d.firstSign) return c.json({ error: 'Already signed: a decision cannot change under a signature.' }, 409);
  const who = await person(c);
  const { refusalId, optionId, note } = await c.req.json<{ refusalId: string; optionId: string; note?: string }>();
  const r = d.refusals.find((x) => x.id === refusalId);
  if (!r || !r.options.some((o) => o.id === optionId)) return c.json({ error: 'unknown refusal or option' }, 400);
  r.answer = { optionId, by: who.login, at: new Date().toISOString(), note: note || undefined };
  store(d);
  return c.json(withLive(d, who));
});

const codeAreas = (d: Dossier) => {
  const a = d.routing.areas.map((x) => x.area);
  const code = a.filter((x) => !['tests', 'docs', 'generated-snapshots'].includes(x));
  return code.length ? code : a;
};

app.post('/api/dossiers/:slug/feedback', async (c) => {
  const d = load(c.req.param('slug'));
  if (!d) return c.json({ error: 'not found' }, 404);
  // a judgment is part of what was signed: it cannot be added or changed afterwards
  if (d.signoff || d.firstSign) return c.json({ error: 'Already signed: a finding cannot be judged or re-judged under a signature.' }, 409);
  const who = await person(c);
  const { findingId, verdict, note } = await c.req.json<{ findingId: string; verdict: 'accepted' | 'rejected'; note?: string }>();
  const f = d.findings.find((x) => x.id === findingId);
  if (!f || (verdict !== 'accepted' && verdict !== 'rejected')) return c.json({ error: 'unknown finding or verdict' }, 400);
  const changed = f.feedback?.verdict !== verdict;
  f.feedback = { verdict, by: who.login, at: new Date().toISOString(), note: note || undefined };
  store(d);
  if (changed) {
    const policy = ledgerPolicy();
    const path = f.refs[0]?.path;
    const area = path ? areaOf(policy, path).name : codeAreas(d)[0];
    append({ type: 'finding-feedback', pr: d.id, area, actor: who.login, summary: `${who.login} judged AI finding “${f.title.slice(0, 80)}” ${verdict === 'accepted' ? 'real' : 'not real'} (${f.strength})`, data: { areas: [area], verdict, findingId, strength: f.strength, severity: f.severity } });
  }
  return c.json(withLive(d, who));
});

/** What GitHub itself reports for this pull request right now: the commit status and the dossier comment. Read-only, cached briefly. */
const ghCache = new Map<string, { at: number; v: GitHubNow }>();
const GITHUB_SNAPSHOT = process.env.CS_GITHUB_SNAPSHOT ? resolve(process.env.CS_GITHUB_SNAPSHOT) : resolve(DATA, 'github-snapshot.json');
function githubSnapshot(slug: string): (GitHubNow & { snapshot: true; snapshotAt: string }) | null {
  if (!PUBLIC_DEMO || !existsSync(GITHUB_SNAPSHOT)) return null;
  try {
    const j = JSON.parse(readFileSync(GITHUB_SNAPSHOT, 'utf8')) as { capturedAt?: string; dossiers?: Record<string, GitHubNow> };
    const v = j.dossiers?.[slug];
    return v && j.capturedAt ? { ...v, snapshot: true, snapshotAt: j.capturedAt } : null;
  } catch {
    return null;
  }
}
app.get('/api/dossiers/:slug/github', async (c) => {
  const d = load(c.req.param('slug'));
  if (!d) return c.json({ error: 'not found' }, 404);
  const snapshot = githubSnapshot(d.slug);
  if (snapshot) return c.json({ ...snapshot, publishes: PUBLISHES });
  const hit = ghCache.get(d.slug);
  if (hit && Date.now() - hit.at < 15_000) return c.json({ ...hit.v, publishes: PUBLISHES });
  try {
    const v = await githubNow(d.pr);
    ghCache.set(d.slug, { at: Date.now(), v });
    return c.json({ ...v, publishes: PUBLISHES });
  } catch (e) {
    return c.json({ error: `GitHub could not be read: ${String((e as Error).message).slice(0, 200)}` }, 502);
  }
});

/** The exact statement a signature would go under right now, for this person. */
app.post('/api/dossiers/:slug/statement', async (c) => {
  const d = load(c.req.param('slug'));
  if (!d) return c.json({ error: 'not found' }, 404);
  const who = await person(c);
  withLive(d, who);
  const body = await c.req.json<Pick<SignBody, 'residualRisk' | 'override' | 'spotCheck'>>().catch(() => ({}) as Pick<SignBody, 'residualRisk' | 'override' | 'spotCheck'>);
  const st = reviewsOf(d).people[who.login];
  const s = statement(d, st, body);
  const g = gate(d, { readUnitIds: s.read, spotCheck: body.spotCheck, override: body.override });
  const active = Math.round(st?.activeSeconds ?? 0);
  const { read: _read, ...lists } = s;
  return c.json({
    ...lists,
    signer: publicPerson(who),
    headSha: d.pr.headSha,
    reviewSeconds: active,
    planSeconds: planSeconds(d),
    rushed: isRushed(d, active),
    rushedBelowSeconds: Math.round(Math.max(20, planSeconds(d) * RUSHED_BELOW)),
    reasons: g.reasons,
    needsCosign: (d.live?.probation.length ?? 0) > 0,
    firstSign: d.live?.firstSign,
  });
});

app.post('/api/dossiers/:slug/signoff', async (c) => {
  const d = load(c.req.param('slug'));
  if (!d) return c.json({ error: 'not found' }, 404);
  if (d.signoff) return c.json({ error: 'already signed' }, 409);
  if (d.status !== 'ready') return c.json({ error: `dossier is ${d.status}` }, 409);
  const who = await person(c);
  withLive(d, who);
  const body = await c.req.json<SignBody>();
  if (body.decision !== 'accepted' && body.decision !== 'rejected') return c.json({ error: 'decision must be accepted or rejected' }, 400);
  const accepted = body.decision === 'accepted';
  // what was read and for how long comes from the server's own record of this person, never from the request
  const rf = reviewsOf(d);
  const st = rf.people[who.login];
  const s = statement(d, st, body);
  const probation = d.live?.probation ?? [];
  if (accepted) {
    if (d.firstSign?.signer === who.login) return c.json({ error: `Not signed: you gave the first signature. ${probation.join(' and ') || 'This area'} is on probation, so a different person must co-sign.` }, 400);
    // the accountability gate is enforced here, not only in the UI: shared/gate.ts is the one definition
    const g = gate(d, { readUnitIds: s.read, spotCheck: body.spotCheck, override: body.override || d.firstSign?.override?.reason });
    if (g.reasons.length) return c.json({ error: `Not signed: ${g.reasons.join('; ')}.` }, 400);
  }
  const seconds = Math.round(st?.activeSeconds ?? 0);
  const rushed = accepted && isRushed(d, seconds);
  const prevHash = lastHash();
  const at = new Date().toISOString();

  // second signature on a change whose area is on probation
  if (accepted && d.firstSign) {
    const co = { signer: who.login, signerName: who.name, at, readUnitIds: [...s.read], reviewSeconds: seconds, prevHash };
    d.signoff = { ...d.firstSign, rushed: d.firstSign.rushed || rushed, cosign: { ...co, hash: sha256(JSON.stringify(co)) } };
    delete d.firstSign;
  } else {
    const core = {
      signer: who.login,
      signerName: who.name,
      identity: who.kind,
      at,
      decision: body.decision,
      headSha: d.pr.headSha,
      readUnitIds: [...s.read],
      readSeconds: Object.fromEntries([...s.read].map((id) => [id, Math.round(st?.units[id]?.seconds ?? 0)])),
      answers: d.refusals.filter((r) => r.answer).map((r) => ({ refusalId: r.id, optionId: r.answer!.optionId, label: r.options.find((o) => o.id === r.answer!.optionId)?.label ?? '', note: r.answer!.note })),
      findingFeedback: d.findings.filter((f) => f.feedback).map((f) => ({ findingId: f.id, verdict: f.feedback!.verdict })),
      checkedByAI: s.checkedByAI,
      checkedByHuman: s.checkedByHuman,
      notChecked: s.notChecked,
      residualRisk: s.residualRisk,
      humanRisk: s.humanRisk,
      override: accepted ? s.override : undefined,
      rushed: rushed || undefined,
      reviewSeconds: seconds,
      prevHash,
    };
    const att: Attestation = { ...core, hash: sha256(JSON.stringify(core)) };
    if (accepted && probation.length) {
      // first of two signatures: nothing is accepted yet
      d.firstSign = att;
      store(d);
      append({ type: 'signoff', pr: d.id, actor: who.login, summary: `${who.login} gave the first of two signatures on ${d.id}: ${probation.join(', ')} on probation, waiting for a second person`, data: { areas: codeAreas(d), decision: 'first-signature', attestation: att.hash } });
      await post(d, who, 'pending', `First signature by @${who.login}. ${probation.join(', ')} on probation: waiting for a second signer`);
      return c.json(withLive(d, who));
    }
    d.signoff = att;
    delete d.firstSign;
  }
  const att = d.signoff!;
  d.status = accepted ? 'signed' : 'rejected';
  store(d);

  const hours = d.pr.createdAt ? (Date.now() - new Date(d.pr.createdAt).getTime()) / 3_600_000 : 0;
  const first = att.signer;
  append({
    type: 'signoff',
    pr: d.id,
    actor: first,
    summary: `${first}${att.cosign ? ` and ${att.cosign.signer}` : ''} ${accepted ? 'countersigned' : 'asked for changes on'} ${d.id} (${d.requirement.id}) after ${dur(att.reviewSeconds)}; read ${att.readUnitIds.length} unit(s)${att.rushed ? '; faster than the floor for this plan, so it does not count toward trust' : ''}${att.override ? '; accepted over confirmed problems with a written reason' : ''}`,
    data: {
      areas: codeAreas(d),
      decision: body.decision,
      tier: d.routing.tier,
      reviewSeconds: att.reviewSeconds,
      planSeconds: planSeconds(d),
      rushed: !!att.rushed,
      override: !!att.override,
      cosigner: att.cosign?.signer,
      identity: att.identity,
      readLines: d.units.filter((u) => att.readUnitIds.includes(u.id)).reduce((a, u) => a + linesOf(u), 0),
      totalLines: d.routing.totalLines,
      timeToMergeHours: Math.round(hours * 10) / 10,
      attestation: att.hash,
    },
  });

  // a sampled change is the audit of the reviewer: what the full read found goes on the ledger with the signature
  if (accepted && d.routing.spotCheck.selected && body.spotCheck) {
    const missed = !!body.spotCheck.missed;
    const note = body.spotCheck.note?.trim();
    append({ type: 'spot-check', pr: d.id, actor: who.login, summary: `${who.login} did a full read of ${d.id}: ${missed ? 'found something the AI missed' : 'agrees with the AI review'}${note ? ` — ${note}` : ''}`, data: { areas: codeAreas(d), missed, note } });
  }

  // post to the pull request: the merge gate and a human-readable attestation
  const signers = att.cosign ? `@${att.signer} and @${att.cosign.signer}` : `@${att.signer}`;
  await post(d, who, accepted ? 'success' : 'failure', accepted ? `Countersigned by ${signers}: read ${att.readUnitIds.length} unit(s), ${att.answers.length} decision(s), ${att.residualRisk.length} residual risk(s) accepted` : `Changes requested by @${who.login}`, att);
  return c.json(withLive(d, who));
});

/** Post the status (and, with an attestation, the comment) to the pull request, as the signer when they signed in with their own GitHub token. */
async function post(d: Dossier, who: Person, state: 'pending' | 'success' | 'failure', description: string, att?: Attestation) {
  if (!PUBLISHES) return;
  try {
    const statusUrl = await setStatus(d.pr, state, description, `${publicUrl()}/pr/${d.slug}`, who.token);
    if (att) {
      const commentUrl = await upsertComment(d.pr, attestationMarkdown(d, att), '<!-- countersign-attestation -->', who.token);
      att.github = { statusUrl, commentUrl };
      store(d);
    }
  } catch (e) {
    console.error('github post failed', e);
  }
}

function attestationMarkdown(d: Dossier, a: Attestation) {
  const li = (xs: string[], max = 12) => (xs.length ? xs.slice(0, max).map((x) => `- ${x.replace(/\n/g, ' ')}`).join('\n') + (xs.length > max ? `\n- … and ${xs.length - max} more (see dossier)` : '') : '- none');
  const who = a.cosign ? `@${a.signer} and @${a.cosign.signer}` : `@${a.signer}`;
  return `## ${a.decision === 'accepted' ? '✍️ Countersigned' : '⛔ Changes requested'} by ${who}

**${d.requirement.id}** · head \`${a.headSha.slice(0, 8)}\` · ${dur(a.reviewSeconds)} of review clocked by the server${a.rushed ? ' (faster than the floor for this reading plan: it does not count toward trust)' : ''} · I am accountable for this change.
${a.override ? `\n**Accepted over confirmed problems**\n${li(a.override.items)}\n\nReason, in the signer's words: ${a.override.reason.replace(/\n/g, ' ')}\n` : ''}
**What I decided**
${li(a.answers.map((x) => `${d.refusals.find((r) => r.id === x.refusalId)?.question} → **${x.label}**${x.note ? ` — ${x.note}` : ''}`))}

**Checked by me**
${li(a.checkedByHuman)}

**Checked by the AI reviewer (evidence in the dossier)**
${li(a.checkedByAI)}

**Not checked**
${li(a.notChecked)}

**Residual risk I accept**
${li(a.residualRisk)}

<sub>Attestation \`${a.hash.slice(0, 16)}\` chained to \`${a.prevHash.slice(0, 16)}\` in the trust ledger · [dossier](${publicUrl()}/pr/${d.slug})</sub>`;
}

registerLive(app, load);

/** The checks on the reviewer, added up over every finished real review on this server. */
function reviewerCheck(): ReviewerCheck {
  const ds = readdirSync(DOSSIERS)
    .map((s) => load(s))
    .filter((d): d is Dossier => !!d && d.status !== 'running' && d.status !== 'failed');
  const canaries = ds.flatMap((d) => d.selfTest?.canaries ?? []);
  const kinds = [...new Set(canaries.map((k) => k.kind ?? 'single-line'))];
  const killedBy: Record<string, number> = {};
  for (const d of ds) for (const x of d.discarded) killedBy[x.reason] = (killedBy[x.reason] ?? 0) + 1;
  const audits = ds.map((d) => d.audit).filter((a): a is NonNullable<Dossier['audit']> => !!a);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  return {
    reviews: ds.length,
    selfTested: ds.filter((d) => (d.selfTest?.planted ?? 0) > 0).length,
    planted: canaries.length,
    caughtByReviewer: canaries.filter((k) => k.caughtByReviewer).length,
    caughtByTests: canaries.filter((k) => k.caughtByTests).length,
    caughtByNeither: canaries.filter((k) => !k.caughtByReviewer && !k.caughtByTests).length,
    byKind: kinds.map((kind) => ({ kind, planted: canaries.filter((k) => (k.kind ?? 'single-line') === kind).length, caught: canaries.filter((k) => (k.kind ?? 'single-line') === kind && k.caughtByReviewer).length })),
    planter: ds.find((d) => (d.selfTest?.planted ?? 0) > 0 && d.selfTest?.planterModel)?.selfTest?.planterModel,
    raised: sum(ds.map((d) => d.findings.length + d.discarded.length)),
    killed: sum(ds.map((d) => d.discarded.length)),
    killedBy,
    shown: sum(ds.map((d) => d.findings.length)),
    executed: sum(ds.map((d) => d.findings.filter((f) => f.strength === 'executed').length)),
    audited: audits.length,
    auditLines: sum(audits.map((a) => a.linesAudited)),
    auditIssues: sum(audits.map((a) => a.issues.length)),
    auditModel: audits[0]?.model,
    auditAgrees: sum(audits.map((a) => a.findings.filter((f) => f.verdict === 'agrees').length)),
    auditDisputes: sum(audits.map((a) => a.findings.filter((f) => f.verdict === 'disputes').length)),
  };
}

function ledgerView() {
  const v = view();
  return { ...v, real: { ...v.real, reviewer: reviewerCheck() } };
}

app.get('/api/ledger', (c) => c.json(ledgerView()));

app.post('/api/ledger/escape', async (c) => {
  const { slug, kind, note } = await c.req.json<{ slug: string; kind: 'revert' | 'incident'; note: string }>();
  const d = load(slug);
  if (!d) return c.json({ error: 'not found' }, 404);
  const who = (await person(c)).login;
  append({ type: 'escape', pr: d.id, actor: who, summary: `${kind} traced to ${d.id}${note ? `: ${note}` : ''}`, data: { areas: codeAreas(d), kind, note, signer: d.signoff?.signer } });
  return c.json(ledgerView());
});

/**
 * Escapes read from the repository, not reported by hand: a commit on the base branch that reverts a countersigned,
 * merged pull request is written to the ledger as an escape (once per commit), and the area is demoted by the usual rule.
 */
async function scanEscapes(): Promise<{ checked: number; found: number }> {
  const known = new Set(readEvents().filter((e) => e.type === 'escape' && e.data?.commit).map((e) => String(e.data!.commit)));
  let checked = 0;
  let found = 0;
  for (const slug of readdirSync(DOSSIERS)) {
    const d = load(slug);
    if (!d?.signoff || d.signoff.decision !== 'accepted') continue;
    checked++;
    try {
      for (const r of await findReverts(d)) {
        if (known.has(r.sha)) continue;
        known.add(r.sha);
        found++;
        append({ type: 'escape', pr: d.id, actor: 'github', summary: `revert traced to ${d.id}: commit ${r.sha.slice(0, 7)} on the base branch reverts it (“${r.subject}”)`, data: { areas: codeAreas(d), kind: 'revert', note: r.subject, signer: d.signoff.signer, commit: r.sha, source: 'github' } });
      }
    } catch {
      /* GitHub unreachable or the pull request is gone: nothing is recorded, the next scan tries again */
    }
  }
  return { checked, found };
}
app.post('/api/ledger/scan', async (c) => c.json({ ...(await scanEscapes()), ledger: ledgerView() }));
if (PUBLISHES) setInterval(() => void scanEscapes().catch(() => undefined), 10 * 60_000);

app.post('/api/ledger/spot-check', async (c) => {
  const { slug, missed, note } = await c.req.json<{ slug: string; missed: boolean; note: string }>();
  const d = load(slug);
  if (!d) return c.json({ error: 'not found' }, 404);
  const who = (await person(c)).login;
  append({ type: 'spot-check', pr: d.id, actor: who, summary: `${who} did a full read of ${d.id}: ${missed ? 'found something the AI missed' : 'agrees with the AI review'}${note ? ` — ${note}` : ''}`, data: { areas: codeAreas(d), missed, note } });
  return c.json(ledgerView());
});

app.get('/api/policy', (c) => c.json(ledgerPolicy()));

// static UI
const DIST = process.env.CS_DIST ? resolve(process.env.CS_DIST) : resolve(ROOT, 'web/dist');
const MIME: Record<string, string> = { html: 'text/html; charset=utf-8', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', json: 'application/json', png: 'image/png', woff2: 'font/woff2', woff: 'font/woff', ico: 'image/x-icon', ttf: 'font/ttf' };
app.get('*', (c) => {
  const rel = normalize(decodeURIComponent(c.req.path)).replace(/^\/+/, '');
  let p = resolve(DIST, rel);
  if (!p.startsWith(DIST) || !existsSync(p) || !statSync(p).isFile()) p = resolve(DIST, 'index.html');
  if (!existsSync(p)) return c.text('UI not built yet (cd web && bun run build)', 503);
  const ext = p.split('.').pop() ?? '';
  return new Response(Bun.file(p), { headers: { 'content-type': MIME[ext] ?? 'application/octet-stream', 'cache-control': ext === 'html' ? 'no-store' : 'public, max-age=3600' } });
});

const port = Number(process.env.PORT || 4317);
console.log(`countersign server on :${port}`);
export default { port, fetch: app.fetch, idleTimeout: 120 };
