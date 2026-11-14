import { ArrowDownUp, ChevronRight, Eye, FileSearch, Link2, MessageSquareText, ShieldAlert, ShieldCheck, Signature, Undo2 } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { AreaTrust, Backtest, BacktestRow, DossierSummary, LedgerEvent, LedgerEventType, LedgerView, RealLedger, RealSignoff, ReviewerCheck } from '../../../shared/dossier';
import { api } from '../api';
import { ReviewVsEscapes, RoutingMix, TrustPips } from '../components/Charts';
import { PageHeader, useCommands } from '../components/Shell';
import { Button, Dialog, ErrorNote, SyntheticTag, Tag } from '../components/ui';
import { useHotkeys, useQuery } from '../lib/hooks';
import { cx, fmtDate, fmtDateTime, pct, plural, scrollToId, wilson } from '../lib/util';

const TRUST = ['Probation', 'Supervised', 'Trusted', 'Proven'];

const EVENT: Record<LedgerEventType, { label: string; Icon: typeof Eye; tone: string }> = {
  review: { label: 'Review', Icon: FileSearch, tone: 'text-fg-3' },
  signoff: { label: 'Sign-off', Icon: Signature, tone: 'text-accent' },
  'finding-feedback': { label: 'Finding feedback', Icon: MessageSquareText, tone: 'text-fg-3' },
  'spot-check': { label: 'Spot-check', Icon: Eye, tone: 'text-blue' },
  escape: { label: 'Escape', Icon: Undo2, tone: 'text-red' },
  'trust-change': { label: 'Trust change', Icon: ArrowDownUp, tone: 'text-amber' },
};

/* ───────────── stat tiles ───────────── */
function Stat({ label, value, unit, note }: { label: string; value: string; unit?: string; note: ReactNode }) {
  return (
    <div className="bg-surface px-4 py-3.5">
      <div className="text-xs text-fg-3">{label}</div>
      <div className="num mt-1 text-2xl font-semibold tracking-[-0.02em]">
        {value}
        {unit && <span className="ml-1 text-md font-medium text-fg-3">{unit}</span>}
      </div>
      <div className="mt-0.5 text-xs text-fg-3">{note}</div>
    </div>
  );
}

function Card({ title, sub, aside, children, className }: { title: string; sub?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('min-w-0 rounded-lg border border-line bg-surface p-4', className)}>
      <div className="mb-3 flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <h2 className="text-md font-semibold">{title}</h2>
          {sub && <p className="mt-0.5 text-sm text-fg-3">{sub}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/* ───────────── areas ───────────── */
function AreaRows({ a, open, onToggle, flash }: { a: AreaTrust; open: boolean; onToggle: () => void; flash: boolean }) {
  const judged = a.findingsAccepted + a.findingsRejected;
  const next = a.nextLevelAt;
  return (
    <Fragment>
      <tr id={`area-${a.area}`} className={cx('border-t border-line transition-colors duration-700', flash && 'bg-amber/10')}>
        <td className="py-2.5 pr-3 pl-4">
          <button type="button" onClick={onToggle} aria-expanded={open} className="flex items-start gap-2 text-left">
            <ChevronRight className={cx('mt-[3px] h-3.5 w-3.5 shrink-0 text-fg-3 transition-transform', open && 'rotate-90')} />
            <span className="min-w-0">
              <span className="block text-base font-medium text-fg">{a.area}</span>
              <span className="mono block max-w-[260px] truncate text-2xs text-fg-3" title={a.paths.join('\n')}>
                {a.paths.join('  ')}
              </span>
            </span>
          </button>
        </td>
        <td className="px-3 py-2.5">
          <span className="flex items-center gap-2 whitespace-nowrap">
            <TrustPips level={a.level} />
            <span className="text-base text-fg">{a.label}</span>
          </span>
        </td>
        <td className="px-3 py-2.5">
          {next ? (
            <span className="block w-[132px]">
              <span className="num flex items-baseline justify-between text-xs text-fg-2">
                <span>
                  <b className="font-semibold text-fg">{a.cleanStreak}</b> of {next}
                </span>
                <span className="text-fg-3">to {TRUST[a.level + 1] ?? 'next'}</span>
              </span>
              <span className="mt-1 block h-1 overflow-hidden rounded-full bg-surface-3">
                <span className="block h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${Math.min(100, (a.cleanStreak / next) * 100)}%` }} />
              </span>
            </span>
          ) : (
            <span className="num text-xs text-fg-2">
              <b className="font-semibold text-fg">{a.cleanStreak}</b> clean · top level
            </span>
          )}
        </td>
        <td className="num px-3 py-2.5 text-right text-base text-fg-2">{a.signoffs}</td>
        <td className={cx('num px-3 py-2.5 text-right text-base', a.escapes ? 'font-semibold text-red' : 'text-fg-3')}>{a.escapes}</td>
        <td className="num px-3 py-2.5 text-right text-base text-fg-2">
          <span className={a.spotCheckMisses ? 'font-semibold text-amber' : 'text-fg-3'}>{a.spotCheckMisses}</span>
          <span className="text-fg-3"> of {a.spotChecks}</span>
        </td>
        <td className="num px-3 py-2.5 text-right text-base text-fg-2" title={`${a.findingsAccepted} marked real, ${a.findingsRejected} marked not real`}>
          {judged ? pct(a.findingsAccepted / judged) : '–'}
        </td>
        <td className="py-2.5 pr-4 pl-3 text-sm text-fg-2 max-xl:hidden">{a.effect}</td>
      </tr>
      {open && (
        <tr className="bg-bg/60">
          <td colSpan={8} className="px-4 pt-1 pb-4 pl-[38px]">
            <p className="mb-2.5 max-w-[80ch] text-sm text-fg-2 xl:hidden">{a.effect}</p>
            <div className="mb-1.5 text-sm text-fg-3">Level history</div>
            {a.history.length === 0 && <p className="text-sm text-fg-3">No level changes yet. This area has stayed at {a.label} since it was first tracked.</p>}
            <ol className="space-y-1.5">
              {[...a.history].reverse().map((h, i, arr) => {
                const before = arr[i + 1]?.level;
                const down = before !== undefined && h.level < before;
                return (
                  <li key={h.at + h.reason} className="grid grid-cols-[64px_52px_96px_minmax(0,1fr)] items-baseline gap-x-3 text-sm">
                    <span className="num text-xs text-fg-3">{fmtDate(h.at)}</span>
                    <TrustPips level={h.level} className="self-center" />
                    <span className={cx('font-medium', down ? 'text-red' : 'text-fg')}>{TRUST[h.level] ?? `Level ${h.level}`}</span>
                    <span className="text-fg-2">{h.reason}</span>
                  </li>
                );
              })}
            </ol>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

/* ───────────── record dialogs ───────────── */
type Mode = 'escape' | 'spot-check';

function RecordDialog({ mode, signed, initial, onClose, onDone }: { mode: Mode; signed: DossierSummary[] | undefined; initial?: string; onClose: () => void; onDone: (next: LedgerView, slug: string) => void }) {
  const [slug, setSlug] = useState(initial && signed?.some((s) => s.slug === initial) ? initial : signed?.[0]?.slug);
  const [kind, setKind] = useState<'revert' | 'incident'>('revert');
  const [missed, setMissed] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!slug && signed?.length) setSlug(initial && signed.some((s) => s.slug === initial) ? initial : signed[0].slug);
  }, [signed, slug, initial]);

  const submit = async () => {
    if (!slug) return;
    setBusy(true);
    setError(undefined);
    try {
      const next = mode === 'escape' ? await api.escape({ slug, kind, note: note.trim() }) : await api.spotCheck({ slug, missed, note: note.trim() });
      onDone(next, slug);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  const seg = (on: boolean) => cx('h-8 flex-1 rounded-md border px-2.5 text-sm font-medium transition-colors', on ? 'border-accent bg-accent/12 text-fg' : 'border-line-strong text-fg-2 hover:bg-surface-2');

  return (
    <Dialog open onClose={onClose} title={mode === 'escape' ? 'Report an escape' : 'Record a spot-check'} width={520}>
      <form
        className="space-y-4 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="text-sm text-fg-2">
          {mode === 'escape'
            ? 'A revert or an incident traced back to a countersigned pull request. It drops the area by the number of trust levels the policy sets (two by default) and resets its clean streak. On Probation, every change there is read in full and needs a second signer.'
            : 'A full human read of a sampled pull request. If it found something the AI missed, the area drops one trust level.'}
        </p>
        <fieldset>
          <legend className="mb-1.5 text-sm text-fg-3">Countersigned pull request</legend>
          {!signed ? (
            <div className="skeleton h-9" />
          ) : signed.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line-strong px-3 py-2.5 text-sm text-fg-2">Nothing is countersigned yet. Sign a pull request from the inbox, then record what happened to it here.</p>
          ) : (
            <div className="max-h-[188px] overflow-y-auto rounded-lg border border-line">
              {signed.map((s) => (
                <label key={s.slug} className={cx('flex cursor-pointer items-center gap-2.5 border-b border-line px-3 py-2 last:border-b-0', slug === s.slug ? 'bg-surface-2' : 'hover:bg-surface-2/60')}>
                  <input type="radio" name="pr" className="accent-(--accent)" checked={slug === s.slug} onChange={() => setSlug(s.slug)} />
                  <span className="num w-6 shrink-0 text-sm text-fg-3">{s.tier}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base text-fg">{s.title}</span>
                    <span className="mono block truncate text-2xs text-fg-3">
                      {s.repo}#{s.number}
                      {s.signer ? ` · signed by @${s.signer}` : ''}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </fieldset>
        {mode === 'escape' ? (
          <fieldset>
            <legend className="mb-1.5 text-sm text-fg-3">What happened</legend>
            <div className="flex gap-2">
              <button type="button" aria-pressed={kind === 'revert'} className={seg(kind === 'revert')} onClick={() => setKind('revert')}>
                Reverted
              </button>
              <button type="button" aria-pressed={kind === 'incident'} className={seg(kind === 'incident')} onClick={() => setKind('incident')}>
                Caused an incident
              </button>
            </div>
          </fieldset>
        ) : (
          <fieldset>
            <legend className="mb-1.5 text-sm text-fg-3">Result of the full read</legend>
            <div className="flex gap-2">
              <button type="button" aria-pressed={!missed} className={seg(!missed)} onClick={() => setMissed(false)}>
                Nothing the AI missed
              </button>
              <button type="button" aria-pressed={missed} className={seg(missed)} onClick={() => setMissed(true)}>
                Found a miss
              </button>
            </div>
          </fieldset>
        )}
        <label className="block">
          <span className="mb-1.5 block text-sm text-fg-3">Note</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder={mode === 'escape' ? 'What broke, and where it was seen' : missed ? 'What the full read found' : 'Optional'}
            className="w-full resize-none rounded-md border border-line bg-bg px-2.5 py-2 text-base outline-none placeholder:text-fg-3 focus:border-accent"
          />
        </label>
        {error && (
          <p role="alert" className="rounded-lg border border-red/35 bg-red/8 px-3 py-2 text-sm">
            Could not record it: {error}. Nothing was written to the ledger.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!slug}>
            {mode === 'escape' ? 'Report escape' : 'Record spot-check'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/* ───────────── policy: any JSON → readable rules ───────────── */
const pathLike = (k: string) => /[/*]|\.\w/.test(k);
const human = (k: string) => {
  if (pathLike(k)) return k;
  const s = k
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/\b(api|sdk|pr|ai)\b/g, (m) => m.toUpperCase());
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const scalar = (v: unknown) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
const scalars = (v: unknown): v is (string | number | boolean | null)[] => Array.isArray(v) && v.every(scalar);
const num = (n: number) => String(n).replace('-', '−');

/** One scalar, typed: tiers and booleans read as what they are, paths stay monospace, identifiers become words. */
function Scalar({ v }: { v: unknown }) {
  if (v === null || v === undefined) return <span className="text-fg-4">–</span>;
  if (typeof v === 'boolean') return <>{v ? 'Yes' : 'No'}</>;
  if (typeof v === 'number') return <span className="num">{num(v)}</span>;
  const s = String(v);
  if (/^T[0-3]$/.test(s)) return <span className="num">{s}</span>;
  if (pathLike(s) && !s.includes(' ')) return <span className="mono text-xs break-all">{s}</span>;
  if (/^[a-z]+(?:[A-Z][a-z0-9]+)+$/.test(s)) return <>{human(s)}</>;
  return <>{s}</>;
}

function Cell({ k, v }: { k: string; v: unknown }) {
  if (k === 'level' && typeof v === 'number' && v >= 0 && v <= 3) return <TrustPips level={v} />;
  if (scalar(v) || v === undefined) return <Scalar v={v} />;
  if (scalars(v))
    return (
      <span className="flex flex-wrap gap-x-2.5 gap-y-0.5">
        {v.map((x, i) => (
          <Scalar key={i} v={x} />
        ))}
      </span>
    );
  return <span className="mono text-2xs">{JSON.stringify(v)}</span>;
}

const TH = 'border-b border-line py-1.5 pr-3 text-xs font-medium whitespace-nowrap text-fg-3';
const TD = 'border-b border-line py-1.5 pr-3 align-top';

function PolicyValue({ v, k = '' }: { v: unknown; k?: string }) {
  if (scalar(v))
    return (
      <p className="max-w-[72ch] text-base text-fg-2">
        <Scalar v={v} />
      </p>
    );
  if (Array.isArray(v)) {
    if (v.length === 0) return <p className="text-sm text-fg-3">None.</p>;
    if (scalars(v)) {
      if (v.every((x) => typeof x === 'number' || (typeof x === 'string' && x.length < 28)))
        return (
          <p className="text-sm text-fg-2">
            <Cell k={k} v={v} />
          </p>
        );
      return (
        <ul className="space-y-1.5">
          {v.map((x, i) => (
            <li key={i} className="flex gap-2 text-base text-fg-2">
              <span className="mt-[8px] h-1 w-1 shrink-0 rounded-full bg-fg-4" />
              <span className="max-w-[72ch]">{String(x)}</span>
            </li>
          ))}
        </ul>
      );
    }
    if (v.every(isObj)) {
      const cols = [...new Set(v.flatMap((r) => Object.keys(r)))];
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr>
                {cols.map((c) => (
                  <th key={c} className={TH}>
                    {human(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {v.map((r, i) => (
                <tr key={i}>
                  {cols.map((c, j) => (
                    <td key={c} className={cx(TD, j === 0 ? 'font-medium whitespace-nowrap text-fg' : 'text-fg-2')}>
                      <Cell k={c} v={r[c]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    return (
      <div className="space-y-2">
        {v.map((x, i) => (
          <PolicyValue key={i} v={x} />
        ))}
      </div>
    );
  }
  if (isObj(v)) {
    const entries = Object.entries(v);
    // Arrays that run in parallel (one entry per level) read as one table, a row per position.
    const lists = entries.filter(([, x]) => scalars(x) && x.length >= 2) as [string, (string | number | boolean | null)[]][];
    const rowsN = Math.max(0, ...lists.map(([, x]) => x.length));
    const zip = lists.length >= 2 && lists.every(([, x]) => rowsN - x.length <= 1);
    const others = zip ? entries.filter(([key]) => !lists.some(([l]) => l === key)) : entries;
    const levels = zip && rowsN === 4 && /trust|level/i.test(k);
    // A long run of plain settings (the risk weights) reads faster as two ruled columns.
    const flat = others.filter(([, x]) => scalar(x));
    const dense = flat.length > 8;
    const rows = dense ? others.filter(([, x]) => !scalar(x)) : others;
    return (
      <div className="space-y-3">
        {zip && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr>
                  <th className={TH}>{levels ? 'Level' : '#'}</th>
                  {lists.map(([key]) => (
                    <th key={key} className={TH}>
                      {human(key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: rowsN }, (_, i) => (
                  <tr key={i}>
                    <td className={cx(TD, 'num text-fg-3')}>{levels ? <TrustPips level={i} className="mt-1" /> : i}</td>
                    {lists.map(([key, x], j) => (
                      <td key={key} className={cx(TD, j === 0 ? 'font-medium whitespace-nowrap text-fg' : 'text-fg-2')}>
                        <Scalar v={x[i]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {dense && (
          <dl className="gap-x-8 text-sm sm:columns-2">
            {flat.map(([key, x]) => (
              <div key={key} className="flex break-inside-avoid items-baseline gap-3 border-b border-line py-1">
                <dt className="min-w-0 flex-1 text-fg-3">{human(key)}</dt>
                <dd className="text-fg">
                  <Scalar v={x} />
                </dd>
              </div>
            ))}
          </dl>
        )}
        {rows.length > 0 && (
          <dl className="grid grid-cols-[minmax(90px,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
            {rows.map(([key, x]) => (
              <Fragment key={key}>
                <dt className={cx('text-fg-3', pathLike(key) && 'mono text-xs break-all')}>{human(key)}</dt>
                <dd className="min-w-0 text-fg-2">{scalar(x) ? <Scalar v={x} /> : <PolicyValue v={x} k={key} />}</dd>
              </Fragment>
            ))}
          </dl>
        )}
      </div>
    );
  }
  return null;
}

function PolicyPanel() {
  const { data, error, loading, reload } = useQuery(() => api.policy(), []);
  const top = isObj(data) ? data : undefined;
  const version = top && scalar(top.version) && top.version != null ? String(top.version) : undefined;
  const all = top ? Object.entries(top).filter(([k]) => k !== 'version') : [];
  // Only a sentence earns the lead paragraph; short settings sit together under "General".
  const isLead = (v: unknown) => typeof v === 'string' && v.length > 60 && v.includes(' ');
  const lead = all.filter(([, v]) => isLead(v));
  const general = all.filter(([, v]) => scalar(v) && !isLead(v));
  const rest = all.filter(([, v]) => !scalar(v));
  // The whole file is long; it stays one click away so the page reads as a ledger, not a config dump.
  const [open, setOpen] = useState(false);
  return (
    <Card
      title="Policy"
      sub="The rules that turn evidence into a risk tier, and sign-offs into trust. Versioned, and recorded with every routing decision."
      aside={version && <Tag className="mono">v{version}</Tag>}
    >
      {loading && !data && <div className="skeleton h-32" />}
      {error && <ErrorNote error={error} retry={reload} />}
      {data !== undefined && !top && (typeof data === 'string' ? <pre className="code overflow-x-auto whitespace-pre-wrap text-fg-2">{data}</pre> : <PolicyValue v={data} />)}
      {top && (
        <>
          {lead.map(([k, v]) => (
            <p key={k} className="mb-4 max-w-[86ch] border-l-2 border-accent pl-3 text-md text-fg">
              {String(v)}
            </p>
          ))}
          <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="focus-ring -ml-1 rounded px-1 text-base text-fg-2 hover:text-fg">
            {open ? 'Hide the policy file' : `Show the policy file: ${rest.map(([k]) => human(k).toLowerCase()).join(', ')}`}
          </button>
          <div className={cx('mt-4 gap-x-10 xl:columns-2', !open && 'hidden')}>
            {rest.map(([k, v]) => (
              <div key={k} className="mb-5 break-inside-avoid">
                <h3 className="mb-1.5 text-sm text-fg-3">{human(k)}</h3>
                <PolicyValue v={v} k={k} />
              </div>
            ))}
            {general.length > 0 && (
              <div className="mb-5 break-inside-avoid">
                <h3 className="mb-1.5 text-sm text-fg-3">General</h3>
                <PolicyValue v={Object.fromEntries(general)} />
              </div>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

/* ───────────── three kinds of numbers, never blended ───────────── */
function Section({ id, title, tag, sub, children }: { id?: string; title: string; tag?: ReactNode; sub: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-16 space-y-3 pt-3 first:pt-0">
      <div>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <h2 className="text-lg font-semibold tracking-[-0.01em]">{title}</h2>
          {tag}
        </div>
        <p className="mt-1 max-w-[84ch] text-sm text-fg-3">{sub}</p>
      </div>
      {children}
    </section>
  );
}

const SIGN_STATE: Record<RealSignoff['state'], { label: string; tone: string }> = {
  provisional: { label: 'Provisional', tone: 'text-amber' },
  clean: { label: 'Counts toward trust', tone: 'text-green' },
  escaped: { label: 'Escaped', tone: 'text-red' },
  rushed: { label: 'Rushed, never counts', tone: 'text-amber' },
  rejected: { label: 'Changes requested', tone: 'text-fg-2' },
};

const KILLED_BY: Record<string, string> = { duplicate: 'duplicates', 'repro-failed': 'not reproduced by a run', 'quote-not-found': 'cited code that is not there', 'out-of-scope': 'out of scope', 'contradicted-by-evidence': 'contradicted by a run' };

/** How the AI reviewer itself was tested on the real reviews: planted bugs, findings killed before a person saw them, the second model's audit. */
function ReviewerPanel({ v }: { v: ReviewerCheck }) {
  const killed = Object.entries(v.killedBy)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n} ${KILLED_BY[k] ?? k}`)
    .join(', ');
  const kinds = v.byKind.map((k) => `${k.caught} of ${k.planted} ${k.kind}`).join(' · ');
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 pt-3.5 pb-3">
        <h3 className="text-base font-semibold">The reviewer, tested</h3>
        <p className="text-sm text-fg-3">Before a person relies on a review, the review is checked by things it does not control. Added up over the {plural(v.reviews, 'real review')} above.</p>
      </div>
      <div className="grid grid-cols-2 gap-px border-t border-line bg-line md:grid-cols-4">
        <Stat
          label="Planted bugs the reviewer caught"
          value={v.planted ? `${v.caughtByReviewer} of ${v.planted}` : 'none planted'}
          note={v.planted ? `Planted by ${v.planter ?? 'another model'} in ${v.selfTested} of ${plural(v.reviews, 'review')}. With ${v.planted} bugs the true rate lies anywhere in ${wilson(v.caughtByReviewer, v.planted)}. ${kinds}` : 'No review on this server has a self-test yet.'}
        />
        <Stat
          label="Planted bugs nothing caught"
          value={v.planted ? `${v.caughtByNeither} of ${v.planted}` : '–'}
          note={v.planted ? `The pull request's own tests caught ${v.caughtByTests}. A bug neither the reviewer nor the tests notice adds risk points to its unit.` : 'Needs a self-test.'}
        />
        <Stat
          label="Findings killed before you saw them"
          value={`${v.killed} of ${v.raised}`}
          note={`${killed || 'none'}. Of the ${v.shown} shown, ${v.executed} come with a test that fails because of the bug.`}
        />
        <Stat
          label="Second model on skipped lines"
          value={v.audited ? plural(v.auditIssues, 'issue') : 'not run'}
          note={v.audited ? `${v.auditModel ?? 'A second model family'} read ${v.auditLines.toLocaleString('en-GB')} lines the plans let a person skip or skim. On the shown findings it agreed with ${v.auditAgrees} and disputed ${v.auditDisputes}.` : 'No audit on these reviews.'}
        />
      </div>
    </div>
  );
}

function RealPanel({ r, days, byId }: { r: RealLedger; days: number; byId: Map<string, DossierSummary> }) {
  const n = (k: RealSignoff['state']) => r.signoffs.filter((x) => x.state === k).length;
  return (
    <>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-4">
        <Stat label="Pull requests reviewed" value={String(r.reviews)} note="by the pipeline, on GitHub pull requests" />
        <Stat label="Lines to read" value={pct(r.readShare)} note={`${r.readLines.toLocaleString('en-GB')} of ${r.totalLines.toLocaleString('en-GB')} changed lines`} />
        <Stat label="Findings judged" value={`${r.findingsJudged} of ${r.findingsShown}`} note={r.findingsJudged ? `${r.findingsAccepted} marked real` : 'none judged yet'} />
        <Stat
          label="Signatures"
          value={String(r.signoffs.length)}
          note={r.signoffs.length ? `${n('clean')} count toward trust · ${n('provisional')} provisional · ${n('rushed')} rushed · ${plural(r.escapes, 'escape')}` : 'none given yet'}
        />
      </div>
      {r.reviewer && <ReviewerPanel v={r.reviewer} />}
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {r.signoffs.length === 0 ? (
          <p className="max-w-[84ch] px-4 py-3.5 text-base text-fg-2">
            No real signature yet, so there is no real escape rate to show. When one is given it appears here as provisional: it counts toward trust in its code area only after {days} days with no revert and no incident. A signature given faster than the floor for its change is kept on the record as rushed and never counts.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-base">
              <thead>
                <tr className="text-xs text-fg-3">
                  <th className="py-1.5 pr-3 pl-4 font-medium">Pull request</th>
                  <th className="px-3 py-1.5 font-medium">Signed by</th>
                  <th className="px-3 py-1.5 text-right font-medium whitespace-nowrap">Review time</th>
                  <th className="px-3 py-1.5 text-right font-medium whitespace-nowrap">Lines read</th>
                  <th className="py-1.5 pr-4 pl-3 font-medium">Counts toward trust?</th>
                </tr>
              </thead>
              <tbody>
                {r.signoffs.map((x) => {
                  const d = byId.get(x.pr);
                  const st = SIGN_STATE[x.state];
                  return (
                    <tr key={x.pr + x.at} className="border-t border-line align-top">
                      <td className="py-2 pr-3 pl-4">
                        {d ? (
                          <Link to={`/pr/${d.slug}`} className="text-fg hover:underline">
                            <span className="mono text-sm text-fg-3">#{d.number}</span> {d.title.replace(/\s*\(REQ-\d+\)\s*$/, '')}
                          </Link>
                        ) : (
                          <span className="mono text-sm">{x.pr}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-fg-2">
                        @{x.signer}
                        {x.cosigner && ` and @${x.cosigner}`}
                        <div className="num text-xs text-fg-3">{fmtDateTime(x.at)}</div>
                      </td>
                      <td className="num px-3 py-2 text-right whitespace-nowrap text-fg-2">{x.minutes < 1 ? 'under 1 min' : `${Math.round(x.minutes)} min`}</td>
                      <td className="num px-3 py-2 text-right whitespace-nowrap text-fg-2">
                        {x.readLines} of {x.totalLines}
                      </td>
                      <td className="py-2 pr-4 pl-3">
                        <span className={cx('font-medium', st.tone)}>{st.label}</span>
                        <div className="text-xs text-fg-3">
                          {x.state === 'provisional' && x.countsFrom
                            ? `Counts from ${fmtDate(x.countsFrom)} unless it is reverted or causes an incident`
                            : x.state === 'clean'
                              ? `${days} days passed with no revert and no incident`
                              : x.state === 'escaped'
                                ? 'Reverted or caused an incident: the area was demoted'
                                : x.state === 'rushed'
                                  ? 'Signed faster than the floor for this change'
                                  : 'No acceptance to count'}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

const OUTCOME: Record<BacktestRow['outcome'], { label: string; tone: string }> = {
  caught: { label: 'Caught as a finding', tone: 'text-green' },
  routed: { label: 'Put in front of a person', tone: 'text-green' },
  'full-read': { label: 'Whole change read', tone: 'text-fg-2' },
  skim: { label: 'Only skimmed', tone: 'text-amber' },
  missed: { label: 'Missed', tone: 'text-red' },
  clean: { label: 'Nothing raised', tone: 'text-fg-2' },
  failed: { label: 'Run failed', tone: 'text-fg-3' },
};

function BacktestPanel({ b }: { b: Backtest }) {
  const e = b.escaped;
  // full reads are a subset of the routed ones in some summaries: never count a change twice
  const seen = Math.min(e.prs, e.caught + Math.max(e.routed, e.fullRead));
  const person = Math.max(0, seen - e.caught);
  return (
    <>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-4">
        <Stat label="Merged PRs replayed" value={String(b.completed)} note={`of ${b.population.eligible} eligible, merged ${fmtDate(b.population.from)} ${b.population.from.slice(0, 4)} to ${fmtDate(b.population.to)} ${b.population.to.slice(0, 4)}${b.failed ? ` · ${b.failed} failed to run` : ''}`} />
        <Stat
          label="Later-fixed code seen"
          value={`${seen} of ${e.prs}`}
          note={e.prs ? `${e.caught} caught as a finding · ${person} put in front of a person${e.fullRead ? ` (${e.fullRead} by a full read)` : ''} · ${e.skim} skimmed · ${e.missed} missed. With ${e.prs} changes the true share lies anywhere in ${wilson(seen, e.prs)}` : 'no later-fixed change in the sample'}
        />
        <Stat label="Lines to read" value={pct(b.readFraction)} note={`${b.lines.read.toLocaleString('en-GB')} of ${b.lines.total.toLocaleString('en-GB')} changed lines`} />
        <Stat label="Findings on controls" value={b.controls.findingsPerPr.toFixed(1)} unit="per PR" note={`${b.controls.findingsShown} shown on ${plural(b.controls.prs, 'control')}: the cost in attention`} />
      </div>
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-left text-base">
            <thead>
              <tr className="text-xs text-fg-3">
                <th className="py-1.5 pr-3 pl-4 font-medium">Merged pull request</th>
                <th className="px-3 py-1.5 font-medium">What happened later</th>
                <th className="px-3 py-1.5 text-right font-medium whitespace-nowrap">Asked to read</th>
                <th className="px-3 py-1.5 text-right font-medium">Findings</th>
                <th className="py-1.5 pr-4 pl-3 font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {b.rows.map((x) => {
                const o = OUTCOME[x.outcome] ?? OUTCOME.clean;
                return (
                  <tr key={x.pr} className="border-t border-line align-top">
                    <td className="py-2 pr-3 pl-4">
                      <span className="mono text-sm text-fg-3">#{x.pr}</span> <span className="text-fg">{x.title}</span>
                      <div className="num text-xs text-fg-3">merged {fmtDate(x.mergedAt)} {x.mergedAt.slice(0, 4)}</div>
                    </td>
                    <td className="max-w-[300px] px-3 py-2 text-fg-2">
                      {x.fix ? (
                        <>
                          Fixed {x.fix.daysLater} days later by <span className="mono text-sm">#{x.fix.pr}</span>
                          <div className="truncate text-xs text-fg-3" title={x.fix.title}>
                            {x.fix.title}
                          </div>
                        </>
                      ) : (
                        <span className="text-fg-3">No later fix found (control)</span>
                      )}
                    </td>
                    <td className="num px-3 py-2 text-right whitespace-nowrap text-fg-2">
                      {x.lines.read} of {x.lines.total}
                    </td>
                    <td className="num px-3 py-2 text-right text-fg-2">{x.findingsShown}</td>
                    <td className="max-w-[360px] py-2 pr-4 pl-3">
                      <span className={cx('font-medium', o.tone)}>{o.label}</span>
                      <div className="text-xs text-fg-3">{x.outcome === 'failed' ? `The sandbox could not run this old commit (${x.why.split('\n')[0].replace(/^Pipeline infrastructure failure:\s*/, '').replace(/\s*\(infrastructure\)/, '')}). Counted as failed, not as clean.` : x.why}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <details className="border-t border-line px-4 py-2.5 text-sm text-fg-3">
          <summary className="cursor-pointer text-fg-2 select-none">How this was measured, and why it proves less than it seems</summary>
          <p className="mt-2 max-w-[84ch]">{b.method}</p>
          <ul className="mt-2 max-w-[84ch] list-disc space-y-1 pl-4">
            {b.caveats.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <p className="num mt-2">
            Median pipeline time {b.medianWallMinutes} min per pull request · model cost ${b.totalCostUsd.toFixed(2)} in total · estimated human time {b.medianEstMinutes} min per pull request (median)
          </p>
        </details>
      </div>
    </>
  );
}

/* ───────────── page ───────────── */
export default function LedgerPage() {
  const { data: L, error, loading, reload, setData } = useQuery(() => api.ledger(), []);
  const { data: all, reload: reloadAll } = useQuery(() => api.dossiers(), []);
  const [params] = useSearchParams();
  const prParam = params.get('pr') ?? undefined;
  const [dialog, setDialog] = useState<Mode>();
  const [openAreas, setOpenAreas] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<LedgerEventType | 'all'>('all');
  const [showAll, setShowAll] = useState(false);
  const [notice, setNotice] = useState<{ text: string; areas: string[]; tone: 'down' | 'ok' }>();

  const signed = useMemo(() => all?.filter((d) => d.status === 'signed'), [all]);
  const byId = useMemo(() => new Map((all ?? []).map((d) => [d.id, d])), [all]);
  const focusPr = signed?.find((d) => d.slug === prParam);

  useHotkeys({ e: () => setDialog('escape'), s: () => setDialog('spot-check') });
  useCommands(
    'ledger',
    [
      { id: 'ledger-escape', title: 'Report an escape', group: 'Trust ledger', kbd: 'E', keywords: 'revert incident', run: () => setDialog('escape') },
      { id: 'ledger-spot', title: 'Record a spot-check', group: 'Trust ledger', kbd: 'S', keywords: 'full read sample', run: () => setDialog('spot-check') },
    ],
    [
      { keys: 'E', what: 'Report an escape', group: 'Trust ledger' },
      { keys: 'S', what: 'Record a spot-check', group: 'Trust ledger' },
    ],
  );

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice((n) => (n ? { ...n, areas: [] } : n)), 3200);
    return () => clearTimeout(t);
  }, [notice?.text]); // eslint-disable-line react-hooks/exhaustive-deps

  const onDone = (next: LedgerView) => {
    const before = new Map((L?.areas ?? []).map((a) => [a.area, a]));
    const moved = next.areas.filter((a) => before.get(a.area) && before.get(a.area)!.level !== a.level);
    const touched = next.areas.filter((a) => {
      const b = before.get(a.area);
      return b && (b.escapes !== a.escapes || b.spotChecks !== a.spotChecks || b.cleanStreak !== a.cleanStreak);
    });
    const was = dialog;
    setDialog(undefined);
    setData(next);
    reloadAll();
    if (moved.length) {
      setNotice({
        tone: moved.some((a) => a.level < before.get(a.area)!.level) ? 'down' : 'ok',
        areas: moved.map((a) => a.area),
        text: moved.map((a) => `${a.area}: ${TRUST[before.get(a.area)!.level]} → ${a.label}. ${a.effect}`).join(' '),
      });
      setOpenAreas((s) => new Set([...s, ...moved.map((a) => a.area)]));
    } else {
      setNotice({
        tone: 'ok',
        areas: touched.map((a) => a.area),
        text: `${was === 'escape' ? 'Escape' : 'Spot-check'} recorded${touched.length ? ` against ${touched.map((a) => a.area).join(', ')}` : ''}. Trust levels did not move.`,
      });
    }
    setTimeout(() => scrollToId('areas', false), 60);
  };

  // newest first, whichever way the server stores the chain
  const events = useMemo(() => {
    if (!L) return [];
    const ev = L.events;
    return ev.length > 1 && ev[0].at > ev[ev.length - 1].at ? ev : [...ev].reverse();
  }, [L]);
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const e of events) c.set(e.type, (c.get(e.type) ?? 0) + 1);
    return c;
  }, [events]);
  const shown = events.filter((e) => filter === 'all' || e.type === filter);
  const visible = showAll ? shown : shown.slice(0, 12);

  const actions = (
    <>
      <Button onClick={() => setDialog('spot-check')} icon={<Eye className="h-3.5 w-3.5" />}>
        Record spot-check
      </Button>
      <Button onClick={() => setDialog('escape')} icon={<Undo2 className="h-3.5 w-3.5" />}>
        Report escape
      </Button>
    </>
  );

  if (error && !L)
    return (
      <>
        <PageHeader title="Trust ledger" />
        <div className="p-5">
          <ErrorNote error={error} retry={reload} />
        </div>
      </>
    );
  if (loading && !L)
    return (
      <>
        <PageHeader title="Trust ledger" />
        <div className="space-y-4 p-5">
          <div className="skeleton h-24" />
          <div className="skeleton h-72" />
          <div className="skeleton h-56" />
        </div>
      </>
    );
  if (!L) return null;

  const t = L.totals;
  const w0 = L.weekly[0];
  const wN = L.weekly[L.weekly.length - 1];
  const anySynthetic = L.weekly.some((w) => w.synthetic) || L.events.some((e) => e.synthetic);
  const head = events[0];
  const weeks = L.weekly.length;
  const fewerMinutes = w0 && wN && wN.medianReviewMinutes < w0.medianReviewMinutes;
  const peakEsc = Math.max(0, ...L.weekly.map((w) => w.escapes));
  const share = (w: typeof w0, k: 'routedT0' | 'routedT3') => (w ? w[k] / Math.max(1, w.routedT0 + w.routedT1 + w.routedT2 + w.routedT3) : 0);
  const mixTitle =
    share(wN, 'routedT0') > share(w0, 'routedT0') && share(wN, 'routedT3') < share(w0, 'routedT3')
      ? 'More pull requests are covered by proof, fewer need a close read'
      : share(wN, 'routedT0') > share(w0, 'routedT0')
        ? 'More pull requests are covered by proof'
        : 'How pull requests were routed, week by week';

  return (
    <>
      <PageHeader
        title="Trust ledger"
        sub={
          <span className="inline-flex flex-wrap items-center gap-2">
            Trust is earned per code area, from what happened after people signed. Real, replayed and seeded numbers are kept apart.
          </span>
        }
      >
        {actions}
      </PageHeader>

      <div className="mx-auto max-w-[1480px] space-y-4 p-5 max-md:p-4">
        {focusPr && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-accent/40 bg-accent/8 px-3.5 py-2.5">
            <Signature className="h-4 w-4 shrink-0 text-accent" />
            <p className="min-w-0 flex-1 text-base text-fg">
              <span className="mono text-sm text-fg-2">#{focusPr.number}</span> {focusPr.title} is countersigned. If it is reverted, causes an incident, or gets a full read later, record it here and the area’s trust moves with it.
            </p>
            <Button size="md" onClick={() => setDialog('spot-check')}>
              Record spot-check
            </Button>
            <Button size="md" onClick={() => setDialog('escape')}>
              Report escape
            </Button>
          </div>
        )}

        <Section
          title="Measured on this server"
          tag={<Tag className="text-fg-2">real</Tag>}
          sub="Reviews the pipeline ran on real GitHub pull requests, and signatures real people gave here. Small, and kept apart from everything below."
        >
          <RealPanel r={L.real} days={L.cleanAfterDays} byId={byId} />
        </Section>

        {L.backtest && (
          <Section
            title="Backtest on merged history"
            tag={<Tag className="text-fg-2">real code, replayed</Tag>}
            sub="Pull requests that were already merged, reviewed again at their merge commit by the unchanged pipeline. Some of them needed a fix later: did the review put that code in front of a person?"
          >
            <BacktestPanel b={L.backtest} />
          </Section>
        )}

        <Section
          id="seeded"
          title="Seeded history"
          tag={anySynthetic ? <SyntheticTag /> : undefined}
          sub={`${t.signed} synthetic sign-offs over ${weeks} calendar weeks, generated to show how the ledger behaves at volume and to give the trust levels something to start from. They are not measurements, and they are counted nowhere above.`}
        >
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Median review time, latest week" value={String(wN?.medianReviewMinutes ?? t.medianReviewMinutes)} unit="min" note={w0 ? `${w0.medianReviewMinutes} min in the first of ${weeks} weeks` : 'per pull request'} />
            <Stat label="Escape rate" value={pct(t.escapeRate, 1)} note={`${plural(t.escapes, 'escape')} in ${t.signed} signed PRs`} />
            <Stat label="Lines a human reads" value={pct(t.humanReadShare)} note="of changed lines, the rest carry a proof" />
            <Stat label="Finding precision" value={pct(t.findingPrecision)} note="AI findings that people marked real" />
            <Stat label="Spot-check agreement" value={pct(t.spotCheckAgreement)} note="full reads that found no miss" />
            <Stat label="Pull requests reviewed" value={String(t.prs)} note={`${t.signed} countersigned`} />
          </div>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Card
              title={fewerMinutes ? `Review time fell from ${w0.medianReviewMinutes} to ${wN.medianReviewMinutes} minutes; escapes never passed ${peakEsc} a week` : 'Review time and escapes, week by week'}
              sub="The trade this tool has to win: less human time per pull request without more defects getting through."
            >
              <ReviewVsEscapes weekly={L.weekly} />
            </Card>
            <Card title={mixTitle} sub="Pull requests per week by the highest risk tier in the change.">
              <RoutingMix weekly={L.weekly} />
            </Card>
          </div>
        </Section>

        {/* areas */}
        <section id="areas" className="scroll-mt-16 overflow-hidden rounded-lg border border-line bg-surface">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 pt-4 pb-3">
            <h2 className="text-md font-semibold">Trust by code area</h2>
            <p className="text-sm text-fg-3">
              Levels start from the seeded history. A real sign-off moves them by the same rules once it has stayed clean for {L.cleanAfterDays} days; an escape or a missed spot-check demotes at once.
            </p>
          </div>
          {notice && (
            <div role="status" className={cx('anim-fade mx-4 mb-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-base', notice.tone === 'down' ? 'border-amber/40 bg-amber/8' : 'border-line-strong bg-surface-2')}>
              {notice.tone === 'down' ? <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber" /> : <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-green" />}
              <span className="min-w-0 flex-1 text-fg">{notice.text}</span>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-left">
              <thead>
                <tr className="text-xs font-medium text-fg-3">
                  <th className="py-1.5 pr-3 pl-[38px] font-medium">Area</th>
                  <th className="px-3 py-1.5 font-medium">Trust level</th>
                  <th className="px-3 py-1.5 font-medium">Clean streak</th>
                  <th className="px-3 py-1.5 text-right font-medium whitespace-nowrap">Sign-offs</th>
                  <th className="px-3 py-1.5 text-right font-medium">Escapes</th>
                  <th className="px-3 py-1.5 text-right font-medium whitespace-nowrap">Spot-check misses</th>
                  <th className="px-3 py-1.5 text-right font-medium whitespace-nowrap">Finding precision</th>
                  <th className="py-1.5 pr-4 pl-3 font-medium max-xl:hidden">What this level allows</th>
                </tr>
              </thead>
              <tbody>
                {L.areas.map((a) => (
                  <AreaRows
                    key={a.area}
                    a={a}
                    open={openAreas.has(a.area)}
                    flash={!!notice?.areas.includes(a.area)}
                    onToggle={() =>
                      setOpenAreas((s) => {
                        const n = new Set(s);
                        if (!n.delete(a.area)) n.add(a.area);
                        return n;
                      })
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* events */}
        <section className="rounded-lg border border-line bg-surface">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-4 pb-3">
            <h2 className="text-md font-semibold">Ledger events</h2>
            {L.chainOk ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-green" title={head ? `Every event carries the hash of the one before it. Head: ${head.hash}` : undefined}>
                <ShieldCheck className="h-3.5 w-3.5" />
                Chain verified
                {head && (
                  <span className="mono text-xs text-fg-3">
                    {L.events.length} events · head {head.hash.slice(0, 10)}
                  </span>
                )}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-red">
                <ShieldAlert className="h-3.5 w-3.5" />
                Chain broken: an event was changed after it was written
              </span>
            )}
            <div className="ml-auto flex flex-wrap gap-1" role="group" aria-label="Filter events by type">
              {(['all', ...(Object.keys(EVENT) as LedgerEventType[])] as const).map((k) => {
                const n = k === 'all' ? events.length : (counts.get(k) ?? 0);
                if (k !== 'all' && !n) return null;
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={filter === k}
                    onClick={() => {
                      setFilter(k);
                      setShowAll(false);
                    }}
                    className={cx('num inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors', filter === k ? 'border-line-strong bg-surface-3 text-fg' : 'border-transparent text-fg-3 hover:bg-surface-2 hover:text-fg')}
                  >
                    {k === 'all' ? 'All' : EVENT[k].label}
                    <span className="text-fg-3">{n}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <ol>
            {visible.map((e) => (
              <EventRow key={e.id} e={e} d={e.pr ? byId.get(e.pr) : undefined} />
            ))}
          </ol>
          {shown.length > visible.length && (
            <div className="border-t border-line px-4 py-2">
              <Button variant="ghost" size="md" onClick={() => setShowAll(true)}>
                Show all {shown.length} events
              </Button>
            </div>
          )}
        </section>

        <PolicyPanel />
      </div>

      {dialog && <RecordDialog mode={dialog} signed={signed} initial={prParam} onClose={() => setDialog(undefined)} onDone={onDone} />}
    </>
  );
}

function EventRow({ e, d }: { e: LedgerEvent; d?: DossierSummary }) {
  const m = EVENT[e.type] ?? EVENT.review;
  const num = e.pr?.match(/#(\d+)$/)?.[1];
  return (
    <li className="grid grid-cols-[92px_18px_minmax(0,1fr)] items-start gap-x-3 border-t border-line px-4 py-2 md:grid-cols-[92px_18px_minmax(0,1fr)_auto]">
      <time className="num pt-px text-xs text-fg-3" dateTime={e.at} title={fmtDateTime(e.at)}>
        {fmtDateTime(e.at)}
      </time>
      <m.Icon className={cx('mt-[3px] h-3.5 w-3.5', m.tone)} aria-label={m.label} />
      <div className="min-w-0">
        <p className="text-base text-fg">{e.summary}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-fg-3">
          <span>{m.label}</span>
          {num &&
            (d ? (
              <Link to={`/pr/${d.slug}`} className="mono text-fg-2 underline decoration-fg-4 underline-offset-2 hover:text-fg">
                #{num}
              </Link>
            ) : (
              <span className="mono">#{num}</span>
            ))}
          {e.area && <span>{e.area}</span>}
          <span>{e.actor === 'countersign' ? 'by Countersign' : `by @${e.actor}`}</span>
          {e.synthetic && <span className="rounded-[4px] border border-dashed border-line-strong px-1 text-2xs">synthetic</span>}
        </div>
      </div>
      <span className="mono inline-flex items-center gap-1 pt-0.5 text-2xs text-fg-4 max-md:hidden" title={`hash ${e.hash}\nprev ${e.prevHash}`}>
        <Link2 className="h-3 w-3" />
        {e.prevHash.slice(0, 6)} → {e.hash.slice(0, 6)}
      </span>
    </li>
  );
}
