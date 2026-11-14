/** Inbox: every pull request that has a dossier, most in need of a person first. */
import { GitPullRequest } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { DossierSummary } from '../../../shared/dossier';
import { api } from '../api';
import { Glyph } from '../components/review/atoms';
import { PageHeader, useCommands } from '../components/Shell';
import { Button, ErrorNote, Kbd, Spinner } from '../components/ui';
import { useHotkeys, useQuery } from '../lib/hooks';
import { cx, fmtMin, plural } from '../lib/util';

const TIER = { T3: 3, T2: 2, T1: 1, T0: 0 } as const;

/** Within "Waiting for you": the least work for a person first, so quick signatures are not stuck behind a long read. Ties: higher tier first. */
const byWork = (a: DossierSummary, b: DossierSummary) => a.estMinutes - b.estMinutes || TIER[b.tier] - TIER[a.tier] || b.generatedAt.localeCompare(a.generatedAt);
const byDate = (a: DossierSummary, b: DossierSummary) => b.generatedAt.localeCompare(a.generatedAt);

type Group = 'Waiting for you' | 'Being reviewed' | 'Done';
const groupOf = (d: DossierSummary): Group => (d.status === 'ready' ? 'Waiting for you' : d.status === 'running' || d.status === 'failed' ? 'Being reviewed' : 'Done');
const GROUPS: Group[] = ['Waiting for you', 'Being reviewed', 'Done'];

const ADVICE: Record<DossierSummary['verdict'], string> = {
  accept: 'Accept',
  'accept-after-decisions': 'Accept after decisions',
  'changes-requested': 'Request changes',
  'full-read-required': 'Read it in full',
};

const COLS = 'lg:grid-cols-[14px_76px_minmax(0,1fr)_156px_196px_208px]';
const title = (d: DossierSummary) => d.title.replace(/\s*\(REQ-\d+\)\s*$/, '');

function Running({ slug }: { slug: string }) {
  // The summary carries no stages; the live view comes from the dossier itself.
  const { data } = useQuery(() => api.dossier(slug), [slug], { pollMs: (d) => (!d || d.status === 'running' ? 2000 : false) });
  if (!data) return <span className="skeleton block h-3 w-40" />;
  const done = data.stages.filter((s) => s.status === 'done' || s.status === 'skipped').length;
  const now = data.stages.find((s) => s.status === 'running') ?? data.stages.find((s) => s.status === 'failed');
  return (
    <span className="truncate">
      {now ? now.title : 'Starting'}
      <span className="num text-fg-4">
        {' '}
        · {done} of {data.stages.length}
      </span>
    </span>
  );
}

function Row({ d, active, onHover }: { d: DossierSummary; active: boolean; onHover: () => void }) {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  const running = d.status === 'running';
  const closed = d.status === 'signed' || d.status === 'rejected';
  const forYou = [d.refusalsOpen ? plural(d.refusalsOpen, 'decision') : '', d.findings ? plural(d.findings, 'finding') : ''].filter(Boolean).join(', ');
  return (
    <Link
      ref={ref}
      to={`/pr/${d.slug}`}
      onMouseMove={onHover}
      aria-current={active ? 'true' : undefined}
      className={cx('grid min-h-11 grid-cols-[14px_minmax(0,1fr)] items-center gap-x-3 px-5 py-2 outline-none max-md:px-4 lg:py-0', COLS, active ? 'md:bg-surface-2' : 'hover:bg-surface')}
    >
      {running ? <Spinner className="text-fg-3" /> : <Glyph state={d.status === 'signed' ? 'done' : d.status === 'rejected' || d.status === 'failed' ? 'fail' : d.blockers > 0 ? 'needs' : 'open'} />}
      <span className="num text-sm text-fg-3 max-lg:hidden">{d.requirementId}</span>
      <span className="flex min-w-0 items-baseline gap-2">
        <span className={cx('truncate text-base', closed ? 'text-fg-2' : 'font-medium text-fg')} title={d.title}>
          {title(d)}
        </span>
        <span className="num shrink-0 text-sm text-fg-4">#{d.number}</span>
      </span>
      {running || d.status === 'failed' ? (
        <span className="col-start-2 min-w-0 text-sm text-fg-3 lg:col-span-3 lg:col-start-auto">{running ? <Running slug={d.slug} /> : 'The review failed. Open it to see where.'}</span>
      ) : (
        <>
          <span className="col-start-2 truncate text-sm text-fg-2 lg:col-start-auto">{closed ? (d.signer ? `@${d.signer}` : '') : forYou || 'Nothing open'}</span>
          <span className="num col-start-2 truncate text-sm text-fg-3 lg:col-start-auto" title={d.fullRead === 'spot-check' ? 'Drawn for a spot check of the reviewer: read every line, then record whether you found anything the AI missed' : d.fullRead === 'probation' ? 'This code area is on probation after an escape: every line is read and a second person co-signs' : d.fullRead ? 'The review could not earn a skip on this change: every line is yours' : `You are asked to read ${d.readLines} of ${d.totalLines} changed lines`}>
            {d.fullRead ? `All ${d.totalLines} lines · ${d.fullRead === 'spot-check' ? 'spot check' : d.fullRead === 'probation' ? 'probation' : 'no skip earned'}` : `${d.readLines} of ${d.totalLines} lines`}
            <span className="lg:hidden"> · {fmtMin(d.estMinutes)}</span>
          </span>
          <span className={cx('col-start-2 flex items-center justify-between gap-3 truncate text-sm lg:col-start-auto', d.verdict === 'changes-requested' && !closed ? 'text-red' : 'text-fg-3')}>
            <span className="truncate">{closed ? (d.status === 'signed' ? 'Countersigned' : 'Changes requested') : ADVICE[d.verdict]}</span>
            <span className="num shrink-0 text-fg-3 max-lg:hidden">{fmtMin(d.estMinutes)}</span>
          </span>
        </>
      )}
    </Link>
  );
}

export default function Inbox() {
  const nav = useNavigate();
  const { data, error, loading, reload } = useQuery(() => api.dossiers(), [], { pollMs: (d) => (d?.some((x) => x.status === 'running') ? 2000 : false) });
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => {
    return GROUPS.flatMap((g) => (data ?? []).filter((d) => groupOf(d) === g).sort(g === 'Waiting for you' ? byWork : byDate));
  }, [data]);
  const open = rows.filter((r) => r.status === 'ready');
  const minutes = open.reduce((s, r) => s + r.estMinutes, 0);

  useEffect(() => setSel((s) => Math.min(s, Math.max(0, rows.length - 1))), [rows.length]);

  const submit = async () => {
    const v = url.trim();
    if (!v) {
      setFormErr('Paste a pull request URL first.');
      input.current?.focus();
      return;
    }
    if (!/^https?:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/.test(v)) {
      setFormErr('That is not a GitHub pull request URL. Expected https://github.com/owner/repo/pull/123');
      return;
    }
    setBusy(true);
    setFormErr('');
    try {
      await api.review(v);
      setUrl('');
      await reload();
    } catch (e) {
      setFormErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useHotkeys({
    j: () => setSel((s) => Math.min(rows.length - 1, s + 1)),
    k: () => setSel((s) => Math.max(0, s - 1)),
    ArrowDown: () => setSel((s) => Math.min(rows.length - 1, s + 1)),
    ArrowUp: () => setSel((s) => Math.max(0, s - 1)),
    Enter: () => rows[sel] && nav(`/pr/${rows[sel].slug}`),
    o: () => rows[sel] && nav(`/pr/${rows[sel].slug}`),
    '/': () => input.current?.focus(),
    n: () => input.current?.focus(),
  });

  useCommands(
    'inbox',
    [{ id: 'inbox-new', title: 'Review a GitHub pull request', group: 'Actions', kbd: 'N', keywords: 'new paste url start', run: () => input.current?.focus() }],
    [
      { keys: 'J K', what: 'Move between pull requests', group: 'Inbox' },
      { keys: '↵', what: 'Open the selected pull request', group: 'Inbox' },
      { keys: 'N', what: 'Paste a PR URL to review', group: 'Inbox' },
    ],
  );

  let i = -1;
  return (
    <div>
      <PageHeader title="Inbox" sub={data ? (open.length ? `${plural(open.length, 'pull request')} waiting for a signature, about ${fmtMin(minutes)} of your time. Least work first` : 'Nothing is waiting for your signature') : undefined}>
        <form
          className="flex items-center gap-2 max-md:w-full"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className={cx('flex h-7 w-[340px] items-center max-md:h-9 max-md:w-auto max-md:min-w-0 max-md:flex-1 gap-2 rounded-md border bg-surface px-2.5 transition-colors focus-within:border-line-strong', formErr ? 'border-red/60' : 'border-line')}>
            <GitPullRequest className="h-3.5 w-3.5 shrink-0 text-fg-3" />
            <span className="sr-only">GitHub pull request URL</span>
            <input
              ref={input}
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setFormErr('');
              }}
              onKeyDown={(e) => e.key === 'Escape' && (e.target as HTMLInputElement).blur()}
              placeholder="Paste a GitHub PR URL to review"
              aria-invalid={!!formErr}
              aria-describedby={formErr ? 'pr-url-error' : undefined}
              spellCheck={false}
              className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-3"
            />
            {!url && <Kbd className="max-md:hidden">N</Kbd>}
          </label>
          {url && (
            <Button type="submit" variant="primary" loading={busy} className="max-md:h-9 max-md:px-3.5">
              Review
            </Button>
          )}
        </form>
      </PageHeader>
      {formErr && (
        <p id="pr-url-error" role="alert" className="border-b border-line px-5 py-2 text-sm text-red">
          {formErr}
        </p>
      )}

      {error && !data && (
        <div className="p-5">
          <ErrorNote error={error} retry={reload} />
        </div>
      )}

      {loading &&
        !data &&
        Array.from({ length: 4 }, (_, n) => (
          <div key={n} className="flex h-11 items-center px-5">
            <span className="skeleton h-3" style={{ width: `${52 - n * 6}%` }} />
          </div>
        ))}

      {GROUPS.map((g) => {
        const list = rows.filter((d) => groupOf(d) === g);
        if (!list.length) return null;
        return (
          <section key={g} aria-label={g}>
            <div className={cx('grid h-9 grid-cols-[14px_minmax(0,1fr)] items-center gap-x-3 bg-surface px-5 text-sm text-fg-3 max-md:px-4', COLS)}>
              <span />
              <span className="lg:col-span-2">
                <span className="font-medium text-fg-2">{g}</span>
                <span className="num ml-2">{list.length}</span>
              </span>
              {g === 'Waiting for you' && (
                <>
                  <span className="max-lg:hidden">Yours to decide</span>
                  <span className="max-lg:hidden">Yours to read</span>
                  <span className="max-lg:hidden">AI advice</span>
                </>
              )}
            </div>
            {list.map((d) => {
              i += 1;
              const idx = i;
              return <Row key={d.slug} d={d} active={idx === sel} onHover={() => setSel(idx)} />;
            })}
          </section>
        );
      })}

      {data && rows.length === 0 && (
        <div className="px-5 py-16">
          <p className="text-md font-medium">No pull requests yet</p>
          <p className="mt-1 max-w-[52ch] text-base text-fg-3">Paste a GitHub PR URL above. Countersign reads the linked requirement, runs the code, and tells you which lines and decisions are yours.</p>
        </div>
      )}
    </div>
  );
}
