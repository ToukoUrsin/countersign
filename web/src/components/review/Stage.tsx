/** The stage: the artifact that backs whatever the guide is saying. Diagram, diff, run output or attestation. */
import { ArrowRight, ExternalLink, Sparkles } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { Canary, ChangeUnit, CodeRef, Diagram, DiscardedFinding, Dossier, Evidence, RunResult } from '../../../../shared/dossier';
import { api } from '../../api';
import type { Chapter } from '../../lib/chapters';
import { CodeBlock } from '../../lib/highlight';
import { useQuery } from '../../lib/hooks';
import { liveDiagram } from '../../lib/live';
import { fullReadReason } from '../../../../shared/gate';
import { cx, fmtDateTime, fmtMs, plainProof, plural, repoPath, shortSha, tidy, TIER_NAME } from '../../lib/util';
import { DiffViewer, RefQuote } from '../DiffViewer';
import { Flow } from '../Flow';
import { Button, CopyButton } from '../ui';
import { Glyph, kindLabel, Rich, Strength, Tabs, Typed } from './atoms';
import { useReview } from './ctx';
import { selected } from './select';

function Frame({ bar, aside, children, pad = true, fit = false }: { bar?: ReactNode; aside?: ReactNode; children: ReactNode; pad?: boolean; /** the content is drawn to fit the pane: no scroll margin under it */ fit?: boolean }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {(bar || aside) && (
        <div className="flex h-11 shrink-0 items-center gap-3 border-b border-line px-5 max-lg:overflow-x-auto max-lg:px-3 [&_button]:whitespace-nowrap">
          {bar}
          {aside && <div className="ml-auto flex min-w-0 items-center gap-2 truncate text-sm text-fg-3 max-lg:hidden">{aside}</div>}
        </div>
      )}
      {aside && <div className="shrink-0 border-b border-line px-4 py-1.5 text-sm text-fg-3 lg:hidden">{aside}</div>}
      <div data-flow-pane className={cx('anim-stage min-h-0 flex-1 overflow-auto', fit ? 'pb-4' : 'pb-10', pad && 'px-6 pt-6')}>
        {children}
      </div>
    </div>
  );
}

/** A figure: what it shows, the diagram, then the sentence that explains it. */
function Picture({ diagram, onUnit, onHoverUnit, highlight, autoPlay, bare }: { diagram: Diagram; onUnit?: (id: string) => void; onHoverUnit?: (id?: string) => void; highlight?: string[]; autoPlay?: boolean; /** the text beside it already says what this shows */ bare?: boolean }) {
  return (
    <div className="mx-auto w-full max-w-[720px]">
      {!bare && <h2 className="text-md font-medium text-fg">{tidy(diagram.title)}</h2>}
      {!bare && diagram.caption && (
        <p className="mt-1 line-clamp-2 max-w-[76ch] text-base text-fg-3" title={tidy(diagram.caption).replace(/`/g, '')}>
          <Rich text={diagram.caption} />
        </p>
      )}
      <Flow key={diagram.id} diagram={diagram} onUnit={onUnit} onHoverUnit={onHoverUnit} highlightUnits={highlight} autoPlay={autoPlay} className={bare ? 'mt-2' : 'mt-5'} />
    </div>
  );
}

/** A diagram drawn on request from the dossier. Explanation, never evidence. */
function LivePicture({ kind, id }: { kind: 'unit' | 'finding'; id: string }) {
  const { d } = useReview();
  const q = useQuery(() => liveDiagram(d.slug, kind, id), [d.slug, kind, id]);
  if (q.error)
    return (
      <div className="mx-auto max-w-[520px] px-2 pt-10 text-base text-fg-2">
        <p>This picture could not be drawn. {q.error.message}</p>
        <Button className="mt-3" onClick={() => void q.reload()}>
          Try again
        </Button>
      </div>
    );
  if (!q.data)
    return (
      <div className="mx-auto w-full max-w-[720px]" aria-busy>
        <p className="flex items-center gap-2 text-base text-fg-3">
          <Sparkles className="pulse-dot h-3.5 w-3.5" />
          Drawing this from the {kind === 'finding' ? 'finding and its code' : 'diff'}
        </p>
        <div className="mt-10 flex flex-col items-center gap-11">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-[58px] w-[196px] !rounded-lg" style={{ animationDelay: `${i * 120}ms` }} />
          ))}
        </div>
      </div>
    );
  return (
    <Picture diagram={q.data.diagram} autoPlay bare={kind === 'finding'} />
  );
}

// ───────────────────────────── evidence ─────────────────────────────
function runWords(r: RunResult): { head: string; tone: string } {
  if (r.outcome === 'pass') return { head: `${r.passed} passed`, tone: 'text-green' };
  if (r.outcome === 'fail') return { head: `${r.failed} failed${r.passed ? `, ${r.passed} passed` : ''}`, tone: 'text-red' };
  if (r.outcome === 'build-error') return { head: 'Does not build', tone: 'text-red' };
  return { head: 'Did not run', tone: 'text-amber' };
}

function RunCell({ title, r }: { title: string; r: RunResult }) {
  const w = runWords(r);
  return (
    <div className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-4 py-3">
      <div className="text-sm text-fg-3">{title}</div>
      <div className={cx('num mt-1 text-xl font-medium tracking-[-0.01em]', w.tone)}>{w.head}</div>
      <div className="mt-1 text-sm text-fg-3" title={`${tidy(r.label)} at ${r.sha}`}>
        {tidy(r.label)} · <span className="mono text-xs">{shortSha(r.sha)}</span>
        {r.durationMs ? ` · ${fmtMs(r.durationMs)}` : ''}
      </div>
    </div>
  );
}

function Log({ path, label }: { path: string; label: string }) {
  const { d } = useReview();
  const [open, setOpen] = useState(false);
  const q = useQuery(() => (open ? api.evidence(d.slug, path) : Promise.resolve(undefined)), [open, path]);
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="block text-sm text-fg-3 underline decoration-line-strong underline-offset-4 hover:text-fg">
        Full log, {label}
      </button>
    );
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-sm text-fg-3">
        <span className="mono text-xs">{path}</span>
        <button type="button" onClick={() => setOpen(false)} className="hover:text-fg">
          Hide
        </button>
      </div>
      <pre className="code wrap-code max-h-[420px] overflow-y-auto rounded-lg border border-line bg-panel px-3 py-2 text-fg-2">{q.error ? `The log could not be loaded. ${q.error.message}` : q.data ? repoPath(q.data) : 'Loading the log'}</pre>
    </div>
  );
}

function Block({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-6">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-fg-3">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** The pipeline cuts long titles at a fixed width. The finding it names has the whole sentence. */
function evidenceTitle(e: Evidence, d: Dossier): string {
  const m = /^(Reproduced|Cross-checked|Independent probe|Ablation|Red → green|Regression run): ([\s\S]*)$/.exec(e.title);
  if (!m) return tidy(e.title);
  const rest = m[2].trim();
  const whole = d.findings.find((f) => f.title.startsWith(rest))?.title ?? d.discarded.find((f) => f.title.startsWith(rest))?.title ?? rest;
  const lead = m[1] === 'Independent probe' ? 'Independent test' : m[1] === 'Ablation' ? 'Revert one hunk' : m[1];
  return `${lead}: ${whole.replace(/^revert /, '')}`;
}

const sameTest = (line: string, name: string) => line === name || line.startsWith(`${name}(`) || name.endsWith(`.${line}`);

/** The part of a `dotnet test` log that belongs to one failing test. */
function sliceLog(log: string, name: string): string | undefined {
  const lines = log.split(/\r?\n/);
  const at = lines.findIndex((l) => /^\s*Failed /.test(l) && sameTest(l.replace(/^\s*Failed /, '').replace(/ \[[^\]]*\]\s*$/, '').trim(), name));
  if (at < 0) return undefined;
  let end = lines.findIndex((l, i) => i > at && (/^\s*Failed /.test(l) || /^\[xUnit/.test(l) || /^(Failed!|Passed!|Test Run)/.test(l)));
  if (end < 0) end = lines.length;
  const out = lines
    .slice(at, Math.min(end, at + 28))
    .map((l) => l.replace(/^ {2}/, ''))
    .filter((l) => !/^\s*(Error Message|Stack Trace):\s*$/.test(l));
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out.join('\n') + (end - at > 28 ? '\n…' : '');
}

/**
 * The output that decides the result. A run's excerpt starts at the first failure in the log, which is
 * not always the test this evidence is about: when it is another test, cut the named one out of the log.
 */
function Decisive({ run, failing }: { run: RunResult; failing: string[] }) {
  const { d } = useReview();
  const excerpt = run.excerpt ?? '';
  const first = excerpt.split('\n')[0].trim();
  const named = failing[0];
  const other = !!named && /^[\w.]+$/.test(first) && !sameTest(first, named);
  const q = useQuery(() => (other && run.log ? api.evidence(d.slug, run.log) : Promise.resolve(undefined)), [other, run.log]);
  const own = other && q.data ? sliceLog(q.data, named) : undefined;
  if (!excerpt) return null;
  const waiting = other && !!run.log && !q.data && !q.error;
  return (
    <Block title={own ? `Decisive output of ${named.split('.').pop()}` : other ? 'Output of the first failure in this run' : 'Decisive output'}>
      <pre aria-busy={waiting} className={cx('code wrap-code max-h-[320px] overflow-y-auto rounded-lg border border-line bg-panel px-3 py-2 text-fg-2 transition-opacity', waiting && 'opacity-50')}>{repoPath(own ?? excerpt)}</pre>
      {other && !own && !waiting && <p className="mt-1.5 text-sm text-fg-3">This run had several failures and the excerpt starts at another test. The full log below has the one named above.</p>}
    </Block>
  );
}

export function EvidenceDetail({ e }: { e: Evidence }) {
  const { d } = useReview();
  const runs = [e.base, e.head, e.ablation?.result].filter(Boolean) as RunResult[];
  const failing = [...new Set(runs.flatMap((r) => r.failing ?? []))];
  const decisive = e.ablation?.result ?? (e.head?.outcome !== 'pass' ? e.head : e.base) ?? e.head;
  return (
    <article className="mx-auto w-full max-w-[860px] [overflow-wrap:anywhere]">
      <div className="flex items-center gap-2 text-sm text-fg-3">
        <span>
          Evidence <span className="mono text-xs">{e.id}</span>
        </span>
        <span className="text-fg-4">·</span>
        <Strength s={e.strength} label />
      </div>
      <h2 className="mt-1.5 text-lg font-medium text-fg">{evidenceTitle(e, d)}</h2>
      <p className="mt-1 max-w-[72ch] text-base text-fg-2">
        <Rich text={e.conclusion} />
      </p>

      {(e.base || e.head) && (
        <div className="mt-5 flex items-center gap-3">
          {e.base && <RunCell title="Without the change" r={e.base} />}
          {e.base && e.head && <ArrowRight className="h-4 w-4 shrink-0 text-fg-4" />}
          {e.head && <RunCell title="With the change" r={e.head} />}
        </div>
      )}
      {e.ablation && (
        <div className="mt-5 flex">
          <RunCell title="With this one hunk reverted" r={e.ablation.result} />
        </div>
      )}
      {e.mechanical && (
        <div className="mt-5 rounded-lg border border-line bg-surface px-4 py-3">
          <div className="text-sm text-fg-3">Rule</div>
          <div className="mt-1 text-base text-fg">
            <Rich text={e.mechanical.rule} />
          </div>
          <div className={cx('num mt-2 text-xl font-medium', e.mechanical.matched === e.mechanical.total ? 'text-green' : 'text-amber')}>
            {e.mechanical.matched} of {e.mechanical.total} match
          </div>
          {e.mechanical.exceptions.length > 0 && (
            <ul className="mono mt-2 space-y-0.5 text-xs text-fg-2">
              {e.mechanical.exceptions.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {e.references && (
        <div className="mt-5 rounded-lg border border-line bg-surface px-4 py-3">
          <div className="text-sm text-fg-3">References outside this change</div>
          <div className="num mt-1 text-xl font-medium text-fg">
            {e.references.count} <span className="text-base font-normal text-fg-3">to</span> <span className="mono text-md">{e.references.symbol}</span>
          </div>
        </div>
      )}

      {e.command && (
        <Block title="Command, re-run it yourself" aside={<CopyButton text={e.command} />}>
          <pre className="code wrap-code rounded-lg border border-line bg-panel px-3 py-2 text-fg-2">{e.command}</pre>
        </Block>
      )}
      {failing.length > 0 && (
        <Block title={`${plural(failing.length, 'failing test')}`}>
          <ul className="mono space-y-0.5 text-xs text-fg-2">
            {failing.slice(0, 12).map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </Block>
      )}
      {decisive?.excerpt && <Decisive key={e.id} run={decisive} failing={decisive.failing?.length ? decisive.failing : failing} />}
      {e.probeSource && (
        <Block title="The test that ran" aside={<span className="mono truncate text-xs text-fg-3">{e.probeSource.path.split('/').pop()}</span>}>
          <div className="max-h-[420px] overflow-auto rounded-lg border border-line bg-panel">
            <CodeBlock code={e.probeSource.code} lang={e.probeSource.language} className="px-3 py-2" />
          </div>
        </Block>
      )}
      {(e.references?.sample.length || e.refs?.length) && (
        <Block title="Code it points at">
          <div className="space-y-2">
            {[...(e.refs ?? []), ...(e.references?.sample ?? [])].slice(0, 6).map((r, i) => (
              <RefQuote key={i} r={r} />
            ))}
          </div>
        </Block>
      )}
      {runs.some((r) => r.log) && (
        <div className="mt-6 space-y-2">
          {runs
            .filter((r) => r.log)
            .map((r) => (
              <Log key={r.log} path={r.log!} label={r === e.base ? 'without the change' : r === e.head ? 'with the change' : 'with the hunk reverted'} />
            ))}
        </div>
      )}
      <p className="mt-6 text-sm text-fg-3">Produced by {producer(e.producedBy)}</p>
    </article>
  );
}

/** "verify (skeptic agent) + sandbox" is a stage name and its parts; say who did it. */
function producer(by: string): string {
  const m = /^(\w+)(?:\/([\w-]+))? ?(?:\((.+)\))?(?: \+ (.+))?$/.exec(by);
  if (!m) return tidy(by);
  const who = [m[3], m[4]].filter(Boolean).join(', ') || (m[2] ? `${m[2].replace('-', ' ')}, no model involved` : '');
  return tidy(`the ${m[1]} stage${who ? `: ${who}` : ''}`);
}

function EvidenceList({ ids }: { ids: string[] }) {
  const { d } = useReview();
  const es = ids.map((id) => d.evidence.find((e) => e.id === id)).filter(Boolean) as Evidence[];
  const [cur, setCur] = useState(es[0]?.id);
  useEffect(() => setCur(ids[0]), [ids.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const e = es.find((x) => x.id === cur) ?? es[0];
  if (!e) return <p className="text-base text-fg-3">No evidence is attached.</p>;
  return (
    <div>
      {es.length > 1 && (
        <div className="mx-auto mb-5 flex w-full max-w-[860px] flex-wrap gap-1">
          {es.map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => setCur(x.id)}
              className={cx('h-7 rounded-md px-2.5 text-sm transition-colors', x.id === e.id ? 'bg-surface-2 text-fg' : 'text-fg-3 hover:bg-surface hover:text-fg-2')}
            >
              {x.kind === 'red-green' ? 'Red to green' : x.kind === 'repro' ? 'Independent test' : x.kind === 'quote-check' ? 'Cross-check' : x.kind[0].toUpperCase() + x.kind.slice(1).replace('-', ' ')} <span className="mono text-xs text-fg-4">{x.id}</span>
            </button>
          ))}
        </div>
      )}
      <EvidenceDetail e={e} />
    </div>
  );
}

function Refs({ refs }: { refs: CodeRef[] }) {
  if (!refs.length) return null;
  return (
    <div className="space-y-2">
      {refs.map((r, i) => (
        <RefQuote key={i} r={r} />
      ))}
    </div>
  );
}

function UnitDiff({ unit }: { unit: ChangeUnit }) {
  const { d } = useReview();
  const marks = [...d.findings.filter((f) => f.unitId === unit.id).flatMap((f) => f.refs), ...d.refusals.filter((r) => r.unitId === unit.id).flatMap((r) => r.refs ?? [])];
  return <DiffViewer files={d.files} hunkIds={unit.hunkIds} collapseLarge={unit.ask !== 'read'} marks={marks} />;
}

const unitAside = (u: ChangeUnit) => (
  <span className="num">
    <span className="text-green">+{u.additions}</span> <span className="text-red">−{u.deletions}</span> · {plural(u.fileCount, 'file')}
  </span>
);

// ───────────────────────────── reviewer ─────────────────────────────
/** The pipeline keeps 110 characters of each line; say so instead of ending mid-token. */
const cut = (x: string) => (x.length >= 110 ? `${x}…` : x);

function CanaryDetail({ k }: { k: Canary }) {
  const { d } = useReview();
  const all = d.selfTest?.canaries ?? [];
  const m = /^([\s\S]*?)\s{2,}`([\s\S]*)`\s*→\s*`([\s\S]*)`\s*$/.exec(k.description);
  return (
    <article className="mx-auto w-full max-w-[860px]">
      <div className="text-sm text-fg-3">
        Planted bug {all.indexOf(k) + 1} of {all.length}
      </div>
      <p className="mt-1.5 max-w-[72ch] text-lg text-fg">
        <Rich text={m ? m[1] : k.description} />
      </p>
      {m && (
        <div className="code wrap-code mt-5 overflow-hidden rounded-lg border border-line bg-panel py-1">
          <div className="diff-del px-3">− {cut(m[2])}</div>
          <div className="diff-add px-3">+ {cut(m[3])}</div>
        </div>
      )}
      <p className="mono mt-2 text-xs text-fg-3">
        {k.path}:{k.line}
      </p>
      <div className="mt-6 grid grid-cols-2 gap-3">
        {[
          { who: 'The test suite', ok: k.caughtByTests, yes: 'A test failed', no: 'Every test still passed' },
          { who: 'The reviewer, reading blind', ok: k.caughtByReviewer, yes: 'Flagged it', no: 'Missed it' },
        ].map((x) => (
          <div key={x.who} className="rounded-lg border border-line bg-surface px-4 py-3">
            <div className="text-sm text-fg-3">{x.who}</div>
            <div className={cx('mt-1 flex items-center gap-2 text-md font-medium', x.ok ? 'text-green' : 'text-amber')}>
              <Glyph state={x.ok ? 'done' : 'half'} />
              {x.ok ? x.yes : x.no}
            </div>
          </div>
        ))}
      </div>
      {k.note && (
        <p className="mt-5 max-w-[72ch] text-base text-fg-2">
          <Rich text={k.note} />
        </p>
      )}
      <p className="mt-6 max-w-[72ch] text-sm text-fg-3">The bug was put into a copy of this change, then the tests and a fresh reviewer ran against it without being told. The copy was thrown away afterwards.</p>
    </article>
  );
}

const KILL: Record<DiscardedFinding['reason'], string> = {
  'quote-not-found': 'The code it cited does not exist',
  'repro-failed': 'The reproduction passed, so the defect did not occur',
  duplicate: 'Same defect as another finding',
  'out-of-scope': 'Not caused by this change',
  'contradicted-by-evidence': 'Contradicted by a run or by the code',
};

function KilledDetail({ x }: { x: DiscardedFinding }) {
  return (
    <article className="mx-auto w-full max-w-[860px]">
      <div className="text-sm text-fg-3">Raised by the reviewer, killed before it reached you</div>
      <h2 className="mt-1.5 text-lg font-medium text-fg-2 line-through decoration-fg-4">
        <Rich text={x.title} />
      </h2>
      <Block title="What it claimed">
        <p className="max-w-[72ch] text-base text-fg-2">
          <Rich text={x.claimed} />
        </p>
      </Block>
      <Block title={`Why it was killed: ${KILL[x.reason].toLowerCase()}`}>
        <p className="max-w-[72ch] text-base text-fg-2">
          <Rich text={x.detail} />
        </p>
      </Block>
    </article>
  );
}

// ───────────────────────────── limits ─────────────────────────────
function Trace() {
  const { d } = useReview();
  const cost = d.stages.reduce((a, s) => a + (s.costUsd ?? 0), 0);
  return (
    <article className="mx-auto w-full max-w-[860px]">
      <h2 className="text-md font-medium text-fg">How this dossier was produced</h2>
      <p className="mt-1 max-w-[68ch] text-base text-fg-3">
        Each stage in order. A stage that failed or was skipped is listed as not checked; it never turns into a pass.
        {cost > 0 && ` Model cost for this review: $${cost.toFixed(2)}.`}
      </p>
      <ol className="mt-6">
        {d.stages.map((s, i) => (
          <li key={s.name} className="flex gap-3 border-t border-line py-2.5 first:border-t-0">
            <span className="num w-5 shrink-0 pt-px text-right text-sm text-fg-4">{i + 1}</span>
            <Glyph state={s.status === 'done' ? 'seen' : s.status === 'failed' ? 'fail' : s.status === 'skipped' ? 'half' : 'todo'} className="mt-[3px]" />
            <div className="min-w-0 flex-1">
              <div className="text-base text-fg">{tidy(s.title)}</div>
              {s.detail && <div className="mt-0.5 text-sm text-fg-3 [overflow-wrap:anywhere]">{tidy(s.detail)}</div>}
            </div>
            {s.costUsd ? <span className="num shrink-0 text-sm text-fg-3">${s.costUsd.toFixed(2)}</span> : null}
          </li>
        ))}
      </ol>
      <p className="mt-5 text-sm text-fg-3">
        Policy {d.routing.policyVersion}. Generated {fmtDateTime(d.generatedAt)}.
      </p>
    </article>
  );
}

// ───────────────────────────── attestation ─────────────────────────────
/** A risk line the dossier wrote starts with the id it is about; anything else was typed by the signer. */
const AI_RISK = /^(?:FN\d+ \(|E\d+: |AC\d+ (?:unproven|violated): |\d+ source hunks? can be reverted )/;

function AttList({ title, items, empty, typed }: { title: string; items: string[]; empty: string; /** true for an item a person typed: shown as typed, never reworded */ typed?: (x: string) => boolean }) {
  return (
    <section className="border-t border-line py-4">
      <h3 className="flex items-baseline justify-between text-sm font-medium text-fg">
        {title}
        <span className="num font-normal text-fg-3">{items.length}</span>
      </h3>
      {items.length ? (
        <ul className="mt-2 space-y-1.5 text-base text-fg-2">
          {items.map((x, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-[9px] h-px w-2 shrink-0 bg-fg-4" />
              <span className="min-w-0">{typed?.(x) ? <Typed text={x} /> : <Rich text={x} />}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-base text-fg-3">{empty}</p>
      )}
    </section>
  );
}

function AttestationDoc() {
  const { d, c, me, extraRisk, statement: st, seconds } = useReview();
  const a = d.signoff ?? d.firstSign;
  const final = d.signoff;
  const who = a ? (a.signerName ?? `@${a.signer}`) : (st?.signer.name ?? me?.name ?? 'you');
  const login = a ? a.signer : (st?.signer.login ?? me?.login);
  const ok = a?.decision !== 'rejected';
  // unsigned: the lists come from the server, built by the same function that signs. Until it answers, the local composition stands in.
  const lists = a
    ? a
    : st
      ? st
      : { checkedByAI: c.checkedByAI.map((e) => `${e.id}: ${e.conclusion}`), checkedByHuman: c.checkedByHuman, notChecked: c.notChecked, residualRisk: c.residualRisk, humanRisk: extraRisk };
  const typed = new Set(lists.humanRisk ?? extraRisk);
  const override = a ? a.override : st?.override;
  const mins = (s: number) => (s < 90 ? `${Math.max(1, Math.round(s))} s` : `${Math.round(s / 60)} min`);
  return (
    <article className="mx-auto w-full max-w-[640px] pt-4">
      <div className="rounded-xl border border-line bg-surface px-8 pt-7 pb-3 max-sm:px-5">
        <div className="flex items-center justify-between text-sm text-fg-3">
          <span>{final ? 'Attestation' : d.firstSign ? 'Attestation, first of two signatures' : 'Attestation, not signed yet'}</span>
          <span className="mono text-xs">
            {d.requirement.id} · {shortSha(d.pr.headSha)}
          </span>
        </div>
        <p className="mt-4 text-xl leading-[28px] font-medium tracking-[-0.01em] text-fg">
          {a ? (ok ? `${who} accepted this change.` : `${who} asked for changes.`) : `I, ${who}, accept this change at commit ${shortSha(d.pr.headSha)}.`}
        </p>
        <p className="mt-2 mb-5 text-base text-fg-3">
          {a
            ? `${login ? `@${login}, ` : ''}${fmtDateTime(a.at)}, after ${mins(a.reviewSeconds)} of review clocked by the server. Bound to commit ${shortSha(a.headSha)}; a new commit needs a new signature.`
            : `${login ? `@${login}. ` : ''}${mins(seconds)} of review clocked by the server so far. This is the exact statement your name goes under: the server builds it, and signs these same lines.`}
        </p>
        <AttList title="Checked by the AI, by running it or by a deterministic check" items={lists.checkedByAI} empty="Nothing was executed or verified." />
        <AttList title="Checked by me" items={lists.checkedByHuman} empty="Nothing yet. Reading a unit, judging a finding or answering a decision adds a line here." />
        <AttList title="Not checked by anyone" items={lists.notChecked} empty="Nothing is listed as unchecked." />
        <AttList title="Risk I accept" items={lists.residualRisk} empty="No residual risk is recorded." typed={(x) => typed.has(x) || !AI_RISK.test(x)} />
        {override && (
          <section className="border-t border-line py-4">
            <h3 className="flex items-baseline justify-between text-sm font-medium text-fg">
              Accepted over confirmed problems
              <span className="num font-normal text-fg-3">{override.items.length}</span>
            </h3>
            <ul className="mt-2 space-y-1.5 text-base text-fg-2">
              {override.items.map((x, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-[9px] h-px w-2 shrink-0 bg-fg-4" />
                  <span className="min-w-0">
                    <Rich text={x} />
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-fg-3">My reason</p>
            <p className="mt-1 text-base whitespace-pre-wrap text-fg">{override.reason}</p>
          </section>
        )}
        {a?.cosign && (
          <section className="border-t border-line py-4 text-base text-fg-2">
            Co-signed by <span className="text-fg">{a.cosign.signerName ?? `@${a.cosign.signer}`}</span>, {fmtDateTime(a.cosign.at)}, after their own read of {a.cosign.readUnitIds.length} units in {mins(a.cosign.reviewSeconds)}.
          </section>
        )}
        {a && (
          <section className="border-t border-line py-4 text-sm text-fg-3">
            {a.rushed && <div className="mb-2 text-amber">Signed faster than the floor for this change: recorded, and not counted toward trust.</div>}
            <div className="mono text-xs break-all">sha256 {a.hash}</div>
            <div className="mono mt-1 text-xs break-all">prev {a.prevHash}</div>
            {a.cosign && <div className="mono mt-1 text-xs break-all">co-sign {a.cosign.hash}</div>}
            <div className="mt-3 flex gap-4">
              {a.github?.statusUrl && (
                <a href={a.github.statusUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-fg-2 hover:text-fg">
                  Commit status <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {a.github?.commentUrl && (
                <a href={a.github.commentUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-fg-2 hover:text-fg">
                  Comment on the PR <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </section>
        )}
      </div>
      <p className="mt-3 px-1 text-sm text-fg-3">
        {final
          ? 'Chained into the trust ledger. Editing it afterwards breaks the chain.'
          : d.firstSign
            ? 'Recorded on the trust ledger. Nothing is accepted until a second person signs.'
            : d.live?.publishes === false
              ? 'On sign-off this is hashed and chained into the trust ledger. This copy does not post to GitHub.'
              : 'On sign-off this is hashed, chained into the trust ledger and posted to the pull request.'}
      </p>
    </article>
  );
}

// ───────────────────────────── brief ─────────────────────────────
const DEPTH = { read3: 'Read closely', read: 'Read', skim: 'Skim', none: 'Skip' } as const;
type Depth = keyof typeof DEPTH;
const depthOf = (u: ChangeUnit): Depth => (u.ask === 'read' ? (u.tier === 'T3' ? 'read3' : 'read') : u.ask);
const lines = (u: ChangeUnit) => u.additions + u.deletions;

/** A routing fact in a few words, with the points it added or took away. */
function fact(label: string): string {
  const kind = /^Kind: ([\w-]+)$/.exec(label);
  if (kind) return kindLabel[kind[1]] ?? kind[1].replace('-', ' ');
  const area = /^Area [“"'](.+?)[”"'] is (\w+)$/.exec(label);
  if (area) return `area “${area[1]}” is ${area[2].toLowerCase()}`;
  const t = tidy(label)
    .replace(/^Referenced from (\d+) places?$/, 'referenced from $1 places')
    .replace(/^Tests notice every hunk.*$/, 'tests notice every hunk')
    .replace(/^No test notices (\d+) hunks?$/, (_m, n: string) => `no test notices ${n} hunk${n === '1' ? '' : 's'}`)
    .replace(/^(\d+) changed lines$/, '$1 lines');
  return t.charAt(0).toLowerCase() + t.slice(1);
}
const pts = (p: number) => (p > 0 ? `+${p}` : p < 0 ? `\u2212${-p}` : '0');

function Facts({ units }: { units: ChangeUnit[] }) {
  // one unit: its own facts. A group: each fact once, with the points it carried across the group
  const sum = new Map<string, number>();
  for (const u of units) for (const f of u.riskFactors) if (f.points) sum.set(fact(f.label), Math.max(sum.get(fact(f.label)) ?? -99, f.points));
  const top = [...sum].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3);
  if (!top.length) return <span>Nothing raised or lowered its score.</span>;
  return (
    <>
      {top.map(([label, p], i) => (
        <span key={label}>
          {i > 0 && <span className="mx-1.5 text-fg-4">·</span>}
          {label} <span className={cx('num', p > 0 ? 'text-fg-2' : 'text-fg-3')}>{pts(p)}</span>
        </span>
      ))}
    </>
  );
}

function DepthWord({ depth }: { depth: Depth }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap', depth === 'read3' ? 'font-medium text-fg' : depth === 'read' ? 'text-fg' : depth === 'skim' ? 'text-fg-2' : 'text-fg-3')}>
      <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden>
        {[0, 1, 2].map((i) => (
          <rect key={i} x={1 + i * 4} y="2" width="2.5" height="8" rx="0.8" fill={i < (depth === 'read3' ? 3 : depth === 'read' ? 2 : depth === 'skim' ? 1 : 0) ? 'var(--fg-2)' : 'var(--line-strong)'} />
        ))}
      </svg>
      {DEPTH[depth]}
    </span>
  );
}

/** The brief's artifact: why each part of the change gets the depth it gets, what is skipped on what proof, and what nobody looked at. */
function BriefStage({ openUnit }: { openUnit: (id: string) => void }) {
  const r = useReview();
  const { d } = r;
  const ro = d.routing;
  const full = fullReadReason(d);
  const order: Depth[] = ['read3', 'read', 'skim', 'none'];
  const units = [...d.units].sort((a, b) => order.indexOf(depthOf(a)) - order.indexOf(depthOf(b)) || a.storyOrder - b.storyOrder);
  const grouped = units.length > 5;
  const rows = grouped ? order.map((k) => ({ key: k, depth: k, units: units.filter((u) => depthOf(u) === k) })).filter((g) => g.units.length) : units.map((u) => ({ key: u.id, depth: depthOf(u), units: [u] }));
  const skipped = units.filter((u) => u.ask === 'none');
  const skimmed = units.filter((u) => u.ask === 'skim');
  const proofs = [...new Set(skipped.map((u) => plainProof(u.skipProof?.text ?? u.summary)))];
  const chip = 'num inline-flex h-5 items-center rounded-[5px] border border-line px-1.5 text-xs text-fg-3 transition-colors hover:border-line-strong hover:text-fg';
  const h = 'text-md font-medium text-fg';
  return (
    <div className="mx-auto w-full max-w-[860px]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className={h}>Why this depth</h2>
        <p className="text-sm text-fg-3">A points table in the policy file routes each unit. No model judges risk.</p>
      </div>
      {full && units.length > 0 && (
        <p className="mt-2 text-base text-fg-2">
          <span className="font-medium text-fg">Every line is read this time.</span> {full.replace(/ Read all of it, then say whether you found anything the AI missed\.$/, '')} Below is the depth the plan would otherwise have asked for.
        </p>
      )}
      {units.length === 0 && <p className="mt-3 border-t border-line pt-3 text-base text-fg-2">The diff was not grouped into units, so there is no reading plan to show. The stages that did not finish are listed under what nobody checked.</p>}
      <table className={cx('mt-3 w-full table-fixed border-collapse text-left', units.length === 0 && 'hidden')}>
        <thead>
          <tr className="text-xs font-medium text-fg-3">
            <th className="border-b border-line-strong pb-1.5 font-medium">{grouped ? 'Units' : 'Unit'}</th>
            <th className="w-[58px] border-b border-line-strong pb-1.5 text-right font-medium">Lines</th>
            <th className="w-[124px] border-b border-line-strong pb-1.5 pl-5 font-medium">Depth</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.key} className="align-top">
              <td className="border-b border-line py-2 pr-4">
                {grouped ? (
                  <span className="flex flex-wrap items-center gap-1">
                    {g.units.map((u) => (
                      <button key={u.id} type="button" title={tidy(u.title).replace(/`/g, '')} onClick={() => openUnit(u.id)} className={chip}>
                        {u.id}
                      </button>
                    ))}
                    <span className="ml-1 text-base text-fg-2">{[...new Set(g.units.map((u) => kindLabel[u.kind]))].join(', ')}</span>
                  </span>
                ) : (
                  <button type="button" onClick={() => openUnit(g.units[0].id)} title="Open this unit" className="group flex w-full min-w-0 items-baseline gap-2 text-left text-base text-fg">
                    <span className="num w-5 shrink-0 text-xs text-fg-3">{g.units[0].id}</span>
                    <span className="min-w-0 truncate group-hover:underline group-hover:decoration-line-strong group-hover:underline-offset-4">
                      <Rich text={g.units[0].title} />
                    </span>
                  </button>
                )}
                <span className={cx('mt-0.5 block text-sm text-fg-3', !grouped && 'pl-7')}>{g.depth === 'none' ? <>Skipped: {(plainProof(g.units[0].skipProof?.text ?? '').split('; ')[0] || 'a run covers it').replace(/^./, (c) => c.toLowerCase())}.</> : <Facts units={g.units} />}</span>
              </td>
              <td className="num border-b border-line py-2 text-right text-base text-fg-2">{g.units.reduce((a, u) => a + lines(u), 0)}</td>
              <td className="border-b border-line py-2 pl-5 text-base">
                <DepthWord depth={g.depth} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-6 grid gap-x-10 gap-y-6 sm:grid-cols-2">
        <section>
          <h2 className={h}>What you can skip, and why</h2>
          {units.length === 0 ? (
            <p className="mt-1.5 text-base text-fg-2">Nothing. No skip was granted.</p>
          ) : full ? (
            <p className="mt-1.5 text-base text-fg-2">Nothing this time. A skip is only as good as the reviewer that granted it, and this read is how the reviewer is tested.</p>
          ) : skipped.length ? (
            <button type="button" onClick={() => r.go('skipped')} className="group mt-1.5 block text-left text-base text-fg-2">
              <span className="num font-medium text-fg">{ro.skipLines} lines</span>, in {plural(skipped.length, 'unit')}: {proofs.join('. Also: ')}.{' '}
              <span className="whitespace-nowrap text-fg-3 underline decoration-line-strong underline-offset-4 group-hover:text-fg">See the proof</span>
            </button>
          ) : (
            <p className="mt-1.5 text-base text-fg-2">Nothing. No run covers a whole unit of this change, so no line is skipped.</p>
          )}
          {!full && skimmed.length > 0 && (
            <p className="mt-2 text-base text-fg-2">
              <span className="num font-medium text-fg">{ro.skimLines} lines</span> to skim only ({[...new Set(skimmed.map((u) => kindLabel[u.kind]))].join(', ')}): low risk, but no run stands in for a look.
            </p>
          )}
        </section>
        <section>
          <h2 className={cx(h, 'flex items-baseline justify-between')}>
            What nobody checked
            <span className="num text-sm font-normal text-fg-3">{d.notChecked.length}</span>
          </h2>
          {d.notChecked.length ? (
            <>
              <ul className="mt-1.5 space-y-1.5 text-base text-fg-2">
                {d.notChecked.slice(0, 2).map((n, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-[9px] h-px w-2 shrink-0 bg-fg-4" />
                    <span className="line-clamp-2 min-w-0">
                      <Rich text={n.what} />
                    </span>
                  </li>
                ))}
              </ul>
              <button type="button" onClick={() => r.go('limits')} className="mt-2 text-sm text-fg-3 underline decoration-line-strong underline-offset-4 hover:text-fg">
                {d.notChecked.length > 2 ? `All ${d.notChecked.length}, with the reason for each` : 'Why not'}
              </button>
            </>
          ) : (
            <p className="mt-1.5 text-base text-fg-2">Nothing is listed as unchecked.</p>
          )}
        </section>
      </div>
      <p className="mt-6 text-sm text-fg-3">
        {TIER_NAME[ro.tier] === 'Read closely' ? 'Routed at the closest tier' : `Routed as “${TIER_NAME[ro.tier].toLowerCase()}”`}, score {ro.score}. <Rich text={ro.spotCheck.selected ? 'Drawn for a spot check of the reviewer.' : ro.spotCheck.reason.replace(/\s*\(rate/, ' for a spot check (rate').replace(/; the draw.*\)\.$/, ').')} />
      </p>
    </div>
  );
}

// ───────────────────────────── the stage ─────────────────────────────
export function Stage({ ch }: { ch: Chapter }) {
  const r = useReview();
  const { d } = r;
  const sel = selected(ch, d, r.sel);
  const openUnit = (id: string) => {
    if (r.list.some((c) => c.id === id)) r.go(id);
    else {
      r.select('skipped', id);
      r.go('skipped');
    }
  };
  const tabOf = <T extends string>(tabs: { id: T; label: string }[]): [T, ReactNode] => {
    const cur = (tabs.find((t) => t.id === r.tab[ch.id]) ?? tabs[0]).id;
    return [cur, tabs.length > 1 ? <Tabs tabs={tabs} value={cur} onChange={(t) => r.setTab(ch.id, t)} /> : <span className="text-sm font-medium text-fg-2">{tabs[0].label}</span>];
  };

  if (ch.kind === 'brief')
    return (
      <Frame fit>
        <BriefStage openUnit={openUnit} />
      </Frame>
    );

  if (ch.kind === 'change' || ch.kind === 'how') {
    const scenario = d.diagrams.find((g) => g.kind === 'before-after');
    const map = d.diagrams.find((g) => g.kind === 'change-map');
    const g = ch.kind === 'change' ? (scenario ?? map) : (map ?? scenario);
    if (!g) return <Frame>{<p className="text-base text-fg-3">No diagram was produced for this change.</p>}</Frame>;
    return (
      <Frame fit>
        <Picture diagram={g} autoPlay={g.kind === 'before-after'} onUnit={openUnit} onHoverUnit={ch.kind === 'how' ? (id) => r.setHot(id ? [id] : []) : undefined} highlight={ch.kind === 'how' ? r.hot : undefined} />
      </Frame>
    );
  }

  if (ch.kind === 'asked') {
    const c = d.requirement.criteria.find((x) => x.id === sel);
    if (!c) return <Frame>{null}</Frame>;
    return (
      <Frame
        bar={<span className="text-sm font-medium text-fg-2">{c.id}</span>}
        aside={
          <a href={d.requirement.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-fg">
            {d.requirement.id} <ExternalLink className="h-3 w-3" />
          </a>
        }
      >
        <div className="mx-auto mb-6 w-full max-w-[860px]">
          <div className="text-sm text-fg-3">{c.sourceQuote ? 'Quoted from the requirement' : 'Implied by the requirement, not written in it'}</div>
          <blockquote className="mt-1.5 text-lg text-fg">
            <Rich text={c.sourceQuote ?? c.text} verbatim={!!c.sourceQuote} />
          </blockquote>
          {c.note && (
            <p className="mt-2 max-w-[72ch] text-base text-fg-3">
              <Rich text={c.note} />
            </p>
          )}
        </div>
        <div className="mx-auto mb-6 h-px w-full max-w-[860px] bg-line" />
        <EvidenceList ids={c.evidenceIds} />
      </Frame>
    );
  }

  if (ch.kind === 'proof') {
    const e = d.evidence.find((x) => x.id === sel);
    return <Frame>{e ? <EvidenceDetail key={e.id} e={e} /> : null}</Frame>;
  }

  if (ch.kind === 'reviewer') {
    const k = d.selfTest?.canaries.find((x) => x.id === sel);
    const x = d.discarded.find((y) => y.id === sel);
    return <Frame>{k ? <CanaryDetail key={k.id} k={k} /> : x ? <KilledDetail key={x.id} x={x} /> : null}</Frame>;
  }

  if (ch.kind === 'finding') {
    const f = d.findings.find((x) => x.id === ch.ref)!;
    const unit = d.units.find((u) => u.id === f.unitId);
    const [tab, bar] = tabOf([...(r.live.enabled ? [{ id: 'picture' as const, label: 'How it fails' }] : []), ...(f.evidenceIds.length ? [{ id: 'repro' as const, label: f.strength === 'executed' ? 'Reproduction' : 'Check' }] : []), { id: 'code' as const, label: 'Code' }]);
    return (
      <Frame bar={bar} aside={tab === 'picture' ? 'Drawn live by Gemini. An explanation, not evidence' : undefined}>
        {tab === 'picture' && <LivePicture key={f.id} kind="finding" id={f.id} />}
        {tab === 'repro' && <EvidenceList ids={f.evidenceIds} />}
        {tab === 'code' && (
          <div className="mx-auto w-full max-w-[980px] space-y-5">
            <Refs refs={f.refs} />
            {unit && (
              <div>
                <div className="mb-2 text-sm text-fg-3">
                  In <span className="text-fg-2">{unit.title}</span>
                </div>
                <UnitDiff unit={unit} />
              </div>
            )}
          </div>
        )}
      </Frame>
    );
  }

  if (ch.kind === 'refusal') {
    const q = d.refusals.find((x) => x.id === ch.ref)!;
    const unit = d.units.find((u) => u.id === q.unitId);
    const hasCode = !!unit || !!q.refs?.length;
    const [tab, bar] = tabOf([...(hasCode ? [{ id: 'code' as const, label: 'Code in question' }] : []), ...(q.evidenceIds.length ? [{ id: 'evidence' as const, label: 'What bears on it' }] : []), ...(!hasCode && !q.evidenceIds.length ? [{ id: 'none' as const, label: 'Context' }] : [])]);
    return (
      <Frame bar={bar} aside={unit && tab === 'code' ? unitAside(unit) : undefined}>
        {tab === 'code' && (
          <div className="mx-auto w-full max-w-[980px] space-y-5">
            <Refs refs={q.refs ?? []} />
            {unit && <UnitDiff unit={unit} />}
          </div>
        )}
        {tab === 'evidence' && <EvidenceList ids={q.evidenceIds} />}
        {tab === 'none' && <p className="mx-auto max-w-[60ch] pt-8 text-base text-fg-3">No code or run is attached to this decision. It is about intent, which only the owner knows.</p>}
      </Frame>
    );
  }

  if (ch.kind === 'unit') {
    const u = d.units.find((x) => x.id === ch.ref)!;
    const [tab, bar] = tabOf([{ id: 'diff' as const, label: 'Diff' }, ...(r.live.enabled ? [{ id: 'picture' as const, label: 'What it does' }] : [])]);
    return (
      <Frame bar={bar} aside={tab === 'diff' ? unitAside(u) : 'Drawn live by Gemini. An explanation, not evidence'}>
        {tab === 'diff' ? (
          <div className="mx-auto w-full max-w-[980px]">
            <UnitDiff unit={u} />
          </div>
        ) : (
          <LivePicture key={u.id} kind="unit" id={u.id} />
        )}
      </Frame>
    );
  }

  if (ch.kind === 'skipped') {
    const u = d.units.find((x) => x.id === sel);
    if (!u) return <Frame>{null}</Frame>;
    const [tab, bar] = tabOf([...(u.skipProof?.evidenceIds.length ? [{ id: 'proof' as const, label: 'The proof' }] : []), { id: 'diff' as const, label: 'Read it anyway' }]);
    return (
      <Frame bar={bar} aside={unitAside(u)}>
        {tab === 'proof' ? (
          <EvidenceList ids={u.skipProof!.evidenceIds} />
        ) : (
          <div className="mx-auto w-full max-w-[980px]">
            <UnitDiff unit={u} />
          </div>
        )}
      </Frame>
    );
  }

  if (ch.kind === 'limits')
    return (
      <Frame>
        <Trace />
      </Frame>
    );

  return (
    <Frame>
      <AttestationDoc />
    </Frame>
  );
}
