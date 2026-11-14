import { Scale } from 'lucide-react';
import type { ReactNode } from 'react';
import { PageHeader } from '../components/Shell';
import { concept as c } from '../content/concept';
import { cx } from '../lib/util';

const SECTIONS = [
  { id: 'principles', label: 'Principles' },
  { id: 'flow', label: 'How it works' },
  { id: 'routing', label: 'Routing' },
  { id: 'tradeoffs', label: 'Trade-offs' },
  { id: 'limits', label: 'Limits' },
  { id: 'failures', label: 'Failure modes' },
  { id: 'decisions', label: 'Decision log' },
  { id: 'questions', label: 'Judges’ questions' },
] as const;

/** One band of the card: a label in the left gutter, content to its right. */
function Band({ id, label, note, children }: { id: string; label: string; note?: string; children: ReactNode }) {
  return (
    <section id={id} className="grid scroll-mt-14 gap-x-10 gap-y-3 border-t border-line py-8 lg:grid-cols-[156px_minmax(0,1fr)]">
      <div>
        <h2 className="text-md font-semibold text-fg">{label}</h2>
        {note && <p className="mt-1 text-sm text-fg-3">{note}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function Rows({ head, rows, cols }: { head: string[]; rows: ReactNode[][]; cols: string }) {
  return (
    <div>
      {/* a phone has no room for three columns: each row becomes its own short list */}
      <ul className="md:hidden">
        {rows.map((r, i) => (
          <li key={i} className="border-b border-line py-3">
            <div className="text-base font-medium text-fg">{r[0]}</div>
            <dl className="mt-1.5 space-y-1.5">
              {r.slice(1).map((x, j) => (
                <div key={j}>
                  <dt className="text-xs text-fg-3">{head[j + 1]}</dt>
                  <dd className="text-base text-fg-2">{x}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
      <table className="w-full table-fixed border-collapse text-left max-md:hidden">
        <colgroup>
          {cols.split(' ').map((w, i) => (
            <col key={i} style={{ width: w }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} className="border-b border-line-strong pr-6 pb-2 text-xs font-medium text-fg-3">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((x, j) => (
                <td key={j} className={cx('border-b border-line py-2.5 pr-6 align-top text-base', j === 0 ? 'font-medium text-fg' : 'text-fg-2')}>
                  {x}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const Dash = () => <span className="mt-[9px] h-px w-2.5 shrink-0 bg-fg-4" aria-hidden />;

/** How deep a unit is read, as the same three bars the review uses. */
function Depth({ n }: { n: number }) {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3 shrink-0" aria-hidden>
      {[0, 1, 2].map((i) => (
        <rect key={i} x={1 + i * 4} y="2" width="2.5" height="8" rx="0.8" fill={i < n ? 'var(--fg-2)' : 'var(--line-strong)'} />
      ))}
    </svg>
  );
}

export default function ConceptPage() {
  const [rule, rest] = [c.tagline.split(', and ')[0], c.tagline.split(', and ')[1]];
  return (
    <>
      <PageHeader title="Concept" sub="The whole idea on one page: what it does, what it costs, where it stops." />
      <article className="mx-auto max-w-[1240px] px-10 pb-20 max-md:px-4">
        {/* the first screen: the rule, who owns what, and when the rule is suspended */}
        <header className="pt-10 pb-9 max-md:pt-7">
          <div className="grid items-start gap-x-14 gap-y-8 lg:grid-cols-[minmax(0,10fr)_minmax(0,11fr)]">
            <div>
              <p className="text-md font-semibold text-fg-2">{c.name}</p>
              <h1 className="mt-3 text-[40px] leading-[1.08] font-semibold tracking-[-0.03em] text-balance max-xl:text-[34px] max-md:text-[28px]">
                {rule},{' '}
                <span className="text-fg-3">and {rest}</span>
              </h1>
              <p className="mt-6 max-w-[58ch] text-lg leading-[1.6] text-fg-2">{c.recommendation}</p>
            </div>

            <div className="grid overflow-hidden rounded-xl border border-line sm:grid-cols-2 lg:mt-1">
              {c.owns.map((o, i) => (
                <section key={o.who} className={cx('p-5', i === 0 ? 'max-sm:border-b sm:border-r border-line' : 'bg-surface')}>
                  <h2 className="text-sm text-fg-3">{o.who} owns</h2>
                  <p className="mt-0.5 text-xl font-medium tracking-[-0.01em] text-fg">{o.what}</p>
                  <ul className="mt-4 space-y-2.5">
                    {o.items.map((x) => (
                      <li key={x} className="flex gap-2.5 text-base text-fg-2">
                        <Dash />
                        <span>{x}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>

          <section className="mt-10">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
              <h2 className="text-md font-semibold text-fg">Countersign says “read everything” when</h2>
              <p className="text-sm text-fg-3">{c.readEverything.then}</p>
            </div>
            <ol className="mt-3 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-5">
              {c.readEverything.when.map((w, i) => (
                <li key={w.title} className="bg-bg p-4">
                  <span className="num text-xs text-fg-4">{i + 1}</span>
                  <h3 className="mt-1 text-base font-medium text-fg">{w.title}</h3>
                  <p className="mt-1 text-sm text-fg-3">{w.body}</p>
                </li>
              ))}
            </ol>
          </section>
        </header>

        <nav aria-label="On this page" className="sticky top-0 z-10 -mx-10 flex gap-1 overflow-x-auto [scrollbar-width:none] border-y border-line bg-bg px-[30px] py-2 max-md:-mx-4 max-md:px-2">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="shrink-0 rounded-md px-2.5 py-1 text-sm text-fg-3 transition-colors hover:bg-surface-2 hover:text-fg">
              {s.label}
            </a>
          ))}
        </nav>

        <div className="[&>section:first-child]:border-t-0">
          <Band id="principles" label="Principles" note="Each one is a balance we chose on purpose.">
            <ol className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 xl:grid-cols-3">
              {c.principles.map((p, i) => (
                <li key={p.title} className="flex flex-col bg-bg p-5">
                  <h3 className="flex gap-2 text-md font-semibold text-fg">
                    <span className="num font-normal text-fg-4">{i + 1}</span>
                    <span className="text-balance">{p.title}</span>
                  </h3>
                  <p className="mt-2 flex-1 text-base text-fg-2">{p.body}</p>
                  <p className="mt-4 flex items-start gap-1.5 text-sm text-fg-3">
                    <Scale className="mt-[3px] h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span>
                      Balances <span className="text-fg-2">{p.balances.charAt(0).toLowerCase() + p.balances.slice(1)}</span>
                    </span>
                  </p>
                </li>
              ))}
            </ol>
          </Band>

          <Band id="flow" label="How it works" note="From pull request to ledger.">
            <ol className="grid grid-cols-2 gap-x-0 gap-y-6 md:grid-cols-4 xl:grid-cols-8">
              {c.flow.map((s, i) => (
                <li key={s.title} className="pr-4">
                  <div className="flex items-center" aria-hidden>
                    <span className={cx('h-2.5 w-2.5 shrink-0 rounded-full border-2', i === c.flow.length - 2 ? 'border-accent bg-accent' : 'border-fg-3 bg-bg')} />
                    <span className={cx('ml-1.5 h-px flex-1 bg-line-strong', i === c.flow.length - 1 && 'opacity-0')} />
                  </div>
                  <h3 className="mt-3 text-base font-semibold text-fg">{s.title}</h3>
                  <p className="mt-1 text-sm text-fg-2">{s.body}</p>
                </li>
              ))}
            </ol>
          </Band>

          <Band id="routing" label="Routing" note="Skip, skim or read: one table decides.">
            <Rows
              head={['Depth', 'Risk score', 'And the floor no score can lower']}
              cols="19% 15% 66%"
              rows={c.routing.tiers.map((t, i) => [
                <span key="d" className="flex items-center gap-2">
                  <Depth n={i} />
                  {t.depth}
                </span>,
                <span key="s" className="num">
                  {t.score}
                </span>,
                t.rule,
              ])}
            />
            <div className="mt-6 grid gap-x-10 gap-y-6 md:grid-cols-2">
              {[
                { h: 'What raises the score', xs: c.routing.raises },
                { h: 'What lowers it', xs: c.routing.lowers },
              ].map((g) => (
                <div key={g.h}>
                  <h3 className="text-xs font-medium text-fg-3">{g.h}</h3>
                  <ul className="mt-2 space-y-1.5">
                    {g.xs.map((x) => (
                      <li key={x} className="num flex gap-2.5 text-base text-fg-2">
                        <Dash />
                        <span>{x}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <p className="mt-5 max-w-[80ch] text-sm text-fg-3">{c.routing.note}</p>
          </Band>

          <Band id="tradeoffs" label="Trade-offs" note="What each choice buys and what it costs.">
            <Rows head={['We chose', 'We gain', 'We pay']} cols="30% 32% 38%" rows={c.tradeoffs.map((t) => [t.choice, t.gain, t.cost])} />
          </Band>

          <Band id="limits" label="Limits" note="What this does not do.">
            <ul className="grid gap-x-10 md:grid-cols-2">
              {c.limits.map((l) => {
                const cut = l.indexOf('. ');
                return (
                  <li key={l} className="border-b border-line py-3 text-base text-fg-2">
                    <span className="font-medium text-fg">{l.slice(0, cut + 1)}</span>
                    {l.slice(cut + 1)}
                  </li>
                );
              })}
            </ul>
          </Band>

          <Band id="failures" label="Failure modes" note="How AI review goes wrong, and what we do about it.">
            <Rows head={['Failure', 'What it looked like', 'Mitigation']} cols="24% 32% 44%" rows={c.failureModes.map((f) => [f.mode, f.seen, f.mitigation])} />
          </Band>

          <Band id="decisions" label="Decision log" note="What we changed our minds about.">
            <ol>
              {c.decisions.map((d) => (
                <li key={d.when + d.decision} className="grid gap-x-6 gap-y-0.5 border-b border-line py-2.5 md:grid-cols-[72px_minmax(0,5fr)_minmax(0,6fr)]">
                  <span className="num pt-px text-sm text-fg-3">{d.when}</span>
                  <span className="text-base font-medium text-fg">{d.decision}</span>
                  <span className="text-base text-fg-2">{d.why}</span>
                </li>
              ))}
            </ol>
          </Band>

          <Band id="questions" label="Judges’ questions" note="Asked before you have to.">
            <dl className="grid gap-x-10 gap-y-6 md:grid-cols-2">
              {c.judgeAnswers.map((j) => (
                <div key={j.q}>
                  <dt className="text-md font-semibold text-fg">{j.q}</dt>
                  <dd className="mt-1 max-w-[60ch] text-base text-fg-2">{j.a}</dd>
                </div>
              ))}
            </dl>
          </Band>
        </div>
      </article>
    </>
  );
}
