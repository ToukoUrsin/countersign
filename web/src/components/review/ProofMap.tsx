/**
 * The first screen of a pull request: the whole change as a proof map. Every changed line is one mark; its colour says
 * who stands behind it. Beside it, what the AI could not do for the signer, the signature, and what GitHub says.
 */
import { ArrowRight, ArrowUpRight, Check, ChevronDown, ChevronRight, EyeOff, FlaskConical, GitMerge, Lock, ShieldCheck } from 'lucide-react';
import { memo, useEffect, useMemo, useState, type MutableRefObject, type ReactNode } from 'react';
import type { Criterion, Finding } from '../../../../shared/dossier';
import { fullReadReason } from '../../../../shared/gate';
import { api } from '../../api';
import { highlight } from '../../lib/highlight';
import { useQuery } from '../../lib/hooks';
import { fmtInt, isReproduced, proofMap, STATE_WORD, type MapRow, type MarkState, type Stop } from '../../lib/proofmap';
import { cx, fmtDateTime, plainProof, plural, relTime, shortSha, tidy } from '../../lib/util';
import { Avatar, Button, Kbd } from '../ui';
import { Rich } from './atoms';
import { useReview } from './ctx';

const SW: Record<MarkState, string> = { yours: 'var(--pm-yours)', skim: 'var(--pm-skim)', proven: 'var(--pm-proven)', read: 'var(--pm-read)' };
const plain = (s: string) => tidy(s).replace(/`/g, '');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ───────────────────────────── the map ─────────────────────────────
const Row = memo(function Row({ row, i, on, onToggle }: { row: MapRow; i: number; on: number; onToggle: (key: string) => void }) {
  const group = row.kind === 'group';
  return (
    <div className="pm-row grid grid-cols-1 gap-x-4 lg:grid-cols-[minmax(0,212px)_minmax(0,1fr)]" style={{ ['--r' as string]: Math.min(i, 24) }}>
      <div className="flex h-4 min-w-0 items-center gap-1.5 max-lg:mt-1.5" title={row.title}>
        {group || row.closes ? (
          <button
            type="button"
            onClick={() => onToggle(group ? row.key : row.closes!)}
            aria-expanded={!group}
            title={group ? `Show the ${row.files} files one by one` : 'Fold these files back into one group'}
            className="-ml-1 flex h-4 min-w-0 items-center gap-1 rounded pr-1 text-xs text-fg-2 transition-colors hover:text-fg"
          >
            {group ? <ChevronRight className="h-3 w-3 shrink-0 text-fg-3" /> : <ChevronDown className="h-3 w-3 shrink-0 text-fg-3" />}
            <span className={cx('truncate', !group && 'mono text-[11.5px]')}>{row.label}</span>
          </button>
        ) : (
          <span className="mono truncate text-[11.5px] leading-4 text-fg-2">{row.label}</span>
        )}
        {group && <span className="num ml-auto shrink-0 text-xs text-fg-3">{fmtInt(row.lines)}</span>}
      </div>
      <div className="pm-marks">
        {row.stops.map((s) => (
          <span key={s.i} className="pm-h" data-s={s.i} data-on={on === s.i ? '' : undefined}>
            {s.changed.map((_, k) => {
              const pin = s.pins.find((p) => p.at === k)?.finding;
              return <i key={k} className={cx('pm-m', s.state !== 'proven' && `pm-${s.state}`)} data-pin={pin ? (isReproduced(pin) ? 'run' : 'argued') : undefined} data-dead={pin?.feedback?.verdict === 'rejected' ? '' : undefined} />;
            })}
          </span>
        ))}
      </div>
    </div>
  );
});

/** What is under the pointer or the cursor: the real lines, and for a proven line the run that stands in for reading it. */
function Dock({ s, onOpen, group }: { s: Stop; onOpen: () => void; group?: MapRow }) {
  const r = useReview();
  const first = s.changed[0];
  const last = s.changed[s.changed.length - 1];
  const a = first.n ?? first.o ?? s.hunk.newStart;
  const b = last.n ?? last.o ?? a;
  const proof = s.state === 'proven' ? s.unit.skipProof : undefined;
  const pins = s.pins.map((p) => p.finding).filter((f, i, all) => all.indexOf(f) === i);
  const room = 5 - (proof ? 1 : 0) - Math.min(pins.length, 2);
  const shown = s.changed.slice(0, s.changed.length > room ? room - 1 : room);
  const openEvidence = (id: string) => {
    r.select('proof', id);
    r.go('proof');
  };
  return (
    <div className="flex h-[150px] shrink-0 flex-col border-t border-line bg-panel px-7 pt-3 pb-2.5 max-lg:h-auto max-lg:min-h-[150px] max-lg:px-4">
      <div className="flex h-5 items-center gap-2 text-sm">
        <span className="pm-sw" style={{ background: SW[s.state] }} />
        <span className="shrink-0 font-medium text-fg">{STATE_WORD[s.state]}</span>
        <span className="num shrink-0 text-fg-3">{s.unit.id}</span>
        <span className="min-w-0 truncate text-fg-2" title={plain(s.unit.title)}>
          {plain(s.unit.title)}
        </span>
        <span className="mono ml-auto shrink-0 pl-3 text-xs text-fg-3 max-md:hidden" title={s.path}>
          {group ? `1 of ${group.files} files · ` : ''}
          {s.path.split('/').pop()}:{a}
          {b !== a ? `–${b}` : ''}
        </span>
        <button type="button" onClick={onOpen} className="flex h-5 shrink-0 items-center gap-1 rounded border border-line px-1.5 text-xs text-fg-2 transition-colors hover:border-line-strong hover:text-fg">
          Open
          <ArrowRight className="h-3 w-3" />
        </button>
      </div>
      <div className="mt-2 min-h-0 flex-1 overflow-hidden">
        {proof && (
          <div className="flex h-[18px] items-center gap-2 text-sm text-fg-2">
            <Check className="h-3.5 w-3.5 shrink-0 text-green" strokeWidth={2.4} />
            <span className="min-w-0 truncate" title={cap(plainProof(proof.text))}>
              {cap(plainProof(proof.text))}
            </span>
            {proof.evidenceIds.map((id) => (
              <button key={id} type="button" onClick={() => openEvidence(id)} title={r.d.evidence.find((e) => e.id === id)?.conclusion} className="num h-[18px] shrink-0 rounded border border-line px-1 text-xs text-fg-3 transition-colors hover:border-line-strong hover:text-fg">
                {id}
              </button>
            ))}
          </div>
        )}
        {pins.slice(0, 2).map((f) => (
          <button key={f.id} type="button" onClick={() => r.go(f.id)} className="flex h-[18px] w-full items-center gap-2 text-left text-sm text-fg-2 hover:text-fg">
            <FindingMark f={f} />
            <span className="num shrink-0 text-fg-3">{f.id}</span>
            <span className="min-w-0 truncate">{plain(f.title)}</span>
            <span className="shrink-0 text-xs text-fg-3">{isReproduced(f) ? 'reproduced by a failing test' : 'argued from the code'}</span>
          </button>
        ))}
        <div className="code mt-0.5 !text-[11.5px] !leading-[18px]">
          {shown.map((l, i) => (
            <div key={i} className="flex min-w-0">
              <span className={cx('w-4 shrink-0 select-none', l.t === 'add' ? 'text-green' : 'text-red')}>{l.t === 'add' ? '+' : '−'}</span>
              <span className="min-w-0 truncate whitespace-pre text-fg-2">{highlight(l.s.replace(/^\s+/, (w) => w.replace(/\t/g, '  ')), s.language) || ' '}</span>
            </div>
          ))}
          {s.changed.length > shown.length && <div className="pl-4 font-sans text-xs text-fg-4">{plural(s.changed.length - shown.length, 'more line')} in this hunk</div>}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── the rail ─────────────────────────────
function Section({ title, aside, children, className }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('px-5 pt-4', className)}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-medium text-fg-3">{title}</h2>
        {aside && <div className="num min-w-0 truncate text-xs text-fg-3">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

const CRIT: Record<Criterion['status'], { word: string; tone: string }> = {
  proven: { word: 'proven by a run', tone: 'text-green' },
  supported: { word: 'supported by a run, not proven', tone: 'text-green' },
  unproven: { word: 'unproven: nothing ran for it', tone: 'text-fg-3' },
  violated: { word: 'fails: a run contradicts it', tone: 'text-red' },
};

function CritIcon({ status }: { status: Criterion['status'] }) {
  if (status === 'proven')
    return (
      <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden>
        <circle cx="6" cy="6" r="6" fill="var(--green)" />
        <path d="M3.4 6.2l1.8 1.8 3.4-3.8" fill="none" stroke="var(--bg)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (status === 'supported')
    return (
      <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden>
        <circle cx="6" cy="6" r="5.2" fill="none" stroke="var(--green)" strokeWidth="1.5" />
        <path d="M3.6 6.2l1.7 1.6 3.1-3.4" fill="none" stroke="var(--green)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (status === 'violated')
    return (
      <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden>
        <circle cx="6" cy="6" r="6" fill="var(--red)" />
        <path d="M4 4l4 4M8 4l-4 4" fill="none" stroke="var(--bg)" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden>
      <circle cx="6" cy="6" r="5.2" fill="none" stroke="var(--fg-3)" strokeWidth="1.5" strokeDasharray="2.2 2" />
    </svg>
  );
}

/** A finding: a dot when a failing test reproduces it, a ring when it is argued from the code. Red while it stands, grey once judged not real. */
export function FindingMark({ f }: { f: Finding }) {
  const dead = f.feedback?.verdict === 'rejected';
  const c = dead ? 'var(--fg-4)' : f.severity === 'blocker' || f.severity === 'major' ? 'var(--pm-pin)' : 'var(--fg-3)';
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3 shrink-0" aria-hidden>
      {isReproduced(f) ? <circle cx="6" cy="6" r="4.2" fill={c} /> : <circle cx="6" cy="6" r="3.4" fill="none" stroke={c} strokeWidth="1.6" />}
    </svg>
  );
}

function MergeBox() {
  const { d } = useReview();
  const q = useQuery(() => api.github(d.slug), [d.slug, d.signoff?.at], { pollMs: () => 20_000 });
  const g = q.data;
  const state = g?.status?.state;
  const merged = g?.prState === 'MERGED';
  const ok = !!g && (merged || state === 'success' || (!g.required && g.prState === 'OPEN'));
  const dot = !g ? 'bg-fg-4' : state === 'success' ? 'bg-green' : state === 'failure' || state === 'error' ? 'bg-red' : state === 'pending' ? 'bg-amber' : 'bg-fg-4';
  const word = !g ? 'not read' : state === 'success' ? 'passed' : state === 'failure' || state === 'error' ? 'failed' : state === 'pending' ? 'pending' : 'not set';
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between text-xs text-fg-3">
        <span className="font-medium">On GitHub</span>
        {g && <span className="num">read {relTime(g.readAt)}</span>}
      </div>
      <div className="rounded-lg border border-line">
        <div className="flex items-center gap-2 px-3 pt-2.5">
          <span className={cx('h-2 w-2 shrink-0 rounded-full', dot)} />
          <span className="mono min-w-0 truncate text-xs text-fg">countersign/sign-off</span>
          <span className="ml-auto shrink-0 text-xs text-fg-3">
            {g?.required ? 'Required · ' : ''}
            {word}
          </span>
        </div>
        <p className="truncate px-3 pt-0.5 pl-7 text-xs text-fg-3" title={g?.status?.description}>
          {!g ? (q.loading ? 'Reading GitHub' : 'GitHub could not be read just now. Nothing is assumed.') : g.status ? g.status.description : `No check on commit ${shortSha(g.headSha)} yet`}
        </p>
        <div className="mt-2.5 flex items-center gap-2 border-t border-line px-3 py-2">
          <GitMerge className={cx('h-3.5 w-3.5 shrink-0', ok ? 'text-green' : 'text-fg-3')} />
          <span className="min-w-0 flex-1 truncate text-sm text-fg-2">{merged ? 'Merged' : !g ? 'Merge state unknown' : ok ? (g.required ? 'Merging is allowed' : 'Not gated on this branch') : 'Merging is blocked'}</span>
          {ok && !merged ? (
            <a href={d.pr.url} target="_blank" rel="noreferrer" className="flex h-6 shrink-0 items-center gap-1 rounded-md bg-green px-2 text-xs font-medium text-bg">
              Merge pull request
              <ArrowUpRight className="h-3 w-3" />
            </a>
          ) : (
            !merged && (
              <span aria-disabled className="flex h-6 shrink-0 cursor-not-allowed items-center rounded-md border border-line bg-surface-2 px-2 text-xs font-medium text-fg-4" title="GitHub keeps this locked until a named person signs">
                Merge pull request
              </span>
            )
          )}
        </div>
      </div>
      {g && !g.publishes && <p className="mt-1.5 text-xs text-fg-3">This demo copy does not post to GitHub. On the connected instance the check turns green under your name.</p>}
    </div>
  );
}

function Rail({ left, onStart }: { left: number; onStart: () => void }) {
  const r = useReview();
  const { d, c } = r;
  const a = d.signoff;
  const crit = d.requirement.criteria;
  const by = (s: Criterion['status']) => crit.filter((x) => x.status === s).length;
  const openCrit = (id: string) => {
    r.select('asked', id);
    r.go('asked');
  };
  const sev = (['blocker', 'major', 'minor', 'note'] as const).map((s) => ({ s, n: d.findings.filter((f) => f.severity === s).length })).filter((x) => x.n);
  const order = { blocker: 0, major: 1, minor: 2, note: 3 } as const;
  const findings = [...d.findings].sort((x, y) => order[x.severity] - order[y.severity]);
  const st = d.selfTest;
  const au = d.audit;
  const weak = !!st && st.planted >= 2 && st.caught / st.planted < 0.5;
  const unitsLeft = c.required.length - c.requiredRead;
  const unjudged = c.findingsTotal - c.findingsJudged;
  const parts = [c.blockingOpen && plural(c.blockingOpen, 'decision'), unjudged && plural(unjudged, 'finding'), unitsLeft && `${plural(unitsLeft, 'unit')} to read`].filter(Boolean) as string[];
  const started = c.requiredRead + c.findingsJudged + c.decisionsAnswered > 0;
  const who = r.me?.name || r.me?.login || 'you';
  const waiting = !!d.live?.firstSign && d.live.firstSign.signer === r.me?.login;
  const row = 'flex w-full items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-surface-2';
  return (
    <aside aria-label="What needs you" className="flex min-h-0 w-full shrink-0 flex-col border-line lg:w-[372px] lg:border-l">
      <div className="min-h-0 flex-1 pb-4 lg:overflow-y-auto">
        <Section
          title="Asked"
          aside={
            <a href={d.requirement.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-fg">
              {d.requirement.id}
              <ArrowUpRight className="h-3 w-3" />
            </a>
          }
        >
          <button type="button" onClick={() => r.go('asked')} className="line-clamp-2 text-left text-base text-fg hover:underline hover:decoration-line-strong hover:underline-offset-4">
            <Rich text={d.requirement.title} verbatim />
          </button>
          {crit.length > 0 ? (
            <>
              <div className="mt-2 flex flex-wrap gap-1">
                {crit.map((x) => (
                  <button key={x.id} type="button" onClick={() => openCrit(x.id)} title={`${x.id} ${CRIT[x.status].word}. ${plain(x.text)}`} className="num flex h-6 items-center gap-1.5 rounded-md border border-line pr-2 pl-1.5 text-xs text-fg-2 transition-colors hover:border-line-strong hover:text-fg">
                    <CritIcon status={x.status} />
                    {x.id}
                  </button>
                ))}
              </div>
              <p className="num mt-1.5 text-xs text-fg-3">
                {(['proven', 'supported', 'unproven', 'violated'] as const)
                  .filter((s) => by(s))
                  .map((s, i) => (
                    <span key={s} className={s === 'violated' ? 'text-red' : undefined}>
                      {i > 0 && <span className="text-fg-4"> · </span>}
                      {by(s)} {s === 'violated' ? 'fails' : s}
                    </span>
                  ))}
              </p>
            </>
          ) : (
            <p className="mt-1 text-xs text-fg-3">No acceptance criteria were derived from it.</p>
          )}
        </Section>

        {d.refusals.length > 0 && (
          <Section title={`${plural(d.refusals.length, 'decision')} the AI refused to make`} aside="no option recommended">
            <div className="-mx-2">
              {d.refusals.map((q) => {
                const chosen = q.options.find((o) => o.id === q.answer?.optionId);
                return (
                  <button key={q.id} type="button" onClick={() => r.go(q.id)} className={cx(row, 'items-start py-1.5')}>
                    <span className="mt-[3px]">
                      <NavGlyph kind="refusal" state={q.answer ? 'done' : q.blocking ? 'needs' : 'todo'} />
                    </span>
                    <span className="num mt-px w-5 shrink-0 text-xs text-fg-3">{q.id}</span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-sm text-fg-2">{plain(q.question)}</span>
                      <span className="mt-0.5 block truncate text-xs text-fg-3">{chosen ? `You chose: ${chosen.label}` : `${plural(q.options.length, 'option')}${q.blocking ? ' · blocks the signature' : ' · optional'}`}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </Section>
        )}

        {findings.length > 0 && (
          <Section
            title={`${plural(findings.length, 'finding')} to judge`}
            aside={sev.map((x, i) => (
              <span key={x.s} className={x.s === 'blocker' || x.s === 'major' ? 'text-red' : undefined}>
                {i > 0 && <span className="text-fg-4"> · </span>}
                {x.n} {x.s}
              </span>
            ))}
          >
            <div className="-mx-2">
              {findings.map((f) => (
                <button key={f.id} type="button" onClick={() => r.go(f.id)} title={plain(f.title)} className={cx(row, 'h-[26px]')}>
                  <FindingMark f={f} />
                  <span className="num w-7 shrink-0 text-xs text-fg-3">{f.id}</span>
                  <span className={cx('min-w-0 flex-1 truncate text-sm', f.feedback?.verdict === 'rejected' ? 'text-fg-3 line-through decoration-fg-4' : 'text-fg-2')}>{plain(f.title)}</span>
                  {f.feedback ? (
                    <span className={cx('shrink-0 text-xs', f.feedback.verdict === 'accepted' ? 'text-red' : 'text-fg-3')}>{f.feedback.verdict === 'accepted' ? 'real' : 'not real'}</span>
                  ) : (
                    isReproduced(f) && (
                      <span className="flex shrink-0 items-center gap-1 text-xs text-fg-3" title="Reproduced: a failing test exists">
                        <FlaskConical className="h-3 w-3" />
                        <span className="max-xl:hidden">reproduced</span>
                      </span>
                    )
                  )}
                </button>
              ))}
            </div>
          </Section>
        )}

        <Section title="The reviewer, tested">
          <div className="-mx-2">
            {(st || au) && (
              <button type="button" onClick={() => r.go('reviewer')} className={cx(row, 'items-start py-1')}>
                <ShieldCheck className={cx('mt-[3px] h-3.5 w-3.5 shrink-0', weak ? 'text-red' : 'text-fg-3')} />
                <span className="num min-w-0 flex-1 text-sm text-fg-2">
                  {st && (
                    <>
                      Planted bugs caught{' '}
                      <span className={cx('font-medium', weak ? 'text-red' : 'text-fg')}>
                        {st.caught} of {st.planted}
                      </span>
                    </>
                  )}
                  {st && au && <span className="text-fg-4"> · </span>}
                  {au && (
                    <>
                      second model read {fmtInt(au.linesAudited)} skipped lines:{' '}
                      <span className={cx('font-medium', au.issues.length ? 'text-red' : 'text-fg')}>{plural(au.issues.length, 'issue')}</span>
                    </>
                  )}
                </span>
              </button>
            )}
            <button type="button" onClick={() => r.go('limits')} className={cx(row, 'h-[26px]')}>
              <EyeOff className="h-3.5 w-3.5 shrink-0 text-fg-3" />
              <span className="min-w-0 flex-1 text-sm text-fg-2">What nobody checked</span>
              <span className="num text-sm font-medium text-fg">{d.notChecked.length}</span>
              <ChevronRight className="h-3.5 w-3.5 text-fg-4" />
            </button>
          </div>
        </Section>
      </div>

      <div className="shrink-0 space-y-3.5 border-t border-line px-5 pt-3.5 pb-4 max-lg:pb-24">
        <div>
          <div className="flex items-center gap-2.5">
            {a ? (
              <span className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-full', a.decision === 'accepted' ? 'bg-green text-bg' : 'bg-red text-bg')}>
                <Check className="h-3.5 w-3.5" strokeWidth={2.6} />
              </span>
            ) : (
              <Avatar src={r.me?.avatarUrl} name={who} size={24} />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-medium text-fg">{a ? `${a.decision === 'accepted' ? 'Countersigned' : 'Changes requested'} by ${a.signerName ?? `@${a.signer}`}${a.cosign ? ` and ${a.cosign.signerName ?? `@${a.cosign.signer}`}` : ''}` : who}</div>
              <div className="num truncate text-xs text-fg-3">{a ? `${fmtDateTime(a.at)} · commit ${shortSha(a.headSha)}` : left ? parts.join(' · ') : waiting ? 'Your signature is in. A second person signs next.' : 'Nothing left. Your name is what is missing.'}</div>
            </div>
            {!a && left > 0 && (
              <span className="num shrink-0 text-right text-xs text-fg-3">
                <span className="block text-xl leading-6 font-semibold text-fg">{left}</span>
                left
              </span>
            )}
          </div>
          <Button variant="primary" size="lg" onClick={a || !left ? () => r.go('sign') : onStart} kbd="↵" className="mt-3 w-full max-lg:hidden">
            {a ? 'See the attestation' : left ? (started ? 'Continue with what needs you' : 'Start with what needs you') : 'Go to your signature'}
          </Button>
          {!a && left > 0 && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-fg-3">
              <Lock className="h-3 w-3 shrink-0" />
              Your signature unlocks when nothing is left.
            </p>
          )}
        </div>
        <MergeBox />
      </div>
    </aside>
  );
}

// ───────────────────────────── the screen ─────────────────────────────
export type MapKeys = MutableRefObject<((key: string) => boolean) | undefined>;

export function ProofMapScreen({ left, onStart, keys, ask }: { left: number; onStart: () => void; keys: MapKeys; ask: ReactNode }) {
  const r = useReview();
  const { d } = r;
  const ro = d.routing;
  const reason = fullReadReason(d);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const m = useMemo(() => proofMap(d, r.readIds, open), [d, r.readIds, open]);
  const first = useMemo(() => (m.stops.find((s) => s.state === 'yours') ?? m.stops.find((s) => s.state === 'skim') ?? m.stops[0])?.i ?? 0, [m]);
  const [cursor, setCursor] = useState<number>();
  const [hot, setHot] = useState<number>();
  const at = hot ?? cursor ?? first;
  const stop = m.stops[at];

  const openUnit = (id: string) => {
    if (r.list.some((x) => x.id === id)) r.go(id);
    else {
      r.select('skipped', id);
      r.go('skipped');
    }
  };
  const toggle = (key: string) => {
    setCursor(undefined);
    setOpen((p) => {
      const n = new Set(p);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  };

  // the keyboard walks hunk by hunk; a folded group is one step
  const nav = useMemo(() => m.rows.flatMap((row, ri) => (row.kind === 'group' ? [{ s: row.stops[0].i, ri }] : row.stops.map((s) => ({ s: s.i, ri })))), [m]);
  useEffect(() => {
    keys.current = (k) => {
      if (!nav.length) return false;
      if (k === 'Escape') {
        if (cursor === undefined) return false;
        setCursor(undefined);
        return true;
      }
      if (k === 'Enter') {
        if (cursor === undefined) return false;
        openUnit(m.stops[cursor].unit.id);
        return true;
      }
      const cur = cursor === undefined ? -1 : nav.findIndex((x) => x.s === cursor);
      if (cur < 0) {
        setCursor(nav.find((x) => x.s === first)?.s ?? nav[0].s);
        return true;
      }
      let to = cur;
      if (k === 'ArrowRight') to = Math.min(nav.length - 1, cur + 1);
      else if (k === 'ArrowLeft') to = Math.max(0, cur - 1);
      else if (k === 'ArrowDown') {
        const n = nav.findIndex((x) => x.ri > nav[cur].ri);
        to = n < 0 ? cur : n;
      } else if (k === 'ArrowUp') {
        const prev = nav.filter((x) => x.ri < nav[cur].ri).pop();
        to = prev ? nav.findIndex((x) => x.ri === prev.ri) : cur;
      } else return false;
      setCursor(nav[to].s);
      document.querySelector(`[data-s="${nav[to].s}"] > i`)?.scrollIntoView({ block: 'nearest' });
      return true;
    };
    return () => {
      keys.current = undefined;
    };
  });

  const total = ro.totalLines || m.total;
  const yours = reason ? total : ro.readLines;
  const a = d.signoff;
  const none = !reason && yours === 0;
  const legend: { s: MarkState; n: number; word: string }[] = (
    reason
      ? [{ s: 'yours' as const, n: m.count.yours, word: 'yours to read' }]
      : [
          { s: 'yours' as const, n: m.count.yours, word: 'yours to read' },
          { s: 'skim' as const, n: m.count.skim, word: 'to skim' },
          { s: 'proven' as const, n: m.count.proven, word: 'proven by a run' },
        ]
  ).concat(m.count.read ? [{ s: 'read' as const, n: m.count.read, word: a ? 'read under a name' : 'read by you' }] : []);
  const pinned = d.findings.length - m.unpinned.length;
  const group = m.rows.find((row) => row.kind === 'group' && row.stops.some((s) => s.i === at));

  return (
    <div className="flex min-h-0 flex-1 flex-col max-lg:overflow-y-auto lg:flex-row">
      <section aria-label="Proof map" className="flex min-w-0 flex-1 flex-col lg:min-h-0">
        <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          <header className="px-4 pt-5 lg:px-7 lg:pt-7">
            <h1 className="num text-[26px] leading-[32px] font-semibold tracking-[-0.022em] text-fg lg:text-[34px] lg:leading-[40px]">
              {reason ? (
                <>
                  All <span style={{ color: 'var(--pm-yours)' }}>{fmtInt(total)}</span> lines {a ? 'were the signer’s' : 'are yours'}.
                </>
              ) : none ? (
                <>
                  None of the {fmtInt(total)} changed lines {a ? 'needed a reader' : 'are yours'}.
                </>
              ) : (
                <>
                  <span style={{ color: 'var(--pm-yours)' }}>{fmtInt(yours)}</span> of {fmtInt(total)} changed lines {a ? 'were the signer’s' : 'are yours'}.
                </>
              )}
            </h1>
            {reason && (
              <p className="mt-1.5 max-w-[86ch] text-md text-fg-2" title={reason}>
                {reason.replace(/ Read all of it, then say whether you found anything the AI missed\.$/, '')}
              </p>
            )}
            <div className="mt-3.5 flex flex-wrap items-center gap-x-6 gap-y-2">
              {legend.map((x) => (
                <span key={x.s} className="flex items-center gap-2">
                  <span className="pm-sw" style={{ background: SW[x.s] }} />
                  <span className="num text-xl leading-6 font-semibold text-fg">{fmtInt(x.n)}</span>
                  <span className="text-md text-fg-2">{x.word}</span>
                </span>
              ))}
              {reason && d.units.length > 0 && (
                <span className="num text-sm text-fg-3" title="The reading plan that would have applied if it had not been set aside">
                  Without that, the plan asked for {fmtInt(ro.readLines)} read · {fmtInt(ro.skimLines)} skim · {fmtInt(ro.skipLines)} proven
                </span>
              )}
              {d.findings.length > 0 && (
                <span className="flex items-center gap-3 text-sm text-fg-3 lg:ml-auto" title={m.unpinned.length ? `${pinned} of ${d.findings.length} findings cite a changed line and are pinned to it` : 'Each finding is pinned to the line it cites'}>
                  <span className="flex items-center gap-1.5">
                    <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden>
                      <circle cx="6" cy="6" r="4.2" fill="var(--pm-pin)" />
                    </svg>
                    finding, reproduced
                  </span>
                  <span className="flex items-center gap-1.5">
                    <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden>
                      <circle cx="6" cy="6" r="3.4" fill="none" stroke="var(--pm-pin)" strokeWidth="1.6" />
                    </svg>
                    argued
                  </span>
                </span>
              )}
            </div>
          </header>

          {m.rows.length ? (
            <div
              role="group"
              aria-label={`${fmtInt(m.total)} changed lines in ${plural(d.files.length, 'file')}. Arrow keys move, Enter opens.`}
              className="mt-5 space-y-px px-4 pb-6 lg:px-7"
              onMouseOver={(e) => {
                const el = (e.target as HTMLElement).closest<HTMLElement>('[data-s]');
                setHot(el ? Number(el.dataset.s) : undefined);
              }}
              onMouseLeave={() => setHot(undefined)}
              onClick={(e) => {
                const el = (e.target as HTMLElement).closest<HTMLElement>('[data-s]');
                if (!el) return;
                const s = m.stops[Number(el.dataset.s)];
                // a finger has no hover: the first tap shows the lines, the dock opens them
                if (window.matchMedia('(hover: none)').matches) setCursor(s.i);
                else openUnit(s.unit.id);
              }}
            >
              {m.rows.map((row, i) => (
                <Row key={row.key} row={row} i={i} on={row.stops.some((s) => s.i === at) ? at : -1} onToggle={toggle} />
              ))}
            </div>
          ) : (
            <p className="mt-6 px-4 text-base text-fg-2 lg:px-7">The diff was not grouped into units, so there is no map to draw. What did not finish is listed under what nobody checked.</p>
          )}
        </div>
        {stop && <Dock s={stop} group={group} onOpen={() => openUnit(stop.unit.id)} />}
        <div className="max-lg:hidden">{ask}</div>
      </section>

      <Rail left={left} onStart={onStart} />

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg px-3 pt-2.5 pb-[calc(10px+env(safe-area-inset-bottom))] lg:hidden">
        <Button variant="primary" size="lg" onClick={a || !left ? () => r.go('sign') : onStart} className="w-full">
          {a ? 'See the attestation' : left ? `Start, ${left} left for you` : 'Go to your signature'}
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ───────────────────────────── state glyphs ─────────────────────────────
/**
 * State of one thing that needs the signer, 14px. The shape says what it is (a decision, a finding, a unit to read);
 * the fill says where it stands. A unit carries the colour its lines have on the map.
 */
export function NavGlyph({ kind, state, tone }: { kind: 'refusal' | 'finding' | 'unit' | 'sign'; state: 'needs' | 'done' | 'todo' | 'real' | 'dead'; tone?: MarkState }) {
  const c = 'h-3.5 w-3.5 shrink-0';
  if (kind === 'refusal')
    return (
      <svg viewBox="0 0 14 14" className={c} aria-hidden>
        {state === 'done' ? (
          <>
            <path d="M7 1.2L12.8 7 7 12.8 1.2 7z" fill="var(--green)" />
            <path d="M4.7 7.1l1.6 1.6 3-3.3" fill="none" stroke="var(--bg)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </>
        ) : (
          <>
            <path d="M7 1.8L12.2 7 7 12.2 1.8 7z" fill="none" stroke={state === 'needs' ? 'var(--fg-2)' : 'var(--fg-4)'} strokeWidth="1.5" strokeLinejoin="round" />
            {state === 'needs' && <circle cx="7" cy="7" r="1.5" fill="var(--fg-2)" />}
          </>
        )}
      </svg>
    );
  if (kind === 'finding')
    return (
      <svg viewBox="0 0 14 14" className={c} aria-hidden>
        {state === 'real' ? (
          <path d="M7 1.6l5.6 10.2H1.4z" fill="var(--pm-pin)" stroke="var(--pm-pin)" strokeWidth="1.2" strokeLinejoin="round" />
        ) : state === 'dead' ? (
          <>
            <path d="M7 2.2l5 9.2H2z" fill="none" stroke="var(--fg-4)" strokeWidth="1.4" strokeLinejoin="round" />
            <path d="M2 12.6L12 2.4" stroke="var(--fg-4)" strokeWidth="1.4" strokeLinecap="round" />
          </>
        ) : (
          <>
            <path d="M7 2.2l5 9.2H2z" fill="none" stroke="var(--fg-2)" strokeWidth="1.5" strokeLinejoin="round" />
            <circle cx="7" cy="8.6" r="1.1" fill="var(--fg-2)" />
          </>
        )}
      </svg>
    );
  if (kind === 'unit')
    return (
      <svg viewBox="0 0 14 14" className={c} aria-hidden>
        <rect x="2" y="2" width="10" height="10" rx="2.5" fill={state === 'done' ? 'var(--pm-read)' : SW[tone ?? 'yours']} />
        {state === 'done' && <path d="M4.6 7.1l1.7 1.7 3.1-3.4" fill="none" stroke="var(--bg)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />}
      </svg>
    );
  return (
    <svg viewBox="0 0 14 14" className={c} aria-hidden>
      {state === 'done' ? (
        <>
          <circle cx="7" cy="7" r="6" fill="var(--green)" />
          <path d="M4.3 7.2l1.9 1.9 3.6-4" fill="none" stroke="var(--bg)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <circle cx="7" cy="7" r="5.25" fill="none" stroke={state === 'needs' ? 'var(--fg-2)' : 'var(--fg-4)'} strokeWidth="1.5" strokeDasharray={state === 'needs' ? undefined : '2.2 2.2'} />
      )}
    </svg>
  );
}
