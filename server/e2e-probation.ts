#!/usr/bin/env bun
/**
 * End-to-end check of the probation path on a throwaway copy (CS_DEMO_SIGNERS=1, CS_NO_PUBLISH=1):
 *   bun server/e2e-probation.ts http://localhost:4318 [pr number=5]
 * An escape puts the area on probation. Then: the reading plan is void, a unit cannot be marked read before
 * its floor, the first signature does not accept the change, the same person cannot give the second one,
 * a second person cannot co-sign without their own read, and after their read the change is countersigned by two.
 * It signs the chosen pull request on that copy; reset the copy afterwards (work/judge-instance.sh <port>).
 */
import type { Dossier } from '../shared/dossier';

const base = (process.argv[2] ?? '').replace(/\/$/, '');
const prNo = process.argv[3] ?? '5';
if (!base) throw new Error('usage: bun server/e2e-probation.ts <base url> [pr number]');

let failed = 0;
const check = (ok: boolean, what: string, got?: unknown) => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok || got === undefined ? '' : ` · got ${JSON.stringify(got).slice(0, 240)}`}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Client {
  cookie = '';
  constructor(public login: string) {}
  async call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(this.cookie ? { cookie: this.cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = r.headers.getSetCookie?.() ?? [];
    if (set.length) this.cookie = set.map((s) => s.split(';')[0]).join('; ');
    return { status: r.status, json: await r.json().catch(() => ({})) };
  }
  async signIn() {
    const r = await this.call('POST', '/api/session', { login: this.login });
    if (r.status !== 200) throw new Error(`cannot sign in as ${this.login}: ${JSON.stringify(r.json)}`);
  }
  /** keep a unit open with heartbeats until the server takes the read mark; returns the seconds it took */
  async read(slug: string, unitId: string): Promise<number> {
    const t0 = Date.now();
    for (;;) {
      const r = await this.call('POST', `/api/dossiers/${slug}/read`, { unitId, read: true });
      if (r.status === 200) return (Date.now() - t0) / 1000;
      if (r.status !== 425) throw new Error(`read ${unitId}: ${r.status} ${JSON.stringify(r.json)}`);
      await sleep(Math.min(5000, (r.json.waitSeconds ?? 1) * 1000 + 200));
      await this.call('POST', `/api/dossiers/${slug}/presence`, { unitId });
    }
  }
}

const me = await (await fetch(`${base}/api/me`)).json();
const people: { login: string; name: string }[] = me.people ?? [];
if (!me.demo || people.length < 2) throw new Error('this copy has no synthetic reviewers (start it with CS_DEMO_SIGNERS=1)');
if (me.publishes) throw new Error('this copy posts to GitHub; run the check on a throwaway copy only');
const [a, b] = [new Client(people[0].login), new Client(people[1].login)];
await a.signIn();
await b.signIn();

const list: { slug: string; number?: number; pr?: { number: number } }[] = (await a.call('GET', '/api/dossiers')).json;
const slug = list.map((x) => x.slug).find((s) => s.endsWith(`__${prNo}`));
if (!slug) throw new Error(`no dossier for pull request ${prNo}`);
let d: Dossier = (await a.call('GET', `/api/dossiers/${slug}`)).json;
check(d.status === 'ready' && !d.signoff, `${d.id} is ready and unsigned`, { status: d.status, signed: !!d.signoff });
check((d.live?.probation.length ?? 0) === 0, 'no area on probation before the escape', d.live?.probation);
const planned = d.units.filter((u) => u.ask !== 'none').length;

// 1. an escape in the same area: trust is lost at once
const esc = await a.call('POST', '/api/ledger/escape', { slug, kind: 'revert', note: 'e2e check: a revert traced to this area' });
check(esc.status === 200, 'escape recorded on the ledger', esc.json);
d = (await a.call('GET', `/api/dossiers/${slug}`)).json;
check((d.live?.probation.length ?? 0) > 0, `area on probation after one escape: ${d.live?.probation.join(', ')}`, d.live);

// 2. the plan is void: every unit is required
const st0 = await a.call('POST', `/api/dossiers/${slug}/statement`, {});
check(st0.json.needsCosign === true, 'the statement says a second signer is needed', st0.json.needsCosign);
check(/not marked/.test((st0.json.reasons ?? []).join(' ')), `gate lists unread units (plan asked for ${planned} of ${d.units.length}, probation asks for all)`, st0.json.reasons);

// 3. a read mark before the floor is refused
const early = await a.call('POST', `/api/dossiers/${slug}/read`, { unitId: d.units[0].id, read: true });
check(early.status === 425 && early.json.waitSeconds > 0, `read mark on ${d.units[0].id} refused before its floor (HTTP 425, ${early.json.waitSeconds} s to go)`, early);

// findings judged and blocking decisions answered, as the gate requires
for (const f of d.findings) await a.call('POST', `/api/dossiers/${slug}/feedback`, { findingId: f.id, verdict: 'rejected', note: 'e2e check' });
for (const r of d.refusals.filter((x) => x.blocking)) await a.call('POST', `/api/dossiers/${slug}/answers`, { refusalId: r.id, optionId: (r.options.find((o) => o.implemented !== false) ?? r.options[0]).id });

// 4. first person reads everything and signs: not accepted yet
let secs = 0;
for (const u of d.units) secs += await a.read(slug, u.id);
check(true, `${a.login} read all ${d.units.length} units in ${Math.round(secs)} s of server-clocked time`);
const s1 = await a.call('POST', `/api/dossiers/${slug}/signoff`, { decision: 'accepted', residualRisk: ['e2e check'] });
d = (await a.call('GET', `/api/dossiers/${slug}`)).json;
check(s1.status === 200 && !d.signoff && d.firstSign?.signer === a.login, 'first signature recorded, change not accepted yet', { status: s1.status, err: s1.json.error, signoff: !!d.signoff, first: d.firstSign?.signer });

// 5. the same person cannot give the second signature
const again = await a.call('POST', `/api/dossiers/${slug}/signoff`, { decision: 'accepted' });
check(again.status === 400 && /first signature/.test(again.json.error ?? ''), 'the first signer is refused as co-signer', again);

// 6. a second person cannot co-sign without their own read
const lazy = await b.call('POST', `/api/dossiers/${slug}/signoff`, { decision: 'accepted' });
check(lazy.status === 400 && /not marked/.test(lazy.json.error ?? ''), 'a second person who read nothing is refused', lazy);

// 7. after their own read, the co-signature completes the sign-off
for (const u of d.units) await b.read(slug, u.id);
const s2 = await b.call('POST', `/api/dossiers/${slug}/signoff`, { decision: 'accepted' });
d = (await b.call('GET', `/api/dossiers/${slug}`)).json;
check(s2.status === 200 && d.signoff?.signer === a.login && d.signoff?.cosign?.signer === b.login, `countersigned by ${a.login} and ${b.login}`, { status: s2.status, err: s2.json.error, signer: d.signoff?.signer, cosign: d.signoff?.cosign?.signer });

// 8. nothing changes under a signature
const late = await b.call('POST', `/api/dossiers/${slug}/read`, { unitId: d.units[0].id, read: false });
check(late.status === 409, 'read marks are locked after the signature (HTTP 409)', late);

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
