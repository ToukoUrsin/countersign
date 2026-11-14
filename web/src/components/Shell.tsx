import { BookOpenText, CornerDownLeft, Inbox, Moon, Scale, Search, Sun } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useHotkeys, useMock, useTheme } from '../lib/hooks';
import { Reviewer } from './Reviewer';
import { cx, MOD } from '../lib/util';
import { Dialog, Kbd } from './ui';

// ───────────────────────────── commands ─────────────────────────────
export interface Command {
  id: string;
  title: string;
  group: string;
  hint?: string;
  kbd?: string;
  keywords?: string;
  run: () => void;
}
interface Shortcut {
  keys: string;
  what: string;
  group: string;
}
interface CmdCtx {
  register: (key: string, cmds: Command[], shortcuts: Shortcut[]) => () => void;
  openPalette: () => void;
}
const Ctx = createContext<CmdCtx | null>(null);

/** Pages register their commands (palette) and shortcuts (the ? sheet). */
export function useCommands(key: string, cmds: Command[], shortcuts: Shortcut[] = []) {
  const ctx = useContext(Ctx);
  const ref = useRef({ cmds, shortcuts });
  ref.current = { cmds, shortcuts };
  const sig = cmds.map((c) => c.id + c.title + (c.hint ?? '')).join('|') + shortcuts.length;
  useEffect(() => ctx?.register(key, ref.current.cmds, ref.current.shortcuts), [ctx, key, sig]);
}
export const useOpenPalette = () => useContext(Ctx)?.openPalette ?? (() => {});

const GLOBAL_SHORTCUTS: Shortcut[] = [
  { keys: `${MOD} K`, what: 'Command palette', group: 'Anywhere' },
  { keys: 'G I', what: 'Go to Inbox', group: 'Anywhere' },
  { keys: 'G L', what: 'Go to Trust ledger', group: 'Anywhere' },
  { keys: 'G C', what: 'Go to Concept', group: 'Anywhere' },
  { keys: 'T', what: 'Toggle light / dark', group: 'Anywhere' },
  { keys: '?', what: 'This list', group: 'Anywhere' },
  { keys: 'Esc', what: 'Close drawer, dialog or palette', group: 'Anywhere' },
];

function score(q: string, c: Command): number {
  if (!q) return 1;
  const hay = `${c.title} ${c.group} ${c.keywords ?? ''} ${c.hint ?? ''}`.toLowerCase();
  let s = 0;
  for (const w of q.toLowerCase().split(/\s+/).filter(Boolean)) {
    const i = hay.indexOf(w);
    if (i < 0) return 0;
    s += i === 0 || hay[i - 1] === ' ' ? 3 : 1;
    if (c.title.toLowerCase().startsWith(w)) s += 4;
  }
  return s;
}

function Palette({ open, onClose, commands }: { open: boolean; onClose: () => void; commands: Command[] }) {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) {
      setQ('');
      setI(0);
    }
  }, [open]);
  const shown = useMemo(() => {
    const scored = commands.map((c) => ({ c, s: score(q, c) })).filter((x) => x.s > 0);
    if (q) scored.sort((a, b) => b.s - a.s);
    return scored.map((x) => x.c);
  }, [commands, q]);
  useEffect(() => setI(0), [q]);
  useEffect(() => {
    list.current?.querySelector(`[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [i]);
  const run = (c?: Command) => {
    if (!c) return;
    onClose();
    setTimeout(c.run, 0);
  };
  let lastGroup = '';
  return (
    <Dialog open={open} onClose={onClose} width={580} top="12vh">
      <div className="flex items-center gap-2.5 border-b border-line px-3.5">
        <Search className="h-4 w-4 text-fg-3" />
        <input
          data-autofocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setI((x) => Math.min(shown.length - 1, x + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setI((x) => Math.max(0, x - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              run(shown[i]);
            }
          }}
          placeholder="Go to a PR, jump to a section, run an action…"
          aria-label="Command palette"
          className="h-11 flex-1 bg-transparent text-md outline-none placeholder:text-fg-3"
        />
        <Kbd>Esc</Kbd>
      </div>
      <div ref={list} className="max-h-[52vh] overflow-y-auto p-1.5">
        {shown.length === 0 && <div className="px-3 py-6 text-center text-sm text-fg-3">Nothing matches “{q}”.</div>}
        {shown.map((c, idx) => {
          const head = !q && c.group !== lastGroup;
          lastGroup = c.group;
          return (
            <div key={c.id}>
              {head && <div className="px-2.5 pt-2 pb-1 text-sm text-fg-3">{c.group}</div>}
              <button
                data-i={idx}
                onMouseMove={() => setI(idx)}
                onClick={() => run(c)}
                className={cx('flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-base', idx === i ? 'bg-surface-2 text-fg' : 'text-fg-2')}
              >
                <span className="min-w-0 truncate" title={c.title}>
                  {c.title}
                </span>
                {c.hint && <span className="num shrink-0 text-sm whitespace-nowrap text-fg-3">{c.hint}</span>}
                <span className="ml-auto flex shrink-0 items-center gap-1.5">
                  {q && <span className="text-xs text-fg-4">{c.group}</span>}
                  {c.kbd && <Kbd>{c.kbd}</Kbd>}
                  {idx === i && <CornerDownLeft className="h-3 w-3 text-fg-3" />}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}

function ShortcutSheet({ open, onClose, shortcuts }: { open: boolean; onClose: () => void; shortcuts: Shortcut[] }) {
  const groups = [...new Set(shortcuts.map((s) => s.group))];
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts" width={560}>
      <div className="grid max-h-[62vh] gap-x-8 gap-y-5 overflow-y-auto px-4 py-4 sm:grid-cols-2">
        {groups.map((g) => (
          <div key={g}>
            <div className="mb-1.5 text-sm text-fg-3">{g}</div>
            <dl className="space-y-1">
              {shortcuts
                .filter((s) => s.group === g)
                .map((s) => (
                  <div key={s.keys + s.what} className="flex items-center justify-between gap-3 text-sm">
                    <dt className="text-fg-2">{s.what}</dt>
                    <dd className="flex shrink-0 gap-1">
                      {s.keys.split(' ').map((k, i) => (
                        <Kbd key={i}>{k}</Kbd>
                      ))}
                    </dd>
                  </div>
                ))}
            </dl>
          </div>
        ))}
      </div>
    </Dialog>
  );
}

// ───────────────────────────── shell ─────────────────────────────
const NAV = [
  { to: '/', label: 'Inbox', Icon: Inbox, kbd: 'G I' },
  { to: '/ledger', label: 'Trust ledger', Icon: Scale, kbd: 'G L' },
  { to: '/concept', label: 'Concept', Icon: BookOpenText, kbd: 'G C' },
];

function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="h-6 w-6 shrink-0" aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--accent-strong)" />
      <path d="M8 17.5l4.2 4.2L19 13" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" opacity=".55" />
      <path d="M14 17.5l4.2 4.2L25 13" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const nav = useNavigate();
  const loc = useLocation();
  const mock = useMock();
  const [theme, toggleTheme] = useTheme();
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const [registry, setRegistry] = useState<Record<string, { cmds: Command[]; shortcuts: Shortcut[] }>>({});
  const [prs, setPrs] = useState<Command[]>([]);

  const register = useCallback((key: string, cmds: Command[], shortcuts: Shortcut[]) => {
    setRegistry((r) => ({ ...r, [key]: { cmds, shortcuts } }));
    return () =>
      setRegistry((r) => {
        const n = { ...r };
        delete n[key];
        return n;
      });
  }, []);
  const openPalette = useCallback(() => setPalette(true), []);
  const ctx = useMemo(() => ({ register, openPalette }), [register, openPalette]);

  useEffect(() => {
    if (!palette) return;
    api
      .dossiers()
      .then((ds) =>
        setPrs(
          ds.map((d) => ({
            id: `pr-${d.slug}`,
            title: d.title,
            hint: `${d.requirementId} · #${d.number}`,
            group: 'Pull requests',
            keywords: `${d.repo} ${d.author} ${d.tier}`,
            run: () => nav(`/pr/${d.slug}`),
          })),
        ),
      )
      .catch(() => {});
  }, [palette, nav]);

  const commands = useMemo<Command[]>(() => {
    const page = Object.values(registry).flatMap((r) => r.cmds);
    return [
      ...page,
      { id: 'go-inbox', title: 'Go to Inbox', group: 'Navigate', kbd: 'G I', run: () => nav('/') },
      { id: 'go-ledger', title: 'Go to Trust ledger', group: 'Navigate', kbd: 'G L', run: () => nav('/ledger') },
      { id: 'go-concept', title: 'Go to Concept', group: 'Navigate', kbd: 'G C', run: () => nav('/concept') },
      ...prs,
      { id: 'theme', title: `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`, group: 'Preferences', kbd: 'T', keywords: 'dark light mode appearance', run: toggleTheme },
      { id: 'help', title: 'Show keyboard shortcuts', group: 'Preferences', kbd: '?', run: () => setHelp(true) },
    ];
  }, [registry, prs, nav, theme, toggleTheme]);

  const shortcuts = useMemo(() => [...Object.values(registry).flatMap((r) => r.shortcuts), ...GLOBAL_SHORTCUTS], [registry]);

  useHotkeys(
    {
      'mod+k': () => setPalette((p) => !p),
      '?': () => setHelp(true),
      'g i': () => nav('/'),
      'g l': () => nav('/ledger'),
      'g c': () => nav('/concept'),
      t: toggleTheme,
    },
    { always: false },
  );
  useHotkeys({ 'mod+k': () => setPalette((p) => !p) }, { always: true, enabled: palette });

  const rail = loc.pathname.startsWith('/pr/');
  const ThemeIcon = theme === 'dark' ? Sun : Moon;

  return (
    <Ctx.Provider value={ctx}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-1.5">
        Skip to content
      </a>
      <div className="flex min-h-dvh">
        {!rail && (
        <nav
          aria-label="Main"
          className={cx(
            'sticky top-0 z-30 hidden h-dvh shrink-0 flex-col border-r border-line bg-panel py-3 md:flex',
            rail ? 'w-[52px] items-center px-0' : 'w-[52px] items-center lg:w-[212px] lg:items-stretch lg:px-2.5',
          )}
        >
          <NavLink to="/" className={cx('mb-4 flex items-center gap-2.5 rounded-md', !rail && 'lg:px-1.5')} aria-label="Countersign, go to Inbox">
            <Logo />
            <span className={cx('hidden text-md font-semibold tracking-[-0.01em]', !rail && 'lg:block')}>Countersign</span>
          </NavLink>
          <button
            onClick={openPalette}
            aria-label="Open command palette"
            title={`Search and commands (${MOD} K)`}
            className={cx(
              'mb-3 flex h-7 items-center gap-2 rounded-md border border-line text-sm text-fg-3 transition-colors hover:bg-surface hover:text-fg',
              rail ? 'w-7 justify-center' : 'w-7 justify-center lg:w-auto lg:justify-start lg:px-2',
            )}
          >
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className={cx('hidden flex-1 text-left', !rail && 'lg:block')}>Search</span>
            <span className={cx('hidden gap-1', !rail && 'lg:flex')}>
              <Kbd>{MOD}</Kbd>
              <Kbd>K</Kbd>
            </span>
          </button>
          <ul className="flex flex-col gap-0.5">
            {NAV.map((n) => (
              <li key={n.to}>
                <NavLink
                  to={n.to}
                  end={n.to === '/'}
                  title={`${n.label} (${n.kbd})`}
                  className={({ isActive }) => {
                    const on = isActive || (n.to === '/' && rail);
                    return cx(
                      'flex h-7 items-center gap-2.5 rounded-md text-base transition-colors',
                      rail ? 'w-7 justify-center' : 'w-7 justify-center lg:w-auto lg:justify-start lg:px-2',
                      on ? 'bg-surface-2 font-medium text-fg' : 'text-fg-2 hover:bg-surface hover:text-fg',
                    );
                  }}
                >
                  <n.Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                  <span className={cx('hidden', !rail && 'lg:block')}>{n.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
          <div className={cx('mt-auto flex flex-col gap-2', rail ? 'items-center' : 'items-center lg:items-stretch')}>
            {mock && (
              <span title="The API is unreachable or VITE_MOCK=1. Showing fixtures; nothing is sent to GitHub." className={cx('rounded-md border border-dashed border-line-strong px-2 py-1 text-center text-2xs text-fg-3', rail && 'px-1')}>
                {rail ? 'demo' : <span className="lg:hidden">demo</span>}
                {!rail && <span className="hidden lg:inline">Demo data · API offline</span>}
              </span>
            )}
            <button
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              title="Toggle theme (T)"
              className={cx('flex h-7 items-center gap-2.5 rounded-md text-base text-fg-2 transition-colors hover:bg-surface hover:text-fg', rail ? 'w-7 justify-center' : 'w-7 justify-center lg:w-auto lg:justify-start lg:px-2')}
            >
              <ThemeIcon className="h-4 w-4 shrink-0" strokeWidth={1.8} />
              <span className={cx('hidden', !rail && 'lg:block')}>{theme === 'dark' ? 'Light theme' : 'Dark theme'}</span>
            </button>
            <Reviewer up />
          </div>
        </nav>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          {!rail && (
          <>
          {/* phone top bar */}
          <header className="sticky top-0 z-30 flex h-11 items-center gap-1 border-b border-line bg-panel px-3 md:hidden">
            <NavLink to="/" className="mr-auto flex items-center gap-2" aria-label="Countersign, go to Inbox">
              <Logo />
              <span className="text-md font-semibold">Countersign</span>
            </NavLink>
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.to === '/'} aria-label={n.label} className={({ isActive }) => cx('flex h-8 w-8 items-center justify-center rounded-md', isActive ? 'bg-surface-2 text-fg' : 'text-fg-2')}>
                <n.Icon className="h-4 w-4" />
              </NavLink>
            ))}
            <button onClick={toggleTheme} aria-label="Toggle theme" className="flex h-8 w-8 items-center justify-center rounded-md text-fg-2">
              <ThemeIcon className="h-4 w-4" />
            </button>
            <Reviewer compact />
          </header>
          </>
          )}
          <main id="main" className="min-w-0 flex-1">
            {children}
          </main>
        </div>
      </div>
      <Palette open={palette} onClose={() => setPalette(false)} commands={commands} />
      <ShortcutSheet open={help} onClose={() => setHelp(false)} shortcuts={shortcuts} />
    </Ctx.Provider>
  );
}

export function PageHeader({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-5 py-2.5 max-md:px-4">
      <h1 className="text-md font-semibold">{title}</h1>
      {sub && <span className="text-sm text-fg-3">{sub}</span>}
      {children && <div className="ml-auto flex items-center gap-2 max-md:ml-0 max-md:w-full max-md:pt-1.5">{children}</div>}
    </div>
  );
}
