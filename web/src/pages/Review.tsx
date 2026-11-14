/**
 * The review: a guided walk through one pull request. Left, the chapters. Middle, the guide in plain
 * words. Right, the artifact that backs it. The last chapter is a named human's signature.
 */
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Clock, ExternalLink, Search, X } from 'lucide-react';
import { isSkim } from '../../../shared/gate';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { Dossier } from '../../../shared/dossier';
import { api, type Statement } from '../api';
import { Glyph } from '../components/review/atoms';
import { Ask } from '../components/review/Ask';
import { ReviewContext, type Review } from '../components/review/ctx';
import { Guide } from '../components/review/Guide';
import { Stage } from '../components/review/Stage';
import { useCommands, useOpenPalette } from '../components/Shell';
import { Avatar, Button, Kbd, Spinner } from '../components/ui';
import { chapters, chapterState, GROUPS, place, type Chapter } from '../lib/chapters';
import { useMe, useQuery, useStored } from '../lib/hooks';
import { liveInfo, type LiveInfo } from '../lib/live';
import { Reviewer } from '../components/Reviewer';
import { compose } from '../lib/review';
import { cx, fmtClock, fmtMs, MOD, plural, tidy } from '../lib/util';

function TopBar({ d, seconds }: { d: Dossier; seconds?: number }) {
  const openPalette = useOpenPalette();
  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
      <Link to="/" aria-label="Back to the inbox" title="Inbox (G I)" className="flex h-7 w-7 items-center justify-center rounded-md text-fg-3 transition-colors hover:bg-surface-2 hover:text-fg">
        <ChevronLeft className="h-4 w-4" />
      </Link>
      <a href={d.requirement.sourceUrl} target="_blank" rel="noreferrer" title={d.requirement.title} className="num shrink-0 text-base text-fg-3 hover:text-fg">
        {d.requirement.id}
      </a>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-fg-4" />
      <h1 className="min-w-0 truncate text-base font-medium text-fg">{d.pr.title.replace(/\s*\((?:REQ|req)-\d+\)\s*$/, '')}</h1>
      <div className="ml-auto flex shrink-0 items-center gap-1 pl-3">
        {seconds !== undefined && (
          <span className="num mr-1 flex h-7 items-center gap-1.5 rounded-md px-2 text-sm text-fg-3 max-md:hidden" title="Your time on this review, clocked by the server while the page is open and visible. It goes on the attestation.">
            <Clock className="h-3.5 w-3.5 text-fg-4" aria-hidden />
            <span className="sr-only">Time spent on this review:</span>
            {fmtClock(seconds)}
          </span>
        )}
        <a href={d.pr.url} target="_blank" rel="noreferrer" className="flex h-7 items-center gap-1.5 rounded-md px-2 text-sm text-fg-3 transition-colors hover:bg-surface-2 hover:text-fg">
          <span className="max-md:hidden">{d.pr.repo}</span>#{d.pr.number} <ExternalLink className="h-3 w-3" />
        </a>
        <Reviewer compact />
        <button type="button" onClick={openPalette} aria-label="Command palette" title={`Commands (${MOD} K)`} className="flex h-7 w-7 items-center justify-center rounded-md text-fg-3 transition-colors hover:bg-surface-2 hover:text-fg">
          <Search className="h-3.5 w-3.5" />
        </button>
      </div>
    </header>
  );
}

function RailRow({ c, cur, r, seen, quiet }: { c: Chapter; cur: Chapter; r: Review; seen: Set<string>; quiet?: boolean }) {
  const on = c.id === cur.id;
  const st = chapterState(c, r.d, r.readIds, seen);
  const label = tidy(c.label).replace(/`/g, '');
  return (
    <button
      type="button"
      onClick={() => r.go(c.id)}
      aria-current={on ? 'step' : undefined}
      title={`${label}${st === 'needs' ? '. Needs you before the sign-off' : st === 'done' ? '. Done' : ''}`}
      className={cx('flex h-7 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-base transition-colors', on ? 'bg-surface-2 text-fg' : quiet ? 'text-fg-3 hover:bg-surface hover:text-fg' : 'text-fg-2 hover:bg-surface hover:text-fg')}
    >
      <Glyph state={on && (st === 'todo' || st === 'seen') ? 'current' : st === 'needs' ? 'open' : st} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

/** The chapters in two parts: what needs the signer, and the evidence that is there if they want it. */
function Rail({ cur, r, seen, left, onNextNeed }: { cur: Chapter; r: Review; seen: Set<string>; left: number; onNextNeed: () => void }) {
  const signed = !!r.d.signoff;
  const waiting = !!r.d.live?.firstSign && r.d.live.firstSign.signer === r.me?.login;
  const you = r.list.filter((c) => c.section === 'you');
  const evidence = r.list.filter((c) => c.section === 'evidence');
  const head = 'flex items-baseline justify-between px-2.5 pb-1 text-xs font-medium text-fg-2';
  return (
    <nav aria-label="Chapters" className="hidden w-[216px] shrink-0 flex-col border-r border-line lg:flex xl:w-[232px]">
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-3 pb-4">
        <RailRow c={r.list[0]} cur={cur} r={r} seen={seen} />
        <section aria-label="Needs you" className="mt-4">
          <div className={head}>
            Needs you
            <span className="num font-normal text-fg-4">{signed ? 'signed' : left ? `${left} left` : waiting ? 'second signer' : 'ready to sign'}</span>
          </div>
          {GROUPS.map((g) => {
            const items = you.filter((c) => c.group === g);
            if (!items.length) return null;
            return (
              <div key={g} className="mb-1.5">
                {g !== 'Sign off' && <div className="px-2.5 pt-1.5 pb-0.5 text-xs text-fg-4">{g}</div>}
                {items.map((c) => (
                  <RailRow key={c.id} c={c} cur={cur} r={r} seen={seen} />
                ))}
              </div>
            );
          })}
        </section>
        <section aria-label="Evidence" className="mt-4">
          <div className={head} title="Nothing here is required before you sign">
            Evidence
            <span className="font-normal text-fg-4">optional</span>
          </div>
          {evidence.map((c) => (
            <RailRow key={c.id} c={c} cur={cur} r={r} seen={seen} quiet />
          ))}
        </section>
      </div>
      <div className="shrink-0 border-t border-line px-4 py-3">
        {signed ? (
          <div className="flex items-center gap-2 text-sm text-fg-2">
            <Glyph state={r.d.signoff!.decision === 'accepted' ? 'done' : 'fail'} />
            {r.d.signoff!.decision === 'accepted' ? 'Countersigned' : 'Changes requested'} by {r.d.signoff!.signerName ?? `@${r.d.signoff!.signer}`}
            {r.d.signoff!.cosign ? ` and ${r.d.signoff!.cosign.signerName ?? `@${r.d.signoff!.cosign.signer}`}` : ''}
          </div>
        ) : (
          <div className="flex items-center gap-2.5">
            {r.me && <Avatar src={r.me.avatarUrl} name={r.me.name || r.me.login} size={20} />}
            <span className="min-w-0 flex-1 truncate text-sm text-fg-2">{left ? `${left} left for you` : waiting ? 'Waiting for a second signer' : 'Ready to sign'}</span>
            <button type="button" onClick={onNextNeed} title="Go to the next thing that needs you (N)" className="flex h-6 items-center gap-1.5 rounded-md border border-line px-2 text-xs text-fg-2 transition-colors hover:border-line-strong hover:text-fg">
              Next <Kbd className="h-4 min-w-4 border-0 bg-surface-3">N</Kbd>
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}

/** Shown while the pipeline is still producing the dossier, and when it failed. */
function Pipeline({ d }: { d: Dossier }) {
  const failed = d.status === 'failed';
  return (
    <div className="flex h-dvh flex-col bg-bg">
      <TopBar d={d} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[560px] px-6 py-16">
          <h2 className="text-2xl font-medium tracking-[-0.015em]">{failed ? 'This review failed' : 'Reviewing this change'}</h2>
          <p className="mt-3 text-lg text-fg-2">
            {failed ? 'The pipeline stopped before the dossier was complete. Nothing below counts as checked.' : 'Agents are reading the requirement, running the tests in a sandbox and trying to break the change. The review opens here when they finish.'}
          </p>
          <ol className="mt-8">
            {d.stages.map((s) => (
              <li key={s.name} className="flex items-start gap-3 border-t border-line py-2.5 first:border-t-0">
                <span className="mt-[3px] flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                  {s.status === 'running' ? <Spinner className="text-accent" /> : <Glyph state={s.status === 'done' ? 'seen' : s.status === 'failed' ? 'fail' : s.status === 'skipped' ? 'half' : 'todo'} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className={cx('text-base', s.status === 'pending' ? 'text-fg-3' : 'text-fg')}>{tidy(s.title)}</div>
                  {s.detail && <div className="mt-0.5 text-sm text-fg-3 [overflow-wrap:anywhere]">{tidy(s.detail)}</div>}
                </div>
                {s.durationMs ? <span className="num shrink-0 text-sm text-fg-4">{fmtMs(s.durationMs)}</span> : null}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

export default function ReviewPage() {
  const { slug = '' } = useParams();
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const { data: d, error, reload, setData } = useQuery(() => api.dossier(slug), [slug], { pollMs: (x) => (x?.status === 'running' ? 2000 : false) });
  const [live, setLive] = useState<LiveInfo>({ enabled: false, drawModel: '', askModel: '' });
  useEffect(() => void liveInfo().then(setLive), []);

  const [extraRisk, setExtraRisk] = useStored<string[]>(`cs-risk-${slug}`, []);
  const [spot, setSpot] = useState<{ missed?: boolean; note: string }>({ note: '' });
  const [seenList, setSeenList] = useStored<string[]>(`cs-seen-${slug}`, []);
  const [busy, setBusy] = useState<string>();
  const [toast, setToast] = useState<{ what: string; why: string }>();
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // on a phone the guide and the artifact share one screen, behind a switch
  const [pane, setPane] = useState<'guide' | 'stage'>('guide');
  const [signErr, setSignErr] = useState<string>();
  const [sel, setSel] = useState<Record<string, string | undefined>>({});
  const [tab, setTabs] = useState<Record<string, string | undefined>>({});
  const [hot, setHot] = useState<string[]>([]);
  const askRef = useRef<HTMLInputElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);

  const [override, setOverride] = useState('');
  const [statement, setStatement] = useState<Statement>();

  const ready = !!d && d.status !== 'running' && d.status !== 'failed';
  const signed = !!d?.signoff;
  const wantedUnit = params.get('c') ?? '';
  const onUnit = d?.units.some((u) => u.id === wantedUnit) ? wantedUnit : undefined;

  // The review clock runs on the server: this tab only sends a heartbeat while it is in front. What the server has
  // clocked (for the whole review and for the unit on screen) comes back and is what the attestation will carry.
  const [clock, setClock] = useState<{ total: number; unit: number; at: number; unitId?: string }>({ total: 0, unit: 0, at: Date.now() });
  const [, setTick] = useState(0);
  const open = ready && !signed && d?.status === 'ready';
  useEffect(() => {
    if (!open) return;
    let dead = false;
    const beat = () => {
      if (document.visibilityState !== 'visible') return;
      void api
        .presence(slug, onUnit)
        .then((x) => !dead && setClock({ total: x.activeSeconds, unit: x.unitSeconds, at: Date.now(), unitId: onUnit }))
        .catch(() => undefined);
    };
    beat();
    const t = setInterval(beat, 5000);
    const s = setInterval(() => setTick((n) => n + 1), 1000);
    document.addEventListener('visibilitychange', beat);
    return () => {
      dead = true;
      clearInterval(t);
      clearInterval(s);
      document.removeEventListener('visibilitychange', beat);
    };
  }, [slug, onUnit, open]);
  const since = Math.min(6, Math.floor((Date.now() - clock.at) / 1000));
  const seconds = signed ? d!.signoff!.reviewSeconds : open ? clock.total + since : (d?.live?.activeSeconds ?? 0);
  const liveRead = d?.live?.read;
  const readIds = useMemo(() => new Set(d?.signoff ? d.signoff.readUnitIds : (liveRead ?? [])), [d?.signoff, liveRead]);
  const readWait = useCallback(
    (unitId: string) => {
      const need = d?.live?.floors[unitId] ?? 0;
      const had = clock.unitId === unitId ? clock.unit + Math.floor((Date.now() - clock.at) / 1000) : (d?.live?.unitSeconds[unitId] ?? 0);
      return Math.max(0, Math.ceil(need - had));
    },
    [d?.live, clock],
  );
  const seen = useMemo(() => new Set(seenList), [seenList]);
  const list = useMemo(() => (d && ready ? chapters(d) : []), [d, ready]);
  const c = useMemo(() => (d && ready ? compose(d, readIds, extraRisk) : undefined), [d, ready, readIds, extraRisk]);

  const wanted = params.get('c');
  const cur = list.find((x) => x.id === wanted) ?? list[0];
  const idx = cur ? list.indexOf(cur) : 0;

  const go = useCallback(
    (id: string) => {
      setParams(
        (p) => {
          const n = new URLSearchParams(p);
          n.set('c', id);
          return n;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  const step = useCallback(
    (dir: 1 | -1) => {
      const n = list[idx + dir];
      if (n) go(n.id);
    },
    [list, idx, go],
  );
  const next = useCallback(() => step(1), [step]);
  const nextNeed = useCallback(() => {
    if (!d) return;
    const order = [...list.slice(idx + 1), ...list.slice(0, idx + 1)];
    const n = order.find((x) => x.required && chapterState(x, d, readIds, seen) === 'needs');
    go(n ? n.id : 'sign');
  }, [d, list, idx, readIds, seen, go]);

  useEffect(() => {
    if (!cur) return;
    setSeenList((p) => (p.includes(cur.id) ? p : [...p, cur.id]));
    guideRef.current?.scrollTo({ top: 0 });
    setHot([]);
    setPane('guide');
  }, [cur?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = useCallback(
    async (key: string, p: () => Promise<Dossier>) => {
      setBusy(key);
      clearTimeout(toastTimer.current);
      setToast(undefined);
      try {
        setData(await p());
        return true;
      } catch (e) {
        const why = (e as Error).message || 'The server did not answer.';
        setToast({ what: key.startsWith('fb-') ? 'Your judgement was not saved' : key.startsWith('ans-') ? 'Your decision was not saved' : key.startsWith('read-') ? 'Not counted as read yet' : 'That was not saved', why });
        toastTimer.current = setTimeout(() => setToast(undefined), 9000);
        return false;
      } finally {
        setBusy(undefined);
      }
    },
    [setData],
  );
  const later = useRef<ReturnType<typeof setTimeout>>(undefined);
  const advance = useCallback(() => {
    clearTimeout(later.current);
    later.current = setTimeout(next, 480);
  }, [next]);
  useEffect(() => () => clearTimeout(later.current), [cur?.id]);

  const readOnly = signed || d?.status === 'failed' || d?.status === 'rejected';
  const sampled = !!d?.routing?.spotCheck?.selected;
  const spotAnswer = useMemo(() => (sampled && typeof spot.missed === 'boolean' ? { missed: spot.missed, note: spot.note.trim() || undefined } : undefined), [sampled, spot]);

  // The statement on the sign chapter is built by the server, by the same function that signs: what is previewed is what is signed.
  const stamp = d ? `${d.live?.read.join()}|${d.findings.map((f) => f.feedback?.verdict ?? '-').join('')}|${d.refusals.map((r) => r.answer?.optionId ?? '-').join()}|${d.firstSign?.at ?? ''}` : '';
  useEffect(() => {
    if (!open) return;
    let dead = false;
    const t = setTimeout(() => {
      void api
        .statement(slug, { residualRisk: extraRisk, override: override.trim() || undefined, spotCheck: spotAnswer })
        .then((x) => !dead && 'reasons' in x && setStatement(x))
        .catch(() => undefined);
    }, 250);
    return () => {
      dead = true;
      clearTimeout(t);
    };
  }, [open, slug, stamp, extraRisk, override, spotAnswer]);
  const review: Review | undefined = useMemo(() => {
    if (!d || !c) return undefined;
    return {
      d,
      me,
      c,
      list,
      readIds,
      readOnly: !!readOnly,
      busy,
      live,
      seconds,
      go,
      next,
      answer: async (refusalId, optionId) => {
        const ok = await act(`ans-${refusalId}-${optionId}`, () => api.answer(slug, { refusalId, optionId }));
        if (ok) advance();
        return ok;
      },
      feedback: async (findingId, verdict) => {
        const ok = await act(`fb-${findingId}-${verdict}`, () => api.feedback(slug, { findingId, verdict }));
        if (ok) advance();
        return ok;
      },
      setRead: (unitId, read) => {
        if (readOnly) return;
        void act(`read-${unitId}`, () => api.read(slug, { unitId, read })).then((ok) => ok && read && advance());
      },
      sel,
      select: (chapterId, id) => setSel((p) => ({ ...p, [chapterId]: id })),
      tab,
      setTab: (chapterId, t) => setTabs((p) => ({ ...p, [chapterId]: t })),
      hot,
      setHot,
      extraRisk,
      spot,
      setSpot,
      setExtraRisk,
      statement,
      override,
      setOverride,
      readWait,
      sign: async (decision) => {
        if (decision === 'accepted' && c.blockers.length) return;
        setSignErr(undefined);
        setBusy(`sign-${decision}`);
        try {
          setData(await api.signoff(slug, { decision, residualRisk: extraRisk, override: override.trim() || undefined, spotCheck: spotAnswer }));
        } catch (e) {
          setSignErr((e as Error).message);
        } finally {
          setBusy(undefined);
        }
      },
      signErr,
    };
  }, [d, c, me, list, readIds, readOnly, busy, live, seconds, go, next, act, advance, slug, sel, tab, hot, extraRisk, setExtraRisk, spot, spotAnswer, setData, signErr, statement, override, readWait]);

  // keyboard: the whole review can be driven without the pointer
  useEffect(() => {
    if (!review || !cur) return;
    const h = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (document.querySelector('[data-modal]')) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const onControl = !!t.closest('button, a, [role="tab"]');
      const done = () => e.preventDefault();
      if (k === 'ArrowRight' || k === 'j') return (done(), step(1));
      if (k === 'ArrowLeft' || k === 'k') return (done(), step(-1));
      if (k === 'Enter' && !onControl) return (done(), cur.kind === 'brief' ? nextNeed() : step(1));
      if (k === 'n') return (done(), nextNeed());
      if (k === ' ' && !onControl) {
        const b = document.querySelector<HTMLElement>('[data-flow-play]');
        if (b) return (done(), b.click());
      }
      if (k === '[' || k === ']') {
        const tabs = [...document.querySelectorAll<HTMLElement>('[data-tabs] [role="tab"]')];
        const i = tabs.findIndex((x) => x.getAttribute('aria-selected') === 'true');
        if (tabs.length > 1) return (done(), tabs[(i + (k === ']' ? 1 : -1) + tabs.length) % tabs.length].click());
      }
      if (k === '/') return (done(), setPane('stage'), requestAnimationFrame(() => askRef.current?.focus()));
      if ((k === 'r' || e.code === 'KeyR') && cur.kind === 'unit' && !review.readOnly) {
        done();
        // the server takes "read" only after the unit has been on screen for its floor: the button counts it down
        if (!review.readIds.has(cur.ref!) && review.readWait(cur.ref!) > 0) return;
        return review.setRead(cur.ref!, !review.readIds.has(cur.ref!));
      }
      if (/^[1-9]$/.test(k) && !review.readOnly) {
        const n = Number(k) - 1;
        if (cur.kind === 'finding' && n < 2) return (done(), void review.feedback(cur.ref!, n === 0 ? 'accepted' : 'rejected'));
        if (cur.kind === 'sign' && review.d.routing.spotCheck.selected && !review.d.signoff && n < 2) return (done(), review.setSpot({ missed: n === 1, note: n === 1 ? review.spot.note : '' }));
        if (cur.kind === 'refusal') {
          const o = review.d.refusals.find((x) => x.id === cur.ref)?.options[n];
          if (o) return (done(), void review.answer(cur.ref!, o.id));
        }
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [review, cur, step, nextNeed]);

  useCommands(
    `review-${slug}`,
    [
      ...list.map((x, i) => ({ id: `ch-${x.id}`, title: tidy(x.label).replace(/`/g, ''), hint: x.section === 'evidence' ? 'Evidence' : x.section === 'brief' ? 'Start here' : `Step ${i}`, group: 'This review', run: () => go(x.id) })),
      ...(d ? [{ id: 'open-pr', title: 'Open the pull request on GitHub', group: 'This review', run: () => void window.open(d.pr.url, '_blank', 'noreferrer') }] : []),
    ],
    [
      { keys: '↵', what: 'On the brief: start with the first thing that needs you', group: 'Review' },
      { keys: '→', what: 'Next chapter', group: 'Review' },
      { keys: '←', what: 'Previous chapter', group: 'Review' },
      { keys: 'N', what: 'Next thing that needs you', group: 'Review' },
      { keys: '1 2 3', what: 'Judge a finding or pick an option', group: 'Review' },
      { keys: 'R', what: 'Mark the unit as read', group: 'Review' },
      { keys: '[ ]', what: 'Switch the tab on the right', group: 'Review' },
      { keys: 'Space', what: 'Play or pause the diagram', group: 'Review' },
      { keys: '/', what: 'Ask about what is on screen', group: 'Review' },
    ],
  );

  if (error)
    return (
      <div className="flex h-dvh flex-col bg-bg">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
          <Link to="/" aria-label="Back to the inbox" title="Inbox (G I)" className="flex h-7 items-center gap-1 rounded-md pr-2 pl-1 text-base text-fg-3 transition-colors hover:bg-surface-2 hover:text-fg">
            <ChevronLeft className="h-4 w-4" />
            Inbox
          </Link>
        </header>
        <div role="alert" className="mx-auto w-full max-w-[560px] px-6 py-16">
          <h2 className="text-2xl font-medium tracking-[-0.015em]">This review did not load</h2>
          <p className="mt-3 text-lg text-fg-2">{error.message.replace(/\.$/, '')}. Nothing was changed. Your judgements and what you marked as read are kept.</p>
          <div className="mt-6 flex items-center gap-2">
            <Button variant="primary" onClick={() => void reload()}>
              Try again
            </Button>
            <Link to="/" className="flex h-7 items-center rounded-md px-2.5 text-base text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg">
              Back to the inbox
            </Link>
          </div>
        </div>
      </div>
    );
  if (!d)
    return (
      <div className="flex h-dvh flex-col bg-bg" aria-busy aria-label="Loading the review">
        <div className="flex h-11 shrink-0 items-center gap-3 border-b border-line px-4">
          <div className="skeleton h-3.5 w-16" />
          <div className="skeleton h-3.5 w-[min(420px,50%)]" />
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="hidden w-[216px] shrink-0 border-r border-line px-4.5 pt-5 lg:block xl:w-[232px]">
            {[5, 3, 2, 4].map((n, g) => (
              <div key={g} className="mb-6 space-y-3">
                <div className="skeleton h-2.5 w-14 opacity-60" />
                {Array.from({ length: n }, (_, i) => (
                  <div key={i} className="skeleton h-3" style={{ width: `${58 + (((g + 1) * (i + 2) * 17) % 34)}%` }} />
                ))}
              </div>
            ))}
          </div>
          <div className="w-full shrink-0 border-line px-5 pt-9 lg:w-[clamp(360px,30.5vw,480px)] lg:border-r lg:px-7">
            <div className="skeleton h-3 w-12" />
            <div className="skeleton mt-4 h-6 w-3/5" />
            <div className="mt-7 space-y-3">
              {[96, 100, 88, 62].map((w) => (
                <div key={w} className="skeleton h-3.5" style={{ width: `${w}%` }} />
              ))}
            </div>
            <div className="mt-9 space-y-3">
              {[92, 97, 71].map((w) => (
                <div key={w} className="skeleton h-3" style={{ width: `${w}%` }} />
              ))}
            </div>
          </div>
          <div className="hidden min-w-0 flex-1 px-7 pt-9 lg:block">
            <div className="skeleton h-4 w-64" />
            <div className="mt-7 flex flex-col items-center gap-9">
              {[1, 2, 1, 2, 1].map((n, r) => (
                <div key={r} className="flex gap-8">
                  {Array.from({ length: n }, (_, i) => (
                    <div key={i} className="skeleton h-[62px] w-[208px] !rounded-lg" style={{ animationDelay: `${r * 120}ms` }} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  if (!review || !cur) return <Pipeline d={d} />;

  const st = chapterState(cur, d, readIds, seen);
  const wait = cur.kind === 'unit' && cur.ref ? readWait(cur.ref) : 0;
  const curUnit = cur.kind === 'unit' ? d.units.find((u) => u.id === cur.ref) : undefined;
  const skim = !!curUnit && isSkim(d, curUnit);
  // the path ends at the signature; the evidence after it is optional and has its own end
  const last = idx === list.length - 1 || cur.kind === 'sign';
  const left = list.filter((x) => x.required && chapterState(x, d, readIds, seen) === 'needs').length;
  const at = place(list, cur);
  const stageName = cur.kind === 'brief' ? 'Why this depth' : cur.kind === 'change' || cur.kind === 'how' ? 'Diagram' : cur.kind === 'unit' ? 'Diff' : cur.kind === 'sign' ? 'Attestation' : cur.kind === 'limits' ? 'Trace' : cur.kind === 'finding' || cur.kind === 'refusal' ? 'Code and proof' : 'Proof';
  return (
    <ReviewContext.Provider value={review}>
      <div className="flex h-dvh flex-col bg-bg">
        <TopBar d={d} seconds={seconds} />
        <div role="tablist" aria-label="What to show" className="flex h-10 shrink-0 items-stretch gap-1 border-b border-line px-3 py-1.5 lg:hidden">
          {(['guide', 'stage'] as const).map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={pane === p}
              onClick={() => setPane(p)}
              className={cx('flex-1 rounded-md text-sm font-medium transition-colors', pane === p ? 'bg-surface-2 text-fg' : 'text-fg-3 hover:text-fg-2')}
            >
              {p === 'guide' ? 'Guide' : stageName}
            </button>
          ))}
        </div>
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <Rail cur={cur} r={review} seen={seen} left={left} onNextNeed={nextNeed} />

          <section aria-label="Guide" className="flex min-h-0 w-full shrink-0 flex-col border-line max-lg:contents lg:w-[clamp(360px,30.5vw,480px)] lg:border-r">
            <div ref={guideRef} className={cx('min-h-0 flex-1 overflow-y-auto overscroll-contain', pane !== 'guide' && 'max-lg:hidden')}>
              <div key={cur.id} className="guide anim-chapter px-5 pt-6 pb-10 lg:px-8 lg:pt-9">
                <Guide ch={cur} />
              </div>
            </div>
            <footer className="flex h-14 shrink-0 items-center gap-2 border-t border-line bg-bg px-3 max-lg:order-last max-lg:pb-[env(safe-area-inset-bottom)] lg:px-8 [&_kbd]:max-lg:hidden">
              <Button variant="ghost" disabled={idx === 0} onClick={() => step(-1)} icon={<ArrowLeft className="h-3.5 w-3.5" />} aria-label="Previous chapter" className="max-lg:h-9 max-lg:px-3">
                Back
              </Button>
              <span className="num ml-1 text-sm text-fg-4 lg:hidden">
                {cur.section === 'brief' ? 'Brief' : `${cur.section === 'evidence' ? 'Evidence ' : ''}${at.i} / ${at.n}`}
              </span>
              <div className="ml-auto flex items-center gap-2 [&>button]:max-lg:h-9 [&>button]:max-lg:px-3.5">
                {st === 'needs' && !readOnly && cur.kind === 'finding' && (
                  <>
                    <Button kbd="1" loading={review.busy === `fb-${cur.ref}-accepted`} onClick={() => void review.feedback(cur.ref!, 'accepted')}>
                      Real
                    </Button>
                    <Button kbd="2" loading={review.busy === `fb-${cur.ref}-rejected`} onClick={() => void review.feedback(cur.ref!, 'rejected')}>
                      Not real
                    </Button>
                  </>
                )}
                {st === 'needs' && !readOnly && cur.kind === 'unit' && (wait > 0 ? (
                  <Button variant="secondary" disabled title="The server takes the mark only after the unit has been open long enough to look at it">
                    <span className="num">{skim ? 'Look it over first' : 'Read it first'} · {wait} s</span>
                  </Button>
                ) : (
                  <Button variant="primary" kbd="R" onClick={() => review.setRead(cur.ref!, true)}>
                    {skim ? 'Mark as skimmed' : 'Mark as read'}
                  </Button>
                ))}
                {cur.kind === 'brief' && (
                  <Button variant="primary" onClick={nextNeed} kbd="↵">
                    {signed ? 'See the attestation' : left ? `Start, ${left} left for you` : 'Go to sign-off'}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                )}
                {!last &&
                  cur.kind !== 'brief' &&
                  (st === 'needs' ? (
                    <Button variant="ghost" onClick={() => step(1)} kbd="↵">
                      Later
                    </Button>
                  ) : (
                    <Button variant="primary" onClick={() => step(1)} kbd="↵">
                      Continue
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  ))}
              </div>
            </footer>
          </section>

          <section aria-label="Evidence" className={cx('relative flex min-h-0 min-w-0 flex-1 flex-col', pane !== 'stage' && 'max-lg:hidden')} style={{ ['--stage' as string]: 'var(--bg)' }}>
            <Stage key={cur.id} ch={cur} />
            <Ask key={`ask-${cur.id}`} ch={cur} inputRef={askRef} />
          </section>
        </div>
      </div>
      {toast && (
        <div role="alert" className="anim-pop fixed bottom-[72px] left-1/2 z-50 flex w-[min(440px,calc(100vw-24px))] -translate-x-1/2 items-start gap-3 rounded-lg border border-line-strong bg-surface-2 py-2.5 pr-2 pl-3.5 shadow-pop">
          <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-red" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-base font-medium text-fg">{toast.what}</div>
            <div className="mt-0.5 text-sm text-fg-2 [overflow-wrap:anywhere]">{toast.why.replace(/[.\s]*$/, '')}. Nothing changed, so you can try again.</div>
          </div>
          <button type="button" aria-label="Dismiss" onClick={() => setToast(undefined)} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-3 transition-colors hover:bg-surface-3 hover:text-fg">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <span className="sr-only" aria-live="polite">
        {plural(left, 'item')} left before sign-off
      </span>
    </ReviewContext.Provider>
  );
}
