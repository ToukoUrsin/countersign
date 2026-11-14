/**
 * Who is acting. A signature must belong to a person, so every write is attributed to one of:
 *  - a GitHub user who signed in with their own token (the sign-off is then posted to GitHub by their account),
 *  - the server's own GitHub account (a single-owner install: whoever runs the server is the signer),
 *  - a synthetic reviewer on a demo copy (CS_DEMO_SIGNERS=1), so two different people can be shown signing.
 */
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { randomBytes } from 'node:crypto';
import { whoami } from '../pipeline/lib/gh';

export interface Person {
  login: string;
  name: string;
  avatarUrl: string;
  kind: 'github' | 'server' | 'demo';
  /** GitHub token of a signed-in user; kept in memory only, never written to disk or returned */
  token?: string;
}

const DEMO: Person[] = [
  { login: 'aino.laine', name: 'Aino Laine', avatarUrl: '', kind: 'demo' },
  { login: 'mikael.berg', name: 'Mikael Berg', avatarUrl: '', kind: 'demo' },
  { login: 'sara.niemi', name: 'Sara Niemi', avatarUrl: '', kind: 'demo' },
];
export const demoMode = () => process.env.CS_DEMO_SIGNERS === '1';
export const demoPeople = () => (demoMode() ? DEMO.map(({ login, name }) => ({ login, name })) : []);

const sessions = new Map<string, Person>();
let server: Person | null = null;
async function serverAccount(): Promise<Person> {
  if (!server) server = { ...(await whoami()), kind: 'server' };
  return server;
}

export async function person(c: Context): Promise<Person> {
  const sid = getCookie(c, 'cs_sid');
  const p = sid ? sessions.get(sid) : undefined;
  if (p) return p;
  return demoMode() ? DEMO[0] : serverAccount();
}

const open = (c: Context, p: Person) => {
  const sid = randomBytes(24).toString('hex');
  sessions.set(sid, p);
  setCookie(c, 'cs_sid', sid, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 7 * 86400 });
  return p;
};

/** Sign in as a demo reviewer (demo copies only) or with a GitHub token, which GitHub itself resolves to a user. */
export async function signIn(c: Context, body: { login?: string; token?: string }): Promise<Person> {
  if (body.token) {
    const r = await fetch('https://api.github.com/user', { headers: { authorization: `Bearer ${body.token}`, accept: 'application/vnd.github+json', 'user-agent': 'countersign' } });
    if (!r.ok) throw new Error('GitHub did not accept that token.');
    const j = (await r.json()) as { login: string; name?: string; avatar_url?: string };
    return open(c, { login: j.login, name: j.name || j.login, avatarUrl: j.avatar_url ?? '', kind: 'github', token: body.token });
  }
  const p = demoMode() ? DEMO.find((x) => x.login === body.login) : undefined;
  if (!p) throw new Error('Unknown reviewer.');
  return open(c, p);
}

export function signOut(c: Context) {
  const sid = getCookie(c, 'cs_sid');
  if (sid) sessions.delete(sid);
  deleteCookie(c, 'cs_sid', { path: '/' });
}

export const publicPerson = (p: Person) => ({ login: p.login, name: p.name, avatarUrl: p.avatarUrl, kind: p.kind });
