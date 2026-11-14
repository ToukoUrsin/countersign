/** Who is reviewing: the name every read mark, judgement and signature is recorded under. The server decides it; this only shows it and lets you change it. */
import { Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useMe } from '../lib/hooks';
import { cx } from '../lib/util';
import { Avatar, Button } from './ui';

const KIND = {
  github: 'Signed in with a GitHub token',
  server: "This server's GitHub account",
  demo: 'Synthetic reviewer on a demo copy',
} as const;

export function Reviewer({ compact, up }: { /** avatar only below lg */ compact?: boolean; /** open upwards (bottom of the sidebar) */ up?: boolean }) {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState<string>();
  const [err, setErr] = useState<string>();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const out = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', out);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', out);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  if (!me) return null;
  const kind = me.kind ?? 'server';
  // identity changes what the server records, so everything on screen is reloaded under the new name
  const run = async (id: string, f: () => Promise<unknown>) => {
    setBusy(id);
    setErr(undefined);
    try {
      await f();
      location.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'That did not work.');
      setBusy(undefined);
    }
  };
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`Reviewing as ${me.name || me.login} (@${me.login})`}
        className={cx('flex h-7 max-w-full items-center gap-2 rounded-md text-sm text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg', compact ? 'px-1 lg:pr-2' : 'w-7 justify-center lg:w-full lg:justify-start lg:px-1.5', open && 'bg-surface-2 text-fg')}
      >
        <Avatar src={me.avatarUrl} name={me.name || me.login} size={20} />
        <span className={cx('min-w-0 truncate', compact ? 'max-lg:hidden' : 'hidden lg:block')}>{me.name || `@${me.login}`}</span>
      </button>
      {open && (
        <div role="dialog" aria-label="Reviewer" className={cx('absolute z-40 w-[272px] rounded-lg border border-line-strong bg-panel p-3 shadow-lg', up ? 'bottom-full left-0 mb-1.5' : 'top-full right-0 mt-1.5')}>
          <div className="flex items-center gap-2.5">
            <Avatar src={me.avatarUrl} name={me.name || me.login} size={28} />
            <div className="min-w-0">
              <div className="truncate text-base font-medium text-fg">{me.name || me.login}</div>
              <div className="truncate text-sm text-fg-3">@{me.login}</div>
            </div>
          </div>
          <p className="mt-2.5 text-sm text-fg-3">{KIND[kind]}. What you read, judge and sign is recorded by the server under this name.</p>
          {me.demo && me.people ? (
            <>
              <div className="mt-3 mb-1 text-sm text-fg-3">Review as</div>
              {me.people.map((p) => (
                <button
                  key={p.login}
                  type="button"
                  disabled={!!busy}
                  onClick={() => (p.login === me.login ? setOpen(false) : void run(p.login, () => api.signIn({ login: p.login })))}
                  className="flex h-8 w-full items-center gap-2.5 rounded-md px-1.5 text-left text-base text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg"
                >
                  <Avatar name={p.name} size={18} />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {p.login === me.login && <Check className="h-3.5 w-3.5 text-fg-3" />}
                </button>
              ))}
              <p className="mt-2 text-sm text-fg-4">Three people, so a second signer can be tried. Nothing here posts to GitHub.</p>
            </>
          ) : (
            <form
              className="mt-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (token.trim()) void run('token', () => api.signIn({ token: token.trim() }));
              }}
            >
              <label className="text-sm text-fg-3" htmlFor="gh-token">
                Sign as yourself
              </label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  id="gh-token"
                  type="password"
                  autoComplete="off"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="GitHub token"
                  className="h-7 min-w-0 flex-1 rounded-md border border-line bg-transparent px-2 text-sm outline-none placeholder:text-fg-4 focus:border-line-strong"
                />
                <Button type="submit" loading={busy === 'token'} disabled={!token.trim()}>
                  Sign in
                </Button>
              </div>
              <p className="mt-2 text-sm text-fg-4">Checked against GitHub. The check on the pull request is then posted with your account.</p>
              {kind === 'github' && (
                <Button variant="ghost" className="mt-2" loading={busy === 'out'} onClick={() => void run('out', () => api.signOut())}>
                  Sign out
                </Button>
              )}
            </form>
          )}
          {err && (
            <p role="alert" className="mt-2 text-sm text-red">
              {err}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
